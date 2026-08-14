/* GoodReddit background script: keyboard shortcut + badge indicator. */

function updateBadge(tabId, enabled) {
  return Promise.all([
    browser.action.setBadgeText({ text: enabled ? "ON" : "", tabId: tabId }),
    browser.action.setBadgeBackgroundColor({ color: "#7c3aed", tabId: tabId }),
  ]).catch(function () {});
}

async function applyToTab(tab, settings) {
  try {
    await browser.tabs.sendMessage(tab.id, { type: "apply", settings: settings });
  } catch (e) {
    // Content script may not be loaded yet (e.g. page loaded before install,
    // or it ran on a frame it doesn't match). Inject as a fallback.
    try {
      await browser.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["lib/shared.js", "content/content.js"],
      });
      await browser.tabs.sendMessage(tab.id, { type: "apply", settings: settings });
    } catch (_) {
      /* restricted page (about:*, file://*, etc.) — ignore */
    }
  }
}

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
  await applyToTab(tab, settings);
  updateBadge(tab.id, settings.enabled);
});

browser.tabs.onUpdated.addListener(async function (tabId, change, tab) {
  if (change.status === "complete" && /^https?:/.test(tab.url || "")) {
    var state = await GR.load();
    var settings = GR.effective(state, GR.getDomain(tab.url));
    updateBadge(tabId, settings.enabled);
  }
});
