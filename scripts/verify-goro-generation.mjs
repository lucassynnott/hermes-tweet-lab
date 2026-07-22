import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { handle } from '../server.js';

const HERMES_BIN = process.env.HERMES_BIN || 'hermes';
const HERMES_PROFILE = process.env.GORO_HERMES_PROFILE || 'goro';

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

const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

// 1. Smoke: can the hermes binary reach the goro profile and return JSON?
let profileSmokeOk = false;
let profileSmokeReason = '';
try {
  const probe = spawnSync(HERMES_BIN, ['--profile', HERMES_PROFILE, 'chat', '-Q', '-q', 'Return JSON exactly: {"candidates":[{"id":"goro-1","text":"profile smoke","angle":"smoke","warnings":[]}]}'], {
    encoding: 'utf8',
    timeout: 90000,
    maxBuffer: 1024 * 1024
  });
  if (probe.error) throw probe.error;
  if (probe.status !== 0) throw new Error(`exit ${probe.status}: ${probe.stderr?.slice(0, 400)}`);
  const out = String(probe.stdout || '').trim();
  // Find the last JSON object in stdout (hermes prints session metadata first).
  const jsonStart = out.indexOf('{');
  if (jsonStart < 0) throw new Error('no JSON in stdout');
  const parsed = JSON.parse(out.slice(jsonStart));
  if (!parsed?.candidates?.[0]?.text) throw new Error('no candidates in JSON');
  profileSmokeOk = true;
} catch (error) {
  profileSmokeReason = error.message || String(error);
}

if (!profileSmokeOk) {
  console.error(`✗ goro profile smoke failed: ${profileSmokeReason}`);
  console.error('Skipping real Goro verification because the Hermes Goro profile is not reachable.');
  console.error('This is the expected skip path documented in the PRD; it does not fail the suite.');
  console.error('Run scripts/verify-mock-generation.mjs for offline verification.');
  process.exit(0);
}

check('goro profile smoke returns JSON', true);

// 2. Real adapter verification: bring up a server with mock mode OFF and http endpoint OFF.
const oldMode = process.env.GORO_GENERATE_MODE;
const oldUrl = process.env.GORO_GENERATE_URL;
delete process.env.GORO_GENERATE_MODE;
delete process.env.GORO_GENERATE_URL;
process.env.HERMES_BIN = HERMES_BIN;
process.env.GORO_HERMES_PROFILE = HERMES_PROFILE;

const port = 4284;
const server = await listen(port);

try {
  const configRes = await fetch(`http://127.0.0.1:${port}/api/tweet-lab/config`);
  const config = await configRes.json();
  check('config reports hermes adapter', config.goroMode === 'hermes');
  check('config reports mockModeForced false', config.mockModeForced === false);
  check('config reports goroProfile goro', config.goroProfile === 'goro');

  const ok = await request(port, '/api/tweet-lab/generate', {
    inspirationLinks: ['https://fxtwitter.com/example/status/1'],
    context: 'Position Applied Leverage as one owned AI operating loop in 30 days.',
    tone: 'sharp and grounded',
    count: 2
  });
  check('generate returns HTTP 200', ok.status === 200);
  check('adapter is hermes (not mock)', ok.json.adapter === 'hermes');
  check('mockModeForced is false', ok.json.mockModeForced === false);
  check('returns 2 candidates', Array.isArray(ok.json.candidates) && ok.json.candidates.length === 2);
  check('candidate has text', typeof ok.json.candidates?.[0]?.text === 'string' && ok.json.candidates[0].text.length > 20);
  check('sourcePacket includes inspiration links', Array.isArray(ok.json.sourcePacket?.inspirationLinks));
  check('sourcePacket includes resolved tweets array', Array.isArray(ok.json.sourcePacket?.resolvedTweets));
  check('prompt preview includes context', ok.json.promptPreview.includes('Applied Leverage'));
  check('goroProfile reported back', ok.json.goroProfile === 'goro');
} catch (error) {
  check('real adapter run completes', false);
  console.error('Real adapter run error:', error.message);
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
  console.error(`\n${failed.length}/${checks.length} real Goro checks failed`);
  process.exit(1);
}
console.log(`\n${checks.length}/${checks.length} real Goro checks passed`);
