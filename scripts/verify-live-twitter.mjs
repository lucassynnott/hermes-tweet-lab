import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';

const baseUrl = process.env.TWEET_LAB_BASE_URL || 'http://127.0.0.1:4173';
const account = process.env.TWEET_LAB_LIVE_ACCOUNT || 'LucasSynnott';
const mediaAccount = process.env.TWEET_LAB_LIVE_MEDIA_ACCOUNT || 'NASA';
const checks = [];
const check = (name, condition, detail = '') => checks.push({ name, ok: Boolean(condition), detail });

function request(method, requestUrl, body, headers = {}) {
  const url = new URL(requestUrl, baseUrl);
  const payload = body === undefined ? null : JSON.stringify(body);
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(url, {
      method,
      rejectUnauthorized: false,
      headers: {
        accept: 'application/json, text/plain, */*',
        ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
        ...headers
      },
      timeout: Number(process.env.TWEET_LAB_VERIFY_TIMEOUT_MS || 120000)
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const text = buffer.toString('utf8');
        let jsonBody = null;
        try { jsonBody = text ? JSON.parse(text) : null; } catch { /* text response */ }
        resolve({ status: res.statusCode, headers: res.headers, buffer, text, json: jsonBody });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`${method} ${url.href} timed out`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function hasTokenLikeLeak(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value || '');
  // Env var labels in Settings are documentation, not leaked secret values.
  // Flag actual credential-looking material only: bearer values, common API key prefixes, and JWTs.
  return /Bearer\s+[A-Za-z0-9._~+\/-]{20,}|\bsk-[A-Za-z0-9_-]{20,}|\bxai-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/i.test(text);
}

const config = await request('GET', '/api/tweet-lab/config');
check('config returns 200', config.status === 200, String(config.status));
check('config says X live reads configured', config.json?.xConfigured === true, JSON.stringify(config.json));
check('config says X reads are read-only', config.json?.xReadOnly === true, JSON.stringify(config.json));
check('config exposes no token-like secrets', !hasTokenLikeLeak(config.json), JSON.stringify(config.json));

const live = await request('POST', '/api/tweet-lab/live/accounts/tweets', {
  accounts: [account],
  limitPerAccount: 10,
  excludeReplies: true,
  mediaOnly: false,
  queryContext: 'live verification smoke'
});
check('live account fetch returns 200', live.status === 200, live.text.slice(0, 300));
check('live provider is X recent search', live.json?.provider === 'x-api-recent-search', live.json?.provider);
check('live endpoint is read-only', live.json?.readOnly === true, JSON.stringify(live.json?.readOnly));
check('live response has successful account', Array.isArray(live.json?.accounts) && live.json.accounts.some(item => item.username.toLowerCase() === account.toLowerCase() && item.ok), JSON.stringify(live.json?.accounts));
check('live response has real tweets', Array.isArray(live.json?.tweets) && live.json.tweets.length > 0, JSON.stringify(live.json?.warnings || []));
const firstTweet = live.json?.tweets?.[0] || {};
check('tweet includes id/url/text', Boolean(firstTweet.id && firstTweet.url && firstTweet.text), JSON.stringify(firstTweet).slice(0, 500));
check('tweet includes account name/profile fields', Boolean(firstTweet.author?.username && firstTweet.author?.name && Object.prototype.hasOwnProperty.call(firstTweet.author, 'profileImageUrl')), JSON.stringify(firstTweet.author || {}));
check('tweet includes public metrics object', Boolean(firstTweet.metrics && Object.prototype.hasOwnProperty.call(firstTweet.metrics, 'likeCount')), JSON.stringify(firstTweet.metrics || {}));
check('live response exposes no token-like secrets', !hasTokenLikeLeak(live.json), 'token-like pattern found in live response');

let savedSourceId = null;
let draftIds = [];
try {
  const selectedSource = {
    id: `live-${firstTweet.id}`,
    url: firstTweet.url,
    statusId: firstTweet.id,
    author: firstTweet.author?.username || '',
    text: firstTweet.text || '',
    sourceType: 'tweet',
    tags: ['live-x', 'verification-smoke'],
    format: '',
    whySaved: 'Verification smoke selected from live X account inspiration.',
    engagement: firstTweet.metrics || {},
    warnings: firstTweet.warnings || [],
    provider: firstTweet.source || live.json?.provider,
    fetchedAt: firstTweet.fetchedAt || live.json?.fetchedAt,
    authorProfile: firstTweet.author || {},
    media: firstTweet.media || []
  };
  const saved = await request('POST', '/api/tweet-lab/store/sources', selectedSource);
  savedSourceId = saved.json?.id || null;
  check('real live tweet can be saved to source bank', saved.status === 201 && savedSourceId && saved.json?.text === firstTweet.text, saved.text.slice(0, 300));
  check('saved source preserves live media/profile metadata', Array.isArray(saved.json?.media) && saved.json?.authorProfile?.username, JSON.stringify(saved.json || {}).slice(0, 500));

  const rewrite = await request('POST', '/api/tweet-lab/rewrite', {
    sourceTweet: selectedSource,
    context: 'Verification smoke: rewrite the useful angle without copying or inventing metrics.',
    tone: 'sharp, useful, no AI slop',
    count: 1
  });
  draftIds = Array.isArray(rewrite.json?.drafts) ? rewrite.json.drafts.map(draft => draft.id).filter(Boolean) : [];
  check('real live tweet can be rewritten into draft', rewrite.status === 200 && draftIds.length > 0, rewrite.text.slice(0, 500));
  check('rewrite response references live source tweet', rewrite.json?.sourceTweet?.url === firstTweet.url, JSON.stringify(rewrite.json?.sourceTweet || {}).slice(0, 300));
  check('rewrite response exposes no token-like secrets', !hasTokenLikeLeak(rewrite.json), 'token-like pattern found in rewrite response');
} finally {
  for (const draftId of draftIds) await request('DELETE', `/api/tweet-lab/store/drafts/${encodeURIComponent(draftId)}`).catch(() => null);
  if (savedSourceId) await request('DELETE', `/api/tweet-lab/store/sources/${encodeURIComponent(savedSourceId)}`).catch(() => null);
}

const media = await request('POST', '/api/tweet-lab/live/accounts/tweets', {
  accounts: [mediaAccount],
  limitPerAccount: 10,
  excludeReplies: true,
  mediaOnly: true,
  queryContext: 'live media verification smoke'
});
check('media-only live fetch returns 200', media.status === 200, media.text.slice(0, 300));
const mediaTweets = Array.isArray(media.json?.tweets) ? media.json.tweets : [];
check('media-only fetch has tweets', mediaTweets.length > 0, JSON.stringify(media.json?.warnings || []));
check('media-only fetch includes media metadata', mediaTweets.some(tweet => Array.isArray(tweet.media) && tweet.media.length > 0), JSON.stringify(mediaTweets[0] || {}).slice(0, 500));
check('media response exposes no token-like secrets', !hasTokenLikeLeak(media.json), 'token-like pattern found in media response');

const staticFiles = ['index.html', 'app.js', 'styles.css'];
for (const file of staticFiles) {
  const disk = await fs.readFile(new URL(`../${file}`, import.meta.url));
  const served = await request('GET', `/${file}`);
  const diskHash = createHash('sha256').update(disk).digest('hex');
  const servedHash = createHash('sha256').update(served.buffer).digest('hex');
  check(`${file} served hash matches disk`, served.status === 200 && diskHash === servedHash, `status=${served.status} disk=${diskHash} served=${servedHash}`);
  check(`${file} cache-control is no-store`, String(served.headers['cache-control'] || '').toLowerCase().includes('no-store'), String(served.headers['cache-control'] || ''));
  check(`${file} served asset has no token-like secrets`, !hasTokenLikeLeak(served.text), `${file} contains token-like string`);
}

const failed = checks.filter(item => !item.ok);
for (const item of checks) console.log(`${item.ok ? '✓' : '✗'} ${item.name}${item.ok || !item.detail ? '' : ` — ${item.detail}`}`);
if (failed.length) {
  console.error(`\n${failed.length}/${checks.length} live Twitter verification checks failed against ${baseUrl}`);
  process.exit(1);
}
console.log(`\n${checks.length}/${checks.length} live Twitter verification checks passed against ${baseUrl}`);
