// Tests for lib/xHistory.js and the /api/tweet-lab/x-history/* routes.
//
// The lib is exercised by stubbing global `fetch` so the assertions
// verify pagination, blocker reporting, and rate-limit caching without
// depending on the live X API.
//
// The HTTP routes are exercised by spawning the in-process `handle()`
// (same pattern as test-store.mjs) against a sandboxed data file so the
// live tweet-lab.json is never touched.

import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Top-level imports cover the X history lib only. The store + server are
// imported dynamically below, AFTER the sandbox env is in place — they
// read DATA_FILE / DATA_DIR at import time and would otherwise bind to
// the real tweet-lab.json.
import {
  fetchXHistoryPageOnce,
  backfillXHistory,
  getXHistoryStatus,
  getCachedStatus,
  resolveLucasHandle,
  X_HISTORY_PROVIDER,
  X_HISTORY_INFO,
  resetXHistoryForTests,
  _xHistoryInternals
} from '../lib/xHistory.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const checks = [];
const check = (name, condition, detail) => {
  checks.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// The test runs against the real X bearer only via installFetchMock. We
// hard-strip OP_SERVICE_ACCOUNT_TOKEN and X_BEARER_TOKEN from the env so
// the lib's 1Password fallback path can't accidentally reach live X
// during a "no bearer" test. The original values are restored at the
// end of the run so subsequent tools in the same shell still work.
const originalFetch = globalThis.fetch;
const originalEnv = {
  X_BEARER_TOKEN: process.env.X_BEARER_TOKEN,
  OP_SERVICE_ACCOUNT_TOKEN: process.env.OP_SERVICE_ACCOUNT_TOKEN,
  TWEET_LAB_LUCAS_HANDLE: process.env.TWEET_LAB_LUCAS_HANDLE
};
delete process.env.OP_SERVICE_ACCOUNT_TOKEN;
delete process.env.X_BEARER_TOKEN;

function setBearer(value) {
  if (value) {
    process.env.X_BEARER_TOKEN = value;
  } else {
    delete process.env.X_BEARER_TOKEN;
    // The lib's fallback path reads the bearer from 1Password when
    // X_BEARER_TOKEN is missing. For deterministic "no bearer" tests we
    // also have to clear OP_SERVICE_ACCOUNT_TOKEN; otherwise the
    // 1Password CLI will hand back the real token and the test would
    // accidentally hit live X.
    delete process.env.OP_SERVICE_ACCOUNT_TOKEN;
  }
}

function makeTweet(id, text, createdAt, metrics = {}) {
  return {
    id,
    text,
    created_at: createdAt,
    author_id: '1108194208295337984',
    public_metrics: {
      like_count: metrics.like ?? 0,
      retweet_count: metrics.repost ?? 0,
      reply_count: metrics.reply ?? 0,
      quote_count: metrics.quote ?? 0,
      impression_count: metrics.impression ?? 0
    },
    lang: 'en'
  };
}

function makeXResponse({ tweets = [], nextToken = null, oldestId = null, newestId = null, users = [] } = {}) {
  return {
    data: tweets,
    includes: { users, media: [] },
    meta: {
      result_count: tweets.length,
      oldest_id: oldestId,
      newest_id: newestId,
      next_token: nextToken
    }
  };
}

function makeRateLimitHeaders({ limit = 300, remaining = 299, resetSec = Math.floor(Date.now() / 1000) + 900 } = {}) {
  return {
    'x-rate-limit-limit': String(limit),
    'x-rate-limit-remaining': String(remaining),
    'x-rate-limit-reset': String(resetSec)
  };
}

let fetchCalls = [];

function installFetchMock(handler) {
  fetchCalls = [];
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), method: init?.method || 'GET', headers: init?.headers || {} });
    return handler(url, init);
  };
}

function uninstallFetchMock() {
  globalThis.fetch = originalFetch;
}

function restoreEnv() {
  for (const k of Object.keys(originalEnv)) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
}

// ──────────────── lib unit tests ────────────────

