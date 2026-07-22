// Token-leak check for the X history backfill feature.
//
// Scans:
//   1. Static assets served by tweet-lab (index.html, app.js, styles.css,
//      any lib/*.js) for credential-shaped strings.
//   2. Live HTTP responses from the new /api/tweet-lab/x-history/* routes
//      for credential-shaped strings in headers + body.
//   3. The configured persisted Tweet Lab data file
//      file (it is not served to the browser, but a leak here would
//      surface in the next export call).
//
// What we look for:
//   - Bearer <token> shapes.
//   - xai- / sk- / eyJ* JWT-style prefixes with the right length.
//   - Postiz API key strings.
//   - 1Password service-account token prefixes (ops_ey...).
//   - 25+ char alphanumeric runs flagged by the same regex the diagnostics
//     module uses.
//
// Exit 0 when clean, 1 on first match. The output is structured so a CI
// run can surface the leak file/line directly.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_FILE = join(ROOT, 'data', 'tweet-lab.json');

const BEARER_HEADERS = ['authorization', 'x-bearer', 'bearer', 'postiz-api-key', 'postiz-token', 'x-api-key', 'api-key', 'token', 'secret', 'password', 'private-key', 'client-secret', 'access-token', 'refresh-token', 'op-service-account-token'];

const PATTERNS = [
  { name: 'Bearer header value', regex: /Bearer\s+[A-Za-z0-9._~+\/-]{20,}/g },
  { name: 'OpenAI / xai-style key', regex: /\b(?:sk-|xai-)[A-Za-z0-9_-]{20,}/g },
  { name: 'JWT', regex: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g },
  { name: '1Password service account token', regex: /\bops_ey[A-Za-z0-9._~+\/-]{40,}/g },
  { name: 'X bearer token (long alphanumeric, not flagged as Bearer)', regex: /\bAAA[A-Za-z0-9_-]{30,}\b/g }
];

const findings = [];

function record(label, location, match) {
  findings.push({ label, location, match });
  console.error(`LEAK  ${label}\n  at: ${location}\n  match: ${match}`);
}

function scanString(label, location, text) {
  for (const pattern of PATTERNS) {
    pattern.regex.lastIndex = 0;
    const m = pattern.regex.exec(text);
    if (m) {
      record(label, location, `${pattern.name}: ${m[0].slice(0, 24)}...`);
      return;
    }
  }
}

function scanJson(label, location, value) {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    scanString(label, location, value);
    return;
  }
  if (typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const key = `[${i}]`;
      const child = value[i];
      if (BEARER_HEADERS.includes(String(key).toLowerCase())) {
        if (typeof child === 'string') {
          record(label, `${location}${key}`, `sensitive key: ${child.slice(0, 24)}...`);
        }
        continue;
      }
      scanJson(label, `${location}${key}.`, child);
    }
    return;
  }
  for (const [k, v] of Object.entries(value)) {
    const childLoc = `${location}${k}.`;
    if (BEARER_HEADERS.includes(String(k).toLowerCase())) {
      if (typeof v === 'string') {
        record(label, childLoc, `sensitive key "${k}": ${v.slice(0, 24)}...`);
        continue;
      }
      if (v && typeof v === 'object') {
        record(label, childLoc, `sensitive key "${k}" with non-string value`);
        continue;
      }
    }
    scanJson(label, childLoc, v);
  }
}

function walkDir(dir, visitor) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkDir(full, visitor);
    } else if (stat.isFile()) {
      visitor(full);
    }
  }
}

function scanStaticAssets() {
  const targets = ['app.js', 'index.html', 'styles.css', 'server.js'];
  for (const file of targets) {
    const full = join(ROOT, file);
    try {
      const text = readFileSync(full, 'utf8');
      scanString(`static:${file}`, full, text);
    } catch (err) {
      if (err && err.code !== 'ENOENT') console.error(`skip ${file}: ${err.message}`);
    }
  }
  walkDir(join(ROOT, 'lib'), (file) => {
    if (!file.endsWith('.js')) return;
    const text = readFileSync(file, 'utf8');
    scanString(`lib:${path.basename(file)}`, file, text);
  });
}

function scanDataFile() {
  try {
    const text = readFileSync(DATA_FILE, 'utf8');
    let parsed;
    try { parsed = JSON.parse(text); } catch {
      console.error('data file is not valid JSON; aborting scan');
      return;
    }
    scanJson('persisted:data/tweet-lab.json', '', parsed);
  } catch (err) {
    if (err && err.code === 'ENOENT') return;
    console.error(`data file read error: ${err.message}`);
  }
}

const BASE_URL = process.env.TWEET_LAB_URL || 'http://127.0.0.1:4173';

async function scanLiveEndpoints() {
  const endpoints = [
    { method: 'GET', path: '/api/tweet-lab/config' },
    { method: 'GET', path: '/api/tweet-lab/diagnostics' },
    { method: 'GET', path: '/api/tweet-lab/context' },
    // /generate exercises the sourcePacket path (which carries context
    // material) and the candidate normalizer. A valid body avoids the 400
    // short-circuit so we actually scan a generated response.
    { method: 'POST', path: '/api/tweet-lab/generate', body: { inspirationLinks: ['https://fxtwitter.com/example/status/1'], context: 'leak-scan probe', tone: 'sharp', count: 1 } },
    { method: 'GET', path: '/api/tweet-lab/x-history/status' },
    { method: 'POST', path: '/api/tweet-lab/x-history/fetch', body: {} },
    { method: 'POST', path: '/api/tweet-lab/x-history/backfill', body: { maxPages: 1, maxTweets: 10 } },
    { method: 'GET', path: '/api/tweet-lab/x-history/list' }
  ];
  for (const ep of endpoints) {
    let response;
    try {
      response = await fetch(`${BASE_URL}${ep.path}`, {
        method: ep.method,
        headers: ep.body ? { 'content-type': 'application/json' } : undefined,
        body: ep.body ? JSON.stringify(ep.body) : undefined
      });
    } catch (err) {
      console.error(`live scan: ${ep.path} failed: ${err.message}`);
      continue;
    }
    for (const [k, v] of response.headers.entries()) {
      if (BEARER_HEADERS.includes(k.toLowerCase()) || /token|secret|key|password|auth/i.test(k)) {
        record(`live:${ep.path}`, `header:${k}`, `${k}: ${String(v).slice(0, 24)}...`);
      }
    }
    let body = null;
    const text = await response.text();
    try { body = JSON.parse(text); } catch { body = text; }
    scanJson(`live:${ep.path}`, '', body);
  }
}

(async () => {
  scanStaticAssets();
  scanDataFile();
  await scanLiveEndpoints();
  if (findings.length) {
    console.error(`\nFAIL: ${findings.length} potential token leak(s) detected.`);
    process.exit(1);
  }
  console.log('OK: no token-shaped strings found in static assets, persisted data, or live responses (/config, /diagnostics, /context, /generate, /x-history/*).');
})();
