import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Diagnostics event recorder for Tweet Lab's operator health panel.
//
// Design contract (deliberately strict):
//   - All state is in-memory only; nothing is persisted to disk. Restart
//     resets the panel; that's the desired operator behaviour.
//   - We retain ONLY the most recent event per category (lastSuccess / lastFailure).
//   - We never store raw credential strings, full tweet text, or any
//     tweet/user content beyond compact counters. The only string material we
//     expose to the UI is a short list of warning messages, error messages,
//     and account usernames — all of which are already user-visible elsewhere.
//   - redactForDiagnostics() runs the same SECRET_FIELD_PATTERNS used by the
//     store, plus a regex over string values that flags token-shaped content,
//     so a future code path that accidentally stashes a bearer token in an
//     event gets scrubbed at record time.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const STARTED_AT = new Date();
const APP_VERSION = '1.0.0+diagnostics';

// Mirror lib/store.js SECRET_FIELD_PATTERNS. If those expand, expand here too.
// Mirror lib/store.js SECRET_FIELD_PATTERNS. If those expand, expand here too.
// Note: we deliberately do NOT match generic key names like "postiz", "x",
// "goro", "blockedRemedies", or "hermes" — those are top-level diagnostics
// surfaces that hold only non-secret operational state. We match secret-shaped
// key names: credential, token, secret, key (when paired with provider), etc.
const SECRET_FIELD_PATTERNS = [
  /^api[-_]?key$/i,
  /^token$/i,
  /^secret$/i,
  /^password$/i,
  /^bearer$/i,
  /^authorization$/i,
  /^private[-_]?key$/i,
  /^client[-_]?secret$/i,
  /^access[-_]?token$/i,
  /^refresh[-_]?token$/i,
  /postiz[-_]?api[-_]?key$/i,
  /postiz[-_]?(api[-_]?)?token$/i,
  /postiz[-_]?secret$/i,
  /x[-_]?bearer$/i,
  /hermes[-_]?(api[-_]?)?token$/i,
  /op[-_]?service[-_]?account[-_]?token$/i
];

// Token-shaped values inside free text. Mirrors the verifier's regex so
// surface-level leaks get scrubbed even if a caller forgets to redact fields.
const TOKEN_VALUE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+\/-]{20,}/gi,
  /\bsk-[A-Za-z0-9_-]{20,}/gi,
  /\bxai-[A-Za-z0-9_-]{20,}/gi,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/gi
];

const state = {
  live: {
    lastSuccess: null,
    lastFailure: null,
    lastRateLimit: null
  },
  goro: {
    lastSuccess: null,
    lastFailure: null
  },
  schedule: {
    lastAttempt: null
  },
  // Home grounded-generation operator surface. Tracks the last context
  // packet assembled (voice/vault/company/source-bank/live-X), the last
  // X history backfill outcome, and the last generation attempt, so the
  // diagnostics panel can show Lucas/Johnny exactly why generation is or
  // is not grounded. All values are compact counters + booleans; never
  // raw tweet text or credentials.
  home: {
    lastContextPacket: null,
    lastXHistorySync: null,
    lastGeneration: null
  }
};

function nowIso() {
  return new Date().toISOString();
}

function safeCount(value) {
  if (Array.isArray(value)) return value.length;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function shortString(value, max = 240) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function scrubString(value) {
  if (typeof value !== 'string' || !value) return value;
  let scrubbed = value;
  for (const pattern of TOKEN_VALUE_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, '[redacted]');
  }
  return scrubbed;
}

function redactForDiagnostics(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return scrubString(value);
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[redacted:circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map(item => redactForDiagnostics(item, seen));
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (SECRET_FIELD_PATTERNS.some(rx => rx.test(key))) {
      out[key] = '[redacted]';
      continue;
    }
    out[key] = redactForDiagnostics(val, seen);
  }
  return out;
}

