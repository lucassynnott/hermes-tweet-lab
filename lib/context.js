// Server-side context retrieval pipeline for Tweet Lab.
//
// Goal: when the browser asks "give me a grounded context packet for generating
// posts", the server reaches out to local durable sources (voice DNA, Obsidian
// vault, company docs, source bank, optional live X) and returns a single,
// redact-safe packet the LLM and UI can consume.
//
// Non-negotiables (deliberately strict):
//   - Read-only everywhere. This module NEVER writes to disk or makes
//     mutating API calls (no Postiz, no X writes, no contact follows).
//   - No tokens leave the server. The redaction pass runs on every string
//     value of every returned object, and uses the same SECRET_FIELD_PATTERNS
//     + TOKEN_VALUE_PATTERNS as lib/diagnostics.js / lib/store.js so the
//     shape stays consistent across surfaces.
//   - Bounded. Vault search reads at most a small number of files (default
//     5) and truncates each excerpt. We never dump an entire vault into a
//     response.
//   - Failures don't poison the packet. Each loader returns { loaded, ...,
//     warnings }. The browser can render the warnings instead of crashing.
//   - Pure functions where possible. The stateful bit is only fs reads.
//
// The packet shape (see buildContextPacket) is the public contract — the
// browser, the verify script, and the unit tests all assert against it.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { listCollection } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Constants / paths

export const VOICE_DNA_PATH = process.env.TWEET_LAB_VOICE_DNA_PATH
  ? path.resolve(process.env.TWEET_LAB_VOICE_DNA_PATH)
  : path.join(os.homedir(), '.hermes', 'tweet-lab', 'voice-dna.md');

export const OBSIDIAN_VAULT_PATH = process.env.TWEET_LAB_CONTEXT_DIR
  ? path.resolve(process.env.TWEET_LAB_CONTEXT_DIR)
  : path.join(os.homedir(), '.hermes', 'tweet-lab', 'context');

export const COMPANY_CONTEXT_PATHS = String(process.env.TWEET_LAB_COMPANY_CONTEXT_FILES || '')
  .split(path.delimiter)
  .map(value => value.trim())
  .filter(Boolean)
  .map(value => path.resolve(value));

export const VOICE_DNA_MAX_CHARS = 6000;
export const VAULT_EXCERPT_CHARS = 600;
export const VAULT_MAX_NOTES = 5;
export const COMPANY_MAX_CHARS = 4000;
export const SOURCE_BANK_MAX = 8;
export const LIVE_X_MAX_TWEETS = 6;

// ---------------------------------------------------------------------------
// Redaction
//
// Mirrors lib/store.js SECRET_FIELD_PATTERNS and lib/diagnostics.js
// TOKEN_VALUE_PATTERNS. Defence in depth: every value in the returned packet
// is scrubbed before serialisation so a stray token-shaped string in any
// upstream file can't leak to the browser.

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
  /postiz/i
];

const TOKEN_VALUE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+\/-]{20,}/gi,
  /\bsk-[A-Za-z0-9_-]{20,}/gi,
  /\bxai-[A-Za-z0-9_-]{20,}/gi,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/gi
];

function scrubString(value) {
  if (typeof value !== 'string' || !value) return value;
  let scrubbed = value;
  for (const pattern of TOKEN_VALUE_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, '[redacted]');
  }
  return scrubbed;
}

