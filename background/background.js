/* Reddibility background script: keyboard shortcut + badge indicator.
   Tab delivery (message + fallback injection) and badge updates live in
   lib/shared.js (GR.applyToTab / GR.updateBadge) so the popup and options
   page can share the exact same behavior, including badge refreshes. */

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
});

browser.tabs.onUpdated.addListener(async function (tabId, change, tab) {
  if (change.status === "complete" && /^https?:/.test(tab.url || "")) {
    var state = await GR.load();
    var settings = GR.effective(state, GR.getDomain(tab.url));
    updateBadge(tabId, settings.enabled);
  }
});