// 1) bearer missing path
{
  resetXHistoryForTests();
  setBearer(null);
  const result = await fetchXHistoryPageOnce({});
  check('fetchXHistoryPageOnce returns blocker when no bearer', result.ok === false && result.blocker?.code === 'bearer_missing', `blocker=${result.blocker?.code}`);
  check('fetchXHistoryPageOnce never returns a token', !JSON.stringify(result).match(/Bearer\s+[A-Za-z0-9._~+\/-]{20,}/), 'leak guard');
}

// 2) single page happy path
{
  resetXHistoryForTests();
  setBearer('FAKE-BEARER-1234567890ABCDEFGHIJK');
  installFetchMock((url) => {
    return {
      ok: true,
      status: 200,
      headers: new Map(Object.entries(makeRateLimitHeaders({ remaining: 298 }))),
      text: async () => JSON.stringify(makeXResponse({
        tweets: [
          makeTweet('1001', 'hello world', '2026-06-18T10:00:00Z'),
          makeTweet('1002', 'second tweet', '2026-06-17T09:00:00Z')
        ],
        oldestId: '1002',
        newestId: '1001',
        nextToken: 'NEXT-1',
        users: [{ id: '1108194208295337984', username: 'LucasSynnott', name: 'LUCAS' }]
      }))
    };
  });
  const result = await fetchXHistoryPageOnce({ maxResults: 10 });
  check('happy path: ok=true', result.ok === true);
  check('happy path: 2 tweets normalized', result.tweets.length === 2, `count=${result.tweets.length}`);
  check('happy path: tweet URL composed', result.tweets.every(t => t.url.startsWith('https://x.com/LucasSynnott/status/')), result.tweets[0]?.url);
  check('happy path: author username preserved', result.tweets[0]?.author?.username === 'LucasSynnott');
  check('happy path: nextToken preserved', result.nextToken === 'NEXT-1');
  check('happy path: rate limit surfaced', result.rateLimit?.limit === 300 && result.rateLimit?.remaining === 298, JSON.stringify(result.rateLimit));
  check('happy path: bearer never echoed in payload', !JSON.stringify(result).includes('FAKE-BEARER-1234567890'), 'leak guard');
  check('happy path: one X call', fetchCalls.length === 1, `calls=${fetchCalls.length}`);
  check('happy path: Authorization header sent as Bearer', fetchCalls[0]?.headers?.authorization === ['Bearer', 'FAKE-BEARER-1234567890ABCDEFGHIJK'].join(' '), 'header shape');
  uninstallFetchMock();
}

// 3) rate-limit blocker
{
  resetXHistoryForTests();
  setBearer('FAKE-BEARER-1234567890ABCDEFGHIJK');
  installFetchMock((url) => ({
    ok: false,
    status: 429,
    headers: new Map(Object.entries(makeRateLimitHeaders({ remaining: 0 }))),
    text: async () => JSON.stringify({ title: 'Too Many Requests', detail: 'Rate limit exceeded', status: 429 })
  }));
  const result = await fetchXHistoryPageOnce({});
  check('rate limit: ok=false', result.ok === false);
  check('rate limit: blocker code = rate_limited', result.blocker?.code === 'rate_limited', result.blocker?.code);
  check('rate limit: statusCode surfaced', result.blocker?.statusCode === 429, String(result.blocker?.statusCode));
  check('rate limit: rateLimit headers captured', result.rateLimit?.remaining === 0, JSON.stringify(result.rateLimit));
  check('rate limit: tweets empty', result.tweets.length === 0);
  uninstallFetchMock();
}

// 4) generic 5xx blocker
{
  resetXHistoryForTests();
  setBearer('FAKE-BEARER-1234567890ABCDEFGHIJK');
  installFetchMock((url) => ({
    ok: false,
    status: 503,
    headers: new Map(),
    text: async () => JSON.stringify({ title: 'Service Unavailable', detail: 'overloaded' })
  }));
  const result = await fetchXHistoryPageOnce({});
  check('503: ok=false', result.ok === false);
  check('503: blocker code = x_api_error', result.blocker?.code === 'x_api_error');
  check('503: statusCode 502 (mapped)', result.blocker?.statusCode === 502);
  uninstallFetchMock();
}

