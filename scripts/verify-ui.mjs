import { readFile } from 'node:fs/promises';

const checks = [];
function check(name, condition) {
  checks.push({ name, ok: Boolean(condition) });
}

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const server = await readFile(new URL('../server.js', import.meta.url), 'utf8');
const network = await readFile(new URL('../lib/network.js', import.meta.url), 'utf8');
const store = await readFile(new URL('../lib/store.js', import.meta.url), 'utf8');
const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

for (const page of ['home', 'queue', 'analytics', 'mentions', 'discover', 'lists', 'my-replies', 'ready-to-post', 'inspiration', 'ai-writer', 'contacts', 'dms']) {
  check(`page route: ${page}`, html.includes(`data-page="${page}"`) && (html.includes(`data-route="${page}"`) || ['library', 'settings'].includes(page)));
}

check('left-sidebar app shell', html.includes('superx-sidebar') && html.includes('superx-nav') && css.includes('--sidebar-width'));
check('SuperX navigation IA replaces legacy visible nav labels',
  html.includes('Home</span>')
  && html.includes('Queue</span>')
  && html.includes('Analytics</span>')
  && html.includes('Mentions</span>')
  && html.includes('Ready to Post</span>')
  && html.includes('AI Writer</span>')
  && !html.includes('>Workbench</a>')
  && !html.includes('>Schedule</a>')
  && !html.includes('>Settings</a>')
);
check('SuperX shell visual system contract',
  css.includes('--bg: #050505')
  && css.includes('--accent: #ff493d')
  && css.includes('.floating-compose')
  && css.includes('.sidebar-footer')
  && css.includes('.queue-banner')
  && css.includes('.masonry-grid')
);
check('command center dashboard contract',
  (
    html.includes('id="commandCenter"')
    && html.includes('id="dashXHealth"')
    && html.includes('id="dashLastFetch"')
    && html.includes('id="dashSelectedSources"')
    && html.includes('id="dashDraftBacklog"')
    && html.includes('id="dashApprovedUnscheduled"')
    && html.includes('id="dashNextSlot"')
    && html.includes('id="dashWarnings"')
    && app.includes('commandCenterSnapshot')
    && app.includes('runCommandCenterAction')
    && css.includes('.command-center')
  ) || (
    html.includes('id="contextStatusCard"')
    && html.includes('id="dashVoiceDna"')
    && html.includes('id="dashPreviousPosts"')
    && html.includes('id="dashObsidian"')
    && html.includes('id="dashCompany"')
    && html.includes('id="dashSourceBank"')
    && html.includes('id="dashLiveX"')
    && html.includes('id="contextGenerateAction"')
    && app.includes('renderContextStatus')
  )
);
check('command center next-best-action states',
  app.includes("label: 'Fetch inspiration'")
  && app.includes("label: 'Rewrite selected'")
  && app.includes("label: 'Review drafts'")
  && app.includes("label: 'Schedule approved draft'")
  && app.includes("label: 'Fix config'")
);

check('analytics route SuperX operational dashboard contract',
  html.includes('data-page="analytics"')
  && html.includes('id="analyticsMetricGrid"')
  && html.includes('id="analyticsRange"')
  && html.includes('id="analyticsHeatmap"')
  && html.includes('id="analyticsSmallCards"')
  && html.includes('id="analyticsLargeChart"')
  && app.includes('buildAnalyticsSnapshot')
  && app.includes('renderAnalyticsMetricCards')
  && app.includes('renderAnalyticsHeatmap')
  && app.includes('renderAnalyticsLargeChart')
  && css.includes('.analytics-metric-grid')
  && css.includes('.analytics-heatmap-card')
);
check('analytics avoids fake X account metrics',
  html.includes('Local operational analytics')
  && html.includes('Live X account analytics are unavailable')
  && app.includes("X impressions unavailable")
  && app.includes("Followers unavailable")
  && app.includes('Stored source impressions')
  && !html.includes('Engagements</h3>')
);
check('analytics uses local persisted data inputs',
  app.includes('state.drafts')
  && app.includes('state.sources')
  && app.includes('state.scheduleQueue')
  && app.includes('source snapshots only')
  && app.includes('local queue state')
);

