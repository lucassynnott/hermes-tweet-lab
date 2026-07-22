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
const readme = await fs.readFile(new URL('../README.md', import.meta.url), 'utf8');

check('inspiration bank route exists', html.includes('data-page="bank"') && html.includes('data-route="bank"'));
check('bank form captures URL/manual note fields', html.includes('id="sourceUrl"') && html.includes('id="sourceText"') && html.includes('id="sourceWhySaved"'));
check('bank form captures metadata fields', html.includes('id="sourceAuthor"') && html.includes('id="sourceTags"') && html.includes('id="sourceFormat"') && html.includes('id="sourceEngagement"') && html.includes('id="sourceRiskNotes"'));
check('bank filters by tag author format text collection quality stale hook', html.includes('id="sourceSearch"') && html.includes('id="sourceTagFilter"') && html.includes('id="sourceAuthorFilter"') && html.includes('id="sourceFormatFilter"') && html.includes('id="sourceCollectionFilter"') && html.includes('id="sourceMinQualityFilter"') && html.includes('id="sourceStaleFilter"') && html.includes('id="sourceHookPatternFilter"'));
check('bank import/export controls exist', html.includes('id="exportSources"') && html.includes('id="importSources"') && html.includes('id="sourceImportJson"'));
check('bank JS loads and renders persisted sources', app.includes('loadSources') && app.includes('renderSources') && app.includes('/api/tweet-lab/store/sources'));
check('bank JS supports add edit delete', app.includes('saveSource') && app.includes('editSource') && app.includes('deleteSource'));
check('bank JS supports source import export', app.includes('exportSources') && app.includes('importSources'));
check('README documents Inspiration Bank JSON format', readme.includes('## Inspiration Bank') && readme.includes('"sourceType"') && readme.includes('"whySaved"'));

await ensureStore();
let snapshot = null;
try { snapshot = JSON.parse(await fs.readFile(DATA_FILE, 'utf8')); } catch { snapshot = null; }

const port = 4291;
let server = await listen(port);
let sourceId;
try {
  const created = await req(port, 'POST', '/api/tweet-lab/store/sources', {
    url: 'https://fxtwitter.com/lucas/status/123456789',
    statusId: '123456789',
    author: 'lucas',
    text: 'One owned loop beats ten rented automations.',
    sourceType: 'tweet',
    tags: ['operator-loop', 'systems'],
    format: 'contrarian',
    whySaved: 'Strong Applied Leverage positioning spine.',
    engagement: { likes: 42, reposts: 7 },
    warnings: ['manual engagement numbers'],
    collection: 'operators',
    qualityScore: 4,
    hookPattern: 'contrarian-take',
    stale: false,
    staleReason: '',
    riskNotes: 'Engagement numbers are manual estimates, not verified.'
  });
  check('API creates complete inspiration source', created.status === 201 && created.body?.url && created.body?.statusId === '123456789');
  check('API preserves source fields', created.body?.sourceType === 'tweet' && created.body?.format === 'contrarian' && created.body?.whySaved.includes('positioning'));
  check('API preserves quality metadata', created.body?.collection === 'operators' && created.body?.qualityScore === 4 && created.body?.hookPattern === 'contrarian-take' && created.body?.stale === false && created.body?.riskNotes?.includes('manual'));
  sourceId = created.body?.id;

  const patched = await req(port, 'PATCH', `/api/tweet-lab/store/sources/${sourceId}`, {
    tags: ['operator-loop', 'reviewed'],
    whySaved: 'Edited reason from UI.'
  });
  check('API edits source', patched.status === 200 && patched.body?.tags?.includes('reviewed') && patched.body?.whySaved === 'Edited reason from UI.');

  await close(server);
  server = await listen(port);
  const afterRestart = await req(port, 'GET', `/api/tweet-lab/store/sources/${sourceId}`);
  check('source persists after service restart', afterRestart.status === 200 && afterRestart.body?.id === sourceId && afterRestart.body?.author === 'lucas');

  const exported = await req(port, 'GET', '/api/tweet-lab/store/sources?export=1');
  check('source export returns full documented state', exported.status === 200 && Array.isArray(exported.body?.sources) && exported.body.sources.some(s => s.id === sourceId));

  const importPayload = {
    sources: [{
      id: 'src-bank-imported',
      url: '',
      statusId: '',
      author: 'manual',
      text: 'Imported manual source note.',
      sourceType: 'manual',
      tags: ['imported'],
      format: 'framework',
      whySaved: 'Import/export verification.',
      engagement: {},
      warnings: [],
      collection: 'test-collection',
      qualityScore: 3,
      hookPattern: 'framework-map',
      stale: false,
      riskNotes: 'Test import risk note'
    }]
  };
  const imported = await req(port, 'POST', '/api/tweet-lab/store/sources?import=1&mode=merge', importPayload);
  check('source import merge succeeds', imported.status === 200 && imported.body?.counts?.sources >= 2);
  const importedSource = await req(port, 'GET', '/api/tweet-lab/store/sources/src-bank-imported');
  check('imported source readable after import', importedSource.status === 200 && importedSource.body?.text === 'Imported manual source note.');
  check('import preserves quality metadata', importedSource.status === 200 && importedSource.body?.collection === 'test-collection' && importedSource.body?.qualityScore === 3);

  // Test useCount / lastUsedAt tracking via PATCH
  const tracked = await req(port, 'PATCH', `/api/tweet-lab/store/sources/${sourceId}`, { useCount: 3, lastUsedAt: '2026-06-01T00:00:00Z' });
  check('API tracks useCount and lastUsedAt', tracked.status === 200 && tracked.body?.useCount === 3 && tracked.body?.lastUsedAt === '2026-06-01T00:00:00Z');

  const del = await req(port, 'DELETE', `/api/tweet-lab/store/sources/${sourceId}`);
  check('API deletes source', del.status === 200 && del.body?.ok === true);
} finally {
  await close(server);
  if (snapshot) await fs.writeFile(DATA_FILE, JSON.stringify(snapshot, null, 2));
  else await fs.rm(DATA_FILE, { force: true });
}

const failed = checks.filter(item => !item.ok);
for (const item of checks) console.log(`${item.ok ? '✓' : '✗'} ${item.name}`);
if (failed.length) {
  console.error(`\n${failed.length}/${checks.length} Inspiration Bank checks failed`);
  process.exit(1);
}
console.log(`\n${checks.length}/${checks.length} Inspiration Bank checks passed`);
