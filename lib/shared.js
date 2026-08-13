/*
 * Shared constants & helpers for GoodReddit.
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

  function emptyState() {
    return {
      global: Object.assign({}, DEFAULTS),
      perDomain: {},
      prefs: Object.assign({}, DEFAULT_PREFS),
    };
  }

  function load() {
    return browser.storage.local.get("goodreadability").then(function (res) {
      var base = emptyState();
      if (!res.goodreadability) return base;
      return {
        global: Object.assign({}, DEFAULTS, res.goodreadability.global || {}),
        perDomain: res.goodreadability.perDomain || {},
        prefs: Object.assign({}, DEFAULT_PREFS, res.goodreadability.prefs || {}),
      };
    });
  }

  function save(state) {
    return browser.storage.local.set({ goodreadability: state });
  }

  // Merge global settings with a per-domain override (if present).
  function effective(state, domain) {
    var ov = (domain && state.perDomain[domain]) || {};
    return Object.assign({}, state.global, ov);
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
    DEFAULT_PREFS: DEFAULT_PREFS,
  };
})();
