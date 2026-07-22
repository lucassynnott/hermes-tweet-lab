const state = {
  drafts: [],
  sources: [],
  selectedDraftId: null,
  config: null,
  diagnostics: null,
  lastResult: null,
  queue: [],
  queueSelectedIds: new Set(),
  scheduleQueue: { days: [], approvedIntake: [], conflicts: [], summary: { total: 0, byStatus: {}, conflictCount: 0 }, slots: [], windowMinutes: 30 },
  calendarView: 'week',
  queueTab: 'scheduled',
  suggestions: { suggestions: [], bestForDay: [], windowMinutes: 30 },
  liveTweets: [],
  liveAccounts: [],
  liveReceipt: null,
  selectedLiveIds: new Set(),
  inspirationTab: 'posts',
  defaultConflictWindow: 30,
  analyticsTab: 'engagement',
  mentions: {
    status: null,
    feed: [],
    blocked: false,
    blockerMessage: '',
    credential: null,
    selectedAccount: '',
    demoMode: false,
    busy: false,
    draftsById: {}
  },
  discover: {
    mode: 'empty',
    topics: [],
    query: null,
    results: [],
    fetched: null,
    warnings: [],
    blocker: null,
    pendingResult: null,
    rateLimit: null
  },
  contextPacket: null
};

const DRAFT_STATUSES = ['generated', 'needs-proof', 'approved', 'scheduled', 'rejected', 'posted'];

const DEMO_TAG = 'local-demo';
const DEMO_SOURCE_IDS = ['local-demo-source-operator-loop', 'local-demo-source-review-gate'];
const DEMO_TEMPLATE_IDS = ['local-demo-template-contrarian', 'local-demo-template-checklist'];

const DEMO_SOURCES = [
  {
    id: DEMO_SOURCE_IDS[0],
    url: '',
    statusId: '',
    author: 'local example',
    text: 'Local demo example · a small operator loop beats a sprawling AI tool stack when it owns the handoff from input to approved output.',
    sourceType: 'manual',
    tags: [DEMO_TAG, 'operator-loop'],
    format: 'contrarian',
    whySaved: 'LOCAL DEMO ONLY: teaches the saved-source queue. Not live, not verified, not fetched from X.',
    collection: 'local demo examples',
    qualityScore: 3,
    hookPattern: 'contrarian-take',
    stale: false,
    engagement: {},
    warnings: ['local demo/example · not live X data']
  },
  {
    id: DEMO_SOURCE_IDS[1],
    url: '',
    statusId: '',
    author: 'local example',
    text: 'Local demo example · approval gates are useful when they distinguish internal drafts from customer-facing or public sends.',
    sourceType: 'manual',
    tags: [DEMO_TAG, 'approval-gate'],
    format: 'framework',
    whySaved: 'LOCAL DEMO ONLY: use to practice selecting saved sources before generation. Not live, not verified.',
    collection: 'local demo examples',
    qualityScore: 3,
    hookPattern: 'decision-frame',
    stale: false,
    engagement: {},
    warnings: ['local demo/example · not live X data']
  }
];

const DEMO_TEMPLATES = [
  {
    id: DEMO_TEMPLATE_IDS[0],
    name: 'LOCAL DEMO · Contrarian operator take',
    body: 'Common belief: <what people assume>.\nCorrection: <what the source actually shows>.\nOperator lesson: <one useful action>.\nConstraint: do not invent metrics or attribution.',
    tags: [DEMO_TAG, 'operator-loop'],
    formats: ['contrarian'],
    note: 'LOCAL DEMO ONLY: example drafting recipe, not proof or live signal.'
  },
  {
    id: DEMO_TEMPLATE_IDS[1],
    name: 'LOCAL DEMO · Review-gate checklist',
    body: 'Hook: <specific tension>.\nChecklist: 1) source visible 2) claim bounded 3) next action clear.\nClose: <one sentence operator takeaway>.',
    tags: [DEMO_TAG, 'review-gate'],
    formats: ['list', 'framework'],
    note: 'LOCAL DEMO ONLY: use to learn template selection. Not live or verified data.'
  }
];

const DEMO_SLOTS = [
  { weekday: 1, hour: 9, label: 'LOCAL DEMO · Mon morning operator review', weight: 3, timezone: 'UTC' },
  { weekday: 3, hour: 14, label: 'LOCAL DEMO · Wed draft approval window', weight: 2, timezone: 'UTC' },
  { weekday: 5, hour: 11, label: 'LOCAL DEMO · Fri schedule check', weight: 2, timezone: 'UTC' }
];

const ID_ALIASES = {
  '#generateTop': '#generateTopLegacy',
  '#commandCenter': '#contextStatusCard',
  '#dashXHealth': '#dashLiveX',
  '#dashLastFetch': '#dashPreviousPosts',
  '#dashSelectedSources': '#dashSourceBank',
  '#dashDraftBacklog': '#dashVoiceDna',
  '#dashApprovedUnscheduled': '#dashCompany',
  '#dashNextSlot': '#dashObsidian',
  '#dashWarnings': '#contextWarnings',
  '#accountHandles': '#homeAccountHandles',
  '#accountChips': '#homeAccountChips',
  '#liveLimit': '#homeLiveLimit',
  '#excludeReplies': '#homeExcludeReplies',
  '#mediaOnly': '#homeMediaOnly',
  '#context': '#homeContext',
  '#tone': '#homeTone',
  '#count': '#homeCount',
  '#inspirationLinks': '#homeInspirationLinks',
  '#templateSelect': '#homeTemplateSelect',
  '#recipeCardSelector': '#homeRecipeCardSelector',
  '#fetchLiveTweets': '#homeFetchLiveTweets',
  '#generateButton': '#homeGenerateButton',
  '#clearLiveSelection': '#homeClearLiveSelection',
  '#refreshLiveTweets': '#homeRefreshLiveTweets',
  '#liveStatus': '#homeLiveStatus',
  '#generateStatus': '#homeGenerateStatus',
  '#liveSummary': '#homeLiveSummary',
  '#liveTweetList': '#homeLiveTweetList',
  '#selectedLiveCount': '#homeSelectedLiveCount',
  '#selectedLiveList': '#homeSelectedLiveList',
  '#draftList': '#homeDraftMasonry'
};
const $ = selector => document.querySelector(selector) || (ID_ALIASES[selector] ? document.querySelector(ID_ALIASES[selector]) : null);
const $$ = selector => Array.from(document.querySelectorAll(selector));

function setRoute(route) {
  const aliases = {
    dashboard: 'home',
    generate: 'home',
    workbench: 'home',
    drafts: 'ready-to-post',
    schedule: 'queue',
    bank: 'library',
    templates: 'library'
  };
  const raw = route || location.hash.replace('#', '') || 'home';
  const anchorTarget = raw && document.getElementById(raw);
  const page = aliases[raw] || anchorTarget?.closest('.page')?.dataset.page || raw;
  $$('.page').forEach(section => section.classList.toggle('active', section.dataset.page === page));
  $$('.nav a').forEach(link => link.classList.toggle('active', link.dataset.route === raw || link.dataset.route === page));
  renderMobileActionBar(page);
  // Page-specific bootstraps. The Mentions page must always re-render so
  // the toolbar reflects the latest config / accounts list and any blocker
  // state. The status fetch is fire-and-forget; renderMentionsFeed is
  // idempotent.
  if (page === 'mentions') {
    renderMentionsFeed();
    loadMentionsStatus().catch(() => { /* handled in module */ });
  }
  if (anchorTarget && anchorTarget.closest('.page') !== anchorTarget) {
    requestAnimationFrame(() => anchorTarget.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    return;
  }
  requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
  setTimeout(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }), 0);
}

function setStatus(element, message, type = '') {
  if (!element) return;
  element.textContent = message;
  element.className = `status-note ${type}`.trim();
}

function linksFromInput() {
  return $('#inspirationLinks').value.split(/\n|,/).map(link => link.trim()).filter(Boolean);
}

function valuesFromList(value) {
  return String(value || '').split(/\n|,/).map(item => item.trim()).filter(Boolean);
}


const MOBILE_ACTIONS = {
  home: [
    { label: 'Fetch', target: '#workbench-command', action: 'fetch' },
    { label: 'Rewrite', target: '#workbench-command', action: 'generate' },
    { label: 'Drafts', route: 'ready-to-post' },
    { label: 'Receipts', target: '#workbench-receipts' }
  ],
  inspiration: [
    { label: 'Search', action: 'searchInspiration' },
    { label: 'Generate', action: 'generateQueue' },
    { label: 'Tools', action: 'openSourceTools' }
  ],
  'ready-to-post': [
    { label: 'Refresh', action: 'refreshDrafts' },
    { label: 'Approved', action: 'filterApproved' },
    { label: 'Queue', route: 'queue' }
  ],
  queue: [
    { label: 'Drafts', action: 'queueDrafts' },
    { label: 'Edit Queue', action: 'toggleQueueEdit' },
    { label: 'Refresh', action: 'refreshQueue' },
    { label: 'Postiz', action: 'focusSchedule' }
  ],
  library: [
    { label: 'Save', action: 'focusSource' },
    { label: 'Backup', action: 'toggleBackup' },
    { label: 'Refresh', action: 'refreshSources' }
  ],
  workshop: [
    { label: 'Refresh', action: 'refreshWorkshop' },
    { label: 'Drafts', route: 'ready-to-post' },
    { label: 'Workbench', route: 'home' }
  ],
  analytics: [
    { label: '30 days', action: 'analytics30' },
    { label: 'Queue', route: 'queue' },
    { label: 'Drafts', route: 'ready-to-post' }
  ],
  mentions: [ { label: 'Discover', route: 'discover' }, { label: 'Writer', route: 'ai-writer' } ],
  discover: [ { label: 'Search', route: 'inspiration' }, { label: 'Writer', route: 'ai-writer' } ],
  lists: [ { label: 'Inspiration', route: 'inspiration' }, { label: 'Home', route: 'home' } ],
  'my-replies': [ { label: 'Writer', route: 'ai-writer' }, { label: 'Home', route: 'home' } ],
  'ai-writer': [ { label: 'Generate', action: 'generate' }, { label: 'Ready', route: 'ready-to-post' } ],
  contacts: [ { label: 'Home', route: 'home' }, { label: 'DMs', route: 'dms' } ],
  dms: [ { label: 'Home', route: 'home' }, { label: 'Contacts', route: 'contacts' } ],
  settings: [
    { label: 'Workbench', route: 'home' },
    { label: 'Drafts', route: 'ready-to-post' }
  ]
};

function performMobileAction(action) {
  if (action === 'fetch') $('#fetchLiveTweets')?.click();
  else if (action === 'generate') $('#generateButton')?.click();
  else if (action === 'buildQueue') $('#buildQueue')?.click();
  else if (action === 'generateQueue') $('#generateFromQueue')?.click();
  else if (action === 'searchInspiration') $('#inspirationSearchButton')?.click();
  else if (action === 'openSourceTools') { const tools = $('#sourceBankTools'); if (tools) { tools.open = true; tools.scrollIntoView({ block: 'start', behavior: 'smooth' }); } }
  else if (action === 'refreshDrafts') $('#refreshDrafts')?.click();
  else if (action === 'filterApproved') { $('#draftStatusFilter').value = 'approved'; renderDrafts(); }
  else if (action === 'refreshSuggestions') $('#refreshSuggestions')?.click();
  else if (action === 'toggleSlots') openMobilePanel($('.slot-panel'));
  else if (action === 'queueDrafts') setQueueTab('drafts');
  else if (action === 'toggleQueueEdit') $('#editQueueButton')?.click();
  else if (action === 'refreshQueue') $('#refreshQueue')?.click();
  else if (action === 'focusSchedule') $('#scheduleContent')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  else if (action === 'focusSource') $('#sourceUrl')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  else if (action === 'toggleBackup') openMobilePanel($('.library-tab.active .import-export-panel'));
  else if (action === 'refreshSources') $('#refreshSources')?.click();
  else if (action === 'refreshWorkshop') $('#refreshWorkshop')?.click();
  else if (action === 'analytics30') { $('#analyticsRange').value = '30'; renderAnalytics(); }
}


function renderMobileActionBar(page = document.querySelector('.page.active')?.dataset.page || 'workbench') {
  const bar = $('#mobileActionBar');
  if (!bar) return;
  const actions = MOBILE_ACTIONS[page] || MOBILE_ACTIONS.home;
  bar.innerHTML = actions.map(item => `<button type="button" class="mobile-action-button" data-mobile-route="${escapeHtml(item.route || '')}" data-mobile-target="${escapeHtml(item.target || '')}" data-mobile-action="${escapeHtml(item.action || '')}">${escapeHtml(item.label)}</button>`).join('');
  bar.querySelectorAll('button').forEach(button => button.addEventListener('click', event => {
    const { mobileRoute, mobileTarget, mobileAction } = event.currentTarget.dataset;
    if (mobileRoute) location.hash = `#${mobileRoute}`;
    else if (mobileTarget) location.hash = mobileTarget;
    else if (mobileAction) performMobileAction(mobileAction);
  }));
}

function openMobilePanel(panel) {
  if (!panel) return;
  panel.classList.remove('mobile-collapsed');
  const button = panel.querySelector(':scope > .mobile-collapse-toggle');
  if (button) {
    button.setAttribute('aria-expanded', 'true');
    button.textContent = `Collapse ${button.dataset.label || 'section'}`;
  }
  panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function setupMobileCollapsibles() {
  $$('.mobile-collapsible').forEach(panel => {
    if (panel.querySelector(':scope > .mobile-collapse-toggle')) return;
    const label = panel.dataset.mobileTitle || panel.querySelector('h3')?.textContent?.trim() || 'section';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mobile-collapse-toggle button ghost';
    button.dataset.label = label;
    button.setAttribute('aria-expanded', 'false');
    button.textContent = `Open ${label}`;
    button.addEventListener('click', () => {
      const collapsed = panel.classList.toggle('mobile-collapsed');
      button.setAttribute('aria-expanded', String(!collapsed));
      button.textContent = `${collapsed ? 'Open' : 'Collapse'} ${label}`;
    });
    panel.insertBefore(button, panel.firstChild);
    panel.classList.add('mobile-collapsed');
  });
}

function isLocalDemo(item) {
  return Boolean(item?.id?.startsWith('local-demo-') || item?.label?.startsWith('LOCAL DEMO') || (item?.tags || []).includes(DEMO_TAG));
}

function demoPill() {
  return '<span class="pill demo">local demo/example · not live</span>';
}

function emptyStateHtml({ title, body, steps = [], actions = [] }) {
  const stepHtml = steps.length ? `<ol>${steps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ol>` : '';
  const actionHtml = actions.length ? `<div class="empty-actions">${actions.join('')}</div>` : '';
  return `<div class="empty-state"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(body)}</p>${stepHtml}${actionHtml}</div>`;
}


function normalizeAccountInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let candidate = raw;
  try {
    const parsed = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    if (['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'].includes(parsed.hostname.toLowerCase())) {
      candidate = parsed.pathname.split('/').filter(Boolean)[0] || '';
    }
  } catch { /* plain handle */ }
  candidate = candidate.replace(/^@+/, '').trim();
  const valid = /^[A-Za-z0-9_]{1,15}$/.test(candidate);
  return { input: raw, username: candidate, valid, error: valid ? null : '1-15 letters, numbers, or underscores' };
}

function accountInputsFromField() {
  const raw = $('#accountHandles')?.value || '';
  const seen = new Set();
  const valid = [];
  const invalid = [];
  valuesFromList(raw).forEach(item => {
    const parsed = normalizeAccountInput(item);
    if (!parsed) return;
    if (!parsed.valid) { invalid.push(parsed); return; }
    const key = parsed.username.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    valid.push(parsed);
  });
  return { valid, invalid };
}

function tweetToSelectedSource(tweet) {
  return {
    id: `live-${tweet.id}`,
    url: tweet.url,
    statusId: tweet.id,
    author: tweet.author?.username || '',
    text: tweet.text || '',
    sourceType: 'tweet',
    tags: ['live-x'],
    format: '',
    whySaved: 'Selected from live X account inspiration.',
    engagement: tweet.metrics || {},
    warnings: tweet.warnings || [],
    provider: tweet.source || 'x-api-recent-search',
    fetchedAt: tweet.fetchedAt || state.liveReceipt?.fetchedAt,
    authorProfile: tweet.author || {},
    media: tweet.media || []
  };
}

function renderAccountChips() {
  const el = $('#accountChips');
  if (!el) return;
  const { valid, invalid } = accountInputsFromField();
  state.liveAccounts = valid.map(item => item.username);
  if (!valid.length && !invalid.length) {
    el.className = 'chip-row empty';
    el.textContent = 'Enter handles separated by comma or newline.';
    return;
  }
  el.className = 'chip-row';
  el.innerHTML = [
    ...valid.map(item => `<span class="chip">@${escapeHtml(item.username)} <button data-remove-account="${escapeHtml(item.username)}" aria-label="Remove ${escapeHtml(item.username)}">×</button></span>`),
    ...invalid.map(item => `<span class="chip invalid">${escapeHtml(item.input)} · ${escapeHtml(item.error)}</span>`)
  ].join('');
  $$('[data-remove-account]').forEach(button => button.addEventListener('click', event => {
    const remove = event.currentTarget.dataset.removeAccount.toLowerCase();
    const remaining = accountInputsFromField().valid.filter(item => item.username.toLowerCase() !== remove).map(item => item.username);
    $('#accountHandles').value = remaining.join(', ');
    renderAccountChips();
  }));
}

function formatMetric(value) {
  if (value === null || value === undefined) return 'metrics unavailable';
  if (typeof value === 'string') return value;
  return Intl.NumberFormat().format(value);
}

function renderSelectedLiveList() {
  const list = $('#selectedLiveList');
  const countEl = $('#selectedLiveCount');
  if (!list || !countEl) return;
  const selected = state.liveTweets.filter(tweet => state.selectedLiveIds.has(tweet.id));
  countEl.textContent = String(selected.length);
  if (!selected.length) {
    list.className = 'selected-list empty';
    list.innerHTML = emptyStateHtml({
      title: 'Nothing selected for rewriting yet.',
      body: 'Select live tweets from the right rail, or build a saved-source queue from local Library records.',
      steps: ['Fetch real tweets from account handles.', 'Select the strongest source cards.', 'Generate drafts, review, then schedule.']
    });
    return;
  }
  list.className = 'selected-list';
  list.innerHTML = selected.map(tweet => `<div class="selected-row"><strong>@${escapeHtml(tweet.author?.username || 'unknown')}</strong><span>${escapeHtml(tweet.text || '')}</span><button class="button ghost" data-unselect-live="${escapeHtml(tweet.id)}">Remove</button></div>`).join('');
  $$('[data-unselect-live]').forEach(button => button.addEventListener('click', event => {
    state.selectedLiveIds.delete(event.currentTarget.dataset.unselectLive);
    renderLiveTweets();
renderAnalytics();
    renderSelectedLiveList();
  }));
}

function renderLiveReceipt() {
  const summary = $('#liveSummary');
  if (summary) {
    const receipt = state.liveReceipt;
    if (!receipt) {
      summary.textContent = 'no live fetch yet';
    } else {
      const okAccounts = receipt.accounts?.filter(a => a.ok).length || 0;
      summary.textContent = `${receipt.tweets?.length || 0} real tweet(s) · ${okAccounts}/${receipt.accounts?.length || 0} account(s)`;
    }
  }
  const homeSummary = $('#homeLiveSummary');
  if (homeSummary) {
    const receipt = state.liveReceipt;
    if (!receipt) {
      homeSummary.textContent = 'no live fetch yet';
    } else {
      const okAccounts = receipt.accounts?.filter(a => a.ok).length || 0;
      homeSummary.textContent = `${receipt.tweets?.length || 0} real tweet(s) · ${okAccounts}/${receipt.accounts?.length || 0} account(s)`;
    }
  }
  renderCommandCenter();
}

function approvedUnscheduledDrafts() {
  return state.drafts.filter(draft => (draft.status || 'generated') === 'approved' && !draft.scheduledAt);
}

function generatedDraftBacklog() {
  return state.drafts.filter(draft => ['generated', 'needs-proof'].includes(draft.status || 'generated'));
}

function nextScheduleSlot() {
  const candidates = [
    ...(state.suggestions?.bestForDay || []),
    ...(state.suggestions?.suggestions || [])
  ].filter(item => item?.iso).sort((a, b) => new Date(a.iso) - new Date(b.iso));
  return candidates.find(item => new Date(item.iso) > new Date()) || candidates[0] || null;
}

function commandCenterSnapshot() {
  const selectedCount = state.selectedLiveIds.size + state.queueSelectedIds.size;
  const backlog = generatedDraftBacklog();
  const approved = approvedUnscheduledDrafts();
  const conflicts = state.scheduleQueue?.summary?.conflictCount ?? state.scheduleQueue?.conflicts?.length ?? 0;
  const slot = nextScheduleSlot();
  const warnings = [];
  if (state.config && !state.config.xConfigured) warnings.push('X live reads missing server-side credential.');
  if (state.config?.mockModeForced) warnings.push('Goro is in forced mock mode; do not treat drafts as production generation.');
  if (approved.length && state.config && !state.config.postizConfigured) warnings.push('Approved drafts are waiting, but Postiz credentials are missing so scheduling is safe-blocked.');
  if (conflicts) warnings.push(`${conflicts} schedule conflict(s) inside the current conflict window.`);
  if (state.liveReceipt?.warnings?.length) warnings.push(...state.liveReceipt.warnings);

  let action = { kind: 'fetch', label: 'Fetch inspiration' };
  if ((state.config && !state.config.xConfigured) || state.config?.mockModeForced || (approved.length && state.config && !state.config.postizConfigured)) {
    action = { kind: 'fix-config', label: 'Fix config' };
  } else if (!state.liveReceipt) {
    action = { kind: 'fetch', label: 'Fetch inspiration' };
  } else if (selectedCount > 0) {
    action = { kind: 'rewrite', label: 'Rewrite selected' };
  } else if (backlog.length > 0) {
    action = { kind: 'review', label: 'Review drafts' };
  } else if (approved.length > 0) {
    action = { kind: 'schedule', label: 'Schedule approved draft' };
  }

  return { selectedCount, backlog, approved, conflicts, slot, warnings, action };
}

function setCommandCardState(selector, stateName) {
  const el = document.querySelector(selector);
  if (!el) return;
  el.dataset.health = stateName;
}

function renderCommandCenter() {
  const root = $('#commandCenter');
  if (root) {
    const snap = commandCenterSnapshot();
    const xHealth = state.config
      ? (state.config.xConfigured ? 'read-only ready' : 'server credential missing')
      : 'checking';
    const receipt = state.liveReceipt;
    const fetchedAt = receipt?.fetchedAt ? isoToLocalDisplay(receipt.fetchedAt) : 'no fetch yet';
    const fetchText = receipt ? `${fetchedAt} · ${receipt.tweets?.length || 0} tweet(s)` : 'no live fetch yet';
    const slotText = snap.slot
      ? `${isoToLocalDisplay(snap.slot.iso)} · ${snap.conflicts ? `${snap.conflicts} conflict(s)` : 'clear'}`
      : `${snap.conflicts ? `${snap.conflicts} conflict(s)` : 'no slot loaded'}`;
    setTextIfPresent('#dashXHealth', xHealth);
    setTextIfPresent('#dashLastFetch', fetchText);
    setTextIfPresent('#dashSelectedSources', String(snap.selectedCount));
    setTextIfPresent('#dashDraftBacklog', String(snap.backlog.length));
    setTextIfPresent('#dashApprovedUnscheduled', String(snap.approved.length));
    setTextIfPresent('#dashNextSlot', slotText);
    setTextIfPresent('#commandCenterSummary', `${snap.backlog.length} draft(s) need review, ${snap.approved.length} approved draft(s) need schedule, ${snap.selectedCount} source(s) selected.`);
    const commandAction = $('#commandCenterAction');
    if (commandAction) {
      commandAction.textContent = snap.action.label;
      commandAction.dataset.action = snap.action.kind;
    }
    setTextIfPresent('#nextActionLabel', 'next best action');
    setCommandCardState('[data-state-card="x-live"]', state.config?.xConfigured ? 'ok' : 'warn');
    setCommandCardState('[data-state-card="last-fetch"]', receipt ? 'ok' : 'idle');
    setCommandCardState('[data-state-card="selected"]', snap.selectedCount ? 'ok' : 'idle');
    setCommandCardState('[data-state-card="drafts"]', snap.backlog.length ? 'warn' : 'ok');
    setCommandCardState('[data-state-card="approved"]', snap.approved.length ? 'warn' : 'ok');
    setCommandCardState('[data-state-card="slot"]', snap.conflicts ? 'warn' : (snap.slot ? 'ok' : 'idle'));
    const warningBox = $('#dashWarnings');
    if (warningBox) {
      if (snap.warnings.length) {
        warningBox.className = 'command-warnings';
        warningBox.innerHTML = snap.warnings.map(warning => `<span class="pill warn">${escapeHtml(warning)}</span>`).join('');
      } else {
        warningBox.className = 'command-warnings empty';
        warningBox.textContent = 'No safety/gate warnings. X remains read-only and scheduling still requires approved draft + Postiz credentials.';
      }
    }
  }
  renderContextStatus();
  renderHomeMasonry();
}

function renderContextStatus() {
  const root = $('#contextStatusCard');
  if (!root) return;
  const snap = commandCenterSnapshot();
  const voiceDna = 'loaded'; // Voice DNA is always loaded from file
  const previousPosts = state.drafts.length > 0 ? `${state.drafts.length} drafts` : 'no drafts yet';
  const obsidian = state.contextPacket?.vaultRefs
    ? `${state.contextPacket.vaultRefs.notes?.length || 0} notes · ${state.contextPacket.vaultRefs.scannedFiles || 0} scanned`
    : 'not connected';
  const company = state.contextPacket?.companyRefs
    ? `${state.contextPacket.companyRefs.sources?.length || 0} sources`
    : 'Applied Leverage';
  const sourceBank = state.contextPacket?.sourceBank
    ? `${state.contextPacket.sourceBank.items?.length || 0} sources`
    : (state.sources.length > 0 ? `${state.sources.length} sources` : 'empty');
  const liveX = state.config
    ? (state.config.xConfigured
      ? (state.contextPacket?.liveX?.available
        ? `${state.contextPacket.liveX.tweets?.length || 0} tweets fetched`
        : (state.liveReceipt ? `${state.liveReceipt.tweets?.length || 0} tweets fetched` : 'ready, no fetch'))
      : 'server credential missing')
    : 'checking';

  $('#dashVoiceDna').textContent = voiceDna;
  $('#dashPreviousPosts').textContent = previousPosts;
  $('#dashObsidian').textContent = obsidian;
  $('#dashCompany').textContent = company;
  $('#dashSourceBank').textContent = sourceBank;
  $('#dashLiveX').textContent = liveX;

  setContextTileState('[data-context-tile="voice-dna"]', 'ok');
  setContextTileState('[data-context-tile="previous-posts"]', state.drafts.length > 0 ? 'ok' : 'idle');
  setContextTileState('[data-context-tile="obsidian"]', state.contextPacket?.vaultRefs?.notes?.length > 0 ? 'ok' : (state.contextPacket?.vaultRefs?.warnings?.length > 0 ? 'warn' : 'idle'));
  setContextTileState('[data-context-tile="company"]', state.contextPacket?.companyRefs?.sources?.length > 0 ? 'ok' : 'idle');
  setContextTileState('[data-context-tile="source-bank"]', (state.contextPacket?.sourceBank?.items?.length || state.sources.length) > 0 ? 'ok' : 'idle');
  setContextTileState('[data-context-tile="live-x"]', state.config?.xConfigured ? (state.contextPacket?.liveX?.available || state.liveReceipt ? 'ok' : 'idle') : 'warn');

  const warningBox = $('#contextWarnings');
  if (warningBox) {
    const warnings = [];
    if (state.config && !state.config.xConfigured) warnings.push('X live reads missing server-side credential.');
    if (state.config?.mockModeForced) warnings.push('Goro is in forced mock mode; do not treat drafts as production generation.');
    if (state.sources.length === 0 && !(state.contextPacket?.sourceBank?.items?.length > 0)) warnings.push('Source bank is empty. Save sources or fetch live tweets before generating.');
    if (state.contextPacket?.warnings?.length) warnings.push(...state.contextPacket.warnings);
    if (warnings.length) {
      warningBox.className = 'context-warnings';
      warningBox.innerHTML = warnings.slice(0, 4).map(warning => `<span class="pill warn">${escapeHtml(warning.slice(0, 120))}${warning.length > 120 ? '…' : ''}</span>`).join('');
      if (warnings.length > 4) warningBox.innerHTML += `<span class="pill">+${warnings.length - 4} more</span>`;
    } else {
      warningBox.className = 'context-warnings empty';
      warningBox.textContent = 'No context warnings. All source channels report ready or idle.';
    }
  }
}

function setContextTileState(selector, stateName) {
  const el = document.querySelector(selector);
  if (!el) return;
  el.dataset.health = stateName;
}

function setTextIfPresent(selector, value) {
  const el = $(selector);
  if (el) el.textContent = value;
}

function renderHomeMasonry() {
  const grid = $('#homeDraftMasonry');
  if (!grid) return;
  const drafts = state.drafts.slice(0, 6); // Show up to 6 on home
  if (!drafts.length) {
    grid.className = 'masonry-grid empty';
    // Show context-specific empty state when the packet is missing or empty.
    const packetMissing = !state.contextPacket;
    const packetWarnings = state.contextPacket?.warnings?.length || 0;
    const xMissing = state.config && !state.config.xConfigured;
    const vaultEmpty = state.contextPacket?.vaultRefs && (state.contextPacket.vaultRefs.notes?.length || 0) === 0;
    let title = 'No drafts yet.';
    let body = 'Generate drafts from context, live tweets, or saved sources. They appear here for review before scheduling.';
    const steps = [];
    if (packetMissing) {
      body = 'Context packet has not been loaded yet. Click "Generate drafts" in the context status card to refresh and generate.';
      steps.push('Wait for the context packet to load (voice DNA, vault, company context).');
      steps.push('Click Generate drafts from the context status card.');
      steps.push('Review candidates, edit, then queue for scheduling.');
    } else if (xMissing) {
      body = 'X live reads are missing server-side credentials. Drafts can still be generated from voice DNA, vault, and saved sources.';
      steps.push('Add operator context in the generation controls.');
      steps.push('Click Generate drafts to build from the context packet.');
      steps.push('Optional: configure the server-side X read credential for live inspiration.');
    } else if (packetWarnings > 0) {
      body = `Context packet loaded with ${packetWarnings} warning(s). Review warnings in the context status card, then generate.`;
      steps.push('Review context warnings above.');
      steps.push('Click Generate drafts to build from available sources.');
      steps.push('Edit candidates before queueing.');
    }
    grid.innerHTML = emptyStateHtml({ title, body, steps });
    return;
  }
  grid.className = 'masonry-grid';
  grid.innerHTML = drafts.map(draft => renderHomeDraftCard(draft)).join('');

  // Wire card actions
  $$('[data-home-edit-draft]').forEach(button => button.addEventListener('click', event => {
    const id = event.currentTarget.dataset.homeEditDraft;
    setSelectedDraftId(id);
    location.hash = '#ready-to-post';
  }));
  $$('[data-home-queue-draft]').forEach(button => button.addEventListener('click', event => {
    const id = event.currentTarget.dataset.homeQueueDraft;
    const draft = state.drafts.find(d => d.id === id);
    if (draft) {
      state.selectedDraftId = draft.id;
      $('#scheduleContent').value = draft.text;
      $('#scheduleDraftId').value = draft.id;
      location.hash = '#queue';
    }
  }));
  $$('[data-home-copy-draft]').forEach(button => button.addEventListener('click', event => {
    const id = event.currentTarget.dataset.homeCopyDraft;
    const draft = state.drafts.find(d => d.id === id);
    if (!draft) return;
    writeClipboard(draft.text).then(() => setStatus($('#homeGenerateStatus'), 'Draft copied.', 'ok')).catch(error => setStatus($('#homeGenerateStatus'), `Copy failed: ${error.message}`, 'error'));
  }));
}

function renderHomeDraftCard(draft) {
  const warnings = draftWarnings(draft.text, draft.warnings);
  const status = draft.status || 'generated';
  const gateStatus = draft.gateStatus || 'clean';
  const gateScore = draft.gateScore !== undefined ? draft.gateScore : 100;
  const gateWarnings = Array.isArray(draft.gateWarnings) ? draft.gateWarnings : [];
  const allWarnings = [...new Set([...warnings, ...gateWarnings])];
  const gateClass = gateStatus === 'blocked' ? 'gate-blocked' : (gateStatus === 'revise' ? 'gate-revise' : (gateStatus === 'needs-proof' ? 'gate-proof' : 'gate-clean'));
  const cleanRefs = (Array.isArray(draft.sourceRefs) ? draft.sourceRefs : []).filter(r =>
    r && !/^(source-bank|live-x|voice\s*dna|context)\b/i.test(r) &&
    !/no sources persisted|fetcher returned|0 tweets|style rules?|forbidden pattern/i.test(r));
  const sourceRefs = cleanRefs.length
    ? `<div class="card-provenance">Inspired by ${escapeHtml(cleanRefs.slice(0, 2).join(' · '))}${cleanRefs.length > 2 ? ` +${cleanRefs.length - 2}` : ''}</div>`
    : '';
  const warningPills = allWarnings.length
    ? `<div class="card-warnings">${allWarnings.slice(0, 2).map(w => `<span class="pill warn">${escapeHtml(w.slice(0, 40))}${w.length > 40 ? '…' : ''}</span>`).join('')}${allWarnings.length > 2 ? `<span class="pill">+${allWarnings.length - 2}</span>` : ''}</div>`
    : '';
  const voiceMatch = draft.voiceMatch && !/voice\s*dna loaded|style rules?|forbidden pattern/i.test(draft.voiceMatch)
    ? `<div class="card-voice-match"><span class="pill ok">${escapeHtml(draft.voiceMatch.slice(0, 80))}${draft.voiceMatch.length > 80 ? '…' : ''}</span></div>`
    : '';
  const rationale = draft.rationale
    ? `<div class="card-rationale"><span class="pill">${escapeHtml(draft.rationale.slice(0, 100))}${draft.rationale.length > 100 ? '…' : ''}</span></div>`
    : '';
  return `
    <article class="masonry-card" data-draft-id="${escapeHtml(draft.id)}">
      <header class="masonry-card-header">
        <div class="masonry-card-author">
          <span class="masonry-avatar">L</span>
          <div>
            <strong>LUCAS</strong>
            <span>@LucasSynnott</span>
          </div>
        </div>
        <div class="masonry-card-badges">
          <span class="pill status-${escapeHtml(status)}">${escapeHtml(status)}</span>
          <span class="pill ${gateClass}">${gateScore}</span>
        </div>
      </header>
      <div class="masonry-card-body">
        <p>${escapeHtml(draft.text)}</p>
      </div>
      <div class="masonry-card-meta">
        <span class="pill">${draft.text.length}/280</span>
        ${sourceRefs}
        ${warningPills}
        ${voiceMatch}
        ${rationale}
      </div>
      <div class="masonry-card-actions">
        <button class="button primary" data-home-edit-draft="${escapeHtml(draft.id)}">Edit post</button>
        <button class="button ghost" data-home-queue-draft="${escapeHtml(draft.id)}" title="Queue">Queue</button>
        <button class="button ghost" data-home-copy-draft="${escapeHtml(draft.id)}" title="Copy">Copy</button>
      </div>
    </article>`;
}

