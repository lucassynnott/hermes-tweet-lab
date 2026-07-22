import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  ensureStore,
  listCollection,
  getItem,
  createItem,
  updateItem,
  deleteItem,
  appendAudit,
  exportAll,
  importAll,
  bulkUpsertXHistory,
  STORE_INFO
} from './lib/store.js';
import { reviewDraft, isBlocked } from './lib/reviewGate.js';
import {
  recordLiveSuccess,
  recordLiveFailure,
  recordGoroSuccess,
  recordGoroFailure,
  recordScheduleAttempt,
  recordContextPacket,
  recordXHistorySync,
  recordGenerationAttempt,
  buildReport as buildDiagnosticsReport,
  APP_VERSION
} from './lib/diagnostics.js';
import {
  validateSlot,
  isWellFormedSlot,
  findConflicts,
  detectScheduleQueueConflicts,
  buildSuggestions,
  projectSlotToIso,
  groupQueueByDay,
  summarizeQueue,
  WEEKDAY_LABELS,
  _internals as SCHEDULE_INTERNALS
} from './lib/schedule.js';
import { listFeatures, listFeaturesBySection, getFeature, explainBlocked, NETWORK_INFO } from './lib/network.js';
import { buildContextPacket, CONTEXT_INFO, searchObsidianVault } from './lib/context.js';
import {
  fetchXHistoryPageOnce,
  backfillXHistory,
  getCachedStatus as getCachedXHistoryStatus,
  getXHistoryStatus,
  resolveLucasHandle,
  X_HISTORY_PROVIDER,
  X_HISTORY_INFO,
  resetXHistoryForTests
} from './lib/xHistory.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const MAX_BODY_BYTES = 128 * 1024;
const DEFAULT_POSTIZ_API_URL = 'https://postiz.com/api';
const DRAFT_STATUSES = new Set(['generated', 'needs-proof', 'approved', 'scheduled', 'rejected', 'posted']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8'
};

// Only these browser assets are public. Never serve arbitrary repository files:
// a broad filesystem fallback can expose .env, .git/config, runtime data, docs,
// or any future credential file accidentally placed in the project directory.
const PUBLIC_ASSETS = new Set([
  '/index.html',
  '/app.js',
  '/styles.css',
  '/redesign.css',
  '/compose-drawer.js',
  '/mobile-nav.js',
  '/operator-profile.js'
]);

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(body);
}

function sendText(res, statusCode, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, { 'content-type': contentType, 'cache-control': 'no-store' });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function parseJsonBody(req) {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error('Invalid JSON body');
    error.statusCode = 400;
    throw error;
  }
}

function asStringArray(value) {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/\n|,/).map(item => item.trim()).filter(Boolean);
  return [];
}

function pickGoroMode() {
  if (process.env.GORO_GENERATE_MODE === 'mock') return 'mock';
  if (process.env.GORO_GENERATE_URL) return 'http';
  return 'hermes';
}

function extractJsonObject(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;

  // Strip leading/trailing markdown code fences (```json ... ``` or ``` ... ```).
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/i);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1]);
    } catch {
      // Fall through: the inside of the fence may still have stray prose; try a slice.
    }
  }

  // First try direct parse.
  try {
    return JSON.parse(trimmed);
  } catch {
    // Look for the first {...} or [...] block that parses.
    const objectMatch = trimmed.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try { return JSON.parse(objectMatch[0]); } catch { /* ignore */ }
    }
    const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try { return JSON.parse(arrayMatch[0]); } catch { /* ignore */ }
    }
    return null;
  }
}

function normalizeCandidates(payload, adapter, warnings) {
  const baseWarnings = Array.isArray(warnings) ? warnings : [];

  if (Array.isArray(payload?.candidates)) {
    return payload.candidates.map((candidate, index) => {
      const thread = Array.isArray(candidate.thread)
        ? candidate.thread.map((t) => String(t || '').trim()).filter(Boolean)
        : null;
      return {
        id: candidate.id || `${adapter}-${index + 1}`,
        text: thread && thread.length ? thread[0] : String(candidate.text || candidate.content || '').trim(),
        segments: thread && thread.length ? thread : null,
        kind: thread && thread.length ? 'thread' : null,
        angle: candidate.angle || candidate.label || `Candidate ${index + 1}`,
        rationale: candidate.rationale || '',
        sourceRefs: Array.isArray(candidate.sourceRefs) ? candidate.sourceRefs : [],
        warnings: Array.isArray(candidate.warnings) ? candidate.warnings : baseWarnings
      };
    }).filter(candidate => candidate.text);
  }

  if (Array.isArray(payload?.tweets)) {
    return payload.tweets.map((text, index) => ({
      id: `${adapter}-${index + 1}`,
      text: String(text || '').trim(),
      angle: `Candidate ${index + 1}`,
      rationale: '',
      sourceRefs: [],
      warnings: baseWarnings
    })).filter(candidate => candidate.text);
  }

  if (Array.isArray(payload)) {
    return payload.map((text, index) => ({
      id: `${adapter}-${index + 1}`,
      text: String(text || '').trim(),
      angle: `Candidate ${index + 1}`,
      rationale: '',
      sourceRefs: [],
      warnings: baseWarnings
    })).filter(candidate => candidate.text);
  }

  if (typeof payload?.text === 'string' || typeof payload?.content === 'string') {
    return [{
      id: `${adapter}-1`,
      text: String(payload.text || payload.content).trim(),
      angle: payload.angle || 'Goro draft',
      rationale: payload.rationale || '',
      sourceRefs: Array.isArray(payload.sourceRefs) ? payload.sourceRefs : [],
      warnings: baseWarnings
    }].filter(candidate => candidate.text);
  }

  return [];
}

function draftNeedsProof(candidate) {
  const text = String(candidate.text || '');
  return /\b(\d+[mk]?|\$\d+|%|percent)\b/i.test(text);
}

/**
 * Compute the review gate for a draft, using all existing drafts for
 * duplicate detection. Returns a compact object for persistence.
 */
async function computeGate(draft, { excludeId } = {}) {
  const allDrafts = await listCollection('drafts');
  const gate = reviewDraft(draft, { allDrafts });
  return {
    gateStatus: gate.status,
    gateScore: gate.score,
    gateWarnings: gate.warnings,
    gateChecks: gate.checks,
    gateSuggestions: gate.suggestions
  };
}

async function persistGeneratedDrafts(result, { parentDraftId = null, remixSource = null } = {}) {
  const drafts = [];
  const packetRefs = Array.isArray(result.sourcePacket?.contextSourceRefs) ? result.sourcePacket.contextSourceRefs : [];
  const packetWarnings = Array.isArray(result.sourcePacket?.contextWarnings) ? result.sourcePacket.contextWarnings : [];
  for (const candidate of result.candidates) {
    const candidateRefs = [...new Set([...(candidate.sourceRefs || []), ...packetRefs])];
    const candidateWarnings = [...new Set([...(candidate.warnings || []), ...packetWarnings])];
    // Compute gate before persisting so duplicate detection sees prior drafts in this batch.
    const gateInput = {
      text: candidate.text,
      sourceRefs: candidateRefs,
      id: null
    };
    // Include already-persisted drafts from this batch for duplicate detection.
    const allDrafts = [...(await listCollection('drafts')), ...drafts];
    const gate = reviewDraft(gateInput, { allDrafts });

    const draft = await createItem('drafts', {
      text: candidate.text,
      kind: candidate.kind || 'short',
      segments: candidate.segments || null,
      angle: candidate.angle,
      rationale: candidate.rationale,
      sourceRefs: candidateRefs,
      warnings: candidateWarnings,
      status: gate.status === 'needs-proof' ? 'needs-proof' : 'generated',
      templateId: result.sourcePacket?.templateId || null,
      templateName: result.sourcePacket?.template?.name || null,
      gateStatus: gate.status,
      gateScore: gate.score,
      gateWarnings: gate.warnings,
      gateChecks: gate.checks,
      gateSuggestions: gate.suggestions,
      parentDraftId: parentDraftId || null,
      remixSource: remixSource || null
    });
    drafts.push(draft);
    await appendAudit({
      kind: parentDraftId ? 'draft.remixed' : 'draft.generated',
      draftId: draft.id,
      status: draft.status,
      adapter: result.adapter,
      sourceRefs: Array.isArray(draft.sourceRefs) ? draft.sourceRefs.length : 0,
      templateId: draft.templateId,
      gateStatus: draft.gateStatus,
      gateScore: draft.gateScore,
      parentDraftId: draft.parentDraftId || null
    });
  }
  return drafts;
}

async function remixDraft(payload) {
  const draftId = String(payload.draftId || '').trim();
  const instruction = String(payload.instruction || '').trim();
  const tone = String(payload.tone || '').trim();
  const count = Math.max(1, Math.min(Number(payload.count || 2), 3));
  const templateId = String(payload.templateId || '').trim();

  if (!draftId) {
    const error = new Error('draftId is required for remix.');
    error.statusCode = 400;
    throw error;
  }

  const parentDraft = await getItem('drafts', draftId);
  if (!parentDraft) {
    const error = new Error(`drafts/${draftId} not found`);
    error.statusCode = 404;
    throw error;
  }

  // Build a source tweet from the parent draft for the rewrite path.
  const sourceTweet = {
    id: parentDraft.id,
    author: 'previous-draft',
    url: '',
    text: parentDraft.text || '',
    warnings: [
      ...(parentDraft.warnings || []),
      ...(parentDraft.gateWarnings || [])
    ],
    source: 'tweet-lab-draft'
  };

  // Build context that includes the operator instruction and parent draft metadata.
  const contextParts = [
    instruction ? `Operator instruction: ${instruction}` : '',
    parentDraft.angle ? `Original angle: ${parentDraft.angle}` : '',
    parentDraft.rationale ? `Original rationale: ${parentDraft.rationale}` : '',
    Array.isArray(parentDraft.sourceRefs) && parentDraft.sourceRefs.length
      ? `Original sources: ${parentDraft.sourceRefs.join(', ')}`
      : ''
  ].filter(Boolean);

  const context = contextParts.join('\n');

  // Use the existing rewrite path but with the parent draft as source.
  const rewritePayload = {
    sourceTweet,
    context,
    tone: tone || 'sharp, useful, no AI slop',
    count,
    templateId: templateId || parentDraft.templateId || undefined
  };

  const result = await rewriteTweet(rewritePayload);

  // Persist with parent reference.
  const remixSource = {
    parentDraftId: parentDraft.id,
    parentAngle: parentDraft.angle,
    parentText: parentDraft.text,
    instruction,
    originalSourceRefs: parentDraft.sourceRefs || []
  };
  const drafts = await persistGeneratedDrafts(result, { parentDraftId: parentDraft.id, remixSource });

  return { ...result, drafts, parentDraftId: parentDraft.id };
}

async function remixAndPersist(payload) {
  return remixDraft(payload);
}

async function transitionDraft(id, payload) {
  const status = String(payload.status || '').trim();
  if (!DRAFT_STATUSES.has(status)) {
    const error = new Error(`Draft status must be one of: ${Array.from(DRAFT_STATUSES).join(', ')}`);
    error.statusCode = 400;
    throw error;
  }
  const current = await getItem('drafts', id);
  if (!current) {
    const error = new Error(`drafts/${id} not found`);
    error.statusCode = 404;
    throw error;
  }
  const patch = { status };
  if (status === 'rejected') {
    const rejectReason = String(payload.rejectReason || payload.reason || '').trim();
    if (!rejectReason) {
      const error = new Error('Reject reason is required when rejecting a draft.');
      error.statusCode = 400;
      throw error;
    }
    patch.rejectReason = rejectReason;
  }
  if (status === 'approved') patch.approvedAt = new Date().toISOString();
  if (status === 'scheduled' && payload.scheduledAt) patch.scheduledAt = payload.scheduledAt;
  if (status === 'posted') patch.postedAt = new Date().toISOString();

  const draft = await updateItem('drafts', id, patch);
  const audit = await appendAudit({
    kind: 'draft.status',
    draftId: id,
    fromStatus: current.status || 'generated',
    toStatus: status,
    rejectReason: patch.rejectReason
  });
  return { draft, audit };
}

async function editDraft(id, payload) {
  const current = await getItem('drafts', id);
  if (!current) {
    const error = new Error(`drafts/${id} not found`);
    error.statusCode = 404;
    throw error;
  }
  const text = String(payload.text ?? current.text ?? '').trim();
  if (!text) {
    const error = new Error('Draft text is required.');
    error.statusCode = 400;
    throw error;
  }
  const draft = await updateItem('drafts', id, {
    text,
    angle: payload.angle ?? current.angle,
    rationale: payload.rationale ?? current.rationale,
    sourceRefs: payload.sourceRefs ?? current.sourceRefs,
    warnings: payload.warnings ?? current.warnings
  });
  // Recompute the review gate after edits.
  const gate = await computeGate(draft, { excludeId: id });
  const updated = await updateItem('drafts', id, gate);
  const audit = await appendAudit({
    kind: 'draft.edit',
    draftId: id,
    fromLength: String(current.text || '').length,
    toLength: text.length,
    gateStatus: gate.gateStatus,
    gateScore: gate.gateScore
  });
  return { draft: updated, audit };
}

