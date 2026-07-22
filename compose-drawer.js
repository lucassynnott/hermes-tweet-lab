/* Right-side Compose drawer (SuperX "Create a post"). Self-contained: opens
   from any .create-post-button / #floatingCompose, holds a tweet editor with
   Postiz-style auto-actions + X/BlueSky targets, and wires to the real
   /store/drafts, /schedule, /schedule/queue and /rewrite endpoints. Scheduling
   safe-blocks until Postiz is configured (server returns the reason). */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.from((r || document).querySelectorAll(s)); };

  var drawer = $("#composeDrawer");
  var scrim = $("#composeScrim");
  if (!drawer) return;

  function open(prefill) {
    if (typeof prefill === "string" && prefill) {
      $("#composeText").value = prefill;
      updateCount();
    }
    document.body.classList.add("compose-open");
    drawer.setAttribute("aria-hidden", "false");
    if (scrim) scrim.hidden = false;
    if (!$("#composeWhen").value) setDefaultWhen();
    setTimeout(function () { $("#composeText").focus(); }, 60);
  }
  function close() {
    document.body.classList.remove("compose-open");
    drawer.setAttribute("aria-hidden", "true");
    if (scrim) scrim.hidden = true;
  }

  function setDefaultWhen() {
    // default to ~1 hour out, local time, formatted for datetime-local
    var d = new Date(Date.now() + 60 * 60 * 1000);
    var pad = function (n) { return String(n).padStart(2, "0"); };
    $("#composeWhen").value =
      d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function updateCount() {
    var n = ($("#composeText").value || "").length;
    var el = $("#composeCount");
    el.textContent = n;
    el.classList.toggle("over", n > 280);
  }

  function settingsPayload() {
    return {
      autoRetweet: $("#optAutoRetweet").checked,
      autoPlug: $("#optAutoPlug").checked,
      autoDm: $("#optAutoDm").checked,
      autoDelete: $("#optAutoDelete").checked,
      superFollowersOnly: $("#optSuperFollowers").checked
    };
  }
  function targetsPayload() {
    return { x: $("#composePostX").checked, bluesky: $("#composePostBsky").checked };
  }

  function status(msg, state) {
    var el = $("#composeStatus");
    el.textContent = msg || "";
    el.dataset.state = state || "";
  }

  function text() { return ($("#composeText").value || "").trim(); }

  async function saveDraft(extraStatus) {
    if (!text()) { status("Write something first.", "error"); return; }
    status("Saving draft…");
    try {
      var res = await fetch("/api/tweet-lab/store/drafts", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: text(), angle: "Manual compose", rationale: "", sourceRefs: [],
          warnings: [], status: extraStatus || "draft"
        })
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
      status(extraStatus === "queued" ? "Added to queue." : "Draft saved.", "ok");
    } catch (e) { status(e.message, "error"); }
  }

  async function schedule() {
    if (!text()) { status("Write something first.", "error"); return; }
    var when = $("#composeWhen").value;
    if (!when) { status("Pick a schedule time.", "error"); return; }
    status("Scheduling through Postiz…");
    try {
      var res = await fetch("/api/tweet-lab/schedule", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: text(),
          scheduledAt: new Date(when).toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          integrationId: "",
          settings: settingsPayload(),
          targets: targetsPayload()
        })
      });
      var data = await res.json();
      if (!res.ok) {
        // Postiz not configured -> safe-blocked. Be honest, offer to save instead.
        status((data.error || ("HTTP " + res.status)) + " — saved as a queued draft instead.", "error");
        await saveDraft("queued");
        return;
      }
      status("Scheduled.", "ok");
      loadScheduled();
    } catch (e) { status(e.message, "error"); }
  }

  async function rewrite() {
    if (!text()) { status("Write something to rewrite.", "error"); return; }
    status("Goro is rewriting…");
    try {
      var res = await fetch("/api/tweet-lab/rewrite", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: text(), count: 1 })
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
      var cand = (data.drafts && data.drafts[0]) || (data.candidates && data.candidates[0]);
      if (cand && cand.text) { $("#composeText").value = cand.text; updateCount(); status("Rewritten via " + (data.adapter || "goro") + ".", "ok"); }
      else status("No rewrite returned.", "error");
    } catch (e) { status(e.message, "error"); }
  }

  function setTab(name) {
    $$(".compose-tab").forEach(function (t) { t.classList.toggle("active", t.dataset.composeTab === name); });
    $$(".compose-panel").forEach(function (p) { p.hidden = p.dataset.composePane !== name; });
    if (name === "drafts") loadDrafts();
    if (name === "scheduled") loadScheduled();
  }

  function escapeHtml(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }

  async function loadDrafts() {
    var box = $("#composeDraftsList");
    try {
      var res = await fetch("/api/tweet-lab/store/drafts");
      var data = await res.json();
      var items = data.items || data.drafts || [];
      if (!items.length) { box.className = "compose-list empty"; box.textContent = "No drafts yet."; return; }
      box.className = "compose-list";
      box.innerHTML = items.slice(0, 30).map(function (d) {
        return '<article class="compose-list-item" data-load-draft="' + escapeHtml(d.id) + '"><p>' + escapeHtml(d.text || "") + '</p><span class="compose-list-meta">' + escapeHtml(d.status || "draft") + " · " + ((d.text || "").length) + "/280</span></article>";
      }).join("");
      $$("[data-load-draft]", box).forEach(function (el) {
        el.addEventListener("click", function () {
          var d = items.find(function (x) { return String(x.id) === el.dataset.loadDraft; });
          if (d) { setTab("compose"); $("#composeText").value = d.text || ""; updateCount(); }
        });
      });
    } catch (e) { box.className = "compose-list empty"; box.textContent = "Could not load drafts."; }
  }

  async function loadScheduled() {
    var box = $("#composeScheduledList");
    try {
      var res = await fetch("/api/tweet-lab/schedule/queue");
      var data = await res.json();
      var items = data.items || data.queue || data.scheduled || [];
      if (!items.length) { box.className = "compose-list empty"; box.textContent = "Nothing scheduled. Connect Postiz to schedule posts."; return; }
      box.className = "compose-list";
      box.innerHTML = items.slice(0, 30).map(function (s) {
        return '<article class="compose-list-item"><p>' + escapeHtml(s.content || s.text || "") + '</p><span class="compose-list-meta">' + escapeHtml(s.scheduledAt || s.date || "") + "</span></article>";
      }).join("");
    } catch (e) { box.className = "compose-list empty"; box.textContent = "Could not load scheduled posts."; }
  }

  // ── wiring ──
  $$(".create-post-button, #floatingCompose, [data-open-compose]").forEach(function (b) {
    b.addEventListener("click", function (e) { e.preventDefault(); open(); });
  });
  $("#composeClose").addEventListener("click", close);
  if (scrim) scrim.addEventListener("click", close);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && document.body.classList.contains("compose-open")) close(); });
  $("#composeText").addEventListener("input", updateCount);
  $$(".compose-tab").forEach(function (t) { t.addEventListener("click", function () { setTab(t.dataset.composeTab); }); });
  $("#composeSaveDraft").addEventListener("click", function () { saveDraft("draft"); });
  $("#composeAddQueue").addEventListener("click", function () { saveDraft("queued"); });
  $("#composeSchedule").addEventListener("click", schedule);
  $("#composeRewrite").addEventListener("click", rewrite);

  // expose for other modules / Edit-post buttons
  window.openComposeDrawer = open;
})();
