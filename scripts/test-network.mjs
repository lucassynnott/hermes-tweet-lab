// Test the new Lists + Contacts store collections, the /api/tweet-lab/network
// feature contract, and the safety rails that keep DM/email data out of the
// operator contact book.
//
// Run against an ephemeral port so we don't fight the production 4173
// service. The server uses an in-process DATA_FILE when TWEET_LAB_DATA_FILE
// is set, so each run is hermetic.

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const PORT = Number(process.env.TWEET_LAB_TEST_PORT || 4188);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP_DATA = path.join(projectRoot, 'data', `tweet-lab-test-${process.pid}-${Date.now()}.json`);

const checks = [];
function check(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition), detail: detail || '' });
}

async function waitForServer(url, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch { /* keep trying */ }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Server at ${url} did not become ready`);
}

async function main() {
  await fs.mkdir(path.dirname(TMP_DATA), { recursive: true });
  // Pre-populate so defaultState paths don't interfere with collections
  await fs.writeFile(TMP_DATA, JSON.stringify({
    schemaVersion: 2, createdAt: new Date().toISOString(),
    sources: [], drafts: [], templates: [], angles: [],
    scheduleSlots: [], lists: [], contacts: [], auditLog: []
  }, null, 2));

  const env = {
    ...process.env,
    PORT: String(PORT),
    TWEET_LAB_DATA_FILE: TMP_DATA,
    GORO_GENERATE_MODE: 'mock',
    NODE_ENV: 'test'
  };
  const server = spawn('node', ['server.js'], {
    cwd: projectRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverLog = '';
  server.stdout.on('data', chunk => { serverLog += chunk.toString(); });
  server.stderr.on('data', chunk => { serverLog += chunk.toString(); });

  try {
    await waitForServer(BASE);

    // 1. /api/tweet-lab/network returns the feature contract.
    const network = await fetch(`${BASE}/api/tweet-lab/network`);
    const networkBody = await network.json();
    check('GET /api/tweet-lab/network returns 200', network.status === 200);
    check('network payload has features[]', Array.isArray(networkBody.features));
    check('network payload has 10 features (8 known + safety placeholders)',
      networkBody.features.length >= 8,
      `got ${networkBody.features.length}`);

    const dmsFeature = networkBody.features.find(f => f.id === 'dms');
    check('DMs feature exists', Boolean(dmsFeature));
    check('DMs marked unavailable', dmsFeature && dmsFeature.available === false);
    check('DMs has reason text', dmsFeature && typeof dmsFeature.reason === 'string' && dmsFeature.reason.length > 50);
    check('DMs lists blockedBy items', dmsFeature && Array.isArray(dmsFeature.blockedBy) && dmsFeature.blockedBy.length > 0);

    const listsFeature = networkBody.features.find(f => f.id === 'lists');
    check('Lists feature exists', Boolean(listsFeature));
    check('Lists marked available', listsFeature && listsFeature.available === true);

    const contactsFeature = networkBody.features.find(f => f.id === 'contacts');
    check('Contacts feature exists', Boolean(contactsFeature));
    check('Contacts marked available', contactsFeature && contactsFeature.available === true);

    // 2. /api/tweet-lab/network?id=dms returns the detail explainer.
    const dmsDetail = await fetch(`${BASE}/api/tweet-lab/network?id=dms`);
    const dmsBody = await dmsDetail.json();
    check('GET /api/tweet-lab/network?id=dms returns 200', dmsDetail.status === 200);
    check('DMs detail returns capabilities list', Array.isArray(dmsBody.capabilities));
    check('DMs detail available=false', dmsBody.available === false);

    // 3. /api/tweet-lab/network?id=unknown returns 404.
    const unknown = await fetch(`${BASE}/api/tweet-lab/network?id=does-not-exist`);
    check('GET /api/tweet-lab/network?id=unknown returns 404', unknown.status === 404);

    // 4. Lists store: CRUD round-trip.
    const created = await fetch(`${BASE}/api/tweet-lab/store/lists`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Founder ops daily',
        kind: 'account-group',
        description: 'Test list',
        handles: ['LFGrowingThin', 'onstartups', 'invalid-handle-way-too-long'],
        tags: ['founder-ops', 'growth'],
        notes: 'local operator test'
      })
    });
    check('POST lists rejects invalid handles with 400', created.status === 400);
    const createError = await created.json();
    check('POST lists error mentions handle', /handle/i.test(createError.error || ''));

    const validCreate = await fetch(`${BASE}/api/tweet-lab/store/lists`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Founder ops daily',
        kind: 'account-group',
        description: 'Test list',
        handles: ['LFGrowingThin', 'onstartups'],
        tags: ['founder-ops', 'growth']
      })
    });
    check('POST lists with valid handles returns 201', validCreate.status === 201);
    const validList = await validCreate.json();
    check('Created list has id', typeof validList.id === 'string' && validList.id.length > 0);
    check('Created list has 2 handles', Array.isArray(validList.handles) && validList.handles.length === 2);

    const listGet = await fetch(`${BASE}/api/tweet-lab/store/lists`);
    const listsBody = await listGet.json();
    check('GET lists returns array', Array.isArray(listsBody));
    check('GET lists contains the created list', listsBody.some(item => item.id === validList.id));

    const listPatch = await fetch(`${BASE}/api/tweet-lab/store/lists/${encodeURIComponent(validList.id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notes: 'updated notes' })
    });
    check('PATCH list returns 200', listPatch.status === 200);
    const patched = await listPatch.json();
    check('PATCH list updated notes field', patched.notes === 'updated notes');

    // 5. Contacts store: CRUD + safety rails.
    const badContact = await fetch(`${BASE}/api/tweet-lab/store/contacts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        handle: 'not a valid handle with spaces',
        notes: 'test'
      })
    });
    check('POST contacts rejects invalid handle with 400', badContact.status === 400);

    const dmContact = await fetch(`${BASE}/api/tweet-lab/store/contacts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        handle: 'LFGrowingThin',
        notes: 'They DM\'d me about the Series A — sounds legit.'
      })
    });
    check('POST contacts rejects DM body in notes with 400', dmContact.status === 400);
    const dmError = await dmContact.json();
    check('DM rejection error mentions DM', /DM|notes/i.test(dmError.error || ''));

    const emailContact = await fetch(`${BASE}/api/tweet-lab/store/contacts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        handle: 'LFGrowingThin',
        notes: 'reach them at founder@example.com for ops sync'
      })
    });
    check('POST contacts rejects email in notes with 400', emailContact.status === 400);

    const validContact = await fetch(`${BASE}/api/tweet-lab/store/contacts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        handle: 'LFGrowingThin',
        displayName: 'LF',
        role: 'founder',
        cadence: 'weekly',
        tags: ['founder-ops'],
        notes: 'Cadence: weekly check-ins. Engage with founder ops posts.'
      })
    });
    check('POST contacts with clean data returns 201', validContact.status === 201);
    const validC = await validContact.json();
    check('Created contact has handle', validC.handle === 'LFGrowingThin');
    check('Created contact cadence persisted', validC.cadence === 'weekly');

    const contactGet = await fetch(`${BASE}/api/tweet-lab/store/contacts`);
    const contactsBody = await contactGet.json();
    check('GET contacts returns array', Array.isArray(contactsBody));
    check('GET contacts contains the created contact', contactsBody.some(item => item.id === validC.id));

    // PATCH contact
    const contactPatch = await fetch(`${BASE}/api/tweet-lab/store/contacts/${encodeURIComponent(validC.id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notes: 'updated: cadence weekly, founder ops focus.' })
    });
    check('PATCH contact returns 200', contactPatch.status === 200);

    // DELETE both
    const listDel = await fetch(`${BASE}/api/tweet-lab/store/lists/${encodeURIComponent(validList.id)}`, { method: 'DELETE' });
    check('DELETE list returns 200', listDel.status === 200);

    const contactDel = await fetch(`${BASE}/api/tweet-lab/store/contacts/${encodeURIComponent(validC.id)}`, { method: 'DELETE' });
    check('DELETE contact returns 200', contactDel.status === 200);

    const listAfterDelete = await fetch(`${BASE}/api/tweet-lab/store/lists`);
    const afterLists = await listAfterDelete.json();
    check('After delete, lists no longer contains the list', !afterLists.some(item => item.id === validList.id));
  } finally {
    server.kill('SIGTERM');
    try {
      await fs.unlink(TMP_DATA);
    } catch { /* ignore */ }
  }

  const failed = checks.filter(c => !c.ok);
  for (const item of checks) {
    const detail = item.detail ? ` (${item.detail})` : '';
    console.log(`${item.ok ? '✓' : '✗'} ${item.name}${detail}`);
  }
  if (failed.length) {
    console.error(`\n${failed.length}/${checks.length} network checks failed`);
    process.exit(1);
  }
  console.log(`\n${checks.length}/${checks.length} network checks passed`);
}

main().catch(err => {
  console.error('test-network failed:', err);
  process.exit(1);
});