check('fewer-card workbench layout', (html.includes('workbench-layout') && html.includes('right-rail') && css.includes('.workbench-layout')) || (html.includes('id="contextStatusCard"') && html.includes('id="homeGenerationControls"') && css.includes('generation-controls')));
check('SuperX Inspiration route contract',
  html.includes('data-inspiration-tab="posts"')
  && html.includes('data-inspiration-tab="articles"')
  && html.includes('data-inspiration-tab="media"')
  && html.includes('id="inspirationSearch"')
  && html.includes('id="inspirationTimeRange"')
  && html.includes('id="inspirationSourceScope"')
  && html.includes('id="inspirationAdvancedFilters"')
  && html.includes('id="inspirationResults"')
  && html.includes('id="sourceBankTools"')
  && app.includes('renderInspiration')
  && app.includes('runInspirationSearch')
  && app.includes('sourceIsArticle')
  && app.includes('sourceHasMedia')
  && css.includes('.inspiration-masonry')
  && css.includes('.inspiration-card')
);
check('Inspiration keeps live X and saved source actions without public writes',
  app.includes('data-insp-rewrite-live')
  && app.includes('data-insp-save-live')
  && app.includes('data-insp-edit-source')
  && app.includes('toggleInspirationSourceSelection')
  && !html.includes('Publish now')
);
check('account inspiration input UI', (html.includes('id="accountHandles"') && html.includes('id="fetchLiveTweets"') && html.includes('id="accountChips"')) || (html.includes('id="homeAccountHandles"') && html.includes('id="homeFetchLiveTweets"') && html.includes('id="homeAccountChips"')));
check('account normalization client-side', app.includes('normalizeAccountInput') && app.includes('accountInputsFromField'));
check('live fetch client route', app.includes("/api/tweet-lab/live/accounts/tweets") && app.includes('fetchLiveTweets'));
check('live tweet cards render identity/text/media/url/actions',
  app.includes('tweet.author?.profileImageUrl')
  && app.includes('tweet-media')
  && app.includes('data-rewrite-live')
  && app.includes('data-copy-live')
  && app.includes('data-save-live')
  && app.includes('live X API')
);
check('copy live tweet uses Clipboard API', app.includes('navigator.clipboard') && app.includes('tweet.text') && app.includes('tweet.url'));
check('save live tweet source uses existing source store', app.includes('/api/tweet-lab/store/sources') && app.includes('tweetToSelectedSource'));
check('rewrite selected live tweets uses dedicated rewrite route', app.includes('rewriteLiveTweet') && app.includes("/api/tweet-lab/rewrite") && app.includes('sourceTweet: tweetToSelectedSource(tweet)'));
check('existing generation controls preserved', (html.includes('id="inspirationLinks"') && html.includes('id="context"') && html.includes('id="generateButton"')) || (html.includes('id="homeInspirationLinks"') && html.includes('id="homeContext"') && html.includes('id="homeGenerateButton"')));
check('existing drafts/review preserved', html.includes('id="draftList"') && (app.includes('data-draft-editor') || app.includes('renderDraftDetail') || app.includes('modalDraftEditor')) && (app.includes('data-review-draft') || app.includes('detailReview') || app.includes('modalReview')) && app.includes('Use for schedule'));
check('draft copy action preserved', app.includes('data-copy-draft') && app.includes('Draft copied'));
check('existing schedule preserved', html.includes('id="scheduleButton"') && html.includes('type="datetime-local"') && server.includes('/api/tweet-lab/schedule'));
check('schedule has approved-draft intake', html.includes('id="approvedIntakeList"') && app.includes('data-schedule-approved') && app.includes('selectDraftForSchedule'));
check('schedule has weekly/list calendar view', html.includes('id="queueCalendar"') && html.includes('id="queueListCalendar"') && app.includes('calendarItemTime') && server.includes('approvedIntake'));
check('SuperX Queue route contract',
  html.includes('class="page queue-page"')
  && html.includes('Fill your queue with reviewed posts')
  && html.includes('data-queue-tab="scheduled"')
  && html.includes('data-queue-tab="drafts"')
  && html.includes('data-queue-tab="posted"')
  && html.includes('data-queue-tab="failed"')
  && html.includes('id="editQueueButton"')
  && html.includes('id="queueEditPanel"')
  && app.includes('setQueueTab')
  && app.includes('queueGroupByDay')
  && css.includes('.superx-time-slot')
  && css.includes('.queue-tabbar')
);
check('Queue posted/failed are receipt-backed and labeled unavailable when empty',
  server.includes('posted: postedDrafts')
  && server.includes('failed,')
  && app.includes('No local/Postiz posted receipts available')
  && app.includes('failed schedule receipts recorded')
);
check('suggested times preserve conflict validation', app.includes('data-use-suggestion') && app.includes('checkConflictForScheduledAt()') && server.includes('/api/tweet-lab/schedule/check'));

