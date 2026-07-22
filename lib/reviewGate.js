/**
 * Review Gate — quality scoring engine for Tweet Lab drafts.
 *
 * Runs a battery of checks against a draft and produces a gate status
 * (clean | needs-proof | revise | blocked), a 0-100 score, structured
 * check results, and human-readable warning strings.
 *
 * Checks:
 *   1. Character length        — >280 blocked, >260 revise
 *   2. Invented metric risk    — numbers, %, $, "percent" → needs-proof
 *   3. sourceRefs missing      — claim-heavy draft without sourceRefs → needs-proof
 *   4. AI-slop terms           — known LLM filler words → revise
 *   5. Banned phrases          — disallowed content (AI disclaimers, etc.) → blocked
 *   6. Too-generic warning     — very short or generic opener → revise
 *   7. Duplicate/similar draft — near-duplicate of existing draft → revise
 *
 * Pure module — no I/O, no side effects. Safe to call from server, tests, UI.
 */

// ── Constants ────────────────────────────────────────────────

export const GATE_STATUSES = ['clean', 'needs-proof', 'revise', 'blocked'];

const SEVERITY_RANK = { clean: 0, 'needs-proof': 1, revise: 2, blocked: 3 };
const RANK_TO_STATUS = ['clean', 'needs-proof', 'revise', 'blocked'];

/**
 * Words and phrases that signal AI-generated filler.
 * Tunable — extend or trim based on what Goro actually produces.
 * "leverage" is intentionally excluded because it is part of the
 * Applied Leverage brand vocabulary.
 */
const AI_SLOP_TERMS = [
  'delve',
  'tapestry',
  'moreover',
  'realm',
  'navigate',
  'embark',
  'unlock',
  'harness',
  'underscore',
  'game-changer',
  'game changer',
  "in today's world",
  "it's important to note",
  'needless to say',
  'picture this',
  'at the end of the day',
  'cutting-edge',
  'revolutionary',
  'game-changing',
  'seamless',
  'robust',
  'paradigm',
  'intricate',
  'multifaceted',
  'pivotal',
  'nuanced',
  'holistic',
  'in conclusion',
  'it is worth noting',
  'a testament to',
  'plays a crucial role',
  'plays a pivotal role',
  'in the realm of',
  'when it comes to',
  'gone are the days',
  'in the ever-evolving',
  'in the world of'
];

/**
 * Phrases that hard-block a draft — content that should never ship.
 * AI disclaimers, refusal language, etc.
 */
const BANNED_PHRASES = [
  'as an ai',
  'as a language model',
  'i cannot assist',
  "i can't assist",
  'i cannot help',
  "i can't help",
  'i do not have personal',
  "i don't have personal",
  'i am unable to',
  "i'm unable to",
  'my apologies, but i cannot',
  'this content may violate'
];

/**
 * Openers / patterns that signal a too-generic draft.
 * Combined with a short-length heuristic.
 */
const GENERIC_OPENERS = [
  'this is important',
  'think about it',
  'consider this',
  'here is the thing',
  "here's the thing",
  'let me tell you',
  'pay attention',
  'listen up'
];

const MAX_LENGTH = 280;
const WARN_LENGTH = 260;
const MIN_SUBSTANTIVE_LENGTH = 40;
const SIMILARITY_THRESHOLD = 0.85;

// ── Helpers ──────────────────────────────────────────────────

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  return normalizeText(text)
    .split(/[^a-z0-9$%]+/)
    .filter(Boolean);
}

/**
 * Jaccard similarity on token sets — simple, fast, good enough for
 * near-duplicate detection on short texts.
 */
