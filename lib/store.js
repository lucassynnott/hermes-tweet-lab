import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.TWEET_LAB_DATA_DIR
  ? path.resolve(process.env.TWEET_LAB_DATA_DIR)
  : path.resolve(__dirname, '..', 'data');
export const DATA_FILE = process.env.TWEET_LAB_DATA_FILE
  ? path.resolve(process.env.TWEET_LAB_DATA_FILE)
  : path.join(DATA_DIR, 'tweet-lab.json');
export const SCHEMA_VERSION = 3;

export const COLLECTIONS = ['sources', 'drafts', 'templates', 'angles', 'scheduleSlots', 'replies', 'lists', 'contacts', 'xHistory', 'auditLog'];

// Field-name patterns that are redacted before persisting. Broad on purpose:
// if a key looks like a credential, its value is replaced with [redacted].
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
  /^postiz/i
];

// Light per-collection schema. Required fields must be present and non-empty on create.
const SCHEMAS = {
  sources: {
    required: [],
    optional: ['url', 'statusId', 'author', 'text', 'capturedAt', 'sourceType', 'tags', 'format', 'whySaved', 'engagement', 'warnings',
      'collection', 'qualityScore', 'hookPattern', 'stale', 'staleReason', 'riskNotes', 'verifiedAt', 'lastUsedAt', 'useCount',
      'provider', 'fetchedAt', 'authorProfile', 'media']
  },
  drafts: {
    required: ['text'],
    optional: ['angle', 'rationale', 'sourceRefs', 'warnings', 'status', 'scheduledAt', 'editedAt', 'postizReceipt', 'createdAt', 'rejectReason', 'approvedAt', 'postedAt', 'gateStatus', 'gateScore', 'gateWarnings', 'gateChecks', 'gateSuggestions']
  },
  templates: {
    required: ['name', 'body'],
    optional: ['tags', 'formats', 'note', 'intent', 'whenToUse', 'constraints', 'exampleOutput', 'sourceRequirements', 'forbiddenPatterns']
  },
  angles: {
    required: ['name'],
    optional: ['sourceLinks', 'note', 'priority', 'expiry', 'recommendedFormats']
  },
  scheduleSlots: {
    required: [],
    optional: ['weekday', 'hour', 'label', 'weight', 'timezone']
  },
  replies: {
    required: ['text'],
    optional: [
      'mentionId', 'mentionAuthor', 'mentionUsername', 'mentionText', 'mentionUrl',
      'originalTweet', 'parentTweet', 'conversationId',
      'context', 'tone', 'templateId', 'templateName',
      'sourceRefs', 'rationale', 'angle', 'warnings',
      'adapter', 'goroProfile', 'mockModeForced', 'gateStatus', 'gateScore',
      'published', 'postedAt', 'notes'
    ]
  },
  // Local X-list-style groups.
  // public-handle contact/list book.
  lists: {
    required: ['name'],
    optional: ['kind', 'description', 'handles', 'tags', 'sourceIds', 'topic', 'tone', 'lastUsedAt', 'useCount', 'notes']
  },
  contacts: {
    required: ['handle'],
    optional: ['displayName', 'role', 'cadence', 'tags', 'notes', 'lastEngagedAt', 'sourceId', 'verified']
  },
  // Local X history backfill store. One record per tweet id, keyed by id
  // (tweet id from X, not a generated uuid) so re-runs of the backfill
  // upsert the same row. The operator's own previous tweets live here.
  xHistory: {
    required: ['id'],
    optional: [
      'url', 'text', 'createdAt',
      'author', 'metrics', 'media',
      'source', 'fetchedAt',
      'firstSeenAt', 'lastSeenAt', 'backfillId',
      'inReplyToTweetId', 'inReplyToUserId', 'lang',
      'relevance', 'tags', 'warningCodes'
    ]
  }
};

function defaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    sources: [],
    drafts: [],
    templates: [],
    angles: [],
    scheduleSlots: [],
    replies: [],
    lists: [],
    contacts: [],
    auditLog: []
  };
}

