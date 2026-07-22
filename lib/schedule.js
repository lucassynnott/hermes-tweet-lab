/**
 * Schedule intelligence — slot library, conflict detection, posting-time suggestions.
 *
 * Pure module — no I/O, no side effects. The server layer wires these to the
 * persistent JSON store and HTTP routes; the UI renders their output.
 *
 * Concepts:
 *   - Slot   = a configurable posting time: weekday (0-6, Sun=0) + hour (0-23) + label + weight + tz.
 *   - Queue  = the visible set of scheduled drafts (status='scheduled') that
 *              may conflict with each other or with new scheduling attempts.
 *   - Conflict = two queue items whose scheduledAt timestamps fall within
 *                CONFLICT_WINDOW_MIN of each other.
 *   - Suggestion = a recommended slot for a given weekday, optionally offset
 *                  away from existing scheduled drafts.
 *
 * Time is interpreted in the slot's timezone (defaults to UTC).
 */

const DEFAULT_TZ = 'UTC';
const CONFLICT_WINDOW_MIN = 30; // two posts within 30 minutes of each other are "too close"
const MS_PER_MIN = 60 * 1000;
const MAX_QUEUE_LOOKAHEAD_DAYS = 14;
const MAX_SUGGESTIONS = 4;

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const _internals = {
  DEFAULT_TZ,
  CONFLICT_WINDOW_MIN,
  MS_PER_MIN,
  MAX_QUEUE_LOOKAHEAD_DAYS,
  MAX_SUGGESTIONS
};

// ── Validation ───────────────────────────────────────────────

/**
 * Validate and normalize a slot payload from the API.
 * Returns { ok: true, slot } on success or { ok: false, error } on failure.
 * The returned slot is a clean, defensive copy.
 */
export function validateSlot(input) {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Slot payload must be an object.' };
  }
  const weekday = Number(input.weekday);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    return { ok: false, error: 'Slot weekday must be an integer 0-6 (Sun=0).' };
  }
  const hour = Number(input.hour);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return { ok: false, error: 'Slot hour must be an integer 0-23.' };
  }
  const label = input.label !== undefined ? String(input.label).trim().slice(0, 80) : '';
  const weight = input.weight !== undefined ? Math.max(0, Math.min(Number(input.weight) || 1, 10)) : 1;
  const timezone = input.timezone ? String(input.timezone).trim().slice(0, 64) || DEFAULT_TZ : DEFAULT_TZ;
  return { ok: true, slot: { weekday, hour, label, weight, timezone } };
}

/**
 * Determine if a stored slot has the minimum fields we expect.
 * Loose — used to filter old / corrupt slots out of the queue view.
 */
export function isWellFormedSlot(slot) {
  return Boolean(
    slot &&
    Number.isInteger(slot.weekday) && slot.weekday >= 0 && slot.weekday <= 6 &&
    Number.isInteger(slot.hour) && slot.hour >= 0 && slot.hour <= 23
  );
}

// ── Conflict detection ───────────────────────────────────────

/**
 * Given a candidate ISO timestamp and a list of scheduled drafts (each with
 * scheduledAt), return conflicts: any scheduled draft within ±CONFLICT_WINDOW_MIN
 * of the candidate.
 */
export function findConflicts(candidateIso, scheduledDrafts, { windowMinutes = CONFLICT_WINDOW_MIN } = {}) {
  if (!candidateIso) return [];
  const candidate = Date.parse(candidateIso);
  if (Number.isNaN(candidate)) return [];
  const window = windowMinutes * MS_PER_MIN;
  const list = Array.isArray(scheduledDrafts) ? scheduledDrafts : [];
  return list
    .filter(d => d && d.scheduledAt && !Number.isNaN(Date.parse(d.scheduledAt)))
    .map(d => {
      const t = Date.parse(d.scheduledAt);
      const delta = t - candidate;
      return {
        draftId: d.id,
        scheduledAt: d.scheduledAt,
        text: d.text || '',
        angle: d.angle || '',
        status: d.status || 'scheduled',
        deltaMinutes: Math.round(delta / MS_PER_MIN),
        withinWindow: Math.abs(delta) <= window
      };
    })
    .filter(c => c.withinWindow)
    .sort((a, b) => Math.abs(a.deltaMinutes) - Math.abs(b.deltaMinutes));
}

