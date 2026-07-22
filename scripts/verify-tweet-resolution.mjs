import { generateTweets, normalizeTweetUrl } from '../server.js';

const checks = [];
const check = (name, condition, detail = '') => checks.push({ name, ok: Boolean(condition), detail });

const cases = [
  ['https://x.com/lucas/status/1801234567890', { statusId: '1801234567890', author: 'lucas', url: 'https://fxtwitter.com/lucas/status/1801234567890' }],
  ['https://twitter.com/lucas/status/1801234567890?s=20', { statusId: '1801234567890', author: 'lucas', url: 'https://fxtwitter.com/lucas/status/1801234567890' }],
  ['https://fxtwitter.com/lucas/status/1801234567890/photo/1', { statusId: '1801234567890', author: 'lucas', url: 'https://fxtwitter.com/lucas/status/1801234567890' }],
  ['https://fixupx.com/lucas/status/1801234567890', { statusId: '1801234567890', author: 'lucas', url: 'https://fxtwitter.com/lucas/status/1801234567890' }],
  ['https://mobile.twitter.com/lucas/status/1801234567890', { statusId: '1801234567890', author: 'lucas', url: 'https://fxtwitter.com/lucas/status/1801234567890' }],
];

for (const [input, expected] of cases) {
  const actual = normalizeTweetUrl(input);
  check(`normalizes ${input}`, actual?.statusId === expected.statusId && actual?.author === expected.author && actual?.url === expected.url, JSON.stringify(actual));
}

check('rejects non-status URL', normalizeTweetUrl('https://x.com/lucas') === null);
check('rejects unsupported host', normalizeTweetUrl('https://example.com/lucas/status/1801234567890') === null);

const oldMode = process.env.GORO_GENERATE_MODE;
const oldUrl = process.env.GORO_GENERATE_URL;
process.env.GORO_GENERATE_URL = 'https://goro.local/generate';
delete process.env.GORO_GENERATE_MODE;

const originalFetch = globalThis.fetch;
const fetchCalls = [];
globalThis.fetch = async (url, options = {}) => {
  fetchCalls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
  if (String(url).startsWith('https://fxtwitter.com/lucas/status/1801234567890')) {
    return new Response('<html><head><meta property="og:description" content="Resolved fixture tweet text from fxtwitter metadata"></head></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  }
  if (String(url).startsWith('https://fxtwitter.com/i/status/999999999999')) {
    return new Response('not found', { status: 404 });
  }
  if (String(url) === 'https://goro.local/generate') {
    const body = JSON.parse(options.body || '{}');
    return new Response(JSON.stringify({
      candidates: [{
        id: 'fixture-1',
        text: 'A draft generated from a source packet fixture.',
        angle: 'fixture',
        rationale: 'proves Goro received source packet',
        sourceRefs: body.resolvedTweets?.map(item => item.url) || [],
        warnings: []
      }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  throw new Error(`unexpected fetch ${url}`);
};

try {
  const result = await generateTweets({
    inspirationLinks: 'https://x.com/lucas/status/1801234567890, https://x.com/i/status/999999999999, https://example.com/not-a-tweet',
    context: 'Operator context must reach Goro.',
    tone: 'sharp',
    count: 1
  });

  check('generate uses http adapter fixture', result.adapter === 'http');
  check('sourcePacket contains three resolved tweet entries', result.sourcePacket?.resolvedTweets?.length === 3, JSON.stringify(result.sourcePacket?.resolvedTweets));
  check('first source packet entry resolved text', result.sourcePacket.resolvedTweets[0]?.text === 'Resolved fixture tweet text from fxtwitter metadata');
  check('first source packet entry preserves status id', result.sourcePacket.resolvedTweets[0]?.statusId === '1801234567890');
  check('unresolved status keeps warning and status id', result.sourcePacket.resolvedTweets[1]?.statusId === '999999999999' && /HTTP 404/.test(result.sourcePacket.resolvedTweets[1]?.warning || ''));
  check('invalid link keeps URL and warning', result.sourcePacket.resolvedTweets[2]?.url === 'https://example.com/not-a-tweet' && /could not parse/.test(result.sourcePacket.resolvedTweets[2]?.warning || ''));
  check('top-level warnings include unresolved warning', result.warnings.some(warning => /HTTP 404/.test(warning)) && result.warnings.some(warning => /could not parse/.test(warning)));

  const goroCall = fetchCalls.find(call => call.url === 'https://goro.local/generate');
  check('Goro call includes source packet resolvedTweets', Array.isArray(goroCall?.body?.resolvedTweets) && goroCall.body.resolvedTweets[0].text === 'Resolved fixture tweet text from fxtwitter metadata');
  check('Goro prompt includes operator context', /Operator context must reach Goro/.test(goroCall?.body?.prompt || ''));
  check('Goro prompt includes resolved tweet source packet', /Resolved fixture tweet text/.test(goroCall?.body?.prompt || '') && /statusId=1801234567890/.test(goroCall?.body?.prompt || ''));
} finally {
  globalThis.fetch = originalFetch;
  if (oldMode === undefined) delete process.env.GORO_GENERATE_MODE;
  else process.env.GORO_GENERATE_MODE = oldMode;
  if (oldUrl === undefined) delete process.env.GORO_GENERATE_URL;
  else process.env.GORO_GENERATE_URL = oldUrl;
}

const failed = checks.filter(item => !item.ok);
for (const item of checks) console.log(`${item.ok ? '✓' : '✗'} ${item.name}${item.ok || !item.detail ? '' : ` — ${item.detail}`}`);
if (failed.length) {
  console.error(`\n${failed.length}/${checks.length} tweet resolution checks failed`);
  process.exit(1);
}
console.log(`\n${checks.length}/${checks.length} tweet resolution checks passed`);
