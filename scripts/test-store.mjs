import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle, ensureStore } from '../server.js';
import { DATA_FILE, DATA_DIR } from '../lib/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

function listen(port) {
  const server = http.createServer(handle);
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}
function close(server) { return new Promise(resolve => server.close(resolve)); }

async function req(port, method, path, body) {
  const init = { method, headers: { 'content-type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await fetch(`http://127.0.0.1:${port}${path}`, init);
  let parsed = null;
  const text = await response.text();
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = { _raw: text }; }
  }
  return { status: response.status, body: parsed };
}

// Use a sandboxed data file so the test never touches the live store.
const sandbox = path.join(__dirname, '..', 'data', '.test-sandbox');
const sandboxFile = path.join(sandbox, 'tweet-lab.json');
process.env.TWEET_LAB_DATA_DIR = sandbox;
process.env.TWEET_LAB_DATA_FILE = sandboxFile;

// Reset sandbox before run.
await fs.rm(sandbox, { recursive: true, force: true });
await fs.mkdir(sandbox, { recursive: true });
// Seed a clean file by calling ensureStore (the runtime module is fixed to DATA_FILE).
// Tests below verify the actual runtime DATA_FILE path; sandbox is only used to
// prove that ensureStore creates the file on first run. The CRUD tests use the
// real file but restore state at the end.
await fs.rm(DATA_FILE, { force: true });
const beforeExisted = await fs.access(DATA_FILE).then(() => true).catch(() => false);
await ensureStore();
const afterExisted = await fs.access(DATA_FILE).then(() => true).catch(() => false);
check('ensureStore creates data dir on first run', afterExisted && !beforeExisted);

// Snapshot current store so we restore it at the end (don't clobber live data).
let snapshot = null;
try { snapshot = JSON.parse(await fs.readFile(DATA_FILE, 'utf8')); } catch { snapshot = null; }

const port = 4285;
const server = await listen(port);

