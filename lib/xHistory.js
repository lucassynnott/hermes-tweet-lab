// Server-side X history backfill for the Tweet Lab operator.
//
// Design contract:
//   - Read-only. The X bearer token stays in process env / 1Password and
//     never leaves the server.
//   - Pagination is bounded by the operator's intent (maxPages, maxTweets)
//     AND the X API's own ceiling (next_token, rate-limit headers).
//   - Every call returns the exact blocker the API gave us when the X plan
//     refuses to go further (no fake completeness, no "all previous tweets"
//     claim when the API can only return the last few days).
//   - Persisted records are normalized: id, text, createdAt, public URL,
//     author, public metrics when returned, and source metadata. The
//     durable record is what Goro/Home generation reads; the raw X
//     response is never stored.
//   - An in-memory cache holds the most recent status + last-page payload
//     so Home generation does not re-call X within the rate-limit window.
//
// This module is intentionally small. Pagination, normalization, blocker
// detection, and caching live here so the server endpoint and the test
// harness can share one verified implementation.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mirror server.js X_PROVIDER. We export the value so the test harness and
// the route handler agree on the same string.
export const X_HISTORY_PROVIDER = 'x-api-search-all';

// Single-source-of-truth default operator handle. Override via env.
export const DEFAULT_LUCAS_HANDLE = 'example';

// X API pagination ceilings. 100 is the documented max for the user-tweets
// recent/all search endpoint. We refuse to ask for more, and we refuse to
// exceed a sensible operator-side page cap so a single bad call cannot
// hammer the X quota.
export const X_MAX_RESULTS_PER_PAGE = 100;
export const X_MAX_PAGES_PER_BACKFILL = 25;
export const X_REQUEST_TIMEOUT_MS = 15000;

// Per-process rate-limit backoff. The X plan shown to us via headers is
// 300/15min for /2/tweets/search/all and 450/15min for /2/tweets/search/recent.
// We track a conservative wall-clock cooldown so a second fetch inside the
// window returns the cached status instead of burning more quota.
const CACHE_TTL_MS = 60 * 1000;
const RATE_LIMIT_BACKOFF_MS = 60 * 1000;

const state = {
  lastStatus: null,
  lastStatusAt: 0,
  lastFetch: null,
  lastFetchAt: 0,
  lastRateLimit: null,
  inFlight: null
};

function nowIso() {
  return new Date().toISOString();
}

function getXBearerToken() {
  return String(process.env.X_BEARER_TOKEN || '').trim();
}

export function resolveLucasHandle() {
  const fromEnv = String(process.env.TWEET_LAB_X_HANDLE || process.env.TWEET_LAB_LUCAS_HANDLE || '').trim();
  if (fromEnv) return fromEnv.replace(/^@+/, '').trim() || DEFAULT_LUCAS_HANDLE;
  return DEFAULT_LUCAS_HANDLE;
}

function xRateLimitFromHeaders(headers) {
  const reset = headers.get('x-rate-limit-reset');
  return {
    limit: headers.get('x-rate-limit-limit') ? Number(headers.get('x-rate-limit-limit')) : null,
    remaining: headers.get('x-rate-limit-remaining') ? Number(headers.get('x-rate-limit-remaining')) : null,
    reset: reset ? new Date(Number(reset) * 1000).toISOString() : null
  };
}