function buildQueue({ sources, tag, format, count, seed }) {
  const pool = sources.filter(s => {
    if (tag && !(s.tags || []).some(t => String(t).toLowerCase().includes(String(tag).toLowerCase()))) return false;
    if (format && s.format !== format) return false;
    return true;
  });
  // Score and sort: higher quality first, fresher (not stale) first, then deterministic shuffle.
  const scored = pool.map(s => {
    let score = 0;
    if (s.qualityScore) score += s.qualityScore * 10;
    if (s.stale === true) score -= 50;
    else if (s.stale === false) score += 5;
    // Age penalty: older sources lose points
    const ageMs = s.createdAt ? Date.now() - new Date(s.createdAt).getTime() : 0;
    if (ageMs > 0) score -= Math.min(20, Math.round(ageMs / 86400000 / 7)); // -1 per week, max -20
    return { source: s, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const rng = seed ? mulberry32(String(seed).split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)) : Math.random;
  // Within same score, shuffle deterministically
  const groups = [];
  let currentScore = null;
  let currentGroup = [];
  for (const item of scored) {
    if (item.score !== currentScore) {
      if (currentGroup.length) groups.push(currentGroup);
      currentScore = item.score;
      currentGroup = [item];
    } else {
      currentGroup.push(item);
    }
  }
  if (currentGroup.length) groups.push(currentGroup);
  const shuffled = groups.flatMap(group => group.sort(() => rng() - 0.5));
  const selected = shuffled.slice(0, Math.max(1, Math.min(Number(count) || 5, 10)));
  return selected.map(item => ({
    ...item.source,
    suggestedAngle: suggestAngle(item.source),
    whyItMayWork: whyItMayWork(item.source)
  }));
}

function mulberry32(a) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function suggestAngle(source) {
  const formatAngles = {
    contrarian: 'Flip the common assumption.',
    list: 'Turn into a numbered punch list.',
    story: 'Lead with the moment of tension.',
    'how-to': 'Show the exact step someone skips.',
    warning: 'Name the hidden cost.',
    framework: 'Map the decision tree.',
    reply: 'Answer the unspoken objection.'
  };
  return formatAngles[source.format] || 'Use the core insight as a hook.';
}

function whyItMayWork(source) {
  const reasons = [];
  if (source.whySaved) reasons.push(source.whySaved);
  if (source.format) reasons.push(`Format: ${source.format}`);
  if (source.sourceType === 'trend') reasons.push('Trend-backed angle.');
  if (source.sourceType === 'tweet') reasons.push('Proven tweet structure.');
  return reasons.join(' · ') || 'Saved for strategic relevance.';
}

function buildRecipeBlock(template, templateId) {
  if (!template || !template.body) {
    return templateId ? `Template id: ${templateId} (not found in library)` : 'No template selected.';
  }
  const lines = [`Template: ${template.name || 'untitled'}`, template.body];
  if (template.intent) lines.push(`Intent: ${template.intent}`);
  if (template.whenToUse) lines.push(`When to use: ${template.whenToUse}`);
  if (template.constraints) lines.push(`Constraints: ${template.constraints}`);
  if (template.exampleOutput) lines.push(`Example output: ${template.exampleOutput}`);
  if (template.sourceRequirements) lines.push(`Source requirements: ${template.sourceRequirements}`);
  if (template.forbiddenPatterns) lines.push(`Forbidden patterns: ${template.forbiddenPatterns}`);
  return lines.join('\n');
}


function compactForPrompt(value, limit = 1400) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function warnFromHermesResult(result) {
  return result?.adapterWarning ? [result.adapterWarning] : [];
}

function buildGoroPrompt({ inspirationLinks, resolvedTweets, context, tone, count, selectedSources, template, templateId, postType }) {
  const safeLinks = inspirationLinks.slice(0, 6);
  const safeResolved = resolvedTweets.slice(0, 6);
  const safeSelected = Array.isArray(selectedSources) ? selectedSources.slice(0, 10) : [];
  const linkBlock = safeLinks.length
    ? safeLinks.map((link, index) => `${index + 1}. ${link}`).join('\n')
    : 'No inspiration links provided.';

  const resolvedBlock = safeResolved.length
    ? safeResolved.map((item, index) => `${index + 1}. ${item.url} — author=${item.author || 'unknown'} created=${item.createdAt || 'unknown'} source=${item.source}${item.warning ? ` warning=${item.warning}` : ''}\n   text=${compactForPrompt(item.text || '(unresolved text)', 360)}${item.statusId ? ` statusId=${item.statusId}` : ''}`).join('\n')
    : 'No resolved tweet content available.';

  const selectedBlock = safeSelected.length
    ? safeSelected.map((s, index) => `${index + 1}. ${s.url || s.text || '(no link)'} — author=${s.author || 'unknown'} format=${s.format || 'unset'}\n   text=${compactForPrompt(s.text || '', 280)}\n   suggestedAngle: ${compactForPrompt(s.suggestedAngle || '', 160)}\n   whyItMayWork: ${compactForPrompt(s.whyItMayWork || '', 160)}`).join('\n')
    : 'No selected source cards from the daily queue.';

  const templateBlock = buildRecipeBlock(template, templateId);

  const topic = compactForPrompt(context || '', 2200).trim();
  const kind = String(postType || 'short').toLowerCase();
  const isThread = kind === 'thread';
  const jsonShape = isThread
    ? '{"candidates":[{"id":"goro-1","thread":["<hook tweet under 280 chars>","<follow-up under 280>","<follow-up under 280>","..."],"angle":"<short angle label>","rationale":"<why this angle>","sourceRefs":["<url>"],"warnings":[]}]}'
    : '{"candidates":[{"id":"goro-1","text":"<draft body>","angle":"<short angle label>","rationale":"<why this angle>","sourceRefs":["<url>"],"warnings":[]}]}';
  const formatLine = {
    short: 'FORMAT: one tweet, under 280 characters. Tight and punchy.',
    long: 'FORMAT: one long-form post, roughly 300-700 characters (X long post). Develop the idea; do not pad.',
    article: 'FORMAT: a structured long-form article, roughly 600-1500 characters, with a strong first line and blank lines between short paragraphs.',
    thread: 'FORMAT: a thread. Put each tweet as a separate string in the "thread" array — 4 to 8 tweets building hook → argument → payoff. The hook (first tweet) is tight; the follow-ups are MEATY and detailed (long-form posts, not capped at 280 — often 300-600 chars each, with a concrete mechanism, example, number, or step). Write each tweet with line breaks like Lucas does on X: short lines / mini-paragraphs separated by a blank line (literal \\n\\n inside the JSON string), not dense single blocks. No "1/" numbering and no manual numbering.',
  }[kind] || 'FORMAT: one tweet, under 280 characters.';
  const lengthConstraint = (kind === 'short')
    ? 'under 280 characters; '
    : isThread
      ? 'hook tweet tight; follow-up tweets detailed and substantive (length not capped at 280); '
      : '';
  return [
    'You are Goro writing tweet-ready drafts for Lucas.',
    formatLine,
    topic
      ? `REQUIRED SUBJECT — every draft MUST be about this topic: "${topic}". Do not drift to other subjects.`
      : 'No specific topic given — draft on Lucas\'s usual themes (AI operators, leverage, useful systems).',
    'The inspiration links, resolved tweets, and source cards below are ONLY a reference for Lucas\'s voice, tone, and structure — they MUST NOT change the subject and MUST NOT be copied.',
    'Do not reproduce the source tweets verbatim. Do not invent metrics, sources, or attribution.',
    'Return JSON only with this exact shape and nothing else:',
    jsonShape,
    `Requested count: ${count}`,
    `Tone: ${tone || 'lucid, sharp, operator-grade, no AI slop'}`,
    `Operator topic (REQUIRED SUBJECT): ${topic || 'No extra context provided.'}`,
    'Inspiration links (voice/style reference only):',
    linkBlock,
    'Resolved tweet content (voice/style reference only — do not change the subject):',
    resolvedBlock,
    'Selected source cards (voice/style reference only — do not change the subject):',
    selectedBlock,
    templateBlock,
    `Constraints: ${lengthConstraint}no hashtags unless context demands them; no invented metrics; no verbatim copy.${topic ? ` Every draft must be about: "${topic}".` : ''}`
  ].join('\n');
}

function buildRewritePrompt({ sourceTweet, context, tone, count, template, templateId, postType }) {
  const srcText = String(sourceTweet?.text || '');
  const tweetBlock = sourceTweet
    ? `Source tweet to rewrite:\nauthor=${sourceTweet.author || 'unknown'}\nurl=${sourceTweet.url || '(no url)'}\ntext=${srcText.slice(0, 2000)}${srcText.length > 2000 ? '…' : ''}\n${sourceTweet.warnings?.length ? `warnings=${sourceTweet.warnings.join(', ')}` : ''}`
    : 'No source tweet provided.';

  const templateBlock = buildRecipeBlock(template, templateId);
  const kind = String(postType || 'short').toLowerCase();
  const formatLine = {
    short: 'FORMAT: rewrite as one tight tweet, under 280 characters.',
    long: 'FORMAT: rewrite as one long-form X post, roughly 300-700 characters. Develop the idea with substance; use line breaks / short paragraphs (literal \\n\\n) for readability. Not capped at 280.',
    article: 'FORMAT: rewrite as a structured long-form article, roughly 600-1500 characters, with a strong first line and blank lines between short paragraphs (literal \\n\\n). Not capped at 280.',
  }[kind] || 'FORMAT: rewrite as one tight tweet, under 280 characters.';
  const lengthConstraint = kind === 'short'
    ? 'under 280 characters; '
    : 'use line breaks for readability; length not capped at 280; ';

  return [
    'You are Goro rewriting a tweet for Lucas.',
    formatLine,
    'Take the source tweet below and write fresh tweet-ready drafts that preserve the core insight or angle but use Lucas\'s voice and framing.',
    'Do not reproduce the source tweet verbatim. Do not invent metrics, sources, or attribution.',
    'Do not add claims that are not implied by the source text.',
    'Return JSON only with this exact shape and nothing else:',
    '{"candidates":[{"id":"goro-1","text":"<rewritten draft>","angle":"<short angle label>","rationale":"<why this angle>","sourceRefs":["<url>"],"warnings":[]}]}',
    `Requested count: ${count}`,
    `Tone: ${tone || 'lucid, sharp, operator-grade, no AI slop'}`,
    `Operator context: ${compactForPrompt(context || 'No extra context provided.', 2200)}`,
    tweetBlock,
    templateBlock,
    `Constraints: ${lengthConstraint}no hashtags unless context demands them; no invented metrics; no verbatim copy; rewrite, do not quote.`
  ].join('\n');
}

// Build a Goro prompt specifically for drafting a *reply* to a mention. The
// shape is the same JSON the rewrite path returns, but the system framing is
// tighter: this is a reply, not a top-level tweet, so it must be a single
// short response (not a thread), acknowledge the person being replied to,
// stay grounded in the source text, and never publish.
function buildMentionReplyPrompt({ mention, parentTweet, context, tone, template, templateId }) {
  const mentionBlock = mention
    ? `Mention to reply to (public X post addressed to @${mention.username || 'unknown'}):\nauthor=${mention.author || mention.username || 'unknown'}\nurl=${mention.url || '(no url)'}\ntext=${(mention.text || '').slice(0, 600)}${(mention.text || '').length > 600 ? '…' : ''}`
    : 'No mention provided.';

  const parentBlock = parentTweet && parentTweet.text
    ? `Original tweet (thread parent) the mention is responding to:\nauthor=${parentTweet.author || 'unknown'}\nurl=${parentTweet.url || '(no url)'}\ntext=${(parentTweet.text || '').slice(0, 600)}${(parentTweet.text || '').length > 600 ? '…' : ''}`
    : 'No parent tweet context.';

  const templateBlock = buildRecipeBlock(template, templateId);

  return [
    'You are Goro drafting a reply tweet for Lucas.',
    'This is a REPLY (a single tweet that responds to a public mention), not a new top-level post. Keep it under 280 characters, no thread, no hashtags unless context demands them.',
    'Acknowledge the person being replied to only when natural. Do not invent facts, metrics, or attribution. Stay grounded in the source text.',
    'Do NOT publish. The operator will read, edit, and decide whether to send manually.',
    'Return JSON only with this exact shape and nothing else:',
    '{"candidates":[{"id":"goro-1","text":"<reply under 280 chars>","angle":"<short angle label>","rationale":"<why this angle>","sourceRefs":["<url>"],"warnings":[]}]}',
    `Tone: ${tone || 'lucid, sharp, operator-grade, no AI slop'}`,
    `Operator context: ${compactForPrompt(context || 'No extra context provided.', 2200)}`,
    mentionBlock,
    parentBlock,
    templateBlock,
    'Constraints: under 280 characters; no invented metrics; no verbatim copy of the source; do not flatter the source author; do not start with a greeting; reply, do not lecture.'
  ].join('\n');
}

async function rewriteTweet(payload) {
  const sourceTweet = payload.sourceTweet || null;
  const context = String(payload.context || '').trim();
  const tone = String(payload.tone || '').trim();
  const count = Math.max(1, Math.min(Number(payload.count || 2), 3));
  const postType = String(payload.postType || 'short').toLowerCase();
  const templateId = String(payload.templateId || '').trim();
  let template = null;
  if (templateId) {
    template = await getItem('templates', templateId);
  }

  if (!sourceTweet || !sourceTweet.text) {
    const error = new Error('Provide a source tweet with text to rewrite.');
    error.statusCode = 400;
    throw error;
  }

  const prompt = buildRewritePrompt({ sourceTweet, context, tone, count, template, templateId, postType });
  const forcedMock = process.env.GORO_GENERATE_MODE === 'mock';
  let adapter = pickGoroMode();
  let raw;
  let responseWarnings = [];

  if (forcedMock) {
    adapter = 'mock';
    raw = { candidates: mockCandidates({ inspirationLinks: [sourceTweet.url], context: `Rewrite: ${sourceTweet.text}`, tone, count, resolvedTweets: [sourceTweet] }) };
  } else if (process.env.GORO_GENERATE_URL) {
    adapter = 'http';
    raw = await callGoroHttp({ sourceTweet, context, tone, count, template, templateId }, prompt);
  } else {
    adapter = 'hermes';
    const hermesResult = callGoroHermes({ sourceTweet, context, tone, count, template, templateId }, prompt);
    raw = hermesResult.parsed;
    if (hermesResult.normalized) responseWarnings.push('non-json Goro response normalized by server');
    responseWarnings.push(...warnFromHermesResult(hermesResult));
  }

  const candidates = normalizeCandidates(raw, adapter, responseWarnings);
  if (!candidates.length) {
    const error = new Error('Goro returned no usable rewrite candidates.');
    error.statusCode = 502;
    error.details = raw;
    throw error;
  }

  return {
    adapter,
    mockModeForced: forcedMock,
    goroProfile: process.env.GORO_HERMES_PROFILE || 'goro',
    sourceTweet,
    candidates,
    warnings: responseWarnings,
    promptPreview: prompt.slice(0, 1200)
  };
}

// Expand a single tweet into a full thread (opening + follow-ups) in Lucas's voice.
async function expandThread(payload) {
  const opening = String(payload.text || payload.content || '').trim();
  if (!opening) {
    const error = new Error('Provide tweet text to expand into a thread.');
    error.statusCode = 400;
    throw error;
  }
  const prompt = [
    'You are Goro continuing a tweet thread for Lucas.',
    'The opening tweet below is FIXED — do not rewrite or restate it. Write the FOLLOW-UP tweets that continue it into a substantive, valuable thread in Lucas\'s voice.',
    'DEPTH IS THE GOAL. Each follow-up must be MEATY and detailed — not a one-liner. These are long-form posts, so length is NOT capped at 280 characters: write as long as the point deserves (a rich follow-up is often 300-600 characters; go longer when the substance warrants it). A reader should learn something concrete from every single tweet.',
    'Make each tweet carry real substance: a specific mechanism, a concrete example, a number, a step, a contrast, a "here\'s exactly how/why", a short list. Show, don\'t just assert. No vague platitudes, no filler, no restating the previous tweet.',
    'FORMATTING: write each follow-up the way Lucas writes on X — with line breaks. Break the text into short lines / mini-paragraphs separated by a blank line (\\n\\n) for rhythm and readability. Do NOT return dense single-block paragraphs. Match the line-break cadence of the opening tweet. Put line breaks inside the JSON strings as literal \\n characters.',
    'Give the thread an arc: each follow-up advances the argument (setup → the real insight → how it works in practice → the nuance most people miss → the payoff/takeaway). Write as many as the idea genuinely needs to be complete and useful — usually 4-7 follow-ups, more if the topic is rich.',
    'Hard rules: one complete, self-contained thought per tweet; no "1/" or manual numbering; no hashtags unless essential; never pad with fluff to hit length — every sentence must earn its place.',
    'Return JSON only with this exact shape and nothing else:',
    '{"followups":["<detailed follow-up tweet>","<detailed follow-up tweet>","..."]}',
    `Opening tweet (fixed):\n${compactForPrompt(opening, 2000)}`,
  ].join('\n');

  const forcedMock = process.env.GORO_GENERATE_MODE === 'mock';
  let adapter = pickGoroMode();
  let raw;
  let degraded = false;
  if (forcedMock) {
    adapter = 'mock';
    raw = { followups: ['Follow-up 1 (mock).', 'Follow-up 2 (mock).'] };
  } else if (process.env.GORO_GENERATE_URL) {
    adapter = 'http';
    raw = await callGoroHttp({ context: opening }, prompt);
  } else {
    adapter = 'hermes';
    const hermesResult = callGoroHermes({ context: opening }, prompt);
    raw = hermesResult.parsed;
    degraded = Boolean(hermesResult.degraded);
  }

  // A degraded (timed-out) call returns generic mock candidates unrelated to the
  // opening — never present those as a "thread". Fail clearly so the UI retries.
  if (degraded) {
    const error = new Error('Goro timed out building the thread. Try again.');
    error.statusCode = 504;
    throw error;
  }

  // Strict: only accept a real followups/thread array. Do NOT fall back to
  // generic candidates (that produced disconnected, off-topic tweets).
  const list = Array.isArray(raw?.followups)
    ? raw.followups
    : Array.isArray(raw?.thread)
      ? raw.thread
      : [];
  const followups = list.map((t) => String(t || '').trim()).filter(Boolean);
  if (!followups.length) {
    const error = new Error('Goro did not return thread follow-ups. Try again.');
    error.statusCode = 502;
    error.details = raw;
    throw error;
  }
  // Keep the operator's original tweet as the opening; goro only adds follow-ups.
  return { adapter, thread: [opening, ...followups] };
}

async function rewriteAndPersist(payload) {
  let result;
  try {
    result = await rewriteTweet(payload);
  } catch (error) {
    const forcedMock = process.env.GORO_GENERATE_MODE === 'mock';
    const adapter = forcedMock ? 'mock' : (process.env.GORO_GENERATE_URL ? 'http' : 'hermes');
    recordGoroFailure({ adapter, error });
    throw error;
  }
  const drafts = await persistGeneratedDrafts(result);
  recordGoroSuccess({
    adapter: result.adapter,
    candidates: result.candidates,
    drafts,
    mockModeForced: result.mockModeForced,
    warnings: result.warnings
  });
  return { ...result, drafts };
}

// ── Mentions feed + private AI reply drafts ───────────────────────────
//
// Public X mentions require user-context OAuth (the `users/me/mentions`
// endpoint with a user access token). The read-only X search/lookup API
// key we use elsewhere cannot fetch a user's mention timeline. Until that
// user-context credential is wired, the server returns a clear blocker
// instead of pretending to have live data. The blocker's exact wording is
// what the operator sees in the UI, so it must name the missing piece.
const MENTIONS_PROVIDER = 'x-users-me-mentions';

function mentionsConfigStatus() {
  // We deliberately do NOT read any user-context access token in the
  // browser; the server holds them if they exist. The presence of an env
  // var is the signal: when missing, we return a safe-blocked payload.
  const userContextConfigured = Boolean(
    String(process.env.X_USER_ACCESS_TOKEN || '').trim()
  );
  // Search-mode fallback works with the read-only app bearer (recent search of
  // `@handle`), so mentions are "configured" whenever either path is available.
  const searchConfigured = Boolean(getXBearerToken());
  const configured = userContextConfigured || searchConfigured;
  return {
    provider: userContextConfigured ? MENTIONS_PROVIDER : 'x-api-recent-search',
    readOnly: true,
    requiresUserContext: !configured,
    configured,
    mode: userContextConfigured ? 'user-context' : (searchConfigured ? 'search' : 'none'),
    credential: userContextConfigured ? 'X_USER_ACCESS_TOKEN' : (searchConfigured ? 'X_BEARER_TOKEN' : null),
    blocker: configured
      ? null
      : 'Live mentions require a server-side X token. Configure X_BEARER_TOKEN (search-based mentions) or X_USER_ACCESS_TOKEN (full mentions timeline) in your private service environment and restart Tweet Lab.'
  };
}

function normalizeMention(raw, requestedAccount, fetchedAt) {
  if (!raw || typeof raw !== 'object') return null;
  const author = raw.author || {};
  const text = String(raw.text || '').trim();
  if (!text && !raw.id) return null;
  const username = author.username || requestedAccount || 'unknown';
  return {
    id: String(raw.id || `${username}-${raw.created_at || fetchedAt || Date.now()}`),
    url: raw.url || `https://x.com/${username}/status/${raw.id}`,
    text,
    createdAt: raw.created_at || null,
    lang: raw.lang || null,
    conversationId: raw.conversation_id || null,
    inReplyToStatusId: raw.in_reply_to_status_id || null,
    inReplyToUserId: raw.in_reply_to_user_id || null,
    referencedTweets: Array.isArray(raw.referenced_tweets)
      ? raw.referenced_tweets.map(rt => ({
          type: rt.type || null,
          id: rt.id || null,
          authorId: rt.author_id || null
        }))
      : [],
    author: {
      id: author.id || null,
      username,
      name: author.name || username,
      profileImageUrl: author.profile_image_url || null,
      verified: author.verified ?? null
    },
    metrics: raw.public_metrics ? {
      likeCount: raw.public_metrics.like_count ?? null,
      repostCount: raw.public_metrics.retweet_count ?? null,
      replyCount: raw.public_metrics.reply_count ?? null,
      quoteCount: raw.public_metrics.quote_count ?? null,
      impressionCount: raw.public_metrics.impression_count ?? null
    } : null,
    source: MENTIONS_PROVIDER,
    fetchedAt: fetchedAt || null,
    warnings: []
  };
}

async function fetchLiveMentions(payload) {
  const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
  if (!accounts.length) {
    const error = new Error('At least one X account handle is required to fetch mentions.');
    error.statusCode = 400;
    throw error;
  }
  const status = mentionsConfigStatus();
  if (!status.configured) {
    const error = new Error(status.blocker);
    error.statusCode = 503;
    error.provider = MENTIONS_PROVIDER;
    error.readOnly = true;
    error.requiresUserContext = true;
    error.accounts = [];
    error.mentions = [];
    error.warnings = [status.blocker];
    error.credential = status.credential;
    throw error;
  }
  // User-context path. We never log or echo the access token; the X API call
  // is the only place it leaves the server. Limit per account to keep the
  // response bounded and the rate-limit surface small.
  const limit = Math.max(5, Math.min(Number(payload.limitPerAccount) || 10, 50));
  const fetchedAt = new Date().toISOString();
  const userToken = process.env.X_USER_ACCESS_TOKEN;
  const accountResults = [];
  const mentions = [];
  const warnings = [];
  for (const account of accounts) {
    const handle = String(account || '').replace(/^@+/, '').trim();
    if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
      accountResults.push({ username: handle, ok: false, mentionCount: 0, warnings: [`invalid handle: ${handle}`] });
      warnings.push(`invalid handle: ${handle}`);
      continue;
    }
    try {
      // Step 1: resolve user id from handle (the mentions endpoint is keyed
      // on numeric user id, not handle).
      const lookupUrl = `https://api.x.com/2/users/by/username/${encodeURIComponent(handle)}`;
      const lookupResp = await fetch(lookupUrl, {
        method: 'GET',
        headers: { authorization: `Bearer ${userToken}` },
        signal: AbortSignal.timeout(12000)
      });
      const lookupText = await lookupResp.text();
      let lookupData;
      try { lookupData = lookupText ? JSON.parse(lookupText) : {}; } catch { lookupData = { text: lookupText }; }
      if (!lookupResp.ok) {
        const msg = lookupData?.detail || lookupData?.title || `X API returned HTTP ${lookupResp.status}`;
        throw new Error(msg);
      }
      const userId = lookupData?.data?.id;
      if (!userId) throw new Error('user id not returned by X API');
      // Step 2: fetch mentions for the resolved user id.
      const params = new URLSearchParams({
        max_results: String(limit),
        'tweet.fields': 'created_at,author_id,public_metrics,entities,conversation_id,in_reply_to_status_id,in_reply_to_user_id,referenced_tweets,lang,attachments,note_tweet',
        expansions: 'author_id,referenced_tweets.id,attachments.media_keys',
        'user.fields': 'username,name,profile_image_url,verified'
      });
      const mentionsResp = await fetch(`https://api.x.com/2/users/${userId}/mentions?${params.toString()}`, {
        method: 'GET',
        headers: { authorization: `Bearer ${userToken}` },
        signal: AbortSignal.timeout(12000)
      });
      const mentionsText = await mentionsResp.text();
      let mentionsData;
      try { mentionsData = mentionsText ? JSON.parse(mentionsText) : {}; } catch { mentionsData = { text: mentionsText }; }
      if (!mentionsResp.ok) {
        const msg = mentionsData?.detail || mentionsData?.title || `X API returned HTTP ${mentionsResp.status}`;
        throw new Error(msg);
      }
      const includes = {
        users: new Map((mentionsData.includes?.users || []).map(user => [user.id, user])),
        tweets: new Map((mentionsData.includes?.tweets || []).map(tweet => [tweet.id, tweet]))
      };
      const normalized = (mentionsData.data || [])
        .map(tweet => {
          const enriched = {
            ...tweet,
            author: includes.users.get(tweet.author_id) || { username: handle, name: handle }
          };
          return normalizeMention(enriched, handle, fetchedAt);
        })
        .filter(Boolean);
      accountResults.push({ username: handle, ok: true, mentionCount: normalized.length, warnings: [] });
      mentions.push(...normalized);
    } catch (error) {
      accountResults.push({ username: handle, ok: false, mentionCount: 0, warnings: [error.message] });
      warnings.push(`${handle}: ${error.message}`);
    }
  }
  if (!mentions.length && accountResults.every(item => !item.ok)) {
    const error = new Error('All mention fetches failed.');
    error.statusCode = 502;
    error.accounts = accountResults;
    error.mentions = [];
    error.warnings = warnings;
    error.provider = MENTIONS_PROVIDER;
    error.readOnly = true;
    throw error;
  }
  mentions.sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  return {
    provider: MENTIONS_PROVIDER,
    readOnly: true,
    fetchedAt,
    accounts: accountResults,
    mentions,
    warnings
  };
}

// Bearer-based mention fetch via recent search (`@handle`). Works with the
// read-only app bearer we already have — no user-context OAuth required — so
// live mentions function without X_USER_ACCESS_TOKEN.
async function fetchMentionsViaSearch(payload) {
  const accounts = (Array.isArray(payload.accounts) && payload.accounts.length ? payload.accounts : [resolveLucasHandle()])
    .map(a => String(a || '').replace(/^@+/, '').trim())
    .filter(h => /^[A-Za-z0-9_]{1,15}$/.test(h));
  const bearerToken = getXBearerToken();
  if (!bearerToken) { const e = new Error('X_BEARER_TOKEN not available for mention search.'); e.statusCode = 503; throw e; }
  const limit = Math.max(10, Math.min(Number(payload.limitPerAccount) || 25, 50));
  const fetchedAt = new Date().toISOString();
  const accountResults = [];
  const mentions = [];
  const warnings = [];
  for (const handle of accounts) {
    try {
      const params = new URLSearchParams({
        query: `@${handle} -is:retweet -from:${handle}`,
        max_results: String(limit),
        'tweet.fields': 'created_at,author_id,public_metrics,entities,conversation_id,in_reply_to_user_id,referenced_tweets,lang,attachments,note_tweet',
        expansions: 'author_id,referenced_tweets.id,attachments.media_keys',
        'user.fields': 'username,name,profile_image_url,verified'
      });
      const resp = await fetch(`https://api.x.com/2/tweets/search/recent?${params.toString()}`, {
        method: 'GET', headers: { authorization: `Bearer ${bearerToken}` }, signal: AbortSignal.timeout(15000)
      });
      const txt = await resp.text();
      let data; try { data = txt ? JSON.parse(txt) : {}; } catch { data = { text: txt }; }
      if (!resp.ok) throw new Error(data?.detail || data?.title || `X API returned HTTP ${resp.status}`);
      const includes = { users: new Map((data.includes?.users || []).map(u => [u.id, u])) };
      const normalized = (data.data || [])
        .map(tweet => normalizeMention({ ...tweet, author: includes.users.get(tweet.author_id) || { username: 'unknown', name: 'unknown' } }, handle, fetchedAt))
        .filter(Boolean);
      accountResults.push({ username: handle, ok: true, mentionCount: normalized.length, warnings: [] });
      mentions.push(...normalized);
    } catch (error) {
      accountResults.push({ username: handle, ok: false, mentionCount: 0, warnings: [error.message] });
      warnings.push(`${handle}: ${error.message}`);
    }
  }
  mentions.sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  return { provider: 'x-api-recent-search', readOnly: true, fetchedAt, accounts: accountResults, mentions, warnings };
}

async function draftMentionReply(payload) {
  const mention = payload.mention && typeof payload.mention === 'object' ? payload.mention : null;
  const parentTweet = payload.parentTweet && typeof payload.parentTweet === 'object' ? payload.parentTweet : null;
  const context = String(payload.context || '').trim();
  const tone = String(payload.tone || '').trim();
  const templateId = String(payload.templateId || '').trim();
  const count = Math.max(1, Math.min(Number(payload.count || 1), 2));
  let template = null;
  if (templateId) {
    template = await getItem('templates', templateId);
  }
  if (!mention || !mention.text) {
    const error = new Error('Provide a mention with text to draft a reply.');
    error.statusCode = 400;
    throw error;
  }
  const prompt = buildMentionReplyPrompt({ mention, parentTweet, context, tone, template, templateId });
  const forcedMock = process.env.GORO_GENERATE_MODE === 'mock';
  let adapter = pickGoroMode();
  let raw;
  let responseWarnings = [];
  if (forcedMock) {
    adapter = 'mock';
    raw = { candidates: mockMentionReplies({ mention, context, tone, count }) };
  } else if (process.env.GORO_GENERATE_URL) {
    adapter = 'http';
    raw = await callGoroHttp({ mention, parentTweet, context, tone, count, template, templateId }, prompt);
  } else {
    adapter = 'hermes';
    const hermesResult = callGoroHermes({ mention, parentTweet, context, tone, count, template, templateId }, prompt);
    raw = hermesResult.parsed;
    if (hermesResult.normalized) responseWarnings.push('non-json Goro response normalized by server');
    responseWarnings.push(...warnFromHermesResult(hermesResult));
  }
  const candidates = normalizeCandidates(raw, adapter, responseWarnings);
  if (!candidates.length) {
    const error = new Error('Goro returned no usable reply candidates.');
    error.statusCode = 502;
    error.details = raw;
    throw error;
  }
  // Persist each candidate as a private reply draft. We never mark these
  // "published"; the operator must move them to a sent state explicitly via
  // a separate approval action (out of scope for this card).
  const replies = [];
  for (const candidate of candidates) {
    const persisted = await createItem('replies', {
      text: candidate.text,
      angle: candidate.angle,
      rationale: candidate.rationale,
      sourceRefs: candidateRefs,
      warnings: candidateWarnings,
      mentionId: mention.id || null,
      mentionAuthor: mention.author?.name || mention.username || null,
      mentionUsername: mention.author?.username || mention.username || null,
      mentionText: mention.text,
      mentionUrl: mention.url || null,
      parentTweet: parentTweet ? { id: parentTweet.id || null, author: parentTweet.author || null, text: parentTweet.text || null, url: parentTweet.url || null } : null,
      conversationId: mention.conversationId || null,
      context: context || null,
      tone: tone || null,
      templateId: templateId || null,
      templateName: template?.name || null,
      adapter,
      goroProfile: process.env.GORO_HERMES_PROFILE || 'goro',
      mockModeForced: forcedMock,
      published: false
    });
    replies.push(persisted);
    await appendAudit({
      kind: 'mention.reply.drafted',
      replyId: persisted.id,
      mentionId: persisted.mentionId,
      mentionUsername: persisted.mentionUsername,
      adapter,
      mockModeForced: forcedMock,
      charCount: String(persisted.text || '').length,
      published: false
    });
  }
  recordGoroSuccess({
    adapter,
    candidates,
    drafts: replies,
    mockModeForced: forcedMock,
    warnings: responseWarnings
  });
  return {
    adapter,
    mockModeForced: forcedMock,
    goroProfile: process.env.GORO_HERMES_PROFILE || 'goro',
    mention,
    parentTweet,
    candidates,
    replies,
    warnings: responseWarnings,
    promptPreview: prompt.slice(0, 1200)
  };
}

function mockMentionReplies({ mention, context, tone, count }) {
  const base = String(mention?.text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const angle = (mention?.author?.username && `@${mention.author.username}`) || 'this';
  const variants = [
    `Good question from ${angle}. The leverage is the loop that owns the handoff, not the model. ${base ? 'You saw the same thing in: ' + base.slice(0, 80) + '…' : 'Build the operator loop first.'}`,
    `Quick take for ${angle}: most teams over-buy the agent and under-buy the workflow. The loop catches the task, drafts, and pushes the next action. Anything else is decoration.`,
    `Fair point. The win is closing one loop live in 30 days, not stacking tools. ${base ? 'Re: ' + base.slice(0, 60) + '…' : 'Own the loop.'}`
  ];
  return variants.slice(0, Math.max(1, Math.min(Number(count) || 1, 2))).map((text, index) => {
    const clean = text;
    return {
      id: `mock-reply-${index + 1}`,
      text: clean,
      angle: ['Loop ownership', 'Anti-decoration', 'Operator priority'][index] || `Reply ${index + 1}`,
      rationale: 'Mock reply seed. Replace with a Goro draft in production.',
      sourceRefs: mention?.url ? [mention.url] : [],
      warnings: [
        'mock adapter — not a real Goro generation',
        ...(context ? [] : ['no operator context supplied'])
      ]
    };
  });
}

function mockCandidates({ inspirationLinks = [], context = '', tone = '', count = 2, resolvedTweets = [] } = {}) {
  const base = context?.trim() || 'Internal operators beat generic AI tools because they close loops inside the workflow.';
  const resolvedHint = resolvedTweets.length
    ? ` Inspired by ${resolvedTweets.length} reference tweet(s).`
    : (inspirationLinks.length ? ` Inspired by ${inspirationLinks.length} link(s).` : '');
  const variants = [
    `Most AI projects fail because they stop at answers. The leverage shows up when the loop owns the handoff: brief, draft, review, schedule, follow-up. ${base}`,
    `The move is not "use AI more." The move is one owned operating loop that turns messy inputs into shipped work every day. ${base}`,
    `If the tool cannot catch the task, shape the draft, and push the next action, it is decoration. Build the loop. ${base}`
  ];
  return variants.slice(0, Math.max(1, Math.min(Number(count) || 2, 3))).map((text, index) => {
    const clean = text;
    return {
      id: `mock-${index + 1}`,
      text: clean,
      angle: ['Operating loop', 'Positioning', 'Anti-slop'][index] || `Candidate ${index + 1}`,
      rationale: 'Mock seed built from operator context. Replace with a Goro draft in production.',
      sourceRefs: inspirationLinks.slice(0, 2),
      warnings: [
        ...(clean.length > 260 ? ['near character limit'] : []),
        ...(inspirationLinks.length === 0 ? ['no inspiration links supplied'] : []),
        ...(tone ? [] : ['default tone used']),
        ...(resolvedHint ? [] : [])
      ]
    };
  });
}

// AI Writer generation with multi-source retrieval and provenance
async function aiWriterGenerate(payload) {
  const prompt = String(payload.prompt || '').trim();
  const agentMode = Boolean(payload.agentMode);
  const autoMode = Boolean(payload.autoMode);
  const tone = String(payload.tone || '').trim();
  const count = Math.max(1, Math.min(Number(payload.count || 2), 3));

  if (!prompt) {
    const error = new Error('Prompt is required.');
    error.statusCode = 400;
    throw error;
  }

  // Build provenance from available sources
  const provenance = [];
  const warnings = [];

  // Voice DNA context
  provenance.push({
    id: 'lucas-voice-dna',
    type: 'voice-dna',
    label: 'Operator voice DNA',
    filePath: process.env.TWEET_LAB_VOICE_DNA_PATH || '~/.hermes/tweet-lab/voice-dna.md',
    excerpt: 'Operator voice guidance is loaded from the configured private voice file.'
  });

  // Previous posts context (stub — could be fetched from saved sources or live X)
  provenance.push({
    id: 'previous-posts-stub',
    type: 'previous-post',
    label: 'Previous posts',
    warnings: ['Stub: previous posts not yet retrieved from live X or saved sources']
  });

  // Obsidian vault context (stub)
  provenance.push({
    id: 'obsidian-vault-stub',
    type: 'obsidian-note',
    label: 'Obsidian vault',
    filePath: process.env.TWEET_LAB_CONTEXT_DIR || '~/.hermes/tweet-lab/context',
    warnings: ['Stub: vault retrieval not yet implemented server-side']
  });

  // Company context (stub)
  provenance.push({
    id: 'company-context-stub',
    type: 'company-context',
    label: 'Applied Leverage context',
    warnings: ['Stub: company context not yet loaded']
  });

  // Source bank
  let savedSources = [];
  try {
    savedSources = await listCollection('sources');
    if (savedSources.length) {
      provenance.push({
        id: 'source-bank',
        type: 'source-bank',
        label: `Source bank (${savedSources.length} sources)`,
        excerpt: `${savedSources.length} saved sources available for inspiration`
      });
    }
  } catch (error) {
    warnings.push(`Source bank unavailable: ${error.message}`);
  }

  // Live X inspiration (if agent mode and credentials exist)
  let liveTweets = [];
  if (agentMode) {
    const bearerToken = getXBearerToken();
    if (bearerToken) {
      try {
        // Search for recent posts related to the prompt topic
        const topics = prompt.split(/\s+/).filter(w => w.length > 3).slice(0, 3);
        if (topics.length) {
          const discoverResult = await discoverSearch({ topics, maxResults: 5, excludeReplies: true });
          liveTweets = discoverResult.results || [];
          if (liveTweets.length) {
            provenance.push({
              id: 'live-x',
              type: 'live-x-post',
              label: `Live X search (${liveTweets.length} posts)`,
              excerpt: `Topic search: ${topics.join(', ')}`,
              warnings: ['Live X data is read-only and time-bound']
            });
          }
        }
      } catch (error) {
        warnings.push(`Live X retrieval failed: ${error.message}`);
      }
    } else {
      warnings.push('X_BEARER_TOKEN not configured; live X retrieval skipped');
    }
  }

  // Build the generation prompt
  const contextParts = [
    `Operator prompt: ${prompt}`,
    `Agent Mode: ${agentMode ? 'ON' : 'OFF'}`,
    `Auto Mode: ${autoMode ? 'ON' : 'OFF'}`,
    `Tone: ${tone || 'lucid, sharp, operator-grade, no AI slop'}`,
    `Source bank: ${savedSources.length} saved sources`,
    `Live X inspiration: ${liveTweets.length} posts`
  ];

  const fullContext = contextParts.join('\n');

  // Reuse existing generate path with our constructed context
  const generatePayload = {
    context: fullContext,
    tone: tone || 'sharp, useful, no AI slop',
    count,
    selectedSources: savedSources.slice(0, 3).map(s => ({
      id: s.id,
      text: s.text,
      author: s.author,
      format: s.format,
      whySaved: s.whySaved
    }))
  };

  const forcedMock = process.env.GORO_GENERATE_MODE === 'mock';
  let adapter = pickGoroMode();
  let raw;
  let responseWarnings = [];

  if (forcedMock) {
    adapter = 'mock';
    raw = { candidates: mockCandidates({ inspirationLinks: [], context: fullContext, tone, count, resolvedTweets: liveTweets }) };
  } else if (process.env.GORO_GENERATE_URL) {
    adapter = 'http';
    const goroPrompt = buildGoroPrompt({
      inspirationLinks: [],
      resolvedTweets: liveTweets.map(t => ({
        url: t.url,
        text: t.text,
        author: t.author?.username,
        source: t.source,
        warning: t.warnings?.[0]
      })),
      context: fullContext,
      tone,
      count,
      selectedSources: generatePayload.selectedSources,
      template: null,
      templateId: null
    });
    raw = await callGoroHttp(generatePayload, goroPrompt);
  } else {
    adapter = 'hermes';
    const goroPrompt = buildGoroPrompt({
      inspirationLinks: [],
      resolvedTweets: liveTweets.map(t => ({
        url: t.url,
        text: t.text,
        author: t.author?.username,
        source: t.source,
        warning: t.warnings?.[0]
      })),
      context: fullContext,
      tone,
      count,
      selectedSources: generatePayload.selectedSources,
      template: null,
      templateId: null
    });
    const hermesResult = callGoroHermes(generatePayload, goroPrompt);
    raw = hermesResult.parsed;
    if (hermesResult.normalized) responseWarnings.push('non-json Goro response normalized by server');
    responseWarnings.push(...warnFromHermesResult(hermesResult));
  }

  const candidates = normalizeCandidates(raw, adapter, responseWarnings);
  if (!candidates.length) {
    const error = new Error('Goro returned no usable candidates.');
    error.statusCode = 502;
    error.details = raw;
    throw error;
  }

  // Attach provenance to each candidate
  for (const candidate of candidates) {
    candidate.sourceRefs = [...(candidate.sourceRefs || []), ...provenance.map(p => p.label)];
    candidate.warnings = [...(candidate.warnings || []), ...warnings];
  }

  return {
    adapter,
    mockModeForced: forcedMock,
    goroProfile: process.env.GORO_HERMES_PROFILE || 'goro',
    candidates,
    provenance,
    warnings: [...warnings, ...responseWarnings],
    promptPreview: fullContext.slice(0, 1200)
  };
}

const X_PROVIDER = 'x-api-recent-search';
const HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/;

function normalizeXAccountInput(input) {
  const raw = String(input || '').trim();
  if (!raw) return { input: raw, username: '', valid: false, error: 'empty account input' };
  let candidate = raw;
  try {
    const parsed = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    if (['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'].includes(parsed.hostname.toLowerCase())) {
      candidate = parsed.pathname.split('/').filter(Boolean)[0] || '';
    }
  } catch { /* plain handle */ }
  candidate = candidate.replace(/^@+/, '').trim();
  const valid = HANDLE_PATTERN.test(candidate);
  return {
    input: raw,
    username: candidate,
    valid,
    error: valid ? null : 'X handles must be 1-15 letters, numbers, or underscores.'
  };
}

function normalizeXAccounts(value) {
  const inputs = Array.isArray(value) ? value : asStringArray(value);
  const seen = new Set();
  const accounts = [];
  const invalid = [];
  for (const item of inputs) {
    const normalized = normalizeXAccountInput(item);
    if (!normalized.valid) {
      if (normalized.input) invalid.push(normalized);
      continue;
    }
    const key = normalized.username.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    accounts.push(normalized);
  }
  return { accounts, invalid };
}
function getXBearerToken() {
  return String(process.env.X_BEARER_TOKEN || '').trim();
}

function xRateLimitFromHeaders(headers) {
  const reset = headers.get('x-rate-limit-reset');
  return {
    limit: headers.get('x-rate-limit-limit') ? Number(headers.get('x-rate-limit-limit')) : null,
    remaining: headers.get('x-rate-limit-remaining') ? Number(headers.get('x-rate-limit-remaining')) : null,
    reset: reset ? new Date(Number(reset) * 1000).toISOString() : null
  };
}

function normalizeXTweet(rawTweet, includes, requestedUsername, fetchedAt) {
  const author = includes.users?.get(rawTweet.author_id) || { username: requestedUsername, name: requestedUsername };
  const mediaKeys = rawTweet.attachments?.media_keys || [];
  const media = mediaKeys.map(key => includes.media?.get(key)).filter(Boolean).map(item => ({
    mediaKey: item.media_key,
    type: item.type || null,
    url: item.url || null,
    previewImageUrl: item.preview_image_url || null,
    width: item.width ?? null,
    height: item.height ?? null,
    altText: item.alt_text || null
  }));
  const username = author.username || requestedUsername;
  const metrics = rawTweet.public_metrics ? {
    likeCount: rawTweet.public_metrics.like_count ?? null,
    repostCount: rawTweet.public_metrics.retweet_count ?? null,
    replyCount: rawTweet.public_metrics.reply_count ?? null,
    quoteCount: rawTweet.public_metrics.quote_count ?? null,
    impressionCount: rawTweet.public_metrics.impression_count ?? null
  } : null;
  return {
    id: rawTweet.id,
    url: `https://x.com/${username}/status/${rawTweet.id}`,
    // Long-form ("note") tweets cap rawTweet.text (~280); the full body lives
    // in note_tweet.text. Prefer it so cards aren't silently truncated.
    text: (rawTweet.note_tweet && rawTweet.note_tweet.text) || rawTweet.text || '',
    createdAt: rawTweet.created_at || null,
    author: {
      id: author.id || rawTweet.author_id || null,
      username,
      name: author.name || username,
      profileImageUrl: author.profile_image_url || null,
      verified: author.verified ?? null,
      publicMetrics: author.public_metrics || null
    },
    metrics,
    media,
    source: X_PROVIDER,
    fetchedAt,
    warnings: []
  };
}

async function fetchXRecentForAccount({ username, limitPerAccount, excludeReplies, mediaOnly, bearerToken }) {
  const queryParts = [`from:${username}`, '-is:retweet'];
  if (excludeReplies) queryParts.push('-is:reply');
  if (mediaOnly) queryParts.push('has:media');
  const params = new URLSearchParams({
    query: queryParts.join(' '),
    max_results: String(Math.max(10, Math.min(Number(limitPerAccount) || 10, 20))),
    'tweet.fields': 'created_at,author_id,public_metrics,attachments,entities,conversation_id,referenced_tweets,note_tweet',
    expansions: 'author_id,attachments.media_keys',
    'user.fields': 'username,name,profile_image_url,verified,public_metrics',
    'media.fields': 'type,url,preview_image_url,width,height,alt_text'
  });
  const response = await fetch(`https://api.x.com/2/tweets/search/recent?${params.toString()}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${bearerToken}` },
    signal: AbortSignal.timeout(12000)
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { text }; }
  const rateLimit = xRateLimitFromHeaders(response.headers);
  if (!response.ok) {
    const message = data?.detail || data?.title || data?.errors?.[0]?.message || `X API returned HTTP ${response.status}`;
    const error = new Error(message);
    error.statusCode = response.status === 429 ? 429 : 502;
    error.rateLimit = rateLimit;
    error.details = data;
    throw error;
  }
  const fetchedAt = new Date().toISOString();
  const includes = {
    users: new Map((data.includes?.users || []).map(user => [user.id, user])),
    media: new Map((data.includes?.media || []).map(media => [media.media_key, media]))
  };
  const tweets = (data.data || []).map(tweet => normalizeXTweet(tweet, includes, username, fetchedAt));
  return {
    username,
    ok: true,
    tweetCount: tweets.length,
    warnings: tweets.length ? [] : ['No recent matching tweets returned by X API.'],
    rateLimit,
    tweets
  };
}

async function fetchLiveAccountTweets(payload) {
  const { accounts, invalid } = normalizeXAccounts(payload.accounts || payload.account || payload.handles);
  if (!accounts.length) {
    const error = new Error(invalid.length ? 'No valid X account handles were supplied.' : 'At least one X account handle is required.');
    error.statusCode = 400;
    error.invalid = invalid;
    throw error;
  }
  if (accounts.length > 10) {
    const error = new Error('Fetch up to 10 X accounts per request.');
    error.statusCode = 400;
    throw error;
  }
  const bearerToken = getXBearerToken();
  if (!bearerToken) {
    const error = new Error('X_BEARER_TOKEN is not configured, so live account inspiration is unavailable.');
    error.statusCode = 503;
    recordLiveFailure({ accounts, error, fetchedAt: new Date().toISOString() });
    throw error;
  }
  const limitPerAccount = Math.max(10, Math.min(Number(payload.limitPerAccount) || 10, 20));
  const fetchedAt = new Date().toISOString();
  const accountResults = [];
  const tweets = [];
  const warnings = invalid.map(item => `${item.input}: ${item.error}`);
  for (const account of accounts) {
    try {
      const result = await fetchXRecentForAccount({
        username: account.username,
        limitPerAccount,
        excludeReplies: payload.excludeReplies !== false,
        mediaOnly: Boolean(payload.mediaOnly),
        bearerToken
      });
      accountResults.push({ username: account.username, ok: true, tweetCount: result.tweetCount, warnings: result.warnings, rateLimit: result.rateLimit });
      tweets.push(...result.tweets);
      warnings.push(...result.warnings.map(w => `${account.username}: ${w}`));
    } catch (error) {
      const warning = `${account.username}: ${error.message}`;
      accountResults.push({ username: account.username, ok: false, tweetCount: 0, warnings: [warning], rateLimit: error.rateLimit || null });
      warnings.push(warning);
    }
  }
  if (!tweets.length && accountResults.every(item => !item.ok)) {
    const error = new Error('All X account fetches failed.');
    error.statusCode = accountResults.some(item => item.rateLimit?.reset) ? 429 : 502;
    error.accounts = accountResults;
    error.warnings = warnings;
    recordLiveFailure({ accounts: accountResults, error, fetchedAt, rateLimit: accountResults.find(item => item.rateLimit?.reset)?.rateLimit });
    throw error;
  }
  tweets.sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  const lastRateLimit = accountResults.map(item => item.rateLimit).filter(Boolean).slice(-1)[0] || null;
  recordLiveSuccess({ accounts: accountResults, tweets, fetchedAt, rateLimit: lastRateLimit });
  return {
    provider: X_PROVIDER,
    readOnly: true,
    fetchedAt,
    accounts: accountResults,
    invalid,
    tweets,
    warnings
  };
}

// Discover: topic-keyword search across recent X posts.
// Read-only. Credentials stay server-side. Response never contains bearer tokens.
function buildDiscoverQuery(topics) {
  const cleaned = topics
    .map(t => String(t || '').trim())
    .filter(Boolean)
    .map(t => t.replace(/"/g, '').slice(0, 60))
    .filter(Boolean);
  if (!cleaned.length) return null;
  return `(${cleaned.map(t => `"${t}"`).join(' OR ')}) -is:retweet`;
}

async function discoverSearch(payload) {
  const topics = asStringArray(payload.topics || payload.topic || payload.query);
  if (!topics.length) {
    const error = new Error('Provide at least one topic (string or array of strings).');
    error.statusCode = 400;
    throw error;
  }
  if (topics.length > 8) {
    const error = new Error('Up to 8 topics per Discover search.');
    error.statusCode = 400;
    throw error;
  }
  const bearerToken = getXBearerToken();
  if (!bearerToken) {
    const error = new Error('X_BEARER_TOKEN is not configured, so Discover topic search is unavailable.');
    error.statusCode = 503;
    recordLiveFailure({ accounts: [], error, fetchedAt: new Date().toISOString() });
    throw error;
  }
  const query = buildDiscoverQuery(topics);
  if (!query) {
    const error = new Error('Topics contained only empty/whitespace values.');
    error.statusCode = 400;
    throw error;
  }
  const maxResults = Math.max(10, Math.min(Number(payload.maxResults) || 20, 50));
  const excludeReplies = payload.excludeReplies !== false;
  const mediaOnly = Boolean(payload.mediaOnly);
  const queryParts = [query];
  if (excludeReplies) queryParts.push('-is:reply');
  if (mediaOnly) queryParts.push('has:media');
  // Language filter (e.g. 'en') applied server-side by X.
  const lang = String(payload.lang || '').trim().toLowerCase();
  if (/^[a-z]{2}$/.test(lang)) queryParts.push(`lang:${lang}`);
  // Negative keyword filters (e.g. crypto exclusions).
  const excludeTerms = asStringArray(payload.excludeTerms).slice(0, 20);
  for (const term of excludeTerms) {
    const t = term.trim().replace(/"/g, '');
    if (t) queryParts.push(t.includes(' ') ? `-"${t}"` : `-${t}`);
  }
  const params = new URLSearchParams({
    query: queryParts.join(' '),
    max_results: String(maxResults),
    'tweet.fields': 'created_at,author_id,public_metrics,attachments,entities,conversation_id,referenced_tweets,note_tweet',
    expansions: 'author_id,attachments.media_keys',
    'user.fields': 'username,name,profile_image_url,verified,public_metrics',
    'media.fields': 'type,url,preview_image_url,width,height,alt_text'
  });
  const fetchedAt = new Date().toISOString();
  let response;
  try {
    response = await fetch(`https://api.x.com/2/tweets/search/recent?${params.toString()}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${bearerToken}` },
      signal: AbortSignal.timeout(15000)
    });
  } catch (error) {
    const wrapped = new Error(`X API request failed: ${error.message || error}`);
    wrapped.statusCode = 502;
    recordLiveFailure({ accounts: [], error: wrapped, fetchedAt });
    throw wrapped;
  }
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { text }; }
  const rateLimit = xRateLimitFromHeaders(response.headers);
  if (!response.ok) {
    const message = data?.detail || data?.title || data?.errors?.[0]?.message || `X API returned HTTP ${response.status}`;
    const error = new Error(message);
    error.statusCode = response.status === 429 ? 429 : 502;
    error.rateLimit = rateLimit;
    error.details = data;
    recordLiveFailure({ accounts: [], error, fetchedAt, rateLimit });
    throw error;
  }
  const includes = {
    users: new Map((data.includes?.users || []).map(user => [user.id, user])),
    media: new Map((data.includes?.media || []).map(media => [media.media_key, media]))
  };
  const tweets = (data.data || []).map(tweet => normalizeXTweet(tweet, includes, null, fetchedAt));
  tweets.sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  const warnings = tweets.length
    ? []
    : ['No recent matching tweets returned for those topics. Try different keywords or remove the time filter.'];
  recordLiveSuccess({ accounts: [{ username: 'discover:topic', ok: true, tweetCount: tweets.length, warnings, rateLimit }], tweets, fetchedAt, rateLimit });
  return {
    ok: true,
    provider: X_PROVIDER,
    readOnly: true,
    fetchedAt,
    query,
    topics,
    maxResults,
    excludeReplies,
    mediaOnly,
    rateLimit,
    results: tweets,
    warnings
  };
}

// "Get Inspiration": read Lucas's signal (about-me, topics, recent tweets,
// Obsidian vault), let Goro derive search topics from it, then search X recent
// for 10-15 relevant tweets to add to the Inspiration feed.
async function discoverInspire(payload) {
  const aboutMe = String(payload.aboutMe || '').trim();
  const seedTopics = asStringArray(payload.topics).slice(0, 8);
  const maxResults = Math.max(10, Math.min(Number(payload.maxResults) || 15, 15));

  // 1) recent tweets from the operator's own account
  let myTweets = [];
  try {
    const s = await getCachedXHistoryStatus({});
    myTweets = (s?.lastFetch?.tweets || []).slice(0, 12);
  } catch { /* best-effort */ }
  const myTweetText = myTweets.map((t) => `- ${compactForPrompt(t.text || '', 180)}`).join('\n');

  // 2) Obsidian vault notes
  let vaultNotes = [];
  try {
    const vq = [aboutMe, ...seedTopics].filter(Boolean).join(' ').slice(0, 240)
      || 'AI operators leverage systems agency';
    const v = await searchObsidianVault({ query: vq, maxNotes: 6 });
    vaultNotes = v?.notes || [];
  } catch { /* best-effort */ }
  const vaultText = vaultNotes
    .map((n) => `- ${n.title || n.path || 'note'}: ${compactForPrompt(n.excerpt || n.body || n.content || '', 160)}`)
    .join('\n');

  // 3) derive search topics from the signal via Goro
  let topics = [];
  let topicSource = 'goro';
  const prompt = [
    'You are Goro helping Lucas find fresh X/Twitter inspiration to read.',
    'From the signal below — his about-me, the topics he posts on, his recent tweets, and notes from his Obsidian vault — output 7-8 search keywords that surface RECENT tweets relevant to what Lucas cares about.',
    'CRITICAL: each keyword is searched as an EXACT phrase on X, so SHORTER = MORE RESULTS. Use mostly 1-2 word keywords (3 words max, rarely) that appear verbatim in lots of real tweets — e.g. "AI agents", "second brain", "AI agency", "automation", "agentic", "solopreneur", "build in public". Do NOT output long descriptive phrases like "AI agentic systems founder" — those match almost nothing.',
    'No hashtags, no quotes, no @handles, no boolean operators.',
    'Return JSON only with this exact shape: {"topics":["...","..."]}',
    `About me: ${compactForPrompt(aboutMe || '(none provided)', 900)}`,
    `Topics he posts on: ${seedTopics.join(', ') || '(none)'}`,
    `His recent tweets:\n${myTweetText || '(none available)'}`,
    `Notes from his vault:\n${vaultText || '(none available)'}`,
  ].join('\n');
  if (process.env.GORO_GENERATE_MODE !== 'mock' && !process.env.GORO_GENERATE_URL) {
    try {
      const hr = callGoroHermes({ context: aboutMe || seedTopics.join(', ') }, prompt);
      if (!hr.degraded && Array.isArray(hr.parsed?.topics)) {
        topics = hr.parsed.topics.map((t) => String(t || '').trim()).filter(Boolean);
      }
    } catch { /* fall back below */ }
  }
  // Fallback: settings topics, else keywords pulled from about-me.
  if (!topics.length) {
    topicSource = seedTopics.length ? 'settings' : 'about-me';
    topics = seedTopics.length
      ? seedTopics
      : (aboutMe
          ? aboutMe.split(/[.,\n;]+/).map((s) => s.trim()).filter((w) => w.length > 4).slice(0, 6)
          : ['AI agents', 'AI operators', 'automation', 'solo founders', 'leverage']);
  }
  topics = [...new Set(topics)].slice(0, 8);

  // 4) search X recent — English only, no replies, crypto excluded.
  // Query negatives (X caps query length, so the highest-signal ~18 terms).
  const CRYPTO_TERMS = [
    'crypto', 'bitcoin', 'ethereum', 'web3', 'NFT', 'altcoin', 'memecoin',
    'blockchain', 'solana', 'defi', 'airdrop', 'onchain', 'presale',
    'tokenomics', 'staking', 'DAO', 'crypto twitter', 'pump.fun',
  ];
  const search = await discoverSearch({
    topics,
    maxResults: Math.min(maxResults * 2, 40), // over-fetch so post-filtering still leaves enough
    excludeReplies: true,
    lang: 'en',
    excludeTerms: CRYPTO_TERMS,
  });
  // Comprehensive backstop. Deliberately AI-SAFE: no "token" (LLM tokens),
  // "node" (Node.js), "gas", or "base" — those are ambiguous with Lucas's domain.
  const CRYPTO_RE = new RegExp(
    '\\b(' +
      'crypto|cryptocurrency|bitcoin|btc|ethereum|web ?3|nfts?|altcoins?|memecoins?|shitcoins?|' +
      'blockchain|on-?chain|solana|\\$?sol\\b|defi|dao|daos|airdrops?|whitelist|presale|ico|ido|' +
      'tokenomics|staking|stablecoins?|metamask|coinbase|binance|kraken|ledger wallet|hardware wallet|' +
      'hodl|degen|wagmi|gmgn|to the moon|diamond hands|liquidity pool|yield farm(?:ing)?|' +
      'dex|cex|validator node|smart contract|satoshi|halving|rug ?pull|moonshot coin|' +
      'pump\\.fun|real world assets|\\brwa\\b' +
    ')\\b' +
    '|\\$[A-Z]{2,6}\\b', // cashtags ($BTC, $SOL, $PEPE …) — strong crypto signal
    'i',
  );
  const preFiltered = (search.results || []).filter((t) => !CRYPTO_RE.test(t.text || ''));

  // Smart relevance + safety screen via Goro. Keyword filters can't catch
  // crypto-adjacent spam ("earn passively with AI agents @SomeCoin"), so let the
  // model judge each candidate. Falls back to the keyword-filtered list.
  let results = preFiltered.slice(0, maxResults);
  let screened = false;
  if (preFiltered.length > 1 && process.env.GORO_GENERATE_MODE !== 'mock' && !process.env.GORO_GENERATE_URL) {
    const list = preFiltered.slice(0, 30);
    const filterPrompt = [
      'You are screening candidate tweets for Lucas\'s inspiration feed.',
      'Lucas writes about AI agents, automation, operator leverage, building useful AI systems, agencies, and being a solo builder/founder.',
      'Return JSON only with this exact shape: {"keep":[<indices to KEEP, integers>]}.',
      'KEEP a tweet ONLY if ALL are true: genuinely relevant to Lucas\'s topics; written in English; a real, substantive post worth reading.',
      'REMOVE a tweet if ANY are true: about crypto / web3 / NFTs / coins / tokens-as-investments / trading; OR spam, engagement-bait, MLM, "earn passively", "passive income", get-rich, "DM me", giveaways, follower-farming, or promoting a sketchy product/agent-coin; OR not English; OR low-effort promotional junk.',
      'Be STRICT. When in doubt, REMOVE.',
      'Candidates (index: text):',
      list.map((t, i) => `${i}: ${compactForPrompt(t.text || '', 220)}`).join('\n'),
    ].join('\n');
    try {
      const hr = callGoroHermes({ context: 'screen' }, filterPrompt);
      if (!hr.degraded && Array.isArray(hr.parsed?.keep)) {
        const keep = hr.parsed.keep
          .map(Number)
          .filter((n) => Number.isInteger(n) && n >= 0 && n < list.length);
        if (keep.length) {
          results = [...new Set(keep)].map((i) => list[i]).slice(0, maxResults);
          screened = true;
        }
      }
    } catch { /* keep keyword-filtered fallback */ }
  }

  return {
    ok: true,
    topics,
    topicSource,
    screened,
    signal: { myTweetCount: myTweets.length, vaultNoteCount: vaultNotes.length, hasAboutMe: Boolean(aboutMe) },
    results,
    warnings: search.warnings || [],
  };
}

// Discover: resolve a pasted X post link into a tweet card for reply/inspiration context.
// Server-side, read-only. Returns 503 when X_BEARER_TOKEN is missing.
// First tries fxtwitter (works without bearer) for a quick text payload; when a bearer is
// available it backfills full author/metrics/URL via X API recent lookup by status id.
async function discoverFetch(payload) {
  const rawUrl = String(payload.url || '').trim();
  if (!rawUrl) {
    const error = new Error('Provide a url field with an X/Twitter post link.');
    error.statusCode = 400;
    throw error;
  }
  const normalized = normalizeTweetUrl(rawUrl);
  if (!normalized) {
    const error = new Error('Could not parse a status id from that URL. Expected https://x.com/<user>/status/<id>.');
    error.statusCode = 400;
    throw error;
  }
  const fetchedAt = new Date().toISOString();
  const resolved = await resolveTweetUrl(rawUrl);
  const warnings = [];
  if (resolved.warning) warnings.push(resolved.warning);
  let tweet = null;
  const bearerToken = getXBearerToken();
  if (bearerToken && normalized.statusId) {
    const lookupParams = new URLSearchParams({
      ids: normalized.statusId,
      'tweet.fields': 'created_at,author_id,public_metrics,attachments,entities,conversation_id,referenced_tweets,note_tweet',
      expansions: 'author_id,attachments.media_keys',
      'user.fields': 'username,name,profile_image_url,verified,public_metrics',
      'media.fields': 'type,url,preview_image_url,width,height,alt_text'
    });
    try {
      const response = await fetch(`https://api.x.com/2/tweets?${lookupParams.toString()}`, {
        method: 'GET',
        headers: { authorization: `Bearer ${bearerToken}` },
        signal: AbortSignal.timeout(12000)
      });
      const text = await response.text();
      let data;
      try { data = text ? JSON.parse(text) : {}; } catch { data = { text }; }
      const rateLimit = xRateLimitFromHeaders(response.headers);
      if (response.ok && Array.isArray(data.data) && data.data.length) {
        const includes = {
          users: new Map((data.includes?.users || []).map(user => [user.id, user])),
          media: new Map((data.includes?.media || []).map(media => [media.media_key, media]))
        };
        tweet = normalizeXTweet(data.data[0], includes, normalized.author, fetchedAt);
        recordLiveSuccess({ accounts: [{ username: normalized.author || 'discover:fetch', ok: true, tweetCount: 1, warnings, rateLimit }], tweets: [tweet], fetchedAt, rateLimit });
      } else if (response.status === 429) {
        const error = new Error('X API rate limit hit on Discover fetch.');
        error.statusCode = 429;
        error.rateLimit = rateLimit;
        recordLiveFailure({ accounts: [], error, fetchedAt, rateLimit });
        throw error;
      } else if (!response.ok) {
        warnings.push(`X API lookup returned HTTP ${response.status}; using fxtwitter fallback.`);
        recordLiveSuccess({ accounts: [{ username: normalized.author || 'discover:fetch', ok: true, tweetCount: 0, warnings, rateLimit }], tweets: [], fetchedAt, rateLimit });
      } else {
        warnings.push('X API returned no matching tweet id; using fxtwitter fallback.');
      }
    } catch (error) {
      warnings.push(`X API lookup failed: ${error.message || error}; using fxtwitter fallback.`);
    }
  } else if (!bearerToken) {
    warnings.push('X_BEARER_TOKEN is not configured; fxtwitter fallback only.');
  }
  if (!tweet) {
    tweet = {
      id: normalized.statusId,
      url: normalized.url,
      text: resolved.text || null,
      createdAt: null,
      author: normalized.author ? { id: null, username: normalized.author, name: normalized.author, profileImageUrl: null, verified: null, publicMetrics: null } : { id: null, username: null, name: null, profileImageUrl: null, verified: null, publicMetrics: null },
      metrics: null,
      media: [],
      source: resolved.source === 'fxtwitter' || resolved.source === 'html' ? resolved.source : 'unresolved',
      fetchedAt,
      warnings: resolved.warning ? [resolved.warning] : []
    };
    if (!tweet.text) {
      const error = new Error('Could not resolve tweet text from that URL. The link may be private, deleted, or unsupported.');
      error.statusCode = 502;
      throw error;
    }
  }
  return {
    ok: true,
    provider: tweet.source === 'fxtwitter' || tweet.source === 'html' ? tweet.source : X_PROVIDER,
    readOnly: true,
    fetchedAt,
    url: rawUrl,
    resolvedUrl: normalized.url,
    statusId: normalized.statusId,
    author: normalized.author,
    result: tweet,
    warnings
  };
}

const SUPPORTED_TWEET_HOSTS = new Set([
  'x.com',
  'www.x.com',
  'mobile.x.com',
  'twitter.com',
  'www.twitter.com',
  'mobile.twitter.com',
  'fxtwitter.com',
  'www.fxtwitter.com',
  'fixupx.com',
  'www.fixupx.com'
]);

function normalizeTweetUrl(rawUrl) {
  const input = String(rawUrl || '').trim();
  if (!input) return null;

  if (/^\d{5,}$/.test(input)) {
    return {
      url: `https://fxtwitter.com/i/status/${input}`,
      statusId: input,
      author: null
    };
  }

  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (!SUPPORTED_TWEET_HOSTS.has(host)) return null;

  const parts = parsed.pathname.split('/').filter(Boolean);
  const statusIndex = parts.findIndex(part => part.toLowerCase() === 'status');
  const statusId = statusIndex >= 0 ? parts[statusIndex + 1]?.match(/^\d+/)?.[0] : null;
  if (!statusId) return null;

  const author = statusIndex > 0 && !['i'].includes(parts[statusIndex - 1]?.toLowerCase())
    ? parts[statusIndex - 1]
    : null;
  const authorPath = author ? `/${author}` : '/i';

  return {
    url: `https://fxtwitter.com${authorPath}/status/${statusId}`,
    statusId,
    author
  };
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

async function resolveTweetUrl(rawUrl) {
  const normalized = normalizeTweetUrl(rawUrl);
  const result = {
    url: normalized?.url || String(rawUrl || '').trim(),
    statusId: normalized?.statusId || null,
    author: normalized?.author || null,
    text: null,
    createdAt: null,
    source: 'unresolved',
    warning: null
  };

  if (!normalized) {
    result.warning = 'could not parse tweet status id from supported tweet URL';
    return result;
  }

  try {
    const response = await fetch(normalized.url, {
      method: 'GET',
      headers: { 'accept': 'text/plain, application/json, text/html' },
      signal: AbortSignal.timeout(8000)
    });
    if (response.ok) {
      const text = await response.text();
      const trimmed = text.trim();
      if (trimmed && !/^<!doctype/i.test(trimmed) && !/^<html/i.test(trimmed)) {
        result.text = trimmed.slice(0, 600);
        result.source = 'fxtwitter';
        return result;
      }

      const htmlMatch = trimmed.match(/<meta[^>]+(?:name|property)=["'](?:og:description|twitter:description|twitter:text)["'][^>]*content=["']([^"']+)["']/i)
        || trimmed.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:og:description|twitter:description|twitter:text)["']/i);
      if (htmlMatch) {
        result.text = decodeHtmlEntities(htmlMatch[1]).slice(0, 600);
        result.source = 'html';
        return result;
      }
      result.warning = 'fxtwitter returned no parseable text';
    } else {
      result.warning = `fxtwitter returned HTTP ${response.status}`;
    }
  } catch (error) {
    result.warning = `fxtwitter fetch failed: ${error.message || error}`;
  }

  return result;
}

async function resolveInspirationLinks(links) {
  if (!links.length) return { resolvedTweets: [], resolutionWarnings: [] };
  const settled = await Promise.allSettled(links.map(link => resolveTweetUrl(link)));
  const resolvedTweets = settled.map((entry, index) => {
    if (entry.status === 'fulfilled') return entry.value;
    return {
      url: links[index],
      statusId: null,
      author: null,
      text: null,
      createdAt: null,
      source: 'unresolved',
      warning: entry.reason?.message || 'resolver crashed'
    };
  });
  const resolutionWarnings = resolvedTweets
    .filter(item => item.warning)
    .map(item => `${item.url}: ${item.warning}`);
  return { resolvedTweets, resolutionWarnings };
}

async function callGoroHttp(payload, prompt) {
  const url = process.env.GORO_GENERATE_URL;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...payload, prompt })
  });
  const text = await response.text();
  let parsed = extractJsonObject(text);
  if (!parsed) parsed = { text };
  if (!response.ok) {
    const error = new Error(parsed?.error || parsed?.message || `Goro endpoint returned HTTP ${response.status}`);
    error.statusCode = 502;
    error.details = parsed;
    throw error;
  }
  return parsed;
}

function callGoroHermes(payload, prompt) {
  const profile = process.env.GORO_HERMES_PROFILE || 'goro';
  const hermes = process.env.HERMES_BIN || 'hermes';
  const timeoutMs = Number(process.env.GORO_HERMES_TIMEOUT_MS || 12000);
  const result = spawnSync(hermes, ['--profile', profile, 'chat', '-Q', '-q', prompt], {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024
  });
  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      const warning = `Hermes Goro timed out after ${timeoutMs}ms; returned local safe fallback instead of failing.`;
      let fallbackCandidates;
      if (payload?.mention) {
        fallbackCandidates = mockMentionReplies(payload);
      } else if (payload?.sourceTweet) {
        fallbackCandidates = mockCandidates({
          inspirationLinks: payload.sourceTweet.url ? [payload.sourceTweet.url] : [],
          resolvedTweets: [payload.sourceTweet],
          context: `Rewrite: ${payload.sourceTweet.text || payload.context || ''}`,
          tone: payload.tone,
          count: payload.count
        });
      } else {
        fallbackCandidates = mockCandidates(payload);
      }
      return {
        parsed: {
          candidates: fallbackCandidates.map(candidate => ({
            ...candidate,
            warnings: [...(candidate.warnings || []), warning]
          }))
        },
        normalized: false,
        degraded: true,
        adapterWarning: warning
      };
    }
    const error = new Error(`Hermes Goro adapter failed: ${result.error.message}`);
    error.statusCode = 502;
    throw error;
  }
  if (result.status !== 0) {
    const error = new Error(`Hermes Goro adapter exited ${result.status}`);
    error.statusCode = 502;
    error.details = { stderr: result.stderr?.slice(0, 1200) };
    throw error;
  }
  const stdout = String(result.stdout || '').trim();
  const parsed = extractJsonObject(stdout);
  if (parsed) return { parsed, normalized: false };
  return {
    parsed: { candidates: [{ text: stdout, angle: 'Goro CLI response', warnings: ['non-json Goro response normalized by server'] }] },
    normalized: true
  };
}