// 5) invalid handle
{
  resetXHistoryForTests();
  setBearer('FAKE-BEARER-1234567890ABCDEFGHIJK');
  installFetchMock(() => { throw new Error('fetch should not be called for invalid handle'); });
  const result = await fetchXHistoryPageOnce({ username: 'no spaces or hyphens please' });
  check('invalid handle: blocker code = invalid_handle', result.blocker?.code === 'invalid_handle');
  check('invalid handle: no fetch', fetchCalls.length === 0);
  uninstallFetchMock();
}

// 6) paginated backfill — walks next_token chain
{
  resetXHistoryForTests();
  setBearer('FAKE-BEARER-1234567890ABCDEFGHIJK');
  let callIdx = 0;
  installFetchMock((url) => {
    callIdx += 1;
    if (callIdx === 1) {
      return {
        ok: true, status: 200,
        headers: new Map(Object.entries(makeRateLimitHeaders({ remaining: 290 }))),
        text: async () => JSON.stringify(makeXResponse({
          tweets: [
            makeTweet('2001', 'page1-a', '2026-06-10T10:00:00Z'),
            makeTweet('2002', 'page1-b', '2026-06-09T10:00:00Z')
          ],
          oldestId: '2002', newestId: '2001', nextToken: 'CHAIN-1',
          users: [{ id: '1108194208295337984', username: 'LucasSynnott', name: 'LUCAS' }]
        }))
      };
    }
    if (callIdx === 2) {
      return {
        ok: true, status: 200,
        headers: new Map(Object.entries(makeRateLimitHeaders({ remaining: 289 }))),
        text: async () => JSON.stringify(makeXResponse({
          tweets: [makeTweet('2003', 'page2-a', '2026-06-08T10:00:00Z')],
          oldestId: '2003', newestId: '2003', nextToken: 'CHAIN-2',
          users: [{ id: '1108194208295337984', username: 'LucasSynnott', name: 'LUCAS' }]
        }))
      };
    }
    return {
      ok: true, status: 200,
      headers: new Map(Object.entries(makeRateLimitHeaders({ remaining: 288 }))),
      text: async () => JSON.stringify(makeXResponse({
        tweets: [makeTweet('2004', 'page3-a', '2026-06-07T10:00:00Z')],
        oldestId: '2004', newestId: '2004', nextToken: null,
        users: [{ id: '1108194208295337984', username: 'LucasSynnott', name: 'LUCAS' }]
      }))
    };
  });
  const persisted = [];
  const result = await backfillXHistory({
    username: 'LucasSynnott',
    maxPages: 5,
    persist: async (records) => {
      persisted.push(...records);
      return { persisted: records.length };
    }
  });
  check('backfill: 3 X pages called', fetchCalls.length === 3, `calls=${fetchCalls.length}`);
  check('backfill: 4 unique tweets', result.uniqueCount === 4, `unique=${result.uniqueCount}`);
  check('backfill: persisted count matches', result.persisted === 4);
  check('backfill: pages count = 3', result.pages === 3);
  check('backfill: not truncated', result.truncated === false);
  check('backfill: tweets sorted newest first', result.tweets[0]?.id === '2001' && result.tweets[3]?.id === '2004');
  check('backfill: blocked = none', result.blocker === null);
  check('backfill: persist callback saw 4 records', persisted.length === 4);
  uninstallFetchMock();
}