// Public helper — used by the verifier and exported for tests.
export function redactContextValue(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return scrubString(value);
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[redacted:circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map(item => redactContextValue(item, seen));
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (SECRET_FIELD_PATTERNS.some(rx => rx.test(key))) {
      out[key] = '[redacted]';
      continue;
    }
    out[key] = redactContextValue(val, seen);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Small filesystem helpers

async function readFileSafe(absPath) {
  try {
    const stat = await fs.stat(absPath);
    if (!stat.isFile()) return null;
    const content = await fs.readFile(absPath, 'utf8');
    return { content, stat };
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR' || err.code === 'EACCES')) {
      return null;
    }
    throw err;
  }
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

function nowIso() {
  return new Date().toISOString();
}

function trimExcerpt(text, max) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max)}…`;
}

// ---------------------------------------------------------------------------
// Voice DNA loader
//
// Reads the canonical voice DNA file for Lucas and derives a compact summary
// the LLM can use as a style primer. We intentionally return BOTH the parsed
// style rules (so the UI can show them) AND a truncated excerpt of the raw
// file (so the LLM has the verbatim voice context if it asks for more).
//
// The excerpt is capped hard — this is the single biggest redaction surface
// because voice DNA files historically contain example URLs that may include
// tokens or private handles.

function deriveVoiceSummary(text) {
  const summary = {
    styleRules: [],
    forbiddenPatterns: [],
    sourceBacked: true,
    sampledPostCount: null,
    warnings: []
  };

  const lines = String(text || '').split('\n');

  // Section detection. We support BOTH:
  //   - explicit tagged sections (<voice_rules>, <forbidden>, etc.)
  //   - implicit Markdown headers (## Voice rules, ## Forbidden patterns)
  //
  // A few XML-style tags the Lucas voice DNA actually uses:
  //   <voice_fingerprint>, <writing_laws>, <taste_loves>, <taste_disgusts>,
  //   <phrase_bank>, <identity_context>, <archive_signal>
  //
  // We map each to a mode:
  //   rules      → voice_fingerprint, writing_laws, taste_loves,
  //                voice_rules, writing_rules, style_rules
  //   forbidden  → forbidden, taste_disgusts, forbidden_patterns
  //   meta       → identity_context, archive_signal, phrase_bank (we
  //                capture bullets here too — they're operational rules;
  //                skipping them would drop the "no hashtags" line)
  let mode = null;
  const isRulesSection = (line) => /<\s*(voice_fingerprint|writing_laws|taste_loves|voice_rules|writing_rules|style_rules)\s*>/i.test(line)
    || /^#+\s+(voice\s+rules?|writing\s+laws?|taste|style\s+rules?)/i.test(line);
  const isForbiddenSection = (line) => /<\s*(forbidden|taste_disgusts|forbidden_patterns)\s*>/i.test(line)
    || /^#+\s+(forbidden|do\s+not\s+use|never\s+do)/i.test(line);
  const isMetaSection = (line) => /<\s*(identity_context|archive_signal|phrase_bank)\s*>/i.test(line)
    || /^#+\s+(identity|archive|phrase\s+bank|voice\s+dna)/i.test(line);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const newMode = isRulesSection(line) ? 'rules'
      : isForbiddenSection(line) ? 'forbidden'
      : isMetaSection(line) ? 'meta'
      : null;
    if (newMode) {
      mode = newMode;
      continue;
    }
    // Any other heading closes the active mode.
    if (/^#+\s+/.test(line)) {
      mode = null;
      continue;
    }
    // Closing tag closes the active mode.
    if (/^<\s*\/\s*(voice_fingerprint|writing_laws|taste_loves|voice_rules|writing_rules|style_rules|forbidden|taste_disgusts|forbidden_patterns|identity_context|archive_signal|phrase_bank)\s*>/i.test(line)) {
      mode = null;
      continue;
    }

    if (mode === 'rules' || mode === 'meta') {
      // Capture bullets (`- …`) and numbered items (`1. …`).
      const m = line.match(/^(?:[-*]|\d+\.)\s+(.+)$/);
      if (m) summary.styleRules.push(trimExcerpt(m[1], 200));
    } else if (mode === 'forbidden') {
      const m = line.match(/^(?:[-*]|\d+\.)\s+(.+)$/);
      if (m) summary.forbiddenPatterns.push(trimExcerpt(m[1], 200));
    }

    // Cheap corpus size detection (e.g. "corpus: 4,812 tweets" or "1,234 posts").
    const corpusMatch = line.match(/([\d,]{3,})\s+(tweets?|posts?|samples?)/i);
    if (corpusMatch && !summary.sampledPostCount) {
      const n = Number(corpusMatch[1].replace(/,/g, ''));
      if (Number.isFinite(n)) summary.sampledPostCount = n;
    }
  }

  // Cap rules so a runaway file can't bloat the packet.
  summary.styleRules = summary.styleRules.slice(0, 16);
  summary.forbiddenPatterns = summary.forbiddenPatterns.slice(0, 16);

  if (!summary.styleRules.length) {
    summary.warnings.push('voice-dna: no <voice_rules>/<writing_laws>/<taste_loves> section detected; style rules empty.');
  }
  if (!summary.forbiddenPatterns.length) {
    summary.warnings.push('voice-dna: no <forbidden>/<taste_disgusts> section detected; forbidden patterns empty.');
  }
  return summary;
}

export async function loadVoiceContext({ filePath = VOICE_DNA_PATH } = {}) {
  const warnings = [];
  const file = await readFileSafe(filePath);
  if (!file) {
    warnings.push(`voice-dna: file not found at ${filePath}`);
    return {
      id: 'lucas-voice-dna',
      sourceRef: {
        id: 'voice-dna:lucas',
        type: 'voice-dna',
        label: 'Lucas voice DNA',
        filePath,
        warnings: [`unavailable: ${path.basename(filePath)} missing`]
      },
      loaded: false,
      styleRules: [],
      forbiddenPatterns: [],
      sampledPostCount: null,
      excerpt: '',
      sourceBacked: false,
      lastLoadedAt: null,
      warnings
    };
  }

  const summary = deriveVoiceSummary(file.content);
  warnings.push(...summary.warnings);

  return {
    id: 'lucas-voice-dna',
    sourceRef: {
      id: 'voice-dna:lucas',
      type: 'voice-dna',
      label: 'Lucas voice DNA',
      filePath,
      capturedAt: file.stat.mtime.toISOString(),
      verifiedAt: nowIso(),
      warnings: []
    },
    loaded: true,
    styleRules: summary.styleRules,
    forbiddenPatterns: summary.forbiddenPatterns,
    sampledPostCount: summary.sampledPostCount,
    excerpt: trimExcerpt(file.content, VOICE_DNA_MAX_CHARS),
    sourceBacked: true,
    lastLoadedAt: nowIso(),
    warnings
  };
}

// ---------------------------------------------------------------------------
// Obsidian vault loader
//
// Walks the configured vault root, finds markdown files whose body or
// filename matches the query (case-insensitive substring), and returns the
// top N with an excerpt. We intentionally do NOT recurse through symlinks,
// never sort by anything that could leak timestamps in raw form, and we cap
// the search to top-level + a few common depths to keep latency bounded.
//
// The vault path is config-overridable so we can stub a fixture in tests,
// and defaults to the private ~/.hermes/tweet-lab/context directory.

const VAULT_MAX_DEPTH = 4;
const VAULT_MAX_FILES_SCANNED = 2000;

async function walkVault(root, depth, out, counters) {
  if (depth > VAULT_MAX_DEPTH) return;
  if (counters.scanned >= VAULT_MAX_FILES_SCANNED) return;
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (err) {
    counters.errors += 1;
    return;
  }
  for (const entry of entries) {
    if (counters.scanned >= VAULT_MAX_FILES_SCANNED) break;
    // Skip obvious noise: dotfiles, attachments dir, Tolaria internals.
    if (entry.name.startsWith('.')) continue;
    if (entry.name === 'attachments') continue;
    if (entry.name === 'node_modules') continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await walkVault(full, depth + 1, out, counters);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.md')) continue;
    counters.scanned += 1;
    out.push(full);
  }
}

function scoreVaultFile(filePath, queryTokens) {
  const base = path.basename(filePath).toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (!token) continue;
    if (base.includes(token)) score += 2;
  }
  return score;
}

export async function searchObsidianVault({ query = '', vaultPath = OBSIDIAN_VAULT_PATH, maxNotes = VAULT_MAX_NOTES, excerptChars = VAULT_EXCERPT_CHARS } = {}) {
  const warnings = [];
  const trimmedQuery = String(query || '').trim();
  const limit = clamp(maxNotes, 1, 20);
  const excerptMax = clamp(excerptChars, 100, 4000);

  // Check vault root exists and is a directory.
  let rootStat;
  try {
    rootStat = await fs.stat(vaultPath);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return {
        vaultPath,
        query: trimmedQuery,
        scannedFiles: 0,
        notes: [],
        warnings: [`obsidian: vault not found at ${vaultPath}`]
      };
    }
    throw err;
  }
  if (!rootStat.isDirectory()) {
    return {
      vaultPath,
      query: trimmedQuery,
      scannedFiles: 0,
      notes: [],
      warnings: [`obsidian: vault path is not a directory: ${vaultPath}`]
    };
  }

  const files = [];
  const counters = { scanned: 0, errors: 0 };
  await walkVault(vaultPath, 0, files, counters);
  if (counters.errors > 0) {
    warnings.push(`obsidian: ${counters.errors} directory read error(s); results may be partial.`);
  }

  // Empty query → fall back to most-recently-modified notes (operator overview).
  const queryTokens = trimmedQuery.toLowerCase().split(/\s+/).filter(Boolean);

  let candidates = files;
  if (queryTokens.length > 0) {
    candidates = files.filter(file => {
      const base = path.basename(file).toLowerCase();
      return queryTokens.some(token => base.includes(token));
    });
    if (candidates.length === 0) {
      // Try filename + content scan in case the body matters.
      candidates = files.slice(0, 200); // small batch to keep latency bounded
    }
  }

  // Sort: query hit first, then by mtime desc.
  const withMeta = await Promise.all(candidates.map(async file => {
    let mtime = null;
    try {
      const st = await fs.stat(file);
      mtime = st.mtime;
    } catch { /* ignore */ }
    return { file, mtime, score: scoreVaultFile(file, queryTokens) };
  }));
  withMeta.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ta = a.mtime ? a.mtime.getTime() : 0;
    const tb = b.mtime ? b.mtime.getTime() : 0;
    return tb - ta;
  });

  const top = withMeta.slice(0, queryTokens.length ? limit * 4 : limit);
  const notes = [];
  for (const item of top) {
    if (notes.length >= limit) break;
    const file = await readFileSafe(item.file);
    if (!file) continue;

    // If query terms don't appear anywhere in the file, skip when a query was given.
    if (queryTokens.length > 0) {
      const haystack = `${path.basename(file.content.slice(0, 4000))} ${file.content}`.toLowerCase();
      const hit = queryTokens.some(token => haystack.includes(token));
      if (!hit && item.score === 0) continue;
    }

    const firstLine = file.content.split('\n').find(line => line.trim() && !line.trim().startsWith('#')) || '';
    const excerpt = trimExcerpt(file.content, excerptMax);

    notes.push({
      path: item.file,
      title: trimExcerpt(firstLine.replace(/^#+\s*/, ''), 120) || path.basename(item.file, '.md'),
      excerpt,
      modifiedAt: file.stat.mtime.toISOString(),
      sourceRef: {
        id: `obsidian:${item.file}`,
        type: 'obsidian-note',
        label: path.basename(item.file, '.md'),
        filePath: item.file,
        capturedAt: file.stat.mtime.toISOString(),
        verifiedAt: nowIso()
      }
    });
  }

  if (!notes.length && trimmedQuery) {
    warnings.push(`obsidian: no notes matched "${trimmedQuery}" (scanned ${counters.scanned}).`);
  }

  return {
    vaultPath,
    query: trimmedQuery,
    scannedFiles: counters.scanned,
    notes,
    warnings
  };
}

// ---------------------------------------------------------------------------
// Company context loader
//
// Reads the canonical "Live Applied Leverage Intelligence" synthesis (and a
// couple of supporting syntheses) from the Obsidian vault. We treat these
// as the durable company source rather than memory, per task non-negotiable
// #4. We cap the excerpt at COMPANY_MAX_CHARS and extract a small list of
// positioning lines for the LLM.

function extractPositioningLines(text) {
  const out = [];
  const lines = String(text || '').split('\n');
  let inOfferTable = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^##\s+/.test(line)) inOfferTable = /offer/i.test(line);
    if (!inOfferTable) continue;
    if (/^\|/.test(line)) continue; // skip table rows
    if (/^---+$/.test(line)) continue;
    if (/^#+/.test(line)) continue;
    if (line.length < 30) continue;
    out.push(trimExcerpt(line, 220));
    if (out.length >= 6) break;
  }
  return out;
}

export async function loadCompanyContext({ paths = COMPANY_CONTEXT_PATHS, maxChars = COMPANY_MAX_CHARS } = {}) {
  const warnings = [];
  const sources = [];
  let combined = '';
  for (const p of paths) {
    const file = await readFileSafe(p);
    if (!file) {
      warnings.push(`company-context: missing ${path.basename(p)}`);
      continue;
    }
    // Extract positioning lines from the FULL content (the `## Offer`
    // header may sit above maxChars), then truncate the excerpt for the packet.
    const positioningLines = extractPositioningLines(file.content);
    const excerpt = trimExcerpt(file.content, maxChars);
    sources.push({
      path: p,
      capturedAt: file.stat.mtime.toISOString(),
      excerpt,
      positioningLines,
      sourceRef: {
        id: `company:${p}`,
        type: 'company-context',
        label: path.basename(p, '.md'),
        filePath: p,
        capturedAt: file.stat.mtime.toISOString(),
        verifiedAt: nowIso()
      }
    });
    combined += `\n\n--- ${path.basename(p)} ---\n${excerpt}`;
  }

  const primary = sources[0] || null;
  // Slice the positioning lines so the same array isn't shared between
  // `sources[0].positioningLines` and the top-level `positioningLines`.
  // Otherwise the redactor (WeakSet-backed) marks the array circular on
  // its second visit and returns "[redacted:circular]" for the duplicate.
  const positioningLines = primary && Array.isArray(primary.positioningLines)
    ? primary.positioningLines.slice()
    : [];
  const positioning = positioningLines.length
    ? positioningLines.join(' • ')
    : 'Applied Leverage: AI agent/operator builds for service businesses.';

  return {
    company: 'Applied Leverage',
    positioning,
    positioningLines,
    proofClaims: [], // populated by callers when they have receipts
    opinionOnly: [
      'Operator-positioning statements are framed as opinion/draft unless paired with sourceRefs.',
      'No fabricated client metrics, revenue figures, or proof points.'
    ],
    sources,
    warnings
  };
}