async function generateTweets(payload) {
  const inspirationLinks = asStringArray(payload.inspirationLinks || payload.links);
  const context = String(payload.context || '').trim();
  const tone = String(payload.tone || '').trim();
  const count = Math.max(1, Math.min(Number(payload.count || 2), 3));
  const postType = String(payload.postType || 'short').toLowerCase();
  const selectedSources = Array.isArray(payload.selectedSources) ? payload.selectedSources : [];
  const contextSourceRefs = asStringArray(payload.contextSourceRefs);
  const contextWarnings = asStringArray(payload.contextWarnings);
  const templateId = String(payload.templateId || '').trim();
  let template = null;
  if (templateId) {
    template = await getItem('templates', templateId);
  }

  if (!context && inspirationLinks.length === 0 && selectedSources.length === 0) {
    const error = new Error('Add at least one inspiration link, context note, or select source cards before generating.');
    error.statusCode = 400;
    throw error;
  }

  const { resolvedTweets, resolutionWarnings } = await resolveInspirationLinks(inspirationLinks);
  const sourcePacket = {
    inspirationLinks,
    resolvedTweets,
    context,
    tone,
    count,
    postType,
    selectedSources,
    templateId,
    template,
    contextSourceRefs,
    contextWarnings
  };

  const prompt = buildGoroPrompt(sourcePacket);
  const forcedMock = process.env.GORO_GENERATE_MODE === 'mock';
  let adapter = pickGoroMode();
  let raw;
  let responseWarnings = [];

  if (forcedMock) {
    adapter = 'mock';
    raw = { candidates: mockCandidates(sourcePacket) };
  } else if (process.env.GORO_GENERATE_URL) {
    adapter = 'http';
    raw = await callGoroHttp(sourcePacket, prompt);
  } else {
    adapter = 'hermes';
    const hermesResult = callGoroHermes(sourcePacket, prompt);
    raw = hermesResult.parsed;
    if (hermesResult.normalized) responseWarnings.push('non-json Goro response normalized by server');
    responseWarnings.push(...warnFromHermesResult(hermesResult));
  }

  if (resolutionWarnings.length) responseWarnings.push(...resolutionWarnings);

  const candidates = normalizeCandidates(raw, adapter, responseWarnings).map((c) => ({
    ...c,
    kind: c.kind || postType || 'short',
    segments: c.segments || null,
  }));
  if (!candidates.length) {
    const error = new Error('Goro returned no usable tweet candidates.');
    error.statusCode = 502;
    error.details = raw;
    throw error;
  }

  return {
    adapter,
    mockModeForced: forcedMock,
    goroProfile: process.env.GORO_HERMES_PROFILE || 'goro',
    sourcePacket,
    candidates,
    warnings: responseWarnings,
    promptPreview: prompt.slice(0, 1200)
  };
}