// 7) backfill stops at maxTweets cap
{
  resetXHistoryForTests();
  setBearer('FAKE-BEARER-1234567890ABCDEFGHIJK');
  installFetchMock((url) => ({
    ok: true, status: 200,
    headers: new Map(Object.entries(makeRateLimitHeaders({}))),
    text: async () => JSON.stringify(makeXResponse({
      tweets: [
        makeTweet('3001', 'a', '2026-06-10T10:00:00Z'),
        makeTweet('3002', 'b', '2026-06-09T10:00:00Z'),
        makeTweet('3003', 'c', '2026-06-08T10:00:00Z')
      ],
      oldestId: '3003', newestId: '3001', nextToken: 'CHAIN-X',
      users: [{ id: '1108194208295337984', username: 'LucasSynnott', name: 'LUCAS' }]
    }))
  }));
  const result = await backfillXHistory({ maxPages: 10, maxTweets: 2, persist: async (records) => ({ persisted: records.length }) });
  check('backfill cap: persisted only 2', result.persisted === 2, `p=${result.persisted}`);
  check('backfill cap: truncated=true', result.truncated === true);
  check('backfill cap: truncatedReason set', result.truncatedReason === 'tweet_cap_reached');
  check('backfill cap: stopped before next page', fetchCalls.length === 1, `calls=${fetchCalls.length}`);
  uninstallFetchMock();
}

// 8) backfill stops when API errors partway
{
  resetXHistoryForTests();
  setBearer('FAKE-BEARER-1234567890ABCDEFGHIJK');
  let callIdx = 0;
  installFetchMock((url) => {
    callIdx += 1;
    if (callIdx === 1) {
      return {
        ok: true, status: 200,
        headers: new Map(Object.entries(makeRateLimitHeaders())),
        text: async () => JSON.stringify(makeXResponse({
          tweets: [makeTweet('4001', 'survived', '2026-06-10T10:00:00Z')],
          oldestId: '4001', newestId: '4001', nextToken: 'CHAIN-1',
          users: [{ id: '1108194208295337984', username: 'LucasSynnott', name: 'LUCAS' }]
        }))
      };
    }
    return {
      ok: false, status: 429,
      headers: new Map(Object.entries(makeRateLimitHeaders({ remaining: 0 }))),
      text: async () => JSON.stringify({ title: 'Too Many Requests', detail: 'limit' })
    };
  });
  const result = await backfillXHistory({ maxPages: 5, persist: async (records) => ({ persisted: records.length }) });
  check('partial backfill: kept the page 1 record', result.uniqueCount === 1);
  check('partial backfill: blocker surfaces rate_limited', result.blocker?.code === 'rate_limited');
  check('partial backfill: pagesSkipped = 1', result.pagesSkipped === 1);
  check('partial backfill: persisted still counted', result.persisted === 1);
  uninstallFetchMock();
}

// 9) getCachedStatus caches the most recent status when no live calls
{
  resetXHistoryForTests();
  setBearer(null);
  const a = getXHistoryStatus();
  const b = getXHistoryStatus();
  check('getXHistoryStatus: cached flag on second call', b.cached === true);
  check('getXHistoryStatus: bearerConfigured false', a.bearerConfigured === false);
}

// 10) getCachedStatus actually fetches when forced
{
  resetXHistoryForTests();
  setBearer('FAKE-BEARER-1234567890ABCDEFGHIJK');
  installFetchMock((url) => ({
    ok: true, status: 200,
    headers: new Map(Object.entries(makeRateLimitHeaders({ remaining: 200 }))),
    text: async () => JSON.stringify(makeXResponse({
      tweets: [makeTweet('5001', 'forced', '2026-06-01T00:00:00Z')],
      oldestId: '5001', newestId: '5001', nextToken: null,
      users: [{ id: '1108194208295337984', username: 'LucasSynnott', name: 'LUCAS' }]
    }))
  }));
  const status = await getCachedStatus({ force: true });
  check('getCachedStatus(force): lastFetch set', status.lastFetch?.ok === true);
  check('getCachedStatus(force): lastFetch.tweetCount = 1', status.lastFetch?.tweets?.length === 1);
  check('getCachedStatus(force): one X call', fetchCalls.length === 1);
  uninstallFetchMock();
}

