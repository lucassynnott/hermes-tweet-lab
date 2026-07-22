import http from 'node:http';
import { handle } from '../server.js';

function listen(app, port) {
  const server = http.createServer(app);
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

function close(server) {
  return new Promise(resolve => server.close(resolve));
}

async function request(port, path, payload) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await response.json();
  return { status: response.status, json };
}

const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });
const oldKey = process.env.POSTIZ_API_KEY;
const oldUrl = process.env.POSTIZ_API_URL;
const oldIntegration = process.env.POSTIZ_X_INTEGRATION_ID;

let captured = null;
const fakePostiz = await listen(async (req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    captured = {
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      body: JSON.parse(body || '{}')
    };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'postiz-test-1', ok: true }));
  });
}, 4291);

process.env.POSTIZ_API_URL = 'http://127.0.0.1:4291';
process.env.POSTIZ_API_KEY = 'test-postiz-key';
process.env.POSTIZ_X_INTEGRATION_ID = 'integration-default';
const appServer = await listen(handle, 4292);

try {
  const scheduledAt = new Date(Date.now() + 90 * 60 * 1000).toISOString();
  const ok = await request(4292, '/api/tweet-lab/schedule', {
    content: 'Build the loop before you buy another tool.',
    scheduledAt,
    timezone: 'UTC',
    settings: { source: 'tweet-lab-test' }
  });
  check('schedule returns HTTP 200 with fake Postiz', ok.status === 200 && ok.json.ok === true);
  check('Postiz path is /public/v1/posts', captured?.url === '/public/v1/posts');
  check('Postiz auth is server-side raw API key', captured?.authorization === 'test-postiz-key');
  check('Postiz payload includes scheduled ISO date', captured?.body?.date === scheduledAt);
  check('Postiz payload includes integration id', captured?.body?.posts?.[0]?.integration?.id === 'integration-default');
  check('Postiz payload includes tweet content', captured?.body?.posts?.[0]?.value?.[0]?.content === 'Build the loop before you buy another tool.');

  const invalid = await request(4292, '/api/tweet-lab/schedule', {
    content: '',
    scheduledAt,
    integrationId: 'integration-default'
  });
  check('empty content returns 400', invalid.status === 400 && /Post content/.test(invalid.json.error));
} finally {
  await close(appServer);
  await close(fakePostiz);
  if (oldKey === undefined) delete process.env.POSTIZ_API_KEY; else process.env.POSTIZ_API_KEY = oldKey;
  if (oldUrl === undefined) delete process.env.POSTIZ_API_URL; else process.env.POSTIZ_API_URL = oldUrl;
  if (oldIntegration === undefined) delete process.env.POSTIZ_X_INTEGRATION_ID; else process.env.POSTIZ_X_INTEGRATION_ID = oldIntegration;
}

const failed = checks.filter(item => !item.ok);
for (const item of checks) console.log(`${item.ok ? '✓' : '✗'} ${item.name}`);
if (failed.length) {
  console.error(`\n${failed.length}/${checks.length} schedule checks failed`);
  process.exit(1);
}
console.log('\nSchedule integration tests passed');