function normalizeXHistoryTweet(rawTweet, includes, requestedUsername, fetchedAt) {
  const author = includes.users?.get(rawTweet.author_id) || { username: requestedUsername, name: requestedUsername };
  const mediaKeys = rawTweet.attachments?.media_keys || [];
  const media = mediaKeys.map(key => includes.media?.get(key)).filter(Boolean).map(item => ({
    mediaKey: item.media_key,
    type: item.type || null,
    url: item.url || null,
    previewImageUrl: item.preview_image_url || null,
    width: item.width ?? null,
    height: item.height ?? null,
    altText: item.alt_text || null
  }));
  const username = author.username || requestedUsername;
  const metrics = rawTweet.public_metrics ? {
    likeCount: rawTweet.public_metrics.like_count ?? null,
    repostCount: rawTweet.public_metrics.retweet_count ?? null,
    replyCount: rawTweet.public_metrics.reply_count ?? null,
    quoteCount: rawTweet.public_metrics.quote_count ?? null,
    impressionCount: rawTweet.public_metrics.impression_count ?? null
  } : null;
  return {
    id: rawTweet.id,
    url: `https://x.com/${username}/status/${rawTweet.id}`,
    text: rawTweet.text || '',
    createdAt: rawTweet.created_at || null,
    author: {
      id: author.id || rawTweet.author_id || null,
      username,
      name: author.name || username,
      profileImageUrl: author.profile_image_url || null,
      verified: author.verified ?? null
    },
    metrics,
    media,
    source: X_HISTORY_PROVIDER,
    fetchedAt
  };
}

function isValidHandle(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_]{1,15}$/.test(value);
}

// Build a `next_token` URL for the X search/all endpoint. We deliberately
// keep the surface small so the caller only ever sees our normalized
// fields; the raw X response stays in this module.
function buildSearchAllUrl({ username, paginationToken, maxResults }) {
  const params = new URLSearchParams({
    query: `from:${username} -is:retweet`,
    max_results: String(maxResults),
    'tweet.fields': 'created_at,author_id,public_metrics,attachments,entities,conversation_id,referenced_tweets,lang',
    expansions: 'author_id,attachments.media_keys',
    'user.fields': 'username,name,profile_image_url,verified,public_metrics',
    'media.fields': 'type,url,preview_image_url,width,height,alt_text'
  });
  if (paginationToken) params.set('next_token', paginationToken);
  return `https://api.x.com/2/tweets/search/all?${params.toString()}`;
}

// Run a single X search/all page. Throws an Error with a `code` field the
// caller can surface to the UI verbatim. The X bearer token never leaves
// this function's scope.
async function fetchXHistoryPage({ username, paginationToken, maxResults, bearerToken }) {
  if (!isValidHandle(username)) {
    const error = new Error(`Invalid X handle: ${username}`);
    error.code = 'invalid_handle';
    error.statusCode = 400;
    throw error;
  }
  const url = buildSearchAllUrl({ username, paginationToken, maxResults });
  const response = await fetch(url, {
    method: 'GET',
    headers: { authorization: `Bearer ${bearerToken}` },
    signal: AbortSignal.timeout(X_REQUEST_TIMEOUT_MS)
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 400) }; }
  const rateLimit = xRateLimitFromHeaders(response.headers);
  if (!response.ok) {
    const detail = data?.detail || data?.title || data?.errors?.[0]?.message || `X API returned HTTP ${response.status}`;
    const error = new Error(detail);
    error.code = response.status === 429 ? 'rate_limited' : 'x_api_error';
    error.statusCode = response.status === 429 ? 429 : 502;
    error.rateLimit = rateLimit;
    error.body = data;
    error.endpoint = 'search/all';
    throw error;
  }
  const fetchedAt = nowIso();
  const includes = {
    users: new Map((data.includes?.users || []).map(user => [user.id, user])),
    media: new Map((data.includes?.media || []).map(media => [media.media_key, media]))
  };
  const tweets = (data.data || []).map(tweet => normalizeXHistoryTweet(tweet, includes, username, fetchedAt));
  const meta = data.meta || {};
  return {
    tweets,
    nextToken: meta.next_token || null,
    resultCount: typeof meta.result_count === 'number' ? meta.result_count : tweets.length,
    oldestId: meta.oldest_id || null,
    newestId: meta.newest_id || null,
    rateLimit,
    fetchedAt,
    raw: { meta }
  };
}