export function newId(prefix) {
  const safePrefix = String(prefix || 'id').replace(/[^a-z0-9_-]/gi, '').slice(0, 12) || 'id';
  return `${safePrefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

function stripSecrets(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (SECRET_FIELD_PATTERNS.some(rx => rx.test(key))) {
      out[key] = '[redacted]';
    } else {
      out[key] = stripSecrets(val);
    }
  }
  return out;
}

function validateForCreate(name, payload) {
  const schema = SCHEMAS[name];
  if (!schema) return;
  for (const field of schema.required) {
    const v = payload?.[field];
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
      const error = new Error(`Field "${field}" is required for ${name}`);
      error.statusCode = 400;
      throw error;
    }
  }
  // Operator-side guard rails: keep contacts and lists strictly public /
  // operator-local. Reject anything that looks like private DM traffic,
  // emails, phone numbers, or full message bodies.
  if (name === 'contacts') {
    const handle = String(payload.handle || '').trim().replace(/^@+/, '');
    if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
      const error = new Error('Contact handle must be a public X handle (1-15 letters, numbers, or underscores). No @, no email, no private DMs.');
      error.statusCode = 400;
      throw error;
    }
    const notes = String(payload.notes || '');
    if (notes.length > 4000) {
      const error = new Error('Contact notes must be 4000 characters or less.');
      error.statusCode = 400;
      throw error;
    }
    // Operator-side guard: keep contacts strictly public. Reject anything that
    // looks like inbound DM bodies, sent-message trails, or email addresses.
    if (/(?:\bDM\b|direct message|inbox:|@[A-Za-z0-9_]+\s+sent|\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b)/i.test(notes)) {
      const error = new Error('Contact notes must not contain DM bodies, inbound message threads, or email addresses. Keep it operator-local metadata.');
      error.statusCode = 400;
      throw error;
    }
  }
  if (name === 'lists') {
    const handles = Array.isArray(payload.handles) ? payload.handles : [];
    for (const raw of handles) {
      const handle = String(raw || '').trim().replace(/^@+/, '');
      if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
        const error = new Error(`List handle "${raw}" must be a public X handle (1-15 letters, numbers, or underscores).`);
        error.statusCode = 400;
        throw error;
      }
    }
    if (String(payload.description || '').length > 1000) {
      const error = new Error('List description must be 1000 characters or less.');
      error.statusCode = 400;
      throw error;
    }
  }
}

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export async function ensureStore() {
  await ensureDir();
  try {
    await fs.access(DATA_FILE);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    await writeAll(defaultState());
  }
}

async function readRaw() {
  const raw = await fs.readFile(DATA_FILE, 'utf8');
  return JSON.parse(raw);
}

async function writeAll(state) {
  await ensureDir();
  const tmp = `${DATA_FILE}.tmp-${process.pid}-${Date.now()}`;
  const payload = JSON.stringify(state, null, 2);
  let handle;
  try {
    handle = await fs.open(tmp, 'w');
    await handle.writeFile(payload, 'utf8');
    await handle.sync();
  } finally {
    if (handle) await handle.close();
  }
  await fs.rename(tmp, DATA_FILE);
}

// Serialise mutations so concurrent writes don't tear the file.
let writeQueue = Promise.resolve();
function withWriteLock(fn) {
  const next = writeQueue.then(() => fn());
  // Swallow rejections on the queue tail so a failed mutation doesn't poison
  // every subsequent operation. The caller still gets the original error.
  writeQueue = next.catch(() => {});
  return next;
}

function withCollections(state) {
  const base = state && typeof state === 'object' ? state : defaultState();
  for (const name of COLLECTIONS) {
    if (!Array.isArray(base[name])) base[name] = [];
  }
  if (!base.schemaVersion) base.schemaVersion = SCHEMA_VERSION;
  if (!base.createdAt) base.createdAt = new Date().toISOString();
  return base;
}

export async function readAll() {
  await ensureStore();
  try {
    return withCollections(await readRaw());
  } catch (err) {
    if (err.code === 'ENOENT') {
      await writeAll(defaultState());
      return defaultState();
    }
    // Corrupt JSON — back it up and start clean rather than crash the whole app.
    try {
      const backup = `${DATA_FILE}.corrupt-${Date.now()}`;
      await fs.copyFile(DATA_FILE, backup);
    } catch { /* best effort */ }
    const fresh = defaultState();
    await writeAll(fresh);
    return fresh;
  }
}

async function mutate(fn) {
  return withWriteLock(async () => {
    const state = await readAll();
    const result = await fn(state);
    await writeAll(state);
    return result;
  });
}

export async function listCollection(name) {
  if (!COLLECTIONS.includes(name)) {
    const error = new Error(`Unknown collection: ${name}`);
    error.statusCode = 400;
    throw error;
  }
  const state = await readAll();
  return state[name];
}

export async function getItem(name, id) {
  const list = await listCollection(name);
  return list.find(item => item.id === id) || null;
}

export async function createItem(name, payload) {
  if (!COLLECTIONS.includes(name) || name === 'auditLog') {
    const error = new Error(`Cannot create via createItem for collection: ${name}`);
    error.statusCode = 400;
    throw error;
  }
  const safePayload = stripSecrets(payload || {});
  validateForCreate(name, safePayload);
  return mutate(async state => {
    const now = new Date().toISOString();
    const prefixMap = {
      scheduleSlots: 'slot',
      lists: 'list',
      contacts: 'contact'
    };
    const defaultPrefix = name.replace(/s$/, '').slice(0, 3);
    const prefix = prefixMap[name] || defaultPrefix;
    const item = {
      id: safePayload.id || newId(prefix),
      ...safePayload,
      createdAt: safePayload.createdAt || now,
      updatedAt: now
    };
    if (name === 'drafts' && !item.status) item.status = 'generated';
    state[name].push(item);
    return item;
  });
}

export async function updateItem(name, id, patch) {
  if (!COLLECTIONS.includes(name) || name === 'auditLog') {
    const error = new Error(`Cannot update collection: ${name}`);
    error.statusCode = 400;
    throw error;
  }
  const safePatch = stripSecrets(patch || {});
  return mutate(async state => {
    const idx = state[name].findIndex(item => item.id === id);
    if (idx === -1) return null;
    const now = new Date().toISOString();
    const merged = {
      ...state[name][idx],
      ...safePatch,
      id,
      updatedAt: now
    };
    if (name === 'drafts') merged.editedAt = now;
    state[name][idx] = merged;
    return merged;
  });
}

export async function deleteItem(name, id) {
  if (!COLLECTIONS.includes(name) || name === 'auditLog') {
    const error = new Error(`Cannot delete from collection: ${name}`);
    error.statusCode = 400;
    throw error;
  }
  return mutate(async state => {
    const idx = state[name].findIndex(item => item.id === id);
    if (idx === -1) return false;
    state[name].splice(idx, 1);
    return true;
  });
}

// Upsert a record by id. Used by the X history backfill so re-runs merge
// into the same row (tweet id is the natural key) instead of duplicating.
// The payload is run through the same secret-stripping + required-field
// validators that createItem uses, so a future caller can't sneak
// credentials into the persisted JSON.
export async function upsertItem(name, id, payload) {
  if (!COLLECTIONS.includes(name) || name === 'auditLog') {
    const error = new Error(`Cannot upsert into collection: ${name}`);
    error.statusCode = 400;
    throw error;
  }
  if (!id) {
    const error = new Error(`upsertItem requires an id for ${name}`);
    error.statusCode = 400;
    throw error;
  }
  const safePayload = stripSecrets({ ...(payload || {}), id });
  validateForCreate(name, safePayload);
  return mutate(async state => {
    const now = new Date().toISOString();
    const idx = state[name].findIndex(item => item.id === id);
    if (idx === -1) {
      const created = { ...safePayload, id, createdAt: safePayload.createdAt || now, updatedAt: now };
      state[name].push(created);
      return { item: created, created: true };
    }
    const merged = { ...state[name][idx], ...safePayload, id, updatedAt: now };
    state[name][idx] = merged;
    return { item: merged, created: false };
  });
}

// Bulk upsert for X history backfill. Single mutate() pass so a 100-tweet
// page is one file read + one file write, not 100. Records are merged on
// the tweet id (X status id, not the new-id generator). firstSeenAt is
// preserved across re-runs; lastSeenAt + backfillId are refreshed.
export async function bulkUpsertXHistory(records) {
  if (!Array.isArray(records) || !records.length) {
    return { inserted: 0, updated: 0, total: 0 };
  }
  return mutate(async state => {
    if (!Array.isArray(state.xHistory)) state.xHistory = [];
    const byId = new Map(state.xHistory.map(item => [item.id, item]));
    const now = new Date().toISOString();
    let inserted = 0;
    let updated = 0;
    for (const raw of records) {
      if (!raw || !raw.id) continue;
      const safe = stripSecrets(raw);
      const existing = byId.get(safe.id);
      if (!existing) {
        const created = { ...safe, firstSeenAt: now, lastSeenAt: now, createdAt: now, updatedAt: now };
        state.xHistory.push(created);
        byId.set(safe.id, created);
        inserted += 1;
      } else {
        const merged = { ...existing, ...safe, id: safe.id, firstSeenAt: existing.firstSeenAt || now, lastSeenAt: now, updatedAt: now };
        const idx = state.xHistory.indexOf(existing);
        state.xHistory[idx] = merged;
        byId.set(safe.id, merged);
        updated += 1;
      }
    }
    return { inserted, updated, total: state.xHistory.length };
  });
}

export async function appendAudit(entry) {
  const safeEntry = stripSecrets(entry || {});
  return mutate(async state => {
    const item = {
      id: newId('audit'),
      at: new Date().toISOString(),
      ...safeEntry
    };
    state.auditLog.push(item);
    return item;
  });
}

export async function exportAll() {
  return readAll();
}

export async function importAll(payload, { mode = 'replace' } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    const error = new Error('Import payload must be a JSON object.');
    error.statusCode = 400;
    throw error;
  }
  if (!['replace', 'merge'].includes(mode)) {
    const error = new Error('Import mode must be "replace" or "merge".');
    error.statusCode = 400;
    throw error;
  }
  return mutate(async state => {
    const incoming = {};
    for (const name of COLLECTIONS) {
      incoming[name] = Array.isArray(payload[name]) ? payload[name].map(stripSecrets) : [];
    }
    if (mode === 'merge') {
      for (const name of COLLECTIONS) {
        const map = new Map(state[name].map(item => [item.id, item]));
        for (const item of incoming[name]) {
          if (item && item.id) map.set(item.id, item);
        }
        state[name] = Array.from(map.values());
      }
    } else {
      for (const name of COLLECTIONS) state[name] = incoming[name];
    }
    const counts = {};
    for (const name of COLLECTIONS) counts[name] = state[name].length;
    return { mode, counts };
  });
}

export const STORE_INFO = { SCHEMA_VERSION, COLLECTIONS, DATA_FILE, DATA_DIR };
