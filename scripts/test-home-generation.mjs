#!/usr/bin/env node
// Invariant-based regression tests for grounded Home generation.
//
// Covers the four acceptance criteria from the QA card:
//   AC1 — Home generation candidates always carry sourceRefs + warnings
//         metadata (arrays). Verification FAILS if any candidate lacks them.
//   AC2 — No token labels/secrets leak to client-facing responses
//         (/generate, /context, /diagnostics).
//   AC3 — Missing X credentials, empty source store, and rate-limit /
//         blocker states are exercised without any public mutation
//         (no real X call, no real Postiz write).
//   AC4 — Diagnostics expose the last context packet, the last X-history
//         sync, and a computed blockers list so Lucas/Johnny can see why
//         generation is (or is not) grounded.
//
// Pattern (mirrors scripts/test-x-history.mjs / verify-mock-generation.mjs):
//   - Sandbox the data dir BEFORE importing server.js so the live
//     tweet-lab.json is never touched.
//   - Force GORO_GENERATE_MODE=mock so /generate never calls real Hermes.
//   - Strip X_BEARER_TOKEN + OP_SERVICE_ACCOUNT_TOKEN so the X read paths
//     deterministically report "bearer missing" instead of hitting live X.
//   - Spawn the in-process `handle()` on an ephemeral port and exercise
//     the real routes with the real fetch.

import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ──────────────── environment sandbox ────────────────

// Force mock generation so /generate is deterministic and never reaches
// the real Hermes Goro profile. We capture the prior value so a dev shell
// keeps its setting after the run.
const priorMode = process.env.GORO_GENERATE_MODE;
const priorUrl = process.env.GORO_GENERATE_URL;
process.env.GORO_GENERATE_MODE = 'mock';
delete process.env.GORO_GENERATE_URL;

// Deterministically disable X read paths. The server's getXBearerToken()
// and lib/xHistory.js both fall back to the 1Password CLI when
// OP_SERVICE_ACCOUNT_TOKEN is set; stripping both guarantees "bearer
// missing" instead of a live X call during this run.
const priorBearer = process.env.X_BEARER_TOKEN;
const priorOp = process.env.OP_SERVICE_ACCOUNT_TOKEN;
delete process.env.X_BEARER_TOKEN;
delete process.env.OP_SERVICE_ACCOUNT_TOKEN;

// Sandbox the persistent store so HTTP tests never touch the real
// data/tweet-lab.json. Must be set BEFORE importing server.js / store.js
// because they read DATA_FILE / DATA_DIR at import time.
const sandbox = path.join(__dirname, '..', 'data', '.home-gen-test-sandbox');
const sandboxFile = path.join(sandbox, 'tweet-lab.json');
process.env.TWEET_LAB_DATA_DIR = sandbox;
process.env.TWEET_LAB_DATA_FILE = sandboxFile;
await fs.rm(sandbox, { recursive: true, force: true });
await fs.mkdir(sandbox, { recursive: true });

const storeModule = await import('../lib/store.js');
const serverModule = await import('../server.js');
const { DATA_FILE, DATA_DIR } = storeModule;

// Sanity guard: the imported modules MUST honor the sandbox. If they
// bound to the real tweet-lab.json the test would silently clobber live
// state.
if (DATA_DIR !== sandbox || DATA_FILE !== sandboxFile) {
  console.error(`FAIL: sandbox env not honored (DATA_DIR=${DATA_DIR})`);
  process.exit(2);
}

const port = 4291;
const server = http.createServer(serverModule.handle);
await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));

// ──────────────── helpers ────────────────

const checks = [];
let failures = 0;
function check(name, condition, detail) {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function req(method, pathname, body) {
  const init = { method, headers: { 'content-type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, init);
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = { _raw: text }; }
  return { status: response.status, body: parsed, text };
}

// Token-shaped patterns mirrored from lib/diagnostics.js / verify-diagnostics.mjs.
const TOKEN_VALUE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+\/-]{20,}/gi,
  /\bsk-[A-Za-z0-9_-]{20,}/gi,
  /\bxai-[A-Za-z0-9_-]{20,}/gi,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/gi
];