function recordLiveSuccess({ accounts, tweets, fetchedAt, rateLimit }) {
  const okAccounts = Array.isArray(accounts) ? accounts.filter(a => a && a.ok).length : 0;
  const failedAccounts = Array.isArray(accounts) ? accounts.filter(a => a && !a.ok).length : 0;
  const requestedAccounts = Array.isArray(accounts) ? accounts.length : 0;
  const warnings = [];
  for (const account of (Array.isArray(accounts) ? accounts : [])) {
    if (!account) continue;
    for (const warning of (account.warnings || [])) warnings.push(`${account.username}: ${warning}`);
  }
  state.live.lastSuccess = {
    at: fetchedAt || nowIso(),
    requestedAccounts,
    okAccounts,
    failedAccounts,
    tweetCount: safeCount(Array.isArray(tweets) ? tweets.length : tweets),
    warnings
  };
  if (rateLimit && (rateLimit.limit || rateLimit.remaining || rateLimit.reset)) {
    state.live.lastRateLimit = {
      at: nowIso(),
      limit: rateLimit.limit ?? null,
      remaining: rateLimit.remaining ?? null,
      reset: rateLimit.reset ?? null
    };
  }
}

function recordLiveFailure({ accounts, error, fetchedAt, rateLimit }) {
  state.live.lastFailure = {
    at: fetchedAt || nowIso(),
    requestedAccounts: Array.isArray(accounts) ? accounts.length : 0,
    okAccounts: Array.isArray(accounts) ? accounts.filter(a => a && a.ok).length : 0,
    failedAccounts: Array.isArray(accounts) ? accounts.filter(a => a && !a.ok).length : 0,
    error: shortString(error?.message || 'unknown error', 240),
    statusCode: typeof error?.statusCode === 'number' ? error.statusCode : null,
    rateLimit: error?.rateLimit || rateLimit || null
  };
  if (error?.rateLimit && (error.rateLimit.limit || error.rateLimit.remaining || error.rateLimit.reset)) {
    state.live.lastRateLimit = {
      at: nowIso(),
      limit: error.rateLimit.limit ?? null,
      remaining: error.rateLimit.remaining ?? null,
      reset: error.rateLimit.reset ?? null
    };
  }
}

function recordGoroSuccess({ adapter, candidates, drafts, mockModeForced, warnings }) {
  state.goro.lastSuccess = {
    at: nowIso(),
    adapter: shortString(adapter, 32) || 'unknown',
    candidateCount: safeCount(candidates),
    draftCount: safeCount(drafts),
    mockModeForced: Boolean(mockModeForced),
    warnings: Array.isArray(warnings) ? warnings.map(w => shortString(w, 160)).filter(Boolean) : []
  };
}

function recordGoroFailure({ adapter, error }) {
  state.goro.lastFailure = {
    at: nowIso(),
    adapter: shortString(adapter, 32) || 'unknown',
    error: shortString(error?.message || 'unknown error', 240),
    statusCode: typeof error?.statusCode === 'number' ? error.statusCode : null
  };
}

function recordScheduleAttempt({ ok, mode, error, draftId, scheduledAt, statusCode, conflicts, safeBlocked }) {
  state.schedule.lastAttempt = {
    at: nowIso(),
    ok: Boolean(ok),
    mode: shortString(mode, 24) || 'unknown',
    safeBlocked: Boolean(safeBlocked),
    statusCode: typeof statusCode === 'number' ? statusCode : null,
    error: error ? shortString(error.message || String(error), 240) : null,
    draftId: draftId ? shortString(draftId, 64) : null,
    scheduledAt: scheduledAt ? shortString(scheduledAt, 64) : null,
    conflictCount: Array.isArray(conflicts) ? conflicts.length : 0
  };
}

// Derive a compact, invariant-safe summary of a context packet for the
// diagnostics panel. We capture only booleans + counts + the query string
// so the panel can show "voice loaded, 5 vault notes, 3 company sources,
// live-X off, 0 source refs → ungrounded" without ever surfacing packet
// contents. The packet shape is documented in lib/context.js.
function recordContextPacket({ packet } = {}) {
  if (!packet || typeof packet !== 'object') {
    state.home.lastContextPacket = null;
    return;
  }
  const voice = packet.voiceSummary || {};
  const vault = packet.vaultRefs || {};
  const company = packet.companyRefs || {};
  const sourceBank = packet.sourceBank || {};
  const liveX = packet.liveX || {};
  state.home.lastContextPacket = {
    at: shortString(packet.generatedAt, 64) || nowIso(),
    query: shortString(packet.query, 120),
    voiceLoaded: Boolean(voice.loaded),
    voiceRules: safeCount(voice.styleRules),
    voiceForbidden: safeCount(voice.forbiddenPatterns),
    vaultScanned: typeof vault.scannedFiles === 'number' ? vault.scannedFiles : 0,
    vaultNotes: safeCount(vault.notes),
    companySources: safeCount(company.sources),
    sourceBankItems: safeCount(sourceBank.items),
    liveXAvailable: liveX.available === true,
    liveXTweets: safeCount(liveX.tweets),
    sourceRefs: safeCount(packet.sourceRefs),
    warnings: safeCount(packet.warnings)
  };
}