// ---------------------------------------------------------------------------
// Source bank loader (already-persisted sources in tweet-lab.json)
//
// Reads the durable `sources` collection via the existing store API. We pick
// the most recent N by capturedAt, filtered lightly (no stale-only unless
// asked). Stale entries are returned but tagged with a warning so the UI can
// decide what to show.

export async function loadSourceBankContext({ maxSources = SOURCE_BANK_MAX, includeStale = true } = {}) {
  const warnings = [];
  let items = [];
  try {
    items = await listCollection('sources');
  } catch (err) {
    warnings.push(`source-bank: store read failed: ${err.message || 'unknown'}`);
    items = [];
  }

  if (!Array.isArray(items)) items = [];

  const filtered = includeStale ? items : items.filter(s => !s.stale);
  filtered.sort((a, b) => {
    const ta = a.capturedAt || a.fetchedAt || '';
    const tb = b.capturedAt || b.fetchedAt || '';
    return String(tb).localeCompare(String(ta));
  });

  const limit = clamp(maxSources, 1, 50);
  const top = filtered.slice(0, limit).map(item => ({
    id: item.id,
    text: trimExcerpt(item.text || '', 280),
    author: item.author || null,
    url: item.url || null,
    capturedAt: item.capturedAt || item.fetchedAt || null,
    tags: Array.isArray(item.tags) ? item.tags.slice(0, 8) : [],
    format: item.format || null,
    sourceType: item.sourceType || null,
    qualityScore: item.qualityScore ?? null,
    stale: Boolean(item.stale),
    staleReason: item.staleReason || null,
    warnings: Array.isArray(item.warnings) ? item.warnings : [],
    sourceRef: {
      id: `source-bank:${item.id}`,
      type: 'source-bank',
      label: item.author ? `@${item.author}` : (item.url || item.id),
      url: item.url || null,
      storeId: item.id,
      capturedAt: item.capturedAt || item.fetchedAt || null,
      verifiedAt: nowIso()
    }
  }));

  if (!top.length) {
    warnings.push('source-bank: no sources persisted yet.');
  }

  return {
    items: top,
    total: items.length,
    warnings
  };
}