async function generateAndPersist(payload) {
  let result;
  try {
    result = await generateTweets(payload);
  } catch (error) {
    const forcedMock = process.env.GORO_GENERATE_MODE === 'mock';
    const adapter = forcedMock ? 'mock' : (process.env.GORO_GENERATE_URL ? 'http' : 'hermes');
    recordGoroFailure({ adapter, error });
    recordGenerationAttempt({
      ok: false,
      adapter,
      blockerCode: error?.code || 'generate_failed',
      sourceRefCount: Array.isArray(payload?.contextSourceRefs) ? payload.contextSourceRefs.length : 0
    });
    throw error;
  }
  const drafts = await persistGeneratedDrafts(result);
  recordGoroSuccess({
    adapter: result.adapter,
    candidates: result.candidates,
    drafts,
    mockModeForced: result.mockModeForced,
    warnings: result.warnings
  });
  recordGenerationAttempt({
    ok: true,
    adapter: result.adapter,
    candidateCount: result.candidates?.length || 0,
    draftCount: drafts?.length || 0,
    sourceRefCount: Array.isArray(result.sourcePacket?.contextSourceRefs) ? result.sourcePacket.contextSourceRefs.length : 0,
    warnings: result.warnings
  });
  return { ...result, drafts };
}

function buildPostizPayload(payload) {
  // A thread = an array of tweets. Otherwise a single post (short/long/article).
  const thread = Array.isArray(payload.thread)
    ? payload.thread.map((t) => String(t || '').trim()).filter(Boolean)
    : null;
  const kind = String(payload.kind || (thread ? 'thread' : 'short')).toLowerCase();
  const content = thread && thread.length ? thread[0] : String(payload.content || payload.text || '').trim();
  const scheduledAt = String(payload.scheduledAt || '').trim();
  const integrationId = String(payload.integrationId || process.env.POSTIZ_X_INTEGRATION_ID || '').trim();
  const timezone = String(payload.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC').trim();

  if (!content) {
    const error = new Error('Post content is required before scheduling.');
    error.statusCode = 400;
    throw error;
  }
  // X long posts are supported, so length no longer hard-blocks here; only guard
  // against absurd input (X premium long-post ceiling is ~25k chars).
  if (content.length > 25000) {
    const error = new Error('Post content is too long (25,000 character max).');
    error.statusCode = 400;
    throw error;
  }
  if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) {
    const error = new Error('Choose a valid schedule date/time.');
    error.statusCode = 400;
    throw error;
  }
  if (new Date(scheduledAt).getTime() <= Date.now() - 30000) {
    const error = new Error('Schedule time must be in the future.');
    error.statusCode = 400;
    throw error;
  }
  if (!integrationId) {
    const error = new Error('POSTIZ_X_INTEGRATION_ID or integrationId is required.');
    error.statusCode = 400;
    throw error;
  }

  const opts = (payload.settings && typeof payload.settings === 'object') ? payload.settings : {};
  // Media uploaded to Postiz (via /upload-media) arrives as { id, path } refs.
  const image = Array.isArray(payload.media)
    ? payload.media
        .filter((m) => m && (m.path || m.id))
        .map((m) => ({ id: m.id, path: m.path || m.url }))
    : [];
  // Postiz models a thread as multiple entries in one post's `value` array.
  // Media rides on the first tweet only.
  const value = (thread && thread.length)
    ? thread.map((t, i) => ({ content: t, image: i === 0 ? image : [] }))
    : [{ content, image }];
  return {
    type: 'schedule',
    date: new Date(scheduledAt).toISOString(),
    timezone,
    shortLink: false,
    tags: [],
    posts: [
      {
        integration: { id: integrationId },
        value,
        // Postiz public-API per-post settings schema. Auto-actions from the
        // compose drawer are carried through as extra keys (Postiz ignores
        // unknown ones); super-followers maps to the reply-gate.
        settings: {
          who_can_reply_post: opts.superFollowersOnly ? 'subscribers' : 'everyone',
          autoRetweet: Boolean(opts.autoRetweet),
          autoPlug: Boolean(opts.autoPlug),
          autoDm: Boolean(opts.autoDm),
          autoDelete: Boolean(opts.autoDelete)
        }
      }
    ]
  };
}