// Derive a compact summary of an X history backfill result. Mirrors the
// fields backfillXHistory returns; we surface ok/pages/persisted/unique/
// truncated + the blocker code (never the blocker message verbatim, to
// avoid accidentally echoing X API detail — the remedy copy in
// blockedRemedies already covers the operator-facing fix).
function recordXHistorySync({ result } = {}) {
  if (!result || typeof result !== 'object') {
    state.home.lastXHistorySync = null;
    return;
  }
  state.home.lastXHistorySync = {
    at: shortString(result.finishedAt || result.fetchedAt, 64) || nowIso(),
    username: shortString(result.username, 32),
    ok: Boolean(result.ok),
    pages: typeof result.pages === 'number' ? result.pages : 0,
    pagesSkipped: typeof result.pagesSkipped === 'number' ? result.pagesSkipped : 0,
    persisted: typeof result.persisted === 'number' ? result.persisted : 0,
    uniqueCount: typeof result.uniqueCount === 'number' ? result.uniqueCount : 0,
    truncated: Boolean(result.truncated),
    blockerCode: result.blocker?.code ? shortString(result.blocker.code, 64) : null
  };
}

// Derive a compact summary of a Home generation attempt. ok=false with a
// blocker code lets the panel explain "generation blocked because the Goro
// adapter timed out" without re-reading the goro failure prose.
function recordGenerationAttempt({ ok, adapter, candidateCount, draftCount, sourceRefCount, warnings, blockerCode } = {}) {
  state.home.lastGeneration = {
    at: nowIso(),
    ok: Boolean(ok),
    adapter: shortString(adapter, 32) || 'unknown',
    candidateCount: typeof candidateCount === 'number' ? candidateCount : 0,
    draftCount: typeof draftCount === 'number' ? draftCount : 0,
    sourceRefCount: typeof sourceRefCount === 'number' ? sourceRefCount : 0,
    warningCount: safeCount(warnings),
    blockerCode: blockerCode ? shortString(blockerCode, 64) : null
  };
}

// Compute the active blockers that would prevent grounded Home generation,
// from the recorded state. Each entry is { code, surface, message } so the
// UI can render a focused "why generation is blocked" list. Informational
// only — we never block generation server-side here; this is diagnostics.
function homeGenerationBlockers() {
  const blockers = [];
  const pkt = state.home.lastContextPacket;
  if (pkt) {
    if (!pkt.voiceLoaded) {
      blockers.push({ code: 'voice-dna-missing', surface: 'context', message: 'Voice DNA not loaded in the last context packet; drafts will not match Lucas voice.' });
    }
    if (pkt.sourceRefs === 0) {
      blockers.push({ code: 'no-source-refs', surface: 'context', message: 'Last context packet had zero source references; candidates would be ungrounded.' });
    }
    if (!pkt.liveXAvailable) {
      blockers.push({ code: 'live-x-unavailable', surface: 'context', message: 'Live X inspiration is unavailable (no bearer token or fetcher). Cached context only.' });
    }
  }
  const sync = state.home.lastXHistorySync;
  if (sync && !sync.ok && sync.blockerCode) {
    blockers.push({ code: sync.blockerCode, surface: 'x-history', message: `X history sync blocked (${sync.blockerCode}); previous-post grounding may be stale or empty.` });
  }
  const goro = state.goro;
  if (goro.lastFailure && (!goro.lastSuccess || goro.lastFailure.at >= goro.lastSuccess.at)) {
    blockers.push({ code: 'goro-adapter-failed', surface: 'generation', message: shortString(goro.lastFailure.error || 'Goro adapter failed', 200) });
  }
  return blockers;
}

function blockedRemedies() {
  return {
    postiz: 'Set POSTIZ_API_KEY (and POSTIZ_X_INTEGRATION_ID for the default X integration) in the private server environment. Schedule writes stay safe-blocked until a real key is configured.',
    x: 'Set X_BEARER_TOKEN in the server environment. Live X reads stay disabled until a token is present.',
    goro: 'Hermes Goro adapter failed. Check GORO_HERMES_PROFILE points to a reachable profile; or set GORO_GENERATE_URL to an HTTP endpoint; or temporarily set GORO_GENERATE_MODE=mock for offline drafting. Inspect last error below.'
  };
}