function jaccardSimilarity(textA, textB) {
  const setA = new Set(tokenize(textA));
  const setB = new Set(tokenize(textB));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function hasMetric(text) {
  // Numbers with suffixes (10M, 5k, 500), dollar amounts ($50), percentages (73%, 73 percent)
  return /\b(\d+[mk]?\b|\$\d+|\b\d+\s*%\b|\b\d+\s*percent\b)/i.test(text);
}

function findAiSlopTerms(text) {
  const lower = normalizeText(text);
  return AI_SLOP_TERMS.filter(term => lower.includes(term));
}

function findBannedPhrases(text) {
  const lower = normalizeText(text);
  return BANNED_PHRASES.filter(phrase => lower.includes(phrase));
}

function findGenericOpeners(text) {
  const lower = normalizeText(text);
  return GENERIC_OPENERS.filter(opener => lower.startsWith(opener));
}

function findSimilarDrafts(text, allDrafts, excludeId) {
  if (!Array.isArray(allDrafts) || allDrafts.length === 0) return [];
  const normalized = normalizeText(text);
  if (!normalized) return [];
  return allDrafts
    .filter(d => d && d.id !== excludeId && d.text)
    .map(d => ({
      id: d.id,
      angle: d.angle || 'untitled',
      similarity: jaccardSimilarity(text, d.text)
    }))
    .filter(d => d.similarity >= SIMILARITY_THRESHOLD)
    .sort((a, b) => b.similarity - a.similarity);
}

// ── Check level → status/severity mapping ────────────────────

/**
 * Each check returns a result object:
 *   { name, level: 'pass'|'proof'|'warn'|'fail', message }
 *
 * Level to status contribution:
 *   pass  → no contribution
 *   proof → 'needs-proof'
 *   warn  → 'revise'
 *   fail  → 'blocked'
 */
const LEVEL_TO_STATUS = {
  pass: null,
  proof: 'needs-proof',
  warn: 'revise',
  fail: 'blocked'
};

const LEVEL_TO_PENALTY = {
  pass: 0,
  proof: 8,
  warn: 12,
  fail: 25
};

// ── Individual checks ────────────────────────────────────────

function checkCharLength(text) {
  const len = String(text || '').length;
  if (len > MAX_LENGTH) {
    return {
      name: 'char-length',
      level: 'fail',
      message: `${len} characters — exceeds ${MAX_LENGTH} char limit`
    };
  }
  if (len > WARN_LENGTH) {
    return {
      name: 'char-length',
      level: 'warn',
      message: `${len} characters — near the ${MAX_LENGTH} char limit`
    };
  }
  return { name: 'char-length', level: 'pass', message: `${len} characters` };
}

function checkMetricRisk(text, sourceRefs) {
  if (!hasMetric(text)) {
    return { name: 'metric-risk', level: 'pass', message: 'no unverified metrics' };
  }
  const refs = Array.isArray(sourceRefs) ? sourceRefs.filter(Boolean) : [];
  if (refs.length === 0) {
    return {
      name: 'metric-risk',
      level: 'proof',
      message: 'contains metric(s) but no sourceRefs — verify before publishing'
    };
  }
  return {
    name: 'metric-risk',
    level: 'proof',
    message: `contains metric(s) — ${refs.length} sourceRef(s) attached, verify accuracy`
  };
}

function checkSourceRefs(text, sourceRefs) {
  // Only flag if the draft is claim-heavy (has metrics or strong factual language)
  // but has no sourceRefs at all.
  const refs = Array.isArray(sourceRefs) ? sourceRefs.filter(Boolean) : [];
  if (refs.length > 0) {
    return { name: 'source-refs', level: 'pass', message: `${refs.length} sourceRef(s)` };
  }
  // Claim-heavy heuristic: contains numbers, percentages, or factual assertion cues
  const claimHeavy =
    hasMetric(text) ||
    /\b(study|studies|research|data|report|survey|according to|source|sources)\b/i.test(text);
  if (claimHeavy) {
    return {
      name: 'source-refs',
      level: 'proof',
      message: 'claim-heavy draft has no sourceRefs — add sources before publishing'
    };
  }
  return { name: 'source-refs', level: 'pass', message: 'no sourceRefs needed (non-claim draft)' };
}

function checkAiSlop(text) {
  const found = findAiSlopTerms(text);
  if (found.length === 0) {
    return { name: 'ai-slop', level: 'pass', message: 'no AI-slop terms' };
  }
  return {
    name: 'ai-slop',
    level: 'warn',
    message: `AI-slop term(s): ${found.map(t => `"${t}"`).join(', ')}`
  };
}

function checkBannedPhrases(text) {
  const found = findBannedPhrases(text);
  if (found.length === 0) {
    return { name: 'banned-phrases', level: 'pass', message: 'no banned phrases' };
  }
  return {
    name: 'banned-phrases',
    level: 'fail',
    message: `banned phrase(s): ${found.map(p => `"${p}"`).join(', ')}`
  };
}

function checkTooGeneric(text) {
  const len = String(text || '').length;
  if (len > 0 && len < MIN_SUBSTANTIVE_LENGTH) {
    return {
      name: 'too-generic',
      level: 'warn',
      message: `very short (${len} chars) — may be too generic`
    };
  }
  const openers = findGenericOpeners(text);
  if (openers.length > 0) {
    return {
      name: 'too-generic',
      level: 'warn',
      message: `generic opener: "${openers[0]}"`
    };
  }
  return { name: 'too-generic', level: 'pass', message: 'substantive enough' };
}

function checkDuplicate(text, allDrafts, excludeId) {
  const similar = findSimilarDrafts(text, allDrafts, excludeId);
  if (similar.length === 0) {
    return { name: 'duplicate', level: 'pass', message: 'no similar drafts' };
  }
  const top = similar[0];
  const pct = Math.round(top.similarity * 100);
  return {
    name: 'duplicate',
    level: 'warn',
    message: `${pct}% similar to draft "${top.angle}" (${top.id})`
  };
}

// ── Main entry point ─────────────────────────────────────────

/**
 * Run all review gate checks against a draft.
 *
 * @param {object} draft — { text, sourceRefs, id, angle, ... }
 * @param {object} [options]
 * @param {array}  [options.allDrafts] — all drafts for duplicate detection
 * @returns {{ status, score, checks, warnings, suggestions }}
 */
export function reviewDraft(draft, options = {}) {
  const text = String(draft?.text || '');
  const sourceRefs = Array.isArray(draft?.sourceRefs) ? draft.sourceRefs : [];
  const id = draft?.id || null;
  const allDrafts = Array.isArray(options.allDrafts) ? options.allDrafts : [];

  const checks = [
    checkCharLength(text),
    checkMetricRisk(text, sourceRefs),
    checkSourceRefs(text, sourceRefs),
    checkAiSlop(text),
    checkBannedPhrases(text),
    checkTooGeneric(text),
    checkDuplicate(text, allDrafts, id)
  ];

  // Determine worst status
  let worstRank = 0;
  for (const check of checks) {
    const status = LEVEL_TO_STATUS[check.level];
    if (status && SEVERITY_RANK[status] > worstRank) {
      worstRank = SEVERITY_RANK[status];
    }
  }
  const status = RANK_TO_STATUS[worstRank];

  // Compute score
  let penalty = 0;
  for (const check of checks) {
    penalty += LEVEL_TO_PENALTY[check.level] || 0;
  }
  const score = Math.max(0, Math.min(100, 100 - penalty));

  // Collect warning strings from non-pass checks
  const warnings = checks
    .filter(c => c.level !== 'pass')
    .map(c => c.message);

  // Suggestions for fixing
  const suggestions = [];
  if (checks.find(c => c.name === 'char-length' && c.level === 'fail')) {
    suggestions.push('Trim text to 280 characters or fewer.');
  }
  if (checks.find(c => c.name === 'metric-risk' && c.level === 'proof')) {
    suggestions.push('Add sourceRefs for any metric, or remove unverified numbers.');
  }
  if (checks.find(c => c.name === 'ai-slop' && c.level === 'warn')) {
    suggestions.push('Rewrite to remove AI-slop terms.');
  }
  if (checks.find(c => c.name === 'banned-phrases' && c.level === 'fail')) {
    suggestions.push('Remove banned phrase — this draft cannot ship as-is.');
  }

  return { status, score, checks, warnings, suggestions };
}

/**
 * Quick boolean: is the gate status a hard block?
 */
export function isBlocked(gateResult) {
  return gateResult?.status === 'blocked';
}

/**
 * Quick boolean: does the gate status need operator attention?
 */
export function needsAttention(gateResult) {
  return gateResult?.status && gateResult.status !== 'clean';
}

// ── Exports for testing/tuning ───────────────────────────────

export const _internals = {
  AI_SLOP_TERMS,
  BANNED_PHRASES,
  GENERIC_OPENERS,
  MAX_LENGTH,
  WARN_LENGTH,
  SIMILARITY_THRESHOLD,
  hasMetric,
  jaccardSimilarity,
  normalizeText,
  tokenize
};