/**
 * Build a flat list of pairwise conflicts inside a scheduled-drafts list.
 * Used for the queue-view warnings ("drafts A and B are 12 min apart").
 */
export function detectScheduleQueueConflicts(scheduledDrafts, { windowMinutes = CONFLICT_WINDOW_MIN } = {}) {
  const list = (Array.isArray(scheduledDrafts) ? scheduledDrafts : [])
    .filter(d => d && d.scheduledAt && !Number.isNaN(Date.parse(d.scheduledAt)))
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
  const conflicts = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const delta = Date.parse(list[j].scheduledAt) - Date.parse(list[i].scheduledAt);
      if (delta > windowMinutes * MS_PER_MIN) break; // sorted, so no further pairs overlap
      const minutes = Math.round(delta / MS_PER_MIN);
      if (Math.abs(minutes) <= windowMinutes) {
        conflicts.push({
          a: { id: list[i].id, scheduledAt: list[i].scheduledAt, angle: list[i].angle, text: list[i].text },
          b: { id: list[j].id, scheduledAt: list[j].scheduledAt, angle: list[j].angle, text: list[j].text },
          deltaMinutes: minutes
        });
      }
    }
  }
  return conflicts;
}

// ── Suggestions ──────────────────────────────────────────────

/**
 * Build the "next N days" suggestion set from a slot library.
 *
 * For each day in [today, today+lookahead), take all slots that match that
 * weekday and project them forward in time, using the slot's timezone label
 * as an informational tag (the timestamp itself is UTC ISO; rendering reads tz).
 *
 * Returned suggestions are scored:
 *   - slot weight contributes positively
 *   - being too close to an existing scheduled draft subtracts points
 *
 * The highest-scoring suggestion per day is surfaced as `bestForDay`.
 */
export function buildSuggestions({
  slots,
  scheduledDrafts = [],
  fromDate = new Date(),
  lookaheadDays = 7,
  windowMinutes = CONFLICT_WINDOW_MIN,
  limit = MAX_SUGGESTIONS
} = {}) {
  const cleanSlots = (Array.isArray(slots) ? slots : []).filter(isWellFormedSlot);
  if (!cleanSlots.length) return { suggestions: [], bestForDay: [], windowMinutes };

  const from = new Date(fromDate);
  from.setSeconds(0, 0);
  const today = new Date(from);
  today.setHours(0, 0, 0, 0);

  const scheduledList = (Array.isArray(scheduledDrafts) ? scheduledDrafts : [])
    .filter(d => d && d.scheduledAt && !Number.isNaN(Date.parse(d.scheduledAt)));

  const suggestions = [];
  const perDay = new Map();

  const days = Math.max(1, Math.min(Number(lookaheadDays) || 7, MAX_QUEUE_LOOKAHEAD_DAYS));
  for (let offset = 0; offset < days; offset++) {
    const day = new Date(today);
    day.setDate(today.getDate() + offset);
    const weekday = day.getDay();
    const matching = cleanSlots.filter(s => s.weekday === weekday);
    for (const slot of matching) {
      const slotDate = new Date(day);
      slotDate.setHours(slot.hour, 0, 0, 0);
      // Skip slots in the past (allow a small grace for "now" within the same hour)
      if (slotDate.getTime() < from.getTime() - 60 * 60 * 1000) continue;
      const iso = slotDate.toISOString();
      const nearDrafts = scheduledList
        .map(d => ({ draftId: d.id, deltaMinutes: Math.round((Date.parse(d.scheduledAt) - slotDate.getTime()) / MS_PER_MIN) }))
        .filter(item => Math.abs(item.deltaMinutes) <= windowMinutes);
      let score = Number(slot.weight) || 1;
      if (nearDrafts.length) score -= 0.5 * nearDrafts.length;
      const suggestion = {
        iso,
        weekday,
        weekdayLabel: WEEKDAY_LABELS[weekday],
        hour: slot.hour,
        label: slot.label || '',
        timezone: slot.timezone || DEFAULT_TZ,
        weight: slot.weight || 1,
        score: Math.max(0, Math.round(score * 100) / 100),
        nearDrafts,
        conflict: nearDrafts.length > 0
      };
      suggestions.push(suggestion);
      const key = day.toISOString().slice(0, 10);
      const existing = perDay.get(key);
      if (!existing || existing.score < suggestion.score) perDay.set(key, suggestion);
    }
  }

  // Sort: highest score first, then soonest.
  suggestions.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return Date.parse(a.iso) - Date.parse(b.iso);
  });

  const bestForDay = Array.from(perDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, s]) => ({ day, ...s }));

  return {
    suggestions: suggestions.slice(0, Math.max(1, Math.min(Number(limit) || MAX_SUGGESTIONS, MAX_SUGGESTIONS * 2))),
    bestForDay,
    windowMinutes
  };
}