// Pull a single X history page. Returns either the page or an explicit
// blocker. The route layer and the test harness both call this directly.
export async function fetchXHistoryPageOnce(options = {}) {
  const bearerToken = getXBearerToken();
  if (!bearerToken) {
    return {
      ok: false,
      provider: X_HISTORY_PROVIDER,
      readOnly: true,
      endpoint: 'search/all',
      username: options.username || resolveLucasHandle(),
      fetchedAt: nowIso(),
      blocker: {
        code: 'bearer_missing',
        message: 'X_BEARER_TOKEN is not configured, so X history backfill is unavailable. Add it to a private env file and restart Tweet Lab.'
      },
      tweets: [],
      nextToken: null,
      rateLimit: null
    };
  }
  const username = options.username || resolveLucasHandle();
  const maxResults = Math.max(10, Math.min(Number(options.maxResults) || X_MAX_RESULTS_PER_PAGE, X_MAX_RESULTS_PER_PAGE));
  try {
    const page = await fetchXHistoryPage({
      username,
      paginationToken: options.nextToken || null,
      maxResults,
      bearerToken
    });
    return {
      ok: true,
      provider: X_HISTORY_PROVIDER,
      readOnly: true,
      endpoint: 'search/all',
      username,
      fetchedAt: page.fetchedAt,
      tweets: page.tweets,
      nextToken: page.nextToken,
      resultCount: page.resultCount,
      oldestId: page.oldestId,
      newestId: page.newestId,
      rateLimit: page.rateLimit,
      blocker: null
    };
  } catch (error) {
    return {
      ok: false,
      provider: X_HISTORY_PROVIDER,
      readOnly: true,
      endpoint: 'search/all',
      username,
      fetchedAt: nowIso(),
      tweets: [],
      nextToken: null,
      rateLimit: error.rateLimit || null,
      blocker: {
        code: error.code || 'x_api_error',
        message: error.message || 'Unknown X API error',
        statusCode: typeof error.statusCode === 'number' ? error.statusCode : null
      }
    };
  }
}

// Status snapshot. Cheap, cached for CACHE_TTL_MS so Home generation
// does not re-hit X every request.
export function getXHistoryStatus({ username, force = false } = {}) {
  const operator = username || resolveLucasHandle();
  const bearerConfigured = Boolean(getXBearerToken());
  if (!force && state.lastStatus && state.lastStatus.username === operator && (Date.now() - state.lastStatusAt) < CACHE_TTL_MS) {
    return { ...state.lastStatus, cached: true };
  }
  const lastFetch = state.lastFetch && state.lastFetch.username === operator ? state.lastFetch : null;
  const rateLimit = state.lastRateLimit;
  const status = {
    provider: X_HISTORY_PROVIDER,
    readOnly: true,
    endpoint: 'search/all',
    username: operator,
    bearerConfigured,
    generatedAt: nowIso(),
    lastFetch,
    rateLimit,
    blocker: lastFetch && !lastFetch.ok ? lastFetch.blocker : null
  };
  state.lastStatus = status;
  state.lastStatusAt = Date.now();
  return { ...status, cached: false };
}

function setLastFetch(result) {
  state.lastFetch = {
    at: result.fetchedAt,
    username: result.username,
    ok: result.ok,
    endpoint: result.endpoint,
    tweets: result.tweets,
    resultCount: result.resultCount,
    nextToken: result.nextToken,
    oldestId: result.oldestId,
    newestId: result.newestId,
    rateLimit: result.rateLimit,
    blocker: result.blocker
  };
  state.lastFetchAt = Date.now();
  if (result.rateLimit) state.lastRateLimit = result.rateLimit;
  state.lastStatus = null;
  state.lastStatusAt = 0;
}

