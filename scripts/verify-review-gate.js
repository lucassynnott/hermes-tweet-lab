#!/usr/bin/env node
/**
 * Verify Review Gate (Phase 5) — quality scoring, schedule blocking, and UI wiring.
 *
 * Tests:
 *   1. Pure unit tests on lib/reviewGate.js (metrics, AI-slop, overlength, sourceRefs)
 *   2. HTTP integration: generated drafts carry gate fields
 *   3. HTTP integration: review endpoint recomputes gate
 *   4. HTTP integration: edit recomputes gate
 *   5. HTTP integration: schedule blocks unsafe drafts
 *   6. HTTP integration: schedule includes gate in success response
 */
import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { reviewDraft } from '../lib/reviewGate.js';

const BASE = 'http://127.0.0.1:4183';
let serverProcess;
let exitCode = 0;
let assertionCount = 0;

function log(label, detail = '') {
  const pad = label.padEnd(18, ' ');
  console.log(`${pad} ${detail}`);
}

async function req(method, path, body) {
  const url = `${BASE}${path}`;
  const options = { method, headers: { 'content-type': 'application/json' } };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(url, options);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

function assertEqual(actual, expected, message) {
  assertionCount++;
  if (actual !== expected) {
    console.error(`  FAIL: ${message}`);
    console.error(`    expected: ${expected}`);
    console.error(`    actual:   ${actual}`);
    exitCode = 1;
    return false;
  }
  console.log(`  ok   ${message}`);
  return true;
}

function assertTrue(value, message) {
  assertionCount++;
  if (!value) {
    console.error(`  FAIL: ${message}`);
    exitCode = 1;
    return false;
  }
  console.log(`  ok   ${message}`);
  return true;
}

function assertFalse(value, message) {
  assertionCount++;
  if (value) {
    console.error(`  FAIL: ${message}`);
    exitCode = 1;
    return false;
  }
  console.log(`  ok   ${message}`);
  return true;
}

async function startServer() {
  log('boot', 'starting server in mock mode...');
  serverProcess = spawn('node', ['server.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, GORO_GENERATE_MODE: 'mock', PORT: '4183' },
    stdio: 'pipe'
  });
  await setTimeout(800);
  for (let i = 0; i < 10; i++) {
    try {
      const res = await fetch(`${BASE}/api/tweet-lab/config`);
      if (res.ok) { log('boot', 'server ready'); return; }
    } catch {}
    await setTimeout(300);
  }
  throw new Error('Server did not start');
}

async function stopServer() {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    await setTimeout(500);
    if (!serverProcess.killed) serverProcess.kill('SIGKILL');
  }
}

// ── Unit tests on the pure module ────────────────────────────