// ── Slot projection helpers ──────────────────────────────────

/**
 * Project a single slot to its next ISO timestamp from a reference date.
 *
 * The slot's `hour` is interpreted in the slot's `timezone` label (informational;
 * the actual timestamp is computed as a UTC ISO using Node's local timezone
 * arithmetic, which matches the way the UI renders the slot for the operator).
 * If the slot has already passed this week, advance to the same day next week.
 *
 * NOTE: this is best-effort without a timezone-aware date library. The intent
 * is "what time would the operator see for this slot?" — and the operator
 * sees times in the slot's tz label. We project to a local time string and
 * convert to UTC ISO; the UI is expected to render with the tz label too.
 */
export function projectSlotToIso(slot, fromDate = new Date()) {
  if (!isWellFormedSlot(slot)) return null;
  const from = new Date(fromDate);
  from.setSeconds(0, 0);
  // Build a target Date at the operator's local time matching slot.hour on the
  // next matching weekday. This makes "Mon 09:00 in the slot tz" round-trip
  // correctly through UTC ISO when the host is in the same tz (or close).
  const target = new Date(from);
  target.setHours(slot.hour, 0, 0, 0);
  const dayDiff = (slot.weekday - from.getDay() + 7) % 7;
  target.setDate(from.getDate() + dayDiff);
  if (target.getTime() < from.getTime() - 60 * 60 * 1000) {
    target.setDate(target.getDate() + 7);
  }
  return target.toISOString();
}

/**
 * Group a list of scheduled drafts by calendar day in the given timezone label.
 * Used to render a queue/calendar view.
 */
export function groupQueueByDay(scheduledDrafts, { timezone = DEFAULT_TZ } = {}) {
  const list = (Array.isArray(scheduledDrafts) ? scheduledDrafts : [])
    .filter(d => d && (d.calendarAt || d.scheduledAt || d.postedAt || d.approvedAt || d.updatedAt || d.createdAt))
    .sort((a, b) => Date.parse(a.calendarAt || a.scheduledAt || a.postedAt || a.approvedAt || a.updatedAt || a.createdAt) - Date.parse(b.calendarAt || b.scheduledAt || b.postedAt || b.approvedAt || b.updatedAt || b.createdAt));
  const groups = new Map();
  for (const draft of list) {
    const calendarAt = draft.calendarAt || draft.scheduledAt || draft.postedAt || draft.approvedAt || draft.updatedAt || draft.createdAt;
    const t = new Date(calendarAt);
    const key = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    if (!groups.has(key)) {
      groups.set(key, {
        day: key,
        weekday: t.getDay(),
        weekdayLabel: WEEKDAY_LABELS[t.getDay()],
        timezone,
        items: []
      });
    }
    groups.get(key).items.push({
      id: draft.id,
      calendarAt,
      scheduledAt: draft.scheduledAt,
      postedAt: draft.postedAt,
      approvedAt: draft.approvedAt,
      angle: draft.angle || '',
      text: draft.text || '',
      status: draft.status || 'scheduled',
      sourceRefs: Array.isArray(draft.sourceRefs) ? draft.sourceRefs : [],
      gateStatus: draft.gateStatus || 'clean'
    });
  }
  return Array.from(groups.values());
}

/**
 * Build a summary block for a queue: total scheduled, by status, conflicts count.
 */
export function summarizeQueue(scheduledDrafts) {
  const list = Array.isArray(scheduledDrafts) ? scheduledDrafts : [];
  const conflicts = detectScheduleQueueConflicts(list);
  const byStatus = list.reduce((acc, d) => {
    const status = d.status || 'scheduled';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  const totalScheduled = byStatus.scheduled || 0;
  const totalPosted = byStatus.posted || 0;
  const totalApproved = byStatus.approved || 0;
  return {
    total: list.length,
    byStatus,
    totalScheduled,
    totalPosted,
    totalApproved,
    conflictCount: conflicts.length
  };
}