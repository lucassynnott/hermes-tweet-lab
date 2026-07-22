/* Pop-out left sidebar for mobile. Self-contained: only adds drawer behavior,
   never touches app.js state. Desktop is unaffected (drawer styles are gated
   behind a max-width media query; this script just toggles a body class). */
(function () {
  "use strict";
  var MQ = window.matchMedia("(max-width: 960px)");
  var body = document.body;
  var toggle = document.getElementById("navToggle");
  var scrim = document.getElementById("navScrim");
  var sidebar = document.getElementById("primarySidebar");
  if (!toggle || !sidebar) return;

  function isOpen() { return body.classList.contains("nav-open"); }

  function open() {
    body.classList.add("nav-open");
    toggle.setAttribute("aria-expanded", "true");
    if (scrim) scrim.hidden = false;
    // focus first nav link for keyboard users
    var first = sidebar.querySelector("a, button");
    if (first && MQ.matches) { try { first.focus({ preventScroll: true }); } catch (e) {} }
  }

  function close() {
    body.classList.remove("nav-open");
    toggle.setAttribute("aria-expanded", "false");
    if (scrim) scrim.hidden = true;
  }

  function toggleDrawer() { isOpen() ? close() : open(); }

  toggle.addEventListener("click", toggleDrawer);
  if (scrim) scrim.addEventListener("click", close);

  // The in-drawer chevron doubles as a close button on mobile.
  var collapseBtn = sidebar.querySelector(".sidebar-collapse");
  if (collapseBtn) collapseBtn.addEventListener("click", function (e) {
    if (MQ.matches) { e.preventDefault(); close(); }
  });

  // Close after picking a destination (nav links + quick-route buttons).
  sidebar.addEventListener("click", function (e) {
    var hit = e.target.closest("a[href^='#'], [data-route], [data-go-route]");
    if (hit && MQ.matches) close();
  });

  // Esc closes.
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isOpen()) close();
  });

  // Any hash/route change closes the drawer on mobile.
  window.addEventListener("hashchange", function () { if (MQ.matches) close(); });

  // Returning to desktop width resets state.
  function onChange() { if (!MQ.matches) close(); }
  if (MQ.addEventListener) MQ.addEventListener("change", onChange);
  else if (MQ.addListener) MQ.addListener(onChange);
})();