function unitTests() {
  console.log('\n--- Unit: reviewDraft pure function ---');

  // 1. Clean draft
  const clean = reviewDraft({ text: 'Most AI projects fail because they stop at answers instead of owning the loop.' });
  assertEqual(clean.status, 'clean', 'clean draft → status clean');
  assertEqual(clean.score, 100, 'clean draft → score 100');
  assertTrue(clean.warnings.length === 0, 'clean draft → no warnings');

  // 2. Overlength > 280 → blocked
  const overlength = reviewDraft({ text: 'A'.repeat(281) });
  assertEqual(overlength.status, 'blocked', '281 chars → status blocked');
  assertTrue(overlength.score < 100, '281 chars → score < 100');
  assertTrue(overlength.checks.some(c => c.name === 'char-length' && c.level === 'fail'), '281 chars → char-length fail');

  // 3. Near limit 261-280 → revise
  const nearLimit = reviewDraft({ text: 'A'.repeat(270) });
  assertEqual(nearLimit.status, 'revise', '270 chars → status revise');
  assertTrue(nearLimit.checks.some(c => c.name === 'char-length' && c.level === 'warn'), '270 chars → char-length warn');

  // 4. Metric without sourceRefs → needs-proof
  const metric = reviewDraft({ text: '73% of teams fail at AI adoption within the first year of trying.' });
  assertEqual(metric.status, 'needs-proof', 'metric without sourceRefs → needs-proof');
  assertTrue(metric.warnings.some(w => w.includes('metric')), 'metric warning mentions "metric"');
  assertTrue(metric.warnings.some(w => w.includes('sourceRef') || w.includes('sourceRefs')), 'metric warning mentions sourceRefs');

  // 5. Metric with sourceRefs → still needs-proof (verify accuracy) but source-refs check passes
  const metricWithRefs = reviewDraft({
    text: '73% of teams fail at AI adoption within the first year of trying.',
    sourceRefs: ['https://example.com/study']
  });
  assertEqual(metricWithRefs.status, 'needs-proof', 'metric with sourceRefs → needs-proof');
  assertTrue(metricWithRefs.checks.some(c => c.name === 'source-refs' && c.level === 'pass'), 'metric with sourceRefs → source-refs passes');

  // 6. AI-slop term → revise
  const slop = reviewDraft({ text: 'Let us delve into the intricate tapestry of modern AI workflows and solutions.' });
  assertEqual(slop.status, 'revise', 'AI-slop terms → revise');
  assertTrue(slop.checks.some(c => c.name === 'ai-slop' && c.level === 'warn'), 'ai-slop check warns');
  assertTrue(slop.warnings.some(w => w.includes('delve')), 'ai-slop warning mentions "delve"');

  // 7. Banned phrase → blocked
  const banned = reviewDraft({ text: 'As an AI, I cannot assist with that request, sorry.' });
  assertEqual(banned.status, 'blocked', 'banned phrase → blocked');
  assertTrue(banned.checks.some(c => c.name === 'banned-phrases' && c.level === 'fail'), 'banned-phrases check fails');

  // 8. Too generic (short) → revise
  const short = reviewDraft({ text: 'AI is good.' });
  assertTrue(short.checks.some(c => c.name === 'too-generic' && c.level === 'warn'), 'short draft → too-generic warns');

  // 9. Duplicate detection
  const existing = [{ id: 'd1', text: 'Most AI projects fail because they stop at answers.', angle: 'Test' }];
  const dup = reviewDraft(
    { text: 'Most AI projects fail because they stop at answers.', id: 'd2' },
    { allDrafts: existing }
  );
  assertTrue(dup.checks.some(c => c.name === 'duplicate' && c.level === 'warn'), 'duplicate draft → duplicate warns');
  assertTrue(dup.warnings.some(w => w.includes('similar')), 'duplicate warning mentions "similar"');

  // 10. Not a duplicate
  const unique = reviewDraft(
    { text: 'A completely different thought about cooking pasta at high altitude.', id: 'd2' },
    { allDrafts: existing }
  );
  assertTrue(unique.checks.some(c => c.name === 'duplicate' && c.level === 'pass'), 'unique draft → duplicate passes');

  // 11. Multiple issues → worst wins (blocked > revise > needs-proof)
  const multiFail = reviewDraft({ text: 'As an AI, I cannot ' + 'X'.repeat(270) });
  assertEqual(multiFail.status, 'blocked', 'banned + overlength → blocked');

  // 12. Score ordering: clean > needs-proof > revise (lower score is worse)
  assertTrue(clean.score >= metricWithRefs.score, 'clean score >= needs-proof score');
  assertTrue(metricWithRefs.score >= slop.score, 'needs-proof score >= revise score');
  assertTrue(slop.score > overlength.score, 'revise score > blocked score');
}

// ── HTTP integration tests ───────────────────────────────────

