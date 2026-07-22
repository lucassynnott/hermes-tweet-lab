/**
 * Test script for workshop compare and remix functionality.
 * Verifies the remix endpoint, parent draft tracking, and source alignment.
 */

import assert from 'node:assert';
import { createServer } from 'node:http';
import { handle, ensureStore } from '../server.js';

async function testRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: path,
      headers: { host: 'localhost:4173' },
      on(event, handler) {
        if (event === 'data') {
          if (body) handler(Buffer.from(JSON.stringify(body)));
        }
        if (event === 'end') handler();
      }
    };
    const chunks = [];
    const res = {
      writeHead(status, headers) { this.status = status; this.headers = headers; },
      end(data) { resolve({ status: this.status, headers: this.headers, body: data ? JSON.parse(data) : null }); }
    };
    handle(req, res).catch(err => reject(err));
  });
}

async function runTests() {
  await ensureStore();

  let passed = 0;
  let failed = 0;

  function check(name, condition) {
    if (condition) { passed++; console.log(`✓ ${name}`); }
    else { failed++; console.log(`✗ ${name}`); }
  }

  // 1. Generate a draft first so we have something to remix
  const genRes = await testRequest('POST', '/api/tweet-lab/generate', {
    context: 'Test workshop remix functionality',
    tone: 'sharp',
    count: 2
  });
  check('generate returns 200', genRes.status === 200);
  check('generate returns drafts', Array.isArray(genRes.body?.drafts) && genRes.body.drafts.length > 0);

  const parentDraft = genRes.body.drafts[0];

  // 2. Remix endpoint exists and works
  const remixRes = await testRequest('POST', '/api/tweet-lab/remix', {
    draftId: parentDraft.id,
    instruction: 'Make it shorter and more direct',
    tone: 'sharp',
    count: 2
  });
  check('remix returns 200', remixRes.status === 200);
  check('remix returns candidates', Array.isArray(remixRes.body?.candidates) && remixRes.body.candidates.length > 0);
  check('remix returns drafts', Array.isArray(remixRes.body?.drafts) && remixRes.body.drafts.length > 0);
  check('remix has parentDraftId', remixRes.body?.parentDraftId === parentDraft.id);

  const remixedDraft = remixRes.body.drafts[0];

  // 3. Remixed draft has parent reference persisted
  const getDraftRes = await testRequest('GET', `/api/tweet-lab/store/drafts/${encodeURIComponent(remixedDraft.id)}`, null);
  check('remixed draft retrievable', getDraftRes.status === 200);
  check('remixed draft has parentDraftId', getDraftRes.body?.parentDraftId === parentDraft.id);
  check('remixed draft has remixSource', getDraftRes.body?.remixSource?.parentDraftId === parentDraft.id);
  check('remixed draft has remix instruction', getDraftRes.body?.remixSource?.instruction === 'Make it shorter and more direct');

  // 4. Remix without draftId fails
  const badRemix = await testRequest('POST', '/api/tweet-lab/remix', {
    instruction: 'test'
  });
  check('remix without draftId returns 400', badRemix.status === 400);

  // 5. Remix with bad draftId fails
  const missingRemix = await testRequest('POST', '/api/tweet-lab/remix', {
    draftId: 'nonexistent-draft-id',
    instruction: 'test'
  });
  check('remix with missing draftId returns 404', missingRemix.status === 404);

  // 6. Review gate runs on remixed drafts
  check('remixed draft has gateStatus', ['clean', 'needs-proof', 'revise', 'blocked'].includes(getDraftRes.body?.gateStatus));
  check('remixed draft has gateScore', typeof getDraftRes.body?.gateScore === 'number');

  // 7. Audit entry for remix
  const auditRes = await testRequest('GET', '/api/tweet-lab/store/auditLog', null);
  check('audit log exists', auditRes.status === 200);
  const remixAudit = auditRes.body?.find?.(e => e.kind === 'draft.remix' || e.kind === 'draft.remixed');
  check('audit has remix entry', !!remixAudit);

  console.log(`\n${passed}/${passed + failed} workshop/remix checks passed`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => { console.error(err); process.exit(1); });