async function schedulePost(payload) {
  let result;
  try {
    result = await schedulePostInner(payload);
    recordScheduleAttempt({
      ok: true,
      mode: 'postiz',
      draftId: payload.draftId,
      scheduledAt: payload.scheduledAt,
      conflicts: result?.conflicts
    });
    return result;
  } catch (error) {
    let mode = 'postiz';
    if (error?.statusCode === 503 && /POSTIZ_API_KEY is not configured/i.test(error.message || '')) mode = 'safe-blocked';
    else if (error?.statusCode === 409) mode = 'duplicate';
    else if (error?.statusCode === 429) mode = 'rate-limited';
    else if (error?.statusCode === 400 && /Review gate blocked/i.test(error.message || '')) mode = 'gate-blocked';
    recordScheduleAttempt({
      ok: false,
      mode,
      error,
      draftId: payload?.draftId,
      scheduledAt: payload?.scheduledAt,
      statusCode: error?.statusCode,
      conflicts: error?.conflicts,
      safeBlocked: mode === 'safe-blocked'
    });
    throw error;
  }
}

async function schedulePostInner(payload) {
  let draft = null;
  if (payload.draftId) {
    draft = await getItem('drafts', String(payload.draftId));
    if (!draft) {
      const error = new Error(`drafts/${payload.draftId} not found`);
      error.statusCode = 404;
      throw error;
    }
    if (draft.status !== 'approved') {
      const error = new Error('Only approved drafts can be scheduled by draftId.');
      error.statusCode = 400;
      throw error;
    }
    payload = { ...payload, content: draft.text };
  }

  // Review gate: compute gate on the content being scheduled.
  const content = String(payload.content || payload.text || '').trim();
  const gateInput = {
    text: content,
    sourceRefs: draft?.sourceRefs || [],
    id: draft?.id || null
  };
  const allDrafts = draft ? await listCollection('drafts') : [];
  const gate = reviewDraft(gateInput, { allDrafts });

  // Hard block: gate is 'blocked' and the draft is NOT explicitly approved.
  // If the draft status is 'approved', the operator has signed off — let it through
  // but still surface the gate warnings.
  // Exception: length alone no longer blocks — X long posts / threads are valid,
  // so if the ONLY failing check is char-length, allow it (still surface warnings).
  if (gate.status === 'blocked') {
    const explicitlyApproved = draft && draft.status === 'approved';
    const failures = (gate.checks || []).filter((c) => c.level === 'fail');
    const onlyLengthFail = failures.length > 0 && failures.every((c) => c.name === 'char-length');
    if (!explicitlyApproved && !onlyLengthFail) {
      const error = new Error(
        `Review gate blocked this draft: ${gate.warnings.join('; ')}. Approve the draft explicitly to override.`
      );
      error.statusCode = 400;
      error.gate = gate;
      throw error;
    }
  }

  const postizPayload = buildPostizPayload(payload);

  // Conflict pre-check against the existing schedule queue. Non-blocking — we
  // surface it in the response so the UI can warn the operator. Conflict means
  // another scheduled draft is within ±CONFLICT_WINDOW_MIN of the requested time.
  const scheduledAtIso = postizPayload.date;
  const otherScheduled = allDrafts
    .filter(d => d && d.scheduledAt && d.id !== draft?.id)
    .map(d => ({ id: d.id, scheduledAt: d.scheduledAt, text: d.text, angle: d.angle, status: d.status }));
  const conflicts = findConflicts(scheduledAtIso, otherScheduled);

  // Hard duplicate guard: exact same ISO timestamp on another draft.
  // Prevents accidental double-click and idempotent replays. Runs BEFORE the
  // API-key safe-block so we surface "you already scheduled this" regardless
  // of whether Postiz is configured.
  // Compare by parsed epoch so a stripped `…:00Z` matches `…:00.000Z`.
  const candidateTs = Date.parse(scheduledAtIso);
  const exactDuplicates = otherScheduled.filter(d => {
    const t = Date.parse(d.scheduledAt);
    return Number.isFinite(t) && t === candidateTs;
  });
  if (exactDuplicates.length) {
    const error = new Error(
      `Another draft is already scheduled at exactly ${scheduledAtIso} (${exactDuplicates.map(d => d.id).join(', ')}). Pick a different time.`
    );
    error.statusCode = 409;
    error.conflicts = conflicts;
    throw error;
  }

  const apiKey = process.env.POSTIZ_API_KEY;
  const apiUrl = (process.env.POSTIZ_API_URL || DEFAULT_POSTIZ_API_URL).replace(/\/$/, '');

  if (!apiKey) {
    const error = new Error('POSTIZ_API_KEY is not configured, so Tweet Lab blocked the real Postiz write.');
    error.statusCode = 503;
    error.payloadPreview = postizPayload;
    error.gate = gate;
    error.conflicts = conflicts;
    error.conflictWindowMinutes = SCHEDULE_INTERNALS.CONFLICT_WINDOW_MIN;
    throw error;
  }

  // Note: exactDuplicates already checked above. Kept the inline comment for
  // continuity with prior reading; the actual guard is at the top of this block.

  const response = await fetch(`${apiUrl}/public/v1/posts`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Postiz public API expects the raw API key (no "Bearer " prefix).
      authorization: apiKey.replace(/^Bearer\s+/i, '')
    },
    body: JSON.stringify(postizPayload)
  });
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { text }; }
  if (!response.ok) {
    const error = new Error(parsed?.message || parsed?.error || `Postiz returned HTTP ${response.status}`);
    error.statusCode = 502;
    error.details = parsed;
    throw error;
  }
  if (draft) {
    await updateItem('drafts', draft.id, {
      status: 'scheduled',
      scheduledAt: payload.scheduledAt,
      postizReceipt: parsed
    });
  }
  return {
    ok: true,
    postiz: parsed,
    payload: postizPayload,
    gate,
    conflicts,
    conflictWindowMinutes: SCHEDULE_INTERNALS.CONFLICT_WINDOW_MIN,
    conflictWarning: conflicts.length
      ? `Scheduled within ${SCHEDULE_INTERNALS.CONFLICT_WINDOW_MIN}min of ${conflicts.length} other draft(s).`
      : null
  };
}

