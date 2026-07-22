import http from 'node:http';
import { handle } from '../server.js';

function listen(port) {
  const server = http.createServer(handle);
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

const oldMode = process.env.GORO_GENERATE_MODE;
const oldUrl = process.env.GORO_GENERATE_URL;
process.env.GORO_GENERATE_MODE = 'mock';
delete process.env.GORO_GENERATE_URL;

const port = 4283;
const server = await listen(port);
const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

try {
  const configRes = await fetch(`http://127.0.0.1:${port}/api/tweet-lab/config`);
  const config = await configRes.json();
  check('config reports mock mode', config.goroMode === 'mock');
  check('config reports mockModeForced true', config.mockModeForced === true);

  const ok = await request(port, '/api/tweet-lab/generate', {
    inspirationLinks: ['https://fxtwitter.com/example/status/1'],
    context: 'Position Applied Leverage as one owned AI operating loop in 30 days.',
    tone: 'sharp and grounded',
    count: 2
  });
  check('generate returns HTTP 200', ok.status === 200);
  check('uses mock adapter explicitly', ok.json.adapter === 'mock');
  check('mockModeForced is true', ok.json.mockModeForced === true);
  check('returns candidates array', Array.isArray(ok.json.candidates) && ok.json.candidates.length === 2);
  check('candidate has tweet text', typeof ok.json.candidates?.[0]?.text === 'string' && ok.json.candidates[0].text.length > 20);
  check('sourcePacket includes inspiration links', Array.isArray(ok.json.sourcePacket?.inspirationLinks) && ok.json.sourcePacket.inspirationLinks.length === 1);
  check('sourcePacket includes resolved tweets array', Array.isArray(ok.json.sourcePacket?.resolvedTweets));
  check('prompt preview includes context', ok.json.promptPreview.includes('Applied Leverage'));

  const invalid = await request(port, '/api/tweet-lab/generate', { inspirationLinks: [], context: '' });
  check('empty generate is clean 400', invalid.status === 400 && /inspiration link|context note|source cards/.test(invalid.json.error));
} finally {
  await close(server);
  if (oldMode === undefined) delete process.env.GORO_GENERATE_MODE;
  else process.env.GORO_GENERATE_MODE = oldMode;
  if (oldUrl === undefined) delete process.env.GORO_GENERATE_URL;
  else process.env.GORO_GENERATE_URL = oldUrl;
}

const failed = checks.filter(item => !item.ok);
for (const item of checks) console.log(`${item.ok ? '✓' : '✗'} ${item.name}`);
if (failed.length) {
  console.error(`\n${failed.length}/${checks.length} mock generation checks failed`);
  process.exit(1);
}
console.log(`\n${checks.length}/${checks.length} mock generation checks passed`);