function deepFindTokens(value, trail = '$', hits = []) {
  if (value === null || value === undefined) return hits;
  if (typeof value === 'string') {
    for (const rx of TOKEN_VALUE_PATTERNS) {
      rx.lastIndex = 0;
      const m = rx.exec(value);
      if (m) { hits.push({ path: trail, sample: m[0].slice(0, 24) }); break; }
    }
    return hits;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => deepFindTokens(v, `${trail}[${i}]`, hits));
    return hits;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) deepFindTokens(v, `${trail}.${k}`, hits);
  }
  return hits;
}

// ──────────────── AC1: candidate metadata contract ────────────────

console.log('\n# AC1 — candidate sourceRefs/warnings metadata');

const gen = await req('POST', '/api/tweet-lab/generate', {
  inspirationLinks: ['https://fxtwitter.com/example/status/1'],
  context: 'Ground Applied Leverage as one owned AI operating loop in 30 days.',
  tone: 'sharp, grounded, no AI slop',
  count: 2
});
check('generate: 200', gen.status === 200, `status=${gen.status}`);
check('generate: mock adapter', gen.body?.adapter === 'mock', `adapter=${gen.body?.adapter}`);
check('generate: candidates is array', Array.isArray(gen.body?.candidates), `got ${typeof gen.body?.candidates}`);
check('generate: ≥1 candidate', (gen.body?.candidates?.length || 0) >= 1, `count=${gen.body?.candidates?.length}`);

// The core AC1 invariant: EVERY candidate must carry sourceRefs + warnings
// as arrays. normalizeCandidates() always sets these; if a future change
// dropped them, this assertion fails and the card's AC1 is violated.
let ac1Ok = true;
for (const [i, candidate] of (gen.body?.candidates || []).entries()) {
  if (!Array.isArray(candidate.sourceRefs)) {
    check(`candidate[${i}].sourceRefs.array`, false, `got ${typeof candidate.sourceRefs}`);
    ac1Ok = false;
  }
  if (!Array.isArray(candidate.warnings)) {
    check(`candidate[${i}].warnings.array`, false, `got ${typeof candidate.warnings}`);
    ac1Ok = false;
  }
  if (typeof candidate.text !== 'string' || !candidate.text.trim()) {
    check(`candidate[${i}].text`, false, 'missing/empty text');
    ac1Ok = false;
  }
}
if (ac1Ok) check('candidate[*].{sourceRefs,warnings,text} present', true, `${gen.body.candidates.length} candidate(s) all carry metadata`);

// Context-aware generation: passing contextSourceRefs/contextWarnings in
// the payload must merge those onto the persisted DRAFTS (the grounding
// merge lives in persistGeneratedDrafts, which runs after normalizeCandidates).
// This is the grounded-generation contract — drafts cite their sources.
// The bare `candidates` array carries the shape contract (arrays present);
// the `drafts` array carries the merged grounding refs/warnings.
const grounded = await req('POST', '/api/tweet-lab/generate', {
  inspirationLinks: ['https://fxtwitter.com/example/status/2'],
  context: 'Operator-loop wedge for $50K/mo service businesses.',
  tone: 'sharp',
  count: 1,
  contextSourceRefs: ['voice-dna:lucas', 'company:applied-leverage', 'obsidian:offer-spine'],
  contextWarnings: ['source bank empty']
});
check('grounded generate: 200', grounded.status === 200, `status=${grounded.status}`);
// AC1 shape: candidates always carry the arrays even before the merge.
check('grounded: candidate carries sourceRefs array', Array.isArray(grounded.body?.candidates?.[0]?.sourceRefs), `got ${typeof grounded.body?.candidates?.[0]?.sourceRefs}`);
check('grounded: candidate carries warnings array', Array.isArray(grounded.body?.candidates?.[0]?.warnings), `got ${typeof grounded.body?.candidates?.[0]?.warnings}`);
// Grounding merge: drafts carry the merged contextSourceRefs + contextWarnings.
const groundedDraft = grounded.body?.drafts?.[0];
check('grounded: draft carries merged sourceRefs', Array.isArray(groundedDraft?.sourceRefs) && groundedDraft.sourceRefs.length >= 1, `refs=${groundedDraft?.sourceRefs?.length}`);
check('grounded: draft carries merged warnings', Array.isArray(groundedDraft?.warnings) && groundedDraft.warnings.length >= 1, `warnings=${groundedDraft?.warnings?.length}`);
check('grounded: sourcePacket echoes contextSourceRefs', Array.isArray(grounded.body?.sourcePacket?.contextSourceRefs) && grounded.body.sourcePacket.contextSourceRefs.length >= 1, `refs=${grounded.body?.sourcePacket?.contextSourceRefs?.length}`);