// ---------------------------------------------------------------------------
// Live X loader (read-only)
//
// The server already exposes POST /api/tweet-lab/live/accounts/tweets. We
// reuse the existing handle indirectly: the context pipeline is invoked
// without going through HTTP, so we call the live-fetch logic only if the
// server's X bearer token is configured. To keep this module independent of
// server.js's globals, we expose loadLiveXContext as a thin wrapper that
// callers can override, and we ship a default "unavailable" path.
//
// The packet always carries liveX with a warnings entry when unavailable;
// it never fabricates metrics.

export async function loadLiveXContext({ fetcher = null, query = '', maxTweets = LIVE_X_MAX_TWEETS } = {}) {
  const warnings = [];
  if (typeof fetcher !== 'function') {
    return {
      available: false,
      tweets: [],
      warnings: ['live-x: no fetcher provided; live inspiration disabled in this context packet.'],
      fetchedAt: null
    };
  }

  let result;
  try {
    result = await fetcher({ query, maxTweets });
  } catch (err) {
    return {
      available: false,
      tweets: [],
      warnings: [`live-x: fetch failed: ${err.message || 'unknown'}`],
      fetchedAt: nowIso()
    };
  }

  if (!result || !Array.isArray(result.tweets)) {
    return {
      available: false,
      tweets: [],
      warnings: ['live-x: fetcher returned no tweets array.'],
      fetchedAt: nowIso()
    };
  }

  const tweets = result.tweets.slice(0, clamp(maxTweets, 1, 25)).map(t => ({
    id: t.id || null,
    url: t.url || null,
    text: trimExcerpt(t.text || '', 280),
    author: t.author ? (t.author.username || t.author.name || null) : null,
    createdAt: t.createdAt || null,
    metrics: t.metrics || null,
    sourceRef: {
      id: `live-x:${t.id || t.url || 'unknown'}`,
      type: 'live-x-post',
      label: t.author ? `@${t.author.username || t.author.name || 'unknown'}` : (t.url || 'live-x post'),
      url: t.url || null,
      capturedAt: t.fetchedAt || t.createdAt || null,
      verifiedAt: nowIso()
    }
  }));

  if (!tweets.length) warnings.push('live-x: fetcher returned 0 tweets for this query.');

  return {
    available: true,
    tweets,
    warnings,
    fetchedAt: result.fetchedAt || nowIso()
  };
}