function configResponse() {
  const mentionsStatus = mentionsConfigStatus();
  return {
    appVersion: APP_VERSION,
    postizConfigured: Boolean(process.env.POSTIZ_API_KEY),
    hasDefaultIntegration: Boolean(process.env.POSTIZ_X_INTEGRATION_ID),
    postizApiUrl: process.env.POSTIZ_API_URL || DEFAULT_POSTIZ_API_URL,
    goroMode: pickGoroMode(),
    mockModeForced: process.env.GORO_GENERATE_MODE === 'mock',
    goroProfile: process.env.GORO_HERMES_PROFILE || 'goro',
    hasGoroEndpoint: Boolean(process.env.GORO_GENERATE_URL),
    xConfigured: Boolean(getXBearerToken()),
    xProvider: X_PROVIDER,
    xReadOnly: true,
    mentionsConfigured: mentionsStatus.configured,
    mentionsProvider: MENTIONS_PROVIDER,
    mentionsReadOnly: true,
    mentionsRequiresUserContext: true,
    // X history backfill capability. Read-only, server-side, no token
    // leaks. lucasHandle is exposed so the UI can label whose history
    // it's about to read. xHistoryReadOnly is fixed true by design.
    xHistory: {
      provider: X_HISTORY_PROVIDER,
      endpoint: X_HISTORY_INFO.endpoint,
      configured: Boolean(getXBearerToken()),
      readOnly: true,
      lucasHandle: resolveLucasHandle()
    }
  };
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const route = url.pathname === '/' ? '/index.html' : url.pathname;
  let decoded;
  try {
    decoded = decodeURIComponent(route);
  } catch {
    sendText(res, 400, 'Bad request');
    return;
  }
  if (!PUBLIC_ASSETS.has(decoded)) {
    sendText(res, 404, 'Not found');
    return;
  }
  const filePath = path.join(__dirname, decoded.slice(1));
  if (!existsSync(filePath)) {
    sendText(res, 404, 'Not found');
    return;
  }
  const ext = path.extname(filePath);
  const body = await readFile(filePath);
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer'
  });
  res.end(body);
}

const STORE_COLLECTION_PATTERN = /^\/api\/tweet-lab\/store\/([a-zA-Z]+)(\/([^\/]+))?\/?$/;

function collectionNameOrThrow(rawName) {
  const name = STORE_INFO.COLLECTIONS.find(c => c === rawName);
  if (!name) {
    const error = new Error(`Unknown collection: ${rawName}`);
    error.statusCode = 400;
    throw error;
  }
  return name;
}

async function handleStoreRoutes(req, res, url) {
  const match = url.pathname.match(STORE_COLLECTION_PATTERN);
  if (!match) return false;
  const rawName = match[1];
  const id = match[3];
  const name = collectionNameOrThrow(rawName);

  // Export/import are collection-agnostic; allow even on auditLog.
  if (req.method === 'GET' && !id && url.searchParams.has('export')) {
    json(res, 200, await exportAll());
    return true;
  }
  if (req.method === 'POST' && !id && url.searchParams.has('import')) {
    const payload = await parseJsonBody(req);
    const mode = url.searchParams.get('mode') || 'replace';
    json(res, 200, await importAll(payload, { mode }));
    return true;
  }

  // auditLog is append-only; allow read but reject writes via the generic CRUD path.
  if (name === 'auditLog') {
    if (req.method === 'GET') {
      const list = await listCollection('auditLog');
      json(res, 200, list.slice(-200));
      return true;
    }
    sendText(res, 405, 'auditLog is append-only');
    return true;
  }

  if (req.method === 'GET' && !id) {
    json(res, 200, await listCollection(name));
    return true;
  }
  if (req.method === 'GET' && id) {
    const item = await getItem(name, decodeURIComponent(id));
    if (!item) { json(res, 404, { error: `${name}/${id} not found` }); return true; }
    json(res, 200, item);
    return true;
  }
  if (req.method === 'POST' && !id) {
    const payload = await parseJsonBody(req);
    // scheduleSlots needs strict weekday/hour validation; the generic schema
    // doesn't enforce it. Run the typed validator here before createItem.
    if (name === 'scheduleSlots') {
      const result = validateSlot(payload);
      if (!result.ok) {
        json(res, 400, { error: result.error });
        return true;
      }
      const item = await createItem('scheduleSlots', result.slot);
      json(res, 201, item);
      return true;
    }
    const item = await createItem(name, payload);
    json(res, 201, item);
    return true;
  }
  if ((req.method === 'PUT' || req.method === 'PATCH') && id) {
    const patch = await parseJsonBody(req);
    const item = await updateItem(name, decodeURIComponent(id), patch);
    if (!item) { json(res, 404, { error: `${name}/${id} not found` }); return true; }
    json(res, 200, item);
    return true;
  }
  if (req.method === 'DELETE' && id) {
    const decodedId = decodeURIComponent(id);
    const ok = await deleteItem(name, decodedId);
    json(res, ok ? 200 : 404, { ok, id: decodedId });
    return true;
  }
  return false;
}