// Ready to Post masonry grid contract
check('Ready to Post masonry cards contract',
  html.includes('id="homeDraftMasonry"')
  && html.includes('masonry-grid')
  && (css.includes('.draft-masonry-card') || css.includes('.masonry-card'))
);
check('Ready to Post card renders SuperX-style avatar/name/handle/text/provenance/actions',
  app.includes('renderHomeDraftCard')
  && app.includes('masonry-avatar')
  && app.includes('masonry-card-author')
  && app.includes('card-provenance')
  && app.includes('masonry-card-actions')
  && app.includes('Edit post')
);
check('Ready to Post tab filtering wired',
  app.includes('setDraftTab')
  && app.includes('matchesDraftTab')
  && app.includes('getDraftTab')
  && app.includes('provenanceLine')
);
check('Ready to Post modal preserves lifecycle actions',
  app.includes('modalSave')
  && app.includes('modalReview')
  && app.includes('modalNeedsProof')
  && app.includes('modalApprove')
  && app.includes('modalCopy')
  && app.includes('modalSchedule')
  && app.includes('modalReject')
);
check('Ready to Post style customization reads/writes localStorage without damaging voice DNA',
  app.includes('localStorage.setItem')
  && app.includes('tweetLabStylePrefs')
  && app.includes('saveStylePrefs')
  && app.includes('loadStylePrefs')
  && app.includes('Style preferences saved locally')
);
check('Ready to Post generate more uses existing safe generation pipeline',
  app.includes('generateMoreDrafts')
  && app.includes('/api/tweet-lab/generate')
  && app.includes('loadDrafts')
);
check('templates/settings/source bank preserved under library', html.includes('id="templateList"') && html.includes('id="sourceList"') && html.includes('id="configStatus"'));
check('server exposes live X account endpoint', server.includes('/api/tweet-lab/live/accounts/tweets') && server.includes('fetchLiveAccountTweets'));
check('server keeps X auth server-side', server.includes('getXBearerToken') && server.includes('authorization: `Bearer ${bearerToken}`') && !app.includes('X_BEARER_TOKEN') && !html.includes('X_BEARER_TOKEN'));
check('config exposes X read-only status without token', server.includes('xConfigured') && server.includes('xReadOnly') && app.includes('config.xConfigured'));
check('server normalizes X tweet card data', server.includes('normalizeXTweet') && server.includes('profileImageUrl') && server.includes('media.fields'));
check('rate-limit headers captured', server.includes('x-rate-limit-remaining') && server.includes('x-rate-limit-reset'));
check('browser files contain no bearer token label', !/(Bearer Token|bearerToken|X_BEARER_TOKEN)/.test(`${html}\n${app}\n${css}`));
check('README documents live account inspiration', readme.includes('/api/tweet-lab/live/accounts/tweets') && readme.includes('X_BEARER_TOKEN'));
check('README portable clone path', readme.includes('git clone https://github.com/lucassynnott/hermes-tweet-lab.git') && !readme.includes('/kanban/boards/'));
check('mock mode explicit', server.includes("GORO_GENERATE_MODE === 'mock'") && readme.includes('GORO_GENERATE_MODE=mock'));
check('Hermes CLI fallback documented', server.includes('GORO_HERMES_PROFILE') && readme.includes('Hermes CLI'));
check('no scratch workspace references in app files', ![html, css, app, server, readme].join('\n').includes('/home/lucas/.hermes/kanban/boards/'));

