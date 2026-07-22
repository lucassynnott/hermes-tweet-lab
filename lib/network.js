// Tweet Lab network feature contract.
//
// This module defines what each "Network" / "Engage" section of the
// sidebar can safely do today, and the exact reason when it cannot. It is
// intentionally a single source of truth so the UI can label every
// unavailable live/social feature with the same wording, and so future
// capability work knows the contract.
//
// Non-negotiables (carry over from the redesign spec):
//   - Preserve read-only/server-side X credentials. Do not leak tokens/API
//     keys to browser JS, localStorage, logs, or responses.
//   - No public posting/replying without explicit Lucas approval.
//   - No DM scraping, no unauthorized private data, no public outreach.
//   - No invented metrics, client results, or proof.
//
// Anything labelled `available: false` here MUST surface that reason in
// the UI rather than silently rendering empty state.

const FEATURES = [
  {
    id: 'mentions',
    sidebar: 'Mentions',
    page: 'mentions',
    section: 'engage',
    label: 'Mentions & reply context',
    summary: 'Public mentions of your handle plus the public replies left on them. Server-side, read-only.',
    available: true,
    reason: null,
    capabilities: [
      'Read recent public mentions of @LucasSynnott via X recent search.',
      'Open each mention in a new tab; reply drafts stay private until you approve them.'
    ],
    blockedBy: [],
    source: 'x-api-recent-search'
  },
  {
    id: 'discover',
    sidebar: 'Discover',
    page: 'discover',
    section: 'engage',
    label: 'Topic discovery & reply opportunities',
    summary: 'Search X for topics you want to engage with and surface reply-friendly posts.',
    available: true,
    reason: null,
    capabilities: [
      'Keyword topic search via X recent search.',
      'Seed account list from local Lists to limit discovery to known-good handles.'
    ],
    blockedBy: [],
    source: 'x-api-recent-search'
  },
  {
    id: 'lists',
    sidebar: 'Lists',
    page: 'lists',
    section: 'engage',
    label: 'Local X-list-style groups',
    summary: 'Group public handles and saved sources into operator-curated buckets used by Discover and Inspiration.',
    available: true,
    reason: null,
    capabilities: [
      'Create / edit / delete local lists (handles + sourceIds + tags).',
      'Use a list as a seed set when fetching live X or building topic searches.',
      'Persist entirely in the configured private Tweet Lab data file.'
    ],
    blockedBy: [],
    source: 'local-store'
  },
  {
    id: 'my-replies',
    sidebar: 'My Replies',
    page: 'my-replies',
    section: 'engage',
    label: 'Local reply drafts & manually imported replies',
    summary: 'Track reply drafts and any reply you manually confirm as sent. No automatic outbound posting.',
    available: true,
    reason: null,
    capabilities: [
      'Reply drafts are saved to the local drafts store with lifecycle=reply.',
      'Manually log sent replies with parent post URL + reply text + timestamp.',
      'Mark replies as approved only after explicit operator confirmation.'
    ],
    blockedBy: [],
    source: 'local-store'
  },
  {
    id: 'ready-to-post',
    sidebar: 'Ready to Post',
    page: 'ready-to-post',
    section: 'create',
    label: 'Ready-to-Post masonry',
    summary: 'Generated drafts surfaced as a card grid with review-gate status and source provenance.',
    available: true,
    reason: null,
    capabilities: [
      'Tab filters: All / For You / Company / Vault / Inspiration.',
      'Customize style reads/edits voice DNA without exposing secrets.',
      'Generate more uses the home/context generation pipeline.'
    ],
    blockedBy: [],
    source: 'local-store + goro-mode'
  },
  {
    id: 'inspiration',
    sidebar: 'Inspiration',
    page: 'inspiration',
    section: 'create',
    label: 'Source bank inspiration feed',
    summary: 'Saved tweets, articles, and media surfaced as inspiration candidates.',
    available: true,
    reason: null,
    capabilities: [
      'Posts tab -> live + saved X posts (read-only).',
      'Articles tab -> Obsidian / saved article notes.',
      'Media tab -> saved media / live tweet media.'
    ],
    blockedBy: [],
    source: 'local-store + x-api-recent-search'
  },
  {
    id: 'ai-writer',
    sidebar: 'AI Writer',
    page: 'ai-writer',
    section: 'create',
    label: 'AI drafting workspace',
    summary: 'Chat-style drafting using voice DNA, vault context, source bank, and optional live X.',
    available: true,
    reason: null,
    capabilities: [
      'Uses Lucas voice DNA, previous posts, Obsidian vault, source bank.',
      'Agent Mode can run multi-source retrieval before drafting.',
      'Output drafts save to Ready to Post; never auto-post.'
    ],
    blockedBy: [],
    source: 'goro-mode'
  },
  {
    id: 'contacts',
    sidebar: 'Contacts',
    page: 'contacts',
    section: 'network',
    label: 'Operator contact book (public handles only)',
    summary: 'Public-handle-only operator contact book with cadence, tags, and operator notes. No DMs, no emails.',
    available: true,
    reason: null,
    capabilities: [
      'Store public handles (1-15 chars), role, cadence, tags, and operator notes.',
      'Server rejects anything that looks like a DM body, inbox thread, or email.',
      'Use contacts as inspiration seeds (their public posts only).'
    ],
    blockedBy: [],
    source: 'local-store'
  },
  {
    id: 'dms',
    sidebar: 'DMs',
    page: 'dms',
    section: 'network',
    label: 'Direct messages',
    summary: 'Direct messages are intentionally NOT supported. We do not read, write, or store DM traffic.',
    available: false,
    reason: 'Direct messages require the X DM endpoints (POST /2/dm_conversations, POST /2/dm_conversations/:id/messages). We have no read-only DM credential, no DM read API, and no operator approval flow for sending DMs. We will not scrape DMs, cache DM contents, or pretend to show DM history with placeholder data.',
    capabilities: [
      'Surfacing a "not supported" state keeps the sidebar complete without lying.',
      'Any future DM work would require (a) approved X DM API access, (b) an explicit per-message operator approval flow, and (c) a separate threat model.'
    ],
    blockedBy: [
      'No approved X DM API credential configured.',
      'No operator approval flow for outbound DM sends.',
      'Forbidden by Tweet Lab data boundary rules: no DM scraping, no unauthorized private data.'
    ],
    source: null
  }
];

