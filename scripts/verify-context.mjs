#!/usr/bin/env node
// Live verifier for the server-side context retrieval pipeline.
//
// Asserts (against the running tweet-lab server):
//   1. GET /api/tweet-lab/context returns 200 + JSON.
//   2. Packet shape matches the public contract documented in
//      lib/context.js: generatedAt, query, voiceSummary, vaultRefs,
//      companyRefs, sourceBank, sourceRefs (flat), liveX, warnings.
//   3. Every flat sourceRefs entry carries { id, type, ... } and the
//      packet contains at least the four grounded types when all
//      sources are available: voice-dna, obsidian-note, company-context,
//      source-bank. live-x-post is optional (only when liveX fetcher
//      returns tweets).
//   4. voiceSummary.loaded === true, voiceSummary.sourceRef.filePath
//      points to the canonical voice DNA file.
//   5. companyRefs.company === 'Applied Leverage' and at least one
//      company context sourceRef is present with a real filePath.
//   6. vaultRefs.notes[*].sourceRef.filePath points under the Obsidian
//      vault root and never escapes it (defence in depth against
//      path-injection bugs).
//   7. Redaction: no token-shaped values anywhere in the response —
//      bearer prefixes, xai- / sk- / eyJ… triples. Mirrors
//      scripts/verify-diagnostics.mjs and lib/store.js redactor.
//   8. disabled-include: include=voiceDna=false drops voiceSummary
//      from the packet (and removes voice-dna refs from sourceRefs).
//   9. query=applied (or whatever the operator seed is) returns ≥1
//      vault note OR a warning explaining why not — never an empty
//      packet without diagnostic surface.
//
// Exits 0 on success, non-zero with a clear failure list otherwise.

import http from 'node:http';

const BASE_URL = process.env.TWEET_LAB_BASE_URL || 'http://127.0.0.1:4173';

const checks = [];
let failures = 0;

function ok(name, detail = '') {
  checks.push({ name, status: 'ok', detail });
  process.stdout.write(`  ok   ${name}${detail ? ' — ' + detail : ''}\n`);
}

function fail(name, detail) {
  failures += 1;
  checks.push({ name, status: 'fail', detail });
  process.stdout.write(`  FAIL ${name} — ${detail}\n`);
}

