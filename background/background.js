/* Reddibility background script: keyboard shortcut + badge indicator.
   Tab delivery (message + fallback injection) and badge updates live in
   lib/shared.js (GR.applyToTab / GR.updateBadge) so the popup and options
   page can share the exact same behavior, including badge refreshes. */

// Dynamic site-access content scripts (non-Reddit sites are opt-in — see
// lib/shared.js): keep registrations in sync with the granted origins.
// Firefox keeps running a registered script after its permission is revoked
// (bug 1772698), so revocation MUST be answered with an explicit unregister;
// reconcileSiteScripts() handles that on every permission change and at
// startup (also healing anything lost across restarts).
if (browser.permissions && browser.permissions.onAdded) {
  browser.permissions.onAdded.addListener(function () { GR.reconcileSiteScripts(); });
}
if (browser.permissions && browser.permissions.onRemoved) {
  browser.permissions.onRemoved.addListener(function () { GR.reconcileSiteScripts(); });
}
GR.reconcileSiteScripts();

browser.runtime.onInstalled.addListener(async function (details) {
  // Fresh installs default to enabled (see DEFAULTS.enabled), but content
  // scripts only auto-run on page loads *after* install — the tabs already
  // open at install time have neither CSS nor JS injected. Push the
  // effective settings to every open http(s) tab so Reddibility visibly
  // works immediately instead of after a manual reload. applyToTab's
  // fallback injects the content script where missing; restricted pages
  // and non-Reddit sites without granted access reject — ignore those,
  // same as every other caller.
  if (details.reason !== "install") return;
  var state = await GR.load();
  var tabs = await browser.tabs.query({});
  for (var tab of tabs) {
    if (!/^https?:/.test(tab.url || "")) continue;
    var domain = GR.getDomain(tab.url);
    var settings = GR.effective(state, domain);
    if (!settings.enabled) continue;
    GR.applyToTab(tab.id, settings).catch(function () {});
    GR.updateBadge(tab.id, true);
  }
});

browser.commands.onCommand.addListener(async function (command) {
  if (command !== "toggle-readability") return;
  var tabs = await browser.tabs.query({ active: true, currentWindow: true });
  var tab = tabs[0];
  if (!tab || !/^https?:/.test(tab.url || "")) return;

  var domain = GR.getDomain(tab.url);
  var state = await GR.load();

  // Toggle per-site: flip the current site's effective state and store it as
  // an override for this domain (matches the popup's default per-site behavior).
  var eff = GR.effective(state, domain);
  if (!state.perDomain[domain]) {
    // Seed the override from the effective settings — GR.effective returns a
    // fully detached deep copy, so the override's nested reddit object can
    // never alias the global one (a shallow Object.assign copy did exactly
    // that, leaking later per-site edits into global settings).
    state.perDomain[domain] = eff;
  }
  state.perDomain[domain].enabled = !eff.enabled;
  await GR.save(state);

  var settings = GR.effective(state, domain);
  GR.applyToTab(tab.id, settings).catch(function () {}); // restricted pages — ignore
  GR.updateBadge(tab.id, settings.enabled);
  // Non-Reddit sites are opt-in: if access hasn't been granted, nothing can
  // run there (the toggle above just saves the setting for later).
  // permissions.request needs a user gesture in an extension page, so the
  // background can't ask directly — best effort: pop the panel open so the
  // user can flip the switch and grant access.
  if (settings.enabled && !GR.isRedditDomain(domain)) {
    GR.hasSiteAccess(domain).then(function (ok) {
      if (!ok && browser.action && browser.action.openPopup) {
        browser.action.openPopup().catch(function () {});
      }
    });
  }
});

browser.tabs.onUpdated.addListener(async function (tabId, change, tab) {
  if (change.status === "complete" && /^https?:/.test(tab.url || "")) {
    var state = await GR.load();
    var settings = GR.effective(state, GR.getDomain(tab.url));
    updateBadge(tabId, settings.enabled);
  }
});