// ---------------------------------------------------------------------------
// Top-level builder

/**
 * Build the full context packet for a generation request.
 *
 * Input (all optional):
 *   query:        free-text seed used for vault search (e.g. "AI agents")
 *   include:      { voiceDna, obsidian, company, sourceBank, liveX }
 *                 defaults to all true; liveX is included iff a fetcher is
 *                 provided AND the liveX flag is true.
 *   liveXFetcher: optional async (query, maxTweets) => { tweets, fetchedAt }
 *   liveXQuery:   query string to pass to liveXFetcher
 *   liveXMax:     max live tweets (default LIVE_X_MAX_TWEETS)
 *   vaultPath:    override obsidian vault root (tests)
 *   voiceDnaPath: override voice DNA path (tests)
 *   maxVaultNotes, maxSources, maxLiveXTweets: per-source caps
 *
 * Output shape (all fields always present):
 *   {
 *     generatedAt: ISO string,
 *     query: input query string,
 *     voiceSummary:  voice context block (loaded + style rules),
 *     vaultRefs:     { vaultPath, notes[], warnings[] },
 *     companyRefs:   { company, positioning, positioningLines[], sources[], warnings[] },
 *   sourceRefs:    flat list of every ContextSourceRef touched (voice,
 *                 vault notes, company docs, source bank, live X)
 *   sourceBank:    { items[], total, warnings[] } (legacy/source-bank block)
 *   liveX:         { available, tweets[], warnings[], fetchedAt },
 *   warnings:      aggregated top-level warnings
 *   }
 */