function runCommandCenterAction() {
  const action = $('#commandCenterAction')?.dataset.action || 'fetch';
  if (action === 'fix-config') {
    location.hash = '#settings';
    return;
  }
  if (action === 'rewrite') {
    $('#homeGenerateButton')?.click();
    return;
  }
  if (action === 'review') {
    location.hash = '#ready-to-post';
    return;
  }
  if (action === 'schedule') {
    const draft = approvedUnscheduledDrafts()[0];
    if (draft) {
      state.selectedDraftId = draft.id;
      $('#scheduleContent').value = draft.text || '';
      $('#scheduleDraftId').value = draft.id;
    }
    location.hash = '#queue';
    return;
  }
  location.hash = '#home';
  $('#homeAccountHandles')?.focus();
}

function runHomeGenerateAction() {
  const action = $('#contextGenerateAction')?.dataset.action || 'generate';
  if (action === 'generate') {
    homeGenerateFromContext();
  }
}

async function homeGenerate() {
  const button = $('#homeGenerateButton');
  button.disabled = true;
  setStatus($('#homeGenerateStatus'), 'Goro is drafting…');
  try {
    const payload = {
      inspirationLinks: linksFromHomeInput(),
      context: [$('#homeContext').value.trim(), operatorProfileContext()].filter(Boolean).join('\n\n'),
      tone: $('#homeTone').value.trim(),
      count: Number($('#homeCount').value),
      templateId: $('#homeTemplateSelect').value || undefined,
      selectedSources: state.liveTweets.filter(tweet => state.selectedLiveIds.has(tweet.id)).map(tweetToSelectedSource)
    };
    const response = await fetch('/api/tweet-lab/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Generate failed with HTTP ${response.status}`);
    state.lastResult = data;
    state.drafts = Array.isArray(data.drafts) ? data.drafts : data.candidates.map(candidate => ({ ...candidate, id: `${candidate.id}-${Date.now()}` }));
    renderAdapterBadge(data);
    renderSourcePacket(data);
    renderWarnings(data);
    const promptPreview = $('#promptPreview');
    if (promptPreview) promptPreview.textContent = JSON.stringify({
      adapter: data.adapter,
      mockModeForced: data.mockModeForced,
      goroProfile: data.goroProfile,
      promptPreview: data.promptPreview,
      sourcePacket: data.sourcePacket
    }, null, 2);
    setStatus($('#homeGenerateStatus'), `Generated ${state.drafts.length} candidate(s) via ${data.adapter}.`, 'ok');
    renderDrafts();
    renderHomeMasonry();
  } catch (error) {
    setStatus($('#homeGenerateStatus'), error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

// Context-packet-aware generation: refreshes the combined source packet
// from voice DNA + vault + company + source bank + optional live X, then
// generates grounded tweet candidates with visible sourceRefs and warnings.
async function homeGenerateFromContext() {
  const button = $('#contextGenerateAction');
  const genButton = $('#homeGenerateButton');
  if (button) button.disabled = true;
  if (genButton) genButton.disabled = true;
  setStatus($('#homeGenerateStatus'), 'Refreshing context packet…');
  try {
    // 1. Refresh the context packet from the server.
    const query = $('#homeContext').value.trim() || '';
    const contextRes = await fetch(`/api/tweet-lab/context?query=${encodeURIComponent(query)}&maxVaultNotes=5&maxSources=8${emulateAccountsParam()}`);
    if (!contextRes.ok) {
      const errData = await contextRes.json().catch(() => ({}));
      throw new Error(errData.error || `Context refresh failed with HTTP ${contextRes.status}`);
    }
    const packet = await contextRes.json();
    state.contextPacket = packet;
    renderContextStatus();

    // 2. Build a generation payload that includes the context packet.
    const payload = {
      inspirationLinks: linksFromHomeInput(),
      context: [
        $('#homeContext').value.trim(),
        operatorProfileContext(),
        packet.voiceSummary?.loaded ? `Voice DNA: ${packet.voiceSummary.styleRules?.length || 0} rules, ${packet.voiceSummary.forbiddenPatterns?.length || 0} forbidden patterns.` : '',
        packet.companyRefs?.positioning ? `Company positioning: ${packet.companyRefs.positioning}` : '',
        packet.companyRefs?.sources?.length ? `Company context sources: ${packet.companyRefs.sources.map(source => source.title || source.id || source.type).join(' · ')}` : '',
        packet.vaultRefs?.notes?.length ? `Vault notes: ${packet.vaultRefs.notes.map(n => n.title).join(' · ')}` : '',
        packet.warnings?.length ? `Context warnings: ${packet.warnings.join(' · ')}` : ''
      ].filter(Boolean).join('\n\n'),
      tone: $('#homeTone').value.trim(),
      count: Number($('#homeCount').value),
      templateId: $('#homeTemplateSelect').value || undefined,
      contextSourceRefs: (packet.sourceRefs || []).map(ref => ref.label || ref.id).filter(Boolean),
      contextWarnings: packet.warnings || [],
      selectedSources: [
        ...state.liveTweets.filter(tweet => state.selectedLiveIds.has(tweet.id)).map(tweetToSelectedSource),
        ...(packet.sourceBank?.items || []).map(item => ({
          id: item.id,
          text: item.text,
          author: item.author,
          url: item.url,
          format: item.format,
          sourceType: item.sourceType,
          suggestedAngle: item.tags?.join(', '),
          whyItMayWork: `From source bank; qualityScore=${item.qualityScore ?? 'n/a'}`
        })),
        ...(packet.liveX?.tweets || []).map(t => ({
          id: t.id,
          text: t.text,
          author: t.author,
          url: t.url,
          format: 'live-x',
          sourceType: 'live-x-post',
          suggestedAngle: 'Live X inspiration',
          whyItMayWork: `Fetched at ${packet.liveX?.fetchedAt || 'unknown'}`
        }))
      ]
    };

    setStatus($('#homeGenerateStatus'), 'Goro is drafting from context packet…');
    const response = await fetch('/api/tweet-lab/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Generate failed with HTTP ${response.status}`);

    // Attach context packet provenance to each candidate for UI display.
    // Only real source references are surfaced on cards — internal context
    // diagnostics (source-bank/live-x status lines, voice-DNA rule counts) are
    // kept out of the per-tweet UI; they live on the Settings/health page.
    const candidates = Array.isArray(data.candidates) ? data.candidates : [];
    const isDiagnosticRef = (ref) =>
      !ref ||
      /^(source-bank|live-x|voice\s*dna|context)\b/i.test(ref) ||
      /no sources persisted|fetcher returned|0 tweets|style rules?|forbidden pattern/i.test(ref);
    const packetSourceRefs = (packet.sourceRefs || [])
      .map(ref => ref.label || ref.id)
      .filter(ref => !isDiagnosticRef(ref));
    for (const candidate of candidates) {
      candidate.sourceRefs = [...new Set([...(candidate.sourceRefs || []), ...packetSourceRefs])].filter(ref => !isDiagnosticRef(ref));
      candidate.warnings = [...new Set([...(candidate.warnings || []), ...packet.warnings])];
    }

    state.lastResult = data;
    if (Array.isArray(data.drafts)) {
      state.drafts = data.drafts.map((draft, index) => {
        const candidate = candidates[index] || {};
        return {
          ...draft,
          sourceRefs: candidate.sourceRefs || draft.sourceRefs || [],
          warnings: candidate.warnings || draft.warnings || [],
          voiceMatch: candidate.voiceMatch || draft.voiceMatch,
          rationale: candidate.rationale || draft.rationale
        };
      });
    } else {
      state.drafts = candidates.map(candidate => ({ ...candidate, id: `${candidate.id}-${Date.now()}` }));
    }
    renderAdapterBadge(data);
    renderSourcePacket(data);
    renderWarnings(data);
    const promptPreview = $('#promptPreview');
    if (promptPreview) promptPreview.textContent = JSON.stringify({
      adapter: data.adapter,
      mockModeForced: data.mockModeForced,
      goroProfile: data.goroProfile,
      promptPreview: data.promptPreview,
      sourcePacket: data.sourcePacket
    }, null, 2);
    setStatus($('#homeGenerateStatus'), `Generated ${state.drafts.length} candidate(s) via ${data.adapter} from context packet.`, 'ok');
    renderDrafts();
    renderHomeMasonry();
  } catch (error) {
    setStatus($('#homeGenerateStatus'), error.message, 'error');
  } finally {
    if (button) button.disabled = false;
    if (genButton) genButton.disabled = false;
  }
}

function linksFromHomeInput() {
  return $('#homeInspirationLinks').value.split(/\n|,/).map(link => link.trim()).filter(Boolean);
}

async function homeFetchLiveTweets() {
  const button = $('#homeFetchLiveTweets');
  button.disabled = true;
  setStatus($('#homeLiveStatus'), 'Fetching live X tweets…');
  try {
    const { valid, invalid } = accountInputsFromHomeField();
    if (invalid.length) {
      setStatus($('#homeLiveStatus'), `Invalid handles: ${invalid.map(i => i.input).join(', ')}`, 'error');
    }
    if (!valid.length) {
      setStatus($('#homeLiveStatus'), 'Add at least one valid X account handle.', 'error');
      button.disabled = false;
      return;
    }
    const accounts = valid.map(v => v.username);
    const params = new URLSearchParams({
      accounts: accounts.join(','),
      limit: $('#homeLiveLimit').value || '15',
      excludeReplies: $('#homeExcludeReplies').value || 'true',
      mediaOnly: $('#homeMediaOnly').value || 'false'
    });
    const response = await fetch(`/api/tweet-lab/live/accounts/tweets?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Live fetch failed with HTTP ${response.status}`);
    state.liveTweets = Array.isArray(data.tweets) ? data.tweets : [];
    state.liveAccounts = Array.isArray(data.accounts) ? data.accounts : [];
    state.liveReceipt = {
      fetchedAt: new Date().toISOString(),
      tweets: state.liveTweets,
      accounts: state.liveAccounts,
      warnings: data.warnings || []
    };
    state.selectedLiveIds.clear();
    renderLiveTweets();
    renderHomeLiveTweets();
    renderSelectedLiveList();
    renderHomeSelectedLiveList();
    renderInspiration();
    renderAnalytics();
    renderCommandCenter();
    setStatus($('#homeLiveStatus'), `${state.liveTweets.length} live tweet(s) fetched from ${accounts.join(', ')}.`, 'ok');
  } catch (error) {
    setStatus($('#homeLiveStatus'), error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

// Operator profile (settings page): about-me + topics + accounts-to-emulate.
// Folded into the generation context so drafts reflect the manual profile,
// alongside the server-side Obsidian vault + X voice DNA.
function operatorProfileContext() {
  try {
    const p = JSON.parse(localStorage.getItem('tweetLabOperatorProfile') || '{}');
    const lines = [];
    if (p.aboutMe) lines.push(`About the operator: ${p.aboutMe}`);
    if (p.audience) lines.push(`Audience: ${p.audience}`);
    if (p.topics) lines.push(`Topics to focus on: ${p.topics}`);
    if (Array.isArray(p.emulateAccounts) && p.emulateAccounts.length) {
      lines.push(`Emulate the voice and style of these accounts (do not copy them verbatim): ${p.emulateAccounts.join(', ')}`);
    }
    return lines.length ? `[Operator profile]\n${lines.join('\n')}` : '';
  } catch (e) { return ''; }
}

// Handles the auto-generate context fetch should pull live tweets from:
// the operator-profile "accounts to emulate" plus anything typed into the
// home account-handles field. Returns an `&accounts=` query fragment.
function emulateAccountsParam() {
  try {
    let handles = [];
    const p = JSON.parse(localStorage.getItem('tweetLabOperatorProfile') || '{}');
    if (Array.isArray(p.emulateAccounts)) handles.push(...p.emulateAccounts);
    const field = $('#homeAccountHandles')?.value || '';
    field.split(/[\s,\n]+/).forEach(h => handles.push(h));
    handles = [...new Set(handles.map(h => String(h).replace(/^@+/, '').trim()).filter(Boolean))];
    return handles.length ? `&accounts=${encodeURIComponent(handles.join(','))}` : '';
  } catch (e) { return ''; }
}

function accountInputsFromHomeField() {
  const raw = $('#homeAccountHandles')?.value || '';
  const seen = new Set();
  const valid = [];
  const invalid = [];
  valuesFromList(raw).forEach(item => {
    const parsed = normalizeAccountInput(item);
    if (!parsed) return;
    if (!parsed.valid) { invalid.push(parsed); return; }
    const key = parsed.username.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    valid.push(parsed);
  });
  return { valid, invalid };
}

function renderHomeLiveTweets() {
  const list = $('#homeLiveTweetList');
  if (!list) return;
  renderLiveReceipt();
  renderHomeSelectedLiveList();
  if (!state.liveTweets.length) {
    list.className = 'live-tweet-list empty';
    if (state.liveReceipt?.warnings?.length) {
      list.textContent = state.liveReceipt.warnings.join(' · ');
    } else {
      list.innerHTML = emptyStateHtml({
        title: 'No live tweets fetched yet.',
        body: 'Start with real account handles. This panel only shows server-fetched, read-only X API results · never local demo records.',
        steps: ['Add handles in the generation controls.', 'Click Fetch live tweets.', 'Select a tweet, then Generate.']
      });
    }
    return;
  }
  list.className = 'live-tweet-list';
  list.innerHTML = state.liveTweets.map(tweet => {
    const selected = state.selectedLiveIds.has(tweet.id);
    const avatar = tweet.author?.profileImageUrl
      ? `<img src="${escapeHtml(safeExternalUrl(tweet.author.profileImageUrl))}" alt="${escapeHtml(tweet.author.name || tweet.author.username || 'X account')} profile image" loading="lazy">`
      : `<span class="avatar-fallback">${escapeHtml((tweet.author?.name || tweet.author?.username || '?').slice(0, 1).toUpperCase())}</span>`;
    const media = Array.isArray(tweet.media) && tweet.media.length
      ? `<div class="tweet-media">${tweet.media.map(item => {
          const src = item.url || item.previewImageUrl;
          return src ? `<img src="${escapeHtml(safeExternalUrl(src))}" alt="${escapeHtml(item.altText || `${item.type || 'media'} preview`)}" loading="lazy">` : `<span class="pill">${escapeHtml(item.type || 'media')}</span>`;
        }).join('')}</div>`
      : '';
    const metrics = tweet.metrics
      ? `<span>♥ ${formatMetric(tweet.metrics.likeCount)}</span><span>↻ ${formatMetric(tweet.metrics.repostCount)}</span><span>💬 ${formatMetric(tweet.metrics.replyCount)}</span>`
      : '<span>metrics unavailable</span>';
    return `<article class="tweet-card ${selected ? 'selected' : ''}" data-live-id="${escapeHtml(tweet.id)}">
      <header>
        <div class="tweet-author">${avatar}<div><strong>${escapeHtml(tweet.author?.name || tweet.author?.username || 'Unknown account')}</strong><span>@${escapeHtml(tweet.author?.username || 'unknown')}</span></div></div>
        <span class="pill ok">live X API</span>
      </header>
      <p>${escapeHtml(tweet.text || '(no tweet text returned)')}</p>
      ${media}
      <div class="tweet-meta"><span>${escapeHtml(tweet.createdAt ? new Date(tweet.createdAt).toLocaleString() : 'time unavailable')}</span>${metrics}</div>
      <a class="source-url" href="${escapeHtml(safeExternalUrl(tweet.url))}" target="_blank" rel="noreferrer">${escapeHtml(safeExternalUrl(tweet.url))}</a>
      <div class="tweet-actions">
        <button class="button ghost" data-toggle-live="${escapeHtml(tweet.id)}">${selected ? 'Selected' : 'Select'}</button>
        <button class="button primary" data-rewrite-live="${escapeHtml(tweet.id)}">Rewrite</button>
        <button class="button ghost" data-copy-live="${escapeHtml(tweet.id)}">Copy</button>
        <button class="button ghost" data-save-live="${escapeHtml(tweet.id)}">Save source</button>
      </div>
    </article>`;
  }).join('');
  $$('[data-toggle-live]').forEach(button => button.addEventListener('click', event => toggleLiveSelection(event.currentTarget.dataset.toggleLive)));
  $$('[data-rewrite-live]').forEach(button => button.addEventListener('click', event => rewriteLiveTweet(event.currentTarget.dataset.rewriteLive)));
  $$('[data-copy-live]').forEach(button => button.addEventListener('click', event => copyLiveTweet(event.currentTarget.dataset.copyLive)));
  $$('[data-save-live]').forEach(button => button.addEventListener('click', event => saveLiveTweetSource(event.currentTarget.dataset.saveLive)));
}

function renderHomeSelectedLiveList() {
  const list = $('#homeSelectedLiveList');
  if (!list) return;
  const selected = state.liveTweets.filter(tweet => state.selectedLiveIds.has(tweet.id));
  if (!selected.length) {
    list.className = 'selected-list empty';
    list.innerHTML = emptyStateHtml({
      title: 'No live tweets selected.',
      body: 'Select tweets from the live inspiration panel, then generate drafts from them.',
      steps: ['Fetch real tweets from account handles.', 'Select the strongest source cards.', 'Generate drafts, review, then schedule.']
    });
    return;
  }
  list.className = 'selected-list';
  list.innerHTML = selected.map(tweet => `<div class="selected-row"><strong>@${escapeHtml(tweet.author?.username || 'unknown')}</strong><span>${escapeHtml(tweet.text || '')}</span><button class="button ghost" data-unselect-live="${escapeHtml(tweet.id)}">Remove</button></div>`).join('');
  $$('[data-unselect-live]').forEach(button => button.addEventListener('click', event => {
    state.selectedLiveIds.delete(event.currentTarget.dataset.unselectLive);
    renderLiveTweets();
    renderHomeLiveTweets();
    renderSelectedLiveList();
    renderHomeSelectedLiveList();
  }));
}

function renderHomeAccountChips() {
  const { valid, invalid } = accountInputsFromHomeField();
  const chipRow = $('#homeAccountChips');
  if (!chipRow) return;
  if (!valid.length && !invalid.length) {
    chipRow.className = 'chip-row empty';
    chipRow.textContent = 'Enter handles separated by comma or newline.';
    return;
  }
  chipRow.className = 'chip-row';
  chipRow.innerHTML = [
    ...valid.map(v => `<span class="chip ok">@${escapeHtml(v.username)}</span>`),
    ...invalid.map(i => `<span class="chip warn" title="${escapeHtml(i.error)}">${escapeHtml(i.input)}</span>`)
  ].join('');
}

function homeClearLiveSelection() {
  state.selectedLiveIds.clear();
  renderLiveTweets();
  renderHomeLiveTweets();
  renderSelectedLiveList();
  renderHomeSelectedLiveList();
}

function homeGenerateMore() {
  $('#homeContext').focus();
  window.scrollTo({ top: $('#homeGenerationControls').offsetTop - 80, behavior: 'smooth' });
}

// Fetch the server-side context packet silently (no spinner, no blocking).
// Updates state.contextPacket and re-renders the context status tiles.
async function fetchContextPacketSilently() {
  try {
    const query = $('#homeContext')?.value?.trim() || '';
    const res = await fetch(`/api/tweet-lab/context?query=${encodeURIComponent(query)}&maxVaultNotes=5&maxSources=8${emulateAccountsParam()}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('[context] refresh failed:', err.error || res.status);
      return;
    }
    const packet = await res.json();
    state.contextPacket = packet;
    renderContextStatus();
    renderHomeMasonry();
  } catch (err) {
    console.warn('[context] refresh error:', err.message);
  }
}

function renderLiveTweets() {
  const list = $('#liveTweetList');
  if (!list) return;
  renderLiveReceipt();
  renderSelectedLiveList();
  if (!state.liveTweets.length) {
    list.className = 'live-tweet-list empty';
    if (state.liveReceipt?.warnings?.length) {
      list.textContent = state.liveReceipt.warnings.join(' · ');
    } else {
      list.innerHTML = emptyStateHtml({
        title: 'No live tweets fetched yet.',
        body: 'Start with real account handles. This panel only shows server-fetched, read-only X API results · never local demo records.',
        steps: ['Add handles in the Workbench command surface.', 'Click Fetch live tweets.', 'Select a tweet, then Rewrite or Save source.']
      });
    }
    return;
  }
  list.className = 'live-tweet-list';
  list.innerHTML = state.liveTweets.map(tweet => {
    const selected = state.selectedLiveIds.has(tweet.id);
    const avatar = tweet.author?.profileImageUrl
      ? `<img src="${escapeHtml(safeExternalUrl(tweet.author.profileImageUrl))}" alt="${escapeHtml(tweet.author.name || tweet.author.username || 'X account')} profile image" loading="lazy">`
      : `<span class="avatar-fallback">${escapeHtml((tweet.author?.name || tweet.author?.username || '?').slice(0, 1).toUpperCase())}</span>`;
    const media = Array.isArray(tweet.media) && tweet.media.length
      ? `<div class="tweet-media">${tweet.media.map(item => {
          const src = item.url || item.previewImageUrl;
          return src ? `<img src="${escapeHtml(safeExternalUrl(src))}" alt="${escapeHtml(item.altText || `${item.type || 'media'} preview`)}" loading="lazy">` : `<span class="pill">${escapeHtml(item.type || 'media')}</span>`;
        }).join('')}</div>`
      : '';
    const metrics = tweet.metrics
      ? `<span>♥ ${formatMetric(tweet.metrics.likeCount)}</span><span>↻ ${formatMetric(tweet.metrics.repostCount)}</span><span>💬 ${formatMetric(tweet.metrics.replyCount)}</span>`
      : '<span>metrics unavailable</span>';
    return `<article class="tweet-card ${selected ? 'selected' : ''}" data-live-id="${escapeHtml(tweet.id)}">
      <header>
        <div class="tweet-author">${avatar}<div><strong>${escapeHtml(tweet.author?.name || tweet.author?.username || 'Unknown account')}</strong><span>@${escapeHtml(tweet.author?.username || 'unknown')}</span></div></div>
        <span class="pill ok">live X API</span>
      </header>
      <p>${escapeHtml(tweet.text || '(no tweet text returned)')}</p>
      ${media}
      <div class="tweet-meta"><span>${escapeHtml(tweet.createdAt ? new Date(tweet.createdAt).toLocaleString() : 'time unavailable')}</span>${metrics}</div>
      <a class="source-url" href="${escapeHtml(safeExternalUrl(tweet.url))}" target="_blank" rel="noreferrer">${escapeHtml(safeExternalUrl(tweet.url))}</a>
      <div class="tweet-actions">
        <button class="button ghost" data-toggle-live="${escapeHtml(tweet.id)}">${selected ? 'Selected' : 'Select'}</button>
        <button class="button primary" data-rewrite-live="${escapeHtml(tweet.id)}">Rewrite</button>
        <button class="button ghost" data-copy-live="${escapeHtml(tweet.id)}">Copy</button>
        <button class="button ghost" data-save-live="${escapeHtml(tweet.id)}">Save source</button>
      </div>
    </article>`;
  }).join('');
  $$('[data-toggle-live]').forEach(button => button.addEventListener('click', event => toggleLiveSelection(event.currentTarget.dataset.toggleLive)));
  $$('[data-rewrite-live]').forEach(button => button.addEventListener('click', event => rewriteLiveTweet(event.currentTarget.dataset.rewriteLive)));
  $$('[data-copy-live]').forEach(button => button.addEventListener('click', event => copyLiveTweet(event.currentTarget.dataset.copyLive)));
  $$('[data-save-live]').forEach(button => button.addEventListener('click', event => saveLiveTweetSource(event.currentTarget.dataset.saveLive)));
}


function sourceDate(source) {
  return source.createdAt || source.capturedAt || source.fetchedAt || source.verifiedAt || source.lastUsedAt || null;
}

function timeRangeCutoff(range) {
  const now = Date.now();
  if (range === 'week') return now - 7 * 86400000;
  if (range === 'month') return now - 31 * 86400000;
  if (range === 'quarter') return now - 90 * 86400000;
  return null;
}

function sourceHasMedia(source) {
  if (Array.isArray(source.media) && source.media.length) return true;
  if (source.sourceType === 'media') return true;
  const url = String(source.url || '').toLowerCase();
  const text = String(source.text || '').toLowerCase();
  return /\.(png|jpe?g|gif|webp|mp4|mov)(\?|$)/.test(url) || /\b(image|video|media|screenshot)\b/.test([url, text, ...(source.tags || [])].join(' '));
}

function sourceIsArticle(source) {
  const type = String(source.sourceType || '').toLowerCase();
  const url = String(source.url || '').toLowerCase();
  if (['article', 'note', 'manual'].includes(type)) return true;
  if (type === 'tweet' || type === 'trend' || url.includes('x.com/') || url.includes('twitter.com/')) return false;
  return Boolean(url || source.collection || (source.tags || []).some(tag => /article|note|obsidian|vault|source-note/i.test(tag)));
}

function sourceMatchesInspirationSearch(source, search) {
  if (!search) return true;
  const haystack = [source.url, source.statusId, source.author, source.text, source.sourceType, source.format, source.whySaved, source.collection, source.hookPattern, source.staleReason, source.riskNotes, ...(source.tags || [])].join(' ').toLowerCase();
  return haystack.includes(search);
}

function tweetMatchesInspirationSearch(tweet, search) {
  if (!search) return true;
  const haystack = [tweet.url, tweet.text, tweet.author?.username, tweet.author?.name].join(' ').toLowerCase();
  return haystack.includes(search.replace(/^@/, ''));
}

function metricParts(metrics = {}) {
  const like = metrics.likeCount ?? metrics.likes ?? metrics.like_count ?? metrics.like ?? 0;
  const repost = metrics.repostCount ?? metrics.retweets ?? metrics.reposts ?? metrics.retweet_count ?? 0;
  const reply = metrics.replyCount ?? metrics.replies ?? metrics.reply_count ?? 0;
  const views = metrics.impressionCount ?? metrics.views ?? metrics.impressions ?? null;
  return [
    `♡ ${formatMetric(like)}`,
    `↻ ${formatMetric(repost)}`,
    `💬 ${formatMetric(reply)}`,
    views !== null && views !== undefined ? `▥ ${formatMetric(views)}` : null
  ].filter(Boolean);
}

function sourceInitial(source) {
  return escapeHtml(String(source.author || source.sourceType || 'S').slice(0, 1).toUpperCase());
}

function getInspirationPools() {
  const search = ($('#inspirationSearch')?.value || '').trim().toLowerCase();
  const scope = $('#inspirationSourceScope')?.value || 'all';
  const cutoff = timeRangeCutoff($('#inspirationTimeRange')?.value || 'week');
  const dateOk = value => !cutoff || !value || new Date(value).getTime() >= cutoff;
  const saved = state.sources.filter(source => {
    if (scope === 'live') return false;
    if (scope === 'notes' && !sourceIsArticle(source)) return false;
    if (scope === 'media' && !sourceHasMedia(source)) return false;
    return sourceMatchesInspirationSearch(source, search) && dateOk(sourceDate(source));
  });
  const live = state.liveTweets.filter(tweet => {
    if (scope === 'saved' || scope === 'notes') return false;
    if (scope === 'media' && !(Array.isArray(tweet.media) && tweet.media.length)) return false;
    return tweetMatchesInspirationSearch(tweet, search) && dateOk(tweet.createdAt || tweet.fetchedAt);
  });
  const posts = [
    ...live,
    ...saved.filter(source => !sourceIsArticle(source) && (source.sourceType === 'tweet' || source.sourceType === 'trend' || String(source.url || '').includes('/status/') || !sourceHasMedia(source)))
  ];
  const articles = saved.filter(sourceIsArticle);
  const media = [
    ...live.filter(tweet => Array.isArray(tweet.media) && tweet.media.length),
    ...saved.filter(sourceHasMedia)
  ];
  return { posts, articles, media, saved, live };
}

function renderInspiration() {
  const results = $('#inspirationResults');
  if (!results) return;
  const pools = getInspirationPools();
  $('#inspirationPostsCount').textContent = String(pools.posts.length);
  $('#inspirationArticlesCount').textContent = String(pools.articles.length);
  $('#inspirationMediaCount').textContent = String(pools.media.length);
  $$('[data-inspiration-tab]').forEach(button => button.classList.toggle('active', button.dataset.inspirationTab === state.inspirationTab));
  const items = pools[state.inspirationTab] || [];
  const summary = $('#inspirationResultSummary');
  if (summary) {
    const liveLabel = pools.live.length ? `${pools.live.length} live X result(s)` : 'no live X results loaded';
    summary.textContent = `Showing ${items.length} ${state.inspirationTab} result(s) · ${pools.saved.length} saved source(s) matched · ${liveLabel}`;
  }
  if (!items.length) {
    results.className = 'inspiration-masonry empty';
    const tab = state.inspirationTab;
    const setup = tab === 'articles'
      ? { title: 'No articles or source notes available yet.', body: 'Save Obsidian/source-note/article records in Source tools, or import source bank JSON. This tab will not fabricate article results.', steps: ['Open Source tools.', 'Save a manual note or article URL.', 'Tag it with article, note, vault, or source-note.'] }
      : tab === 'media'
        ? { title: 'No media sources available yet.', body: 'Fetch live X media by selecting Live X accounts and entering handles, or save a media source manually.', steps: ['Set Accounts / sources to Live X accounts.', 'Search @accounts with Live limit.', 'Save useful media-backed posts.'] }
        : { title: 'No posts match this search yet.', body: 'Saved sources and live X account reads appear here. Live X reads require server-side credentials and never expose tokens to browser JavaScript.', steps: ['Search saved sources by keyword.', 'Or set Live X accounts and enter @handles.', 'Save or select useful cards before drafting.'] };
    results.innerHTML = emptyStateHtml(setup);
    return;
  }
  results.className = 'inspiration-masonry';
  results.innerHTML = items.map(item => item.url && item.author?.username ? renderInspirationTweetCard(item) : renderInspirationSourceCard(item)).join('');
  $$('[data-insp-toggle-live]').forEach(button => button.addEventListener('click', event => toggleLiveSelection(event.currentTarget.dataset.inspToggleLive)));
  $$('[data-insp-rewrite-live]').forEach(button => button.addEventListener('click', event => rewriteLiveTweet(event.currentTarget.dataset.inspRewriteLive)));
  $$('[data-insp-copy-live]').forEach(button => button.addEventListener('click', event => copyLiveTweet(event.currentTarget.dataset.inspCopyLive)));
  $$('[data-insp-save-live]').forEach(button => button.addEventListener('click', event => saveLiveTweetSource(event.currentTarget.dataset.inspSaveLive)));
  $$('[data-insp-edit-source]').forEach(button => button.addEventListener('click', event => editSource(event.currentTarget.dataset.inspEditSource)));
  $$('[data-insp-select-source]').forEach(button => button.addEventListener('click', event => toggleInspirationSourceSelection(event.currentTarget.dataset.inspSelectSource)));
}

function renderInspirationTweetCard(tweet) {
  const selected = state.selectedLiveIds.has(tweet.id);
  const avatar = tweet.author?.profileImageUrl
    ? `<img src="${escapeHtml(safeExternalUrl(tweet.author.profileImageUrl))}" alt="${escapeHtml(tweet.author.name || tweet.author.username || 'X account')} profile image" loading="lazy">`
    : `<span>${escapeHtml((tweet.author?.name || tweet.author?.username || '?').slice(0, 1).toUpperCase())}</span>`;
  const media = Array.isArray(tweet.media) && tweet.media.length
    ? `<div class="inspiration-media-strip">${tweet.media.map(item => {
        const src = item.url || item.previewImageUrl;
        return src ? `<img src="${escapeHtml(safeExternalUrl(src))}" alt="${escapeHtml(item.altText || item.type || 'media preview')}" loading="lazy">` : `<span class="pill">${escapeHtml(item.type || 'media')}</span>`;
      }).join('')}</div>` : '';
  return `<article class="inspiration-card ${selected ? 'selected' : ''}">
    <header><div class="inspiration-avatar">${avatar}</div><div><strong>${escapeHtml(tweet.author?.name || tweet.author?.username || 'Unknown')}</strong><span>@${escapeHtml(tweet.author?.username || 'unknown')} · ${escapeHtml(tweet.createdAt ? new Date(tweet.createdAt).toLocaleDateString() : 'date unavailable')}</span></div></header>
    <p>${escapeHtml(tweet.text || '(no tweet text returned)')}</p>
    ${media}
    <a class="more-link" href="${escapeHtml(safeExternalUrl(tweet.url))}" target="_blank" rel="noreferrer">More »</a>
    <div class="inspiration-metrics">${metricParts(tweet.metrics).map(m => `<span>${escapeHtml(m)}</span>`).join('')}</div>
    <div class="inspiration-source-row"><span class="pill ok">live X API</span><a href="${escapeHtml(safeExternalUrl(tweet.url))}" target="_blank" rel="noreferrer">source URL</a></div>
    <div class="tweet-actions compact"><button class="button ghost" data-insp-toggle-live="${escapeHtml(tweet.id)}">${selected ? 'Selected' : 'Select'}</button><button class="button primary" data-insp-rewrite-live="${escapeHtml(tweet.id)}">Rewrite</button><button class="button ghost" data-insp-copy-live="${escapeHtml(tweet.id)}">Copy</button><button class="button ghost" data-insp-save-live="${escapeHtml(tweet.id)}">Save source</button></div>
  </article>`;
}

function renderInspirationSourceCard(source) {
  const selected = state.queueSelectedIds.has(source.id);
  const metrics = metricParts(source.engagement || {});
  const tags = Array.isArray(source.tags) ? source.tags : [];
  const date = sourceDate(source);
  const sourceUrl = source.url ? `<a class="more-link" href="${escapeHtml(safeExternalUrl(source.url))}" target="_blank" rel="noreferrer">More »</a>` : '<span class="more-link muted">More unavailable</span>';
  const media = sourceHasMedia(source) && source.url ? `<div class="inspiration-media-placeholder">Media/source preview available at URL</div>` : '';
  return `<article class="inspiration-card ${selected ? 'selected' : ''}">
    <header><div class="inspiration-avatar"><span>${sourceInitial(source)}</span></div><div><strong>${escapeHtml(source.author || 'saved source')}</strong><span>${escapeHtml(source.sourceType || 'source')} · ${escapeHtml(date ? new Date(date).toLocaleDateString() : 'saved record')}</span></div></header>
    <p>${escapeHtml(source.text || source.whySaved || '(no source text saved)')}</p>
    ${media}
    ${sourceUrl}
    <div class="inspiration-metrics">${metrics.length ? metrics.map(m => `<span>${escapeHtml(m)}</span>`).join('') : '<span>metrics unavailable</span>'}</div>
    <div class="inspiration-source-row"><span class="pill">${escapeHtml(source.sourceType || 'saved')}</span>${isLocalDemo(source) ? demoPill() : ''}${tags.slice(0, 3).map(tag => `<span class="pill">${escapeHtml(tag)}</span>`).join('')}</div>
    <div class="tweet-actions compact"><button class="button ghost" data-insp-select-source="${escapeHtml(source.id)}">${selected ? 'Selected' : 'Select'}</button><button class="button ghost" data-insp-edit-source="${escapeHtml(source.id)}">Edit</button></div>
  </article>`;
}

function toggleInspirationSourceSelection(id) {
  const source = state.sources.find(item => item.id === id);
  if (!source) return;
  if (!state.queue.some(item => item.id === id)) state.queue.push(source);
  if (state.queueSelectedIds.has(id)) state.queueSelectedIds.delete(id);
  else state.queueSelectedIds.add(id);
  renderQueue();
  renderInspiration();
}

async function runInspirationSearch() {
  const search = ($('#inspirationSearch')?.value || '').trim();
  const scope = $('#inspirationSourceScope')?.value || 'all';
  if (scope === 'live') {
    const handles = valuesFromList(search).filter(item => item.startsWith('@') || /^[A-Za-z0-9_]{1,15}$/.test(item));
    if (handles.length) {
      $('#accountHandles').value = handles.join(', ');
      if ($('#liveLimit') && $('#inspirationLiveLimit')) $('#liveLimit').value = $('#inspirationLiveLimit').value;
      await fetchLiveTweets();
      renderInspiration();
      return;
    }
    setStatus($('#queueStatus'), 'Enter one or more X handles in the search bar for live X account search.', 'error');
    renderInspiration();
    return;
  }
  setStatus($('#queueStatus'), `Filtered ${state.inspirationTab} inspiration locally.`, 'ok');
  renderInspiration();
}

function toggleLiveSelection(id) {
  if (state.selectedLiveIds.has(id)) state.selectedLiveIds.delete(id);
  else state.selectedLiveIds.add(id);
  renderLiveTweets();
}

async function fetchLiveTweets() {
  const button = $('#fetchLiveTweets');
  if (button) button.disabled = true;
  setStatus($('#liveStatus'), 'Fetching real X account tweets…');
  renderAccountChips();
  try {
    const { valid, invalid } = accountInputsFromField();
    if (!valid.length) throw new Error(invalid.length ? 'No valid account handles to fetch.' : 'Add at least one X account handle.');
    const response = await fetch('/api/tweet-lab/live/accounts/tweets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        accounts: valid.map(item => item.username),
        limitPerAccount: Number($('#liveLimit').value || 10),
        excludeReplies: $('#excludeReplies').value !== 'false',
        mediaOnly: $('#mediaOnly').value === 'true',
        queryContext: $('#context').value.trim()
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Live fetch failed with HTTP ${response.status}`);
    state.liveReceipt = data;
    state.liveTweets = Array.isArray(data.tweets) ? data.tweets : [];
    state.selectedLiveIds = new Set([...state.selectedLiveIds].filter(id => state.liveTweets.some(t => t.id === id)));
    renderLiveTweets();
    renderInspiration();
    const warningSuffix = data.warnings?.length ? ` Warnings: ${data.warnings.join(' · ')}` : '';
    setStatus($('#liveStatus'), `Fetched ${state.liveTweets.length} real tweet(s) from ${data.accounts?.length || valid.length} account(s).${warningSuffix}`, 'ok');
  } catch (error) {
    setStatus($('#liveStatus'), error.message, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const area = document.createElement('textarea');
  area.value = text;
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  return ok;
}

async function copyLiveTweet(id) {
  const tweet = state.liveTweets.find(item => item.id === id);
  if (!tweet) return;
  try {
    await writeClipboard(`${tweet.text}\n${tweet.url}`);
    setStatus($('#liveStatus'), 'Copied tweet text + source URL.', 'ok');
  } catch (error) {
    setStatus($('#liveStatus'), `Copy failed: ${error.message}`, 'error');
  }
}

async function saveLiveTweetSource(id) {
  const tweet = state.liveTweets.find(item => item.id === id);
  if (!tweet) return;
  try {
    const response = await fetch('/api/tweet-lab/store/sources', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(tweetToSelectedSource(tweet))
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Save failed with HTTP ${response.status}`);
    await loadSources();
    setStatus($('#liveStatus'), `Saved @${tweet.author?.username || 'account'} tweet to Inspiration Bank.`, 'ok');
  } catch (error) {
    setStatus($('#liveStatus'), error.message, 'error');
  }
}

async function rewriteLiveTweet(id) {
  const tweet = state.liveTweets.find(item => item.id === id);
  if (!tweet) return;
  const button = document.querySelector(`[data-rewrite-live="${escapeHtml(id)}"]`);
  if (button) { button.disabled = true; button.textContent = 'Rewriting…'; }
  setStatus($('#liveStatus'), 'Rewriting tweet via Goro…');
  try {
    const payload = {
      sourceTweet: tweetToSelectedSource(tweet),
      context: $('#context').value.trim(),
      tone: $('#tone').value.trim(),
      count: Number($('#count').value),
      templateId: $('#templateSelect').value || undefined
    };
    const response = await fetch('/api/tweet-lab/rewrite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Rewrite failed with HTTP ${response.status}`);
    state.lastResult = data;
    state.drafts = Array.isArray(data.drafts) ? data.drafts : data.candidates.map(candidate => ({ ...candidate, id: `${candidate.id}-${Date.now()}` }));
    renderAdapterBadge(data);
    renderSourcePacket(data);
    renderWarnings(data);
    $('#promptPreview').textContent = JSON.stringify({
      adapter: data.adapter,
      mockModeForced: data.mockModeForced,
      goroProfile: data.goroProfile,
      promptPreview: data.promptPreview,
      sourceTweet: data.sourceTweet
    }, null, 2);
    setStatus($('#liveStatus'), `Rewrote ${state.drafts.length} candidate(s) via ${data.adapter}.`, 'ok');
    renderDrafts();
    location.hash = '#ready-to-post';
  } catch (error) {
    setStatus($('#liveStatus'), error.message, 'error');
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Rewrite'; }
  }
}

function parseJsonObject(value, fieldName) {
  const raw = String(value || '').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed;
  } catch {
    throw new Error(`${fieldName} must be a JSON object.`);
  }
}

function sourceStatusFromUrl(url) {
  const match = String(url || '').match(/\/status\/(\d+)/);
  return match ? match[1] : '';
}

function sourcePayloadFromForm() {
  const url = $('#sourceUrl').value.trim();
  const text = $('#sourceText').value.trim();
  const sourceType = $('#sourceType').value;
  if (!url && !text) throw new Error('Add a source URL or manual note text.');
  return {
    url,
    statusId: $('#sourceStatusId').value.trim() || sourceStatusFromUrl(url),
    author: $('#sourceAuthor').value.trim(),
    text,
    sourceType,
    tags: valuesFromList($('#sourceTags').value),
    format: $('#sourceFormat').value,
    whySaved: $('#sourceWhySaved').value.trim(),
    collection: $('#sourceCollection').value.trim() || undefined,
    qualityScore: $('#sourceQualityScore').value ? Number($('#sourceQualityScore').value) : undefined,
    hookPattern: $('#sourceHookPattern').value.trim() || undefined,
    stale: $('#sourceStale').value === '' ? undefined : $('#sourceStale').value === 'true',
    staleReason: $('#sourceStaleReason').value.trim() || undefined,
    riskNotes: $('#sourceRiskNotes').value.trim() || undefined,
    engagement: parseJsonObject($('#sourceEngagement').value, 'Engagement JSON'),
    warnings: valuesFromList($('#sourceWarnings').value)
  };
}

function resetSourceForm() {
  $('#sourceId').value = '';
  $('#sourceUrl').value = '';
  $('#sourceStatusId').value = '';
  $('#sourceAuthor').value = '';
  $('#sourceText').value = '';
  $('#sourceType').value = 'tweet';
  $('#sourceTags').value = '';
  $('#sourceFormat').value = '';
  $('#sourceWhySaved').value = '';
  $('#sourceCollection').value = '';
  $('#sourceQualityScore').value = '';
  $('#sourceHookPattern').value = '';
  $('#sourceStale').value = '';
  $('#sourceStaleReason').value = '';
  $('#sourceRiskNotes').value = '';
  $('#sourceEngagement').value = '{}';
  $('#sourceWarnings').value = '';
  $('#saveSource').textContent = 'Save source';
}

function computeSourceHints(source, allSources) {
  const hints = [];
  const now = Date.now();
  const createdAt = source.createdAt ? new Date(source.createdAt).getTime() : null;
  const capturedAt = source.capturedAt ? new Date(source.capturedAt).getTime() : null;
  const ageMs = createdAt || capturedAt ? now - Math.max(createdAt || 0, capturedAt || 0) : null;
  const ageDays = ageMs ? Math.round(ageMs / 86400000) : null;

  if (ageDays !== null && ageDays > 90) hints.push({ type: 'stale', text: `Saved ${ageDays} days ago · may be outdated.` });
  if (!source.url && !source.text) hints.push({ type: 'risk', text: 'Missing URL and text · source is empty.' });
  else if (!source.url) hints.push({ type: 'risk', text: 'No URL · cannot verify origin.' });
  else if (!source.text) hints.push({ type: 'risk', text: 'No text saved · only URL reference.' });
  if (!source.author) hints.push({ type: 'risk', text: 'Missing author attribution.' });

  const hasMetrics = source.engagement && typeof source.engagement === 'object' && Object.keys(source.engagement).length > 0;
  const verified = source.verifiedAt || (source.sourceType === 'tweet' && source.statusId);
  if (hasMetrics && !verified) hints.push({ type: 'risk', text: 'Engagement metrics present but source is unverified.' });

  if (allSources && source.url) {
    const dupes = allSources.filter(s => s.id !== source.id && s.url === source.url);
    if (dupes.length) hints.push({ type: 'risk', text: `Duplicate URL: ${dupes.length} other source(s) share this link.` });
  }
  if (allSources && source.statusId) {
    const dupes = allSources.filter(s => s.id !== source.id && s.statusId === source.statusId);
    if (dupes.length) hints.push({ type: 'risk', text: `Duplicate status ID: ${dupes.length} other source(s) share this ID.` });
  }

  if (source.stale === true) hints.push({ type: 'stale', text: `Marked stale: ${source.staleReason || 'no reason given'}` });
  if (source.riskNotes) hints.push({ type: 'risk', text: `Risk note: ${source.riskNotes}` });
  if (source.qualityScore === 1) hints.push({ type: 'weak', text: 'Quality score: 1 · weak source.' });
  if (source.qualityScore === 5) hints.push({ type: 'strong', text: 'Quality score: 5 · strong source.' });

  return hints;
}

function matchesSourceFilters(source) {
  const search = $('#sourceSearch').value.trim().toLowerCase();
  const tag = $('#sourceTagFilter').value.trim().toLowerCase();
  const author = $('#sourceAuthorFilter').value.trim().toLowerCase();
  const format = $('#sourceFormatFilter').value;
  const collection = $('#sourceCollectionFilter').value.trim().toLowerCase();
  const minQuality = $('#sourceMinQualityFilter').value;
  const hookPattern = $('#sourceHookPatternFilter').value.trim().toLowerCase();
  const staleFilter = $('#sourceStaleFilter').value;
  const haystack = [source.url, source.statusId, source.author, source.text, source.sourceType, source.format, source.whySaved, source.collection, source.hookPattern, source.staleReason, source.riskNotes, ...(source.tags || [])]
    .join(' ')
    .toLowerCase();
  if (search && !haystack.includes(search)) return false;
  if (tag && !(source.tags || []).some(item => String(item).toLowerCase().includes(tag))) return false;
  if (author && !String(source.author || '').toLowerCase().includes(author)) return false;
  if (format && source.format !== format) return false;
  if (collection && !String(source.collection || '').toLowerCase().includes(collection)) return false;
  if (minQuality && (source.qualityScore || 0) < Number(minQuality)) return false;
  if (hookPattern && !String(source.hookPattern || '').toLowerCase().includes(hookPattern)) return false;
  if (staleFilter === 'fresh' && source.stale === true) return false;
  if (staleFilter === 'stale' && source.stale !== true) return false;
  return true;
}

function sortSources(sources) {
  const sortBy = $('#sourceSortBy').value || 'newest';
  const sorted = [...sources];
  if (sortBy === 'newest') {
    sorted.sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });
  } else if (sortBy === 'quality') {
    sorted.sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0));
  } else if (sortBy === 'stale') {
    sorted.sort((a, b) => {
      const sa = a.stale === true ? 1 : a.stale === false ? -1 : 0;
      const sb = b.stale === true ? 1 : b.stale === false ? -1 : 0;
      return sb - sa;
    });
  }
  return sorted;
}

function renderSources() {
  const list = $('#sourceList');
  let filtered = state.sources.filter(matchesSourceFilters);
  filtered = sortSources(filtered);
  if (!filtered.length) {
    list.className = 'source-list empty';
    list.innerHTML = state.sources.length
      ? emptyStateHtml({ title: 'No sources match these filters.', body: 'Clear search, tag, author, format, collection, or quality filters to restore the saved source bank.' })
      : emptyStateHtml({
          title: 'No saved sources yet.',
          body: 'Fastest path: fetch real tweets in Workbench, save the useful ones, then build a daily source queue here. Optional local examples are labeled demo and never count as live X data.',
          steps: ['Fetch account tweets in Workbench.', 'Click Save source on a live tweet.', 'Build queue, select sources, and generate drafts.'],
          actions: ['<button class="button ghost" data-empty-action="seed-sources">Seed local example sources</button>']
        });
    $$('[data-empty-action="seed-sources"]').forEach(button => button.addEventListener('click', seedDemoSources));
    renderInspiration();
    return;
  }
  list.className = 'source-list';
  list.innerHTML = filtered.map(source => {
    const tags = Array.isArray(source.tags) ? source.tags : [];
    const warnings = Array.isArray(source.warnings) ? source.warnings : [];
    const hints = computeSourceHints(source, state.sources);
    const qualityLabel = source.qualityScore ? `★ ${source.qualityScore}` : '';
    const staleBadge = source.stale === true ? '<span class="pill stale">stale</span>' : source.stale === false ? '<span class="pill fresh">fresh</span>' : '';
    const collectionBadge = source.collection ? `<span class="pill collection">${escapeHtml(source.collection)}</span>` : '';
    const hookBadge = source.hookPattern ? `<span class="pill hook">${escapeHtml(source.hookPattern)}</span>` : '';
    const demoBadge = isLocalDemo(source) ? demoPill() : '';
    const useMeta = source.useCount ? `used ${source.useCount}×` + (source.lastUsedAt ? ` · ${new Date(source.lastUsedAt).toLocaleDateString()}` : '') : '';
    return `
      <article class="source-card ${source.stale === true ? 'stale-card' : ''}" data-id="${escapeHtml(source.id)}">
        <header>
          <div>
            <strong>${escapeHtml(source.author || 'unknown author')}</strong>
            <span>${escapeHtml(source.sourceType || 'source')}${source.format ? ` · ${escapeHtml(source.format)}` : ''}${qualityLabel ? ` · ${escapeHtml(qualityLabel)}` : ''}${useMeta ? ` · ${escapeHtml(useMeta)}` : ''}</span>
          </div>
          <div class="source-actions">
            <button class="button ghost" data-edit-source="${escapeHtml(source.id)}">Edit</button>
            <button class="button ghost danger" data-delete-source="${escapeHtml(source.id)}">Delete</button>
          </div>
        </header>
        ${source.url ? `<a class="source-url" href="${escapeHtml(safeExternalUrl(source.url))}" target="_blank" rel="noreferrer">${escapeHtml(safeExternalUrl(source.url))}</a>` : ''}
        <p>${escapeHtml(source.text || '(no source text saved)')}</p>
        ${source.whySaved ? `<p class="source-why">Why saved: ${escapeHtml(source.whySaved)}</p>` : ''}
        ${hints.length ? `<div class="source-hints">${hints.map(h => `<span class="hint ${escapeHtml(h.type)}">${escapeHtml(h.text)}</span>`).join('')}</div>` : ''}
        <div class="draft-meta">
          ${collectionBadge}
          ${hookBadge}
          ${staleBadge}
          ${demoBadge}
          ${tags.map(tag => `<span class="pill">${escapeHtml(tag)}</span>`).join('')}
          ${warnings.map(warning => `<span class="pill warn">${escapeHtml(warning)}</span>`).join('')}
        </div>
      </article>`;
  }).join('');
  $$('[data-edit-source]').forEach(button => button.addEventListener('click', event => editSource(event.target.dataset.editSource)));
  $$('[data-delete-source]').forEach(button => button.addEventListener('click', event => deleteSource(event.target.dataset.deleteSource)));
  renderInspiration();
}

async function loadSources() {
  try {
    const response = await fetch('/api/tweet-lab/store/sources');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Source load failed with HTTP ${response.status}`);
    state.sources = Array.isArray(data) ? data : [];
    if (typeof networkState !== 'undefined') networkState.sources = state.sources;
    renderSources();
    renderAnalytics();
    if (typeof renderListSeedPreview === 'function') renderListSeedPreview();
  } catch (error) {
    setStatus($('#sourceStatus'), error.message, 'error');
  }
}

async function loadTemplates() {
  try {
    const response = await fetch('/api/tweet-lab/store/templates');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Template load failed with HTTP ${response.status}`);
    state.templates = Array.isArray(data) ? data : [];
    renderTemplates();
    populateTemplateSelect();
    renderRecipeCardSelector();
  } catch (error) {
    setStatus($('#templateStatus'), error.message, 'error');
  }
}

function populateTemplateSelect() {
  const select = $('#templateSelect');
  if (select) {
    const current = select.value;
    select.innerHTML = '<option value="">none</option>' +
      state.templates.map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name || t.id)}</option>`).join('');
    if (state.templates.some(t => t.id === current)) select.value = current;
  }
  const homeSelect = $('#homeTemplateSelect');
  if (homeSelect) {
    const homeCurrent = homeSelect.value;
    homeSelect.innerHTML = '<option value="">none</option>' +
      state.templates.map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name || t.id)}</option>`).join('');
    if (state.templates.some(t => t.id === homeCurrent)) homeSelect.value = homeCurrent;
  }
}

function renderRecipeCardSelector() {
  const container = $('#recipeCardSelector');
  if (!container) return;
  const selectedId = $('#templateSelect').value;
  if (!state.templates?.length) {
    container.className = 'recipe-card-selector empty';
    container.innerHTML = 'No templates saved yet. Save recipes in the Library.';
    return;
  }
  container.className = 'recipe-card-selector';
  container.innerHTML = state.templates.map(template => {
    const isSelected = template.id === selectedId;
    const recipeFields = [];
    if (template.intent) recipeFields.push({ label: 'Intent', value: template.intent });
    if (template.whenToUse) recipeFields.push({ label: 'When', value: template.whenToUse });
    if (template.constraints) recipeFields.push({ label: 'Constraints', value: template.constraints });
    return `
      <article class="recipe-mini-card ${isSelected ? 'selected' : ''}" data-recipe-id="${escapeHtml(template.id)}">
        <header>
          <strong>${escapeHtml(template.name || 'untitled')}</strong>
          <button class="button ghost small" data-use-recipe="${escapeHtml(template.id)}">${isSelected ? 'Selected' : 'Use'}</button>
        </header>
        <p class="recipe-body">${escapeHtml(template.body)}</p>
        ${recipeFields.length ? `<div class="recipe-mini-fields">${recipeFields.map(f => `<span class="recipe-mini-label">${escapeHtml(f.label)}:</span> ${escapeHtml(f.value)}`).join(' · ')}</div>` : ''}
      </article>`;
  }).join('');
  $$('[data-use-recipe]').forEach(button => button.addEventListener('click', event => useRecipe(event.target.dataset.useRecipe)));
  $$('.recipe-mini-card').forEach(card => card.addEventListener('click', event => {
    if (event.target.closest('button')) return;
    const id = card.dataset.recipeId;
    if (id) useRecipe(id);
  }));
}

function renderHomeRecipeCardSelector() {
  const container = $('#homeRecipeCardSelector');
  if (!container) return;
  const selectedId = $('#homeTemplateSelect').value;
  if (!state.templates?.length) {
    container.className = 'recipe-card-selector empty';
    container.innerHTML = 'No templates saved yet. Save recipes in the Library.';
    return;
  }
  container.className = 'recipe-card-selector';
  container.innerHTML = state.templates.map(template => {
    const isSelected = template.id === selectedId;
    const recipeFields = [];
    if (template.intent) recipeFields.push({ label: 'Intent', value: template.intent });
    if (template.whenToUse) recipeFields.push({ label: 'When', value: template.whenToUse });
    if (template.constraints) recipeFields.push({ label: 'Constraints', value: template.constraints });
    return `
      <article class="recipe-mini-card ${isSelected ? 'selected' : ''}" data-recipe-id="${escapeHtml(template.id)}">
        <header>
          <strong>${escapeHtml(template.name || 'untitled')}</strong>
          <button class="button ghost small" data-use-home-recipe="${escapeHtml(template.id)}">${isSelected ? 'Selected' : 'Use'}</button>
        </header>
        <p class="recipe-body">${escapeHtml(template.body)}</p>
        ${recipeFields.length ? `<div class="recipe-mini-fields">${recipeFields.map(f => `<span class="recipe-mini-label">${escapeHtml(f.label)}:</span> ${escapeHtml(f.value)}`).join(' · ')}</div>` : ''}
      </article>`;
  }).join('');
  $$('[data-use-home-recipe]').forEach(button => button.addEventListener('click', event => useHomeRecipe(event.target.dataset.useHomeRecipe)));
  $$('.recipe-mini-card').forEach(card => card.addEventListener('click', event => {
    if (event.target.closest('button')) return;
    const id = card.dataset.recipeId;
    if (id) useHomeRecipe(id);
  }));
}

function useHomeRecipe(id) {
  const template = state.templates.find(t => t.id === id);
  if (!template) return;
  $('#homeTemplateSelect').value = id;
  renderHomeRecipeCardSelector();
  setStatus($('#homeGenerateStatus'), `Recipe selected: ${template.name}. Select sources and generate.`, 'ok');
  $('#homeGenerateButton').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function templatePayloadFromForm() {
  const name = $('#templateName').value.trim();
  const body = $('#templateBody').value.trim();
  if (!name) throw new Error('Template name is required.');
  if (!body) throw new Error('Template body is required.');
  return {
    name,
    body,
    tags: valuesFromList($('#templateTags').value),
    formats: valuesFromList($('#templateFormats').value),
    note: $('#templateNote').value.trim(),
    intent: $('#templateIntent').value.trim() || undefined,
    whenToUse: $('#templateWhenToUse').value.trim() || undefined,
    constraints: $('#templateConstraints').value.trim() || undefined,
    exampleOutput: $('#templateExampleOutput').value.trim() || undefined,
    sourceRequirements: $('#templateSourceRequirements').value.trim() || undefined,
    forbiddenPatterns: $('#templateForbiddenPatterns').value.trim() || undefined
  };
}

function resetTemplateForm() {
  $('#templateId').value = '';
  $('#templateName').value = '';
  $('#templateBody').value = '';
  $('#templateTags').value = '';
  $('#templateFormats').value = '';
  $('#templateNote').value = '';
  $('#templateIntent').value = '';
  $('#templateWhenToUse').value = '';
  $('#templateConstraints').value = '';
  $('#templateExampleOutput').value = '';
  $('#templateSourceRequirements').value = '';
  $('#templateForbiddenPatterns').value = '';
  $('#saveTemplate').textContent = 'Save template';
}

function matchesTemplateFilters(template) {
  const search = $('#templateSearch').value.trim().toLowerCase();
  const tag = $('#templateTagFilter').value.trim().toLowerCase();
  const format = $('#templateFormatFilter').value.trim().toLowerCase();
  const haystack = [
    template.name, template.body, template.note,
    template.intent, template.whenToUse, template.constraints,
    template.exampleOutput, template.sourceRequirements, template.forbiddenPatterns,
    ...(template.tags || []), ...(template.formats || [])
  ].join(' ').toLowerCase();
  if (search && !haystack.includes(search)) return false;
  if (tag && !(template.tags || []).some(t => String(t).toLowerCase().includes(tag))) return false;
  if (format && !(template.formats || []).some(f => String(f).toLowerCase().includes(format))) return false;
  return true;
}

function renderTemplates() {
  const list = $('#templateList');
  const filtered = (state.templates || []).filter(matchesTemplateFilters);
  if (!filtered.length) {
    list.className = 'source-list empty';
    list.innerHTML = state.templates?.length
      ? emptyStateHtml({ title: 'No templates match these filters.', body: 'Clear search, tag, or format filters to see saved drafting recipes.' })
      : emptyStateHtml({
          title: 'No templates saved yet.',
          body: 'Templates constrain Goro rewrites so the selected source becomes a usable draft shape instead of generic output. Local examples are explicitly labeled demo.',
          steps: ['Seed or write a template.', 'Select it in Workbench.', 'Generate drafts from live or saved sources.'],
          actions: ['<button class="button ghost" data-empty-action="seed-templates">Seed local example templates</button>']
        });
    $$('[data-empty-action="seed-templates"]').forEach(button => button.addEventListener('click', seedDemoTemplates));
    return;
  }
  list.className = 'source-list';
  list.innerHTML = filtered.map(template => {
    const tags = Array.isArray(template.tags) ? template.tags : [];
    const formats = Array.isArray(template.formats) ? template.formats : [];
    const demoBadge = isLocalDemo(template) ? demoPill() : '';
    const recipeFields = [];
    if (template.intent) recipeFields.push({ label: 'Intent', value: template.intent });
    if (template.whenToUse) recipeFields.push({ label: 'When to use', value: template.whenToUse });
    if (template.constraints) recipeFields.push({ label: 'Constraints', value: template.constraints });
    if (template.exampleOutput) recipeFields.push({ label: 'Example', value: template.exampleOutput });
    if (template.sourceRequirements) recipeFields.push({ label: 'Source needs', value: template.sourceRequirements });
    if (template.forbiddenPatterns) recipeFields.push({ label: 'Avoid', value: template.forbiddenPatterns });
    return `
      <article class="source-card recipe-card" data-id="${escapeHtml(template.id)}">
        <header>
          <div>
            <strong>${escapeHtml(template.name || 'untitled')}</strong>
            <span>${formats.map(f => escapeHtml(f)).join(' · ') || 'no format'}</span>
          </div>
          <div class="source-actions">
            <button class="button ghost" data-use-recipe="${escapeHtml(template.id)}">Use</button>
            <button class="button ghost" data-edit-template="${escapeHtml(template.id)}">Edit</button>
            <button class="button ghost danger" data-delete-template="${escapeHtml(template.id)}">Delete</button>
          </div>
        </header>
        <p class="template-body">${escapeHtml(template.body)}</p>
        ${template.note ? `<p class="source-why">${escapeHtml(template.note)}</p>` : ''}
        ${recipeFields.length ? `<div class="recipe-fields">${recipeFields.map(f => `<div class="recipe-field"><span class="recipe-label">${escapeHtml(f.label)}</span><p>${escapeHtml(f.value)}</p></div>`).join('')}</div>` : ''}
        <div class="draft-meta">
          ${demoBadge}
          ${tags.map(tag => `<span class="pill">${escapeHtml(tag)}</span>`).join('')}
        </div>
      </article>`;
  }).join('');
  $$('[data-edit-template]').forEach(button => button.addEventListener('click', event => editTemplate(event.target.dataset.editTemplate)));
  $$('[data-delete-template]').forEach(button => button.addEventListener('click', event => deleteTemplate(event.target.dataset.deleteTemplate)));
  $$('[data-use-recipe]').forEach(button => button.addEventListener('click', event => useRecipe(event.target.dataset.useRecipe)));
}

async function saveTemplate() {
  const button = $('#saveTemplate');
  button.disabled = true;
  try {
    const id = $('#templateId').value.trim();
    const payload = templatePayloadFromForm();
    const response = await fetch(id ? `/api/tweet-lab/store/templates/${encodeURIComponent(id)}` : '/api/tweet-lab/store/templates', {
      method: id ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Template save failed with HTTP ${response.status}`);
    setStatus($('#templateStatus'), id ? 'Template updated.' : 'Template saved.', 'ok');
    resetTemplateForm();
    await loadTemplates();
  } catch (error) {
    setStatus($('#templateStatus'), error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

function editTemplate(id) {
  const template = state.templates.find(item => item.id === id);
  if (!template) return;
  $('#templateId').value = template.id;
  $('#templateName').value = template.name || '';
  $('#templateBody').value = template.body || '';
  $('#templateTags').value = (template.tags || []).join(', ');
  $('#templateFormats').value = (template.formats || []).join(', ');
  $('#templateNote').value = template.note || '';
  $('#templateIntent').value = template.intent || '';
  $('#templateWhenToUse').value = template.whenToUse || '';
  $('#templateConstraints').value = template.constraints || '';
  $('#templateExampleOutput').value = template.exampleOutput || '';
  $('#templateSourceRequirements').value = template.sourceRequirements || '';
  $('#templateForbiddenPatterns').value = template.forbiddenPatterns || '';
  $('#saveTemplate').textContent = 'Update template';
  location.hash = '#templates';
  $('#templateName').focus();
}

function useRecipe(id) {
  const template = state.templates.find(item => item.id === id);
  if (!template) return;
  $('#templateSelect').value = id;
  renderRecipeCardSelector();
  setStatus($('#generateStatus'), `Recipe selected: ${template.name}. Select sources and generate.`, 'ok');
  // Scroll to generate button
  $('#generateButton').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function deleteTemplate(id) {
  const response = await fetch(`/api/tweet-lab/store/templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    setStatus($('#templateStatus'), data.error || `Delete failed with HTTP ${response.status}`, 'error');
    return;
  }
  setStatus($('#templateStatus'), 'Template deleted.', 'ok');
  if ($('#templateId').value === id) resetTemplateForm();
  await loadTemplates();
}

async function exportTemplates() {
  try {
    const response = await fetch('/api/tweet-lab/store/templates?export=1');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Export failed with HTTP ${response.status}`);
    $('#templateImportJson').value = JSON.stringify(data, null, 2);
    setStatus($('#templateImportStatus'), `Exported full store with ${data.templates?.length || 0} template(s).`, 'ok');
  } catch (error) {
    setStatus($('#templateImportStatus'), error.message, 'error');
  }
}

async function importTemplates() {
  try {
    const payload = JSON.parse($('#templateImportJson').value || '{}');
    const mode = $('#templateImportMode').value || 'merge';
    const response = await fetch(`/api/tweet-lab/store/templates?import=1&mode=${encodeURIComponent(mode)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Import failed with HTTP ${response.status}`);
    setStatus($('#templateImportStatus'), `Imported store in ${data.mode} mode. Templates: ${data.counts?.templates ?? 0}.`, 'ok');
    await loadTemplates();
  } catch (error) {
    setStatus($('#templateImportStatus'), error.message, 'error');
  }
}

async function saveSource() {
  const button = $('#saveSource');
  button.disabled = true;
  try {
    const id = $('#sourceId').value.trim();
    const payload = sourcePayloadFromForm();
    const response = await fetch(id ? `/api/tweet-lab/store/sources/${encodeURIComponent(id)}` : '/api/tweet-lab/store/sources', {
      method: id ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Source save failed with HTTP ${response.status}`);
    setStatus($('#sourceStatus'), id ? 'Source updated.' : 'Source saved.', 'ok');
    resetSourceForm();
    await loadSources();
  } catch (error) {
    setStatus($('#sourceStatus'), error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

function editSource(id) {
  const source = state.sources.find(item => item.id === id);
  if (!source) return;
  $('#sourceId').value = source.id;
  $('#sourceUrl').value = source.url || '';
  $('#sourceStatusId').value = source.statusId || '';
  $('#sourceAuthor').value = source.author || '';
  $('#sourceText').value = source.text || '';
  $('#sourceType').value = source.sourceType || 'tweet';
  $('#sourceTags').value = (source.tags || []).join(', ');
  $('#sourceFormat').value = source.format || '';
  $('#sourceWhySaved').value = source.whySaved || '';
  $('#sourceCollection').value = source.collection || '';
  $('#sourceQualityScore').value = source.qualityScore != null ? String(source.qualityScore) : '';
  $('#sourceHookPattern').value = source.hookPattern || '';
  $('#sourceStale').value = source.stale === true ? 'true' : source.stale === false ? 'false' : '';
  $('#sourceStaleReason').value = source.staleReason || '';
  $('#sourceRiskNotes').value = source.riskNotes || '';
  $('#sourceEngagement').value = JSON.stringify(source.engagement || {}, null, 2);
  $('#sourceWarnings').value = (source.warnings || []).join(', ');
  $('#saveSource').textContent = 'Update source';
  location.hash = '#bank';
  $('#sourceText').focus();
}

async function deleteSource(id) {
  const response = await fetch(`/api/tweet-lab/store/sources/${encodeURIComponent(id)}`, { method: 'DELETE' });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    setStatus($('#sourceStatus'), data.error || `Delete failed with HTTP ${response.status}`, 'error');
    return;
  }
  setStatus($('#sourceStatus'), 'Source deleted.', 'ok');
  if ($('#sourceId').value === id) resetSourceForm();
  await loadSources();
}

async function exportSources() {
  try {
    const response = await fetch('/api/tweet-lab/store/sources?export=1');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Export failed with HTTP ${response.status}`);
    $('#sourceImportJson').value = JSON.stringify(data, null, 2);
    setStatus($('#sourceImportStatus'), `Exported ${data.sources?.length || 0} source(s).`, 'ok');
  } catch (error) {
    setStatus($('#sourceImportStatus'), error.message, 'error');
  }
}

async function importSources() {
  try {
    const payload = JSON.parse($('#sourceImportJson').value || '{}');
    const mode = $('#sourceImportMode').value || 'merge';
    const response = await fetch(`/api/tweet-lab/store/sources?import=1&mode=${encodeURIComponent(mode)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Import failed with HTTP ${response.status}`);
    setStatus($('#sourceImportStatus'), `Imported store in ${data.mode} mode. Sources: ${data.counts?.sources ?? 0}.`, 'ok');
    await loadSources();
  } catch (error) {
    setStatus($('#sourceImportStatus'), error.message, 'error');
  }
}

function updateMetrics() {
  setTextIfPresent('#draftCount', String(state.drafts.length));
  const warnings = state.drafts.reduce((total, draft) => total + draftWarnings(draft.text, draft.warnings).length, 0);
  setTextIfPresent('#warningCount', String(warnings));
  setTextIfPresent('#scheduleState', state.config?.postizConfigured ? 'ready' : 'safe-blocked');
  renderCommandCenter();
}

function draftWarnings(text, originalWarnings = []) {
  const warnings = [...originalWarnings];
  if (text.length > 280) warnings.push('over 280 characters');
  if (text.length > 260 && text.length <= 280) warnings.push('near character limit');
  if (/\b(\d+[mk]?|\$\d+|%|percent)\b/i.test(text)) warnings.push('contains a metric: verify source before publishing');
  if (/\b(delve|tapestry|moreover)\b/i.test(text)) warnings.push('AI-slop word detected');
  return [...new Set(warnings)];
}

function matchesDraftFilters(draft) {
  const status = $('#draftStatusFilter')?.value || '';
  return !status || draft.status === status;
}

function sortDrafts(drafts) {
  const sort = $('#draftSort')?.value || 'newest';
  const sorted = [...drafts];
  switch (sort) {
    case 'newest':
      sorted.sort((a, b) => (b.createdAt || b.id || '').localeCompare(a.createdAt || a.id || ''));
      break;
    case 'gate-asc':
      sorted.sort((a, b) => (a.gateScore ?? 100) - (b.gateScore ?? 100));
      break;
    case 'gate-desc':
      sorted.sort((a, b) => (b.gateScore ?? 100) - (a.gateScore ?? 100));
      break;
    case 'status':
      sorted.sort((a, b) => (a.status || 'generated').localeCompare(b.status || 'generated'));
      break;
    case 'warning': {
      const severity = draft => {
        const warnings = draftWarnings(draft.text, draft.warnings || []);
        const gateW = draft.gateWarnings || [];
        const all = [...new Set([...warnings, ...gateW])];
        if (all.some(w => w.includes('metric') || w.includes('source'))) return 3;
        if (all.some(w => w.includes('slop') || w.includes('AI'))) return 2;
        if (all.length) return 1;
        return 0;
      };
      sorted.sort((a, b) => severity(b) - severity(a));
      break;
    }
  }
  return sorted;
}

function getSelectedDraftId() {
  return state.selectedDraftId;
}

function setSelectedDraftId(id) {
  state.selectedDraftId = id;
  renderDrafts();
  renderDraftDetail();
}

function renderDraftDetail() {
  const panel = $('#draftDetailPanel');
  const content = $('#detailContent');
  const angleEl = $('#detailAngle');
  if (!panel || !content) return;
  const draft = state.drafts.find(d => d.id === state.selectedDraftId);
  if (!draft) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');
  angleEl.textContent = draft.angle || 'Draft';
  const warnings = draftWarnings(draft.text, draft.warnings);
  const status = draft.status || 'generated';
  const gateStatus = draft.gateStatus || 'clean';
  const gateScore = draft.gateScore !== undefined ? draft.gateScore : 100;
  const gateWarnings = Array.isArray(draft.gateWarnings) ? draft.gateWarnings : [];
  const gateSuggestions = Array.isArray(draft.gateSuggestions) ? draft.gateSuggestions : [];
  const gateClass = gateStatus === 'blocked' ? 'gate-blocked' : (gateStatus === 'revise' ? 'gate-revise' : (gateStatus === 'needs-proof' ? 'gate-proof' : 'gate-clean'));
  const rationale = draft.rationale ? `<div class="draft-rationale">${escapeHtml(draft.rationale)}</div>` : '';
  const sourceRefs = Array.isArray(draft.sourceRefs) && draft.sourceRefs.length
    ? `<div class="draft-sourceRefs">Sources: ${draft.sourceRefs.map(ref => `<code>${escapeHtml(ref)}</code>`).join(' ')}</div>`
    : '';
  const templateInfo = draft.templateId
    ? `<div class="draft-templateInfo">Template: ${escapeHtml(draft.templateName || draft.templateId)}</div>`
    : '';
  const rejectReason = draft.rejectReason ? `<div class="draft-rationale reject-reason">Rejected: ${escapeHtml(draft.rejectReason)}</div>` : '';
  const suggestionHtml = gateSuggestions.length
    ? `<div class="draft-suggestions"><p class="eyebrow">gate suggestions</p>${gateSuggestions.map(s => `<span class="pill suggest">↳ ${escapeHtml(s)}</span>`).join('')}</div>`
    : '';
  content.innerHTML = `
    <div class="draft-detail-meta">
      <span class="pill status-${escapeHtml(status)}">${escapeHtml(status)}</span>
      <span class="pill ${gateClass}">gate: ${escapeHtml(gateStatus)} (${gateScore})</span>
      <span class="pill">${draft.text.length}/280</span>
      ${warnings.length ? warnings.map(w => `<span class="pill warn">${escapeHtml(w)}</span>`).join('') : ''}
      ${gateWarnings.length ? gateWarnings.filter(w => !warnings.includes(w)).map(w => `<span class="pill warn">${escapeHtml(w)}</span>`).join('') : ''}
    </div>
    <textarea id="detailEditor" rows="8">${escapeHtml(draft.text)}</textarea>
    ${rationale}${sourceRefs}${templateInfo}${rejectReason}${suggestionHtml}
    <button type="button" id="detailActionToggle" class="button ghost draft-actions-toggle" aria-expanded="false">Show actions</button>
    <div id="detailActionPack" class="draft-action-pack mobile-collapsed">
      <div class="draft-detail-actions">
        <button class="button ghost" id="detailSave">Save edit</button>
        <button class="button ghost" id="detailReview">Re-run gate</button>
        <button class="button ghost" id="detailNeedsProof">Needs proof</button>
        <button class="button ghost" id="detailApprove">Approve</button>
        <button class="button ghost" id="detailCopy">Copy draft</button>
        <button class="button ghost" id="detailSchedule">Use for schedule</button>
      </div>
      <div class="reject-row">
        <input id="detailRejectReason" placeholder="Reject reason" value="${escapeHtml(draft.rejectReason || '')}">
        <button class="button ghost danger" id="detailReject">Reject</button>
      </div>
    </div>
  `;
  $('#detailActionToggle')?.addEventListener('click', event => {
    const pack = $('#detailActionPack');
    if (!pack) return;
    const collapsed = pack.classList.toggle('mobile-collapsed');
    event.currentTarget.setAttribute('aria-expanded', String(!collapsed));
    event.currentTarget.textContent = collapsed ? 'Show actions' : 'Hide actions';
  });
  const editor = $('#detailEditor');
  if (editor) {
    editor.addEventListener('input', () => {
      draft.text = editor.value;
      const headerSpan = document.querySelector(`.draft-row[data-id="${CSS.escape(draft.id)}"] .draft-row-count`);
      if (headerSpan) headerSpan.textContent = `${editor.value.length}/280`;
    });
  }
  $('#detailSave')?.addEventListener('click', () => saveDraftEdit(draft.id).catch(err => setStatus($('#draftStatus'), err.message, 'error')));
  $('#detailReview')?.addEventListener('click', () => reviewDraftApi(draft.id).catch(err => setStatus($('#draftStatus'), err.message, 'error')));
  $('#detailNeedsProof')?.addEventListener('click', () => needsProofDraft(draft.id).catch(err => setStatus($('#draftStatus'), err.message, 'error')));
  $('#detailApprove')?.addEventListener('click', () => approveDraft(draft.id).catch(err => setStatus($('#draftStatus'), err.message, 'error')));
  $('#detailCopy')?.addEventListener('click', () => {
    writeClipboard(draft.text).then(() => setStatus($('#draftStatus'), 'Draft copied.', 'ok')).catch(err => setStatus($('#draftStatus'), `Copy failed: ${err.message}`, 'error'));
  });
  $('#detailSchedule')?.addEventListener('click', () => {
    state.selectedDraftId = draft.id;
    $('#scheduleContent').value = draft.text;
    $('#scheduleDraftId').value = draft.id;
    location.hash = '#queue';
  });
  $('#detailReject')?.addEventListener('click', () => {
    const reason = $('#detailRejectReason')?.value.trim();
    if (!reason) {
      setStatus($('#draftStatus'), 'Reject reason is required.', 'error');
      return;
    }
    transitionDraft(draft.id, 'rejected', { rejectReason: reason }).catch(err => setStatus($('#draftStatus'), err.message, 'error'));
  });
}

async function loadDrafts() {
  try {
    const response = await fetch('/api/tweet-lab/store/drafts');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Draft load failed with HTTP ${response.status}`);
    state.drafts = Array.isArray(data) ? data : (data.items || []);
    renderDrafts();
    renderHomeMasonry();
    if (!state.contextPacket && (location.hash === '#home' || !location.hash)) {
      fetchContextPacketSilently();
    }
  } catch (error) {
    setStatus($('#draftStatus'), error.message, 'error');
  }
}

async function transitionDraft(id, status, extra = {}) {
  const response = await fetch(`/api/tweet-lab/drafts/${encodeURIComponent(id)}/transition`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status, ...extra })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Draft transition failed with HTTP ${response.status}`);
  setStatus($('#draftStatus'), `Draft moved to ${status}.`, 'ok');
  await loadDrafts();
  return data.draft;
}

async function approveDraft(id) {
  await transitionDraft(id, 'approved');
}

async function needsProofDraft(id) {
  await transitionDraft(id, 'needs-proof');
}

async function rejectDraft(id) {
  const input = $(`[data-reject-reason="${CSS.escape(id)}"]`);
  const rejectReason = input?.value.trim();
  if (!rejectReason) {
    setStatus($('#draftStatus'), 'Reject reason is required.', 'error');
    return;
  }
  await transitionDraft(id, 'rejected', { rejectReason });
}

async function saveDraftEdit(id) {
  const editor = $(`[data-draft-editor="${CSS.escape(id)}"]`);
  const draft = state.drafts.find(item => item.id === id);
  const response = await fetch(`/api/tweet-lab/drafts/${encodeURIComponent(id)}/edit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text: editor?.value || '',
      angle: draft?.angle,
      rationale: draft?.rationale,
      sourceRefs: draft?.sourceRefs,
      warnings: draftWarnings(editor?.value || '', draft?.warnings || [])
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Draft edit failed with HTTP ${response.status}`);
  setStatus($('#draftStatus'), 'Draft edit saved.', 'ok');
  await loadDrafts();
}

async function reviewDraftApi(id) {
  const editor = $(`[data-draft-editor="${CSS.escape(id)}"]`);
  const text = editor?.value;
  const body = text !== undefined ? { text } : {};
  const response = await fetch(`/api/tweet-lab/drafts/${encodeURIComponent(id)}/review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Review gate failed with HTTP ${response.status}`);
  setStatus($('#draftStatus'), `Gate: ${data.status} (score ${data.score}). ${data.warnings?.length || 0} warning(s).`, data.status === 'clean' ? 'ok' : '');
  await loadDrafts();
}

function selectDraftForSchedule(draft, { statusTarget = $('#scheduleStatus') } = {}) {
  if (!draft) return;
  state.selectedDraftId = draft.id;
  $('#scheduleContent').value = draft.text || '';
  $('#scheduleDraftId').value = draft.id;
  if (statusTarget) {
    const refs = Array.isArray(draft.sourceRefs) ? draft.sourceRefs.length : 0;
    setStatus(statusTarget, `Loaded approved draft ${draft.id} (${(draft.text || '').length}/280, ${draft.gateStatus || 'clean'} gate, ${refs} source ref(s)). Pick a time or use a suggestion.`, 'ok');
  }
  checkConflictForScheduledAt();
}

function getDraftTab() {
  return state.draftTab || 'all';
}

function setDraftTab(tab) {
  state.draftTab = tab;
  $$('.superx-tab').forEach(el => el.classList.toggle('active', el.dataset.draftTab === tab));
  renderDrafts();
}

function matchesDraftTab(draft) {
  const tab = getDraftTab();
  if (tab === 'all') return true;
  if (tab === 'needs-proof') return draft.status === 'needs-proof';
  if (tab === 'approved') return draft.status === 'approved';
  const cat = draft.category || 'for-you';
  if (tab === 'for-you') return cat === 'for-you' || cat === 'manual' || !cat;
  if (tab === 'company') return cat === 'company' || cat === 'product';
  if (tab === 'vault') return cat === 'vault';
  if (tab === 'inspiration') return cat === 'inspiration' || cat === 'reply';
  return true;
}

function provenanceLine(draft) {
  const refs = Array.isArray(draft.sourceRefs) ? draft.sourceRefs : [];
  if (!refs.length) return 'Inspired by operator context';
  const first = refs[0];
  if (typeof first === 'string') {
    if (first.includes('voice-dna')) return 'Inspired by voice DNA';
    if (first.includes('obsidian')) return 'Inspired by vault note';
    if (first.includes('source-bank') || first.includes('live-x')) return 'Inspired by saved source';
    return 'Inspired by source';
  }
  const type = first.type || '';
  if (type === 'voice-dna') return 'Inspired by voice DNA';
  if (type === 'obsidian-note') return 'Inspired by vault note';
  if (type === 'company-context') return 'Inspired by company context';
  if (type === 'source-bank') return 'Inspired by saved source';
  if (type === 'live-x-post') return 'Inspired by live X post';
  if (type === 'previous-post') return 'Inspired by previous post';
  return 'Inspired by source';
}

function renderDrafts() {
  const list = $('#draftList');
  if (!list) return;
  let filtered = state.drafts.filter(d => matchesDraftTab(d));
  filtered = sortDrafts(filtered);

  // Update tab counts
  const counts = {
    all: state.drafts.length,
    'for-you': state.drafts.filter(d => { const c = d.category || 'for-you'; return c === 'for-you' || c === 'manual' || !c; }).length,
    company: state.drafts.filter(d => { const c = d.category || ''; return c === 'company' || c === 'product'; }).length,
    vault: state.drafts.filter(d => (d.category || '') === 'vault').length,
    inspiration: state.drafts.filter(d => { const c = d.category || ''; return c === 'inspiration' || c === 'reply'; }).length,
    'needs-proof': state.drafts.filter(d => d.status === 'needs-proof').length,
    approved: state.drafts.filter(d => d.status === 'approved').length
  };
  const countEls = {
    all: $('#tabCountAll'),
    'for-you': $('#tabCountForYou'),
    company: $('#tabCountCompany'),
    vault: $('#tabCountVault'),
    inspiration: $('#tabCountInspiration'),
    'needs-proof': $('#tabCountNeedsProof'),
    approved: $('#tabCountApproved')
  };
  Object.entries(countEls).forEach(([key, el]) => { if (el) el.textContent = String(counts[key] || 0); });

  if (!filtered.length) {
    list.className = 'masonry-grid empty';
    list.innerHTML = state.drafts.length
      ? emptyStateHtml({ title: 'No drafts match this tab.', body: 'Switch to another tab or generate more drafts.' })
      : emptyStateHtml({
          title: 'No drafts yet.',
          body: 'Drafts appear after Goro rewrites selected live tweets, saved source cards, or pasted links. They must pass review before scheduling.',
          steps: ['Fetch handles or build a saved-source queue.', 'Generate / rewrite selected.', 'Review, approve, then use for schedule.']
        });
    updateMetrics();
    return;
  }

  list.className = 'masonry-grid';
  list.innerHTML = filtered.map(draft => renderDraftMasonryCard(draft)).join('');

  // Wire card clicks to open modal
  $$('.draft-masonry-card').forEach(card => {
    card.addEventListener('click', event => {
      if (event.target.closest('button') || event.target.closest('.sparkle-btn')) return;
      openDraftModal(card.dataset.id);
    });
  });

  // Wire copy buttons
  $$('[data-copy-draft]').forEach(button => button.addEventListener('click', event => {
    const draft = state.drafts.find(item => item.id === event.currentTarget.dataset.copyDraft);
    if (!draft) return;
    writeClipboard(draft.text).then(() => setStatus($('#draftStatus'), 'Draft copied.', 'ok')).catch(error => setStatus($('#draftStatus'), `Copy failed: ${error.message}`, 'error'));
  }));

  // Wire schedule buttons
  $$('[data-use-draft]').forEach(button => {
    button.addEventListener('click', event => {
      const draft = state.drafts.find(item => item.id === event.target.dataset.useDraft);
      if (draft) {
        state.selectedDraftId = draft.id;
        $('#scheduleContent').value = draft.text;
        $('#scheduleDraftId').value = draft.id;
        location.hash = '#queue';
      }
    });
  });

  updateMetrics();
}

function renderDraftMasonryCard(draft) {
  const warnings = draftWarnings(draft.text, draft.warnings);
  const status = draft.status || 'generated';
  const gateStatus = draft.gateStatus || 'clean';
  const gateScore = draft.gateScore !== undefined ? draft.gateScore : 100;
  const gateWarnings = Array.isArray(draft.gateWarnings) ? draft.gateWarnings : [];
  const allWarnings = [...new Set([...warnings, ...gateWarnings])];
  const gateClass = gateStatus === 'blocked' ? 'gate-blocked' : (gateStatus === 'revise' ? 'gate-revise' : (gateStatus === 'needs-proof' ? 'gate-proof' : 'gate-clean'));
  const prov = provenanceLine(draft);
  const warnPills = allWarnings.length
    ? `<span class="pill warn" title="${escapeHtml(allWarnings.join(' · '))}">⚠ ${allWarnings.length}</span>`
    : '';
  const statusPill = `<span class="pill status-${escapeHtml(status)}">${escapeHtml(status)}</span>`;
  const gatePill = `<span class="pill ${gateClass}">${gateScore}</span>`;

  return `
    <article class="draft-masonry-card" data-id="${escapeHtml(draft.id)}" tabindex="0" role="button" aria-label="Draft: ${escapeHtml(draft.angle || 'Candidate')}">
      <div class="card-header">
        <div class="card-avatar">L</div>
        <div>
          <div class="card-name">LUCAS</div>
          <div class="card-handle">@LucasSynnott</div>
        </div>
      </div>
      <div class="card-text">${escapeHtml(draft.text)}</div>
      <div class="card-provenance">
        <span class="prov-arrow">→</span>
        <span>${escapeHtml(prov)}</span>
      </div>
      <div class="card-footer">
        <div class="card-meta">
          ${statusPill}
          ${gatePill}
          <span class="pill">${draft.text.length}/280</span>
          ${warnPills}
        </div>
        <div class="card-actions">
          <button class="button primary" data-edit-draft="${escapeHtml(draft.id)}" title="Edit post">Edit post</button>
          <button class="sparkle-btn" data-regenerate-draft="${escapeHtml(draft.id)}" title="Regenerate">✨</button>
        </div>
      </div>
    </article>`;
}

function openDraftModal(draftId) {
  const draft = state.drafts.find(d => d.id === draftId);
  if (!draft) return;
  state.selectedDraftId = draftId;
  const modal = $('#draftEditModal');
  const angleEl = $('#modalDraftAngle');
  const metaEl = $('#modalDraftMeta');
  const editor = $('#modalDraftEditor');
  const provenanceEl = $('#modalDraftProvenance');
  const suggestionsEl = $('#modalDraftSuggestions');

  angleEl.textContent = draft.angle || 'Draft';
  editor.value = draft.text;

  const warnings = draftWarnings(draft.text, draft.warnings);
  const status = draft.status || 'generated';
  const gateStatus = draft.gateStatus || 'clean';
  const gateScore = draft.gateScore !== undefined ? draft.gateScore : 100;
  const gateWarnings = Array.isArray(draft.gateWarnings) ? draft.gateWarnings : [];
  const gateSuggestions = Array.isArray(draft.gateSuggestions) ? draft.gateSuggestions : [];
  const gateClass = gateStatus === 'blocked' ? 'gate-blocked' : (gateStatus === 'revise' ? 'gate-revise' : (gateStatus === 'needs-proof' ? 'gate-proof' : 'gate-clean'));

  metaEl.innerHTML = `
    <span class="pill status-${escapeHtml(status)}">${escapeHtml(status)}</span>
    <span class="pill ${gateClass}">gate: ${escapeHtml(gateStatus)} (${gateScore})</span>
    <span class="pill">${draft.text.length}/280</span>
    ${warnings.length ? warnings.map(w => `<span class="pill warn">${escapeHtml(w)}</span>`).join('') : ''}
    ${gateWarnings.length ? gateWarnings.filter(w => !warnings.includes(w)).map(w => `<span class="pill warn">${escapeHtml(w)}</span>`).join('') : ''}
  `;

  const sourceRefs = Array.isArray(draft.sourceRefs) && draft.sourceRefs.length
    ? `<div class="draft-sourceRefs">Sources: ${draft.sourceRefs.map(ref => `<code>${escapeHtml(typeof ref === 'string' ? ref : ref.label || ref.id || JSON.stringify(ref))}</code>`).join(' ')}</div>`
    : '';
  const templateInfo = draft.templateId
    ? `<div class="draft-templateInfo">Template: ${escapeHtml(draft.templateName || draft.templateId)}</div>`
    : '';
  const rejectReason = draft.rejectReason ? `<div class="draft-rationale reject-reason">Rejected: ${escapeHtml(draft.rejectReason)}</div>` : '';
  const rationale = draft.rationale ? `<div class="draft-rationale">${escapeHtml(draft.rationale)}</div>` : '';

  provenanceEl.innerHTML = `${rationale}${sourceRefs}${templateInfo}${rejectReason}`;

  suggestionsEl.innerHTML = gateSuggestions.length
    ? `<div class="draft-suggestions"><p class="eyebrow">gate suggestions</p>${gateSuggestions.map(s => `<span class="pill suggest">↳ ${escapeHtml(s)}</span>`).join('')}</div>`
    : '';

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  editor.focus();
}

function closeDraftModal() {
  const modal = $('#draftEditModal');
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  state.selectedDraftId = null;
}

function openStyleDrawer() {
  const drawer = $('#styleDrawer');
  loadStylePrefs();
  drawer.classList.remove('hidden');
  drawer.setAttribute('aria-hidden', 'false');
}

function closeStyleDrawerFn() {
  const drawer = $('#styleDrawer');
  drawer.classList.add('hidden');
  drawer.setAttribute('aria-hidden', 'true');
}

function loadStylePrefs() {
  try {
    const prefs = JSON.parse(localStorage.getItem('tweetLabStylePrefs') || '{}');
    $('#styleTone').value = prefs.tone || 'sharp, useful, no AI slop';
    $('#styleIntensity').value = prefs.intensity || 'normal';
    $('#styleLineBreaks').value = prefs.lineBreaks || 'natural';
    $('#styleProfanity').value = prefs.profanity || 'natural';
    $('#styleForbidden').value = (prefs.forbiddenPatterns || []).join('\n');
  } catch {
    // defaults already in HTML
  }
}

function saveStylePrefs() {
  const prefs = {
    tone: $('#styleTone').value,
    intensity: $('#styleIntensity').value,
    lineBreaks: $('#styleLineBreaks').value,
    profanity: $('#styleProfanity').value,
    forbiddenPatterns: $('#styleForbidden').value.split('\n').map(s => s.trim()).filter(Boolean)
  };
  localStorage.setItem('tweetLabStylePrefs', JSON.stringify(prefs));
  setStatus($('#draftStatus'), 'Style preferences saved locally.', 'ok');
  closeStyleDrawerFn();
}

function resetStylePrefs() {
  localStorage.removeItem('tweetLabStylePrefs');
  $('#styleTone').value = 'sharp, useful, no AI slop';
  $('#styleIntensity').value = 'normal';
  $('#styleLineBreaks').value = 'natural';
  $('#styleProfanity').value = 'natural';
  $('#styleForbidden').value = '';
  setStatus($('#draftStatus'), 'Style preferences reset to default.', 'ok');
}

async function generateMoreDrafts() {
  const button = $('#generateMoreBtn');
  if (button) { button.disabled = true; button.textContent = 'Generating…'; }
  try {
    // Use existing generation with default context
    const response = await fetch('/api/tweet-lab/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        context: 'Generate fresh drafts from voice DNA, previous posts, and saved sources.',
        tone: 'sharp, useful, no AI slop',
        count: 2,
        inspirationLinks: []
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Generate failed with HTTP ${response.status}`);
    setStatus($('#draftStatus'), `Generated ${data.drafts?.length || 0} new draft(s).`, 'ok');
    await loadDrafts();
  } catch (error) {
    setStatus($('#draftStatus'), error.message, 'error');
  } finally {
    if (button) { button.disabled = false; button.innerHTML = '<span>↻</span> Generate more'; }
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

function safeExternalUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

function renderConfigStatus() {
  const config = state.config || {};
  const adapter = config.goroMode || 'unknown';
  const mockForced = config.mockModeForced;
  const profile = config.goroProfile || 'goro';
  const goroLine = mockForced
    ? `${adapter} (mock mode forced)`
    : `${adapter}${adapter === 'http' ? '' : ` via profile ${profile}`}`;
  $('#configStatus').innerHTML = `
    <div><dt>Goro adapter</dt><dd>${escapeHtml(goroLine)}</dd></div>
    <div><dt>Postiz</dt><dd>${config.postizConfigured ? 'configured' : 'safe-blocked'}</dd></div>
    <div><dt>X live reads</dt><dd>${config.xConfigured ? `${escapeHtml(config.xProvider || 'configured')} · read-only` : 'missing server token'}</dd></div>
  `;
  updateMetrics();
}

function renderSourcePacket(result) {
  const lists = $$('#sourcePacketList');
  if (!result?.sourcePacket && !result?.sourceTweet) {
    lists.forEach(list => {
      list.textContent = 'No source packet yet.';
      list.className = 'source-packet empty';
    });
    return;
  }
  const lines = [];
  if (result.sourceTweet) {
    const st = result.sourceTweet;
    lines.push(`Rewrite source tweet:`);
    lines.push(`  author: ${st.author || 'unknown'}`);
    lines.push(`  url: ${st.url || '(none)'}`);
    lines.push(`  text: ${(st.text || '').slice(0, 200)}${(st.text || '').length > 200 ? '…' : ''}`);
    if (st.warnings?.length) lines.push(`  warnings: ${st.warnings.join(', ')}`);
  }
  if (result.sourcePacket) {
    const packet = result.sourcePacket;
    const resolved = Array.isArray(packet.resolvedTweets) ? packet.resolvedTweets : [];
    if (packet.context) lines.push(`Context: ${packet.context}`);
    if (packet.tone) lines.push(`Tone: ${packet.tone}`);
    if (packet.count) lines.push(`Requested count: ${packet.count}`);
    if (packet.templateId) lines.push(`Template: ${packet.template?.name || packet.templateId} (${packet.template?.body ? packet.template.body.slice(0, 120) : 'not found in library'}${packet.template?.body?.length > 120 ? '…' : ''})`);
    if (packet.inspirationLinks?.length) lines.push(`Inspiration links (${packet.inspirationLinks.length}):`);
    if (packet.inspirationLinks?.length) {
      packet.inspirationLinks.forEach((link, i) => {
        const resolvedItem = resolved[i];
        const status = resolvedItem?.text ? 'resolved' : (resolvedItem?.warning ? `unresolved: ${resolvedItem.warning}` : 'pending');
        lines.push(`  ${i + 1}. ${link} [${status}]`);
        if (resolvedItem?.text) {
          lines.push(`     → ${resolvedItem.text.slice(0, 160)}${resolvedItem.text.length > 160 ? '…' : ''}`);
        }
      });
    }
    if (packet.selectedSources?.length) {
      lines.push(`Selected sources (${packet.selectedSources.length}):`);
      packet.selectedSources.forEach((s, i) => {
        lines.push(`  ${i + 1}. ${s.author || 'unknown'} · ${(s.text || '').slice(0, 120)}${(s.text || '').length > 120 ? '…' : ''}`);
      });
    }
  }
  const text = lines.join('\n') || 'Empty source packet.';
  lists.forEach(list => {
    list.className = 'source-packet';
    list.textContent = text;
  });
}

function renderWarnings(result) {
  const boxes = $$('#warningsBox');
  if (!result?.warnings?.length) {
    boxes.forEach(box => {
      box.className = 'warnings-box empty';
      box.textContent = 'No warnings.';
    });
    return;
  }
  const html = result.warnings.map(w => `<span class="pill warn">${escapeHtml(w)}</span>`).join(' ');
  boxes.forEach(box => {
    box.className = 'warnings-box';
    box.innerHTML = html;
  });
}

function renderAdapterBadge(result) {
  const badge = $('#adapterBadge');
  if (!result) {
    badge.textContent = 'awaiting generation';
    badge.className = 'adapter-badge';
    return;
  }
  const adapter = result.adapter || 'unknown';
  const mockForced = result.mockModeForced;
  const profile = result.goroProfile || 'goro';
  const note = mockForced
    ? `mock mode forced (verification only)`
    : (adapter === 'http' ? 'real HTTP Goro endpoint' : `real Hermes Goro profile (${profile})`);
  badge.className = `adapter-badge ${adapter}`;
  badge.textContent = `${adapter} · ${note}`;
}

async function loadConfig() {
  try {
    const response = await fetch('/api/tweet-lab/config');
    state.config = await response.json();
  } catch (error) {
    state.config = { goroMode: 'unknown', postizConfigured: false, hasDefaultIntegration: false };
  }
  renderConfigStatus();
  renderAnalytics();
}


function formatRelativeTime(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const diff = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}


function statusClass(value) {
  if (value === true) return 'ok';
  if (value === false) return 'error';
  return 'muted';
}

function compactPairs(pairs) {
  return pairs.map(([dt, dd, klass]) => `<div><dt>${escapeHtml(dt)}</dt><dd class="${statusClass(klass)}">${escapeHtml(dd)}</dd></div>`).join('');
}

function renderAppCell(app = {}) {
  const lines = [
    ['version', app.version || 'unknown'],
    ['node', app.nodeVersion || '?'],
    ['pid', app.pid != null ? String(app.pid) : '?'],
    ['port', app.port != null ? String(app.port) : '?'],
    ['uptime', app.uptimeSeconds != null ? `${app.uptimeSeconds}s` : '?'],
    ['tailnet', app.tailnetHost ? `https://${app.tailnetHost}:${app.port || 4173}/` : 'unset']
  ];
  const klass = app.version && app.version.includes('+') ? true : 'muted';
  const klassResolved = klass === true ? true : 'muted';
  $('#diagApp').innerHTML = lines.map(([dt, dd]) => `<div><dt>${escapeHtml(dt)}</dt><dd class="${klassResolved === true ? 'ok' : 'muted'}">${escapeHtml(dd)}</dd></div>`).join('');
}

function renderGoroCell(goro = {}) {
  const adapterLabel = goro.mockModeForced
    ? `${goro.mode || 'unknown'} (mock forced)`
    : (goro.mode === 'http' ? 'http endpoint' : (goro.mode === 'hermes' ? `hermes via ${goro.profile || 'goro'}` : (goro.mode || 'unknown')));
  const lastAt = goro.lastSuccess?.at;
  const lastRel = formatRelativeTime(lastAt);
  const lastStatus = goro.lastSuccess
    ? `ok · ${goro.lastSuccess.adapter} · ${goro.lastSuccess.draftCount || 0} draft(s) · ${lastRel || '-'}`
    : (goro.lastFailure ? `failed · ${lastRel || '-'}` : 'no attempts yet');
  const failure = goro.lastFailure
    ? `${goro.lastFailure.adapter} · ${goro.lastFailure.error?.slice(0, 60) || 'unknown'}`
    : '-';
  const klass = goro.mockModeForced ? 'warn' : (goro.lastFailure && !goro.lastSuccess ? 'error' : true);
  const rows = [
    ['adapter', adapterLabel, klass],
    ['mock forced', goro.mockModeForced ? 'yes' : 'no', goro.mockModeForced ? 'warn' : true],
    ['profile', goro.profile || 'goro', 'muted'],
    ['http endpoint', goro.hasGoroEndpoint ? 'configured' : 'unset', goro.hasGoroEndpoint ? true : 'muted'],
    ['last generation', lastStatus, klass],
    ['last failure', failure, goro.lastFailure ? 'error' : 'muted']
  ];
  $('#diagGoro').innerHTML = compactPairs(rows);

  const detail = goro.lastSuccess
    ? JSON.stringify(goro.lastSuccess, null, 2)
    : (goro.lastFailure ? JSON.stringify(goro.lastFailure, null, 2) : 'no generation attempts yet');
  $('#diagGoroDetail').textContent = detail;
}

function renderXCell(x = {}) {
  const configured = x.configured === true;
  const lastFetch = x.lastFetch;
  const lastRel = formatRelativeTime(lastFetch?.at);
  const lastLine = lastFetch
    ? `${lastFetch.ok ? 'ok' : 'failed'} · ${lastFetch.okAccounts ?? 0}/${lastFetch.requestedAccounts ?? 0} accounts · ${lastFetch.tweetCount ?? 0} tweet(s) · ${lastRel || '-'}`
    : 'no fetch yet';
  const klass = !configured
    ? 'error'
    : (lastFetch && !lastFetch.ok ? 'warn' : (lastFetch?.ok ? true : 'muted'));
  const rateLimit = x.lastRateLimit;
  const rateText = rateLimit
    ? `limit ${rateLimit.limit ?? '?'} · remaining ${rateLimit.remaining ?? '?'} · resets ${rateLimit.reset ? new Date(rateLimit.reset).toLocaleTimeString() : '?'}`
    : '-';
  const provider = x.provider || 'unset';
  const rows = [
    ['provider', `${provider} · ${x.readOnly ? 'read-only' : 'writable'}`, configured ? true : 'error'],
    ['configured', configured ? 'yes' : 'no', klass],
    ['last fetch', lastLine, klass],
    ['rate limit', rateText, rateLimit ? (rateLimit.remaining != null && rateLimit.remaining < 10 ? 'warn' : true) : 'muted'],
    ['last failure', x.lastFailure ? `${x.lastFailure.error?.slice(0, 80) || 'unknown'} · ${formatRelativeTime(x.lastFailure.at) || '-'}` : '-', x.lastFailure ? 'error' : 'muted']
  ];
  $('#diagX').innerHTML = compactPairs(rows);

  const detail = lastFetch
    ? JSON.stringify(lastFetch, null, 2)
    : 'no live X fetch yet';
  $('#diagFetch').textContent = detail;
}

function renderPostizCell(postiz = {}) {
  const configured = postiz.configured === true;
  const lastAttempt = postiz.lastAttempt;
  const lastRel = formatRelativeTime(lastAttempt?.at);
  let lastLine = 'no schedule attempt yet';
  let lastKlass = 'muted';
  if (lastAttempt) {
    if (lastAttempt.ok) {
      lastLine = `posted · ${lastAttempt.scheduledAt ? new Date(lastAttempt.scheduledAt).toLocaleString() : 'no time'} · ${lastRel || '-'}`;
      lastKlass = true;
    } else if (lastAttempt.safeBlocked) {
      lastLine = `safe-blocked · ${lastAttempt.error?.slice(0, 60) || 'no key'} · ${lastRel || '-'}`;
      lastKlass = 'warn';
    } else {
      lastLine = `${lastAttempt.mode || 'failed'} · ${lastAttempt.error?.slice(0, 60) || 'unknown'} · ${lastRel || '-'}`;
      lastKlass = 'error';
    }
  }
  const klass = configured ? lastKlass : (lastAttempt?.safeBlocked ? 'warn' : 'error');
  const rows = [
    ['configured', configured ? 'yes' : 'safe-blocked', klass],
    ['default integration', postiz.hasDefaultIntegration ? 'set' : 'unset', postiz.hasDefaultIntegration ? true : 'muted'],
    ['api url', postiz.apiUrl || '-', 'muted'],
    ['last attempt', lastLine, lastKlass]
  ];
  $('#diagPostiz').innerHTML = compactPairs(rows);
  $('#diagScheduleDetail').textContent = lastAttempt
    ? JSON.stringify(lastAttempt, null, 2)
    : 'no schedule attempts yet';
}

function renderStorageCell(storage = {}) {
  const rows = [
    ['drafts', String(storage.draftsCount ?? 0)],
    ['sources', String(storage.sourcesCount ?? 0)],
    ['templates', String(storage.templatesCount ?? 0)],
    ['schedule slots', String(storage.scheduleSlotsCount ?? 0)],
    ['last audit', storage.auditLastAt ? new Date(storage.auditLastAt).toLocaleString() : '-']
  ];
  $('#diagStorage').innerHTML = compactPairs(rows.map(([dt, dd]) => [dt, dd, 'muted']));
}

function renderRemedies(remedies = {}) {
  const rows = [
    ['Postiz', remedies.postiz || '-'],
    ['X reads', remedies.x || '-'],
    ['Goro', remedies.goro || '-']
  ];
  $('#diagRemedies').innerHTML = rows.map(([dt, dd]) => `<div><dt>${escapeHtml(dt)}</dt><dd>${escapeHtml(dd)}</dd></div>`).join('');
}

function buildDiagnosticsBundle() {
  const d = state.diagnostics;
  if (!d) return '// diagnostics not loaded yet · click Refresh';
  const safe = {
    app: d.app,
    goro: { ...d.goro, lastSuccess: d.goro?.lastSuccess, lastFailure: d.goro?.lastFailure },
    x: { ...d.x, lastFetch: d.x?.lastFetch, lastFailure: d.x?.lastFailure, lastRateLimit: d.x?.lastRateLimit },
    postiz: { ...d.postiz, lastAttempt: d.postiz?.lastAttempt },
    storage: d.storage,
    blockedRemedies: d.blockedRemedies,
    capturedAt: new Date().toISOString()
  };
  return JSON.stringify(safe, null, 2);
}

// ── Mentions feed (SuperX reference) ──────────────────────────────
//
// Live X mention timelines need a user-context access token, which the
// current server-side X credential path cannot provide. Until that credential is
// wired into the service env, the server returns a 503 with an exact
// blocker; this module surfaces that blocker to the operator and offers
// a private AI reply draft action that never publishes.

const MENTIONS_DEMO_FEED = [
  {
    id: 'demo-mention-1',
    url: 'https://x.com/rogueweathr/status/example-1',
    text: 'Wrong, I can see why people might think that so the case, but it\'s wrong. We, the audience, empathize with Walt because he\'s the common man that could. From…',
    createdAt: '2026-04-10T18:30:00.000Z',
    conversationId: 'demo-conv-1',
    author: { id: '1', username: 'rogueweathr', name: 'rogueweathr', profileImageUrl: null, verified: false },
    metrics: { likeCount: 0, repostCount: 0, replyCount: 2, quoteCount: 0, impressionCount: 86 },
    referencedTweets: [{ type: 'replied_to', id: 'demo-parent-1' }],
    source: 'local-demo',
    fetchedAt: '2026-06-19T12:00:00.000Z',
    warnings: ['local demo · not fetched from live X']
  },
  {
    id: 'demo-mention-2',
    url: 'https://x.com/stephenmk96/status/example-2',
    text: 'Great connections made at Client Ascension Q4 event 🔥 @clientascension @LucasSynnott @OnatAksaray @markdmei @OnatAksaray https://t.co/08o3C3x25g',
    createdAt: '2025-12-09T12:00:00.000Z',
    conversationId: 'demo-conv-2',
    author: { id: '2', username: 'stephenmk96', name: 'Stephen', profileImageUrl: null, verified: false },
    metrics: { likeCount: 0, repostCount: 0, replyCount: 0, quoteCount: 0, impressionCount: 12 },
    referencedTweets: [{ type: 'replied_to', id: 'demo-parent-2' }],
    source: 'local-demo',
    fetchedAt: '2026-06-19T12:00:00.000Z',
    warnings: ['local demo · not fetched from live X']
  }
];

const MENTIONS_DEMO_PARENTS = {
  'demo-parent-1': {
    id: 'demo-parent-1',
    author: { username: 'rogueweathr', name: 'rogueweathr' },
    text: 'I believe this is what\'s appealing about the show. You can\'t help but root for the man at first. But once you begin to understand the cost of his decisions, you end up realizing he\'s unfathomably evil.',
    url: 'https://x.com/rogueweathr/status/parent-1'
  },
  'demo-parent-2': {
    id: 'demo-parent-2',
    author: { username: 'stephenmk96', name: 'Stephen' },
    text: 'Great connections made at Client Ascension Q4 event 🔥 @clientascension @LucasSynnott @OnatAksaray @markdmei @OnatAksaray https://t.co/08o3C3x25g',
    url: 'https://x.com/stephenmk96/status/parent-2'
  }
};

function mentionsAvailableAccounts() {
  // The Operator profile handle is the safest default; surface any handles
  // found in the inspiration source bank so the operator can pivot quickly.
  const handles = new Set();
  if (state.config?.xConfigured) handles.add('LucasSynnott');
  for (const source of (state.sources || [])) {
    const author = String(source?.author || '').replace(/^@+/, '').trim();
    if (/^[A-Za-z0-9_]{1,15}$/.test(author)) handles.add(author);
  }
  return Array.from(handles);
}

function renderMentionsAccountOptions() {
  const select = $('#mentionsAccountSelect');
  if (!select) return;
  const accounts = mentionsAvailableAccounts();
  const previous = state.mentions.selectedAccount || accounts[0] || '';
  const value = accounts.includes(previous) ? previous : (accounts[0] || '');
  state.mentions.selectedAccount = value;
  select.innerHTML = accounts.length
    ? accounts.map(handle => `<option value="${escapeHtml(handle)}">@${escapeHtml(handle)}</option>`).join('')
    : '<option value="">No accounts yet</option>';
  if (value) select.value = value;
}

function renderMentionsBlocker() {
  const blocker = $('#mentionsBlocker');
  const text = $('#mentionsBlockerText');
  const cred = $('#mentionsBlockerCredential');
  if (!blocker) return;
  if (state.mentions.blocked && !state.mentions.demoMode) {
    blocker.hidden = false;
    if (text) text.textContent = state.mentions.blockerMessage || 'Live mentions are not configured.';
    if (cred) {
      const credential = state.mentions.credential;
      cred.innerHTML = credential
        ? `Required server env var: <code>${escapeHtml(credential)}</code>. Set it in your private service environment and restart Tweet Lab.`
        : '';
    }
  } else {
    blocker.hidden = true;
  }
}

function renderMentionsCount() {
  const el = $('#mentionsCount');
  if (!el) return;
  const n = state.mentions.feed.length;
  el.textContent = `${n} ${n === 1 ? 'mention' : 'mentions'}`;
}

function mentionsEscapeAttribute(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function initialsFor(name) {
  const cleaned = String(name || '').trim();
  if (!cleaned) return '?';
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return cleaned.slice(0, 2).toUpperCase();
}

function mentionsFormatTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  // Operator-friendly: Apr 10 or Apr 10, 2025. Always short, no seconds.
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getUTCMonth()];
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  const now = new Date();
  if (now.getUTCFullYear() === year) return `${month} ${day}`;
  return `${month} ${day}, ${year}`;
}

function mentionsFindParent(mention) {
  // Resolve the parent tweet for a mention. Demo data ships an inline parent
  // map; live data carries `referencedTweets` with a `replied_to` type and
  // an id; the parent may be missing entirely, in which case the card shows
  // a "thread parent not loaded" empty state.
  if (Array.isArray(mention?.referencedTweets)) {
    const ref = mention.referencedTweets.find(item => item && (item.type === 'replied_to' || item.type === 'quoted'));
    if (ref && ref.id) {
      if (MENTIONS_DEMO_PARENTS[ref.id]) return MENTIONS_DEMO_PARENTS[ref.id];
      // Live mode would need a separate fetch; for now the card shows the
      // "thread parent not loaded" empty state.
      return null;
    }
  }
  return null;
}

function renderMentionsFeed() {
  const feed = $('#mentionsFeed');
  if (!feed) return;
  renderMentionsAccountOptions();
  renderMentionsBlocker();
  renderMentionsCount();
  if (!state.mentions.feed.length) {
    feed.classList.add('empty');
    feed.innerHTML = state.mentions.demoMode
      ? 'No local demo mentions available.'
      : (state.mentions.blocked ? 'Live mentions are not configured. Use the local example option below to see how the feed renders.' : 'No mentions loaded yet.');
    return;
  }
  feed.classList.remove('empty');
  feed.innerHTML = state.mentions.feed.map(mention => mentionsRenderCard(mention)).join('');
  // Wire per-card actions.
  $$('.mention-card').forEach(card => {
    const mentionId = card.getAttribute('data-mention-id');
    const aiBtn = card.querySelector('.mention-ai-button');
    const saveBtn = card.querySelector('.mention-save-button');
    if (aiBtn) aiBtn.addEventListener('click', () => mentionsAiDraft(mentionId));
    if (saveBtn) saveBtn.addEventListener('click', () => mentionsSaveLocal(mentionId));
  });
}

function mentionsRenderCard(mention) {
  const author = mention?.author || {};
  const username = author.username || 'unknown';
  const name = author.name || username;
  const avatar = author.profileImageUrl
    ? `<span class="mention-avatar"><img src="${mentionsEscapeAttribute(author.profileImageUrl)}" alt="" loading="lazy"></span>`
    : `<span class="mention-avatar">${escapeHtml(initialsFor(name))}</span>`;
  const parent = mentionsFindParent(mention);
  const parentAuthor = parent?.author?.username ? `@${parent.author.username}` : 'thread parent';
  const parentText = parent?.text || '';
  const metrics = mention?.metrics || {};
  const metricsHtml = [
    `<span class="mention-metric" data-metric="replies">💬 ${Number(metrics.replyCount ?? 0).toLocaleString()}</span>`,
    `<span class="mention-metric" data-metric="retweets">🔁 ${Number(metrics.repostCount ?? 0).toLocaleString()}</span>`,
    `<span class="mention-metric" data-metric="likes">♡ ${Number(metrics.likeCount ?? 0).toLocaleString()}</span>`,
    `<span class="mention-metric" data-metric="views">👁 ${Number(metrics.impressionCount ?? 0).toLocaleString()}</span>`
  ].join('');
  const sourceWarning = mention?.source && mention.source !== 'x-users-me-mentions' && mention.source !== 'local-demo'
    ? `<p class="mention-source-warning">⚠ Source label: <code>${escapeHtml(mention.source)}</code>. This is not a live X users/me/mentions payload.</p>`
    : '';
  return `
    <article class="mention-card panel superx-card" data-mention-id="${mentionsEscapeAttribute(mention?.id || '')}">
      <header class="mention-original">
        <span class="mention-original-label">Replying to</span>
        <span class="mention-original-author">@${escapeHtml(parent?.author?.username || username)}</span>
      </header>
      <p class="mention-original-text ${parentText ? '' : 'empty'}">${parentText ? escapeHtml(parentText) : '(thread parent not loaded · only the mention text is shown)'}</p>
      <div class="mention-author-row">
        ${avatar}
        <div>
          <strong class="mention-author-name">${escapeHtml(name)}</strong>
          <small class="mention-author-handle">@${escapeHtml(username)}</small>
        </div>
        <time class="mention-time">${escapeHtml(mentionsFormatTime(mention?.createdAt))}</time>
      </div>
      <p class="mention-text">${escapeHtml(mention?.text || '')}</p>
      <div class="mention-metrics">${metricsHtml}</div>
      ${sourceWarning}
      <div class="mention-reply-composer">
        <p class="mention-replying-to">Replying to <span class="mention-reply-target">@${escapeHtml(username)}</span></p>
        <textarea class="mention-reply-input" rows="2" placeholder="Draft a private reply. Nothing is sent without explicit operator action."></textarea>
        <div class="mention-reply-actions">
          <button class="button ghost mention-ai-button" type="button">✨ AI draft</button>
          <button class="button ghost mention-save-button" type="button">Save draft</button>
          <span class="mention-ai-status" role="status" aria-live="polite"></span>
        </div>
      </div>
    </article>
  `;
}

async function loadMentionsStatus() {
  try {
    const response = await fetch('/api/tweet-lab/mentions/status');
    if (!response.ok) throw new Error(`mentions/status HTTP ${response.status}`);
    const data = await response.json();
    state.mentions.status = data;
    state.mentions.blocked = !data.configured;
    state.mentions.blockerMessage = data.blocker || '';
    state.mentions.credential = data.credential || null;
    if (!data.configured && !state.mentions.feed.length) {
      // Surface a clear empty state · never fabricate a live feed.
      state.mentions.feed = [];
    }
  } catch (error) {
    state.mentions.status = null;
    state.mentions.blocked = true;
    state.mentions.blockerMessage = `Mentions status endpoint failed: ${error.message}`;
  }
  renderMentionsFeed();
}

async function loadMentions() {
  if (state.mentions.busy) return;
  if (state.mentions.blocked) {
    renderMentionsBlocker();
    return;
  }
  const account = state.mentions.selectedAccount;
  if (!account) {
    setStatus($('#mentionsReplyStatus'), 'Add an X account in Inspiration or Workbench first.', 'error');
    return;
  }
  state.mentions.busy = true;
  setStatus($('#mentionsReplyStatus'), `Fetching mentions for @${account}…`);
  try {
    const response = await fetch('/api/tweet-lab/mentions/fetch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accounts: [account], limitPerAccount: 15 })
    });
    if (response.status === 503) {
      const data = await response.json().catch(() => ({}));
      state.mentions.blocked = true;
      state.mentions.blockerMessage = data.error || 'Live mentions are not configured.';
      state.mentions.credential = data.credential || null;
      state.mentions.feed = [];
      setStatus($('#mentionsReplyStatus'), state.mentions.blockerMessage, 'error');
      renderMentionsFeed();
      return;
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status} ${text.slice(0, 120)}`);
    }
    const data = await response.json();
    state.mentions.feed = Array.isArray(data.mentions) ? data.mentions : [];
    setStatus($('#mentionsReplyStatus'), `Loaded ${state.mentions.feed.length} mention(s) for @${account}.`);
    renderMentionsFeed();
  } catch (error) {
    setStatus($('#mentionsReplyStatus'), `Mentions fetch failed: ${error.message}`, 'error');
  } finally {
    state.mentions.busy = false;
  }
}

function loadMentionsDemo() {
  state.mentions.demoMode = true;
  state.mentions.blocked = false;
  state.mentions.feed = MENTIONS_DEMO_FEED.map(mention => ({ ...mention }));
  state.mentions.selectedAccount = state.mentions.selectedAccount || 'LucasSynnott';
  setStatus($('#mentionsReplyStatus'), `Loaded ${state.mentions.feed.length} local demo — not fetched from live X. Drafts will not publish.`);
  renderMentionsFeed();
}

function mentionsFindCard(mentionId) {
  if (!mentionId) return null;
  return document.querySelector(`.mention-card[data-mention-id="${CSS.escape(mentionId)}"]`);
}

function mentionsSetCardStatus(mentionId, message, kind = '') {
  const card = mentionsFindCard(mentionId);
  if (!card) return;
  const status = card.querySelector('.mention-ai-status');
  if (!status) return;
  status.textContent = message;
  status.classList.remove('ok', 'error', 'busy');
  if (kind) status.classList.add(kind);
}

async function mentionsAiDraft(mentionId) {
  if (state.mentions.busy) return;
  const mention = state.mentions.feed.find(item => item.id === mentionId);
  if (!mention) return;
  const card = mentionsFindCard(mentionId);
  if (!card) return;
  const textarea = card.querySelector('.mention-reply-input');
  const aiBtn = card.querySelector('.mention-ai-button');
  state.mentions.busy = true;
  if (aiBtn) aiBtn.disabled = true;
  mentionsSetCardStatus(mentionId, 'Drafting private reply…', 'busy');
  try {
    const parent = mentionsFindParent(mention);
    const response = await fetch('/api/tweet-lab/mentions/reply/draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mention: {
          id: mention.id,
          url: mention.url,
          text: mention.text,
          author: mention.author,
          conversationId: mention.conversationId || null,
          referencedTweets: mention.referencedTweets || []
        },
        parentTweet: parent || null,
        context: $('#mentionsContext')?.value || '',
        tone: $('#mentionsTone')?.value || 'sharp, useful, no AI slop',
        count: 1
      })
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status} ${text.slice(0, 160)}`);
    }
    const data = await response.json();
    const top = Array.isArray(data.candidates) ? data.candidates[0] : null;
    if (!top) throw new Error('Goro returned no candidates.');
    if (textarea) textarea.value = String(top.text || '').trim();
    const replies = Array.isArray(data.replies) ? data.replies : [];
    for (const reply of replies) state.mentions.draftsById[reply.id] = reply;
    const draftIds = replies.map(reply => reply.id).join(', ');
    const adapter = data.adapter || 'unknown';
    mentionsSetCardStatus(mentionId, `Drafted (${adapter}) · saved to local replies store.${draftIds ? ' id: ' + draftIds : ''}`, 'ok');
    setStatus($('#mentionsReplyStatus'), `Private reply drafted for @${mention.author?.username || 'unknown'}. Saved locally; nothing was published.`);
  } catch (error) {
    mentionsSetCardStatus(mentionId, `AI draft failed: ${error.message}`, 'error');
    setStatus($('#mentionsReplyStatus'), `AI draft failed: ${error.message}`, 'error');
  } finally {
    state.mentions.busy = false;
    if (aiBtn) aiBtn.disabled = false;
  }
}

async function mentionsSaveLocal(mentionId) {
  const card = mentionsFindCard(mentionId);
  if (!card) return;
  const textarea = card.querySelector('.mention-reply-input');
  const text = String(textarea?.value || '').trim();
  if (!text) {
    mentionsSetCardStatus(mentionId, 'Type or AI-draft a reply before saving.', 'error');
    return;
  }
  if (text.length > 280) {
    mentionsSetCardStatus(mentionId, `Reply is ${text.length} chars · must be 280 or fewer.`, 'error');
    return;
  }
  const mention = state.mentions.feed.find(item => item.id === mentionId);
  if (!mention) return;
  try {
    const response = await fetch('/api/tweet-lab/store/replies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text,
        mentionId: mention.id,
        mentionAuthor: mention.author?.name || mention.author?.username || null,
        mentionUsername: mention.author?.username || null,
        mentionText: mention.text,
        mentionUrl: mention.url,
        conversationId: mention.conversationId || null,
        sourceRefs: mention.url ? [mention.url] : [],
        warnings: ['operator-saved local reply · not AI drafted, not published'],
        adapter: 'operator-save',
        goroProfile: null,
        mockModeForced: false,
        published: false
      })
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`HTTP ${response.status} ${detail.slice(0, 160)}`);
    }
    const saved = await response.json();
    state.mentions.draftsById[saved.id] = saved;
    mentionsSetCardStatus(mentionId, `Saved draft id ${saved.id} locally. Not published.`, 'ok');
    setStatus($('#mentionsReplyStatus'), `Saved private reply to local replies store (id ${saved.id}).`);
  } catch (error) {
    mentionsSetCardStatus(mentionId, `Save failed: ${error.message}`, 'error');
  }
}