// 11) provider constants
{
  check('X_HISTORY_PROVIDER is search/all', X_HISTORY_PROVIDER === 'x-api-search-all');
  check('X_HISTORY_INFO.defaultHandle is a safe example', X_HISTORY_INFO.defaultHandle === 'example');
  check('X_HISTORY_INFO.maxResultsPerPage = 100', X_HISTORY_INFO.maxResultsPerPage === 100);
  check('resolveLucasHandle defaults to example', resolveLucasHandle() === 'example');
  delete process.env.TWEET_LAB_LUCAS_HANDLE;
  process.env.TWEET_LAB_LUCAS_HANDLE = 'CustomHandle';
  check('resolveLucasHandle honors env', resolveLucasHandle() === 'CustomHandle');
  process.env.TWEET_LAB_LUCAS_HANDLE = '';
}

// ──────────────── HTTP route integration tests ────────────────

// Sandbox the store so HTTP tests don't touch the real tweet-lab.json.
// We do this BEFORE importing server.js / lib/store.js so the env vars
// are in place when the modules read them at import time.
const sandbox = path.join(__dirname, '..', 'data', '.x-history-test-sandbox');
const sandboxFile = path.join(sandbox, 'tweet-lab.json');
process.env.TWEET_LAB_DATA_DIR = sandbox;
process.env.TWEET_LAB_DATA_FILE = sandboxFile;

// Tear down any prior sandbox before re-importing modules. The import
// cache for the test process is fresh on each `node scripts/...` run, so
// re-importing here is safe.
await fs.rm(sandbox, { recursive: true, force: true });
await fs.mkdir(sandbox, { recursive: true });

// Dynamically import the store + server with the sandbox env in place.
// The lib/store.js module reads DATA_FILE at import time, so this MUST
// happen after the env vars are set above.
const storeModule = await import('../lib/store.js');
const serverModule = await import('../server.js');
const { DATA_FILE, DATA_DIR } = storeModule;
const { handle } = serverModule;

// Sanity guard: the imported module must honor the sandbox. If it
// doesn't, the test would silently clobber the real tweet-lab.json.
if (DATA_DIR !== sandbox) {
  console.error(`FAIL: DATA_DIR did not pick up sandbox env (got ${DATA_DIR}, expected ${sandbox})`);
  process.exit(2);
}
if (DATA_FILE !== sandboxFile) {
  console.error(`FAIL: DATA_FILE did not pick up sandbox env (got ${DATA_FILE}, expected ${sandboxFile})`);
  process.exit(2);
}

const port = 4288;
const server = http.createServer(handle);
await new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve()));

