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
  const init = { method, headers: { 'content-type': 'application/json', connection: 'close' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await fetch(`http://127.0.0.1:${port}${requestPath}`, init);
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { _raw: text }; }
  return { status: response.status, body: parsed };
}

const html = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
const app = await fs.readFile(new URL('../app.js', import.meta.url), 'utf8');
const css = await fs.readFile(new URL('../styles.css', import.meta.url), 'utf8');
const packageJson = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));

check('Ready-To-Post nav label exists', html.includes('Ready-To-Post') && html.includes('data-route="drafts"'));
check('draft feed has tab filter', html.includes('data-draft-tab="all"') && app.includes('matchesDraftTab'));
check('draft feed has lifecycle action buttons', app.includes('approveDraft') && app.includes('rejectDraft') && app.includes('saveDraftEdit'));
check('draft cards render reject reason', app.includes('rejectReason'));
check('draft status pills styled', css.includes('.pill.status-approved') && css.includes('.pill.status-rejected'));
check('package exposes test:drafts', packageJson.scripts?.['test:drafts'] === 'node scripts/test-draft-lifecycle.mjs');

await ensureStore();
let snapshot = null;
try { snapshot = JSON.parse(await fs.readFile(DATA_FILE, 'utf8')); } catch { snapshot = null; }

const oldMode = process.env.GORO_GENERATE_MODE;
const oldKey = process.env.POSTIZ_API_KEY;
const oldUrl = process.env.POSTIZ_API_URL;
const oldIntegration = process.env.POSTIZ_X_INTEGRATION_ID;
process.env.GORO_GENERATE_MODE = 'mock';

let capturedPostiz = null;
const fakePostiz = await listen(4296);
fakePostiz.removeAllListeners('request');
fakePostiz.on('request', (req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    capturedPostiz = { url: req.url, body: JSON.parse(body || '{}') };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'postiz-draft-life-1', ok: true }));
  });
});
process.env.POSTIZ_API_URL = 'http://127.0.0.1:4296';
process.env.POSTIZ_API_KEY = 'test-postiz-key';
process.env.POSTIZ_X_INTEGRATION_ID = 'integration-default';

const port = 4295;
const server = await listen(port);

try {
  const generated = await req(port, 'POST', '/api/tweet-lab/generate', {
    context: 'Persist generated drafts into the ready-to-post feed.',
    inspirationLinks: [],
    tone: 'sharp',
    count: 2
  });
  check('generate persists candidates as drafts', generated.status === 200 && generated.body?.drafts?.length === generated.body?.candidates?.length);
  const draftId = generated.body?.drafts?.[0]?.id;
  check('persisted generated draft defaults to generated status', generated.body?.drafts?.[0]?.status === 'generated');

  const afterGenerate = await req(port, 'GET', `/api/tweet-lab/store/drafts/${draftId}`);
  check('generated draft can be reloaded from store', afterGenerate.status === 200 && afterGenerate.body?.id === draftId);

  const approved = await req(port, 'POST', `/api/tweet-lab/drafts/${draftId}/transition`, { status: 'approved' });
  check('transition to approved returns draft', approved.status === 200 && approved.body?.draft?.status === 'approved');
  check('transition writes audit entry', approved.body?.audit?.kind === 'draft.status' && approved.body.audit.toStatus === 'approved');

  const rejectedMissingReason = await req(port, 'POST', `/api/tweet-lab/drafts/${draftId}/transition`, { status: 'rejected' });
  check('reject without reason is blocked', rejectedMissingReason.status === 400 && /reason/i.test(rejectedMissingReason.body?.error || ''));

  const rejected = await req(port, 'POST', `/api/tweet-lab/drafts/${draftId}/transition`, { status: 'rejected', rejectReason: 'Too generic for Lucas.' });
  check('transition to rejected stores reason', rejected.status === 200 && rejected.body?.draft?.status === 'rejected' && rejected.body.draft.rejectReason === 'Too generic for Lucas.');

  const edited = await req(port, 'POST', `/api/tweet-lab/drafts/${draftId}/edit`, { text: 'Edited draft with a sharper operator hook.', angle: 'Sharper hook' });
  check('edit draft updates text and audit', edited.status === 200 && edited.body?.draft?.text === 'Edited draft with a sharper operator hook.' && edited.body?.audit?.kind === 'draft.edit');

  const approvedAgain = await req(port, 'POST', `/api/tweet-lab/drafts/${draftId}/transition`, { status: 'approved' });
  check('re-approve edited draft works', approvedAgain.status === 200 && approvedAgain.body?.draft?.status === 'approved');

  const scheduledAt = new Date(Date.now() + 90 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const scheduled = await req(port, 'POST', '/api/tweet-lab/schedule', { draftId, scheduledAt, timezone: 'UTC' });
  check('schedule can consume approved draftId', scheduled.status === 200 && scheduled.body?.ok === true && capturedPostiz?.body?.posts?.[0]?.value?.[0]?.content === 'Edited draft with a sharper operator hook.');
  const afterSchedule = await req(port, 'GET', `/api/tweet-lab/store/drafts/${draftId}`);
  check('schedule marks approved draft scheduled', afterSchedule.status === 200 && afterSchedule.body?.status === 'scheduled' && afterSchedule.body?.scheduledAt === scheduledAt && afterSchedule.body?.postizReceipt === '[redacted]');

  const raw = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
  check('audit log contains generated approved rejected edit scheduled entries', ['draft.generated', 'draft.status', 'draft.edit', 'schedule'].every(kind => raw.auditLog.some(entry => entry.kind === kind)));
} finally {
  await close(server);
  await close(fakePostiz);
  if (snapshot) await fs.writeFile(DATA_FILE, JSON.stringify(snapshot, null, 2));
  else await fs.rm(DATA_FILE, { force: true });
  if (oldMode === undefined) delete process.env.GORO_GENERATE_MODE; else process.env.GORO_GENERATE_MODE = oldMode;
  if (oldKey === undefined) delete process.env.POSTIZ_API_KEY; else process.env.POSTIZ_API_KEY = oldKey;
  if (oldUrl === undefined) delete process.env.POSTIZ_API_URL; else process.env.POSTIZ_API_URL = oldUrl;
  if (oldIntegration === undefined) delete process.env.POSTIZ_X_INTEGRATION_ID; else process.env.POSTIZ_X_INTEGRATION_ID = oldIntegration;
}

const failed = checks.filter(item => !item.ok);
for (const item of checks) console.log(`${item.ok ? '✓' : '✗'} ${item.name}`);
if (failed.length) {
  console.error(`\n${failed.length}/${checks.length} draft lifecycle checks failed`);
  process.exit(1);
}
console.log(`\n${checks.length}/${checks.length} draft lifecycle checks passed`);