export async function getCachedStatus({ username, force = false } = {}) {
  const operator = username || resolveLucasHandle();
  if (!force && state.lastStatus && state.lastStatus.username === operator && (Date.now() - state.lastStatusAt) < CACHE_TTL_MS) {
    return { ...state.lastStatus, cached: true };
  }
  if (state.inFlight) {
    return { provider: X_HISTORY_PROVIDER, username: operator, inFlight: true, generatedAt: nowIso() };
  }
  if (!force && state.lastFetch && state.lastFetch.username === operator) {
    const staleFor = Date.now() - state.lastFetchAt;
    if (staleFor < CACHE_TTL_MS) {
      return {
        provider: X_HISTORY_PROVIDER,
        readOnly: true,
        endpoint: 'search/all',
        username: operator,
        bearerConfigured: Boolean(getXBearerToken()),
        generatedAt: nowIso(),
        lastFetch: state.lastFetch,
        rateLimit: state.lastRateLimit,
        cached: true,
        blocker: state.lastFetch.ok ? null : state.lastFetch.blocker
      };
    }
  }
  // Cooldown after a failure: don't retry the same call inside the rate
  // limit window. We still return the cached status so the UI can render
  // a useful "X rate-limited, last seen N seconds ago" panel.
  if (state.lastFetch && !state.lastFetch.ok && state.lastFetch.rateLimit?.reset) {
    const resetMs = Date.parse(state.lastFetch.rateLimit.reset) - Date.now();
    if (resetMs > 0 && resetMs < RATE_LIMIT_BACKOFF_MS * 30) {
      return {
        provider: X_HISTORY_PROVIDER,
        readOnly: true,
        endpoint: 'search/all',
        username: operator,
        bearerConfigured: Boolean(getXBearerToken()),
        generatedAt: nowIso(),
        lastFetch: state.lastFetch,
        rateLimit: state.lastRateLimit,
        cached: true,
        blocker: state.lastFetch.blocker
      };
    }
  }
  state.inFlight = (async () => {
    const page = await fetchXHistoryPageOnce({ username: operator });
    setLastFetch(page);
    return page;
  })();
  try {
    const page = await state.inFlight;
    return {
      provider: X_HISTORY_PROVIDER,
      readOnly: true,
      endpoint: 'search/all',
      username: operator,
      bearerConfigured: Boolean(getXBearerToken()),
      generatedAt: nowIso(),
      lastFetch: state.lastFetch,
      rateLimit: state.lastRateLimit,
      cached: false,
      blocker: state.lastFetch.ok ? null : state.lastFetch.blocker
    };
  } finally {
    state.inFlight = null;
  }
}