function clampInt(value, min, max, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

// Resolve a small list of X handles to feed live X inspiration into the
// context packet. Order of preference:
//   1. Operator-curated `lists` collection with kind=inspiration (handles[]).
//   2. Otherwise, fall back to the first list with handles, sorted by lastUsedAt.
//   3. Otherwise empty — no live X in the packet, with a warning.
//
// We deliberately cap to 3 handles; the fetcher below slices to 3 anyway.
async function pickLiveHandlesForContext(query) {
  try {
    const lists = await listCollection('lists');
    if (!Array.isArray(lists) || !lists.length) return [];
    const insp = lists
      .filter(l => Array.isArray(l.handles) && l.handles.length)
      .sort((a, b) => String(b.lastUsedAt || '').localeCompare(String(a.lastUsedAt || '')));
    const primary = insp[0];
    return Array.isArray(primary?.handles)
      ? primary.handles.slice(0, 3).map(h => String(h).replace(/^@+/, '').trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

async function handle(req, res) {
  if (process.env.TWEET_LAB_DEBUG) console.error('[handle]', req.method, req.url);
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/api/tweet-lab/config') {
      json(res, 200, configResponse());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/tweet-lab/diagnostics') {
      const report = await buildDiagnosticsReport({
        config: configResponse(),
        appInfo: {
          port: PORT,
          tailnetHost: process.env.TWEET_LAB_PUBLIC_HOST || null
        }
      });
      json(res, 200, report);
      return;
    }

    // GET /api/tweet-lab/context[?query=...]
    //
    // Server-side context retrieval pipeline. The browser POSTs / GETs here
    // with an optional `query` seed and an optional `include` flag map, and
    // the server reads from the durable voice DNA file, the Obsidian vault,
    // company-context docs, and the persisted sources collection. Live X is
    // only included when X_BEARER_TOKEN is configured (and only as
    // inspiration; never mutates anything).
    //
    // The response is a redact-safe context packet (see lib/context.js):
    //   { generatedAt, query, voiceSummary, vaultRefs, companyRefs,
    //     sourceBank, sourceRefs (flat), liveX, warnings }
    if (req.method === 'GET' && url.pathname === '/api/tweet-lab/context') {
      const query = url.searchParams.get('query') || '';
      const includeRaw = url.searchParams.get('include') || '';
      const include = {};
      if (includeRaw) {
        for (const part of includeRaw.split(',').map(s => s.trim()).filter(Boolean)) {
          const [k, v] = part.split('=');
          if (!k) continue;
          include[k.trim()] = v === undefined ? true : !['false', '0', 'no', 'off'].includes(String(v).toLowerCase());
        }
      }
      const liveXMax = clampInt(url.searchParams.get('liveXMax'), 1, 25, 6);
      const maxVaultNotes = clampInt(url.searchParams.get('maxVaultNotes'), 1, 20, 5);
      const maxSources = clampInt(url.searchParams.get('maxSources'), 1, 50, 8);

      // Live X fetcher — only wires up when the bearer token is configured.
      const xConfigured = Boolean((configResponse().xConfigured));
      // Accounts the client explicitly wants emulated (operator-profile
      // "accounts to emulate" + home handles). These take priority over the
      // saved Lists collection so generation pulls live tweets from the
      // accounts the operator actually chose.
      const requestedAccounts = (url.searchParams.get('accounts') || '')
        .split(/[\s,]+/)
        .map(h => String(h).replace(/^@+/, '').trim())
        .filter(Boolean);
      const liveXFetcher = xConfigured ? async ({ query: q, maxTweets }) => {
        try {
          // The X search-by-account API expects handles: prefer the accounts the
          // client requested, then fall back to the operator's curated Lists.
          const handles = requestedAccounts.length
            ? requestedAccounts
            : await pickLiveHandlesForContext(q);
          if (!handles.length) {
            return { tweets: [], fetchedAt: new Date().toISOString() };
          }
          const result = await fetchLiveAccountTweets({
            accounts: handles.slice(0, 3),
            limitPerAccount: Math.max(3, Math.min(maxTweets, 10)),
            excludeReplies: true
          });
          return {
            tweets: (result.tweets || []).slice(0, maxTweets),
            fetchedAt: result.fetchedAt || new Date().toISOString()
          };
        } catch {
          // Swallow errors — the liveX block already carries `available: false`
          // + a warning when fetcher throws. Don't poison the packet.
          return { tweets: [], fetchedAt: new Date().toISOString() };
        }
      } : null;

      const packet = await buildContextPacket({
        query,
        include,
        liveXFetcher,
        liveXMax,
        maxVaultNotes,
        maxSources
      });

      // Record a compact summary of the assembled packet on the diagnostics
      // surface so Lucas/Johnny can see the last grounding state (voice
      // loaded, vault notes scanned, company sources, live-X, source refs)
      // and the computed generation blockers. Best-effort: never let a
      // diagnostics recording failure poison the response.
      try {
        recordContextPacket({ packet });
      } catch { /* ignore */ }

      // Best-effort audit — never let an audit failure poison the response.
      try {
        await appendAudit({
          kind: 'context.packet',
          query,
          voiceLoaded: Boolean(packet.voiceSummary?.loaded),
          vaultNotes: packet.vaultRefs?.notes?.length || 0,
          companySources: packet.companyRefs?.sources?.length || 0,
          sourceBankItems: packet.sourceBank?.items?.length || 0,
          liveXTweets: packet.liveX?.tweets?.length || 0,
          liveXAvailable: packet.liveX?.available === true,
          warningCount: packet.warnings?.length || 0,
          sourceRefCount: packet.sourceRefs?.length || 0
        });
      } catch { /* ignore */ }

      json(res, 200, packet);
      return;
    }

    // GET /api/tweet-lab/network — feature contract for every Network/Engage
    // section in the sidebar. Returns explicit availability + reason so the
    // UI can label unavailable features instead of pretending they work.
    if (req.method === 'GET' && url.pathname === '/api/tweet-lab/network') {
      const section = url.searchParams.get('section');
      const id = url.searchParams.get('id');
      if (id) {
        const explanation = explainBlocked(id);
        if (!explanation) { json(res, 404, { error: `unknown feature: ${id}` }); return; }
        json(res, 200, explanation);
        return;
      }
      const features = section ? listFeaturesBySection(section) : listFeatures();
      json(res, 200, { features, network: NETWORK_INFO });
      return;
    }


    if (req.method === 'POST' && url.pathname === '/api/tweet-lab/live/accounts/preview') {
      const payload = await parseJsonBody(req);
      const result = normalizeXAccounts(payload.accounts || payload.account || payload.handles);
      json(res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/tweet-lab/live/accounts/tweets') {
      const payload = await parseJsonBody(req);
      const result = await fetchLiveAccountTweets(payload);
      try {
        await appendAudit({
          kind: 'live.accounts.fetch',
          provider: result.provider,
          accounts: result.accounts.map(item => ({ username: item.username, ok: item.ok, tweetCount: item.tweetCount })),
          tweetCount: result.tweets.length,
          readOnly: true
        });
      } catch { /* ignore */ }
      json(res, 200, result);
      return;
    }

    // X history backfill (server-side, read-only, server-token only).
    //
    // GET  /api/tweet-lab/x-history/status[?username=...&force=1]
    //   Cheap, cached status snapshot: configured, lastFetch, rate limit,
    //   blocker. Force-refreshes by hitting the X API for one page.
    // POST /api/tweet-lab/x-history/fetch
    //   Body: { username?, maxResults?, nextToken? } — single X page,
    //   no persistence. Read-back only.
    // POST /api/tweet-lab/x-history/backfill
    //   Body: { username?, maxPages?, maxTweets? } — paginated walk over
    //   /2/tweets/search/all, persists normalized records to the
    //   `xHistory` collection. Returns counts, cursors, blocker.
    // GET  /api/tweet-lab/x-history/list[?username=...&limit=...]
    //   Read the persisted history. Never mutates.
    // GET  /api/tweet-lab/x-history/tweet?id=...
    //   Read one persisted tweet by X status id.
    if (req.method === 'GET' && url.pathname === '/api/tweet-lab/x-history/status') {
      const username = url.searchParams.get('username') || resolveLucasHandle();
      const force = ['1', 'true', 'yes', 'on'].includes(String(url.searchParams.get('force') || '').toLowerCase());
      const status = await getCachedXHistoryStatus({ username, force });
      json(res, 200, { ...status, info: X_HISTORY_INFO });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/tweet-lab/x-history/fetch') {
      const payload = await parseJsonBody(req);
      const result = await fetchXHistoryPageOnce({
        username: payload.username,
        nextToken: payload.nextToken,
        maxResults: payload.maxResults
      });
      try {
        await appendAudit({
          kind: 'x-history.fetch',
          username: result.username,
          ok: result.ok,
          tweetCount: result.tweets.length,
          nextToken: result.nextToken || null,
          blockerCode: result.blocker?.code || null,
          readOnly: true
        });
      } catch { /* ignore */ }
      json(res, result.ok ? 200 : (result.blocker?.statusCode || 502), result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/tweet-lab/x-history/backfill') {
      if (process.env.TWEET_LAB_DEBUG) console.error('[x-history] BACKFILL ROUTE HIT');
      const payload = await parseJsonBody(req);
      const backfillId = `xhist-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      let result;
      try {
        result = await backfillXHistory({
          username: payload.username,
          maxPages: payload.maxPages,
          maxTweets: payload.maxTweets,
          persist: async (records) => {
            const stamped = records.map(tweet => ({ ...tweet, backfillId }));
            const writeResult = await bulkUpsertXHistory(stamped);
            // bulkUpsertXHistory returns {inserted, updated, total}; the
            // backfill lib reads `writeResult.persisted` to surface the
            // count. Map inserted+updated onto persisted so a re-run of
            // the same batch reports the right number (it can be either
            // inserted or updated — both are persistence operations).
            return {
              persisted: (Number(writeResult?.inserted) || 0) + (Number(writeResult?.updated) || 0),
              inserted: writeResult?.inserted || 0,
              updated: writeResult?.updated || 0,
              total: writeResult?.total || 0
            };
          }
        });
      } catch (err) {
        if (process.env.TWEET_LAB_DEBUG) console.error('[backfill] threw:', err?.message, err?.stack);
        throw err;
      }
      if (process.env.TWEET_LAB_DEBUG) {
        console.error('[backfill] result keys:', Object.keys(result || {}).join(','));
        console.error('[backfill] result.ok:', result?.ok, 'persisted:', result?.persisted, 'tweets count:', result?.tweets?.length, 'pages:', result?.pages);
      }
      try {
        await appendAudit({
          kind: 'x-history.backfill',
          username: result.username,
          ok: result.ok,
          pages: result.pages,
          pagesSkipped: result.pagesSkipped,
          uniqueCount: result.uniqueCount,
          persisted: result.persisted,
          truncated: result.truncated,
          blockerCode: result.blocker?.code || null,
          readOnly: true
        });
      } catch { /* ignore */ }
      // Record the backfill outcome on the diagnostics surface so the Home
      // generation panel can show the last X-history sync state (ok / pages /
      // persisted / blocker) without re-reading the audit log.
      try {
        recordXHistorySync({ result });
      } catch { /* ignore */ }
      // 200 even when the API blocked partway through — the response
      // payload includes the blocker, partial pages, and the persisted
      // count so the UI can show "we got N, but X returned 429 on page
      // K" honestly.
      json(res, 200, result);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/tweet-lab/x-history/list') {
      const username = (url.searchParams.get('username') || '').trim().toLowerCase();
      const limit = clampInt(url.searchParams.get('limit'), 1, 500, 50);
      const all = await listCollection('xHistory');
      const filtered = username
        ? all.filter(item => String(item?.author?.username || '').toLowerCase() === username)
        : all;
      const sorted = [...filtered].sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
      const sliced = sorted.slice(0, limit);
      json(res, 200, {
        items: sliced,
        total: filtered.length,
        limit,
        username: username || null,
        readOnly: true,
        provider: X_HISTORY_PROVIDER
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/tweet-lab/x-history/tweet') {
      const id = (url.searchParams.get('id') || '').trim();
      if (!id) { json(res, 400, { error: 'id query parameter is required.' }); return; }
      const item = await getItem('xHistory', id);
      if (!item) { json(res, 404, { error: `xHistory/${id} not found` }); return; }
      json(res, 200, { item, readOnly: true, provider: X_HISTORY_PROVIDER });
      return;
    }

    // Mentions feed (read-only). Returns 503 with an exact blocker when the
    // X user-context access token is missing; the UI must surface the
    // blocker verbatim. No public reply path is exposed here.
    if (req.method === 'GET' && url.pathname === '/api/tweet-lab/x-analytics') {
      // Real account analytics from the app bearer: aggregate impressions +
      // engagement from the operator's own recent tweets, and live follower
      // count from the public profile metrics. No user-context OAuth needed.
      const username = (url.searchParams.get('username') || resolveLucasHandle());
      let tweets = [];
      try { const all = await listCollection('xHistory'); tweets = Array.isArray(all) ? all : []; } catch { /* ignore */ }
      if (!tweets.length) { try { const s = await getCachedXHistoryStatus({ username }); tweets = s?.lastFetch?.tweets || []; } catch { /* ignore */ } }
      let followers = null;
      const bt = getXBearerToken();
      if (bt) {
        try {
          const r = await fetch(`https://api.x.com/2/users/by/username/${encodeURIComponent(username)}?user.fields=public_metrics`, { headers: { authorization: `Bearer ${bt}` }, signal: AbortSignal.timeout(10000) });
          const d = await r.json();
          followers = d?.data?.public_metrics?.followers_count ?? null;
        } catch { /* ignore */ }
      }
      const num = (t, k) => Number((t.metrics && t.metrics[k]) ?? (t.public_metrics && t.public_metrics[k]) ?? 0) || 0;
      const sum = (k) => tweets.reduce((a, t) => a + num(t, k), 0);
      const impressions = sum('impressionCount') + sum('impression_count');
      const likes = sum('likeCount') + sum('like_count');
      const reposts = sum('repostCount') + sum('retweet_count');
      const replies = sum('replyCount') + sum('reply_count');
      const quotes = sum('quoteCount') + sum('quote_count');
      const series = tweets.slice(0, 30).reverse().map(t => num(t, 'impressionCount') || num(t, 'impression_count'));
      json(res, 200, {
        username, followers, impressions, engagement: likes + reposts + replies + quotes,
        likes, reposts, replies, quotes, tweetCount: tweets.length, series,
        provider: 'x-api', source: bt ? 'live' : 'none'
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/tweet-lab/mentions/status') {
      json(res, 200, mentionsConfigStatus());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/tweet-lab/mentions/fetch') {
      const payload = await parseJsonBody(req);
      const status = mentionsConfigStatus();
      let result;
      if (status.mode === 'user-context') {
        // Preferred: real user-context mentions timeline.
        result = await fetchLiveMentions(payload);
      } else if (status.mode === 'search') {
        // Fallback: search-based mentions via the read-only app bearer.
        result = await fetchMentionsViaSearch(payload);
      } else {
        json(res, 503, {
          error: status.blocker,
          provider: MENTIONS_PROVIDER,
          readOnly: true,
          requiresUserContext: true,
          configured: false,
          credential: status.credential,
          mentions: [],
          accounts: [],
          warnings: [status.blocker]
        });
        return;
      }
      try {
        await appendAudit({
          kind: 'mentions.fetch',
          provider: result.provider,
          accounts: result.accounts.map(item => ({ username: item.username, ok: item.ok, mentionCount: item.mentionCount })),
          mentionCount: result.mentions.length,
          readOnly: true
        });
      } catch { /* ignore */ }
      json(res, 200, result);
      return;
    }

    // Private AI reply draft. Generates and persists draft replies; never
    // publishes. Replies live in the `replies` store collection with
    // `published: false` until a future approval action flips it.
    if (req.method === 'POST' && url.pathname === '/api/tweet-lab/mentions/reply/draft') {
      const payload = await parseJsonBody(req);
      const result = await draftMentionReply(payload);
      json(res, 200, result);
      return;
    }


    if (req.method === 'POST' && url.pathname === '/api/tweet-lab/discover/search') {
      const payload = await parseJsonBody(req);
      const result = await discoverSearch(payload);
      try {
        await appendAudit({
          kind: 'discover.search',
          provider: result.provider,
          topics: result.topics,
          query: result.query,
          resultCount: result.results.length,
          readOnly: true
        });
      } catch { /* ignore */ }
      json(res, 200, result);
      return;
    }

    // POST /api/tweet-lab/discover/inspire — signal-driven inspiration feed.
    if (req.method === 'POST' && url.pathname === '/api/tweet-lab/discover/inspire') {
      const payload = await parseJsonBody(req);
      const result = await discoverInspire(payload);
      try {
        await appendAudit({
          kind: 'discover.inspire',
          topics: result.topics,
          topicSource: result.topicSource,
          resultCount: result.results.length,
          readOnly: true
        });
      } catch { /* ignore */ }
      json(res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/tweet-lab/discover/fetch') {
      const payload = await parseJsonBody(req);
      const result = await discoverFetch(payload);
      try {
        await appendAudit({
          kind: 'discover.fetch',
          provider: result.provider,
          url: result.url,
          statusId: result.statusId,
          hasResult: Boolean(result.result?.text),
          readOnly: true
        });
      } catch { /* ignore */ }
      json(res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/tweet-lab/remix') {
      const payload = await parseJsonBody(req);
      const result = await remixAndPersist(payload);
      try {
        await appendAudit({
          kind: 'draft.remix',
          adapter: result.adapter,
          candidates: result.candidates.length,
          drafts: result.drafts.length,
          parentDraftId: result.parentDraftId,
          mockModeForced: result.mockModeForced,
          templateId: result.sourcePacket?.templateId
        });
      } catch { /* ignore */ }
      json(res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/tweet-lab/rewrite') {
      const payload = await parseJsonBody(req);
      const result = await rewriteAndPersist(payload);
      try {
        await appendAudit({
          kind: 'rewrite',
          adapter: result.adapter,
          candidates: result.candidates.length,
          drafts: result.drafts.length,
          sourceTweetAuthor: result.sourceTweet?.author,
          sourceTweetUrl: result.sourceTweet?.url,
          mockModeForced: result.mockModeForced,
          templateId: payload.templateId
        });
      } catch { /* ignore */ }
      json(res, 200, result);
      return;
    }

    // POST /api/tweet-lab/expand-thread — expand a tweet into a full thread.
    if (req.method === 'POST' && url.pathname === '/api/tweet-lab/expand-thread') {
      const payload = await parseJsonBody(req);
      const result = await expandThread(payload);
      json(res, 200, result);
      return;
    }

    // AI Writer generation endpoint
    if (req.method === 'POST' && url.pathname === '/api/tweet-lab/ai-writer/generate') {
      const payload = await parseJsonBody(req);
      const result = await aiWriterGenerate(payload);
      try {
        await appendAudit({
          kind: 'ai-writer.generate',
          adapter: result.adapter,
          candidates: result.candidates?.length || 0,
          prompt: payload.prompt?.slice(0, 200),
          agentMode: payload.agentMode,
          autoMode: payload.autoMode,
          mockModeForced: result.mockModeForced
        });
      } catch { /* ignore */ }
      json(res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/tweet-lab/generate') {
      const payload = await parseJsonBody(req);
      const result = await generateAndPersist(payload);
      // Best-effort audit; never let audit failure poison the generate response.
      try {
        await appendAudit({
          kind: 'generate',
          adapter: result.adapter,
          candidates: result.candidates.length,
          drafts: result.drafts.length,
          sourceLinks: (result.sourcePacket?.inspirationLinks || []).length,
          selectedSources: (result.sourcePacket?.selectedSources || []).length,
          mockModeForced: result.mockModeForced,
          templateId: result.sourcePacket?.templateId
        });
      } catch { /* ignore */ }
      json(res, 200, result);
      return;
    }

    if (req.method === 'POST' && /^\/api\/tweet-lab\/drafts\/[^/]+\/transition$/.test(url.pathname)) {
      const id = decodeURIComponent(url.pathname.split('/')[4]);
      const payload = await parseJsonBody(req);
      json(res, 200, await transitionDraft(id, payload));
      return;
    }

    if (req.method === 'POST' && /^\/api\/tweet-lab\/drafts\/[^/]+\/edit$/.test(url.pathname)) {
      const id = decodeURIComponent(url.pathname.split('/')[4]);
      const payload = await parseJsonBody(req);
      json(res, 200, await editDraft(id, payload));
      return;
    }

    if (req.method === 'GET' && /^\/api\/tweet-lab\/drafts\/[^/]+\/review$/.test(url.pathname)) {
      const id = decodeURIComponent(url.pathname.split('/')[4]);
      const draft = await getItem('drafts', id);
      if (!draft) { json(res, 404, { error: `drafts/${id} not found` }); return; }
      const allDrafts = await listCollection('drafts');
      const gate = reviewDraft(draft, { allDrafts });
      json(res, 200, { draftId: id, ...gate });
      return;
    }

    if (req.method === 'POST' && /^\/api\/tweet-lab\/drafts\/[^/]+\/review$/.test(url.pathname)) {
      const id = decodeURIComponent(url.pathname.split('/')[4]);
      const draft = await getItem('drafts', id);
      if (!draft) { json(res, 404, { error: `drafts/${id} not found` }); return; }
      // Allow overriding text/sourceRefs in the review body for ad-hoc checks.
      const body = await parseJsonBody(req);
      const reviewInput = {
        ...draft,
        text: body.text ?? draft.text,
        sourceRefs: body.sourceRefs ?? draft.sourceRefs
      };
      const allDrafts = await listCollection('drafts');
      const gate = reviewDraft(reviewInput, { allDrafts });
      // Persist the updated gate on the draft.
      const updated = await updateItem('drafts', id, {
        gateStatus: gate.status,
        gateScore: gate.score,
        gateWarnings: gate.warnings,
        gateChecks: gate.checks,
        gateSuggestions: gate.suggestions
      });
      json(res, 200, { draftId: id, ...gate, draft: updated });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/tweet-lab/queue') {
      const payload = await parseJsonBody(req);
      const allSources = await listCollection('sources');
      const queue = buildQueue({
        sources: allSources,
        tag: payload.tag,
        format: payload.format,
        count: payload.count,
        seed: payload.seed || new Date().toISOString().slice(0, 10)
      });
      json(res, 200, { queue, totalSources: allSources.length, filters: { tag: payload.tag, format: payload.format, count: payload.count, seed: payload.seed } });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/tweet-lab/schedule') {
      const payload = await parseJsonBody(req);
      const result = await schedulePost(payload);
      try {
        await appendAudit({
          kind: 'schedule',
          ok: true,
          contentLength: String(payload.content || '').length,
          scheduledAt: payload.scheduledAt,
          draftId: payload.draftId
        });
      } catch { /* ignore */ }
      json(res, 200, result);
      return;
    }

    // POST /api/tweet-lab/upload-media — upload an image/video to Postiz and
    // return a { id, path } media ref the compose panel can attach to a post.
    if (req.method === 'POST' && url.pathname === '/api/tweet-lab/upload-media') {
      const payload = await parseJsonBody(req);
      const apiKey = process.env.POSTIZ_API_KEY;
      const apiUrl = (process.env.POSTIZ_API_URL || DEFAULT_POSTIZ_API_URL).replace(/\/$/, '');
      if (!apiKey) { json(res, 503, { error: 'POSTIZ_API_KEY is not configured.' }); return; }
      const b64 = String(payload.dataBase64 || '').replace(/^data:[^,]+,/, '');
      if (!b64) { json(res, 400, { error: 'dataBase64 is required.' }); return; }
      const buf = Buffer.from(b64, 'base64');
      const contentType = String(payload.contentType || 'application/octet-stream');
      const filename = String(payload.filename || 'upload');
      const form = new FormData();
      form.append('file', new Blob([buf], { type: contentType }), filename);
      const up = await fetch(`${apiUrl}/public/v1/upload`, {
        method: 'POST',
        headers: { authorization: apiKey.replace(/^Bearer\s+/i, '') },
        body: form
      });
      const txt = await up.text();
      let parsed; try { parsed = JSON.parse(txt); } catch { parsed = { text: txt }; }
      if (!up.ok) { json(res, 502, { error: parsed?.message || parsed?.error || `Postiz upload HTTP ${up.status}`, details: parsed }); return; }
      const m = Array.isArray(parsed) ? parsed[0] : parsed;
      json(res, 200, { id: m?.id, path: m?.path || m?.url, name: m?.name, type: contentType, raw: parsed });
      return;
    }

    // ── Schedule queue / posting-time intelligence (Phase 5B) ──

    // GET /api/tweet-lab/schedule/queue — weekly calendar/list view of scheduled, posted, and approved drafts.
    if (req.method === 'GET' && url.pathname === '/api/tweet-lab/schedule/queue') {
      const allDrafts = await listCollection('drafts');
      const approvedIntake = allDrafts
        .filter(d => d && d.status === 'approved' && !d.scheduledAt)
        .sort((a, b) => Date.parse(b.approvedAt || b.updatedAt || b.createdAt || 0) - Date.parse(a.approvedAt || a.updatedAt || a.createdAt || 0));
      const calendarDrafts = allDrafts
        .filter(d => d && (d.scheduledAt || d.postedAt || d.status === 'approved'))
        .map(d => ({
          ...d,
          calendarAt: d.scheduledAt || d.postedAt || d.approvedAt || d.updatedAt || d.createdAt
        }));
      const postedDrafts = allDrafts
        .filter(d => d && (d.status === 'posted' || d.postedAt))
        .map(d => ({ ...d, status: 'posted', calendarAt: d.postedAt || d.updatedAt || d.createdAt }));
      const auditLog = await listCollection('auditLog');
      const failed = auditLog
        .filter(entry => entry && (entry.kind === 'schedule' || entry.kind === 'diagnostics.schedule') && entry.ok === false)
        .slice(-50)
        .reverse()
        .map(entry => ({
          id: entry.id,
          status: 'failed',
          failedAt: entry.at,
          calendarAt: entry.at,
          scheduledAt: entry.scheduledAt,
          draftId: entry.draftId,
          text: entry.draftId ? `Schedule attempt for draft ${entry.draftId}` : 'Schedule attempt failed',
          error: entry.error || entry.mode || 'failed receipt unavailable'
        }));
      const scheduledForConflicts = allDrafts.filter(d => d && d.scheduledAt);
      const days = groupQueueByDay(calendarDrafts, {
        timezone: url.searchParams.get('timezone') || SCHEDULE_INTERNALS.DEFAULT_TZ
      });
      const conflicts = detectScheduleQueueConflicts(scheduledForConflicts);
      const summary = summarizeQueue(calendarDrafts);
      summary.conflictCount = conflicts.length;
      const slots = (await listCollection('scheduleSlots')).filter(isWellFormedSlot);
      json(res, 200, {
        days,
        approvedIntake,
        posted: postedDrafts,
        failed,
        conflicts,
        summary,
        slots,
        weekdayLabels: WEEKDAY_LABELS,
        windowMinutes: SCHEDULE_INTERNALS.CONFLICT_WINDOW_MIN
      });
      return;
    }

    // POST /api/tweet-lab/schedule/check — does scheduling at this time conflict?
    if (req.method === 'POST' && url.pathname === '/api/tweet-lab/schedule/check') {
      const payload = await parseJsonBody(req);
      const scheduledAt = String(payload.scheduledAt || '').trim();
      if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) {
        json(res, 400, { error: 'scheduledAt is required and must be a valid ISO timestamp.' });
        return;
      }
      const allDrafts = await listCollection('drafts');
      const excludeId = payload.draftId ? String(payload.draftId) : null;
      const scheduled = allDrafts
        .filter(d => d && d.scheduledAt && d.id !== excludeId);
      const conflicts = findConflicts(scheduledAt, scheduled);
      json(res, 200, {
        scheduledAt,
        conflicts,
        ok: conflicts.length === 0,
        windowMinutes: SCHEDULE_INTERNALS.CONFLICT_WINDOW_MIN
      });
      return;
    }

    // POST /api/tweet-lab/schedule/suggest — generate posting-time suggestions.
    if (req.method === 'POST' && url.pathname === '/api/tweet-lab/schedule/suggest') {
      const payload = await parseJsonBody(req);
      const fromDate = payload.fromDate ? new Date(payload.fromDate) : new Date();
      if (Number.isNaN(fromDate.getTime())) {
        json(res, 400, { error: 'fromDate, if provided, must be a valid ISO timestamp.' });
        return;
      }
      const allSlots = (await listCollection('scheduleSlots')).filter(isWellFormedSlot);
      const allDrafts = await listCollection('drafts');
      const scheduled = allDrafts.filter(d => d && d.scheduledAt);
      const result = buildSuggestions({
        slots: allSlots,
        scheduledDrafts: scheduled,
        fromDate,
        lookaheadDays: Number(payload.lookaheadDays || 7),
        limit: Number(payload.limit || SCHEDULE_INTERNALS.MAX_SUGGESTIONS)
      });
      json(res, 200, {
        ...result,
        slotCount: allSlots.length,
        scheduledCount: scheduled.length,
        fromDate: fromDate.toISOString()
      });
      return;
    }

    // POST /api/tweet-lab/schedule/slots/bulk — replace all configured slots with defaults.
    // Convenience for first-time setup; the UI uses the generic CRUD for day-to-day edits.
    if (req.method === 'POST' && url.pathname === '/api/tweet-lab/schedule/slots/bulk') {
      const payload = await parseJsonBody(req);
      const slots = Array.isArray(payload.slots) ? payload.slots : [];
      const validated = [];
      for (const candidate of slots) {
        const result = validateSlot(candidate);
        if (!result.ok) {
          json(res, 400, { error: `Invalid slot: ${result.error}`, slot: candidate });
          return;
        }
        validated.push(result.slot);
      }
      // Wipe existing slots.
      const existing = await listCollection('scheduleSlots');
      for (const slot of existing) {
        if (slot && slot.id) await deleteItem('scheduleSlots', slot.id);
      }
      // Create the new ones.
      const created = [];
      for (const slot of validated) {
        const item = await createItem('scheduleSlots', slot);
        created.push(item);
      }
      json(res, 200, { slots: created, count: created.length });
      return;
    }

    // Persistent store: GET /api/tweet-lab/store/<collection>[?export=1]
    //                  POST /api/tweet-lab/store/<collection>[?import=1&mode=merge|replace]
    //                  GET /api/tweet-lab/store/<collection>/<id>
    //                  POST /api/tweet-lab/store/<collection>
    //                  PUT /api/tweet-lab/store/<collection>/<id>
    //                  DELETE /api/tweet-lab/store/<collection>/<id>
    if (url.pathname.startsWith('/api/tweet-lab/store/')) {
      const handled = await handleStoreRoutes(req, res, url);
      if (handled) return;
      sendText(res, 405, 'Method not allowed for store route');
      return;
    }

    if (req.method === 'GET') {
      await serveStatic(req, res);
      return;
    }

    sendText(res, 405, 'Method not allowed');
  } catch (error) {
    json(res, error.statusCode || 500, {
      error: error.message || 'Unknown server error',
      details: error.details,
      payloadPreview: error.payloadPreview,
      gate: error.gate,
      conflicts: error.conflicts,
      conflictWindowMinutes: error.conflictWindowMinutes,
      invalid: error.invalid,
      accounts: error.accounts,
      warnings: error.warnings,
      provider: error.statusCode === 503 || error.accounts ? X_PROVIDER : undefined,
      readOnly: error.statusCode === 503 || error.accounts ? true : undefined
    });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await ensureStore();
  const server = http.createServer(handle);
  const host = process.env.HOST || '127.0.0.1';
  server.listen(PORT, host, () => {
    console.log(`Tweet Lab listening on http://${host}:${PORT}`);
    console.log(`Persistent store: ${STORE_INFO.DATA_FILE}`);
  });
}

export {
  buildGoroPrompt,
  buildRewritePrompt,
  buildMentionReplyPrompt,
  buildPostizPayload,
  generateTweets,
  generateAndPersist,
  rewriteTweet,
  rewriteAndPersist,
  remixDraft,
  remixAndPersist,
  schedulePost,
  handle,
  configResponse,
  pickGoroMode,
  extractJsonObject,
  normalizeTweetUrl,
  resolveTweetUrl,
  normalizeXAccountInput,
  normalizeXAccounts,
  fetchLiveAccountTweets,
  fetchLiveMentions,
  draftMentionReply,
  mentionsConfigStatus,
  normalizeMention,
  discoverSearch,
  discoverFetch,
  buildDiscoverQuery,
  ensureStore,
  reviewDraft,
  computeGate
};

// X history backfill exports (test surface + future inline consumers).
export {
  fetchXHistoryPageOnce,
  backfillXHistory,
  getXHistoryStatus,
  getCachedXHistoryStatus,
  resolveLucasHandle,
  X_HISTORY_PROVIDER,
  X_HISTORY_INFO,
  resetXHistoryForTests
};

// Phase 5B exports (test surface + future inline consumers)
export {
  validateSlot,
  isWellFormedSlot,
  findConflicts,
  detectScheduleQueueConflicts,
  buildSuggestions,
  projectSlotToIso,
  groupQueueByDay,
  summarizeQueue,
  WEEKDAY_LABELS
};