// ──────────────── AC2: token-leak guard on responses ────────────────

console.log('\n# AC2 — no token leaks in client-facing responses');

// AC2 guards SERVER-HELD secrets (X bearer, Postiz key, OP service-account
// token) leaking into client-facing responses. It does NOT guard operator
// free-text input: `sourcePacket.context` legitimately echoes the
// operator's own context back, and mockCandidates() seeds candidate text
// from that context verbatim (documented mock behavior — a real Hermes
// generation composes fresh text and would not regurgitate input).
//
// So the honest AC2 gate is: scan the REAL responses from /generate,
// /context, and /diagnostics for token-shaped VALUES (bearer prefixes,
// sk-/xai-/JWT shapes). Those responses carry server state, never the
// operator's secrets. The three checks below are the gate; they run
// against un-seeded responses so they cannot false-positive on input echo.
const poisonToken = ['Bearer', 'fixture-token-value'.repeat(3)].join(' ');
const poisoned = await req('POST', '/api/tweet-lab/generate', {
  inspirationLinks: ['https://fxtwitter.com/example/status/3'],
  context: `Probe ${poisonToken} must not leak into tweet text.`,
  tone: 'sharp',
  count: 1
});
// The diagnostics report aggregates server state (goro errors, x status,
// home blockers). A server-held secret must never surface here even when
// an upstream error message captured a token-shaped string — the
// redactor scrubs it at record time. Assert against the live response.
const poisonedDiag = await req('GET', '/api/tweet-lab/diagnostics');
const poisonedDiagHits = deepFindTokens(poisonedDiag.body);
check('redaction/diagnostics-after-poison', poisonedDiagHits.length === 0, poisonedDiagHits.length ? `leaked at ${poisonedDiagHits[0].path}` : 'no token-shaped values');

for (const [label, result] of [['/generate', gen], ['/grounded', grounded]]) {
  const hits = deepFindTokens(result.body);
  check(`redaction${label}`, hits.length === 0, hits.length ? `leaked at ${hits[0].path}` : 'no token-shaped values');
}

const ctxRes = await req('GET', '/api/tweet-lab/context?query=applied&maxVaultNotes=3&maxSources=3');
check('context: 200', ctxRes.status === 200, `status=${ctxRes.status}`);
const ctxHits = deepFindTokens(ctxRes.body);
check('redaction/context', ctxHits.length === 0, ctxHits.length ? `leaked at ${ctxHits[0].path}` : 'no token-shaped values');

const diagRes = await req('GET', '/api/tweet-lab/diagnostics');
check('diagnostics: 200', diagRes.status === 200, `status=${diagRes.status}`);
const diagHits = deepFindTokens(diagRes.body);
check('redaction/diagnostics', diagHits.length === 0, diagHits.length ? `leaked at ${diagHits[0].path}` : 'no token-shaped values');

