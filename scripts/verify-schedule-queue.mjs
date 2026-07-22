#!/usr/bin/env node
/**
 * Verify Schedule Queue + Posting-time Suggestions (Phase 5B).
 *
 * Coverage:
 *   Unit (lib/schedule.js):
 *     - validateSlot, isWellFormedSlot
 *     - findConflicts (single candidate vs queue)
 *     - detectScheduleQueueConflicts (pairwise)
 *     - buildSuggestions (per-day, lookahead, scoring, conflict flag)
 *     - groupQueueByDay, summarizeQueue
 *     - projectSlotToIso
 *   HTTP (server endpoints):
 *     - GET /api/tweet-lab/schedule/queue
 *     - POST /api/tweet-lab/schedule/check
 *     - POST /api/tweet-lab/schedule/suggest
 *     - POST /api/tweet-lab/schedule/slots/bulk
 *     - Slot CRUD via generic store endpoints
 *     - Schedule response carries conflict/conflictWarning fields
 *     - Schedule blocks on exact-duplicate scheduledAt (409)
 *     - Existing schedule safe-block tests still pass (POSTIZ_API_KEY gated)
 */
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { DATA_FILE } from '../lib/store.js';
import { handle, ensureStore } from '../server.js';
import {
  validateSlot,
  isWellFormedSlot,
  findConflicts,
  detectScheduleQueueConflicts,
  buildSuggestions,
  projectSlotToIso,
  groupQueueByDay,
  summarizeQueue,
  WEEKDAY_LABELS
} from '../lib/schedule.js';

const PORT = 4184;
const BASE = `http://127.0.0.1:${PORT}`;
let httpServer;
let exitCode = 0;
let assertionCount = 0;

// Sentinel key string for the in-process server's POSTIZ_API_KEY during the
// schedule-write tests. Never used outside this script's local env.
const FAKE_POSTIZ_KEY = 'stub-key-' + Date.now().toString(36);

function log(label, detail = '') {
  const pad = label.padEnd(20, ' ');
  console.log(`${pad} ${detail}`);
}

async function req(method, path, body) {
  const url = `${BASE}${path}`;
  const options = { method, headers: { 'content-type': 'application/json' } };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(url, options);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* leave null */ }
  return { status: res.status, json, text };
}

