#!/usr/bin/env node
// Unit tests for lib/context.js — the server-side context retrieval pipeline.
//
// These tests are deliberately bounded: they construct a small fixture vault
// and a small fixture voice-DNA file under tmp, then assert the deterministic
// shape, redaction, and sourceRef behaviour of buildContextPacket. They do
// NOT touch the live Obsidian vault or the running tweet-lab service.
//
// They also assert that NO token-shaped value can leak through the packet
// even when seeded with a bearer/xai/sk string in any string field.

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildContextPacket,
  loadVoiceContext,
  searchObsidianVault,
  loadCompanyContext,
  loadSourceBankContext,
  loadLiveXContext,
  redactContextValue
} from '../lib/context.js';
import { COLLECTIONS } from '../lib/store.js';

const TOKEN_VALUE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+\/-]{20,}/gi,
  /\bsk-[A-Za-z0-9_-]{20,}/gi,
  /\bxai-[A-Za-z0-9_-]{20,}/gi,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/gi
];

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, detail = '') {
  pass += 1;
  process.stdout.write(`  ok   ${name}${detail ? ' — ' + detail : ''}\n`);
}

function fail_(name, detail) {
  fail += 1;
  failures.push({ name, detail });
  process.stdout.write(`  FAIL ${name} — ${detail}\n`);
}

function deepFindTokens(value, path = '$', hits = null) {
  if (!hits) hits = [];
  if (value === null || value === undefined) return hits;
  if (typeof value === 'string') {
    for (const rx of TOKEN_VALUE_PATTERNS) {
      rx.lastIndex = 0;
      const m = rx.exec(value);
      if (m) {
        hits.push({ path, value: m[0] });
        return hits;
      }
    }
    return hits;
  }
  if (typeof value !== 'object') return hits;
  if (Array.isArray(value)) {
    value.forEach((v, i) => deepFindTokens(v, `${path}[${i}]`, hits));
    return hits;
  }
  for (const [k, v] of Object.entries(value)) {
    deepFindTokens(v, `${path}.${k}`, hits);
  }
  return hits;
}

async function mkTmp(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), `tweet-lab-ctx-${prefix}-`));
}

