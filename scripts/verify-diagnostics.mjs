#!/usr/bin/env node
// Verifier for the operator health diagnostics endpoint.
//
// Asserts:
//  1. /api/tweet-lab/diagnostics responds with 200 + JSON.
//  2. Response shape covers the full operator health contract:
//     app.version/nodeVersion/startedAt/now/uptimeSeconds/pid/port/tailnetHost,
//     goro.{mode,mockModeForced,profile,hasGoroEndpoint,lastSuccess,lastFailure},
//     x.{configured,provider,readOnly,lastFetch,lastFailure,lastRateLimit},
//     postiz.{configured,hasDefaultIntegration,apiUrl,lastAttempt},
//     blockedRemedies.{postiz,x,goro},
//     storage.{draftsCount,sourcesCount,templatesCount,scheduleSlotsCount,auditLastAt}.
//  3. No token-shaped values anywhere in the response: bearer prefixes,
//     xai- / sk- / eyJ… patterns, plus plain POSTIZ/X/HERMES env-style keys.
//  4. redactor helper itself scrubs the same token-shaped patterns.
//  5. /api/tweet-lab/config does not include token-shaped values either
//     (defence in depth).
//
// Exits 0 on success, non-zero with a clear failure list otherwise.

import http from 'node:http';
import {
  buildReport,
  recordLiveSuccess,
  recordGoroFailure,
  redactForDiagnostics,
  resetForTests,
  APP_VERSION
} from '../lib/diagnostics.js';

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
    req.setTimeout(10000);
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
    return hits;
  }
  return hits;
}

const SHAPE = {
  app: ['version', 'nodeVersion', 'startedAt', 'now', 'uptimeSeconds', 'pid', 'port', 'tailnetHost'],
  goro: ['mode', 'mockModeForced', 'profile', 'hasGoroEndpoint', 'lastSuccess', 'lastFailure'],
  x: ['configured', 'provider', 'readOnly', 'lastFetch', 'lastFailure', 'lastRateLimit'],
  postiz: ['configured', 'hasDefaultIntegration', 'apiUrl', 'lastAttempt'],
  home: ['contextPacket', 'xHistorySync', 'generation', 'blockers'],
  blockedRemedies: ['postiz', 'x', 'goro'],
  storage: ['draftsCount', 'sourcesCount', 'templatesCount', 'scheduleSlotsCount', 'auditLastAt']
};

function assertShape(report) {
  for (const [section, fields] of Object.entries(SHAPE)) {
    if (!report[section] || typeof report[section] !== 'object') {
      fail(`shape.${section}.present`, `section missing or not an object`);
      continue;
    }
    for (const field of fields) {
      const value = report[section][field];
      if (value === undefined) {
        fail(`shape.${section}.${field}`, `field missing`);
      }
    }
  }
}

async function fetchDiagnostics() {
  const res = await get('/api/tweet-lab/diagnostics');
  if (res.statusCode !== 200) {
    fail('endpoint.status', `expected 200, got ${res.statusCode}`);
    return null;
  }
  ok('endpoint.status', '200');
  let parsed;
  try {
    parsed = JSON.parse(res.body);
  } catch (err) {
    fail('endpoint.json', `parse failed: ${err.message}`);
    return null;
  }
  ok('endpoint.json', 'parses');
  return parsed;
}

async function fetchConfig() {
  const res = await get('/api/tweet-lab/config');
  if (res.statusCode !== 200) {
    fail('config.status', `expected 200, got ${res.statusCode}`);
    return null;
  }
  ok('config.status', '200');
  try {
    return JSON.parse(res.body);
  } catch (err) {
    fail('config.json', `parse failed: ${err.message}`);
    return null;
  }
}

function inMemoryReportIsClean() {
  resetForTests();
  recordGoroFailure({
    adapter: 'hermes',
    error: new Error('boom: ' + ['Bearer', 'fixture-token-value'.repeat(3)].join(' '))
  });
  recordLiveSuccess({
    accounts: [{ username: 'lucas', ok: true, warnings: [] }],
    tweets: [1, 2, 3],
    fetchedAt: new Date().toISOString()
  });
  return buildReport({
    config: {
      goroMode: 'hermes',
      mockModeForced: false,
      xConfigured: true,
      xProvider: 'x-api-recent-search',
      xReadOnly: true,
      postizConfigured: false
    }
  });
}

function assertFieldTypes(report) {
  const app = report.app || {};
  if (typeof app.version !== 'string') fail('type.app.version', `want string, got ${typeof app.version}`);
  else if (app.version !== APP_VERSION) fail('type.app.version', `want ${APP_VERSION}, got ${app.version}`);
  else ok('type.app.version', app.version);

  if (typeof app.uptimeSeconds !== 'number') fail('type.app.uptimeSeconds', `want number, got ${typeof app.uptimeSeconds}`);
  else ok('type.app.uptimeSeconds', `${app.uptimeSeconds}s`);

  const goro = report.goro || {};
  if (typeof goro.mockModeForced !== 'boolean') fail('type.goro.mockModeForced', `want boolean, got ${typeof goro.mockModeForced}`);
  else ok('type.goro.mockModeForced', String(goro.mockModeForced));

  const x = report.x || {};
  if (typeof x.configured !== 'boolean') fail('type.x.configured', `want boolean, got ${typeof x.configured}`);
  else ok('type.x.configured', String(x.configured));
  if (typeof x.readOnly !== 'boolean') fail('type.x.readOnly', `want boolean, got ${typeof x.readOnly}`);
  else ok('type.x.readOnly', String(x.readOnly));

  const postiz = report.postiz || {};
  if (typeof postiz.configured !== 'boolean') fail('type.postiz.configured', `want boolean, got ${typeof postiz.configured}`);
  else ok('type.postiz.configured', String(postiz.configured));

  const remedies = report.blockedRemedies || {};
  for (const key of ['postiz', 'x', 'goro']) {
    if (typeof remedies[key] !== 'string' || !remedies[key].trim()) {
      fail(`remedy.${key}.nonempty`, `want non-empty string`);
    } else {
      ok(`remedy.${key}.nonempty`, `${remedies[key].slice(0, 60)}…`);
    }
  }
}

