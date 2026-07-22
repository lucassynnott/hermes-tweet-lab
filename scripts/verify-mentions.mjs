// scripts/verify-mentions.mjs
//
// Acceptance verifier for the Mentions feed + private AI reply drafts card
// (Kanban t_d5f8977b). Exercises the live server endpoints and validates:
//
//   1. /api/tweet-lab/mentions/status returns the exact X_USER_ACCESS_TOKEN
//      blocker when the user-context credential is missing.
//   2. /api/tweet-lab/mentions/fetch returns HTTP 503 with the same blocker
//      shape when called without credentials (no fabricated feed).
//   3. /api/tweet-lab/mentions/reply/draft generates a private reply
//      candidate via Goro (or the safe mock adapter) and persists it to the
//      `replies` store with published=false and sourceRefs.
//   4. The browser files do not reference a public reply/publish/send
//      endpoint.
//   5. The index.html exposes the Mentions page shell elements required by
//      the SuperX reference screenshot.
//
// Usage:
//   node scripts/verify-mentions.mjs
//   node scripts/verify-mentions.mjs --base http://127.0.0.1:4173

import { readFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const baseArg = args.indexOf('--base');
const BASE = baseArg >= 0 ? args[baseArg + 1] : 'http://127.0.0.1:4173';

const checks = [];
function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail });
  process.stdout.write(`${condition ? '✓' : '✗'} ${name}${detail ? '  — ' + detail : ''}\n`);
}

const fetchOk = async (path, init = {}) => {
  const res = await fetch(`${BASE}${path}`, init);
  let body;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body, ok: res.ok };
};

console.log(`\nMentions verifier against ${BASE}\n`);

// 1. Live status endpoint surfaces the exact blocker.
const status = await fetchOk('/api/tweet-lab/mentions/status');
check('mentions/status HTTP 200', status.status === 200, `got ${status.status}`);
check('mentions/status reports configured=false', status.body?.configured === false, `configured=${status.body?.configured}`);
check('mentions/status names X_USER_ACCESS_TOKEN', String(status.body?.blocker || '').includes('X_USER_ACCESS_TOKEN'));
check('mentions/status readOnly=true', status.body?.readOnly === true);
check('mentions/status provider=x-users-me-mentions', status.body?.provider === 'x-users-me-mentions');

// 2. Live fetch endpoint returns 503 with the same blocker shape, no fabricated feed.
const fetchRes = await fetchOk('/api/tweet-lab/mentions/fetch', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ accounts: ['LucasSynnott'], limitPerAccount: 5 })
});
check('mentions/fetch returns 503 when unconfigured', fetchRes.status === 503, `got ${fetchRes.status}`);
check('mentions/fetch body.error mentions X_USER_ACCESS_TOKEN', String(fetchRes.body?.error || '').includes('X_USER_ACCESS_TOKEN'));
check('mentions/fetch body.mentions is an empty array', Array.isArray(fetchRes.body?.mentions) && fetchRes.body.mentions.length === 0);
check('mentions/fetch body.readOnly=true', fetchRes.body?.readOnly === true);

// 3. Private AI reply draft generates and persists to the replies store.
const draftRes = await fetchOk('/api/tweet-lab/mentions/reply/draft', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    mention: {
      id: 'verify-mention-1',
      url: 'https://x.com/verify-target/status/1',
      text: 'Wrong, I can see why people might think that so the case, but it\'s wrong.',
      author: { username: 'verify-target', name: 'Verify Target' }
    },
    parentTweet: null,
    context: 'Verify draft — Lucas builds AI operator systems. No metrics, no claims.',
    tone: 'sharp, useful, no AI slop',
    count: 1
  })
});
check('mentions/reply/draft HTTP 200', draftRes.status === 200, `got ${draftRes.status}`);
check('mentions/reply/draft returns candidates', Array.isArray(draftRes.body?.candidates) && draftRes.body.candidates.length > 0, `candidates=${draftRes.body?.candidates?.length}`);
const topCandidate = draftRes.body?.candidates?.[0];
check('mentions/reply/draft top candidate is <=280 chars', topCandidate && topCandidate.text && topCandidate.text.length <= 280, `len=${topCandidate?.text?.length}`);
check('mentions/reply/draft top candidate has sourceRefs', Array.isArray(topCandidate?.sourceRefs) && topCandidate.sourceRefs.length > 0, `refs=${JSON.stringify(topCandidate?.sourceRefs)}`);
const persistedReplies = Array.isArray(draftRes.body?.replies) ? draftRes.body.replies : [];
check('mentions/reply/draft persists at least one reply to store', persistedReplies.length > 0, `count=${persistedReplies.length}`);
const persisted = persistedReplies[0];
check('mentions/reply/draft persisted reply has published=false', persisted?.published === false, `published=${persisted?.published}`);
check('mentions/reply/draft persisted reply has adapter', !!persisted?.adapter, `adapter=${persisted?.adapter}`);
check('mentions/reply/draft persisted reply has mentionId', persisted?.mentionId === 'verify-mention-1', `mentionId=${persisted?.mentionId}`);
check('mentions/reply/draft never logs/advertises publishing', !/publish|send|public/i.test(JSON.stringify(draftRes.body?.candidates?.[0]?.warnings || [])), `warnings=${JSON.stringify(draftRes.body?.candidates?.[0]?.warnings)}`);

// 4. No public reply/write endpoint should be reachable.
const publishRes = await fetchOk('/api/tweet-lab/mentions/reply/publish', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({})
});
check('mentions/reply/publish is NOT registered (405/404)', publishRes.status === 404 || publishRes.status === 405, `got ${publishRes.status}`);

// 5. index.html exposes the Mentions page shell elements.
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
check('index.html exposes Mentions page', html.includes('data-page="mentions"'));
check('index.html exposes account selector', html.includes('id="mentionsAccountSelect"'));
check('index.html exposes count label', html.includes('id="mentionsCount"'));
check('index.html exposes feed container', html.includes('id="mentionsFeed"'));
check('index.html exposes blocker panel', html.includes('id="mentionsBlocker"'));
check('index.html exposes filters button', html.includes('id="mentionsFiltersButton"'));
check('index.html exposes AI draft context panel', html.includes('id="mentionsContext"') && html.includes('id="mentionsTone"'));
check('index.html exposes reply status line', html.includes('id="mentionsReplyStatus"'));
check('index.html exposes demo card template', html.includes('id="mentionsDemoCardTemplate"'));

const failed = checks.filter(c => !c.ok);
if (failed.length) {
  console.error(`\n${failed.length}/${checks.length} mentions verification checks failed`);
  process.exit(1);
}
console.log(`\n${checks.length}/${checks.length} mentions verification checks passed`);
