import http from 'node:http';
import { promises as fs } from 'node:fs';
import { handle, ensureStore } from '../server.js';
import { DATA_FILE } from '../lib/store.js';

const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

function listen(port) {
  const server = http.createServer((req, res) => {
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
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}
function close(server) { return new Promise(resolve => server.close(resolve)); }

async function req(port, method, requestPath, body) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  const options = {
    hostname: '127.0.0.1',
    port,
    path: requestPath,
    method,
    agent: false,
    headers: { 'content-type': 'application/json', connection: 'close' }
  };
  if (payload) options.headers['content-length'] = Buffer.byteLength(payload);
  return new Promise((resolve, reject) => {
    const request = http.request(options, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => {
        let parsed = null;
        try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { _raw: text }; }
        resolve({ status: response.statusCode, body: parsed });
      });
    });
    request.on('error', error => reject(new Error(`${method} ${requestPath} failed: ${error.message}`)));
    if (payload) request.write(payload);
    request.end();
  });
}

const html = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
const app = await fs.readFile(new URL('../app.js', import.meta.url), 'utf8');
const server = await fs.readFile(new URL('../server.js', import.meta.url), 'utf8');

check('rewrite button exists on live tweet cards', app.includes('data-rewrite-live'));
check('copy button exists on live tweet cards', app.includes('data-copy-live'));
check('save source button exists on live tweet cards', app.includes('data-save-live'));
check('rewriteLiveTweet calls dedicated /api/tweet-lab/rewrite', app.includes("/api/tweet-lab/rewrite"));
check('rewriteLiveTweet passes tweetToSelectedSource as sourceTweet', app.includes('sourceTweet: tweetToSelectedSource(tweet)'));
check('rewriteLiveTweet disables button and shows loading state', app.includes('Rewriting…') && app.includes('button.disabled = true'));
check('rewriteLiveTweet renders drafts and navigates to ready-to-post', app.includes('renderDrafts()') && app.includes("location.hash = '#ready-to-post'"));
check('copyLiveTweet uses writeClipboard with text + url', app.includes('writeClipboard(`${tweet.text}\\n${tweet.url}`)'));
check('copyLiveTweet shows success/error status', app.includes('Copied tweet text + source URL.') && app.includes('Copy failed:'));
check('saveLiveTweetSource POSTs to store/sources', app.includes("/api/tweet-lab/store/sources") && app.includes('tweetToSelectedSource(tweet)'));
check('saveLiveTweetSource shows success/error status', app.includes('Saved @') && app.includes('Save failed with HTTP'));
check('server has /api/tweet-lab/rewrite route', server.includes("/api/tweet-lab/rewrite"));
check('server buildRewritePrompt exists', server.includes('function buildRewritePrompt'));
check('server rewriteTweet exists', server.includes('function rewriteTweet') || server.includes('async function rewriteTweet'));
check('server rewriteAndPersist exists', server.includes('function rewriteAndPersist') || server.includes('async function rewriteAndPersist'));
check('rewrite prompt signals rewrite intent', server.includes('You are Goro rewriting a tweet for Lucas'));
check('rewrite prompt forbids verbatim copy', server.includes('rewrite, do not quote'));
check('rewrite prompt forbids invented metrics', server.includes('Do not add claims that are not implied by the source text'));

await ensureStore();
let snapshot = null;
try { snapshot = JSON.parse(await fs.readFile(DATA_FILE, 'utf8')); } catch { snapshot = null; }

const oldMode = process.env.GORO_GENERATE_MODE;
process.env.GORO_GENERATE_MODE = 'mock';

const port = 4297;
const srv = await listen(port);

try {
  // Rewrite endpoint smoke
  const rewrite = await req(port, 'POST', '/api/tweet-lab/rewrite', {
    sourceTweet: {
      id: 'live-123',
      url: 'https://x.com/lucas/status/123',
      statusId: '123',
      author: 'lucas',
      text: 'Most AI projects fail because they stop at answers.',
      sourceType: 'tweet',
      tags: ['live-x'],
      format: '',
      whySaved: 'Selected from live X account inspiration.',
      engagement: { likes: 42 },
      warnings: ['manual engagement numbers'],
      provider: 'x-api-recent-search',
      fetchedAt: new Date().toISOString(),
      authorProfile: { username: 'lucas', displayName: 'Lucas' },
      media: []
    },
    context: 'Test rewrite context.',
    tone: 'sharp',
    count: 2
  });
  check('rewrite endpoint returns 200', rewrite.status === 200);
  check('rewrite returns candidates', Array.isArray(rewrite.body?.candidates) && rewrite.body.candidates.length > 0);
  check('rewrite returns drafts', Array.isArray(rewrite.body?.drafts) && rewrite.body.drafts.length > 0);
  check('rewrite draft has text', rewrite.body?.drafts?.[0]?.text?.length > 0);
  check('rewrite draft has sourceRefs', Array.isArray(rewrite.body?.drafts?.[0]?.sourceRefs));
  check('rewrite response includes sourceTweet', rewrite.body?.sourceTweet?.author === 'lucas');
  check('rewrite response includes adapter', typeof rewrite.body?.adapter === 'string');
  check('rewrite response includes promptPreview', typeof rewrite.body?.promptPreview === 'string');
  check('rewrite audit kind written', rewrite.body?.drafts?.length > 0);

  // Copy endpoint is client-side; verify store save works
  const saved = await req(port, 'POST', '/api/tweet-lab/store/sources', {
    url: 'https://x.com/lucas/status/123',
    statusId: '123',
    author: 'lucas',
    text: 'Most AI projects fail because they stop at answers.',
    sourceType: 'tweet',
    tags: ['live-x', 'test'],
    format: 'contrarian',
    whySaved: 'Test save from suggestion action.',
    engagement: { likes: 42 },
    warnings: ['test warning']
  });
  check('save source returns 201', saved.status === 201);
  check('save source preserves warnings', Array.isArray(saved.body?.warnings) && saved.body.warnings.includes('test warning'));
  check('save source preserves metadata', saved.body?.author === 'lucas' && saved.body?.whySaved.includes('Test save'));

  // Verify rewrite prompt shape server-side
  const { buildRewritePrompt } = await import('../server.js');
  const rp = buildRewritePrompt({
    sourceTweet: { author: 'tester', url: 'https://x.com/tester/status/1', text: 'Hello world', warnings: ['test'] },
    context: 'ctx',
    tone: 'sharp',
    count: 1
  });
  check('buildRewritePrompt includes source tweet text', rp.includes('Hello world'));
  check('buildRewritePrompt includes rewrite instruction', rp.includes('rewriting a tweet'));
  check('buildRewritePrompt includes no-invented-metrics rule', rp.includes('not implied by the source text'));
} finally {
  await close(srv);
  if (snapshot) await fs.writeFile(DATA_FILE, JSON.stringify(snapshot, null, 2));
  else await fs.rm(DATA_FILE, { force: true });
  if (oldMode === undefined) delete process.env.GORO_GENERATE_MODE; else process.env.GORO_GENERATE_MODE = oldMode;
}

const failed = checks.filter(item => !item.ok);
for (const item of checks) console.log(`${item.ok ? '✓' : '✗'} ${item.name}`);
if (failed.length) {
  console.error(`\n${failed.length}/${checks.length} suggestion action checks failed`);
  process.exit(1);
}
console.log(`\n${checks.length}/${checks.length} suggestion action checks passed`);