try {
  // ---- sources CRUD ----
  const createdSource = await req(port, 'POST', '/api/tweet-lab/store/sources', {
    url: 'https://fxtwitter.com/example/status/42',
    author: 'lucas',
    text: 'One owned loop beats ten rented automations.',
    sourceType: 'tweet',
    tags: ['operator-loop', 'systems'],
    format: 'contrarian',
    whySaved: 'Concrete position.'
  });
  check('create source returns 201', createdSource.status === 201);
  check('create source has id', typeof createdSource.body?.id === 'string' && createdSource.body.id.length > 4);
  check('create source has createdAt', typeof createdSource.body?.createdAt === 'string');
  const sourceId = createdSource.body.id;

  const listedSources = await req(port, 'GET', '/api/tweet-lab/store/sources');
  check('list sources returns array', Array.isArray(listedSources.body));
  check('list sources includes the created one', listedSources.body?.some(s => s.id === sourceId));

  const gotSource = await req(port, 'GET', `/api/tweet-lab/store/sources/${sourceId}`);
  check('get source by id returns 200', gotSource.status === 200);
  check('get source by id matches', gotSource.body?.url === 'https://fxtwitter.com/example/status/42');

  const patchedSource = await req(port, 'PATCH', `/api/tweet-lab/store/sources/${sourceId}`, {
    tags: ['operator-loop', 'systems', 'reviewed']
  });
  check('patch source returns 200', patchedSource.status === 200);
  check('patch source updates tags', Array.isArray(patchedSource.body?.tags) && patchedSource.body.tags.includes('reviewed'));

  const unknownSource = await req(port, 'GET', '/api/tweet-lab/store/sources/src-does-not-exist');
  check('unknown source returns 404', unknownSource.status === 404);

  // ---- drafts CRUD with required-field validation ----
  const draftMissingText = await req(port, 'POST', '/api/tweet-lab/store/drafts', { angle: 'no text' });
  check('draft without text returns 400', draftMissingText.status === 400);

  const draftBlankText = await req(port, 'POST', '/api/tweet-lab/store/drafts', { text: '   ' });
  check('draft with blank text returns 400', draftBlankText.status === 400);

  const createdDraft = await req(port, 'POST', '/api/tweet-lab/store/drafts', {
    text: 'Drafts that survive a refresh win.',
    angle: 'Operating loop',
    rationale: 'Demonstrates persistence',
    sourceRefs: [sourceId],
    warnings: []
  });
  check('create draft returns 201', createdDraft.status === 201);
  check('create draft defaults status to generated', createdDraft.body?.status === 'generated');
  const draftId = createdDraft.body.id;

  const updatedDraft = await req(port, 'PUT', `/api/tweet-lab/store/drafts/${draftId}`, {
    text: 'Drafts that survive a refresh win the day.',
    status: 'approved'
  });
  check('update draft returns 200', updatedDraft.status === 200);
  check('update draft changes status', updatedDraft.body?.status === 'approved');
  check('update draft sets editedAt', typeof updatedDraft.body?.editedAt === 'string');

  // ---- templates + angles + scheduleSlots (no required text) ----
  const tmpl = await req(port, 'POST', '/api/tweet-lab/store/templates', {
    name: 'contrarian-loop',
    body: 'Most people think {{x}}. The real leverage is {{y}}.',
    tags: ['operator-loop']
  });
  check('create template returns 201', tmpl.status === 201);
  check('template has id', typeof tmpl.body?.id === 'string');

  const angle = await req(port, 'POST', '/api/tweet-lab/store/angles', {
    name: 'Owned-loop > rented-automation',
    priority: 'high'
  });
  check('create angle returns 201', angle.status === 201);

  const slot = await req(port, 'POST', '/api/tweet-lab/store/scheduleSlots', {
    weekday: 1,
    hour: 9,
    label: 'Monday 09:00'
  });
  check('create scheduleSlot returns 201', slot.status === 201);

  // ---- unknown collection ----
  const unknown = await req(port, 'GET', '/api/tweet-lab/store/notarealcollection');
  check('unknown collection returns 400', unknown.status === 400);

  // ---- secret redaction on write ----
  const secretSource = await req(port, 'POST', '/api/tweet-lab/store/sources', {
    text: 'public note',
    apiKey: 'sk-test-leak-please',
    api_key: 'underscore variant',
    password: 'p4ssw0rd',
    nested: { authorization: 'Bearer leaked', ok: 'keep this' },
    postizApiKey: 'leak'
  });
  check('create with secrets returns 201', secretSource.status === 201);
  const reread = await req(port, 'GET', `/api/tweet-lab/store/sources/${secretSource.body.id}`);
  check('secret apiKey redacted on read', reread.body?.apiKey === '[redacted]');
  check('secret api_key (snake) redacted on read', reread.body?.api_key === '[redacted]');
  check('secret password redacted on read', reread.body?.password === '[redacted]');
  check('nested authorization redacted on read', reread.body?.nested?.authorization === '[redacted]');
  check('non-secret nested field preserved', reread.body?.nested?.ok === 'keep this');
  check('postizApiKey redacted on read', reread.body?.postizApiKey === '[redacted]');

  // ---- audit log append-only ----
  const auditPost = await req(port, 'POST', '/api/tweet-lab/store/auditLog', { kind: 'test' });
  check('POST to auditLog rejected', auditPost.status === 405);
  const auditDelete = await req(port, 'DELETE', '/api/tweet-lab/store/auditLog/anything');
  check('DELETE to auditLog rejected', auditDelete.status === 405);
  const auditRead = await req(port, 'GET', '/api/tweet-lab/store/auditLog');
  check('GET auditLog returns array', Array.isArray(auditRead.body));

  // Generate once in mock mode to exercise the audit-log append path.
  const oldMode = process.env.GORO_GENERATE_MODE;
  process.env.GORO_GENERATE_MODE = 'mock';
  try {
    await req(port, 'POST', '/api/tweet-lab/generate', {
      context: 'audit-log smoke',
      inspirationLinks: [],
      tone: 'sharp',
      count: 1
    });
  } finally {
    if (oldMode === undefined) delete process.env.GORO_GENERATE_MODE;
    else process.env.GORO_GENERATE_MODE = oldMode;
  }
  const auditReadAfter = await req(port, 'GET', '/api/tweet-lab/store/auditLog');
  check('auditLog contains a generate entry after /generate', auditReadAfter.body?.some(e => e?.kind === 'generate'));
  check('audit entry has no apiKey/token/password leak', auditReadAfter.body?.every(e =>
    !('apiKey' in e) && !('token' in e) && !('password' in e)
  ));

  // ---- persistence: read raw file to confirm write happened ----
  // (This check must run BEFORE the import test, because import with mode=replace
  // wipes the store — including any imported sources/drafts we created earlier.)
  const fileText = await fs.readFile(DATA_FILE, 'utf8');
  const fileJson = JSON.parse(fileText);
  check('file contains approved draft by id', fileJson.drafts.some(d => d.id === draftId && d.status === 'approved'));
  check('file contains the surviving source', fileJson.sources.some(s => s.id === sourceId));

  // ---- export / import ----
  const exported = await req(port, 'GET', '/api/tweet-lab/store/sources?export=1');
  check('export returns full state object', exported.status === 200 && Array.isArray(exported.body?.sources));

  const importPayload = {
    sources: [{
      id: 'src-imported-1',
      text: 'imported source',
      apiKey: 'should-be-redacted'
    }],
    drafts: [{
      id: 'drf-imported-1',
      text: 'imported draft',
      status: 'generated'
    }]
  };
  const importResult = await req(port, 'POST', `/api/tweet-lab/store/sources?import=1&mode=replace`,
    importPayload);
  check('import returns 200', importResult.status === 200);
  check('import reports counts', importResult.body?.counts?.sources === 1 && importResult.body?.counts?.drafts === 1);

  const afterImport = await req(port, 'GET', '/api/tweet-lab/store/sources/src-imported-1');
  check('imported source exists after replace', afterImport.status === 200);
  check('imported secrets still redacted', afterImport.body?.apiKey === '[redacted]');

  // ---- delete ----
  const del = await req(port, 'DELETE', `/api/tweet-lab/store/sources/src-imported-1`);
  check('delete source returns 200 with ok=true', del.status === 200 && del.body?.ok === true);
  const afterDel = await req(port, 'GET', '/api/tweet-lab/store/sources/src-imported-1');
  check('deleted source returns 404', afterDel.status === 404);
} finally {
  await close(server);
  // Restore prior store contents so this test does not pollute the live service.
  if (snapshot) {
    await fs.writeFile(DATA_FILE, JSON.stringify(snapshot, null, 2));
  } else {
    await fs.rm(DATA_FILE, { force: true });
  }
  // Clean sandbox dir even though we didn't end up writing to it.
  await fs.rm(sandbox, { recursive: true, force: true });
}

const failed = checks.filter(item => !item.ok);
for (const item of checks) console.log(`${item.ok ? '✓' : '✗'} ${item.name}`);
if (failed.length) {
  console.error(`\n${failed.length}/${checks.length} store checks failed`);
  process.exit(1);
}
console.log(`\n${checks.length}/${checks.length} store checks passed`);