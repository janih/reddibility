/*
 * Shared constants & helpers for Reddibility.
 * Loaded before the other scripts in every context
 * (content script, background, popup, options) and exposes a global `GR`.
 */
var GR = (function () {
  "use strict";

  var DEFAULTS = {
    enabled: false,
    fontFamily: "sans", // sans | serif | readable
    fontSize: 108, // percent
    lineHeight: 1.65,
    letterSpacing: 0.01, // em
    wordSpacing: 0.04, // em
    textWidth: 78, // ch
    theme: "sepia",
    hideDistractions: false,
    reddit: {
      enabled: true,
      hideAds: true,
      hideRightSidebar: true,
      hideLeftClutter: true,
      hideTrending: true,
      widen: true,
      compactFeed: false,
      cleanComments: true,
      clickToLoadMedia: false,
      hideTopBar: false,
      minimizeJoinButtons: true,
      forceButtonColors: true,
      hideAvatars: false,
    },
  };

  var DEFAULT_PREFS = { uiMode: "auto" }; // "auto" | "light" | "dark"

  var FONT_STACKS = {
    sans: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    serif: 'Georgia, Cambria, Charter, "Times New Roman", Times, serif',
    readable: '"Helvetica Neue", "Inter", "Segoe UI", Arial, sans-serif',
  };

  // `scheme` ("light" | "dark") records whether each theme's background is
  // light or dark. It's fed into the CSS `color-scheme` property (see
  // content.js/reddit.css), which some of Reddit's own shadow-DOM components
  // (e.g. rpl-vote-button-group, comments-action-button,
  // shreddit-post-share-button) consult via the `light-dark()` CSS function
  // instead of Reddit's own overridable `--color-*` design tokens — without
  // this, those components fall back to the OS/browser dark-mode preference
  // and can render with a mismatched (e.g. always-black) background.
  var THEMES = {
    light: { name: "Light", bg: "#ffffff", text: "#1f2328", link: "#0969da", scheme: "light" },
    sepia: { name: "Sepia", bg: "#f4ecd8", text: "#5b4636", link: "#9a5b2d", scheme: "light" },
    dark: { name: "Dark", bg: "#1b1b1f", text: "#d6d6d6", link: "#7ab4ff", scheme: "dark" },
    highcontrast: { name: "High Contrast", bg: "#000000", text: "#ffffff", link: "#ffd400", scheme: "dark" },
    solarizedlight: { name: "Solarized Light", bg: "#fdf6e3", text: "#586e75", link: "#268bd2", scheme: "light" },
    solarizeddark: { name: "Solarized Dark", bg: "#002b36", text: "#93a1a1", link: "#268bd2", scheme: "dark" },
    nord: { name: "Nord", bg: "#2e3440", text: "#d8dee9", link: "#88c0d0", scheme: "dark" },
  };

  function getDomain(url) {
    try {
      var u = new URL(url);
      if (!u.hostname) return "";
      return u.hostname.replace(/^www\./, "");
    } catch (e) {
      return "";
    }
  }

  // Fresh, fully independent copy of a settings object — including the
  // nested `reddit` sub-object. Object.assign alone shallow-copies, which
  // used to alias DEFAULTS.reddit (or a global reddit object) into every
  // state: editing a setting then wrote through the shared reference, so
  // per-site edits leaked into global settings and even "Reset everything"
  // could return previously-mutated values. The deep merge also backfills
  // reddit.* keys added in newer versions for settings stored by older ones.
  function cloneSettings(obj) {
    var s = Object.assign({}, DEFAULTS, obj || {});
    s.reddit = Object.assign({}, DEFAULTS.reddit, (obj && obj.reddit) || {});
    return s;
  }

  function emptyState() {
    return {
      global: cloneSettings(),
      perDomain: {},
      prefs: Object.assign({}, DEFAULT_PREFS),
    };
  }

  // Settings live under the "reddibility" storage key. The project was
  // renamed (GoodReadability → GoodReddit → Reddibility); load() migrates any
  // data still stored under the pre-rename key so settings survive the
  // rename. Note the internal GR global and gr-* class prefixes predate the
  // rename too and are intentionally kept — renaming them would churn every
  // selector/test for no user-visible benefit.
  var STORAGE_KEY = "reddibility";
  var LEGACY_STORAGE_KEY = "goodreadability";

  function load() {
    return browser.storage.local.get([STORAGE_KEY, LEGACY_STORAGE_KEY]).then(function (res) {
      var stored = res[STORAGE_KEY] || res[LEGACY_STORAGE_KEY];
      if (!stored) return emptyState();
      var state = {
        global: cloneSettings(stored.global),
        perDomain: stored.perDomain || {},
        prefs: Object.assign({}, DEFAULT_PREFS, stored.prefs || {}),
      };
      // One-time migration from the pre-rename key: move the data under the
      // new key, then drop the legacy copy. Best-effort/fire-and-forget.
      if (!res[STORAGE_KEY] && browser.storage.local.set && browser.storage.local.remove) {
        var wrapped = {};
        wrapped[STORAGE_KEY] = state;
        browser.storage.local
          .set(wrapped)
          .then(function () { return browser.storage.local.remove(LEGACY_STORAGE_KEY); })
          .catch(function () {});
      }
      return state;
    });
  }

  function save(state) {
    var wrapped = {};
    wrapped[STORAGE_KEY] = state;
    return browser.storage.local.set(wrapped);
  }

  // Merge global settings with a per-domain override (if present). Like
  // cloneSettings, the nested reddit object is merged key-by-key (never
  // replaced wholesale or aliased), so the result is fully detached from
  // both state.global and the stored override, and overrides saved by older
  // versions pick up new reddit.* defaults instead of reading undefined.
  function effective(state, domain) {
    var ov = (domain && state.perDomain[domain]) || {};
    var merged = Object.assign({}, state.global, ov);
    merged.reddit = Object.assign(
      {},
      DEFAULTS.reddit,
      (state.global && state.global.reddit) || {},
      ov.reddit || {}
    );
    return merged;
  }

  function formatValue(id, v) {
    v = parseFloat(v);
    switch (id) {
      case "fontSize":
        return v + "%";
      case "lineHeight":
        return v.toFixed(2);
      case "letterSpacing":
        return v.toFixed(3) + "em";
      case "wordSpacing":
        return v.toFixed(2) + "em";
      case "textWidth":
        return v + "ch";
      default:
        return String(v);
    }
  }

  // Make sure a settings object has a `reddit` sub-object (used by editors).
  function ensureReddit(obj) {
    if (!obj.reddit) obj.reddit = Object.assign({}, DEFAULTS.reddit);
    return obj.reddit;
  }

  // Resolve the chosen UI mode to an actual "light" | "dark" value.
  function resolveUiMode(mode) {
    if (mode === "light" || mode === "dark") return mode;
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return "light";
  }

  // Deliver an "apply" message to a tab. If the content script isn't loaded
  // there (page opened before the extension was installed/updated), inject
  // the stylesheets + content script first — the manifest only injects them
  // at page load, so a tab that predates the extension has neither (and a
  // JS-only fallback used to toggle gr-* classes that had no matching
  // rules). CSS is injected before JS so the classes match rules immediately.
  // Returns a rejected promise on restricted pages (about:*, file:// without
  // host permission, …) — callers are expected to ignore that case. Only
  // meaningful in extension-page/background contexts.
  function applyToTab(tabId, settings) {
    if (typeof browser === "undefined" || !browser.tabs || !browser.scripting) {
      return Promise.reject(new Error("applyToTab requires an extension context"));
    }
    var send = function () {
      return browser.tabs.sendMessage(tabId, { type: "apply", settings: settings });
    };
    return send().catch(function () {
      return browser.scripting
        .insertCSS({
          target: { tabId: tabId },
          files: ["content/content.css", "content/reddit.css"],
        })
        .then(function () {
          return browser.scripting.executeScript({
            target: { tabId: tabId },
            files: ["lib/shared.js", "content/content.js"],
          });
        })
        .then(send);
    });
  }

  // Update the toolbar badge for a tab. No-op in contexts without
  // browser.action (e.g. content scripts) so it's safe to expose globally.
  function updateBadge(tabId, enabled) {
    if (typeof browser === "undefined" || !browser.action || !browser.action.setBadgeText) {
      return Promise.resolve();
    }
    return Promise.all([
      browser.action.setBadgeText({ text: enabled ? "ON" : "", tabId: tabId }),
      browser.action.setBadgeBackgroundColor({ color: "#7c3aed", tabId: tabId }),
    ]).catch(function () {});
  }

  return {
    DEFAULTS: DEFAULTS,
    FONT_STACKS: FONT_STACKS,
    THEMES: THEMES,
    getDomain: getDomain,
    emptyState: emptyState,
    load: load,
    save: save,
    effective: effective,
    formatValue: formatValue,
    ensureReddit: ensureReddit,
    resolveUiMode: resolveUiMode,
    applyToTab: applyToTab,
    updateBadge: updateBadge,
    DEFAULT_PREFS: DEFAULT_PREFS,
  };
})();

// Expose for Node-based tests (e.g. Vitest); no-op in the browser since
// `module` is never defined there.
if (typeof module !== "undefined" && module.exports) {
  module.exports = GR;
}