async function req(method, path, body) {
  // The lib-level tests above install a global `fetch` mock that
  // returns canned X API responses. We MUST use the real fetch for the
  // in-process HTTP server below; otherwise the mock intercepts the
  // request and returns a fake X page instead of the route's actual
  // response.
  const init = { method, headers: { 'content-type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await originalFetch(`http://127.0.0.1:${port}${path}`, init);
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = { _raw: text }; }
  return { status: response.status, body: parsed };
}

try {
  // 12) GET /x-history/status — no bearer should give clean blocker, not 500.
  setBearer(null);
  const statusNoBearer = await req('GET', '/api/tweet-lab/x-history/status');
  check('route: status without bearer returns 200', statusNoBearer.status === 200, String(statusNoBearer.status));
  check('route: status without bearer reports bearerConfigured=false', statusNoBearer.body?.bearerConfigured === false);
  check('route: status without bearer includes info', statusNoBearer.body?.info?.provider === X_HISTORY_PROVIDER);

  // 13) GET /x-history/list with empty store
  const emptyList = await req('GET', '/api/tweet-lab/x-history/list');
  check('route: empty list returns 200', emptyList.status === 200);
  check('route: empty list has zero items', emptyList.body?.total === 0 && emptyList.body?.items?.length === 0);

  // 14) GET /x-history/tweet missing id
  const missing = await req('GET', '/api/tweet-lab/x-history/tweet');
  check('route: missing id returns 400', missing.status === 400);
  const notFound = await req('GET', '/api/tweet-lab/x-history/tweet?id=zzzzz');
  check('route: unknown id returns 404', notFound.status === 404);

  // 15) /config surfaces xHistory block
  const cfg = await req('GET', '/api/tweet-lab/config');
  check('route: /config has xHistory block', cfg.body?.xHistory?.provider === X_HISTORY_PROVIDER);
  check('route: /config xHistory.lucasHandle = example', cfg.body?.xHistory?.lucasHandle === 'example');
  check('route: /config xHistory.configured = false (no bearer)', cfg.body?.xHistory?.configured === false);

  // 16) Bearer missing path on /fetch and /backfill — both should return blocker
  setBearer(null);
  const fetchMissing = await req('POST', '/api/tweet-lab/x-history/fetch', {});
  check('route: /fetch without bearer returns blocker', fetchMissing.body?.ok === false && fetchMissing.body?.blocker?.code === 'bearer_missing');
  const backfillMissing = await req('POST', '/api/tweet-lab/x-history/backfill', {});
  check('route: /backfill without bearer returns blocker', backfillMissing.body?.ok === false && backfillMissing.body?.blocker?.code === 'bearer_missing');

  // 17) Full happy path with bearer — fetch a page, then backfill, then list
  setBearer('FAKE-BEARER-1234567890ABCDEFGHIJK');
  resetXHistoryForTests();
  let backfillCalls = 0;
  installFetchMock((url) => {
    backfillCalls += 1;
    return {
      ok: true, status: 200,
      headers: new Map(Object.entries(makeRateLimitHeaders({ remaining: 290 - backfillCalls }))),
      text: async () => JSON.stringify(makeXResponse({
        tweets: [
          makeTweet('9001', 'persisted a', '2026-06-10T10:00:00Z', { like: 5 }),
          makeTweet('9002', 'persisted b', '2026-06-09T10:00:00Z')
        ],
        oldestId: '9002', newestId: '9001', nextToken: null,
        users: [{ id: '1108194208295337984', username: 'LucasSynnott', name: 'LUCAS' }]
      }))
    };
  });
  const backfilled = await req('POST', '/api/tweet-lab/x-history/backfill', { maxPages: 2 });
  check('route: /backfill with bearer returns ok=true', backfilled.body?.ok === true, `status=${backfilled.status} body=${JSON.stringify(backfilled.body).slice(0, 500)}`);
  check('route: /backfill persisted 2', backfilled.body?.persisted === 2, `persisted=${backfilled.body?.persisted}`);
  check('route: /backfill uniqueCount 2', backfilled.body?.uniqueCount === 2, `unique=${backfilled.body?.uniqueCount}`);
  check('route: /backfill page count = 1', backfilled.body?.pages === 1, `pages=${backfilled.body?.pages}`);

  // Read back via list
  const list = await req('GET', '/api/tweet-lab/x-history/list');
  check('route: /list shows 2 items after backfill', list.body?.total === 2 && list.body?.items?.length === 2);
  check('route: /list newest first', list.body?.items[0]?.id === '9001');
  check('route: /list items have url + metrics', list.body?.items.every(t => t.url && t.metrics));
  // No token leak in /list response
  check('route: /list response has no bearer-shaped strings', !JSON.stringify(list.body).match(/Bearer\s+[A-Za-z0-9._~+\/-]{20,}/));

  // Read one by id
  const one = await req('GET', '/api/tweet-lab/x-history/tweet?id=9001');
  check('route: /tweet?id=9001 returns the record', one.body?.item?.id === '9001');
  check('route: /tweet response has no bearer-shaped strings', !JSON.stringify(one.body).match(/Bearer\s+[A-Za-z0-9._~+\/-]{20,}/));

  // Re-run backfill — same ids, should upsert, not duplicate
  const backfilled2 = await req('POST', '/api/tweet-lab/x-history/backfill', { maxPages: 2 });
  check('route: second /backfill updates 2 (no duplicates)', backfilled2.body?.persisted === 2);
  const list2 = await req('GET', '/api/tweet-lab/x-history/list');
  check('route: /list still 2 items after re-backfill', list2.body?.total === 2);

  uninstallFetchMock();

  // 18) /fetch status flow — single page without persistence
  resetXHistoryForTests();
  setBearer('FAKE-BEARER-1234567890ABCDEFGHIJK');
  installFetchMock((url) => ({
    ok: true, status: 200,
    headers: new Map(Object.entries(makeRateLimitHeaders({ remaining: 295 }))),
    text: async () => JSON.stringify(makeXResponse({
      tweets: [makeTweet('9100', 'single page', '2026-06-05T10:00:00Z')],
      oldestId: '9100', newestId: '9100', nextToken: null,
      users: [{ id: '1108194208295337984', username: 'LucasSynnott', name: 'LUCAS' }]
    }))
  }));
  const single = await req('POST', '/api/tweet-lab/x-history/fetch', { maxResults: 10 });
  check('route: /fetch ok=true', single.body?.ok === true);
  check('route: /fetch returned 1 tweet', single.body?.tweets?.length === 1);
  check('route: /fetch did not persist (no 9xxx ids in list)', (await req('GET', '/api/tweet-lab/x-history/list')).body?.total === 2);
  uninstallFetchMock();

  // 19) 503 from X surfaces as 502 in /fetch (mapped)
  setBearer('FAKE-BEARER-1234567890ABCDEFGHIJK');
  resetXHistoryForTests();
  installFetchMock((url) => ({
    ok: false, status: 503,
    headers: new Map(Object.entries(makeRateLimitHeaders({ remaining: 0 }))),
    text: async () => JSON.stringify({ title: 'Service Unavailable', detail: 'overloaded' })
  }));
  const err = await req('POST', '/api/tweet-lab/x-history/fetch', {});
  check('route: /fetch 503 from X → 502', err.status === 502, `got ${err.status}`);
  check('route: /fetch 503 → blocker x_api_error', err.body?.blocker?.code === 'x_api_error');
  uninstallFetchMock();

  // 20) 429 from X surfaces in /backfill (continues collecting partial pages)
  setBearer('FAKE-BEARER-1234567890ABCDEFGHIJK');
  resetXHistoryForTests();
  let cIdx = 0;
  installFetchMock((url) => {
    cIdx += 1;
    if (cIdx === 1) {
      return {
        ok: true, status: 200,
        headers: new Map(Object.entries(makeRateLimitHeaders({ remaining: 100 }))),
        text: async () => JSON.stringify(makeXResponse({
          tweets: [makeTweet('9200', 'kept one', '2026-06-04T10:00:00Z')],
          oldestId: '9200', newestId: '9200', nextToken: 'TOK',
          users: [{ id: '1108194208295337984', username: 'LucasSynnott', name: 'LUCAS' }]
        }))
      };
    }
    return {
      ok: false, status: 429,
      headers: new Map(Object.entries(makeRateLimitHeaders({ remaining: 0 }))),
      text: async () => JSON.stringify({ title: 'Too Many Requests', detail: 'limit' })
    };
  });
  const partial = await req('POST', '/api/tweet-lab/x-history/backfill', { maxPages: 5 });
  check('route: /backfill partial 429 returns 200 (not 4xx)', partial.status === 200);
  check('route: /backfill partial kept page 1', partial.body?.persisted === 1);
  check('route: /backfill partial has rate_limited blocker', partial.body?.blocker?.code === 'rate_limited');
  check('route: /backfill partial pagesSkipped = 1', partial.body?.pagesSkipped === 1);
  uninstallFetchMock();
} finally {
  await new Promise(resolve => server.close(resolve));
  // Clean up the sandbox and restore env.
  await fs.rm(sandbox, { recursive: true, force: true });
  restoreEnv();
  globalThis.fetch = originalFetch;
  const failed = checks.filter(c => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) {
    console.error('FAILED:');
    for (const f of failed) console.error(`  - ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
    process.exit(1);
  }
  process.exit(0);
}