export async function buildContextPacket(opts = {}) {
  const {
    query = '',
    include = {},
    liveXFetcher = null,
    liveXQuery = '',
    liveXMax = LIVE_X_MAX_TWEETS,
    vaultPath = OBSIDIAN_VAULT_PATH,
    voiceDnaPath = VOICE_DNA_PATH,
    maxVaultNotes = VAULT_MAX_NOTES,
    maxSources = SOURCE_BANK_MAX,
    companyPaths = COMPANY_CONTEXT_PATHS,
    companyMaxChars = COMPANY_MAX_CHARS
  } = opts;

  const includeVoice = include.voiceDna !== false;
  const includeObsidian = include.obsidian !== false;
  const includeCompany = include.company !== false;
  const includeSourceBank = include.sourceBank !== false;
  const includeLiveX = include.liveX !== false;

  const [voiceSummary, vaultRefs, companyRefs, sourceBank] = await Promise.all([
    includeVoice ? loadVoiceContext({ filePath: voiceDnaPath }) : Promise.resolve(null),
    includeObsidian ? searchObsidianVault({ query, vaultPath, maxNotes: maxVaultNotes }) : Promise.resolve(null),
    includeCompany ? loadCompanyContext({ paths: companyPaths, maxChars: companyMaxChars }) : Promise.resolve(null),
    includeSourceBank ? loadSourceBankContext({ maxSources }) : Promise.resolve(null)
  ]);

  const liveX = includeLiveX
    ? await loadLiveXContext({ fetcher: liveXFetcher, query: liveXQuery || query, maxTweets: liveXMax })
    : { available: false, tweets: [], warnings: ['live-x: include.liveX disabled.'], fetchedAt: null };

  // Compose the consolidated sourceRefs[] (every ref the packet touched).
  const sourceRefs = [];
  if (voiceSummary?.sourceRef) sourceRefs.push(voiceSummary.sourceRef);
  if (vaultRefs?.notes?.length) sourceRefs.push(...vaultRefs.notes.map(n => n.sourceRef));
  if (companyRefs?.sources?.length) sourceRefs.push(...companyRefs.sources.map(s => s.sourceRef));
  if (sourceBank?.items?.length) sourceRefs.push(...sourceBank.items.map(s => s.sourceRef));
  if (liveX?.tweets?.length) sourceRefs.push(...liveX.tweets.map(t => t.sourceRef));

  // Aggregate warnings across sources.
  const warnings = [];
  for (const w of [
    voiceSummary?.warnings,
    vaultRefs?.warnings,
    companyRefs?.warnings,
    sourceBank?.warnings,
    liveX?.warnings
  ]) {
    if (Array.isArray(w)) warnings.push(...w.filter(Boolean));
  }

  const packet = {
    generatedAt: nowIso(),
    query: String(query || ''),
    voiceSummary: voiceSummary || null,
    vaultRefs: vaultRefs || null,
    companyRefs: companyRefs || null,
    sourceBank: sourceBank || null,
    liveX,
    warnings
  };

  // Redact each block independently first. If we redacted the whole packet
  // in one walk, the same nested sourceRef objects (shared between, e.g.,
  // packet.voiceSummary.sourceRef and packet.sourceRefs[0]) would get marked
  // circular the second time we re-entered them.
  const redactedPacket = {
    generatedAt: packet.generatedAt,
    query: packet.query,
    voiceSummary: packet.voiceSummary ? redactContextValue(packet.voiceSummary) : null,
    vaultRefs: packet.vaultRefs ? redactContextValue(packet.vaultRefs) : null,
    companyRefs: packet.companyRefs ? redactContextValue(packet.companyRefs) : null,
    sourceBank: packet.sourceBank ? redactContextValue(packet.sourceBank) : null,
    liveX: redactContextValue(packet.liveX),
    warnings: packet.warnings.map(w => scrubString(w))
  };

  // Re-assemble the flat sourceRefs list from the already-redacted blocks so
  // we don't double-redact / circular-trip through the same objects.
  redactedPacket.sourceRefs = [];
  if (redactedPacket.voiceSummary?.sourceRef) redactedPacket.sourceRefs.push(redactedPacket.voiceSummary.sourceRef);
  if (Array.isArray(redactedPacket.vaultRefs?.notes)) redactedPacket.sourceRefs.push(...redactedPacket.vaultRefs.notes.map(n => n.sourceRef).filter(Boolean));
  if (Array.isArray(redactedPacket.companyRefs?.sources)) redactedPacket.sourceRefs.push(...redactedPacket.companyRefs.sources.map(s => s.sourceRef).filter(Boolean));
  if (Array.isArray(redactedPacket.sourceBank?.items)) redactedPacket.sourceRefs.push(...redactedPacket.sourceBank.items.map(s => s.sourceRef).filter(Boolean));
  if (Array.isArray(redactedPacket.liveX?.tweets)) redactedPacket.sourceRefs.push(...redactedPacket.liveX.tweets.map(t => t.sourceRef).filter(Boolean));

  return redactedPacket;
}

// ---------------------------------------------------------------------------
// Project info — handy for the UI / diagnostics.

export const CONTEXT_INFO = {
  VOICE_DNA_PATH,
  OBSIDIAN_VAULT_PATH,
  COMPANY_CONTEXT_PATHS,
  PROJECT_ROOT
};