async function httpTests() {
  console.log('\n--- HTTP: Generated drafts carry gate fields ---');

  // Generate mock drafts
  const genRes = await req('POST', '/api/tweet-lab/generate', {
    context: 'Testing review gate',
    tone: 'sharp',
    count: 2
  });
  assertEqual(genRes.status, 200, 'generate returns 200');
  assertTrue(Array.isArray(genRes.json?.drafts), 'generate returns drafts array');
  const draft = genRes.json.drafts[0];
  assertTrue(draft.gateStatus !== undefined, 'draft has gateStatus field');
  assertTrue(draft.gateScore !== undefined, 'draft has gateScore field');
  assertTrue(Array.isArray(draft.gateWarnings), 'draft has gateWarnings array');
  assertTrue(Array.isArray(draft.gateChecks), 'draft has gateChecks array');
  assertTrue(Array.isArray(draft.gateSuggestions), 'draft has gateSuggestions array');
  log('gate on draft', `${draft.gateStatus} (score ${draft.gateScore})`);

  console.log('\n--- HTTP: Review endpoint (GET) ---');

  const reviewGet = await req('GET', `/api/tweet-lab/drafts/${encodeURIComponent(draft.id)}/review`);
  assertEqual(reviewGet.status, 200, 'GET review returns 200');
  assertEqual(reviewGet.json.draftId, draft.id, 'GET review returns draftId');
  assertTrue(reviewGet.json.status !== undefined, 'GET review returns status');
  assertTrue(typeof reviewGet.json.score === 'number', 'GET review returns numeric score');
  assertTrue(Array.isArray(reviewGet.json.checks), 'GET review returns checks array');

  console.log('\n--- HTTP: Review endpoint (POST) recomputes ---');

  // POST review with ad-hoc text override
  const reviewPost = await req('POST', `/api/tweet-lab/drafts/${encodeURIComponent(draft.id)}/review`, {
    text: 'As an AI, I cannot help you with that.'
  });
  assertEqual(reviewPost.status, 200, 'POST review returns 200');
  assertEqual(reviewPost.json.status, 'blocked', 'POST review with banned phrase → blocked');
  assertTrue(reviewPost.json.checks.some(c => c.name === 'banned-phrases' && c.level === 'fail'), 'POST review detects banned phrase');

  console.log('\n--- HTTP: Edit recomputes gate ---');

  // Edit draft to add AI-slop
  const editRes = await req('POST', `/api/tweet-lab/drafts/${encodeURIComponent(draft.id)}/edit`, {
    text: 'Let us delve into the intricate details of operator loops and their impact.',
    angle: draft.angle,
    rationale: draft.rationale,
    sourceRefs: draft.sourceRefs,
    warnings: []
  });
  assertEqual(editRes.status, 200, 'edit returns 200');
  assertEqual(editRes.json.draft.gateStatus, 'revise', 'edit with AI-slop → gate revise');
  assertTrue(editRes.json.draft.gateScore < 100, 'edit with AI-slop → score < 100');

  console.log('\n--- HTTP: Schedule blocks blocked draft ---');

  // Create a draft with banned phrase, try to schedule without approval
  const blockedGen = await req('POST', '/api/tweet-lab/generate', {
    context: 'Test blocked schedule',
    count: 1
  });
  const blockedDraft = blockedGen.json.drafts[0];

  // Edit it to have overlength text
  await req('POST', `/api/tweet-lab/drafts/${encodeURIComponent(blockedDraft.id)}/edit`, {
    text: 'A'.repeat(290),
    angle: 'Blocked test',
    rationale: '',
    sourceRefs: [],
    warnings: []
  });

  // Try to schedule by draftId without approval → should fail
  const scheduleBlocked = await req('POST', '/api/tweet-lab/schedule', {
    draftId: blockedDraft.id,
    scheduledAt: new Date(Date.now() + 3600000).toISOString(),
    timezone: 'UTC',
    integrationId: 'test-integration'
  });
  // Without POSTIZ_API_KEY, schedule returns 503; but with blocked gate and non-approved draft,
  // the gate check fires first (400). Since the draft isn't approved, we get 400 from the
  // approved-status check before we even reach the gate. Let's verify:
  // The existing code checks draft.status !== 'approved' first → 400.
  // So this tests that path: non-approved draft can't be scheduled.
  assertEqual(scheduleBlocked.status, 400, 'non-approved draft → 400 from schedule');
  assertTrue(
    scheduleBlocked.json.error.includes('approved') || scheduleBlocked.json.error.includes('Review gate'),
    'non-approved draft blocked with clear error'
  );

  console.log('\n--- HTTP: Schedule gate check on direct content ---');

  // Schedule with direct content (no draftId) — overlength content
  // This hits buildPostizPayload which checks > 280 → 400
  const directOverlength = await req('POST', '/api/tweet-lab/schedule', {
    content: 'A'.repeat(290),
    scheduledAt: new Date(Date.now() + 3600000).toISOString(),
    timezone: 'UTC',
    integrationId: 'test-integration'
  });
  assertEqual(directOverlength.status, 503, 'direct overlength-only content reaches Postiz safe-block');
  assertTrue(directOverlength.json?.gate?.checks?.some(c => c.name === 'char-length' && c.level === 'fail'), 'direct overlength response preserves gate warning');

  // Schedule with direct content that has banned phrase but is under 280 chars
  // Without POSTIZ_API_KEY this returns 503, but the gate runs first.
  // Actually: the gate runs before buildPostizPayload and apiKey check.
  // Let's check: content has "as an ai" banned phrase, under 280 chars.
  // The gate will be 'blocked'. Since there's no draftId, explicitlyApproved = false.
  // So the gate blocks with 400.
  const directBanned = await req('POST', '/api/tweet-lab/schedule', {
    content: 'As an AI, I cannot help you.',
    scheduledAt: new Date(Date.now() + 3600000).toISOString(),
    timezone: 'UTC',
    integrationId: 'test-integration'
  });
  assertEqual(directBanned.status, 400, 'direct content with banned phrase → 400 from gate');
  assertTrue(directBanned.json.gate !== undefined, 'blocked schedule response includes gate object');
  assertTrue(
    directBanned.json.error.includes('Review gate blocked'),
    'blocked schedule error mentions "Review gate blocked"'
  );

  console.log('\n--- HTTP: Store persistence of gate fields ---');

  // Verify gate fields survive a GET from the store
  const draftGet = await req('GET', `/api/tweet-lab/store/drafts/${encodeURIComponent(draft.id)}`);
  assertEqual(draftGet.status, 200, 'store GET draft returns 200');
  assertEqual(draftGet.json.id, draft.id, 'store GET returns correct draft');
  assertTrue(draftGet.json.gateStatus !== undefined, 'store GET draft has gateStatus');
  assertTrue(draftGet.json.gateScore !== undefined, 'store GET draft has gateScore');

  console.log('\n--- HTTP: Clean draft gate score ---');

  // Generate a clean draft and verify it scores high
  const cleanEdit = await req('POST', `/api/tweet-lab/drafts/${encodeURIComponent(draft.id)}/edit`, {
    text: 'Most teams stop at the tool. The leverage is in owning the full loop from brief to follow-up.',
    angle: 'Operator loop',
    rationale: 'Core positioning',
    sourceRefs: [],
    warnings: []
  });
  assertEqual(cleanEdit.status, 200, 'clean edit returns 200');
  assertEqual(cleanEdit.json.draft.gateStatus, 'clean', 'clean text → gate clean');
  assertEqual(cleanEdit.json.draft.gateScore, 100, 'clean text → score 100');

  console.log('\n--- HTTP: Review 404 for missing draft ---');

  const missingReview = await req('GET', '/api/tweet-lab/drafts/nonexistent/review');
  assertEqual(missingReview.status, 404, 'review missing draft → 404');
}

async function cleanup() {
  // Clean up any test drafts we created
  try {
    const draftsRes = await req('GET', '/api/tweet-lab/store/drafts');
    if (Array.isArray(draftsRes.json)) {
      for (const d of draftsRes.json) {
        // Only delete drafts from this test run (mock adapter)
        if (d.angle && d.angle.includes('Candidate') || d.angle === 'Blocked test' || d.angle === 'Operator loop') {
          await req('DELETE', `/api/tweet-lab/store/drafts/${encodeURIComponent(d.id)}`);
        }
      }
    }
  } catch { /* best effort */ }
  log('cleanup', 'removed test drafts');
}

async function run() {
  // Run pure unit tests first (no server needed)
  unitTests();

  // Start server for HTTP tests
  await startServer();

  try {
    await httpTests();
    await cleanup();
  } finally {
    await stopServer();
  }

  console.log(`\n${assertionCount} assertions run.`);
  console.log(exitCode === 0 ? 'All checks passed.' : 'Some checks failed.');
  const { setTimeout } = await import('node:timers/promises');
  await setTimeout(100);
  process.exit(exitCode);
}

run().catch(async err => {
  console.error(err);
  await stopServer();
  process.exit(1);
});