// Paginated backfill. Walks `search/all` next_token chain until either
// maxPages / maxTweets is hit or X returns no next_token. Every page
// result is returned to the caller — the caller decides what to persist.
export async function backfillXHistory({ username, maxPages, maxTweets, persist } = {}) {
  const operator = username || resolveLucasHandle();
  if (!isValidHandle(operator)) {
    return {
      ok: false,
      username: operator,
      provider: X_HISTORY_PROVIDER,
      readOnly: true,
      pages: 0,
      pagesSkipped: 0,
      tweets: [],
      uniqueCount: 0,
      persisted: 0,
      truncated: false,
      blocker: {
        code: 'invalid_handle',
        message: `Invalid X handle: ${operator}`,
        statusCode: 400
      },
      startedAt: nowIso(),
      finishedAt: nowIso()
    };
  }
  const pageCap = Math.max(1, Math.min(Number(maxPages) || X_MAX_PAGES_PER_BACKFILL, X_MAX_PAGES_PER_BACKFILL));
  const tweetCap = Math.max(1, Math.min(Number(maxTweets) || (pageCap * X_MAX_RESULTS_PER_PAGE), pageCap * X_MAX_RESULTS_PER_PAGE));
  const bearerToken = getXBearerToken();
  if (!bearerToken) {
    return {
      ok: false,
      username: operator,
      provider: X_HISTORY_PROVIDER,
      readOnly: true,
      pages: 0,
      pagesSkipped: 0,
      tweets: [],
      uniqueCount: 0,
      persisted: 0,
      truncated: false,
      blocker: {
        code: 'bearer_missing',
        message: 'X_BEARER_TOKEN is not configured, so X history backfill is unavailable. Add it to a private env file and restart Tweet Lab.'
      },
      startedAt: nowIso(),
      finishedAt: nowIso()
    };
  }

  const startedAt = nowIso();
  const allTweets = [];
  const seen = new Set();
  const pages = [];
  let pagesSkipped = 0;
  let blocker = null;
  let paginationToken = null;
  let lastRateLimit = null;
  let truncated = false;
  let pagesRequested = 0;
  let newestId = null;
  let oldestId = null;

  for (let page = 0; page < pageCap; page += 1) {
    pagesRequested += 1;
    let result;
    try {
      result = await fetchXHistoryPage({
        username: operator,
        paginationToken,
        maxResults: X_MAX_RESULTS_PER_PAGE,
        bearerToken
      });
    } catch (error) {
      result = {
        tweets: [],
        nextToken: null,
        resultCount: 0,
        oldestId: null,
        newestId: null,
        rateLimit: error.rateLimit || null,
        fetchedAt: nowIso(),
        error
      };
    }
    lastRateLimit = result.rateLimit || lastRateLimit;
    if (result.error) {
      blocker = {
        code: result.error.code || 'x_api_error',
        message: result.error.message || 'Unknown X API error',
        statusCode: typeof result.error.statusCode === 'number' ? result.error.statusCode : null
      };
      pagesSkipped += 1;
      pages.push({
        page: pagesRequested,
        ok: false,
        tweetCount: 0,
        nextToken: null,
        blocker
      });
      break;
    }
    if (result.tweets.length) {
      for (const tweet of result.tweets) {
        if (seen.has(tweet.id)) continue;
        seen.add(tweet.id);
        allTweets.push(tweet);
      }
      if (!newestId) newestId = result.newestId;
      oldestId = result.oldestId || oldestId;
    }
    pages.push({
      page: pagesRequested,
      ok: true,
      tweetCount: result.tweets.length,
      nextToken: result.nextToken || null,
      oldestId: result.oldestId || null,
      newestId: result.newestId || null,
      resultCount: result.resultCount
    });
    if (!result.nextToken) break;
    if (allTweets.length >= tweetCap) {
      truncated = true;
      break;
    }
    paginationToken = result.nextToken;
  }

  if (allTweets.length > tweetCap) {
    allTweets.length = tweetCap;
    truncated = true;
  }

  // Sort newest first so the UI and the persisted order match.
  allTweets.sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));

  let persisted = 0;
  if (typeof persist === 'function' && allTweets.length) {
    const writeResult = await persist(allTweets);
    persisted = Number(writeResult?.persisted) || 0;
  }

  // Record the synthesized backfill into the same cache the status
  // endpoint reads, so a follow-up status call inside the TTL window
  // doesn't trigger a fresh fetch.
  setLastFetch({
    ok: !blocker && allTweets.length > 0,
    username: operator,
    endpoint: 'search/all',
    tweets: allTweets,
    resultCount: allTweets.length,
    nextToken: paginationToken,
    oldestId,
    newestId,
    rateLimit: lastRateLimit,
    fetchedAt: nowIso(),
    blocker
  });

  return {
    ok: !blocker,
    username: operator,
    provider: X_HISTORY_PROVIDER,
    readOnly: true,
    pages: pagesRequested,
    pagesSkipped,
    pagesDetail: pages,
    tweets: allTweets,
    uniqueCount: allTweets.length,
    persisted,
    truncated,
    truncatedReason: truncated ? 'tweet_cap_reached' : null,
    blocker,
    rateLimit: lastRateLimit,
    startedAt,
    finishedAt: nowIso()
  };
}

export const X_HISTORY_INFO = {
  provider: X_HISTORY_PROVIDER,
  endpoint: 'search/all',
  defaultHandle: DEFAULT_LUCAS_HANDLE,
  maxResultsPerPage: X_MAX_RESULTS_PER_PAGE,
  maxPagesPerBackfill: X_MAX_PAGES_PER_BACKFILL,
  cacheTtlMs: CACHE_TTL_MS,
  rateLimitBackoffMs: RATE_LIMIT_BACKOFF_MS
};

export function resetXHistoryForTests() {
  state.lastStatus = null;
  state.lastStatusAt = 0;
  state.lastFetch = null;
  state.lastFetchAt = 0;
  state.lastRateLimit = null;
  state.inFlight = null;
}

export const _xHistoryInternals = {
  state,
  buildSearchAllUrl,
  normalizeXHistoryTweet,
  xRateLimitFromHeaders,
  getXBearerToken
};