// Operator health diagnostics panel — covers acceptance criteria for the
// "Settings becomes a health panel" deliverable.
check('settings route marked as operator health panel',
  html.includes('data-page="settings"')
  && html.includes('operator health panel')
  && html.includes('Tweet Lab runtime health')
);
check('diagnostics endpoint registered', server.includes('/api/tweet-lab/diagnostics') && server.includes('buildDiagnosticsReport'));
check('diagnostics panel has refresh + copy buttons', html.includes('id="refreshDiagnostics"') && html.includes('id="copyDiagnostics"'));
check('diagnostics panel cells cover app/goro/x/postiz/storage',
  html.includes('id="diagApp"')
  && html.includes('id="diagGoro"')
  && html.includes('id="diagX"')
  && html.includes('id="diagPostiz"')
  && html.includes('id="diagStorage"')
);
check('diagnostics panel renders detail blocks',
  html.includes('id="diagFetch"')
  && html.includes('id="diagGoroDetail"')
  && html.includes('id="diagScheduleDetail"')
);
check('diagnostics blocked-state remedies present',
  html.includes('id="diagRemedies"')
  && html.includes('Postiz')
  && html.includes('X reads')
  && html.includes('Goro')
);
check('diagnostics fetch + clipboard copy wired',
  app.includes("fetch('/api/tweet-lab/diagnostics')")
  && app.includes('writeClipboard')
  && app.includes('buildDiagnosticsBundle')
);
check('diagnostics never logs raw error.message (uses sanitised lastFailure)', app.includes('lastFailure.error?.slice(0, 80)'));
check('safe-boundary explanation panel in settings',
  html.includes('safe boundary')
  && html.includes('X read credential')
  && html.includes('Postiz API credential')
  && readme.includes('X_BEARER_TOKEN')
);

// Network / Lists / Contacts / DMs — safe placeholders + local store contract.
check('lists route marked as superx page with rail + form',
  html.includes('data-page="lists"')
  && html.includes('id="listsList"')
  && html.includes('id="listsSummary"')
  && html.includes('id="listsFormPanel"')
  && html.includes('id="listsSeedPreview"')
);
check('contacts route marked as superx page with rail + form + view',
  html.includes('data-page="contacts"')
  && html.includes('id="contactsList"')
  && html.includes('id="contactsSummary"')
  && html.includes('id="contactsFormPanel"')
  && html.includes('id="contactsViewPanel"')
);
check('dms route marked as superx page with unavailable state',
  html.includes('data-page="dms"')
  && html.includes('id="dmsStatus"')
  && html.includes('id="dmsReason"')
  && html.includes('id="dmsBlockedBy"')
  && html.includes('id="dmsCapabilities"')
);
check('dms sidebar entry tagged blocked',
  /data-route="dms"[^>]*data-blocked="true"/.test(html)
  && html.includes('class="nav-blocked-tag"')
);
check('network feature contract endpoint registered',
  server.includes("'/api/tweet-lab/network'")
  && server.includes('listFeaturesBySection')
  && server.includes('explainBlocked')
);
check('network feature contract module lists dms as unavailable',
  (network.includes("'dms'") || network.includes('"dms"'))
  && network.includes('Direct messages are intentionally NOT supported')
);
check('lib/network.js defines explicit feature metadata',
  /Direct messages require the X DM endpoints/.test(network)
);
check('lists + contacts CRUD wired in app.js',
  app.includes("fetch('/api/tweet-lab/store/lists'")
  && app.includes("fetch('/api/tweet-lab/store/contacts'")
  && app.includes('loadLists')
  && app.includes('loadContacts')
);
check('dms blocked reason copy preserved in app.js',
  app.includes('renderDmsStatus')
  && app.includes('dms-status unavailable')
);
check('contacts safety rail rejects DM/email in notes (client + server)',
  app.includes('Contact notes must not contain DM bodies')
  && (store.includes('Contact notes must not contain DM bodies') || network.includes('Contact notes must not contain DM bodies'))
);
check('lists/contacts/auditLog collections registered in store',
  store.includes("'lists'") && store.includes("'contacts'") && store.includes("'auditLog'")
);
check('sidebar nav lists DMs last in Network section, blocked tag rendered',
  /nav-group[^>]*aria-label="Network"[\s\S]*?<a href="#contacts"[\s\S]*?<a href="#dms"[^>]*data-blocked="true"/.test(html)
  && html.includes('class="nav-blocked-tag"')
);