async function loadDiagnostics() {
  const status = $('#refreshDiagnostics');
  const copyBtn = $('#copyDiagnostics');
  if (status) status.disabled = true;
  try {
    const response = await fetch('/api/tweet-lab/diagnostics');
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Diagnostics failed: HTTP ${response.status} ${text.slice(0, 120)}`);
    }
    state.diagnostics = await response.json();
    renderAppCell(state.diagnostics.app || {});
    renderGoroCell(state.diagnostics.goro || {});
    renderXCell(state.diagnostics.x || {});
    renderPostizCell(state.diagnostics.postiz || {});
    renderStorageCell(state.diagnostics.storage || {});
    renderRemedies(state.diagnostics.blockedRemedies || {});
  } catch (error) {
    const message = `Diagnostics load failed: ${error.message}`;
    ['#diagApp', '#diagGoro', '#diagX', '#diagPostiz', '#diagStorage'].forEach(sel => {
      const el = $(sel);
      if (el) el.innerHTML = `<div><dt>error</dt><dd class="error">${escapeHtml(message)}</dd></div>`;
    });
    ['#diagFetch', '#diagGoroDetail', '#diagScheduleDetail'].forEach(sel => {
      const el = $(sel);
      if (el) el.textContent = message;
    });
    if ($('#diagRemedies')) $('#diagRemedies').innerHTML = `<div><dt>load failed</dt><dd>${escapeHtml(message)}</dd></div>`;
  } finally {
    if (status) status.disabled = false;
    if (copyBtn) copyBtn.disabled = false;
  }
}

async function copyDiagnostics() {
  const text = buildDiagnosticsBundle();
  const button = $('#copyDiagnostics');
  if (button) button.disabled = true;
  try {
    await writeClipboard(text);
    if (button) {
      const previous = button.textContent;
      button.textContent = 'Copied diagnostics';
      setTimeout(() => { button.textContent = previous || 'Copy diagnostics'; }, 1800);
    }
  } catch (error) {
    if (button) button.textContent = `Copy failed: ${error.message}`;
  } finally {
    if (button) button.disabled = false;
  }
}


async function generate() {
  const button = $('#generateButton');
  button.disabled = true;
  setStatus($('#generateStatus'), 'Goro is drafting…');
  try {
    const payload = {
      inspirationLinks: linksFromInput(),
      context: $('#context').value.trim(),
      tone: $('#tone').value.trim(),
      count: Number($('#count').value),
      templateId: $('#templateSelect').value || undefined,
      selectedSources: state.liveTweets.filter(tweet => state.selectedLiveIds.has(tweet.id)).map(tweetToSelectedSource)
    };
    const response = await fetch('/api/tweet-lab/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Generate failed with HTTP ${response.status}`);
    state.lastResult = data;
    state.drafts = Array.isArray(data.drafts) ? data.drafts : data.candidates.map(candidate => ({ ...candidate, id: `${candidate.id}-${Date.now()}` }));
    renderAdapterBadge(data);
    renderSourcePacket(data);
    renderWarnings(data);
    const promptPreview = $('#promptPreview');
    if (promptPreview) promptPreview.textContent = JSON.stringify({
      adapter: data.adapter,
      mockModeForced: data.mockModeForced,
      goroProfile: data.goroProfile,
      promptPreview: data.promptPreview,
      sourcePacket: data.sourcePacket
    }, null, 2);
    setStatus($('#generateStatus'), `Generated ${state.drafts.length} candidate(s) via ${data.adapter}.`, 'ok');
    renderDrafts();
    location.hash = '#ready-to-post';
  } catch (error) {
    setStatus($('#generateStatus'), error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

async function schedule() {
  const button = $('#scheduleButton');
  button.disabled = true;
  setStatus($('#scheduleStatus'), 'Building Postiz schedule request…');
  let settings = {};
  try {
    settings = JSON.parse($('#settingsJson').value || '{}');
  } catch {
    setStatus($('#scheduleStatus'), 'Settings JSON is invalid.', 'error');
    button.disabled = false;
    return;
  }
  try {
    const localValue = $('#scheduledAt').value;
    const scheduledAt = localValue ? new Date(localValue).toISOString() : '';
    const payload = {
      content: $('#scheduleContent').value.trim(),
      draftId: $('#scheduleDraftId').value.trim(),
      scheduledAt,
      timezone: $('#timezone').value.trim() || 'UTC',
      integrationId: $('#integrationId').value.trim(),
      settings
    };
    const response = await fetch('/api/tweet-lab/schedule', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    $('#scheduleReceipt').textContent = JSON.stringify(data, null, 2);
    if (!response.ok) throw new Error(data.error || `Schedule failed with HTTP ${response.status}`);
    if (data.conflictWarning) {
      renderConflictWarning(data.conflicts || [], data.conflictWindowMinutes || 30, 'this scheduled time');
    } else {
      clearConflictWarning();
    }
    setStatus($('#scheduleStatus'), data.conflictWarning ? `Scheduled through Postiz · ${data.conflictWarning}` : 'Scheduled through Postiz.', 'ok');
    // Refresh queue + drafts so the new entry shows up immediately.
    await loadScheduleQueue();
    await loadDrafts();
  } catch (error) {
    setStatus($('#scheduleStatus'), error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

function setDefaultScheduleTime() {
  const soon = new Date(Date.now() + 60 * 60 * 1000);
  soon.setMinutes(Math.ceil(soon.getMinutes() / 15) * 15, 0, 0);
  $('#scheduledAt').value = soon.toISOString().slice(0, 16);
  $('#timezone').value = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

// ── Schedule Queue / Posting-time intelligence (Phase 5B) ──

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function isoToLocalDateTimeInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isoToLocalDisplay(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function clearConflictWarning() {
  const el = $('#conflictWarning');
  if (!el) return;
  el.className = 'conflict-warning empty';
  el.textContent = '';
}

function renderConflictWarning(conflicts, windowMinutes, sourceLabel = 'this time') {
  const el = $('#conflictWarning');
  if (!el) return;
  if (!conflicts || conflicts.length === 0) {
    clearConflictWarning();
    return;
  }
  el.className = 'conflict-warning warn';
  el.innerHTML = `<strong>${escapeHtml(conflicts.length)} conflict(s) within ±${windowMinutes} min of ${escapeHtml(sourceLabel)}:</strong>` +
    conflicts.map(c => `<div class="conflict-item">${escapeHtml(c.scheduledAt)} · ${escapeHtml(c.angle || c.text?.slice(0, 60) || c.draftId || 'draft')} · Δ ${c.deltaMinutes >= 0 ? '+' : ''}${escapeHtml(String(c.deltaMinutes))} min</div>`).join('');
}

async function loadScheduleQueue() {
  try {
    const response = await fetch('/api/tweet-lab/schedule/queue');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Queue load failed with HTTP ${response.status}`);
    state.scheduleQueue = data;
    renderScheduleQueue();
    renderAnalytics();
  } catch (error) {
    setStatus($('#queueSummary'), error.message, 'error');
  }
}

function calendarItemTime(item) {
  const iso = item.calendarAt || item.scheduledAt || item.postedAt || item.approvedAt || item.updatedAt || item.createdAt;
  if (item.status === 'approved' && !item.scheduledAt) return 'intake';
  return isoToLocalDisplay(iso).split(' ')[1] || '-';
}


function setQueueTab(tab) {
  state.queueTab = ['scheduled', 'drafts', 'posted', 'failed'].includes(tab) ? tab : 'scheduled';
  $$('.queue-tab').forEach(button => {
    const active = button.dataset.queueTab === state.queueTab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  renderScheduleQueue();
}

function queueItemDateLabel(iso) {
  if (!iso) return { dayName: 'Unknown', dateLabel: 'unavailable' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { dayName: 'Unknown', dateLabel: 'unavailable' };
  return {
    dayName: d.toLocaleDateString(undefined, { weekday: 'long' }),
    dateLabel: d.toLocaleDateString(undefined, { month: 'short', day: '2-digit' })
  };
}

function queueGroupByDay(items) {
  const groups = new Map();
  for (const item of items) {
    const iso = item.calendarAt || item.scheduledAt || item.postedAt || item.failedAt || item.approvedAt || item.updatedAt || item.createdAt;
    const d = iso ? new Date(iso) : null;
    const key = d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : 'unknown';
    if (!groups.has(key)) {
      const labels = queueItemDateLabel(iso);
      groups.set(key, { day: key, ...labels, items: [] });
    }
    groups.get(key).items.push({ ...item, calendarAt: iso });
  }
  return Array.from(groups.values()).sort((a, b) => a.day.localeCompare(b.day));
}

function queueDraftCard(draft, { mode = 'draft' } = {}) {
  const refs = Array.isArray(draft.sourceRefs) ? draft.sourceRefs.length : 0;
  const time = mode === 'failed'
    ? (draft.failedAt ? isoToLocalDisplay(draft.failedAt) : 'time unavailable')
    : (mode === 'posted'
      ? (draft.postedAt ? isoToLocalDisplay(draft.postedAt) : 'posted time unavailable')
      : (draft.approvedAt ? `approved ${isoToLocalDisplay(draft.approvedAt)}` : 'approved time unavailable'));
  const status = mode === 'failed' ? 'failed' : (draft.status || mode);
  const action = mode === 'draft'
    ? `<button class="button primary" data-schedule-approved="${escapeHtml(draft.id)}">Schedule this</button>`
    : '';
  const note = mode === 'failed'
    ? `<p class="queue-failure-note">${escapeHtml(draft.error || draft.reason || 'Failed schedule receipt unavailable. Check diagnostics/audit log for the exact Postiz response.')}</p>`
    : '';
  return `<article class="queue-draft-card" data-approved-draft="${escapeHtml(draft.id || '')}">
    <div class="tweet-author"><span class="avatar-fallback">L</span><div><strong>LUCAS</strong><span>@LucasSynnott · ${escapeHtml(time)}</span></div></div>
    <p>${escapeHtml(draft.text || draft.content || '(draft text unavailable)')}</p>
    ${note}
    <div class="draft-meta"><span class="pill status-${escapeHtml(status)}">${escapeHtml(status)}</span><span class="pill">${escapeHtml(String((draft.text || draft.content || '').length))}/280</span><span class="pill">${refs} source ref(s)</span></div>
    ${action ? `<div class="queue-card-actions">${action}</div>` : ''}
  </article>`;
}

function wireQueueDraftActions(drafts) {
  $$('[data-schedule-approved]').forEach(button => button.addEventListener('click', event => {
    const draft = drafts.find(item => item.id === event.currentTarget.dataset.scheduleApproved);
    selectDraftForSchedule(draft);
    const panel = $('#queueEditPanel');
    if (panel) panel.hidden = false;
    $('#scheduledAt')?.focus();
  }));
}

function renderQueueTabCounts({ scheduledCount, draftCount, postedCount, failedCount }) {
  if ($('#queueDraftCount')) $('#queueDraftCount').textContent = String(draftCount || 0);
  if ($('#queuePostedCount')) $('#queuePostedCount').textContent = String(postedCount || 0);
  if ($('#queueFailedCount')) $('#queueFailedCount').textContent = String(failedCount || 0);
  $$('.queue-tab').forEach(button => button.classList.toggle('active', button.datasetQueueTab === state.queueTab || button.dataset.queueTab === state.queueTab));
}

function fallbackQueueDays(slots = []) {
  const slotPlan = Array.isArray(slots) && slots.length
    ? slots.map(slot => ({ weekday: slot.weekday, hour: slot.hour, label: slot.label || 'Press “Add to Queue” to schedule your post', status: 'slot' }))
    : [
        { weekday: 0, hour: 11, label: 'Press “Add to Queue” to schedule your post', status: 'placeholder' },
        { weekday: 1, hour: 10, label: 'Press “Add to Queue” to schedule your post', status: 'placeholder' },
        { weekday: 2, hour: 13, label: 'Press “Add to Queue” to schedule your post', status: 'placeholder' },
        { weekday: 3, hour: 9, label: 'Press “Add to Queue” to schedule your post', status: 'placeholder' },
        { weekday: 4, hour: 11, label: 'Press “Add to Queue” to schedule your post', status: 'placeholder' },
        { weekday: 4, hour: 13, label: 'Press “Add to Queue” to schedule your post', status: 'placeholder' }
      ];
  const days = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let offset = 0; offset < 14 && days.length < 10; offset++) {
    const d = new Date(today);
    d.setDate(today.getDate() + offset);
    const matching = slotPlan.filter(slot => slot.weekday === d.getDay()).sort((a, b) => a.hour - b.hour);
    if (!matching.length) continue;
    const isoBase = d.toISOString().slice(0, 10);
    const labels = queueItemDateLabel(d.toISOString());
    days.push({
      day: isoBase,
      ...labels,
      items: matching.map((slot, index) => ({
        id: `slot-${isoBase}-${slot.hour}-${index}`,
        status: slot.status,
        calendarAt: new Date(d.getFullYear(), d.getMonth(), d.getDate(), slot.hour, 0, 0, 0).toISOString(),
        text: slot.label,
        placeholder: true
      }))
    });
  }
  return days;
}

function renderApprovedIntake() {
  const q = state.scheduleQueue || {};
  const intake = Array.isArray(q.approvedIntake) ? q.approvedIntake : [];
  const summaryEl = $('#approvedIntakeSummary');
  if (summaryEl) {
    summaryEl.textContent = `${intake.length} approved draft(s) waiting for a schedule.`;
    summaryEl.style.display = 'none';
  }
  const list = $('#approvedIntakeList');
  if (!list) return;
  list.style.display = 'none';
  if (!intake.length) {
    list.className = 'approved-intake-list empty';
    list.textContent = 'No approved drafts waiting for schedule.';
    return;
  }
  list.className = 'approved-intake-list';
  list.innerHTML = intake.map(draft => {
    const refs = Array.isArray(draft.sourceRefs) ? draft.sourceRefs : [];
    const warnings = draftWarnings(draft.text || '', draft.warnings || []);
    const gateStatus = draft.gateStatus || 'clean';
    const gateScore = draft.gateScore !== undefined ? ` (${draft.gateScore})` : '';
    const sourceRefs = refs.length
      ? `<div class="draft-sourceRefs">Sources: ${refs.map(ref => `<code>${escapeHtml(ref)}</code>`).join(' ')}</div>`
      : '<div class="draft-sourceRefs">Sources: none attached</div>';
    return `<article class="approved-intake-card" data-approved-draft="${escapeHtml(draft.id)}">
      <div class="approved-intake-main">
        <header><strong>${escapeHtml(draft.angle || 'Approved draft')}</strong><span>${escapeHtml(String((draft.text || '').length))}/280</span></header>
        <p>${escapeHtml(draft.text || '')}</p>
        ${sourceRefs}
        <div class="draft-meta">
          <span class="pill status-approved">approved</span>
          <span class="pill gate-${escapeHtml(gateStatus)}">gate: ${escapeHtml(gateStatus)}${escapeHtml(gateScore)}</span>
          ${warnings.map(warning => `<span class="pill warn">${escapeHtml(warning)}</span>`).join('')}
        </div>
      </div>
      <div class="approved-intake-actions">
        <button class="button primary" data-schedule-approved="${escapeHtml(draft.id)}">Schedule this</button>
      </div>
    </article>`;
  }).join('');
  $$('[data-schedule-approved]').forEach(button => button.addEventListener('click', event => {
    const draft = intake.find(item => item.id === event.currentTarget.dataset.scheduleApproved);
    selectDraftForSchedule(draft);
    $('#scheduledAt')?.focus();
  }));
}

function renderQueueList(days) {
  const listEl = $('#queueListCalendar');
  if (!listEl) return;
  const flat = days.flatMap(day => day.items.map(item => ({ ...item, day: day.day, weekdayLabel: day.weekdayLabel || day.dayName })));
  if (!flat.length) {
    listEl.className = 'queue-list-calendar empty';
    listEl.textContent = 'No queue items for this tab.';
    return;
  }
  listEl.className = 'queue-list-calendar';
  listEl.innerHTML = flat.map(item => {
    const text = (item.text || item.content || '').slice(0, 110) + ((item.text || item.content || '').length > 110 ? '…' : '');
    return `<div class="queue-list-item"><span class="calendar-time">${escapeHtml(item.day)} ${escapeHtml(calendarItemTime(item))}</span><span class="calendar-text">${escapeHtml(text || 'content unavailable')}</span><span class="pill status-${escapeHtml(item.status || state.queueTab)}">${escapeHtml(item.status || state.queueTab)}</span></div>`;
  }).join('');
}

function syncCalendarViewVisibility() {
  const week = $('#queueCalendar');
  const list = $('#queueListCalendar');
  if (week) {
    week.hidden = state.calendarView !== 'week';
    week.style.display = state.calendarView === 'week' ? '' : 'none';
  }
  if (list) {
    list.hidden = state.calendarView !== 'list';
    list.style.display = state.calendarView === 'list' ? '' : 'none';
  }
  $$('[data-calendar-view]').forEach(button => button.classList.toggle('active', button.dataset.calendarView === state.calendarView));
}

function renderScheduleQueue() {
  const q = state.scheduleQueue || {};
  const summary = q.summary || { total: 0, byStatus: {}, conflictCount: 0 };
  const rawDays = Array.isArray(q.days) ? q.days : [];
  const conflicts = Array.isArray(q.conflicts) ? q.conflicts : [];
  const drafts = Array.isArray(q.approvedIntake) ? q.approvedIntake : [];
  const posted = Array.isArray(q.posted) ? q.posted : rawDays.flatMap(day => day.items || []).filter(item => item.status === 'posted');
  const failed = Array.isArray(q.failed) ? q.failed : [];
  const scheduledDays = rawDays.map(day => ({ ...day, items: (day.items || []).filter(item => item.status === 'scheduled') })).filter(day => day.items.length);
  const displayScheduledDays = scheduledDays.length ? scheduledDays : fallbackQueueDays(q.slots || []);
  renderApprovedIntake();
  renderQueueTabCounts({ scheduledCount: scheduledDays.reduce((n, day) => n + day.items.length, 0), draftCount: drafts.length, postedCount: posted.length, failedCount: failed.length });

  const summaryEl = $('#queueSummary');
  if (summaryEl) {
    const parts = [];
    parts.push(`${summary.totalScheduled || scheduledDays.reduce((n, day) => n + day.items.length, 0)} scheduled`);
    parts.push(`${posted.length || summary.totalPosted || 0} posted`);
    parts.push(`${drafts.length || summary.totalApproved || 0} draft(s)`);
    parts.push(`${failed.length} failed receipt(s)`);
    parts.push(`${summary.conflictCount || conflicts.length} conflict(s)`);
    parts.push(`${(q.slots || []).length} slot(s)`);
    if (state.config && !state.config.postizConfigured) parts.push('Postiz safe-blocked');
    summaryEl.textContent = parts.join(' · ');
  }

  const conflictEl = $('#conflictList');
  if (conflictEl) {
    if (state.queueTab !== 'scheduled' || !conflicts.length) {
      conflictEl.className = 'conflict-list empty';
      conflictEl.textContent = state.queueTab === 'scheduled' ? 'No conflicts in the current queue.' : 'Conflicts only apply to scheduled slots.';
    } else {
      conflictEl.className = 'conflict-list';
      conflictEl.innerHTML = conflicts.map(c => {
        const aWhen = isoToLocalDisplay(c.a.scheduledAt);
        const bWhen = isoToLocalDisplay(c.b.scheduledAt);
        const aAngle = c.a.angle || c.a.text?.slice(0, 40) || c.a.id;
        const bAngle = c.b.angle || c.b.text?.slice(0, 40) || c.b.id;
        return `<div class="conflict-pair"><strong>${escapeHtml(aWhen)}</strong> · <span>${escapeHtml(aAngle)}</span> ↔ <strong>${escapeHtml(bWhen)}</strong> · <span>${escapeHtml(bAngle)}</span><span class="pill warn">Δ ${c.deltaMinutes >= 0 ? '+' : ''}${c.deltaMinutes} min</span></div>`;
      }).join('');
    }
  }

  const calEl = $('#queueCalendar');
  let days = displayScheduledDays;
  if (state.queueTab === 'drafts') days = queueGroupByDay(drafts);
  if (state.queueTab === 'posted') days = queueGroupByDay(posted);
  if (state.queueTab === 'failed') days = queueGroupByDay(failed);

  if (!days.length) {
    calEl.className = 'superx-queue-list empty';
    const emptyCopy = {
      scheduled: 'No scheduled posts yet. Press “Add to Queue”/schedule an approved draft to fill these slots.',
      drafts: 'No approved/generated drafts ready to schedule. Generate posts, review them, then approve before scheduling.',
      posted: 'No local/Postiz posted receipts available. This app will label posted status here only when stored locally.',
      failed: 'No failed schedule receipts recorded. If Postiz credentials are missing, schedule attempts remain safe-blocked and appear in diagnostics.'
    };
    calEl.textContent = emptyCopy[state.queueTab] || 'No queue items.';
    renderQueueList([]);
    syncCalendarViewVisibility();
    renderCommandCenter();
    return;
  }

  calEl.className = 'superx-queue-list';
  calEl.innerHTML = days.map(day => {
    const items = (day.items || []).map(item => {
      if (state.queueTab === 'drafts') return queueDraftCard(item, { mode: 'draft' });
      if (state.queueTab === 'posted') return queueDraftCard(item, { mode: 'posted' });
      if (state.queueTab === 'failed') return queueDraftCard(item, { mode: 'failed' });
      const text = (item.text || '').slice(0, 110) + ((item.text || '').length > 110 ? '…' : '');
      return `<div class="superx-time-slot ${item.status === 'scheduled' ? 'filled' : ''}"><span class="slot-time-label">${escapeHtml(calendarItemTime(item))}</span><span class="slot-empty-copy">${text ? escapeHtml(text) : 'Press “Add to Queue” to schedule your post'}</span><span class="pill status-${escapeHtml(item.status || 'scheduled')}">${escapeHtml(item.status || 'scheduled')}</span></div>`;
    }).join('');
    return `<section class="queue-day-section"><h3><strong>${escapeHtml(day.dayName || day.weekdayLabel || day.day)}</strong> <span>${escapeHtml(day.dateLabel || day.day)}</span></h3><div class="queue-day-slots">${items}</div></section>`;
  }).join('');
  if (state.queueTab === 'drafts') wireQueueDraftActions(drafts);
  renderQueueList(days);
  syncCalendarViewVisibility();
  renderCommandCenter();
}

async function loadSuggestions() {
  setStatus($('#suggestStatus'), 'Loading suggestions…');
  try {
    const payload = { lookaheadDays: Number($('#suggestLookahead')?.value || 7) };
    const fromVal = $('#suggestFrom')?.value?.trim();
    if (fromVal) {
      const d = new Date(fromVal);
      if (!Number.isNaN(d.getTime())) payload.fromDate = d.toISOString();
    }
    const response = await fetch('/api/tweet-lab/schedule/suggest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Suggest failed with HTTP ${response.status}`);
    state.suggestions = data;
    renderSuggestions();
    const total = data.suggestions?.length || 0;
    const days = data.bestForDay?.length || 0;
    setStatus($('#suggestStatus'), `${total} suggestion(s) across ${days} day(s) from ${data.slotCount} slot(s) and ${data.scheduledCount} scheduled draft(s).`, total ? 'ok' : '');
  } catch (error) {
    setStatus($('#suggestStatus'), error.message, 'error');
  }
}

function renderSuggestions() {
  const list = $('#suggestionsList');
  const suggestions = state.suggestions?.suggestions || [];
  const bestForDay = state.suggestions?.bestForDay || [];
  if (!bestForDay.length) {
    list.className = 'suggestions-list empty';
    list.innerHTML = suggestions.length === 0
      ? emptyStateHtml({
          title: 'No posting-time suggestions yet.',
          body: 'Configure real slots or seed local demo slots. Suggestions are planning aids only; they never publish posts.',
          steps: ['Add or seed slots.', 'Refresh suggestions.', 'Use one in the Postiz schedule form after draft approval.'],
          actions: ['<button class="button ghost" data-empty-action="seed-slots">Seed local example slots</button>']
        })
      : emptyStateHtml({ title: 'No suggestions inside the lookahead window.', body: `${suggestions.length} suggestion(s) exist outside the selected range. Increase lookahead or choose a new start date.` });
    $$('[data-empty-action="seed-slots"]').forEach(button => button.addEventListener('click', seedDefaultSlots));
    renderCommandCenter();
    return;
  }
  list.className = 'suggestions-list';
  list.innerHTML = bestForDay.map(s => {
    const when = isoToLocalDisplay(s.iso);
    const conflictPill = s.conflict
      ? `<span class="pill warn">${s.nearDrafts.length} near</span>`
      : `<span class="pill ok">clear</span>`;
    return `<div class="suggestion-row" data-iso="${escapeHtml(s.iso)}">
      <div class="suggestion-when">
        <strong>${escapeHtml(when)}</strong>
        <span>${escapeHtml(s.weekdayLabel)} · ${escapeHtml(String(s.hour).padStart(2, '0'))}:00 ${escapeHtml(s.timezone || 'UTC')}</span>
      </div>
      <div class="suggestion-label">
        <span>${escapeHtml(s.label || 'Unnamed slot')}</span>
        <span class="muted">score ${s.score}</span>
      </div>
      <div class="suggestion-actions">
        ${conflictPill}
        <button class="button ghost" data-use-suggestion="${escapeHtml(s.iso)}">Use</button>
      </div>
    </div>`;
  }).join('');
  $$('[data-use-suggestion]').forEach(button => button.addEventListener('click', event => {
    const iso = event.currentTarget.dataset.useSuggestion;
    const target = $('#scheduledAt');
    if (target) target.value = isoToLocalDateTimeInput(iso);
    clearConflictWarning();
    setStatus($('#scheduleStatus'), `Loaded suggested time ${isoToLocalDisplay(iso)} into schedule form.`, 'ok');
  }));
  renderCommandCenter();
}

async function loadSlots() {
  try {
    const response = await fetch('/api/tweet-lab/store/scheduleSlots');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Slots load failed with HTTP ${response.status}`);
    const slots = Array.isArray(data) ? data : [];
    state.scheduleQueue = { ...state.scheduleQueue, slots };
    renderSlots();
  } catch (error) {
    setStatus($('#slotStatus'), error.message, 'error');
  }
}

function renderSlots() {
  const list = $('#slotList');
  const slots = state.scheduleQueue?.slots || [];
  if (!slots.length) {
    list.className = 'slot-list empty';
    list.innerHTML = emptyStateHtml({
      title: 'No posting slots configured.',
      body: 'Slots create suggestion windows only. They do not publish; Postiz writes still require an approved draft and configured credentials.',
      steps: ['Add a real slot or seed local demo slots.', 'Refresh suggestions.', 'Use a clear suggestion in the schedule form.'],
      actions: ['<button class="button ghost" data-empty-action="seed-slots">Seed local example slots</button>']
    });
    $$('[data-empty-action="seed-slots"]').forEach(button => button.addEventListener('click', seedDefaultSlots));
    return;
  }
  list.className = 'slot-list';
  // Sort: weekday asc then hour asc
  const sorted = [...slots].sort((a, b) => (a.weekday - b.weekday) || (a.hour - b.hour));
  list.innerHTML = sorted.map(slot => {
    const demoBadge = isLocalDemo(slot) ? demoPill() : '';
    return `<article class="slot-card" data-id="${escapeHtml(slot.id)}">
      <div class="slot-head">
        <strong>${escapeHtml(WEEKDAY_LABELS[slot.weekday] || '?')} ${escapeHtml(String(slot.hour).padStart(2, '0'))}:00</strong>
        <span class="muted">${escapeHtml(slot.timezone || 'UTC')}</span>
      </div>
      <div class="slot-body">
        <span>${escapeHtml(slot.label || 'Unnamed slot')}</span>
        <span class="pill">weight ${escapeHtml(String(slot.weight ?? 1))}</span>
        ${demoBadge}
      </div>
      <div class="slot-actions">
        <button class="button ghost danger" data-delete-slot="${escapeHtml(slot.id)}">Delete</button>
      </div>
    </article>`;
  }).join('');
  $$('[data-delete-slot]').forEach(button => button.addEventListener('click', event => deleteSlot(event.currentTarget.dataset.deleteSlot)));
}

async function saveSlotFromForm() {
  const button = $('#addSlot');
  button.disabled = true;
  try {
    const payload = {
      weekday: Number($('#slotWeekday').value),
      hour: Number($('#slotHour').value),
      weight: Number($('#slotWeight').value || 2),
      timezone: $('#slotTimezone').value.trim() || 'UTC',
      label: $('#slotLabel').value.trim()
    };
    if (!Number.isInteger(payload.weekday) || payload.weekday < 0 || payload.weekday > 6) throw new Error('Weekday must be 0-6.');
    if (!Number.isInteger(payload.hour) || payload.hour < 0 || payload.hour > 23) throw new Error('Hour must be 0-23.');
    const response = await fetch('/api/tweet-lab/store/scheduleSlots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Slot save failed with HTTP ${response.status}`);
    setStatus($('#slotStatus'), 'Slot saved.', 'ok');
    resetSlotForm();
    await loadSlots();
    await loadSuggestions();
  } catch (error) {
    setStatus($('#slotStatus'), error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

function resetSlotForm() {
  $('#slotWeekday').value = '1';
  $('#slotHour').value = '9';
  $('#slotWeight').value = '2';
  $('#slotTimezone').value = 'UTC';
  $('#slotLabel').value = '';
}

async function deleteSlot(id) {
  try {
    const response = await fetch(`/api/tweet-lab/store/scheduleSlots/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      setStatus($('#slotStatus'), data.error || `Delete failed with HTTP ${response.status}`, 'error');
      return;
    }
    setStatus($('#slotStatus'), 'Slot deleted.', 'ok');
    await loadSlots();
    await loadSuggestions();
  } catch (error) {
    setStatus($('#slotStatus'), error.message, 'error');
  }
}

async function createStoreItem(collection, payload) {
  const response = await fetch(`/api/tweet-lab/store/${collection}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `${collection} create failed with HTTP ${response.status}`);
  return data;
}

async function deleteStoreItem(collection, id) {
  const response = await fetch(`/api/tweet-lab/store/${collection}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  const data = await response.json();
  if (!response.ok && response.status !== 404) throw new Error(data.error || `${collection} delete failed with HTTP ${response.status}`);
  return data;
}

async function seedDemoSources() {
  const button = $('#seedDemoSources');
  if (button) button.disabled = true;
  try {
    for (const id of DEMO_SOURCE_IDS) await deleteStoreItem('sources', id);
    for (const source of DEMO_SOURCES) await createStoreItem('sources', source);
    setStatus($('#sourceStatus'), `Seeded ${DEMO_SOURCES.length} local demo source(s). They are labeled as examples, not live X data.`, 'ok');
    await loadSources();
  } catch (error) {
    setStatus($('#sourceStatus'), error.message, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

async function resetDemoSources() {
  const button = $('#resetDemoSources');
  if (button) button.disabled = true;
  try {
    const demoIds = state.sources.filter(isLocalDemo).map(source => source.id);
    for (const id of demoIds) await deleteStoreItem('sources', id);
    setStatus($('#sourceStatus'), `Removed ${demoIds.length} local demo source(s).`, 'ok');
    await loadSources();
  } catch (error) {
    setStatus($('#sourceStatus'), error.message, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

async function seedDemoTemplates() {
  const button = $('#seedDemoTemplates');
  if (button) button.disabled = true;
  try {
    for (const id of DEMO_TEMPLATE_IDS) await deleteStoreItem('templates', id);
    for (const template of DEMO_TEMPLATES) await createStoreItem('templates', template);
    setStatus($('#templateStatus'), `Seeded ${DEMO_TEMPLATES.length} local demo template(s).`, 'ok');
    await loadTemplates();
  } catch (error) {
    setStatus($('#templateStatus'), error.message, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

async function resetDemoTemplates() {
  const button = $('#resetDemoTemplates');
  if (button) button.disabled = true;
  try {
    const demoIds = (state.templates || []).filter(isLocalDemo).map(template => template.id);
    for (const id of demoIds) await deleteStoreItem('templates', id);
    setStatus($('#templateStatus'), `Removed ${demoIds.length} local demo template(s).`, 'ok');
    await loadTemplates();
  } catch (error) {
    setStatus($('#templateStatus'), error.message, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

async function seedDefaultSlots() {
  const button = $('#seedSlots');
  if (button) button.disabled = true;
  try {
    const currentDemoSlots = (state.scheduleQueue?.slots || []).filter(isLocalDemo);
    for (const slot of currentDemoSlots) await deleteStoreItem('scheduleSlots', slot.id);
    for (const slot of DEMO_SLOTS) await createStoreItem('scheduleSlots', slot);
    setStatus($('#slotStatus'), `Seeded ${DEMO_SLOTS.length} local demo slot(s). They are suggestions only and do not schedule posts.`, 'ok');
    await loadSlots();
    await loadSuggestions();
  } catch (error) {
    setStatus($('#slotStatus'), error.message, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

async function resetDemoSlots() {
  const button = $('#resetDemoSchedule');
  if (button) button.disabled = true;
  try {
    const demoSlots = (state.scheduleQueue?.slots || []).filter(isLocalDemo);
    for (const slot of demoSlots) await deleteStoreItem('scheduleSlots', slot.id);
    setStatus($('#slotStatus'), `Removed ${demoSlots.length} local demo slot(s).`, 'ok');
    await loadSlots();
    await loadSuggestions();
  } catch (error) {
    setStatus($('#slotStatus'), error.message, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

async function checkConflictForScheduledAt() {
  const localValue = $('#scheduledAt').value;
  if (!localValue) { clearConflictWarning(); return; }
  const scheduledAt = new Date(localValue).toISOString();
  const draftId = $('#scheduleDraftId').value.trim();
  try {
    const response = await fetch('/api/tweet-lab/schedule/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scheduledAt, draftId: draftId || undefined })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Conflict check failed with HTTP ${response.status}`);
    renderConflictWarning(data.conflicts, data.windowMinutes, 'this scheduled time');
  } catch (error) {
    clearConflictWarning();
    setStatus($('#scheduleStatus'), `Conflict pre-check failed: ${error.message}`, 'error');
  }
}


function parseTime(value) {
  const t = Date.parse(value || '');
  return Number.isFinite(t) ? t : null;
}

function analyticsRangeDays() {
  const value = Number($('#analyticsRange')?.value || 30);
  return Number.isFinite(value) ? value : 30;
}

function analyticsWindowItems(items, days) {
  const start = Date.now() - days * 86400000;
  return (items || []).filter(item => {
    const t = parseTime(item.createdAt || item.updatedAt || item.scheduledAt || item.postedAt || item.fetchedAt);
    return t === null || t >= start;
  });
}

function analyticsDayKey(value) {
  const t = parseTime(value);
  if (t === null) return null;
  return new Date(t).toISOString().slice(0, 10);
}

function analyticsSeries(items, days, dateGetter) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const buckets = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    buckets.push({ key: d.toISOString().slice(0, 10), value: 0 });
  }
  const map = new Map(buckets.map(b => [b.key, b]));
  (items || []).forEach(item => {
    const key = analyticsDayKey(dateGetter(item));
    if (key && map.has(key)) map.get(key).value += 1;
  });
  return buckets;
}

function sparklineSvg(series, { area = true } = {}) {
  const width = 420;
  const height = 104;
  const max = Math.max(1, ...series.map(p => p.value));
  const step = series.length > 1 ? width / (series.length - 1) : width;
  const points = series.map((p, i) => `${Math.round(i * step)},${Math.round(height - (p.value / max) * 76 - 14)}`);
  const areaPath = `M0,${height} L${points.join(' L')} L${width},${height} Z`;
  const linePath = `M${points.join(' L')}`;
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="local metric trend" preserveAspectRatio="none">
    <defs><linearGradient id="metricBlue" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#20a8ff" stop-opacity="0.88"/><stop offset="1" stop-color="#20a8ff" stop-opacity="0.03"/></linearGradient></defs>
    ${area ? `<path class="chart-area" d="${areaPath}"></path>` : ''}
    <path class="chart-line" d="${linePath}"></path>
  </svg>`;
}

function statusCount(drafts, status) {
  return drafts.filter(d => (d.status || 'generated') === status).length;
}

function sumSourceMetric(sources, keys) {
  return sources.reduce((total, source) => {
    const metrics = source.engagement || {};
    const value = keys.reduce((sum, key) => sum + Number(metrics[key] || metrics[key.toLowerCase()] || 0), 0);
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);
}

function buildAnalyticsSnapshot() {
  const days = analyticsRangeDays();
  const windowDrafts = analyticsWindowItems(state.drafts, days);
  const windowSources = analyticsWindowItems(state.sources, days);
  const scheduledItems = state.drafts.filter(d => d.scheduledAt || d.postedAt || ['scheduled', 'posted'].includes(d.status));
  const localEngagementSources = windowSources.filter(s => s.engagement && Object.keys(s.engagement).length);
  const draftSeries = analyticsSeries(windowDrafts, days, d => d.createdAt || d.updatedAt);
  const scheduledSeries = analyticsSeries(scheduledItems, days, d => d.scheduledAt || d.postedAt || d.updatedAt || d.createdAt);
  const sourceSeries = analyticsSeries(windowSources, days, s => s.fetchedAt || s.createdAt || s.updatedAt);
  const approvedSeries = analyticsSeries(windowDrafts.filter(d => ['approved', 'scheduled', 'posted'].includes(d.status)), days, d => d.approvedAt || d.updatedAt || d.createdAt);
  // Prefer real account analytics (my own tweets' impressions + live follower
  // count) when available; fall back to stored source snapshots.
  const xa = state.xAnalytics || null;
  const xLive = Boolean(xa && (xa.impressions || xa.followers != null));
  const impressions = (xa && xa.impressions) ? xa.impressions : sumSourceMetric(localEngagementSources, ['impressionCount', 'impression_count']);
  const engagement = (xa && xa.engagement) ? xa.engagement : sumSourceMetric(localEngagementSources, ['likeCount', 'repostCount', 'replyCount', 'quoteCount', 'like_count', 'repost_count', 'reply_count', 'quote_count']);
  const latestProfile = windowSources.map(s => s.authorProfile?.publicMetrics).find(Boolean) || null;
  const followers = (xa && xa.followers != null) ? xa.followers : latestProfile?.followers_count;
  const xSeries = (xa && Array.isArray(xa.series) && xa.series.length) ? xa.series : null;
  return {
    xLive,
    followers,
    xSeries,
    days,
    windowDrafts,
    windowSources,
    scheduledItems,
    localEngagementSources,
    draftSeries,
    scheduledSeries,
    sourceSeries,
    approvedSeries,
    impressions,
    engagement,
    totals: {
      generated: windowDrafts.length,
      scheduledPosted: scheduledItems.length,
      approved: statusCount(windowDrafts, 'approved') + statusCount(windowDrafts, 'scheduled') + statusCount(windowDrafts, 'posted'),
      needsProof: statusCount(windowDrafts, 'needs-proof'),
      revise: windowDrafts.filter(d => ['revise', 'blocked'].includes(d.gateStatus)).length,
      sources: windowSources.length,
      liveSources: windowSources.filter(s => (s.tags || []).includes('live-x') || s.provider === 'x-api-recent-search').length
    }
  };
}

function renderAnalyticsMetricCards(snapshot) {
  const el = $('#analyticsMetricGrid');
  if (!el) return;
  const cards = [
    { label: 'Generated drafts', value: snapshot.totals.generated, delta: `${snapshot.totals.approved} approved/ready`, series: snapshot.draftSeries, note: 'local draft records' },
    { label: 'Scheduled / posted', value: snapshot.totals.scheduledPosted, delta: `${snapshot.scheduleQueue?.summary?.conflictCount || state.scheduleQueue?.summary?.conflictCount || 0} conflicts`, series: snapshot.scheduledSeries, note: 'local queue state' },
    { label: snapshot.xLive ? 'X impressions' : (snapshot.impressions ? 'Stored source impressions' : 'X impressions unavailable'), value: snapshot.impressions || 0, delta: snapshot.xLive ? `${snapshot.engagement || 0} engagements` : (snapshot.impressions ? `${snapshot.localEngagementSources.length} source(s)` : 'no live analytics API'), series: snapshot.xSeries || snapshot.sourceSeries, note: snapshot.xLive ? 'your recent posts (live)' : 'source snapshots only' },
    { label: snapshot.xLive ? 'Followers' : (snapshot.followers ? 'Snapshot followers' : 'Followers unavailable'), value: snapshot.followers != null ? snapshot.followers : '-', delta: snapshot.xLive ? 'live account metric' : (snapshot.engagement ? `${snapshot.engagement} stored engagements` : 'not account analytics'), series: snapshot.approvedSeries, note: snapshot.xLive ? 'live from X profile' : 'latest saved profile snapshot' }
  ];
  el.innerHTML = cards.map(card => `<article class="analytics-metric-card">
    <div class="analytics-card-copy"><span>${escapeHtml(card.label)}</span><strong>${escapeHtml(formatMetric(card.value))}</strong><em>${escapeHtml(card.delta)}</em><small>${escapeHtml(card.note)}</small></div>
    <div class="analytics-sparkline">${sparklineSvg(card.series)}</div>
  </article>`).join('');
}

function currentLocalStreak(series) {
  let streak = 0;
  for (let i = series.length - 1; i >= 0; i -= 1) {
    if (series[i].value > 0) streak += 1;
    else break;
  }
  return streak;
}

function renderAnalyticsHeatmap(snapshot) {
  const el = $('#analyticsHeatmap');
  if (!el) return;
  const series = analyticsSeries([...snapshot.windowDrafts, ...snapshot.scheduledItems], Math.max(91, snapshot.days), item => item.scheduledAt || item.postedAt || item.createdAt || item.updatedAt);
  const max = Math.max(1, ...series.map(p => p.value));
  $('#analyticsStreakTitle').textContent = `${currentLocalStreak(series)}-day streak, local activity`;
  el.innerHTML = `<div class="heatmap-days"><span>Sun</span><span>Tue</span><span>Thu</span><span>Sat</span></div><div class="heatmap-grid">${series.map(point => {
    const level = point.value === 0 ? 0 : Math.max(1, Math.ceil((point.value / max) * 4));
    return `<span class="heat-cell heat-${level}" title="${escapeHtml(point.key)} · ${point.value} local item(s)"></span>`;
  }).join('')}</div><div class="heatmap-legend"><span>0</span><span class="heat-cell heat-1"></span><span class="heat-cell heat-3"></span><span class="heat-cell heat-4"></span><span>${max}</span></div>`;
}

function renderAnalyticsSmallCards(snapshot) {
  const el = $('#analyticsSmallCards');
  if (!el) return;
  const engagementCards = [
    ['Approved', snapshot.totals.approved, 'local lifecycle'],
    ['Needs proof', snapshot.totals.needsProof, 'review gate'],
    ['Revise / blocked', snapshot.totals.revise, 'review gate'],
    ['Saved sources', snapshot.totals.sources, 'source bank']
  ];
  const activityCards = [
    ['Live X source snapshots', snapshot.totals.liveSources, 'read-only saved'],
    ['Templates', state.templates?.length || 0, 'local recipes'],
    ['Queue slots', state.scheduleQueue?.slots?.length || 0, 'posting windows'],
    ['Conflicts', state.scheduleQueue?.summary?.conflictCount || 0, 'local schedule']
  ];
  const cards = state.analyticsTab === 'activity' ? activityCards : engagementCards;
  el.innerHTML = cards.map(([label, value, note]) => `<article class="analytics-small-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(formatMetric(value))}</strong><em>${escapeHtml(note)}</em>${sparklineSvg(snapshot.draftSeries, { area: false })}</article>`).join('');
}

function renderAnalyticsLargeChart(snapshot) {
  const el = $('#analyticsLargeChart');
  if (!el) return;
  const title = $('#analyticsLargeChartTitle');
  const note = $('#analyticsLargeChartNote');
  const series = state.analyticsTab === 'activity' ? snapshot.sourceSeries : snapshot.draftSeries;
  if (title) title.textContent = state.analyticsTab === 'activity' ? 'Saved Source Activity' : 'Generated Drafts';
  if (note) note.textContent = state.analyticsTab === 'activity' ? 'Local source-bank save/fetch trend over the selected range.' : 'Local draft creation trend over the selected range.';
  const max = Math.max(1, ...series.map(p => p.value));
  el.innerHTML = `<div class="large-chart-y"><span>${max}</span><span>0</span></div><div class="large-chart-plot">${sparklineSvg(series)}</div><div class="large-chart-x"><span>${escapeHtml(series[0]?.key || '')}</span><span>${escapeHtml(series.at(-1)?.key || '')}</span></div>`;
}

function renderAnalytics() {
  if (!$('#analyticsMetricGrid')) return;
  const snapshot = buildAnalyticsSnapshot();
  renderAnalyticsMetricCards(snapshot);
  renderAnalyticsHeatmap(snapshot);
  renderAnalyticsSmallCards(snapshot);
  renderAnalyticsLargeChart(snapshot);
}

function bindEvents() {
  window.addEventListener('hashchange', () => setRoute());
  $$('.nav a').forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    history.pushState(null, '', `#${link.dataset.route}`);
    setRoute(link.dataset.route);
  }));
  $('#commandCenterAction')?.addEventListener('click', runCommandCenterAction);
  $('#generateButton')?.addEventListener('click', generate);
  $('#generateTop').addEventListener('click', () => { location.hash = '#home'; $('#homeContext').focus(); });
  $('#fetchLiveTweets')?.addEventListener('click', fetchLiveTweets);
  $('#refreshLiveTweets')?.addEventListener('click', fetchLiveTweets);
  $('#clearLiveSelection')?.addEventListener('click', () => { state.selectedLiveIds.clear(); renderLiveTweets(); });
  $('#accountHandles')?.addEventListener('input', renderAccountChips);
  $('#homeFetchLiveTweets')?.addEventListener('click', homeFetchLiveTweets);
  $('#homeRefreshLiveTweets')?.addEventListener('click', homeFetchLiveTweets);
  $('#homeGenerateButton')?.addEventListener('click', homeGenerateFromContext);
  $('#homeClearLiveSelection')?.addEventListener('click', homeClearLiveSelection);
  $('#homeAccountHandles')?.addEventListener('input', renderHomeAccountChips);
  $('#homeGenerateMore')?.addEventListener('click', homeGenerateMore);
  $('#contextGenerateAction')?.addEventListener('click', runHomeGenerateAction);
  $('#openHomeSettings')?.addEventListener('click', () => $('#homeSettingsDialog')?.showModal());
  $('#openHomeSources')?.addEventListener('click', () => $('#homeSourcesDialog')?.showModal());
  $$('[data-home-topic]').forEach(button => button.addEventListener('click', event => {
    const topic = event.currentTarget.dataset.homeTopic || '';
    const field = $('#homeContext');
    if (!field) return;
    field.value = topic;
    fetchContextPacketSilently();
  }));
  // Auto-refresh context packet on Home page load (safe: read-only, cached).
  if (location.hash === '#home' || !location.hash) {
    fetchContextPacketSilently();
  }

  // Also refresh when the user navigates back to Home.
  window.addEventListener('hashchange', () => {
    if (location.hash === '#home' || !location.hash) {
      fetchContextPacketSilently();
    }
  });
  // Refresh context packet when the operator changes the context textarea.
  let contextDebounce;
  $('#homeContext')?.addEventListener('input', () => {
    clearTimeout(contextDebounce);
    contextDebounce = setTimeout(() => {
      if (location.hash === '#home' || !location.hash) {
        fetchContextPacketSilently();
      }
    }, 1500);
  });
  $('#analyticsRange')?.addEventListener('change', renderAnalytics);
  $$('[data-analytics-tab]').forEach(button => button.addEventListener('click', event => {
    state.analyticsTab = event.currentTarget.dataset.analyticsTab || 'engagement';
    $$('[data-analytics-tab]').forEach(b => b.classList.toggle('active', b === event.currentTarget));
    renderAnalytics();
  }));
  $$('[data-go-route]').forEach(button => button.addEventListener('click', event => { location.hash = `#${event.currentTarget.dataset.goRoute}`; }));
  $$('[data-tab-target]').forEach(button => button.addEventListener('click', event => {
    const target = event.currentTarget.dataset.tabTarget;
    $$('[data-tab-target]').forEach(b => b.classList.toggle('active', b === event.currentTarget));
    $$('.library-tab').forEach(tab => tab.classList.toggle('active', tab.id === target));
  }));
  $('#scheduleButton')?.addEventListener('click', schedule);
  // Draft tab switching
  $$('.superx-tab').forEach(tab => tab.addEventListener('click', event => setDraftTab(event.currentTarget.dataset.draftTab)));

  // Draft modal wiring
  $('#closeDraftModal')?.addEventListener('click', closeDraftModal);
  $('#draftEditModal')?.addEventListener('click', event => {
    if (event.target.classList.contains('draft-modal-overlay')) closeDraftModal();
  });
  $('#modalSave')?.addEventListener('click', () => {
    const draft = state.drafts.find(d => d.id === state.selectedDraftId);
    if (!draft) return;
    draft.text = $('#modalDraftEditor').value;
    saveDraftEdit(draft.id).catch(err => setStatus($('#draftStatus'), err.message, 'error'));
  });
  $('#modalReview')?.addEventListener('click', () => {
    const draft = state.drafts.find(d => d.id === state.selectedDraftId);
    if (!draft) return;
    draft.text = $('#modalDraftEditor').value;
    reviewDraftApi(draft.id).catch(err => setStatus($('#draftStatus'), err.message, 'error'));
  });
  $('#modalNeedsProof')?.addEventListener('click', () => {
    const draft = state.drafts.find(d => d.id === state.selectedDraftId);
    if (!draft) return;
    needsProofDraft(draft.id).catch(err => setStatus($('#draftStatus'), err.message, 'error'));
  });
  $('#modalApprove')?.addEventListener('click', () => {
    const draft = state.drafts.find(d => d.id === state.selectedDraftId);
    if (!draft) return;
    approveDraft(draft.id).catch(err => setStatus($('#draftStatus'), err.message, 'error'));
  });
  $('#modalCopy')?.addEventListener('click', () => {
    const draft = state.drafts.find(d => d.id === state.selectedDraftId);
    if (!draft) return;
    writeClipboard(draft.text).then(() => setStatus($('#draftStatus'), 'Draft copied.', 'ok')).catch(err => setStatus($('#draftStatus'), `Copy failed: ${err.message}`, 'error'));
  });
  $('#modalSchedule')?.addEventListener('click', () => {
    const draft = state.drafts.find(d => d.id === state.selectedDraftId);
    if (!draft) return;
    state.selectedDraftId = draft.id;
    $('#scheduleContent').value = draft.text;
    $('#scheduleDraftId').value = draft.id;
    location.hash = '#queue';
  });
  $('#modalReject')?.addEventListener('click', () => {
    const draft = state.drafts.find(d => d.id === state.selectedDraftId);
    if (!draft) return;
    const reason = $('#modalRejectReason')?.value.trim();
    if (!reason) {
      setStatus($('#draftStatus'), 'Reject reason is required.', 'error');
      return;
    }
    transitionDraft(draft.id, 'rejected', { rejectReason: reason }).catch(err => setStatus($('#draftStatus'), err.message, 'error'));
  });

  // Style drawer wiring
  $('#customizeStyleBtn')?.addEventListener('click', openStyleDrawer);
  $('#closeStyleDrawer')?.addEventListener('click', closeStyleDrawerFn);
  $('#styleDrawer')?.addEventListener('click', event => {
    if (event.target.classList.contains('style-drawer-overlay')) closeStyleDrawerFn();
  });
  $('#saveStylePrefs')?.addEventListener('click', saveStylePrefs);
  $('#resetStylePrefs')?.addEventListener('click', resetStylePrefs);

  // Generate more
  $('#generateMoreBtn')?.addEventListener('click', generateMoreDrafts);

  // Legacy filter/sort (keep for backward compat if elements still exist)
  $('#draftStatusFilter')?.addEventListener('change', renderDrafts);
  $('#draftSort')?.addEventListener('change', renderDrafts);
  $('#refreshDrafts')?.addEventListener('click', loadDrafts);
  $('#clearDrafts')?.addEventListener('click', () => { state.drafts = []; renderDrafts(); });
  $('#saveSource')?.addEventListener('click', saveSource);
  $('#resetSourceForm')?.addEventListener('click', resetSourceForm);
  $('#seedDemoSources')?.addEventListener('click', seedDemoSources);
  $('#resetDemoSources')?.addEventListener('click', resetDemoSources);
  $('#refreshSources')?.addEventListener('click', loadSources);
  $('#exportSources')?.addEventListener('click', exportSources);
  $('#importSources')?.addEventListener('click', importSources);
  $('#buildQueue')?.addEventListener('click', buildQueueUI);
  $('#generateFromQueue')?.addEventListener('click', generateFromQueue);
  $('#homeTemplateSelect')?.addEventListener('change', renderHomeRecipeCardSelector);
  $('#templateSelect')?.addEventListener('change', renderRecipeCardSelector);
  $('#saveTemplate')?.addEventListener('click', saveTemplate);
  $('#resetTemplateForm')?.addEventListener('click', resetTemplateForm);
  $('#seedDemoTemplates')?.addEventListener('click', seedDemoTemplates);
  $('#resetDemoTemplates')?.addEventListener('click', resetDemoTemplates);
  $('#refreshTemplates')?.addEventListener('click', loadTemplates);
  $('#exportTemplates')?.addEventListener('click', exportTemplates);
  $('#importTemplates')?.addEventListener('click', importTemplates);
  $('#refreshSuggestions')?.addEventListener('click', loadSuggestions);
  $('#seedSlots')?.addEventListener('click', seedDefaultSlots);
  $('#resetDemoSchedule')?.addEventListener('click', resetDemoSlots);
  $('#addSlot')?.addEventListener('click', saveSlotFromForm);
  $('#resetSlotForm')?.addEventListener('click', resetSlotForm);
  $('#refreshQueue')?.addEventListener('click', loadScheduleQueue);
  $('#refreshApprovedIntake')?.addEventListener('click', loadScheduleQueue);
  $('#browsePosts')?.addEventListener('click', () => setQueueTab('drafts'));
  $('#editQueueButton')?.addEventListener('click', () => { const panel = $('#queueEditPanel'); if (panel) panel.hidden = !panel.hidden; });
  $$('.queue-tab').forEach(button => button.addEventListener('click', event => setQueueTab(event.currentTarget.dataset.queueTab)));
  $$('.queue-dismiss').forEach(button => button.addEventListener('click', event => event.currentTarget.closest('.queue-banner')?.remove()));
  $$('[data-calendar-view]').forEach(button => button.addEventListener('click', event => {
    state.calendarView = event.currentTarget.dataset.calendarView || 'week';
    syncCalendarViewVisibility();
  }));
  $('#conflictWindowSelect')?.addEventListener('change', loadScheduleQueue);
  $('#suggestLookahead')?.addEventListener('change', loadSuggestions);
  const scheduledAtEl = $('#scheduledAt');
  if (scheduledAtEl) scheduledAtEl.addEventListener('change', checkConflictForScheduledAt);
  const scheduleDraftIdEl = $('#scheduleDraftId');
  if (scheduleDraftIdEl) scheduleDraftIdEl.addEventListener('change', checkConflictForScheduledAt);
  ['#templateSearch', '#templateTagFilter', '#templateFormatFilter'].forEach(selector => {
    const el = $(selector);
    if (el) { el.addEventListener('input', renderTemplates); el.addEventListener('change', renderTemplates); }
  });
  ['#sourceSearch', '#sourceTagFilter', '#sourceAuthorFilter', '#sourceFormatFilter', '#sourceCollectionFilter', '#sourceMinQualityFilter', '#sourceHookPatternFilter', '#sourceStaleFilter', '#sourceSortBy'].forEach(selector => {
    const el = $(selector);
    if (el) { el.addEventListener('input', renderSources); el.addEventListener('change', renderSources); }
  });
  $$('[data-inspiration-tab]').forEach(button => button.addEventListener('click', event => {
    state.inspirationTab = event.currentTarget.dataset.inspirationTab || 'posts';
    renderInspiration();
  }));
  ['#inspirationSearch', '#inspirationTimeRange', '#inspirationSourceScope'].forEach(selector => {
    const el = $(selector);
    if (el) { el.addEventListener('input', renderInspiration); el.addEventListener('change', renderInspiration); }
  });
  $('#inspirationSearchButton')?.addEventListener('click', runInspirationSearch);
  $('#inspirationRefresh')?.addEventListener('click', () => { loadSources(); renderInspiration(); });
  $('#openSourceBankTools')?.addEventListener('click', () => { const tools = $('#sourceBankTools'); if (tools) { tools.open = !tools.open; if (tools.open) tools.scrollIntoView({ block: 'start', behavior: 'smooth' }); } });
  $$('[data-topic-chip]').forEach(button => button.addEventListener('click', event => {
    $('#inspirationSearch').value = event.currentTarget.dataset.topicChip || '';
    renderInspiration();
  }));
  // Mentions page wiring: account selector, refresh, demo seed, and route
  // change bootstrap. The feed is rendered on every entry so a fresh live
  // fetch is never required to view the page.
  bindMentionsEvents();
  setupMobileCollapsibles();
  renderMobileActionBar();
  bindNetworkEvents();
}

async function buildQueueUI() {
  const button = $('#buildQueue');
  button.disabled = true;
  setStatus($('#queueStatus'), 'Building queue…');
  try {
    const payload = {
      tag: $('#queueTag').value.trim(),
      format: $('#queueFormat').value,
      count: Number($('#queueCount').value)
    };
    const response = await fetch('/api/tweet-lab/queue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Queue failed with HTTP ${response.status}`);
    state.queue = Array.isArray(data.queue) ? data.queue : [];
    state.queueSelectedIds.clear();
    renderQueue();
    $('#queueReceipt').textContent = JSON.stringify({
      totalSources: data.totalSources,
      filters: data.filters,
      returned: data.queue.length
    }, null, 2);
    setStatus($('#queueStatus'), `Queue built: ${data.queue.length} source(s) from ${data.totalSources} total.`, 'ok');
  } catch (error) {
    setStatus($('#queueStatus'), error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

function renderQueue() {
  const list = $('#queueList');
  const queue = state.queue;
  if (!queue.length) {
    list.className = 'source-list empty';
    list.innerHTML = emptyStateHtml({
      title: 'No saved-source queue built yet.',
      body: 'The queue turns saved local sources into selected drafting inputs. Demo sources can teach the flow, but they remain local examples only.',
      steps: ['Save real sources from Workbench or seed local examples.', 'Choose filters, then Build queue.', 'Select cards and Generate from selected.'],
      actions: ['<button class="button ghost" data-empty-action="seed-sources">Seed local example sources</button>']
    });
    $$('[data-empty-action="seed-sources"]').forEach(button => button.addEventListener('click', seedDemoSources));
    $('#queueSelectedCount').textContent = '0';
    $('#generateFromQueue').disabled = true;
    renderCommandCenter();
    return;
  }
  list.className = 'source-list';
  list.innerHTML = queue.map(source => {
    const selected = state.queueSelectedIds.has(source.id);
    const tags = Array.isArray(source.tags) ? source.tags : [];
    const qualityLabel = source.qualityScore ? `★ ${source.qualityScore}` : '';
    const staleBadge = source.stale === true ? '<span class="pill stale">stale</span>' : source.stale === false ? '<span class="pill fresh">fresh</span>' : '';
    const collectionBadge = source.collection ? `<span class="pill collection">${escapeHtml(source.collection)}</span>` : '';
    const hookBadge = source.hookPattern ? `<span class="pill hook">${escapeHtml(source.hookPattern)}</span>` : '';
    const demoBadge = isLocalDemo(source) ? demoPill() : '';
    return `
      <article class="source-card ${selected ? 'selected' : ''} ${source.stale === true ? 'stale-card' : ''}" data-queue-id="${escapeHtml(source.id)}">
        <header>
          <div>
            <input type="checkbox" class="queue-select" data-queue-id="${escapeHtml(source.id)}" ${selected ? 'checked' : ''}>
            <strong>${escapeHtml(source.author || 'unknown author')}</strong>
            <span>${escapeHtml(source.sourceType || 'source')}${source.format ? ` · ${escapeHtml(source.format)}` : ''}${qualityLabel ? ` · ${escapeHtml(qualityLabel)}` : ''}</span>
          </div>
        </header>
        ${source.url ? `<a class="source-url" href="${escapeHtml(safeExternalUrl(source.url))}" target="_blank" rel="noreferrer">${escapeHtml(safeExternalUrl(source.url))}</a>` : ''}
        <p>${escapeHtml(source.text || '(no source text saved)')}</p>
        ${source.suggestedAngle ? `<p class="source-why">Suggested angle: ${escapeHtml(source.suggestedAngle)}</p>` : ''}
        ${source.whyItMayWork ? `<p class="source-why">Why it may work: ${escapeHtml(source.whyItMayWork)}</p>` : ''}
        <div class="draft-meta">
          ${collectionBadge}
          ${hookBadge}
          ${staleBadge}
          ${demoBadge}
          ${tags.map(tag => `<span class="pill">${escapeHtml(tag)}</span>`).join('')}
        </div>
      </article>`;
  }).join('');
  $$('.queue-select').forEach(checkbox => {
    checkbox.addEventListener('change', event => {
      const id = event.target.dataset.queueId;
      if (event.target.checked) state.queueSelectedIds.add(id);
      else state.queueSelectedIds.delete(id);
      renderQueue();
    });
  });
  $('#queueSelectedCount').textContent = String(state.queueSelectedIds.size);
  $('#generateFromQueue').disabled = state.queueSelectedIds.size === 0;
  renderCommandCenter();
}

async function generateFromQueue() {
  const button = $('#generateFromQueue');
  button.disabled = true;
  setStatus($('#queueStatus'), 'Goro is drafting from selected sources…');
  try {
    const selectedSources = state.queue.filter(s => state.queueSelectedIds.has(s.id));
    const payload = {
      selectedSources,
      context: $('#queueTag').value.trim() ? `Queue filter: ${$('#queueTag').value.trim()}` : '',
      tone: 'sharp, useful, no AI slop',
      count: Math.max(1, Math.min(selectedSources.length, 3)),
      templateId: $('#templateSelect').value || undefined
    };
    const response = await fetch('/api/tweet-lab/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Generate failed with HTTP ${response.status}`);
    state.lastResult = data;
    state.drafts = Array.isArray(data.drafts) ? data.drafts : data.candidates.map(candidate => ({ ...candidate, id: `${candidate.id}-${Date.now()}` }));
    renderAdapterBadge(data);
    renderSourcePacket(data);
    renderWarnings(data);
    const promptPreview = $('#promptPreview');
    if (promptPreview) promptPreview.textContent = JSON.stringify({
      adapter: data.adapter,
      mockModeForced: data.mockModeForced,
      goroProfile: data.goroProfile,
      promptPreview: data.promptPreview,
      sourcePacket: data.sourcePacket
    }, null, 2);
    setStatus($('#queueStatus'), `Generated ${state.drafts.length} candidate(s) via ${data.adapter} from ${selectedSources.length} selected source(s).`, 'ok');
    // Update use tracking for selected sources (fire-and-forget; failures don't block the flow)
    selectedSources.forEach(source => {
      const patch = { lastUsedAt: new Date().toISOString(), useCount: (source.useCount || 0) + 1 };
      fetch(`/api/tweet-lab/store/sources/${encodeURIComponent(source.id)}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch)
      }).catch(() => { /* best effort */ });
    });
    renderDrafts();
    location.hash = '#ready-to-post';
  } catch (error) {
    setStatus($('#queueStatus'), error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

bindEvents();
setRoute();
setDefaultScheduleTime();
loadConfig();
loadDiagnostics();
loadSources();
loadTemplates();
loadDrafts();
loadSlots();
loadSuggestions();
loadScheduleQueue();
renderAdapterBadge(null);
renderSourcePacket(null);
renderWarnings(null);
renderAccountChips();
renderLiveTweets();
renderInspiration();

// ── Boot feed: pull my previous tweets on load + auto-generate drafts ──
// Satisfies the SuperX home behavior: the operator's own recent posts are
// pulled on load (voice/context), and a fresh batch of drafts is generated
// immediately so Home is never empty. Auto-generate runs once per session.
async function bootHomeFeed() {
  // Fire the live-X data pulls in parallel (fire-and-forget) so neither the
  // slow my-tweets fetch nor analytics blocks the other or the auto-generate.
  fetch('/api/tweet-lab/x-history/status?force=1')
    .then(r => r.ok ? r.json() : null)
    .then(s => { if (s) state.myTweets = (s.lastFetch && Array.isArray(s.lastFetch.tweets)) ? s.lastFetch.tweets : []; })
    .catch(() => {});
  fetch('/api/tweet-lab/x-analytics')
    .then(r => r.ok ? r.json() : null)
    .then(a => { if (a) { state.xAnalytics = a; if (typeof renderAnalytics === 'function') renderAnalytics(); } })
    .catch(() => {});
  try {
    const onHome = !location.hash || location.hash === '#home' || location.hash === '#/';
    if (onHome && !sessionStorage.getItem('tl-autogen')) {
      sessionStorage.setItem('tl-autogen', '1');
      if (typeof homeGenerateFromContext === 'function') await homeGenerateFromContext();
    }
  } catch (e) { /* auto-generate is best-effort */ }
}
bootHomeFeed();

// ── Network / Engage / Create feature wiring (Lists, Contacts, DMs) ──
//
// Three new sections of the SuperX IA. They are deliberately small,
// locally scoped, and never pretend to do work that requires X DM
// APIs, scraping, or operator-side approval flows we don't have.

const networkState = {
  lists: [],
  contacts: [],
  features: [],
  sources: [],
  editingListId: null,
  editingContactId: null,
  selectedListId: null,
  selectedContactId: null,
  contactFilter: { search: '', cadence: '' },
  listSeedFilter: ''
};

const LIST_KINDS = ['topic', 'account-group', 'watchlist', 'saved-source-group'];
const CADENCE_VALUES = ['', 'daily', 'weekly', 'monthly', 'quarterly', 'ad-hoc'];

function parseHandleList(text) {
  if (!text) return [];
  const seen = new Set();
  const out = [];
  String(text).split(/[\n,]+/).map(item => String(item || '').trim().replace(/^@+/, '')).filter(Boolean).forEach(handle => {
    if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) return;
    const key = handle.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(handle);
  });
  return out;
}

function parseTags(text) {
  return String(text || '').split(/[\n,]+/).map(item => item.trim()).filter(Boolean);
}

function formatListTimestamp(iso) {
  if (!iso) return '-';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '-';
  return dt.toLocaleString();
}

function summarizeLists() {
  const total = networkState.lists.length;
  const totalHandles = networkState.lists.reduce((acc, list) => acc + (Array.isArray(list.handles) ? list.handles.length : 0), 0);
  return { total, totalHandles };
}

function summarizeContacts() {
  const total = networkState.contacts.length;
  const byCadence = networkState.contacts.reduce((acc, contact) => {
    const key = contact.cadence || 'unspecified';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return { total, byCadence };
}

async function loadLists() {
  try {
    const response = await fetch('/api/tweet-lab/store/lists');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Lists load failed with HTTP ${response.status}`);
    networkState.lists = Array.isArray(data) ? data : [];
    renderLists();
  } catch (error) {
    const list = $('#listsList');
    if (list) {
      list.className = 'lists-list empty';
      list.textContent = `Lists load failed: ${error.message}`;
    }
  }
}

async function loadContacts() {
  try {
    const response = await fetch('/api/tweet-lab/store/contacts');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Contacts load failed with HTTP ${response.status}`);
    networkState.contacts = Array.isArray(data) ? data : [];
    renderContacts();
  } catch (error) {
    const list = $('#contactsList');
    if (list) {
      list.className = 'contacts-list empty';
      list.textContent = `Contacts load failed: ${error.message}`;
    }
  }
}

async function loadNetworkFeatures() {
  try {
    const response = await fetch('/api/tweet-lab/network');
    const data = await response.json();
    networkState.features = Array.isArray(data.features) ? data.features : [];
  } catch (error) {
    networkState.features = [];
  }
  renderDmsStatus();
}

function renderLists() {
  const summary = summarizeLists();
  const summaryEl = $('#listsSummary');
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="summary-cell"><p class="eyebrow">lists</p><strong>${summary.total}</strong><span>operator-curated groups</span></div>
      <div class="summary-cell"><p class="eyebrow">handles</p><strong>${summary.totalHandles}</strong><span>across all lists</span></div>
      <div class="summary-cell"><p class="eyebrow">storage</p><strong>local JSON</strong><span>data/tweet-lab.json</span></div>`;
  }

  const list = $('#listsList');
  if (!list) return;
  if (!networkState.lists.length) {
    list.className = 'lists-list empty';
    list.innerHTML = emptyStateHtml({
      title: 'No lists yet.',
      body: 'Create a list to group handles or saved sources. Lists stay local and are used as seed sets in Discover and live X fetches.',
      steps: ['Click "+ New list" to start.', 'Add handles (1 per line) and tags.', 'Optionally generate from the saved-source filter.'],
      actions: ['<button class="button ghost" type="button" data-new-list>+ New list</button>']
    });
    list.querySelector('[data-new-list]')?.addEventListener('click', () => openListForm(null));
    return;
  }
  list.className = 'lists-list';
  list.innerHTML = networkState.lists.map(item => {
    const handles = Array.isArray(item.handles) ? item.handles : [];
    const tags = Array.isArray(item.tags) ? item.tags : [];
    const isActive = networkState.selectedListId === item.id;
    return `
      <article class="list-row ${isActive ? 'active' : ''}" data-list-id="${escapeHtml(item.id)}">
        <header>
          <strong>${escapeHtml(item.name || '(unnamed list)')}</strong>
          <span class="pill">${escapeHtml(item.kind || 'topic')}</span>
        </header>
        <p class="muted">${escapeHtml(item.description || '-')}</p>
        <div class="list-row-meta">
          <span>${handles.length} handle(s)</span>
          <span>${tags.length} tag(s)</span>
          <span>updated ${escapeHtml(formatListTimestamp(item.updatedAt))}</span>
        </div>
        <div class="list-row-actions">
          <button type="button" class="button ghost" data-list-edit="${escapeHtml(item.id)}">Edit</button>
          <button type="button" class="button ghost danger" data-list-delete="${escapeHtml(item.id)}">Delete</button>
        </div>
      </article>`;
  }).join('');
  list.querySelectorAll('[data-list-edit]').forEach(button => button.addEventListener('click', event => openListForm(event.currentTarget.dataset.listEdit)));
  list.querySelectorAll('[data-list-delete]').forEach(button => button.addEventListener('click', event => deleteList(event.currentTarget.dataset.listDelete)));
  list.querySelectorAll('[data-list-id]').forEach(card => card.addEventListener('click', event => {
    if (event.target.closest('button')) return;
    networkState.selectedListId = card.dataset.listId;
    renderLists();
  }));
}

function openListForm(listId) {
  const panel = $('#listsFormPanel');
  const list = listId ? networkState.lists.find(item => item.id === listId) : null;
  networkState.editingListId = listId || null;
  $('#listsFormEyebrow').textContent = listId ? 'edit list' : 'new list';
  $('#listsFormTitle').textContent = listId ? (list?.name || 'Edit list') : 'New list';
  $('#listFieldName').value = list?.name || '';
  $('#listFieldKind').value = LIST_KINDS.includes(list?.kind) ? list.kind : 'topic';
  $('#listFieldDescription').value = list?.description || '';
  $('#listFieldHandles').value = Array.isArray(list?.handles) ? list.handles.join('\n') : '';
  $('#listFieldTags').value = Array.isArray(list?.tags) ? list.tags.join(', ') : '';
  $('#listFieldNotes').value = list?.notes || '';
  $('#listsFormStatus').textContent = '';
  panel.hidden = false;
  panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function closeListForm() {
  networkState.editingListId = null;
  $('#listsFormPanel').hidden = true;
  $('#listsFormStatus').textContent = '';
}

async function saveListFromForm() {
  const status = $('#listsFormStatus');
  const name = $('#listFieldName').value.trim();
  if (!name) {
    setStatus(status, 'Name is required.', 'error');
    return;
  }
  const handles = parseHandleList($('#listFieldHandles').value);
  const invalidHandles = $('#listFieldHandles').value.split(/[\n,]+/).map(item => item.trim()).filter(Boolean).filter(item => !/^[A-Za-z0-9_]{1,15}$/.test(item.replace(/^@+/, '')));
  if (invalidHandles.length) {
    setStatus(status, `Invalid handle(s): ${invalidHandles.join(', ')}. Public X handles only (1-15 chars, letters/numbers/underscores).`, 'error');
    return;
  }
  const payload = {
    name,
    kind: $('#listFieldKind').value,
    description: $('#listFieldDescription').value.trim(),
    handles,
    tags: parseTags($('#listFieldTags').value),
    notes: $('#listFieldNotes').value.trim()
  };
  try {
    let response;
    if (networkState.editingListId) {
      response = await fetch(`/api/tweet-lab/store/lists/${encodeURIComponent(networkState.editingListId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      response = await fetch('/api/tweet-lab/store/lists', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `List save failed with HTTP ${response.status}`);
    setStatus(status, `Saved ${data.name || 'list'}.`, 'ok');
    await loadLists();
    setTimeout(closeListForm, 350);
  } catch (error) {
    setStatus(status, error.message, 'error');
  }
}

async function deleteList(listId) {
  const list = networkState.lists.find(item => item.id === listId);
  const name = list?.name || 'this list';
  if (!window.confirm(`Delete "${name}"? This only removes the local list, not any saved sources.`)) return;
  try {
    const response = await fetch(`/api/tweet-lab/store/lists/${encodeURIComponent(listId)}`, { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `List delete failed with HTTP ${response.status}`);
    if (networkState.selectedListId === listId) networkState.selectedListId = null;
    await loadLists();
  } catch (error) {
    const status = $('#listsFormStatus');
    if (status) setStatus(status, error.message, 'error');
  }
}

function renderListSeedPreview() {
  const preview = $('#listsSeedPreview');
  if (!preview) return;
  const filter = (networkState.listSeedFilter || '').toLowerCase();
  const sources = networkState.sources.filter(source => {
    if (!source) return false;
    const handle = (source.author || '').toLowerCase();
    const text = (source.text || '').toLowerCase();
    return !filter || handle.includes(filter) || text.includes(filter);
  });
  if (!sources.length) {
    preview.className = 'lists-seed-preview empty';
    preview.textContent = networkState.sources.length
      ? 'No sources match the current filter.'
      : 'No saved sources to seed from yet.';
    return;
  }
  preview.className = 'lists-seed-preview';
  const handles = new Set();
  sources.forEach(source => {
    const handle = (source.author || '').replace(/^@+/, '').trim();
    if (/^[A-Za-z0-9_]{1,15}$/.test(handle)) handles.add(handle);
  });
  const sample = Array.from(handles).slice(0, 30);
  preview.innerHTML = `
    <p class="helper-copy">${sources.length} source(s) match. Unique public handles: <strong>${handles.size}</strong>.</p>
    ${sample.length ? `<pre class="seed-preview-handles">${escapeHtml(sample.join('\n'))}${handles.size > sample.length ? `\n…${handles.size - sample.length} more` : ''}</pre>` : '<p class="muted">No recognizable public handles in matched sources.</p>'}
    <div class="button-row">
      <button type="button" class="button ghost" id="listsSeedApply">Apply handles to new list</button>
    </div>`;
  $('#listsSeedApply')?.addEventListener('click', () => {
    openListForm(null);
    $('#listFieldHandles').value = sample.join('\n');
    $('#listsSeedPreview').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

function renderContacts() {
  const summary = summarizeContacts();
  const summaryEl = $('#contactsSummary');
  if (summaryEl) {
    const cadenceCells = Object.entries(summary.byCadence).map(([key, count]) => `<span class="cadence-pill">${escapeHtml(key)}: ${count}</span>`).join(' ');
    summaryEl.innerHTML = `
      <div class="summary-cell"><p class="eyebrow">contacts</p><strong>${summary.total}</strong><span>public handles only</span></div>
      <div class="summary-cell"><p class="eyebrow">cadence mix</p><strong>${Object.keys(summary.byCadence).length}</strong><span>${cadenceCells || 'no cadence set yet'}</span></div>
      <div class="summary-cell"><p class="eyebrow">storage</p><strong>local JSON</strong><span>data/tweet-lab.json</span></div>`;
  }

  const list = $('#contactsList');
  if (!list) return;
  const filter = networkState.contactFilter;
  const search = (filter.search || '').toLowerCase();
  const cadence = filter.cadence || '';
  const filtered = networkState.contacts.filter(contact => {
    if (!contact) return false;
    if (cadence && (contact.cadence || '') !== cadence) return false;
    if (!search) return true;
    return [
      contact.handle,
      contact.displayName,
      contact.role,
      contact.notes,
      ...(Array.isArray(contact.tags) ? contact.tags : [])
    ].some(value => String(value || '').toLowerCase().includes(search));
  });
  if (!filtered.length) {
    list.className = 'contacts-list empty';
    list.innerHTML = emptyStateHtml({
      title: networkState.contacts.length ? 'No contacts match the current filter.' : 'No contacts yet.',
      body: 'Add a public X handle to start your operator contact book. The server blocks DM bodies, emails, and phone numbers in notes.',
      steps: ['Click "+ New contact" to start.', 'Track cadence (daily/weekly/...) so engagement stays intentional.', 'Use Discover to pull their public posts; never auto-reply.'],
      actions: networkState.contacts.length ? [] : ['<button class="button ghost" type="button" data-new-contact>+ New contact</button>']
    });
    list.querySelector('[data-new-contact]')?.addEventListener('click', () => openContactForm(null));
    return;
  }
  list.className = 'contacts-list';
  list.innerHTML = filtered.map(contact => {
    const tags = Array.isArray(contact.tags) ? contact.tags : [];
    const isActive = networkState.selectedContactId === contact.id;
    return `
      <article class="contact-row ${isActive ? 'active' : ''}" data-contact-id="${escapeHtml(contact.id)}">
        <header>
          <strong>@${escapeHtml(contact.handle || '')}</strong>
          <span class="pill">${escapeHtml(contact.cadence || 'unspecified')}</span>
        </header>
        <p class="muted">${escapeHtml(contact.displayName || contact.role || '-')}</p>
        <div class="contact-row-meta">
          ${contact.role ? `<span>role: ${escapeHtml(contact.role)}</span>` : ''}
          ${tags.length ? `<span>${tags.length} tag(s)</span>` : ''}
          ${contact.lastEngagedAt ? `<span>last engaged ${escapeHtml(formatListTimestamp(contact.lastEngagedAt))}</span>` : '<span>no engagement logged</span>'}
        </div>
        <div class="contact-row-actions">
          <button type="button" class="button ghost" data-contact-view="${escapeHtml(contact.id)}">View</button>
          <button type="button" class="button ghost" data-contact-edit="${escapeHtml(contact.id)}">Edit</button>
        </div>
      </article>`;
  }).join('');
  list.querySelectorAll('[data-contact-edit]').forEach(button => button.addEventListener('click', event => openContactForm(event.currentTarget.dataset.contactEdit)));
  list.querySelectorAll('[data-contact-view]').forEach(button => button.addEventListener('click', event => viewContact(event.currentTarget.dataset.contactView)));
  list.querySelectorAll('[data-contact-id]').forEach(card => card.addEventListener('click', event => {
    if (event.target.closest('button')) return;
    networkState.selectedContactId = card.dataset.contactId;
    viewContact(card.dataset.contactId);
  }));
}

function openContactForm(contactId) {
  const panel = $('#contactsFormPanel');
  const contact = contactId ? networkState.contacts.find(item => item.id === contactId) : null;
  networkState.editingContactId = contactId || null;
  $('#contactsFormEyebrow').textContent = contactId ? 'edit contact' : 'new contact';
  $('#contactsFormTitle').textContent = contactId ? (contact?.handle ? `Edit @${contact.handle}` : 'Edit contact') : 'New contact';
  $('#contactFieldHandle').value = contact?.handle || '';
  $('#contactFieldDisplayName').value = contact?.displayName || '';
  $('#contactFieldRole').value = contact?.role || '';
  $('#contactFieldCadence').value = CADENCE_VALUES.includes(contact?.cadence) ? contact.cadence : '';
  $('#contactFieldTags').value = Array.isArray(contact?.tags) ? contact.tags.join(', ') : '';
  $('#contactFieldNotes').value = contact?.notes || '';
  $('#contactsFormStatus').textContent = '';
  panel.hidden = false;
  panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function closeContactForm() {
  networkState.editingContactId = null;
  $('#contactsFormPanel').hidden = true;
  $('#contactsFormStatus').textContent = '';
}

function viewContact(contactId) {
  const contact = networkState.contacts.find(item => item.id === contactId);
  if (!contact) return;
  networkState.selectedContactId = contactId;
  $('#contactsViewHandle').textContent = `@${contact.handle || ''}`;
  const tags = Array.isArray(contact.tags) ? contact.tags.join(', ') : '-';
  const lastEngaged = contact.lastEngagedAt ? formatListTimestamp(contact.lastEngagedAt) : '-';
  $('#contactsViewDetail').innerHTML = `
    <div><dt>Display name</dt><dd>${escapeHtml(contact.displayName || '-')}</dd></div>
    <div><dt>Role</dt><dd>${escapeHtml(contact.role || '-')}</dd></div>
    <div><dt>Cadence</dt><dd>${escapeHtml(contact.cadence || 'unspecified')}</dd></div>
    <div><dt>Tags</dt><dd>${escapeHtml(tags)}</dd></div>
    <div><dt>Last engaged</dt><dd>${escapeHtml(lastEngaged)}</dd></div>
    <div><dt>Notes</dt><dd>${escapeHtml(contact.notes || '-')}</dd></div>
    <div><dt>Created</dt><dd>${escapeHtml(formatListTimestamp(contact.createdAt))}</dd></div>
    <div><dt>Updated</dt><dd>${escapeHtml(formatListTimestamp(contact.updatedAt))}</dd></div>`;
  $('#contactsViewStatus').textContent = '';
  $('#contactsViewPanel').hidden = false;
  $('#contactsViewPanel').scrollIntoView({ block: 'start', behavior: 'smooth' });
  renderContacts();
}

async function saveContactFromForm() {
  const status = $('#contactsFormStatus');
  const handle = $('#contactFieldHandle').value.trim().replace(/^@+/, '');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
    setStatus(status, 'Handle must be 1-15 chars (letters, numbers, underscores). No @, no email, no DM content.', 'error');
    return;
  }
  const notes = $('#contactFieldNotes').value.trim();
  if (/(?:\bDM\b|direct message|inbox:|@[A-Za-z0-9_]+\s+sent|\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b)/i.test(notes)) {
    setStatus(status, 'Contact notes must not contain DM bodies, inbound message threads, or email addresses. Keep it operator-local metadata.', 'error');
    return;
  }
  const payload = {
    handle,
    displayName: $('#contactFieldDisplayName').value.trim(),
    role: $('#contactFieldRole').value.trim(),
    cadence: $('#contactFieldCadence').value || '',
    tags: parseTags($('#contactFieldTags').value),
    notes
  };
  try {
    let response;
    if (networkState.editingContactId) {
      response = await fetch(`/api/tweet-lab/store/contacts/${encodeURIComponent(networkState.editingContactId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      response = await fetch('/api/tweet-lab/store/contacts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Contact save failed with HTTP ${response.status}`);
    setStatus(status, `Saved @${data.handle || handle}.`, 'ok');
    await loadContacts();
    setTimeout(() => {
      closeContactForm();
      viewContact(data.id);
    }, 350);
  } catch (error) {
    setStatus(status, error.message, 'error');
  }
}

async function deleteCurrentContact() {
  if (!networkState.editingContactId && !networkState.selectedContactId) return;
  const id = networkState.editingContactId || networkState.selectedContactId;
  const contact = networkState.contacts.find(item => item.id === id);
  const name = contact?.handle || 'this contact';
  if (!window.confirm(`Delete @${name}? This only removes the local contact, not any saved sources.`)) return;
  try {
    const response = await fetch(`/api/tweet-lab/store/contacts/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Contact delete failed with HTTP ${response.status}`);
    if (networkState.selectedContactId === id) {
      networkState.selectedContactId = null;
      $('#contactsViewPanel').hidden = true;
    }
    await loadContacts();
  } catch (error) {
    const status = $('#contactsViewStatus');
    if (status) setStatus(status, error.message, 'error');
  }
}

function renderDmsStatus() {
  const feature = networkState.features.find(item => item.id === 'dms');
  const statusEl = $('#dmsStatus');
  const reasonEl = $('#dmsReason');
  const blockedEl = $('#dmsBlockedBy');
  const capsEl = $('#dmsCapabilities');
  if (!feature) {
    if (statusEl) {
      statusEl.className = 'dms-status loading';
      statusEl.textContent = 'Loading feature status…';
    }
    return;
  }
  if (feature.available) {
    if (statusEl) {
      statusEl.className = 'dms-status available';
      statusEl.textContent = `Status: available · ${feature.label}.`;
    }
  } else {
    if (statusEl) {
      statusEl.className = 'dms-status unavailable';
      statusEl.textContent = `Status: NOT supported. ${feature.label}.`;
    }
  }
  if (reasonEl) reasonEl.textContent = feature.reason || 'No reason recorded.';
  if (blockedEl) blockedEl.innerHTML = (feature.blockedBy || ['(none recorded)']).map(item => `<li>${escapeHtml(item)}</li>`).join('');
  if (capsEl) capsEl.innerHTML = (feature.capabilities || []).map(item => `<li>${escapeHtml(item)}</li>`).join('');
}

function bindMentionsEvents() {
  const accountSelect = $('#mentionsAccountSelect');
  if (accountSelect) {
    accountSelect.addEventListener('change', event => {
      state.mentions.selectedAccount = String(event.currentTarget.value || '').trim();
    });
  }
  $('#mentionsRefresh')?.addEventListener('click', async () => {
    await loadMentionsStatus();
    if (!state.mentions.blocked) await loadMentions();
  });
  $('#mentionsSeedDemo')?.addEventListener('click', loadMentionsDemo);
  // Also auto-load status on the first paint so the page never shows a
  // blank state · the operator always sees the credential situation.
  loadMentionsStatus().catch(() => { /* status endpoint failures handled in module */ });
}

function bindNetworkEvents() {
  $('#listsRefresh')?.addEventListener('click', () => { loadLists(); renderListSeedPreview(); });
  $('#listsNewButton')?.addEventListener('click', () => openListForm(null));
  $('#listsFormSave')?.addEventListener('click', saveListFromForm);
  $('#listsFormCancel')?.addEventListener('click', closeListForm);
  $('#listsSeedSearch')?.addEventListener('input', event => {
    networkState.listSeedFilter = event.target.value || '';
    renderListSeedPreview();
  });
  $('#listsSeedGenerate')?.addEventListener('click', () => renderListSeedPreview());

  $('#contactsRefresh')?.addEventListener('click', loadContacts);
  $('#contactsNewButton')?.addEventListener('click', () => openContactForm(null));
  $('#contactsFormSave')?.addEventListener('click', saveContactFromForm);
  $('#contactsFormCancel')?.addEventListener('click', closeContactForm);
  $('#contactsViewEdit')?.addEventListener('click', () => {
    if (networkState.selectedContactId) openContactForm(networkState.selectedContactId);
  });
  $('#contactsViewDelete')?.addEventListener('click', deleteCurrentContact);
  $('#contactsSearch')?.addEventListener('input', event => {
    networkState.contactFilter.search = event.target.value || '';
    renderContacts();
  });
  $('#contactsCadenceFilter')?.addEventListener('change', event => {
    networkState.contactFilter.cadence = event.target.value || '';
    renderContacts();
  });

  $('#dmsRefresh')?.addEventListener('click', loadNetworkFeatures);
}

// Initial network loads · sources are shared with the rest of the app so
// list seeding can sample from them. We mirror the existing sources state
// into networkState for that.
networkState.sources = Array.isArray(state.sources) ? state.sources : [];
renderLists();
renderContacts();
renderDmsStatus();
loadLists();
loadContacts();
loadNetworkFeatures();

// ── Workshop (Phase 6) ──

const workshopState = {
  drafts: [],
  selectedIds: new Set(),
  compareIds: new Set(),
  activeDraftId: null
};

async function loadWorkshop() {
  try {
    const response = await fetch('/api/tweet-lab/store/drafts');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Draft load failed with HTTP ${response.status}`);
    workshopState.drafts = Array.isArray(data) ? data : [];
    renderWorkshop();
  } catch (error) {
    setStatus($('#workshopStatus'), error.message, 'error');
  }
}

function renderWorkshop() {
  const empty = $('#workshopEmpty');
  const compare = $('#workshopCompare');
  const list = $('#workshopCandidateList');
  const drafts = workshopState.drafts;

  if (!drafts.length) {
    empty.style.display = 'block';
    compare.style.display = 'none';
    $('#workshopDetailPanel').style.display = 'none';
    $('#workshopRemixPanel').style.display = 'none';
    return;
  }

  empty.style.display = 'none';
  compare.style.display = 'block';

  list.innerHTML = drafts.map(draft => {
    const selected = workshopState.selectedIds.has(draft.id);
    const gateClass = draft.gateStatus === 'blocked' ? 'gate-blocked' : (draft.gateStatus === 'revise' ? 'gate-revise' : (draft.gateStatus === 'needs-proof' ? 'gate-proof' : 'gate-clean'));
    const warnings = Array.isArray(draft.gateWarnings) ? draft.gateWarnings : [];
    const parentInfo = draft.parentDraftId ? `<span class="pill">remix of ${escapeHtml(draft.parentDraftId.slice(0, 8))}…</span>` : '';
    return `
      <article class="workshop-candidate-card ${selected ? 'selected' : ''}" data-workshop-id="${escapeHtml(draft.id)}">
        <header>
          <strong>${escapeHtml(draft.angle || 'Candidate')}</strong>
          <span>${draft.text.length}/280</span>
        </header>
        <p>${escapeHtml(draft.text)}</p>
        <div class="candidate-meta">
          <span class="pill status-${escapeHtml(draft.status || 'generated')}">${escapeHtml(draft.status || 'generated')}</span>
          <span class="pill ${gateClass}">gate: ${escapeHtml(draft.gateStatus || 'clean')} (${draft.gateScore !== undefined ? draft.gateScore : 100})</span>
          ${parentInfo}
          ${warnings.map(w => `<span class="pill warn">${escapeHtml(w)}</span>`).join('')}
        </div>
      </article>`;
  }).join('');

  $$('[data-workshop-id]').forEach(card => {
    card.addEventListener('click', event => {
      const id = event.currentTarget.dataset.workshopId;
      if (workshopState.selectedIds.has(id)) workshopState.selectedIds.delete(id);
      else workshopState.selectedIds.add(id);
      renderWorkshop();
      updateWorkshopButtons();
    });
  });

  updateWorkshopButtons();
}

function updateWorkshopButtons() {
  const compareBtn = $('#compareSelected');
  if (compareBtn) compareBtn.disabled = workshopState.selectedIds.size < 2;
}

function renderSourceAlignment(draft) {
  const refs = Array.isArray(draft.sourceRefs) ? draft.sourceRefs : [];
  const text = String(draft.text || '').toLowerCase();
  if (!refs.length) {
    return `<div class="source-alignment"><div class="align-row warn"><span class="align-dot warn"></span><span>No sourceRefs attached. Claims need proof.</span></div></div>`;
  }
  const rows = refs.map(ref => {
    const refLower = ref.toLowerCase();
    const aligned = text.includes(refLower) || refLower.includes('x.com') || refLower.includes('twitter.com');
    return `<div class="align-row ${aligned ? 'ok' : 'warn'}"><span class="align-dot ${aligned ? 'ok' : 'warn'}"></span><span>${escapeHtml(ref)}${aligned ? ' · aligned' : ' · not directly cited in text'}</span></div>`;
  });
  // Also check for claim-heavy content without refs
  const claimHeavy = /\b(study|studies|research|data|report|survey|according to|source|sources)\b/i.test(text);
  if (claimHeavy && !refs.length) {
    rows.push(`<div class="align-row warn"><span class="align-dot warn"></span><span>Claim-heavy draft has no sourceRefs</span></div>`);
  }
  return `<div class="source-alignment">${rows.join('')}</div>`;
}

function renderWorkshopDetail() {
  const panel = $('#workshopDetailPanel');
  const detail = $('#workshopDetail');
  const ids = Array.from(workshopState.compareIds);
  const drafts = workshopState.drafts.filter(d => ids.includes(d.id));

  if (!drafts.length) {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = 'block';
  $('#workshopRemixPanel').style.display = 'none';

  detail.innerHTML = `<div class="workshop-detail-grid">${drafts.map(draft => {
    const gateClass = draft.gateStatus === 'blocked' ? 'gate-blocked' : (draft.gateStatus === 'revise' ? 'gate-revise' : (draft.gateStatus === 'needs-proof' ? 'gate-proof' : 'gate-clean'));
    const warnings = Array.isArray(draft.gateWarnings) ? draft.gateWarnings : [];
    const suggestions = Array.isArray(draft.gateSuggestions) ? draft.gateSuggestions : [];
    const parentInfo = draft.parentDraftId ? `<div class="detail-block"><label>Parent draft</label><pre>${escapeHtml(draft.parentDraftId)}</pre></div>` : '';
    const rationale = draft.rationale ? `<div class="detail-block"><label>Rationale</label><pre>${escapeHtml(draft.rationale)}</pre></div>` : '';
    const sourceRefs = Array.isArray(draft.sourceRefs) && draft.sourceRefs.length
      ? `<div class="detail-block"><label>Source refs</label><pre>${draft.sourceRefs.map(r => escapeHtml(r)).join('\n')}</pre></div>`
      : '';
    const checks = Array.isArray(draft.gateChecks)
      ? `<div class="detail-block"><label>Gate checks</label><pre>${draft.gateChecks.map(c => `${c.name}: ${c.level} · ${c.message}`).join('\n')}</pre></div>`
      : '';
    return `
      <div class="workshop-detail-card">
        <header>
          <strong>${escapeHtml(draft.angle || 'Candidate')}</strong>
          <span>${draft.text.length}/280 · ${escapeHtml(draft.status || 'generated')}</span>
        </header>
        <div class="detail-block"><label>Draft text</label><pre>${escapeHtml(draft.text)}</pre></div>
        ${rationale}
        ${sourceRefs}
        ${parentInfo}
        <div class="detail-block">
          <label>Gate status</label>
          <div class="candidate-meta">
            <span class="pill ${gateClass}">${escapeHtml(draft.gateStatus || 'clean')} (${draft.gateScore !== undefined ? draft.gateScore : 100})</span>
            ${warnings.map(w => `<span class="pill warn">${escapeHtml(w)}</span>`).join('')}
          </div>
        </div>
        ${suggestions.length ? `<div class="detail-block"><label>Suggestions</label><pre>${suggestions.map(s => `↳ ${s}`).join('\n')}</pre></div>` : ''}
        ${checks}
        <div class="detail-block"><label>Source alignment</label>${renderSourceAlignment(draft)}</div>
        <div class="workshop-detail-actions">
          <button class="button primary" data-remix-workshop="${escapeHtml(draft.id)}">Remix this</button>
          <button class="button ghost" data-use-workshop="${escapeHtml(draft.id)}">Use for schedule</button>
          <button class="button ghost" data-approve-workshop="${escapeHtml(draft.id)}">Approve</button>
        </div>
      </div>`;
  }).join('')}</div>`;

  $$('[data-remix-workshop]').forEach(button => button.addEventListener('click', event => {
    workshopState.activeDraftId = event.currentTarget.dataset.remixWorkshop;
    openRemixPanel();
  }));
  $$('[data-use-workshop]').forEach(button => button.addEventListener('click', event => {
    const draft = workshopState.drafts.find(d => d.id === event.currentTarget.dataset.useWorkshop);
    if (draft) {
      state.selectedDraftId = draft.id;
      $('#scheduleContent').value = draft.text;
      $('#scheduleDraftId').value = draft.id;
      location.hash = '#queue';
    }
  }));
  $$('[data-approve-workshop]').forEach(button => button.addEventListener('click', event => {
    approveDraft(event.currentTarget.dataset.approveWorkshop)
      .then(() => loadWorkshop())
      .catch(error => setStatus($('#workshopStatus'), error.message, 'error'));
  }));
}

function openRemixPanel() {
  $('#workshopRemixPanel').style.display = 'block';
  $('#workshopDetailPanel').style.display = 'none';
  $('#remixInstruction').value = '';
  $('#remixStatus').textContent = '';
  $('#remixInstruction').focus();
}

function closeRemixPanel() {
  $('#workshopRemixPanel').style.display = 'none';
  $('#workshopDetailPanel').style.display = 'block';
  workshopState.activeDraftId = null;
}

async function remixFromWorkshop() {
  const button = $('#remixButton');
  button.disabled = true;
  setStatus($('#remixStatus'), 'Remixing via Goro…');
  try {
    const payload = {
      draftId: workshopState.activeDraftId,
      instruction: $('#remixInstruction').value.trim(),
      tone: $('#remixTone').value.trim(),
      count: Number($('#remixCount').value)
    };
    const response = await fetch('/api/tweet-lab/remix', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Remix failed with HTTP ${response.status}`);
    setStatus($('#remixStatus'), `Remixed ${data.drafts?.length || 0} candidate(s) via ${data.adapter}.`, 'ok');
    // Refresh drafts and workshop
    await loadDrafts();
    await loadWorkshop();
    workshopState.compareIds.clear();
    workshopState.selectedIds.clear();
    renderWorkshopDetail();
    closeRemixPanel();
    location.hash = '#ready-to-post';
  } catch (error) {
    setStatus($('#remixStatus'), error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

function bindWorkshopEvents() {
  $('#refreshWorkshop').addEventListener('click', loadWorkshop);
  $('#clearWorkshop').addEventListener('click', () => {
    workshopState.selectedIds.clear();
    workshopState.compareIds.clear();
    workshopState.activeDraftId = null;
    renderWorkshop();
    renderWorkshopDetail();
    $('#workshopRemixPanel').style.display = 'none';
  });
  $('#selectAllWorkshop').addEventListener('click', () => {
    workshopState.drafts.forEach(d => workshopState.selectedIds.add(d.id));
    renderWorkshop();
  });
  $('#clearWorkshopSelection').addEventListener('click', () => {
    workshopState.selectedIds.clear();
    renderWorkshop();
  });
  $('#compareSelected').addEventListener('click', () => {
    workshopState.compareIds = new Set(workshopState.selectedIds);
    renderWorkshopDetail();
  });
  $('#closeWorkshopDetail').addEventListener('click', () => {
    workshopState.compareIds.clear();
    renderWorkshopDetail();
  });
  $('#remixButton').addEventListener('click', remixFromWorkshop);
  $('#cancelRemix').addEventListener('click', closeRemixPanel);
}

bindWorkshopEvents();
loadWorkshop();

/* ── AI Writer state and functions ── */
const aiWriterState = {
  sessions: [],
  currentSessionId: null,
  agentMode: false,
  autoMode: true,
  isGenerating: false
};

function getCurrentSession() {
  return aiWriterState.sessions.find(s => s.id === aiWriterState.currentSessionId) || null;
}

function createNewSession() {
  const id = `session-${Date.now()}`;
  const session = { id, title: 'New chat', messages: [], createdAt: new Date().toISOString() };
  aiWriterState.sessions.unshift(session);
  aiWriterState.currentSessionId = id;
  return session;
}

function addMessage(sessionId, role, content, meta = {}) {
  const session = aiWriterState.sessions.find(s => s.id === sessionId);
  if (!session) return null;
  const message = { id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role, content, ...meta, at: new Date().toISOString() };
  session.messages.push(message);
  // Update session title from first user message
  if (role === 'user' && session.title === 'New chat') {
    session.title = content.slice(0, 40) + (content.length > 40 ? '…' : '');
  }
  return message;
}

function renderAiWriter() {
  const session = getCurrentSession();
  const chatEl = $('#aiWriterChat');
  const emptyEl = $('#aiWriterEmpty');
  const provenanceEl = $('#aiWriterProvenance');
  if (!chatEl || !emptyEl) return;

  if (!session || session.messages.length === 0) {
    chatEl.classList.add('hidden');
    provenanceEl.classList.add('hidden');
    emptyEl.style.display = '';
    return;
  }

  emptyEl.style.display = 'none';
  chatEl.classList.remove('hidden');
  chatEl.innerHTML = session.messages.map(msg => {
    if (msg.role === 'user') {
      return `<div class="chat-bubble user">${escapeHtml(msg.content)}</div>`;
    }
    if (msg.role === 'assistant') {
      const actions = msg.candidates
        ? `<div class="bubble-actions">${msg.candidates.map((c, i) => `
          <button class="button ghost" data-save-draft="${escapeHtml(c.id || i)}" data-session="${escapeHtml(session.id)}" data-index="${i}">Save to Ready to Post</button>
          <button class="button ghost" data-copy-draft="${escapeHtml(c.text || c.content || '')}">Copy</button>
        `).join('')}</div>`
        : '';
      const meta = msg.provenance
        ? `<div class="bubble-meta">Sources: ${msg.provenance.map(p => escapeHtml(p.label)).join(' · ')}</div>`
        : '';
      const text = msg.candidates
        ? msg.candidates.map((c, i) => `<div class="candidate-text"><strong>Candidate ${i + 1}</strong> · ${escapeHtml(c.angle || 'Draft')}<br>${escapeHtml(c.text || c.content || '')}</div>`).join('')
        : escapeHtml(msg.content);
      return `<div class="chat-bubble assistant">${text}${meta}${actions}</div>`;
    }
    if (msg.role === 'loading') {
      return `<div class="ai-writer-loading">${escapeHtml(msg.content)}</div>`;
    }
    if (msg.role === 'provenance') {
      return '';
    }
    return `<div class="chat-bubble assistant">${escapeHtml(msg.content)}</div>`;
  }).join('');

  // Provenance panel
  const lastAssistant = [...session.messages].reverse().find(m => m.role === 'assistant' && m.provenance);
  if (lastAssistant && lastAssistant.provenance) {
    provenanceEl.classList.remove('hidden');
    provenanceEl.innerHTML = renderProvenance(lastAssistant.provenance, lastAssistant.warnings);
  } else {
    provenanceEl.classList.add('hidden');
  }

  // Bind save/copy actions
  chatEl.querySelectorAll('[data-save-draft]').forEach(button => button.addEventListener('click', async event => {
    const idx = Number(event.currentTarget.dataset.index);
    const sess = getCurrentSession();
    const assistantMsg = sess?.messages.filter(m => m.role === 'assistant').at(-1);
    const candidate = assistantMsg?.candidates?.[idx];
    if (!candidate) return;
    try {
      const response = await fetch('/api/tweet-lab/store/drafts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: candidate.text,
          angle: candidate.angle || 'AI Writer draft',
          rationale: candidate.rationale || '',
          sourceRefs: candidate.sourceRefs || [],
          warnings: candidate.warnings || [],
          status: 'generated'
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Save failed');
      setStatus($('#aiWriterStatus') || document.createElement('span'), 'Saved to Ready to Post', 'ok');
      await loadDrafts();
    } catch (error) {
      alert('Save failed: ' + error.message);
    }
  }));
  chatEl.querySelectorAll('[data-copy-draft]').forEach(button => button.addEventListener('click', event => {
    const text = event.currentTarget.dataset.copyDraft;
    navigator.clipboard.writeText(text).catch(() => {});
    event.currentTarget.textContent = 'Copied';
    setTimeout(() => { event.currentTarget.textContent = 'Copy'; }, 1200);
  }));

  chatEl.scrollTop = chatEl.scrollHeight;
}

function renderProvenance(provenance, warnings = []) {
  const items = provenance.map(p => {
    const warn = p.warnings?.length ? `<span class="prov-warn">${escapeHtml(p.warnings.join('; '))}</span>` : '';
    return `<div class="provenance-item"><span class="prov-dot"></span><div><span class="prov-label">${escapeHtml(p.label)}</span> ${escapeHtml(p.type)}${p.excerpt ? ` · ${escapeHtml(p.excerpt.slice(0, 80))}` : ''}${warn}</div></div>`;
  }).join('');
  const warnItems = warnings.length ? warnings.map(w => `<div class="provenance-item"><span class="prov-dot" style="background:#ff766b"></span><div><span class="prov-warn">${escapeHtml(w)}</span></div></div>`).join('') : '';
  return `<div class="provenance-panel"><h4>Sources used</h4><div class="provenance-list">${items}${warnItems}</div></div>`;
}

function renderAiWriterHistory() {
  const list = $('#aiWriterHistoryList');
  if (!list) return;
  if (!aiWriterState.sessions.length) {
    list.innerHTML = 'No chat history yet.';
    return;
  }
  list.innerHTML = aiWriterState.sessions.map(s => `
    <div class="history-item" data-session-id="${escapeHtml(s.id)}">
      <div><div class="history-title">${escapeHtml(s.title)}</div><div class="history-meta">${s.messages.length} messages · ${new Date(s.createdAt).toLocaleDateString()}</div></div>
      <span class="button ghost" style="font-size:12px;padding:4px 8px;" data-delete-session="${escapeHtml(s.id)}">Delete</span>
    </div>
  `).join('');
  list.querySelectorAll('[data-session-id]').forEach(item => item.addEventListener('click', event => {
    if (event.target.closest('[data-delete-session]')) return;
    aiWriterState.currentSessionId = event.currentTarget.dataset.sessionId;
    renderAiWriter();
    $('#aiWriterHistoryPanel').classList.add('hidden');
  }));
  list.querySelectorAll('[data-delete-session]').forEach(btn => btn.addEventListener('click', event => {
    const id = event.currentTarget.dataset.deleteSession;
    aiWriterState.sessions = aiWriterState.sessions.filter(s => s.id !== id);
    if (aiWriterState.currentSessionId === id) {
      aiWriterState.currentSessionId = aiWriterState.sessions[0]?.id || null;
      renderAiWriter();
    }
    renderAiWriterHistory();
  }));
}

async function sendAiWriterPrompt() {
  const promptEl = $('#aiWriterPrompt');
  const prompt = promptEl.value.trim();
  if (!prompt || aiWriterState.isGenerating) return;

  let session = getCurrentSession();
  if (!session) session = createNewSession();

  addMessage(session.id, 'user', prompt);
  addMessage(session.id, 'loading', 'Researching sources and drafting…');
  renderAiWriter();
  promptEl.value = '';
  aiWriterState.isGenerating = true;
  $('#aiWriterSend').disabled = true;

  try {
    const payload = {
      prompt,
      agentMode: aiWriterState.agentMode,
      autoMode: aiWriterState.autoMode,
      tone: 'sharp, useful, no AI slop',
      count: 2
    };
    const response = await fetch('/api/tweet-lab/ai-writer/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Generation failed');

    // Remove loading message
    session.messages = session.messages.filter(m => m.role !== 'loading');

    const provenance = data.provenance || [];
    const warnings = data.warnings || [];

    if (data.candidates && data.candidates.length) {
      addMessage(session.id, 'assistant', '', { candidates: data.candidates, provenance, warnings });
    } else if (data.text) {
      addMessage(session.id, 'assistant', data.text, { provenance, warnings });
    } else {
      addMessage(session.id, 'assistant', 'No draft generated. Try a different prompt.', { provenance, warnings });
    }
  } catch (error) {
    session.messages = session.messages.filter(m => m.role !== 'loading');
    addMessage(session.id, 'assistant', `Error: ${error.message}`, { warnings: [error.message] });
  } finally {
    aiWriterState.isGenerating = false;
    $('#aiWriterSend').disabled = false;
    renderAiWriter();
    renderAiWriterHistory();
  }
}

function bindAiWriterEvents() {
  $('#aiWriterSend')?.addEventListener('click', sendAiWriterPrompt);
  $('#aiWriterPrompt')?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendAiWriterPrompt();
    }
  });
  $('#aiWriterNewChat')?.addEventListener('click', () => {
    createNewSession();
    renderAiWriter();
    $('#aiWriterHistoryPanel').classList.add('hidden');
  });
  $('#aiWriterHistory')?.addEventListener('click', () => {
    const panel = $('#aiWriterHistoryPanel');
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) renderAiWriterHistory();
  });
  $('#closeAiWriterHistory')?.addEventListener('click', () => {
    $('#aiWriterHistoryPanel').classList.add('hidden');
  });
  $('#aiWriterAgentMode')?.addEventListener('click', event => {
    aiWriterState.agentMode = !aiWriterState.agentMode;
    event.currentTarget.classList.toggle('active', aiWriterState.agentMode);
    event.currentTarget.dataset.active = String(aiWriterState.agentMode);
  });
  $('#aiWriterAutoMode')?.addEventListener('click', event => {
    aiWriterState.autoMode = !aiWriterState.autoMode;
    event.currentTarget.classList.toggle('active', aiWriterState.autoMode);
    event.currentTarget.dataset.active = String(aiWriterState.autoMode);
  });
  $$('#aiWriterEmpty .example-chips button').forEach(button => button.addEventListener('click', event => {
    $('#aiWriterPrompt').value = event.currentTarget.dataset.example;
    sendAiWriterPrompt();
  }));
  // Stub attach/image/link buttons
  $('#aiWriterAttach')?.addEventListener('click', () => alert('Attach file: not implemented yet'));
  $('#aiWriterImage')?.addEventListener('click', () => alert('Add image: not implemented yet'));
  $('#aiWriterLink')?.addEventListener('click', () => alert('Add link: not implemented yet'));
}

bindAiWriterEvents();

/* ── Discover topic/link search ────────────────────────────── */
function discoverTweetToSource(tweet) {
  return {
    id: tweet?.id ? `discover-${tweet.id}` : undefined,
    url: tweet?.url || '',
    statusId: tweet?.id || '',
    author: tweet?.author?.username || tweet?.author?.name || '',
    text: tweet?.text || '',
    sourceType: Array.isArray(tweet?.media) && tweet.media.length ? 'media' : 'tweet',
    tags: ['discover', ...(state.discover.topics || [])].filter(Boolean),
    format: 'reply',
    whySaved: 'Saved from Discover read-only X search.',
    engagement: tweet?.metrics || {},
    warnings: tweet?.warnings || [],
    provider: tweet?.source || state.discover.fetched?.provider || 'discover',
    fetchedAt: tweet?.fetchedAt || state.discover.fetched?.fetchedAt || new Date().toISOString(),
    authorProfile: tweet?.author || {},
    media: tweet?.media || []
  };
}

function discoverMentionFromTweet(tweet) {
  return {
    id: tweet?.id || null,
    author: tweet?.author || null,
    username: tweet?.author?.username || null,
    text: tweet?.text || '',
    url: tweet?.url || null,
    metrics: tweet?.metrics || null,
    media: tweet?.media || [],
    conversationId: tweet?.conversationId || null,
    source: tweet?.source || 'discover'
  };
}

function discoverTopicsFromInput() {
  return String($('#discoverTopicInput')?.value || '')
    .split(/,|\n/)
    .map(item => item.trim())
    .filter(Boolean);
}

function renderDiscoverResults() {
  const root = $('#discoverResults');
  if (!root) return;
  const results = Array.isArray(state.discover.results) ? state.discover.results : [];
  if (!results.length) {
    root.className = 'discover-results empty';
    root.dataset.state = state.discover.mode || 'empty';
    root.innerHTML = `<article class="discover-empty" id="discoverEmptyState">
      <div class="search-orb" aria-hidden="true">⌕</div>
      <h3>What topics interest you?</h3>
      <p class="muted">Enter topics to discover posts. We will find relevant posts for you to engage with.</p>
      <form id="discoverTopicForm" class="discover-empty-form" autocomplete="off" onsubmit="return false;">
        <input id="discoverTopicInput" type="text" placeholder="e.g. marketing, fitness, design, tech" aria-label="Discover topics" value="${escapeHtml((state.discover.topics || []).join(', '))}">
      </form>
      <button id="discoverEmptyStartButton" class="button primary discover-empty-cta" type="button">Start Discovering</button>
      <div id="discoverTopicChipRow" class="topic-chips discover-empty-chips" aria-label="Suggested topics">
        ${['AI systems','founder ops','Slack automation','applied leverage','Hermes agents','tweet lab'].map(chip => `<span data-discover-chip="${escapeHtml(chip)}">${escapeHtml(chip)}</span>`).join('')}
      </div>
    </article>`;
    bindDiscoverDynamicEvents();
    return;
  }
  root.className = 'discover-results discover-card-grid';
  root.dataset.state = 'results';
  root.innerHTML = results.map((tweet, index) => {
    const author = tweet.author || {};
    const name = author.name || author.username || 'Unknown';
    const handle = author.username ? `@${author.username}` : 'X source';
    const metrics = tweet.metrics || {};
    const media = Array.isArray(tweet.media) && tweet.media.length
      ? `<div class="tweet-media">${tweet.media.map(m => `<img src="${escapeHtml(safeExternalUrl(m.url || m.previewImageUrl || ''))}" alt="media" loading="lazy">`).join('')}</div>`
      : '';
    return `<article class="post-card discover-card" data-discover-index="${index}">
      <div class="tweet-author"><span class="avatar-fallback">${escapeHtml(initialsFor(name))}</span><div><strong>${escapeHtml(name)}</strong><span>${escapeHtml(handle)} · ${escapeHtml(tweet.createdAt ? new Date(tweet.createdAt).toLocaleDateString() : 'date unavailable')}</span></div></div>
      <p>${escapeHtml(tweet.text || '(no text returned)')}</p>
      ${media}
      <a href="${escapeHtml(safeExternalUrl(tweet.url || ''))}" target="_blank" rel="noreferrer">More »</a>
      <div class="tweet-meta"><span>♡ ${formatMetric(metrics.likeCount || 0)}</span><span>↻ ${formatMetric(metrics.repostCount || 0)}</span><span>💬 ${formatMetric(metrics.replyCount || 0)}</span><span>source: ${escapeHtml(tweet.source || state.discover.fetched?.provider || 'x')}</span></div>
      <div class="tweet-actions">
        <button class="button ghost" data-discover-save="${index}" type="button">Save</button>
        <button class="button ghost" data-discover-rewrite="${index}" type="button">Rewrite</button>
        <button class="button primary" data-discover-reply="${index}" type="button">Draft reply</button>
      </div>
    </article>`;
  }).join('');
  bindDiscoverCardEvents();
}

function setDiscoverStatus(message, type = '') {
  const status = $('#discoverStatus');
  if (status) setStatus(status, message, type);
}

async function runDiscoverSearch() {
  const topics = discoverTopicsFromInput();
  if (!topics.length) {
    setDiscoverStatus('Add at least one topic first.', 'error');
    return;
  }
  state.discover.topics = topics;
  setDiscoverStatus('Searching X read-only…');
  try {
    const response = await fetch('/api/tweet-lab/discover/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        topics,
        maxResults: Number($('#discoverMaxResults')?.value || 20),
        excludeReplies: ($('#discoverExcludeReplies')?.value || 'true') !== 'false',
        mediaOnly: ($('#discoverMediaOnly')?.value || 'false') === 'true'
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Discover search failed with HTTP ${response.status}`);
    state.discover.mode = 'results';
    state.discover.results = data.results || [];
    state.discover.fetched = data;
    state.discover.warnings = data.warnings || [];
    renderDiscoverResults();
    setDiscoverStatus(`Loaded ${state.discover.results.length} read-only result(s) for ${topics.join(', ')}.`, 'ok');
  } catch (error) {
    state.discover.mode = 'blocked';
    state.discover.results = [];
    renderDiscoverResults();
    setDiscoverStatus(error.message, 'error');
    const blocker = $('#discoverBlocker');
    if (blocker) blocker.hidden = false;
    const detail = $('#discoverBlockerDetail');
    if (detail) detail.textContent = error.message;
  }
}

async function fetchDiscoverUrl() {
  const url = String($('#discoverFetchUrl')?.value || '').trim();
  if (!url) {
    setDiscoverStatus('Paste an X post link first.', 'error');
    return;
  }
  setDiscoverStatus('Resolving X link read-only…');
  try {
    const response = await fetch('/api/tweet-lab/discover/fetch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Fetch failed with HTTP ${response.status}`);
    const tweet = data.tweet || data.result;
    state.discover.mode = 'results';
    state.discover.results = tweet ? [tweet] : [];
    state.discover.fetched = data;
    renderDiscoverResults();
    setDiscoverStatus(tweet ? 'Resolved 1 X post for private drafting.' : 'Resolved link, but no tweet card returned.', tweet ? 'ok' : 'warn');
  } catch (error) {
    setDiscoverStatus(error.message, 'error');
  }
}

async function saveDiscoverResult(index) {
  const tweet = state.discover.results[index];
  if (!tweet) return;
  try {
    const response = await fetch('/api/tweet-lab/store/sources', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(discoverTweetToSource(tweet))
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Save failed');
    setDiscoverStatus('Saved result to source bank.', 'ok');
    await loadSources();
  } catch (error) {
    setDiscoverStatus(error.message, 'error');
  }
}

async function rewriteDiscoverResult(index) {
  const tweet = state.discover.results[index];
  if (!tweet) return;
  try {
    const response = await fetch('/api/tweet-lab/rewrite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceTweet: discoverTweetToSource(tweet), context: 'Discover rewrite: use the useful angle without copying or inventing metrics.', tone: 'sharp, useful, no AI slop', count: 1 })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Rewrite failed');
    setDiscoverStatus(`Saved ${data.drafts?.length || 0} rewritten draft(s) to Ready to Post.`, 'ok');
    await loadDrafts();
  } catch (error) {
    setDiscoverStatus(error.message, 'error');
  }
}

async function draftDiscoverReply(index) {
  const tweet = state.discover.results[index];
  if (!tweet) return;
  try {
    const response = await fetch('/api/tweet-lab/mentions/reply/draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mention: discoverMentionFromTweet(tweet), context: `Discover topics: ${(state.discover.topics || []).join(', ')}`, tone: 'sharp, useful, no AI slop', count: 1 })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Draft reply failed');
    setDiscoverStatus(`Saved ${data.replies?.length || 0} private reply draft(s). No public reply was sent.`, 'ok');
    loadMyReplies();
  } catch (error) {
    setDiscoverStatus(error.message, 'error');
  }
}

function bindDiscoverCardEvents() {
  $$('[data-discover-save]').forEach(button => button.addEventListener('click', event => saveDiscoverResult(Number(event.currentTarget.dataset.discoverSave))));
  $$('[data-discover-rewrite]').forEach(button => button.addEventListener('click', event => rewriteDiscoverResult(Number(event.currentTarget.dataset.discoverRewrite))));
  $$('[data-discover-reply]').forEach(button => button.addEventListener('click', event => draftDiscoverReply(Number(event.currentTarget.dataset.discoverReply))));
}

function bindDiscoverDynamicEvents() {
  $('#discoverEmptyStartButton')?.addEventListener('click', runDiscoverSearch);
  $('#discoverTopicForm')?.addEventListener('submit', event => { event.preventDefault(); runDiscoverSearch(); });
  $$('[data-discover-chip]').forEach(chip => chip.addEventListener('click', event => {
    const input = $('#discoverTopicInput');
    if (input) input.value = event.currentTarget.dataset.discoverChip || event.currentTarget.textContent || '';
    runDiscoverSearch();
  }));
}

function bindDiscoverEvents() {
  $('#discoverFilters')?.addEventListener('click', () => {
    const panel = $('#discoverFiltersPanel');
    if (!panel) return;
    panel.hidden = !panel.hidden;
    $('#discoverFilters')?.setAttribute('aria-expanded', String(!panel.hidden));
  });
  $('#discoverFetchForm')?.addEventListener('submit', event => { event.preventDefault(); fetchDiscoverUrl(); });
  bindDiscoverDynamicEvents();
  renderDiscoverResults();
}

bindDiscoverEvents();

/* ── My Replies state and functions ── */
const myRepliesState = {
  replies: [],
  statusFilter: '',
  dateFilter: '',
  search: ''
};

function loadMyReplies() {
  fetch('/api/tweet-lab/store/replies')
    .then(r => r.json())
    .then(data => {
      myRepliesState.replies = Array.isArray(data) ? data : [];
      renderMyReplies();
    })
    .catch(() => {
      myRepliesState.replies = [];
      renderMyReplies();
    });
}

function myRepliesFiltered() {
  let items = myRepliesState.replies.slice();
  const status = myRepliesState.statusFilter;
  if (status) items = items.filter(r => (r.status || 'draft') === status);
  const date = myRepliesState.dateFilter;
  if (date) {
    const cutoff = timeRangeCutoff(date);
    if (cutoff) items = items.filter(r => {
      const t = new Date(r.createdAt || r.postedAt || 0).getTime();
      return t >= cutoff;
    });
  }
  const search = myRepliesState.search.trim().toLowerCase();
  if (search) {
    items = items.filter(r => {
      const hay = [
        r.text, r.mentionText, r.mentionAuthor, r.mentionUsername,
        r.angle, r.context, ...(r.tags || [])
      ].join(' ').toLowerCase();
      return hay.includes(search);
    });
  }
  return items;
}

function renderMyReplies() {
  const grid = $('#myRepliesGrid');
  const summary = $('#myRepliesSummary');
  if (!grid) return;
  const items = myRepliesFiltered();
  if (summary) {
    const counts = {};
    items.forEach(r => { const s = r.status || 'draft'; counts[s] = (counts[s] || 0) + 1; });
    const parts = Object.entries(counts).map(([s, n]) => `${n} ${s}`);
    summary.innerHTML = `<span class="pill">${items.length} reply draft(s)</span>` + (parts.length ? ' ' + parts.map(p => `<span class="pill">${p}</span>`).join('') : '');
  }
  if (!items.length) {
    grid.innerHTML = `<article class="post-card empty-state-card"><h3>No reply drafts match</h3><p>Reply drafts created from Mentions, Discover, or AI Writer show up here. Adjust filters or create a reply draft first.</p><div class="tweet-meta"><span>read-only</span><span>approval required</span></div></article>`;
    return;
  }
  grid.innerHTML = items.map(reply => {
    const status = reply.status || 'draft';
    const statusClass = status === 'sent' ? 'ok' : status === 'draft' ? 'warn' : 'info';
    const date = reply.postedAt || reply.createdAt || reply.scheduledAt;
    const dateText = date ? new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'unsaved';
    const parent = reply.parentTweet || reply.originalTweet || (reply.mentionId ? { id: reply.mentionId, author: reply.mentionAuthor || reply.mentionUsername, text: reply.mentionText, url: reply.mentionUrl } : null);
    const parentHtml = parent ? `<div class="reply-parent"><div class="reply-parent-header"><strong>@${escapeHtml(parent.author || parent.username || 'unknown')}</strong><span class="muted">${dateText}</span></div><p class="reply-parent-text">${escapeHtml((parent.text || '').slice(0, 200))}${(parent.text || '').length > 200 ? '…' : ''}</p></div>` : '';
    const media = Array.isArray(reply.media) && reply.media.length ? `<div class="tweet-media">${reply.media.map(m => `<img src="${escapeHtml(safeExternalUrl(m.url || m.previewImageUrl || ''))}" alt="media" loading="lazy">`).join('')}</div>` : '';
    const metrics = reply.metrics ? `<span>♡ ${formatMetric(reply.metrics.likeCount || reply.metrics.likes || 0)}</span><span>↻ ${formatMetric(reply.metrics.repostCount || reply.metrics.retweets || 0)}</span><span>💬 ${formatMetric(reply.metrics.replyCount || reply.metrics.replies || 0)}</span><span>👁 ${formatMetric(reply.metrics.impressionCount || reply.metrics.views || 'unavailable')}</span>` : '<span>metrics unavailable</span>';
    const provenance = Array.isArray(reply.sourceRefs) && reply.sourceRefs.length ? `<div class="tweet-meta"><span>source: ${escapeHtml(reply.sourceRefs.map(s => s.label || s.type || 'unknown').join(', '))}</span></div>` : '';
    return `<article class="post-card reply-card" data-reply-id="${escapeHtml(reply.id)}">
      ${parentHtml}
      <div class="reply-body">
        <div class="tweet-author"><span class="avatar-fallback">L</span><div><strong>LUCAS</strong><span>@LucasSynnott</span></div><span class="pill ${statusClass}">${escapeHtml(status)}</span></div>
        <p>${escapeHtml(reply.text || '(no text)')}</p>
        ${media}
        <div class="tweet-meta"><span>${dateText}</span>${metrics}</div>
        ${provenance}
        <div class="tweet-actions">
          <button class="button ghost" data-edit-reply="${escapeHtml(reply.id)}" type="button">Edit</button>
          <button class="button primary" data-queue-reply="${escapeHtml(reply.id)}" type="button">Add to Queue</button>
          <button class="button ghost" data-copy-reply="${escapeHtml(reply.id)}" type="button">Copy</button>
        </div>
      </div>
    </article>`;
  }).join('');
  $$('[data-edit-reply]').forEach(button => button.addEventListener('click', event => {
    const id = event.currentTarget.dataset.editReply;
    const reply = myRepliesState.replies.find(r => r.id === id);
    if (!reply) return;
    alert('Edit reply: ' + (reply.text || '').slice(0, 60) + '…\n\n(Not implemented yet · edit via AI Writer or store API.)');
  }));
  $$('[data-copy-reply]').forEach(button => button.addEventListener('click', event => {
    const id = event.currentTarget.dataset.copyReply;
    const reply = myRepliesState.replies.find(r => r.id === id);
    if (!reply || !reply.text) return;
    navigator.clipboard.writeText(reply.text).then(() => setStatus($('#myRepliesStatus') || {}, 'Copied reply text', 'ok')).catch(() => {});
  }));
  $$('[data-queue-reply]').forEach(button => button.addEventListener('click', event => {
    const id = event.currentTarget.dataset.queueReply;
    const reply = myRepliesState.replies.find(r => r.id === id);
    if (!reply || !reply.text) return;
    // Save as a draft in the drafts collection so it can enter Ready to Post / Queue safely.
    fetch('/api/tweet-lab/store/drafts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: reply.text, angle: reply.angle || 'Reply draft', sourceRefs: reply.sourceRefs || [], status: 'generated', warnings: reply.warnings || [] })
    })
      .then(r => r.json())
      .then(() => {
        setStatus($('#myRepliesStatus') || {}, 'Saved to Ready to Post / Queue as draft.', 'ok');
        loadDrafts();
      })
      .catch(() => setStatus($('#myRepliesStatus') || {}, 'Failed to queue reply.', 'error'));
  }));
}

function bindMyRepliesEvents() {
  $('#myRepliesFilters')?.addEventListener('click', () => {
    const panel = $('#myRepliesFiltersPanel');
    if (!panel) return;
    panel.hidden = !panel.hidden;
    $('#myRepliesFilters').setAttribute('aria-expanded', String(!panel.hidden));
  });
  $('#myRepliesStatusFilter')?.addEventListener('change', event => { myRepliesState.statusFilter = event.target.value; renderMyReplies(); });
  $('#myRepliesDateFilter')?.addEventListener('change', event => { myRepliesState.dateFilter = event.target.value; renderMyReplies(); });
  $('#myRepliesSearch')?.addEventListener('input', event => { myRepliesState.search = event.target.value; renderMyReplies(); });
}

bindMyRepliesEvents();
loadMyReplies();