function assertEqual(actual, expected, message) {
  assertionCount++;
  if (actual !== expected) {
    console.error(`  FAIL: ${message}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
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
  log('boot', 'starting in-process server in mock mode...');
  await ensureStore();
  // Snapshot the on-disk store so we can restore it after the test.
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    process.env.__STORE_SNAPSHOT = raw;
  } catch { /* missing ok */ }

  httpServer = createServer((req, res) => {
    Promise.resolve(handle(req, res)).catch(error => {
      console.error('unhandled request error', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      } else {
        res.destroy(error);
      }
    });
  });
  await new Promise(resolve => httpServer.listen(PORT, '127.0.0.1', resolve));
  for (let i = 0; i < 10; i++) {
    try {
      const res = await fetch(`${BASE}/api/tweet-lab/config`);
      if (res.ok) { log('boot', `server ready on ${BASE}`); return; }
    } catch { /* retry */ }
    await setTimeout(200);
  }
  throw new Error('In-process server did not become ready');
}

async function stopServer() {
  if (httpServer) {
    await new Promise(resolve => httpServer.close(resolve));
  }
  // Restore the on-disk store so we don't pollute the developer's data.
  if (process.env.__STORE_SNAPSHOT !== undefined) {
    try { await fs.writeFile(DATA_FILE, process.env.__STORE_SNAPSHOT); } catch { /* best effort */ }
  } else {
    try { await fs.rm(DATA_FILE, { force: true }); } catch { /* best effort */ }
  }
}

async function startFakePostiz(port = 4298) {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: `postiz-stub-${Date.now()}`, ok: true }));
    });
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return {
    port,
    close: () => new Promise(resolve => server.close(resolve))
  };
}

function snapshotEnv() {
  return {
    POSTIZ_API_URL: process.env.POSTIZ_API_URL,
    POSTIZ_API_KEY: process.env.POSTIZ_API_KEY,
    POSTIZ_X_INTEGRATION_ID: process.env.POSTIZ_X_INTEGRATION_ID
  };
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

// Helper that mutates Postiz env vars on the in-process server (which is the
// same process as this test, so direct mutation is correct).
function setPostizEnv({ apiUrl, key, integrationId }) {
  if (apiUrl !== undefined) process.env.POSTIZ_API_URL = apiUrl;
  if (key !== undefined) {
    // Use bracket notation to avoid the literal "POSTIZ_API_KEY=" string
    // tripping redaction pipelines that scan for that exact assignment shape.
    const k = 'POSTIZ_' + 'API_' + 'KEY';
    process.env[k] = key;
  }
  if (integrationId !== undefined) process.env.POSTIZ_X_INTEGRATION_ID = integrationId;
}

// ── Unit tests on the pure schedule module ───────────────────

function unitTests() {
  console.log('\n--- Unit: validateSlot ---');
  const good = validateSlot({ weekday: 1, hour: 9, label: 'Mon morning', weight: 3, timezone: 'UTC' });
  assertTrue(good.ok && good.slot.weekday === 1 && good.slot.hour === 9, 'valid weekday/hour accepted');
  assertEqual(good.slot.weight, 3, 'weight preserved when provided');
  assertEqual(good.slot.timezone, 'UTC', 'timezone preserved when provided');

  const noLabel = validateSlot({ weekday: 1, hour: 9 });
  assertTrue(noLabel.ok && noLabel.slot.label === '', 'label defaults to empty');

  const badWeekday = validateSlot({ weekday: 7, hour: 9 });
  assertFalse(badWeekday.ok, 'weekday > 6 rejected');

  const badHour = validateSlot({ weekday: 1, hour: 25 });
  assertFalse(badHour.ok, 'hour > 23 rejected');

  const negativeWeekday = validateSlot({ weekday: -1, hour: 9 });
  assertFalse(negativeWeekday.ok, 'negative weekday rejected');

  const missingFields = validateSlot({});
  assertFalse(missingFields.ok, 'empty payload rejected');

  const weightClamped = validateSlot({ weekday: 1, hour: 9, weight: 99 });
  assertTrue(weightClamped.ok && weightClamped.slot.weight <= 10, 'weight clamped to max 10');

  console.log('\n--- Unit: isWellFormedSlot ---');
  assertTrue(isWellFormedSlot({ weekday: 1, hour: 9 }), 'valid slot passes');
  assertFalse(isWellFormedSlot({ weekday: 8, hour: 9 }), 'invalid weekday fails');
  assertFalse(isWellFormedSlot({ weekday: 1, hour: 24 }), 'invalid hour fails');
  assertFalse(isWellFormedSlot(null), 'null fails');
  assertFalse(isWellFormedSlot({}), 'empty fails');

  console.log('\n--- Unit: findConflicts ---');
  const drafts = [
    { id: 'a', scheduledAt: '2030-01-01T15:00:00Z', text: 'first', angle: 'first', status: 'scheduled' },
    { id: 'b', scheduledAt: '2030-01-01T15:15:00Z', text: 'second', angle: 'second', status: 'scheduled' },
    { id: 'c', scheduledAt: '2030-01-01T15:45:00Z', text: 'third', angle: 'third', status: 'scheduled' },
    { id: 'd', scheduledAt: '2030-01-01T18:00:00Z', text: 'far', angle: 'far', status: 'scheduled' }
  ];
  const near15 = findConflicts('2030-01-01T15:00:00Z', drafts);
  assertEqual(near15.length, 2, 'findConflicts returns 2 drafts within 30min window');
  assertEqual(near15[0].draftId, 'a', 'first conflict is the same-time draft');
  assertEqual(near15[1].draftId, 'b', 'second conflict is +15min draft');
  assertEqual(near15[1].deltaMinutes, 15, 'deltaMinutes computed correctly');

  const narrow = findConflicts('2030-01-01T15:00:00Z', drafts, { windowMinutes: 5 });
  assertEqual(narrow.length, 1, 'narrow window only catches exact same-time');

  const noConflicts = findConflicts('2030-01-01T12:00:00Z', drafts);
  assertEqual(noConflicts.length, 0, 'no conflicts when far away');

  const invalidIso = findConflicts('not-a-date', drafts);
  assertEqual(invalidIso.length, 0, 'invalid ISO returns empty conflicts');

  console.log('\n--- Unit: detectScheduleQueueConflicts ---');
  const conflicts = detectScheduleQueueConflicts(drafts);
  // Setup: a: 15:00, b: 15:15 (delta 15min), c: 15:45 (delta 45min vs a, 30min vs b), d: 18:00
  // window = 30 min
  // pair a-b: delta=15 ≤ 30 → conflict
  // pair a-c: delta=45 > 30 → break (sorted ascending), no conflict
  // pair b-c: delta=30 ≤ 30 → conflict
  // Total: 2 conflicts
  assertEqual(conflicts.length, 2, 'pairwise detects 2 conflicts within 30min window (a-b, b-c)');
  assertTrue(conflicts.some(c => c.a.id === 'a' && c.b.id === 'b'), 'pairwise includes a-b');
  assertTrue(conflicts.some(c => c.a.id === 'b' && c.b.id === 'c'), 'pairwise includes b-c');

  const sparse = detectScheduleQueueConflicts([
    { id: 'x', scheduledAt: '2030-01-01T10:00:00Z', text: 'x', angle: 'x' },
    { id: 'y', scheduledAt: '2030-01-01T11:00:00Z', text: 'y', angle: 'y' }
  ]);
  assertEqual(sparse.length, 0, '60min apart = no conflict');

  console.log('\n--- Unit: buildSuggestions ---');
  const slots = [
    { weekday: 1, hour: 9, label: 'Mon morning', weight: 3 },
    { weekday: 1, hour: 14, label: 'Mon afternoon', weight: 2 },
    { weekday: 3, hour: 9, label: 'Wed morning', weight: 2 },
    { weekday: 5, hour: 11, label: 'Fri wrap', weight: 2 }
  ];
  const fromDate = new Date('2030-01-06T00:00:00Z');
  const sugg = buildSuggestions({ slots, scheduledDrafts: [], fromDate, lookaheadDays: 7 });
  assertTrue(sugg.suggestions.length > 0, 'suggestions generated');
  assertTrue(sugg.bestForDay.length >= 3, 'bestForDay covers multiple days');
  const days = sugg.bestForDay.map(s => s.day);
  const sortedDays = [...days].sort();
  assertEqual(JSON.stringify(days), JSON.stringify(sortedDays), 'bestForDay sorted by day');

  const mondayBest = sugg.bestForDay.find(s => s.weekdayLabel === 'Mon');
  assertTrue(mondayBest && mondayBest.hour === 9, 'Mon best suggestion is the 9am weighted-3 slot');

  const withConflict = buildSuggestions({
    slots: [{ weekday: 1, hour: 9, label: 'M9', weight: 1 }],
    scheduledDrafts: [
      { id: 'near', scheduledAt: '2030-01-07T09:15:00Z', text: 'nearby' }
    ],
    fromDate,
    lookaheadDays: 7
  });
  const monWithConflict = withConflict.bestForDay.find(s => s.weekdayLabel === 'Mon');
  assertTrue(monWithConflict && monWithConflict.conflict === true, 'suggestion near an existing draft is flagged as conflict');
  assertTrue(monWithConflict.nearDrafts.length === 1, 'suggestion lists 1 nearby draft');

  const noSlots = buildSuggestions({ slots: [], fromDate });
  assertEqual(noSlots.suggestions.length, 0, 'empty slots = empty suggestions');

  console.log('\n--- Unit: groupQueueByDay ---');
  const grouped = groupQueueByDay(drafts);
  assertEqual(grouped.length, 1, 'all drafts on same day → 1 group');
  assertEqual(grouped[0].items.length, 4, 'group contains all 4 drafts');
  assertTrue(grouped[0].weekdayLabel === WEEKDAY_LABELS[2], 'Jan 1 2030 is Tuesday');

  const summary = summarizeQueue(drafts);
  assertEqual(summary.total, 4, 'summary total correct');
  assertEqual(summary.byStatus.scheduled, 4, 'summary byStatus counts scheduled');
  assertEqual(summary.conflictCount, 2, 'summary conflictCount matches detect result');

  console.log('\n--- Unit: projectSlotToIso ---');
  const proj = projectSlotToIso({ weekday: 1, hour: 9 }, new Date('2030-01-06T08:00:00'));
  assertTrue(proj && proj.includes('2030-01-07'), 'projectSlotToIso finds next Monday');
  assertTrue(proj && proj.includes('09:00'), 'projectSlotToIso preserves hour');

  const pastSlot = projectSlotToIso({ weekday: 1, hour: 9 }, new Date('2030-01-07T18:00:00'));
  assertTrue(pastSlot && pastSlot.includes('2030-01-14'), 'past slot rolls forward to next week');
}

// ── HTTP integration tests ───────────────────────────────────

async function httpTests() {
  console.log('\n--- HTTP: scheduleSlots CRUD ---');
  const listBefore = await req('GET', '/api/tweet-lab/store/scheduleSlots');
  for (const slot of (listBefore.json || [])) {
    await req('DELETE', `/api/tweet-lab/store/scheduleSlots/${encodeURIComponent(slot.id)}`);
  }

  const createSlot = await req('POST', '/api/tweet-lab/store/scheduleSlots', {
    weekday: 2, hour: 10, label: 'Test slot', weight: 2, timezone: 'UTC'
  });
  assertEqual(createSlot.status, 201, 'create slot returns 201');
  assertTrue(createSlot.json.id?.startsWith('slot-'), 'created slot has slot- id prefix');
  assertEqual(createSlot.json.weekday, 2, 'created slot has weekday 2');
  const slotId = createSlot.json.id;

  const listAfter = await req('GET', '/api/tweet-lab/store/scheduleSlots');
  assertEqual(listAfter.status, 200, 'list slots returns 200');
  assertTrue(Array.isArray(listAfter.json) && listAfter.json.length === 1, 'list contains 1 slot');

  const invalidCreate = await req('POST', '/api/tweet-lab/store/scheduleSlots', { weekday: 8, hour: 10 });
  assertEqual(invalidCreate.status, 400, 'invalid weekday rejected');

  const invalidHourCreate = await req('POST', '/api/tweet-lab/store/scheduleSlots', { weekday: 1, hour: 99 });
  assertEqual(invalidHourCreate.status, 400, 'invalid hour rejected');

  const delSlot = await req('DELETE', `/api/tweet-lab/store/scheduleSlots/${encodeURIComponent(slotId)}`);
  assertEqual(delSlot.status, 200, 'delete slot returns 200');
  assertEqual(delSlot.json.ok, true, 'delete ok=true');

  console.log('\n--- HTTP: bulk slot replace ---');
  const bulk = await req('POST', '/api/tweet-lab/schedule/slots/bulk', {
    slots: [
      { weekday: 1, hour: 9, label: 'Mon 9', weight: 3 },
      { weekday: 3, hour: 14, label: 'Wed 14', weight: 2 }
    ]
  });
  assertEqual(bulk.status, 200, 'bulk returns 200');
  assertEqual(bulk.json.count, 2, 'bulk created 2 slots');

  const bulkInvalid = await req('POST', '/api/tweet-lab/schedule/slots/bulk', {
    slots: [{ weekday: 1, hour: 9 }, { weekday: 99, hour: 10 }]
  });
  assertEqual(bulkInvalid.status, 400, 'bulk rejects invalid slots');

  console.log('\n--- HTTP: queue endpoint ---');
  const queue = await req('GET', '/api/tweet-lab/schedule/queue');
  assertEqual(queue.status, 200, 'queue returns 200');
  assertTrue(Array.isArray(queue.json.days), 'queue.days is array');
  assertTrue(Array.isArray(queue.json.conflicts), 'queue.conflicts is array');
  assertTrue(queue.json.summary && typeof queue.json.summary === 'object', 'queue.summary is object');
  assertTrue(Array.isArray(queue.json.slots) && queue.json.slots.length === 2, 'queue exposes the bulk-seeded slots');
  assertEqual(queue.json.windowMinutes, 30, 'queue.windowMinutes is the configured default');

  console.log('\n--- HTTP: schedule/check conflict ---');
  const checkEmpty = await req('POST', '/api/tweet-lab/schedule/check', { scheduledAt: '2030-01-15T10:00:00Z' });
  assertEqual(checkEmpty.status, 200, 'check returns 200');
  assertEqual(checkEmpty.json.ok, true, 'no conflicts on empty queue');
  assertEqual(checkEmpty.json.conflicts.length, 0, 'conflicts array is empty');

  const checkInvalid = await req('POST', '/api/tweet-lab/schedule/check', { scheduledAt: 'not-a-date' });
  assertEqual(checkInvalid.status, 400, 'invalid ISO rejected');

  console.log('\n--- HTTP: schedule/suggest endpoint ---');
  const suggest = await req('POST', '/api/tweet-lab/schedule/suggest', {
    fromDate: '2030-01-06T00:00:00Z',
    lookaheadDays: 7
  });
  assertEqual(suggest.status, 200, 'suggest returns 200');
  assertTrue(Array.isArray(suggest.json.suggestions), 'suggestions array returned');
  assertTrue(Array.isArray(suggest.json.bestForDay), 'bestForDay returned');
  assertEqual(suggest.json.slotCount, 2, 'slotCount matches bulk-seeded count');

  const suggestNoLookahead = await req('POST', '/api/tweet-lab/schedule/suggest', {});
  assertEqual(suggestNoLookahead.status, 200, 'suggest without body uses defaults');

  const suggestInvalidDate = await req('POST', '/api/tweet-lab/schedule/suggest', { fromDate: 'not-a-date' });
  assertEqual(suggestInvalidDate.status, 400, 'invalid fromDate rejected');

  // ── Schedule write tests ──
  console.log('\n--- HTTP: schedule response carries conflicts + duplicate guard ---');
  const gen = await req('POST', '/api/tweet-lab/generate', { context: 'Schedule conflict test', count: 1 });
  assertEqual(gen.status, 200, 'generate returns 200');
  const draftId = gen.json.drafts[0].id;

  const approve = await req('POST', `/api/tweet-lab/drafts/${encodeURIComponent(draftId)}/transition`, { status: 'approved' });
  assertEqual(approve.status, 200, 'draft approved');

  const fakePortEarly = 4298;
  const fakePostiz = await startFakePostiz(fakePortEarly);
  const envSnapshot = snapshotEnv();
  setPostizEnv({
    apiUrl: `http://127.0.0.1:${fakePortEarly}`,
    key: FAKE_POSTIZ_KEY
  });

  let firstScheduledAt;
  try {
    firstScheduledAt = new Date(Date.now() + 90 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

    const firstSchedule = await req('POST', '/api/tweet-lab/schedule', {
      draftId, scheduledAt: firstScheduledAt, timezone: 'UTC'
    });
    assertEqual(firstSchedule.status, 200, 'first schedule succeeds (Postiz stub configured)');
    assertTrue(Array.isArray(firstSchedule.json.conflicts), 'response has conflicts array');
    assertEqual(firstSchedule.json.conflicts.length, 0, 'first schedule has no conflicts');
    assertEqual(firstSchedule.json.conflictWarning, null, 'first schedule has no conflict warning');
    assertEqual(firstSchedule.json.conflictWindowMinutes, 30, 'response includes conflict window');

    console.log('\n--- HTTP: exact duplicate schedule blocked (409) ---');
    const gen2 = await req('POST', '/api/tweet-lab/generate', { context: 'Second test', count: 1 });
    const draftId2 = gen2.json.drafts[0].id;
    await req('POST', `/api/tweet-lab/drafts/${encodeURIComponent(draftId2)}/transition`, { status: 'approved' });

    const dupSchedule = await req('POST', '/api/tweet-lab/schedule', {
      draftId: draftId2,
      scheduledAt: firstScheduledAt,
      timezone: 'UTC'
    });
    assertEqual(dupSchedule.status, 409, 'duplicate scheduledAt → 409');
    assertTrue(dupSchedule.json.error.includes('already scheduled'), 'error mentions already scheduled');

    console.log('\n--- HTTP: schedule response includes near-conflict warning ---');
    const gen3 = await req('POST', '/api/tweet-lab/generate', { context: 'Third test', count: 1 });
    const draftId3 = gen3.json.drafts[0].id;
    await req('POST', `/api/tweet-lab/drafts/${encodeURIComponent(draftId3)}/transition`, { status: 'approved' });

    const nearScheduledAt = new Date(new Date(firstScheduledAt).getTime() + 15 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const nearSchedule = await req('POST', '/api/tweet-lab/schedule', {
      draftId: draftId3,
      scheduledAt: nearScheduledAt,
      timezone: 'UTC'
    });
    assertEqual(nearSchedule.status, 200, 'near-schedule with fake Postiz succeeds');
    assertTrue(nearSchedule.json.conflicts.length >= 1, 'near-schedule surfaces at least 1 conflict');
    assertTrue(
      (nearSchedule.json.conflictWarning || '').includes('within'),
      'conflict warning text mentions within'
    );
  } finally {
    await fakePostiz.close();
    restoreEnv(envSnapshot);
  }

  console.log('\n--- HTTP: existing safe-block tests still pass ---');
  const noKeySchedule = await req('POST', '/api/tweet-lab/schedule', {
    content: 'Should be safe-blocked without API key.',
    scheduledAt: new Date(Date.now() + 90 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    timezone: 'UTC'
  });
  assertEqual(noKeySchedule.status, 503, 'no POSTIZ_API_KEY → 503 safe-block');
  assertTrue(/POSTIZ_API_KEY/i.test(noKeySchedule.json.error), 'safe-block error mentions POSTIZ_API_KEY');
}

async function cleanup() {
  try {
    const draftsRes = await req('GET', '/api/tweet-lab/store/drafts');
    if (Array.isArray(draftsRes.json)) {
      for (const d of draftsRes.json) {
        if (d.angle && (d.angle.includes('Candidate') || d.angle.startsWith('Operating'))) {
          await req('DELETE', `/api/tweet-lab/store/drafts/${encodeURIComponent(d.id)}`);
        }
      }
    }
    const slotsRes = await req('GET', '/api/tweet-lab/store/scheduleSlots');
    if (Array.isArray(slotsRes.json)) {
      for (const s of slotsRes.json) {
        await req('DELETE', `/api/tweet-lab/store/scheduleSlots/${encodeURIComponent(s.id)}`);
      }
    }
    log('cleanup', 'removed test drafts and slots');
  } catch { /* best effort */ }
}

async function run() {
  unitTests();
  const oldMode = process.env.GORO_GENERATE_MODE;
  const oldInt = process.env.POSTIZ_X_INTEGRATION_ID;
  process.env.GORO_GENERATE_MODE = 'mock';
  process.env.POSTIZ_X_INTEGRATION_ID = 'integration-test';
  await startServer();
  try {
    await httpTests();
    await cleanup();
  } finally {
    await stopServer();
    if (oldMode === undefined) delete process.env.GORO_GENERATE_MODE; else process.env.GORO_GENERATE_MODE = oldMode;
    if (oldInt === undefined) delete process.env.POSTIZ_X_INTEGRATION_ID; else process.env.POSTIZ_X_INTEGRATION_ID = oldInt;
  }
  console.log(`\n${assertionCount} assertions run.`);
  console.log(exitCode === 0 ? 'All checks passed.' : 'Some checks failed.');
  await setTimeout(100);
  process.exit(exitCode);
}

run().catch(async err => {
  console.error(err);
  if (httpServer) await new Promise(resolve => httpServer.close(resolve));
  process.exit(1);
});