async function readStorageCounts() {
  const file = path.join(PROJECT_ROOT, 'data', 'tweet-lab.json');
  const defaults = { draftsCount: 0, sourcesCount: 0, templatesCount: 0, scheduleSlotsCount: 0, auditLastAt: null };
  try {
    const raw = await fs.readFile(file, 'utf8');
    const data = JSON.parse(raw);
    const auditLog = Array.isArray(data.auditLog) ? data.auditLog : [];
    return {
      draftsCount: Array.isArray(data.drafts) ? data.drafts.length : 0,
      sourcesCount: Array.isArray(data.sources) ? data.sources.length : 0,
      templatesCount: Array.isArray(data.templates) ? data.templates.length : 0,
      scheduleSlotsCount: Array.isArray(data.scheduleSlots) ? data.scheduleSlots.length : 0,
      auditLastAt: auditLog.length ? auditLog[auditLog.length - 1].at || null : null
    };
  } catch (err) {
    if (err && err.code === 'ENOENT') return defaults;
    return defaults;
  }
}

async function buildReport({ config, appInfo = {} } = {}) {
  const storage = await readStorageCounts();
  const cfg = config || {};
  const now = nowIso();
  const uptimeSeconds = Math.max(0, Math.floor((Date.now() - STARTED_AT.getTime()) / 1000));
  const lastFetch = state.live.lastSuccess || (state.live.lastFailure ? {
    at: state.live.lastFailure.at,
    ok: false,
    requestedAccounts: state.live.lastFailure.requestedAccounts,
    okAccounts: state.live.lastFailure.okAccounts,
    failedAccounts: state.live.lastFailure.failedAccounts,
    tweetCount: 0,
    warnings: state.live.lastFailure.error ? [state.live.lastFailure.error] : [],
    error: state.live.lastFailure.error,
    statusCode: state.live.lastFailure.statusCode
  } : null);
  return redactForDiagnostics({
    app: {
      version: APP_VERSION,
      nodeVersion: process.version,
      startedAt: STARTED_AT.toISOString(),
      now,
      uptimeSeconds,
      pid: process.pid,
      port: appInfo.port || null,
      tailnetHost: appInfo.tailnetHost || null
    },
    goro: {
      mode: cfg.goroMode || 'unknown',
      mockModeForced: Boolean(cfg.mockModeForced),
      profile: cfg.goroProfile || 'goro',
      hasGoroEndpoint: Boolean(cfg.hasGoroEndpoint),
      lastSuccess: state.goro.lastSuccess,
      lastFailure: state.goro.lastFailure
    },
    x: {
      configured: Boolean(cfg.xConfigured),
      provider: cfg.xProvider || null,
      readOnly: cfg.xReadOnly !== false,
      lastFetch,
      lastFailure: state.live.lastFailure,
      lastRateLimit: state.live.lastRateLimit
    },
    postiz: {
      configured: Boolean(cfg.postizConfigured),
      hasDefaultIntegration: Boolean(cfg.hasDefaultIntegration),
      apiUrl: cfg.postizApiUrl || null,
      lastAttempt: state.schedule.lastAttempt
    },
    home: {
      contextPacket: state.home.lastContextPacket,
      xHistorySync: state.home.lastXHistorySync,
      generation: state.home.lastGeneration,
      blockers: homeGenerationBlockers()
    },
    blockedRemedies: blockedRemedies(),
    storage
  });
}

function resetForTests() {
  state.live = { lastSuccess: null, lastFailure: null, lastRateLimit: null };
  state.goro = { lastSuccess: null, lastFailure: null };
  state.schedule = { lastAttempt: null };
  state.home = { lastContextPacket: null, lastXHistorySync: null, lastGeneration: null };
}

export {
  recordLiveSuccess,
  recordLiveFailure,
  recordGoroSuccess,
  recordGoroFailure,
  recordScheduleAttempt,
  recordContextPacket,
  recordXHistorySync,
  recordGenerationAttempt,
  buildReport,
  resetForTests,
  redactForDiagnostics,
  APP_VERSION
};