export function listFeatures() {
  return FEATURES.map(feature => ({ ...feature }));
}

export function listFeaturesBySection(section) {
  return FEATURES.filter(feature => feature.section === section).map(feature => ({ ...feature }));
}

export function getFeature(id) {
  const found = FEATURES.find(feature => feature.id === id);
  return found ? { ...found } : null;
}

// Reason metadata is what the UI should render next to "coming soon"
// affordances. Keeping it structured means we don't end up with copy drift.
export function explainBlocked(id) {
  const feature = getFeature(id);
  if (!feature) return null;
  if (feature.available) {
    return {
      id,
      available: true,
      capabilities: feature.capabilities,
      source: feature.source
    };
  }
  return {
    id,
    available: false,
    label: feature.label,
    reason: feature.reason,
    blockedBy: feature.blockedBy,
    capabilities: feature.capabilities
  };
}

// Sidebar IA derived from FEATURES — used to render the nav with section
// labels and ordered correctly. Hidden features (available=false) are
// still rendered so the sidebar matches the SuperX reference, but get
// a `data-blocked="true"` attribute the UI can style.
export const SIDEBAR_IA = [
  { section: 'primary', items: ['home', 'queue', 'analytics'] },
  { section: 'engage', items: ['mentions', 'discover', 'lists', 'my-replies'] },
  { section: 'create', items: ['ready-to-post', 'inspiration', 'ai-writer'] },
  { section: 'network', items: ['contacts', 'dms'] }
];

// Legacy sidebar ids — kept for back-compat with the existing app
// shell so we can render the same IA labels.
export const SIDEBAR_LABELS = {
  'home': 'Home',
  'queue': 'Queue',
  'analytics': 'Analytics',
  'mentions': 'Mentions',
  'discover': 'Discover',
  'lists': 'Lists',
  'my-replies': 'My Replies',
  'ready-to-post': 'Ready to Post',
  'inspiration': 'Inspiration',
  'ai-writer': 'AI Writer',
  'contacts': 'Contacts',
  'dms': 'DMs'
};

// Map legacy page ids (workbench/inspiration/drafts/...) to the new
// sidebar id list. Used while we incrementally redesign the IA. Existing
// workbench pages keep their id; we only add brand-new pages here.
export const PAGE_ID_TO_FEATURE_ID = {
  'mentions': 'mentions',
  'discover': 'discover',
  'lists': 'lists',
  'my-replies': 'my-replies',
  'contacts': 'contacts',
  'dms': 'dms',
  'ready-to-post': 'ready-to-post',
  'ai-writer': 'ai-writer'
};

export const FEATURE_ID_TO_PAGE_ID = Object.fromEntries(
  Object.entries(PAGE_ID_TO_FEATURE_ID).map(([pageId, featureId]) => [featureId, pageId])
);

export const NETWORK_INFO = {
  features: FEATURES.map(feature => ({
    id: feature.id,
    label: feature.label,
    sidebar: feature.sidebar,
    section: feature.section,
    available: feature.available,
    reason: feature.reason
  }))
};