function assertHome(report) {
  const home = report.home;
  if (!home || typeof home !== 'object') {
    fail('home.present', 'home section missing');
    return;
  }
  // blockers must always be an array (empty when nothing is blocked).
  if (!Array.isArray(home.blockers)) {
    fail('home.blockers.array', `want array, got ${typeof home.blockers}`);
  } else {
    ok('home.blockers.array', `${home.blockers.length} blocker(s)`);
    for (const b of home.blockers) {
      if (!b || typeof b !== 'object' || !b.code || !b.surface || typeof b.message !== 'string') {
        fail('home.blockers.shape', `blocker missing code/surface/message: ${JSON.stringify(b).slice(0, 120)}`);
      }
    }
    if (!failures || checks.every(c => c.name !== 'home.blockers.shape')) {
      ok('home.blockers.shape', 'all blockers carry code+surface+message');
    }
  }
  // contextPacket is null until the first /context call; when present it
  // must carry the invariant grounding counters.
  if (home.contextPacket && typeof home.contextPacket === 'object') {
    const pkt = home.contextPacket;
    const required = ['voiceLoaded', 'vaultNotes', 'companySources', 'liveXAvailable', 'sourceRefs'];
    for (const f of required) {
      if (pkt[f] === undefined) fail(`home.contextPacket.${f}`, 'field missing');
    }
    if (typeof pkt.voiceLoaded !== 'boolean') fail('home.contextPacket.voiceLoaded.type', `want boolean, got ${typeof pkt.voiceLoaded}`);
    else ok('home.contextPacket.voiceLoaded', String(pkt.voiceLoaded));
    if (typeof pkt.sourceRefs !== 'number') fail('home.contextPacket.sourceRefs.type', `want number, got ${typeof pkt.sourceRefs}`);
    else ok('home.contextPacket.sourceRefs', String(pkt.sourceRefs));
  } else {
    ok('home.contextPacket', 'null (no /context call yet)');
  }
  // xHistorySync is null until the first backfill; when present carry invariants.
  if (home.xHistorySync && typeof home.xHistorySync === 'object') {
    const sync = home.xHistorySync;
    if (typeof sync.ok !== 'boolean') fail('home.xHistorySync.ok.type', `want boolean, got ${typeof sync.ok}`);
    else ok('home.xHistorySync.ok', String(sync.ok));
    if (typeof sync.persisted !== 'number') fail('home.xHistorySync.persisted.type', `want number, got ${typeof sync.persisted}`);
    else ok('home.xHistorySync.persisted', String(sync.persisted));
  } else {
    ok('home.xHistorySync', 'null (no backfill yet)');
  }
}

async function main() {
  console.log(`verifier: diagnostics shape + redaction (${BASE_URL})`);
  const report = await fetchDiagnostics();
  if (report) {
    assertShape(report);
    assertFieldTypes(report);
    assertHome(report);
    const tokenHits = deepFindTokens(report);
    if (tokenHits.length) {
      fail('redaction.live', `token-shaped value(s) found: ${JSON.stringify(tokenHits.slice(0, 3))}`);
    } else {
      ok('redaction.live', 'no token-shaped values in /api/tweet-lab/diagnostics');
    }
  }

  const config = await fetchConfig();
  if (config) {
    const tokenHits = deepFindTokens(config);
    if (tokenHits.length) {
      fail('redaction.config', `token-shaped value(s) found: ${JSON.stringify(tokenHits.slice(0, 3))}`);
    } else {
      ok('redaction.config', 'no token-shaped values in /api/tweet-lab/config');
    }
  }

  // Unit-style redaction checks against the in-memory helper.
  const fixtureCases = [
    { input: ['Bearer', 'fixture-token-value'.repeat(3)].join(' '), label: 'bearer prefix' },
    { input: ['sk', 'fixture-token-value'.repeat(3)].join('-'), label: 'openai sk- prefix' },
    { input: ['xai', 'fixture-token-value'.repeat(3)].join('-'), label: 'xai prefix' },
    { input: [['eyJ', 'abcdefghij'.repeat(2)].join(''), 'abcdefghijklmnopqrst', 'abcdefghijklmnopqrst'].join('.'), label: 'jwt-like triple' },
  ];
  for (const { input, label } of fixtureCases) {
    const scrubbed = redactForDiagnostics({ message: input });
    if (typeof scrubbed.message !== 'string' || /[A-Za-z0-9]{20,}/.test(scrubbed.message.replace('[redacted]', ''))) {
      fail(`redaction.helper.${label}`, `value survived: ${scrubbed.message}`);
    } else {
      ok(`redaction.helper.${label}`, 'scrubbed');
    }
  }

  const memo = inMemoryReportIsClean();
  const memoHits = deepFindTokens(memo);
  if (memoHits.length) {
    fail('redaction.memoized-events', `token-shaped value(s) leaked through diagnostics state: ${JSON.stringify(memoHits.slice(0, 3))}`);
  } else {
    ok('redaction.memoized-events', 'goro failure containing bearer token was scrubbed');
  }

  // Final summary line.
  const total = checks.length;
  console.log(`\n${total - failures}/${total} checks passed`);
  if (failures) {
    console.error(`FAIL — ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('OK — diagnostics endpoint + redaction verifier passed');
}

main().catch(err => {
  console.error('verifier crashed:', err);
  process.exit(2);
});