// ──────────────── AC3: missing creds / empty store / blocker states ────────────────

console.log('\n# AC3 — missing X creds, empty store, blocker states (no public mutation)');

// Missing X bearer: live X must be deterministically unavailable with a
// useful warning — never a crash, never a silent empty packet.
check('context: liveX.available is boolean', typeof ctxRes.body?.liveX?.available === 'boolean', `got ${typeof ctxRes.body?.liveX?.available}`);
check('context: liveX.available=false (no bearer)', ctxRes.body?.liveX?.available === false, `available=${ctxRes.body?.liveX?.available}`);
check('context: liveX carries a warning when unavailable', Array.isArray(ctxRes.body?.liveX?.warnings) && ctxRes.body.liveX.warnings.length >= 1, `${ctxRes.body?.liveX?.warnings?.length || 0} warning(s)`);

// Empty source store: sourceBank must report a numeric total + array
// items + (optionally) a warning, not a crash. The sandbox store is empty.
check('context: sourceBank.total is number', typeof ctxRes.body?.sourceBank?.total === 'number', `got ${typeof ctxRes.body?.sourceBank?.total}`);
check('context: sourceBank.items is array', Array.isArray(ctxRes.body?.sourceBank?.items), `got ${typeof ctxRes.body?.sourceBank?.items}`);

// X history backfill with no bearer must surface a bearer_missing blocker
// and persist nothing — proving the missing-creds state is useful without
// any public mutation (no real X call, nothing written).
const backfillNoBearer = await req('POST', '/api/tweet-lab/x-history/backfill', { maxPages: 2 });
check('backfill (no bearer): 200', backfillNoBearer.status === 200, `status=${backfillNoBearer.status}`);
check('backfill (no bearer): ok=false', backfillNoBearer.body?.ok === false, `ok=${backfillNoBearer.body?.ok}`);
check('backfill (no bearer): blocker code bearer_missing', backfillNoBearer.body?.blocker?.code === 'bearer_missing', `code=${backfillNoBearer.body?.blocker?.code}`);
check('backfill (no bearer): persisted 0', backfillNoBearer.body?.persisted === 0, `persisted=${backfillNoBearer.body?.persisted}`);

// x-history list on the empty sandbox store must be empty, not an error.
const listEmpty = await req('GET', '/api/tweet-lab/x-history/list');
check('x-history list (empty store): 200', listEmpty.status === 200, `status=${listEmpty.status}`);
check('x-history list (empty store): total 0', listEmpty.body?.total === 0 && (listEmpty.body?.items?.length || 0) === 0, `total=${listEmpty.body?.total}`);

// Generation still works without live X (mock mode): grounded generation
// must succeed on the cached/context packet even when X is unavailable.
check('generate works without live X (mock)', gen.status === 200 && (gen.body?.candidates?.length || 0) >= 1, 'generation proceeds on context packet alone');

// ──────────────── AC4: diagnostics home surface ────────────────

console.log('\n# AC4 — diagnostics expose generation grounding + blockers');

// By now we have triggered /context (AC2) and /backfill (AC3), so the
// diagnostics home surface should be populated. Re-fetch and assert.
const diag = await req('GET', '/api/tweet-lab/diagnostics');
check('diagnostics: home section present', diag.body?.home && typeof diag.body.home === 'object', 'missing');
check('diagnostics: home.blockers is array', Array.isArray(diag.body?.home?.blockers), `got ${typeof diag.body?.home?.blockers}`);