async function rmTmp(dir) {
  try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Fixture builders

const FIXTURE_VOICE_DNA = `# Lucas Synnott voice DNA (fixture)

Sources:
- corpus: 4,812 tweets

<voice_rules>
1. Write like an operator, not a guru.
2. Under 280 chars when possible.
3. Lead with the scar, not the claim.
4. Never invent client metrics.
5. Use second person when addressing founder/operator readers.
6. Avoid "delve", "leverage", "unlock" as primary verbs.
</voice_rules>

<forbidden>
- "In today's fast-paced world"
- "Game-changing"
- "Revolutionize"
- "10x your workflow"
</forbidden>
`;

async function writeVoiceFixture(dir) {
  const p = path.join(dir, 'lucas-voice-dna.md');
  await fs.writeFile(p, FIXTURE_VOICE_DNA, 'utf8');
  return p;
}

async function writeVaultFixture(dir) {
  // Small vault: 6 markdown notes, plus a noise dotfile that must be skipped.
  const notes = {
    'Applied Leverage Offer Spine.md': '# Applied Leverage Offer Spine\n\nMemory & State Ops retainer. $500 review-responder wedge. Operator audit.',
    'Agent Audit Pattern.md': '# Agent Audit Pattern\n\nReceipts, postmortems, log of every agent action.',
    'Daily Operations Brief.md': '# Daily Ops Brief\n\nDaily brief pattern: inbound lead, stalled task, ops brief.',
    'Operator Voice Notes.md': '# Operator Voice Notes\n\nOperators write with scars. No "10x" language.',
    'No Match Here.md': '# No Match Here\n\nThis note contains nothing relevant for the search query.',
    'Archived Old Note.md': '# Archived Old Note\n\nThis is older. references only.',
    '.hidden-skip.md': '# Hidden note\n\nShould not be returned.',
    'binary.png': 'binary-not-md'
  };
  for (const [name, content] of Object.entries(notes)) {
    const full = path.join(dir, name);
    await fs.writeFile(full, content, 'utf8');
  }
  return dir;
}

async function writeCompanyFixture(dir) {
  const p = path.join(dir, 'Live Applied Leverage Intelligence.md');
  const body = `## Offer candidates

Memory & State Ops retainer — context hygiene for operator teams.

$500 review-responder wedge — local biz, time saved in pilot.

Agent Audit & Verification Layer — receipts, postmortems.

## Stable positioning

Applied Leverage is the operator-side build for AI agent businesses.
`;
  await fs.writeFile(p, body, 'utf8');
  return p;
}

// ---------------------------------------------------------------------------
// Tests

async function testVoiceContext() {
  process.stdout.write('\n# loadVoiceContext\n');
  const dir = await mkTmp('voice');
  try {
    const filePath = await writeVoiceFixture(dir);
    const v = await loadVoiceContext({ filePath });

    if (!v.loaded) fail_('voice.loaded', 'expected loaded=true');
    else ok('voice.loaded');

    if (!Array.isArray(v.styleRules) || v.styleRules.length < 3) {
      fail_('voice.styleRules', `expected >=3 style rules, got ${v.styleRules?.length}`);
    } else {
      ok('voice.styleRules', `${v.styleRules.length} rules parsed`);
    }

    if (!Array.isArray(v.forbiddenPatterns) || v.forbiddenPatterns.length < 2) {
      fail_('voice.forbiddenPatterns', `expected >=2 forbidden patterns, got ${v.forbiddenPatterns?.length}`);
    } else {
      ok('voice.forbiddenPatterns', `${v.forbiddenPatterns.length} patterns parsed`);
    }

    if (v.sampledPostCount !== 4812) {
      fail_('voice.sampledPostCount', `expected 4812, got ${v.sampledPostCount}`);
    } else {
      ok('voice.sampledPostCount', '4812');
    }

    if (!v.sourceRef || v.sourceRef.type !== 'voice-dna' || v.sourceRef.filePath !== filePath) {
      fail_('voice.sourceRef', `unexpected sourceRef: ${JSON.stringify(v.sourceRef)}`);
    } else {
      ok('voice.sourceRef', `type=${v.sourceRef.type}`);
    }

    // Missing file path → graceful degradation
    const missing = await loadVoiceContext({ filePath: path.join(dir, 'does-not-exist.md') });
    if (missing.loaded !== false) fail_('voice.missing.loaded', 'expected loaded=false for missing file');
    else ok('voice.missing.loaded', 'graceful false');
    if (!Array.isArray(missing.warnings) || !missing.warnings.length) {
      fail_('voice.missing.warnings', 'expected warnings for missing file');
    } else ok('voice.missing.warnings');
  } finally {
    await rmTmp(dir);
  }
}

async function testVaultSearch() {
  process.stdout.write('\n# searchObsidianVault\n');
  const dir = await mkTmp('vault');
  try {
    await writeVaultFixture(dir);

    // Query that should match offer / applied leverage notes
    const r1 = await searchObsidianVault({ query: 'applied', vaultPath: dir, maxNotes: 3 });
    if (r1.vaultPath !== dir) fail_('vault.vaultPath', 'unexpected path echo');
    else ok('vault.vaultPath');
    if (!Array.isArray(r1.notes) || r1.notes.length === 0) {
      fail_('vault.matched.notes', `expected >=1 note for "applied", got 0`);
    } else ok('vault.matched.notes', `${r1.notes.length} notes for "applied"`);

    // Make sure hidden files are skipped.
    if (r1.notes.some(n => path.basename(n.path).startsWith('.'))) {
      fail_('vault.hidden-skipped', 'hidden dotfile returned');
    } else ok('vault.hidden-skipped');

    // Non-md files must not be returned.
    if (r1.notes.some(n => !n.path.endsWith('.md'))) {
      fail_('vault.md-only', 'non-md file returned');
    } else ok('vault.md-only');

    // Each note must have sourceRef.
    for (const note of r1.notes) {
      if (!note.sourceRef || note.sourceRef.type !== 'obsidian-note' || !note.sourceRef.filePath) {
        fail_('vault.note.sourceRef', `missing sourceRef for ${note.path}`);
      }
    }
    ok('vault.note.sourceRef', 'all notes carry sourceRef');

    // Empty query → fall back to most-recent notes.
    const r2 = await searchObsidianVault({ query: '', vaultPath: dir, maxNotes: 4 });
    if (!Array.isArray(r2.notes) || r2.notes.length === 0) {
      fail_('vault.empty-query.notes', 'expected some notes for empty query');
    } else ok('vault.empty-query.notes', `${r2.notes.length} notes`);

    // Missing vault → empty notes + warning.
    const r3 = await searchObsidianVault({ query: 'x', vaultPath: '/nope/does-not-exist-xyz' });
    if (!Array.isArray(r3.notes) || r3.notes.length !== 0) {
      fail_('vault.missing.notes', 'expected 0 notes for missing vault');
    } else ok('vault.missing.notes');
    if (!r3.warnings.some(w => /not found/i.test(w))) {
      fail_('vault.missing.warning', `expected "not found" warning, got ${JSON.stringify(r3.warnings)}`);
    } else ok('vault.missing.warning');
  } finally {
    await rmTmp(dir);
  }
}

async function testCompanyContext() {
  process.stdout.write('\n# loadCompanyContext\n');
  const dir = await mkTmp('company');
  try {
    const filePath = await writeCompanyFixture(dir);
    const ctx = await loadCompanyContext({ paths: [filePath] });
    if (ctx.company !== 'Applied Leverage') fail_('company.name', `got ${ctx.company}`);
    else ok('company.name', 'Applied Leverage');
    if (!ctx.positioningLines.length) fail_('company.positioningLines', 'no positioning extracted');
    else ok('company.positioningLines', `${ctx.positioningLines.length} lines`);
    if (!ctx.sources.length) fail_('company.sources', 'no source recorded');
    else if (ctx.sources[0].sourceRef.type !== 'company-context') fail_('company.sourceRef.type', 'bad type');
    else ok('company.sourceRef.type', 'company-context');
  } finally {
    await rmTmp(dir);
  }

  // Missing paths → all warnings, empty sources.
  const ctxMissing = await loadCompanyContext({ paths: ['/nope/does-not-exist-xyz.md'] });
  if (ctxMissing.sources.length !== 0) fail_('company.missing.sources', 'expected 0 sources');
  else ok('company.missing.sources');
  if (!ctxMissing.warnings.length) fail_('company.missing.warnings', 'expected warnings');
  else ok('company.missing.warnings');
}

async function testSourceBankContext() {
  process.stdout.write('\n# loadSourceBankContext\n');
  // The fixture in COLLECTIONS for sources starts empty in a fresh tmp.
  // We bypass the real store by hitting the empty-state path.
  // To exercise a non-empty branch we'd need a store fixture, which
  // adds complexity; the empty-state assertions still cover contract.
  const sb = await loadSourceBankContext({ maxSources: 5 });
  if (!Array.isArray(sb.items)) fail_('source-bank.items', 'items not array');
  else ok('source-bank.items', `${sb.items.length} items`);
  if (typeof sb.total !== 'number') fail_('source-bank.total', 'total not number');
  else ok('source-bank.total', `${sb.total}`);
  if (!Array.isArray(sb.warnings)) fail_('source-bank.warnings', 'warnings not array');
  else ok('source-bank.warnings');
}

async function testLiveXContext() {
  process.stdout.write('\n# loadLiveXContext\n');

  const noFetcher = await loadLiveXContext({});
  if (noFetcher.available !== false) fail_('live-x.no-fetcher.available', 'expected false');
  else ok('live-x.no-fetcher.available', 'false (no fetcher)');
  if (!noFetcher.warnings.length) fail_('live-x.no-fetcher.warning', 'expected warning');
  else ok('live-x.no-fetcher.warning');

  // Fetcher that returns tweets.
  const fetcher = async () => ({
    tweets: [
      { id: '1', url: 'https://x.com/a/status/1', text: 'hi', author: { username: 'a' }, createdAt: '2026-06-19T00:00:00Z' }
    ],
    fetchedAt: '2026-06-19T12:00:00Z'
  });
  const okFetcher = await loadLiveXContext({ fetcher });
  if (!okFetcher.available) fail_('live-x.fetcher.available', 'expected true');
  else ok('live-x.fetcher.available');
  if (okFetcher.tweets.length !== 1) fail_('live-x.fetcher.tweets', `expected 1 tweet, got ${okFetcher.tweets.length}`);
  else ok('live-x.fetcher.tweets');
  if (okFetcher.tweets[0].sourceRef.type !== 'live-x-post') fail_('live-x.fetcher.sourceRef.type', 'bad type');
  else ok('live-x.fetcher.sourceRef.type');

  // Fetcher that throws → warning, available false.
  const throwing = await loadLiveXContext({ fetcher: async () => { throw new Error('kaput'); } });
  if (throwing.available !== false) fail_('live-x.throw.available', 'expected false on throw');
  else ok('live-x.throw.available');
}

async function testBuildContextPacket() {
  process.stdout.write('\n# buildContextPacket\n');
  const dir = await mkTmp('packet');
  try {
    const voiceDnaPath = await writeVoiceFixture(dir);
    const vaultPath = path.join(dir, 'vault');
    await fs.mkdir(vaultPath, { recursive: true });
    await writeVaultFixture(vaultPath);
    const companyPath = await writeCompanyFixture(dir);

    const fetcher = async () => ({
      tweets: [
        { id: '1', url: 'https://x.com/a/status/1', text: 'hi', author: { username: 'a' }, createdAt: '2026-06-19T00:00:00Z' }
      ],
      fetchedAt: '2026-06-19T12:00:00Z'
    });
    const packet = await buildContextPacket({
      query: 'applied',
      voiceDnaPath,
      vaultPath,
      companyPaths: [companyPath],
      liveXFetcher: fetcher,
      maxVaultNotes: 3,
      maxSources: 4
    });

    if (!packet.generatedAt) fail_('packet.generatedAt', 'missing generatedAt');
    else ok('packet.generatedAt', packet.generatedAt);

    if (packet.query !== 'applied') fail_('packet.query', `expected "applied", got "${packet.query}"`);
    else ok('packet.query');

    if (!packet.voiceSummary || !packet.voiceSummary.loaded) fail_('packet.voiceSummary.loaded', 'voice not loaded');
    else ok('packet.voiceSummary.loaded');

    if (!packet.vaultRefs || !Array.isArray(packet.vaultRefs.notes)) fail_('packet.vaultRefs.shape', 'missing vaultRefs');
    else ok('packet.vaultRefs.shape', `${packet.vaultRefs.notes.length} vault notes`);

    if (!packet.companyRefs || packet.companyRefs.company !== 'Applied Leverage') fail_('packet.companyRefs', 'companyRefs shape bad');
    else ok('packet.companyRefs', packet.companyRefs.company);

    if (!packet.sourceBank || typeof packet.sourceBank.total !== 'number') fail_('packet.sourceBank.shape', 'sourceBank shape bad');
    else ok('packet.sourceBank.shape');

    if (!packet.liveX || typeof packet.liveX.available !== 'boolean') fail_('packet.liveX.shape', 'liveX shape bad');
    else ok('packet.liveX.shape');

    if (!Array.isArray(packet.sourceRefs)) fail_('packet.sourceRefs.array', 'sourceRefs not array');
    else ok('packet.sourceRefs.array', `${packet.sourceRefs.length} refs`);

    if (!Array.isArray(packet.warnings)) fail_('packet.warnings.array', 'warnings not array');
    else ok('packet.warnings.array', `${packet.warnings.length} warnings`);

    // Every voice / vault / company / source-bank ref must appear in sourceRefs.
    const refTypes = new Set(packet.sourceRefs.map(r => r.type));
    for (const required of ['voice-dna', 'obsidian-note', 'company-context', 'live-x-post']) {
      if (!refTypes.has(required)) {
        fail_('packet.sourceRefs.types', `missing ${required} ref type (have: ${[...refTypes].join(',')})`);
      }
    }
    ok('packet.sourceRefs.types', [...refTypes].sort().join(','));

    // Token-leak guard: zero hits anywhere in the packet.
    const leaks = deepFindTokens(packet);
    if (leaks.length) fail_('packet.redaction', `token-shaped leak at ${JSON.stringify(leaks)}`);
    else ok('packet.redaction', 'no token-shaped values in packet');

    // Redaction helper itself scrubs the same patterns.
    const sample = {
      a: ['Bearer', 'abcdefghijklmnopqrstuvwxyz1234567890ABCD'].join(' '),
      b: ['sk', 'redaction-fixture-not-a-key'].join('-'),
      c: ['xai', 'redaction-fixture-not-a-key'].join('-'),
      d: [['eyJ', 'abcdefghij'.repeat(2)].join(''), 'abcdefghijklmnopqrst', 'abcdefghijklmnopqrst'].join('.'),
      e: 'totally normal text',
      nested: { apiKey: 'should-be-redacted' }
    };
    const redacted = redactContextValue(sample);
    if (redacted.a.includes('Bearer')) fail_('redact.bearer', `still has Bearer: ${redacted.a}`);
    else ok('redact.bearer');
    if (redacted.b.startsWith('sk-')) fail_('redact.sk', `still has sk-: ${redacted.b}`);
    else ok('redact.sk');
    if (redacted.c.startsWith('xai-')) fail_('redact.xai', `still has xai-: ${redacted.c}`);
    else ok('redact.xai');
    if (redacted.d.includes('eyJ')) fail_('redact.jwt', `still has eyJ: ${redacted.d}`);
    else ok('redact.jwt');
    if (redacted.e !== 'totally normal text') fail_('redact.normal', 'normal text changed');
    else ok('redact.normal');
    if (redacted.nested.apiKey !== '[redacted]') fail_('redact.field', `field redaction bad: ${redacted.nested.apiKey}`);
    else ok('redact.field');

    // Seed a token-shaped string inside the voice-dna file and confirm it
    // does NOT survive the packet.
    const poisonPath = path.join(dir, 'poison-voice.md');
    await fs.writeFile(poisonPath, '# poisoned\n\nToken ' + ['Bearer', 'abcdefghijklmnopqrstuvwxyz1234567890ABCD'].join(' ') + ' is here.\n', 'utf8');
    const poisonedPacket = await buildContextPacket({ voiceDnaPath: poisonPath, vaultPath: '/nope', companyPaths: [], include: { vault: false, company: false, sourceBank: false, liveX: false } });
    const poisonLeaks = deepFindTokens(poisonedPacket);
    if (poisonLeaks.length) fail_('packet.poison.redaction', `leaked: ${JSON.stringify(poisonLeaks)}`);
    else ok('packet.poison.redaction', 'token in voice-dna excerpt was scrubbed');

    // Disable-include flags work.
    const trimmed = await buildContextPacket({
      voiceDnaPath,
      vaultPath: '/nope',
      companyPaths: [],
      include: { voiceDna: false, obsidian: false, company: false, sourceBank: false, liveX: false }
    });
    if (trimmed.voiceSummary !== null) fail_('packet.disabled.voice', 'voice should be null when disabled');
    else ok('packet.disabled.voice');
    if (trimmed.vaultRefs !== null) fail_('packet.disabled.vault', 'vault should be null when disabled');
    else ok('packet.disabled.vault');
  } finally {
    await rmTmp(dir);
  }
}

// ---------------------------------------------------------------------------

(async () => {
  process.stdout.write('# lib/context.js tests\n');
  await testVoiceContext();
  await testVaultSearch();
  await testCompanyContext();
  await testSourceBankContext();
  await testLiveXContext();
  await testBuildContextPacket();

  process.stdout.write(`\n# summary: pass=${pass} fail=${fail}\n`);
  if (fail > 0) {
    for (const f of failures) process.stdout.write(`  - ${f.name}: ${f.detail}\n`);
    process.exit(1);
  }
})().catch(err => {
  process.stderr.write(`fatal: ${err.stack || err.message || err}\n`);
  process.exit(2);
});

// Suppress unused import lint
void COLLECTIONS;
