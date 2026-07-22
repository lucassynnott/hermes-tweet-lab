/* Operator profile: the "who I am + who to emulate" inputs that shape generated
   drafts, alongside the server-side Obsidian vault + X voice DNA. Self-contained:
   persists to localStorage and syncs into the existing generation fields
   (#homeTone, #homeAccountHandles, #accountHandles) so app.js picks them up with
   no coupling. app.js also reads tweetLabOperatorProfile directly to fold the
   "about me" persona into the generate context. */
(function () {
  "use strict";
  var KEY = "tweetLabOperatorProfile";
  var $ = function (s) { return document.querySelector(s); };

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; }
    catch (e) { return {}; }
  }
  function save(p) { localStorage.setItem(KEY, JSON.stringify(p)); }

  function parseHandles(raw) {
    return (raw || "")
      .split(/[\s,\n]+/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean)
      .map(function (s) {
        var m = s.match(/(?:x\.com\/|twitter\.com\/|@)?([A-Za-z0-9_]{1,15})\/?$/);
        return m ? "@" + m[1] : null;
      })
      .filter(Boolean);
  }

  function dedupe(arr) {
    var seen = {}, out = [];
    arr.forEach(function (h) {
      var k = h.toLowerCase();
      if (!seen[k]) { seen[k] = 1; out.push(h); }
    });
    return out;
  }

  var state = load();
  if (!Array.isArray(state.emulateAccounts)) state.emulateAccounts = [];

  /* push saved settings into the live generation fields app.js already reads */
  function syncToGenerationFields() {
    var handles = state.emulateAccounts.join(", ");
    ["#homeAccountHandles", "#accountHandles"].forEach(function (sel) {
      var el = $(sel);
      if (el && handles && !el.value.trim()) {
        el.value = handles;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    var tone = $("#homeTone");
    if (tone && state.tone && !tone.value.trim()) tone.value = state.tone;
  }

  function renderChips() {
    var box = $("#opAccountChips");
    if (!box) return;
    if (!state.emulateAccounts.length) {
      box.className = "op-chips empty";
      box.textContent = "No accounts yet. Add handles you want the drafts to emulate.";
      return;
    }
    box.className = "op-chips";
    box.innerHTML = "";
    state.emulateAccounts.forEach(function (h) {
      var chip = document.createElement("span");
      chip.className = "op-chip";
      var label = document.createElement("span");
      label.textContent = h;
      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "op-chip-remove";
      rm.setAttribute("aria-label", "Remove " + h);
      rm.textContent = "×";
      rm.addEventListener("click", function () {
        state.emulateAccounts = state.emulateAccounts.filter(function (x) { return x !== h; });
        renderChips();
      });
      chip.appendChild(label);
      chip.appendChild(rm);
      box.appendChild(chip);
    });
  }

  function hydrateForm() {
    if ($("#opAboutMe")) $("#opAboutMe").value = state.aboutMe || "";
    if ($("#opAudience")) $("#opAudience").value = state.audience || "";
    if ($("#opTone")) $("#opTone").value = state.tone || "";
    if ($("#opTopics")) $("#opTopics").value = state.topics || "";
    renderChips();
  }

  function addAccountsFromInput() {
    var input = $("#opAccountInput");
    if (!input) return;
    var added = parseHandles(input.value);
    if (added.length) {
      state.emulateAccounts = dedupe(state.emulateAccounts.concat(added));
      input.value = "";
      renderChips();
    }
  }

  function persist() {
    state.aboutMe = ($("#opAboutMe") && $("#opAboutMe").value.trim()) || "";
    state.audience = ($("#opAudience") && $("#opAudience").value.trim()) || "";
    state.tone = ($("#opTone") && $("#opTone").value.trim()) || "";
    state.topics = ($("#opTopics") && $("#opTopics").value.trim()) || "";
    save(state);
    syncToGenerationFields();
    var s = $("#opSaveStatus");
    if (s) { s.textContent = "Saved. Drafts will use this profile."; s.dataset.state = ""; }
  }

  function bind() {
    var add = $("#opAccountAdd");
    if (add) add.addEventListener("click", addAccountsFromInput);
    var input = $("#opAccountInput");
    if (input) input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); addAccountsFromInput(); }
    });
    var saveBtn = $("#operatorProfileSave");
    if (saveBtn) saveBtn.addEventListener("click", persist);
  }

  function init() {
    hydrateForm();
    bind();
    syncToGenerationFields();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
  // re-sync when navigating routes (settings page may render late)
  window.addEventListener("hashchange", function () { setTimeout(hydrateForm, 50); });
})();