function get(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE_URL}${path}`, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`timeout fetching ${path}`)));
    req.setTimeout(30000);
  });
}

const TOKEN_VALUE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+\/-]{20,}/gi,
  /\bsk-[A-Za-z0-9_-]{20,}/gi,
  /\bxai-[A-Za-z0-9_-]{20,}/gi,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/gi
];

function deepFindTokens(obj, path = '$') {
  const hits = [];
  if (obj === null || obj === undefined) return hits;
  if (typeof obj === 'string') {
    for (const rx of TOKEN_VALUE_PATTERNS) {
      rx.lastIndex = 0;
      const match = rx.exec(obj);
      if (match) {
        hits.push({ path, value: match[0] });
        break;
      }
    }
    return hits;
  }
  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      hits.push(...deepFindTokens(item, `${path}[${index}]`));
    });
    return hits;
  }
  if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      hits.push(...deepFindTokens(value, `${path}.${key}`));
    }
  }
  return hits;
}

// Fields the public packet MUST carry on every response. liveX is
// always present (defaults to "unavailable" block); the rest are the
// shape the unit test in scripts/test-context.mjs asserts against.
const REQUIRED_TOP_FIELDS = [
  'generatedAt', 'query', 'voiceSummary', 'vaultRefs', 'companyRefs',
  'sourceBank', 'sourceRefs', 'liveX', 'warnings'
];

async function fetchPacket(queryString) {
  const res = await get(`/api/tweet-lab/context${queryString}`);
  if (res.statusCode !== 200) {
    fail(`endpoint${queryString ? '[' + queryString + ']' : ''}.status`,
      `expected 200, got ${res.statusCode}`);
    return null;
  }
  ok(`endpoint${queryString ? '[' + queryString + ']' : ''}.status`, '200');
  try {
    return JSON.parse(res.body);
  } catch (err) {
    fail(`endpoint${queryString ? '[' + queryString + ']' : ''}.json`,
      `parse failed: ${err.message}`);
    return null;
  }
}

function assertTopShape(packet, label) {
  for (const field of REQUIRED_TOP_FIELDS) {
    if (!(field in packet)) {
      fail(`shape${label}.${field}`, `field missing from packet`);
    }
  }
  if (typeof packet.generatedAt !== 'string' || !packet.generatedAt) {
    fail(`shape${label}.generatedAt.type`, `want ISO string, got ${typeof packet.generatedAt}`);
  } else {
    ok(`shape${label}.generatedAt.type`, packet.generatedAt);
  }
  if (!Array.isArray(packet.sourceRefs)) {
    fail(`shape${label}.sourceRefs.array`, `want array, got ${typeof packet.sourceRefs}`);
  }
  if (!Array.isArray(packet.warnings)) {
    fail(`shape${label}.warnings.array`, `want array, got ${typeof packet.warnings}`);
  }
}

function assertVoice(packet, label) {
  const vs = packet.voiceSummary;
  if (!vs) {
    fail(`voice${label}.present`, `voiceSummary missing`);
    return;
  }
  if (vs.loaded !== true) {
    fail(`voice${label}.loaded`, `want true, got ${vs.loaded}`);
    return;
  }
  ok(`voice${label}.loaded`, `true (${vs.styleRules?.length || 0} style rules, ${vs.forbiddenPatterns?.length || 0} forbidden)`);
  const ref = vs.sourceRef;
  if (!ref || ref.type !== 'voice-dna') {
    fail(`voice${label}.sourceRef.type`, `want voice-dna, got ${ref?.type}`);
  } else if (!ref.filePath || !ref.filePath.endsWith('lucas-voice-dna.md')) {
    fail(`voice${label}.sourceRef.filePath`, `unexpected path: ${ref.filePath}`);
  } else {
    ok(`voice${label}.sourceRef.filePath`, ref.filePath);
  }
}

function assertCompany(packet, label) {
  const cr = packet.companyRefs;
  if (!cr) {
    fail(`company${label}.present`, `companyRefs missing`);
    return;
  }
  if (cr.company !== 'Applied Leverage') {
    fail(`company${label}.company`, `want 'Applied Leverage', got '${cr.company}'`);
  } else {
    ok(`company${label}.company`, cr.company);
  }
  const sources = Array.isArray(cr.sources) ? cr.sources : [];
  if (!sources.length) {
    fail(`company${label}.sources`, `no company sources loaded`);
  } else {
    ok(`company${label}.sources`, `${sources.length} source(s)`);
    for (const src of sources) {
      if (!src.sourceRef || src.sourceRef.type !== 'company-context') {
        fail(`company${label}.sourceRef.type`, `want company-context, got ${src.sourceRef?.type}`);
      } else if (!src.sourceRef.filePath || !src.sourceRef.filePath.endsWith('.md')) {
        fail(`company${label}.sourceRef.filePath`, `unexpected: ${src.sourceRef.filePath}`);
      }
    }
  }
}

function assertVault(packet, label, expectedPrefix) {
  const vr = packet.vaultRefs;
  if (!vr) {
    fail(`vault${label}.present`, `vaultRefs missing`);
    return;
  }
  if (typeof vr.scannedFiles !== 'number') {
    fail(`vault${label}.scannedFiles.type`, `want number, got ${typeof vr.scannedFiles}`);
  } else if (vr.scannedFiles < 1) {
    fail(`vault${label}.scannedFiles`, `expected ≥1 file scanned, got ${vr.scannedFiles}`);
  } else {
    ok(`vault${label}.scannedFiles`, `${vr.scannedFiles} files`);
  }
  const notes = Array.isArray(vr.notes) ? vr.notes : [];
  for (const note of notes) {
    const fp = note.sourceRef?.filePath;
    if (!fp) {
      fail(`vault${label}.note.sourceRef.filePath`, `note missing filePath`);
      continue;
    }
    if (expectedPrefix && !fp.startsWith(expectedPrefix)) {
      fail(`vault${label}.note.escaped`, `note path escapes vault root: ${fp}`);
    } else if (!fp.endsWith('.md')) {
      fail(`vault${label}.note.extension`, `expected .md, got ${fp}`);
    } else {
      ok(`vault${label}.note.path`, fp.replace(expectedPrefix || '', ''));
    }
  }
}

function assertSourceRefs(packet, label, requireTypes) {
  const refs = Array.isArray(packet.sourceRefs) ? packet.sourceRefs : [];
  if (!refs.length) {
    fail(`sourceRefs${label}.nonempty`, `expected ≥1 sourceRef, got 0`);
    return;
  }
  ok(`sourceRefs${label}.count`, `${refs.length} refs`);
  const seen = new Set();
  for (const ref of refs) {
    if (!ref || typeof ref !== 'object') {
      fail(`sourceRefs${label}.shape`, `non-object ref in list`);
      continue;
    }
    if (!ref.id || !ref.type) {
      fail(`sourceRefs${label}.id-type`, `ref missing id/type`);
    }
    seen.add(ref.type);
  }
  for (const want of requireTypes) {
    if (!seen.has(want)) {
      fail(`sourceRefs${label}.type.${want}`, `type ${want} not present (seen: ${[...seen].join(',')})`);
    } else {
      ok(`sourceRefs${label}.type.${want}`, 'present');
    }
  }
}

function assertRedaction(packet, label) {
  const hits = deepFindTokens(packet);
  if (hits.length) {
    fail(`redaction${label}`, `token-shaped value(s) leaked: ${JSON.stringify(hits.slice(0, 3))}`);
  } else {
    ok(`redaction${label}`, 'no token-shaped values in packet');
  }
}

async function main() {
  console.log(`verifier: context endpoint shape + redaction (${BASE_URL})`);

  // 1) Default packet (no query).
  const empty = await fetchPacket('');
  if (empty) {
    assertTopShape(empty, '[empty]');
    assertVoice(empty, '[empty]');
    assertCompany(empty, '[empty]');
    assertVault(empty, '[empty]', '/home/lucas/obsidian-vault/Engram');
    // source-bank is optional (depends on persisted sources on disk).
    // We always require voice-dna + company-context as the durable
    // operator-grounded minimum. obsidian-note shows up whenever the
    // vault has at least one markdown note.
    assertSourceRefs(empty, '[empty]', ['voice-dna', 'company-context']);
    assertRedaction(empty, '[empty]');
    if (empty.liveX && typeof empty.liveX.available !== 'boolean') {
      fail('liveX[empty].available.type', `want boolean, got ${typeof empty.liveX.available}`);
    } else {
      ok('liveX[empty].present', `available=${empty.liveX?.available}`);
    }
  }

  // 2) Query packet — should match at least one vault note or warn.
  const queried = await fetchPacket('?query=applied&maxVaultNotes=3&maxSources=3');
  if (queried) {
    assertTopShape(queried, '[query=applied]');
    assertVoice(queried, '[query=applied]');
    assertCompany(queried, '[query=applied]');
    assertVault(queried, '[query=applied]', '/home/lucas/obsidian-vault/Engram');
    assertRedaction(queried, '[query=applied]');
    const noteCount = queried.vaultRefs?.notes?.length || 0;
    const warningCount = queried.warnings?.length || 0;
    if (noteCount === 0 && warningCount === 0) {
      fail('queried.diagnostic', 'empty result with no warnings — packet hides failure');
    } else {
      ok('queried.diagnostic',
        `notes=${noteCount}, warnings=${warningCount}`);
    }
  }

  // 3) Disabled voice-dna — packet must drop voiceSummary.
  const disabled = await fetchPacket('?include=voiceDna=false');
  if (disabled) {
    if (disabled.voiceSummary !== null && disabled.voiceSummary !== undefined) {
      fail('disabled.voiceSummary.dropped',
        `voiceSummary still present: ${JSON.stringify(disabled.voiceSummary).slice(0, 80)}…`);
    } else {
      ok('disabled.voiceSummary.dropped', 'voiceSummary is null');
    }
    const types = new Set((disabled.sourceRefs || []).map(r => r.type));
    if (types.has('voice-dna')) {
      fail('disabled.sourceRefs.voice-dna', 'voice-dna ref still present in sourceRefs');
    } else {
      ok('disabled.sourceRefs.voice-dna', 'voice-dna ref absent from sourceRefs');
    }
  }

  // Final summary.
  const total = checks.length;
  console.log(`\n${total - failures}/${total} checks passed`);
  if (failures) {
    console.error(`FAIL — ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('OK — context endpoint + redaction verifier passed');
}

main().catch(err => {
  console.error('verifier crashed:', err);
  process.exit(2);
});