// ── Mentions feed + private AI reply drafts ────────────────────────
// Acceptance criteria for t_d5f8977b.
check('mentions page registered with SuperX layout shell',
  html.includes('data-page="mentions"')
  && html.includes('id="mentionsAccountSelect"')
  && html.includes('id="mentionsCount"')
  && html.includes('id="mentionsFeed"')
  && html.includes('id="mentionsBlocker"')
);
check('mentions header + subtitle + filter + account selector match screenshot',
  /<h2>Mentions<\/h2>/.test(html)
  && html.includes('See replies and mentions across all your connected accounts in one feed.')
  && html.includes('id="mentionsFiltersButton"')
  && css.includes('.mentions-toolbar')
  && css.includes('.mentions-account-selector')
  && css.includes('.mentions-count')
);
check('mentions feed cards show parent context, author, metrics, and reply composer',
  css.includes('.mention-card')
  && css.includes('.mention-original')
  && css.includes('.mention-author-row')
  && css.includes('.mention-avatar')
  && css.includes('.mention-metrics')
  && css.includes('.mention-reply-composer')
  && css.includes('.mention-reply-actions')
);
check('mentions AI reply action wired in app.js',
  app.includes('mentionsAiDraft')
  && app.includes('mentionsSaveLocal')
  && app.includes("'/api/tweet-lab/mentions/reply/draft'")
  && app.includes("'/api/tweet-lab/mentions/status'")
);
check('mentions replies save to local drafts/replies store with sourceRefs',
  /replies:\s*\{/.test(store)
  && server.includes("createItem('replies'")
  && app.includes("'/api/tweet-lab/store/replies'")
  && app.includes('sourceRefs: mention.url ? [mention.url] : []')
  && app.includes('published: false')
);
check('mentions server endpoints registered (status / fetch / reply/draft)',
  server.includes("'/api/tweet-lab/mentions/status'")
  && server.includes("'/api/tweet-lab/mentions/fetch'")
  && server.includes("'/api/tweet-lab/mentions/reply/draft'")
  && server.includes('mentionsConfigStatus')
  && server.includes('fetchLiveMentions')
  && server.includes('draftMentionReply')
);
check('mentions blocker surfaces X_USER_ACCESS_TOKEN requirement verbatim',
  server.includes('X_USER_ACCESS_TOKEN')
  && server.includes('503')
  && app.includes('mentions.blocked')
  && app.includes('mentions.blockerMessage')
  && app.includes('mentions.credential')
  && /Required server env var: <code>\$\{escapeHtml\(credential\)\}<\/code>/.test(app)
);
check('mentions has no public reply/write path',
  !app.includes("fetch('/api/tweet-lab/mentions/reply/publish')")
  && !app.includes("fetch('/api/tweet-lab/mentions/reply/send')")
  && !server.includes("'/api/tweet-lab/mentions/reply/publish'")
  && !server.includes("'/api/tweet-lab/mentions/reply/send'")
);
check('mentions demo mentions are clearly labelled local demo, not live',
  app.includes('local-demo')
  && app.includes('local demo — not fetched from live X')
);

const failed = checks.filter(item => !item.ok);
for (const item of checks) console.log(`${item.ok ? '✓' : '✗'} ${item.name}`);
if (failed.length) {
  console.error(`\n${failed.length}/${checks.length} UI verification checks failed`);
  process.exit(1);
}
console.log(`\n${checks.length}/${checks.length} UI verification checks passed`);