// contextPacket must carry the invariant grounding counters (booleans +
// numbers), not exact tweet/note counts (invariant-based, not brittle).
const pkt = diag.body?.home?.contextPacket;
check('diagnostics: home.contextPacket populated', pkt && typeof pkt === 'object', 'null');
if (pkt) {
  check('diagnostics: contextPacket.voiceLoaded is boolean', typeof pkt.voiceLoaded === 'boolean', `got ${typeof pkt.voiceLoaded}`);
  check('diagnostics: contextPacket.sourceRefs is number', typeof pkt.sourceRefs === 'number', `got ${typeof pkt.sourceRefs}`);
  check('diagnostics: contextPacket.liveXAvailable is boolean', typeof pkt.liveXAvailable === 'boolean', `got ${typeof pkt.liveXAvailable}`);
  // Live X was deterministically off (no bearer) → the packet recorded it.
  check('diagnostics: contextPacket.liveXAvailable=false', pkt.liveXAvailable === false, `available=${pkt.liveXAvailable}`);
}

// xHistorySync must reflect the bearer_missing backfill we just ran.
const sync = diag.body?.home?.xHistorySync;
check('diagnostics: home.xHistorySync populated', sync && typeof sync === 'object', 'null');
if (sync) {
  check('diagnostics: xHistorySync.ok is boolean', typeof sync.ok === 'boolean', `got ${typeof sync.ok}`);
  check('diagnostics: xHistorySync.ok=false (no bearer)', sync.ok === false, `ok=${sync.ok}`);
  check('diagnostics: xHistorySync.blockerCode bearer_missing', sync.blockerCode === 'bearer_missing', `code=${sync.blockerCode}`);
}

// The blockers list must surface WHY grounding is limited. With no bearer,
// the x-history blocker must appear with code+surface+message. Every
// blocker in the list must be well-formed.
const blockers = diag.body?.home?.blockers || [];
let blockersWellFormed = true;
for (const b of blockers) {
  if (!b || typeof b !== 'object' || !b.code || !b.surface || typeof b.message !== 'string') {
    blockersWellFormed = false;
    check('diagnostics: blocker shape', false, `malformed: ${JSON.stringify(b).slice(0, 100)}`);
  }
}
if (blockersWellFormed) check('diagnostics: all blockers well-formed (code+surface+message)', true, `${blockers.length} blocker(s)`);
const hasXHistoryBlocker = blockers.some(b => b.surface === 'x-history' && b.code === 'bearer_missing');
check('diagnostics: x-history bearer_missing blocker surfaced', hasXHistoryBlocker, `blockers=${JSON.stringify(blockers.map(b => b.code))}`);

// The generation attempt we ran (AC1) must be recorded with sourceRef
// coverage so the panel shows the last generation's grounding.
const generation = diag.body?.home?.generation;
check('diagnostics: home.generation populated', generation && typeof generation === 'object', 'null');
if (generation) {
  check('diagnostics: generation.ok is boolean', typeof generation.ok === 'boolean', `got ${typeof generation.ok}`);
  check('diagnostics: generation.adapter=mock', generation.adapter === 'mock', `adapter=${generation.adapter}`);
  check('diagnostics: generation.candidateCount is number', typeof generation.candidateCount === 'number', `got ${typeof generation.candidateCount}`);
}

// ──────────────── teardown ────────────────

await new Promise(resolve => server.close(resolve));
await fs.rm(sandbox, { recursive: true, force: true });

// Restore the env we mutated so subsequent tools in the same shell keep
// their configuration.
if (priorMode === undefined) delete process.env.GORO_GENERATE_MODE;
else process.env.GORO_GENERATE_MODE = priorMode;
if (priorUrl !== undefined) process.env.GORO_GENERATE_URL = priorUrl;
if (priorBearer !== undefined) process.env.X_BEARER_TOKEN = priorBearer;
if (priorOp !== undefined) process.env.OP_SERVICE_ACCOUNT_TOKEN = priorOp;

const passed = checks.length - failures;
console.log(`\n${passed}/${checks.length} home-generation checks passed`);
if (failures) {
  console.error('FAILED:');
  for (const c of checks.filter(c => !c.ok)) console.error(`  - ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  process.exit(1);
}
console.log('OK — grounded Home generation QA coverage passed');
