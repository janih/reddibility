/* GoodReddit content script.
   Applies the merged settings to the page by toggling the .gr-active class on
   <html> and writing CSS variables into a <style> element. */
(function () {
  "use strict";

  // Re-injection guard. GR.applyToTab (lib/shared.js) injects this script
  // into tabs whose page predates the extension; if it ever runs twice in
  // the same document, a second runtime.onMessage listener and a second set
  // of MutationObservers would stack up. `window` inside a content script's
  // isolated world is shared between injections of the same extension but
  // invisible to page code, so it's a safe sentinel location. Under Node
  // (tests) `module` is defined, so the guard never blocks the require()-
  // based test loading path.
  if (typeof window !== "undefined" && typeof module === "undefined" && window.__grLoaded) {
    return;
  }
  if (typeof window !== "undefined") {
    window.__grLoaded = true;
  }

  var STYLE_ID = "gr-vars-style";

  function buildCSS(settings) {
    var theme = GR.THEMES[settings.theme] || GR.THEMES.sepia;
    var font = GR.FONT_STACKS[settings.fontFamily] || GR.FONT_STACKS.sans;
    return (
      ":root.gr-active {" +
      "--gr-font: " + font + ";" +
      "--gr-font-size: " + settings.fontSize + "%;" +
      "--gr-line-height: " + settings.lineHeight + ";" +
      "--gr-letter-spacing: " + settings.letterSpacing + "em;" +
      "--gr-word-spacing: " + settings.wordSpacing + "em;" +
      "--gr-text-width: " + settings.textWidth + "ch;" +
      "--gr-bg: " + theme.bg + ";" +
      "--gr-text: " + theme.text + ";" +
      "--gr-link: " + theme.link + ";" +
      "--gr-color-scheme: " + (theme.scheme || "light") + ";" +
      "color-scheme: " + (theme.scheme || "light") + ";" +
      "}"
    );
  }

  var RD_CLASSES = [
    "gr-reddit", "gr-rd-ads", "gr-rd-noright", "gr-rd-noleft",
    "gr-rd-notrending", "gr-rd-widen", "gr-rd-compact", "gr-rd-comments",
    "gr-rd-clicktoload", "gr-rd-notopbar", "gr-rd-topbar-shown",
    "gr-rd-minjoin", "gr-rd-forcebtncolors", "gr-rd-noavatars",
  ];

  var TOPBAR_TOGGLER_ID = "gr-topbar-toggler";

  // Selector for a not-yet-revealed post/comment media element or its
  // container, shared by the CSS gate (reddit.css) and the placeholder
  // logic below. Scoped to user-added media (post body + comment
  // images/video), not avatars/icons or other UI chrome. figure.rte-media
  // is Reddit's rich-text embedded-media wrapper (confirmed in the
  // reddit/post_with_media/ capture) — it covers both plain <img> comment
  // images and shreddit-player-based comment gifs/videos in one shot, and
  // reliably excludes avatars/badge icons (which use a different markup),
  // unlike a bare "shreddit-comment img" selector which used to match them
  // too.
  var MEDIA_GATE_SELECTOR =
    'div[slot="post-media-container"],' +
    "figure.rte-media";

  var mediaObserver = null;

  // --- Vote/comment/share action-bar theming (pierces shadow DOM) ---
  // The devtools-copied markup for this action row contains literal <slot>
  // elements, which only ever exist inside a shadow root — proving the
  // vote-button group, comments link and share button are rendered inside
  // an open shadow root (not present at all in any static reddit/ capture,
  // which only serializes light DOM). Plain document-level CSS selectors
  // (see reddit.css) can never match shadow-encapsulated elements, so the
  // fix has to walk into every shadow root (recursively, since Reddit's
  // web components can nest them) and inject a small <style> directly
  // inside it. CSS custom properties (--gr-bg/--gr-color-scheme) still
  // inherit across the shadow boundary normally, so the injected rule can
  // keep referencing them.
  // shreddit-post-share-button renders its visible "Jaa"/"Share" button
  // (a plain <button class="... button-secondary ...">) inside its OWN
  // nested shadow root, separate from the host element — styling only the
  // host tag (as before) never reached that inner button. `.button-
  // secondary` is the same class shared by the vote/comment buttons, so a
  // generic selector recolors that inner button wherever this style gets
  // injected (harmless no-op on shadow roots that don't contain it).
  var SHADOW_BTN_STYLE_ID = "gr-shadow-btn-style";
  var SHADOW_BTN_CSS =
    ".rpl-vote-button-group," +
    ".rpl-vote-button-group button," +
    '[data-action-bar-action="comments"],' +
    'a[name="comments-action-button"],' +
    "shreddit-post-share-button," +
    ".button-secondary {" +
    "color-scheme: var(--gr-color-scheme, light) !important;" +
    "background-color: color-mix(in srgb, var(--gr-text) 12%, var(--gr-bg)) !important;" +
    "color: var(--gr-text) !important;" +
    "}";
  var forceButtonColorsEnabled = false;
  var shadowRootsSeen = new Set();
  var shadowScanStarted = false;

  function injectShadowButtonStyle(root) {
    if (!root || root.getElementById(SHADOW_BTN_STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = SHADOW_BTN_STYLE_ID;
    style.textContent = SHADOW_BTN_CSS;
    root.appendChild(style);
  }

  function removeShadowButtonStyle(root) {
    var style = root && root.getElementById && root.getElementById(SHADOW_BTN_STYLE_ID);
    if (style) style.remove();
  }

  // Recursively discover shadow roots under `root` (document or another
  // shadow root) and start tracking/watching each newly found one.
  function scanForShadowRoots(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll("*").forEach(function (el) {
      if (el.shadowRoot) visitShadowRoot(el.shadowRoot);
    });
  }

  // Register a shadow root once: style it (if enabled), scan it for nested
  // shadow roots, and watch it for future additions (Reddit lazily renders
  // more posts/comments as the user scrolls).
  function visitShadowRoot(sr) {
    if (shadowRootsSeen.has(sr)) return;
    shadowRootsSeen.add(sr);
    if (forceButtonColorsEnabled) injectShadowButtonStyle(sr);
    scanForShadowRoots(sr);
    var obs = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (node.nodeType !== 1) return;
          if (node.shadowRoot) visitShadowRoot(node.shadowRoot);
          scanForShadowRoots(node);
        });
      });
    });
    obs.observe(sr, { childList: true, subtree: true });
  }

  // Start (once) scanning the whole document for shadow roots, plus a
  // top-level observer to catch new shadow hosts as Reddit's SPA renders
  // more content.
  function startShadowRootScan() {
    scanForShadowRoots(document);
    if (shadowScanStarted) return;
    shadowScanStarted = true;
    var obs = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (node.nodeType !== 1) return;
          if (node.shadowRoot) visitShadowRoot(node.shadowRoot);
          scanForShadowRoots(node);
        });
      });
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }

  function setForceButtonColors(enabled) {
    forceButtonColorsEnabled = !!enabled;
    if (forceButtonColorsEnabled) startShadowRootScan();
    shadowRootsSeen.forEach(function (sr) {
      if (forceButtonColorsEnabled) injectShadowButtonStyle(sr);
      else removeShadowButtonStyle(sr);
    });
  }

  function isReddit() {
    return /(^|\.)reddit\.com$/.test(location.hostname || "");
  }

  // Replace a gated media element with a compact "Click to show" link
  // instead of rendering it (blurred) at its original width/height — the
  // element itself is hidden by the CSS gate, this just adds the visible
  // stand-in. Idempotent: skips elements that already got a placeholder.
  function ensureMediaPlaceholder(el) {
    if (!el || el.classList.contains("gr-media-revealed")) return;
    if (el.dataset && el.dataset.grMediaGated === "1") return;
    if (el.dataset) el.dataset.grMediaGated = "1";
    var placeholder = document.createElement("a");
    placeholder.href = "javascript:void(0)";
    placeholder.className = "gr-media-placeholder";
    placeholder.textContent = "Click to show";
    placeholder.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      el.classList.add("gr-media-revealed");
      placeholder.remove();
    });
    el.parentNode && el.parentNode.insertBefore(placeholder, el);
  }

  function scanForGatedMedia(root) {
    if (!document.documentElement.classList.contains("gr-rd-clicktoload")) return;
    (root || document).querySelectorAll(MEDIA_GATE_SELECTOR).forEach(ensureMediaPlaceholder);
  }

  // Reddit loads posts/comments asynchronously (infinite scroll, comment
  // pagination), so newly inserted media needs its placeholder added too.
  function startMediaObserver() {
    if (mediaObserver) return;
    mediaObserver = new MutationObserver(function (mutations) {
      if (!document.documentElement.classList.contains("gr-rd-clicktoload")) return;
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (node.nodeType !== 1) return;
          if (node.matches && node.matches(MEDIA_GATE_SELECTOR)) ensureMediaPlaceholder(node);
          if (node.querySelectorAll) scanForGatedMedia(node);
        });
      });
    });
    mediaObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function teardownMediaPlaceholders() {
    document.querySelectorAll(".gr-media-placeholder").forEach(function (p) { p.remove(); });
    document.querySelectorAll('[data-gr-media-gated="1"]').forEach(function (el) {
      delete el.dataset.grMediaGated;
    });
  }

  // A tiny, mostly-invisible tab pinned to the top edge of the viewport that
  // lets the user flip the (otherwise hidden) top bar back on/off without
  // taking up any real estate itself. Created once and left in the DOM for
  // the lifetime of the page; only shown/relevant while gr-rd-notopbar is on.
  function ensureTopBarToggler() {
    if (document.getElementById(TOPBAR_TOGGLER_ID)) return;
    var tab = document.createElement("button");
    tab.id = TOPBAR_TOGGLER_ID;
    tab.type = "button";
    tab.className = "gr-topbar-toggler";
    tab.title = "Show/hide top bar";
    tab.addEventListener("click", function () {
      document.documentElement.classList.toggle("gr-rd-topbar-shown");
    });
    (document.body || document.documentElement).appendChild(tab);
  }

  function teardownTopBarToggler() {
    var tab = document.getElementById(TOPBAR_TOGGLER_ID);
    if (tab) tab.remove();
    document.documentElement.classList.remove("gr-rd-topbar-shown");
  }

  function applyReddit(html, settings) {
    var rd = (settings && settings.reddit) || {};
    var on = settings && settings.enabled && isReddit() && rd.enabled !== false;
    if (!on) {
      RD_CLASSES.forEach(function (c) { html.classList.remove(c); });
      teardownMediaPlaceholders();
      teardownTopBarToggler();
      setForceButtonColors(false);
      return;
    }
    html.classList.add("gr-reddit");
    html.classList.toggle("gr-rd-ads", !!rd.hideAds);
    html.classList.toggle("gr-rd-noright", !!rd.hideRightSidebar);
    html.classList.toggle("gr-rd-noleft", !!rd.hideLeftClutter);
    html.classList.toggle("gr-rd-notrending", !!rd.hideTrending);
    html.classList.toggle("gr-rd-widen", !!rd.widen);
    html.classList.toggle("gr-rd-compact", !!rd.compactFeed);
    html.classList.toggle("gr-rd-comments", !!rd.cleanComments);
    html.classList.toggle("gr-rd-clicktoload", !!rd.clickToLoadMedia);
    if (rd.clickToLoadMedia) {
      startMediaObserver();
      scanForGatedMedia(document);
    } else {
      teardownMediaPlaceholders();
    }
    html.classList.toggle("gr-rd-notopbar", !!rd.hideTopBar);
    if (rd.hideTopBar) {
      ensureTopBarToggler();
    } else {
      teardownTopBarToggler();
    }
    html.classList.toggle("gr-rd-minjoin", !!rd.minimizeJoinButtons);
    html.classList.toggle("gr-rd-forcebtncolors", rd.forceButtonColors !== false);
    setForceButtonColors(rd.forceButtonColors !== false);
    html.classList.toggle("gr-rd-noavatars", !!rd.hideAvatars);
  }

  function apply(settings) {
    var html = document.documentElement;
    if (settings && settings.enabled) {
      var style = document.getElementById(STYLE_ID);
      if (!style) {
        style = document.createElement("style");
        style.id = STYLE_ID;
        (document.head || document.documentElement).appendChild(style);
      }
      style.textContent = buildCSS(settings);
      html.classList.add("gr-active");
      html.classList.toggle("gr-hide-distractions", !!settings.hideDistractions);
    } else {
      html.classList.remove("gr-active", "gr-hide-distractions");
    }
    applyReddit(html, settings);
  }

  function init() {
    GR.load().then(function (state) {
      var domain = GR.getDomain(location.href);
      apply(GR.effective(state, domain));
    });
  }

  // Guarded so this file can be `require()`d under Node (e.g. by tests)
  // without touching the real `browser` extension API or auto-running
  // against a bare jsdom document; in the actual extension `browser` is
  // always defined, so this is a no-op behavior change there.
  if (typeof browser !== "undefined" && browser.runtime && browser.runtime.onMessage) {
    browser.runtime.onMessage.addListener(function (msg) {
      if (msg && msg.type === "apply") {
        apply(msg.settings);
      }
    });

    init();
  }

  // Expose internals for Node-based tests (e.g. Vitest); no-op in the
  // browser since `module` is never defined there.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      buildCSS: buildCSS,
      applyReddit: applyReddit,
      apply: apply,
      init: init,
      isReddit: isReddit,
      RD_CLASSES: RD_CLASSES,
      MEDIA_GATE_SELECTOR: MEDIA_GATE_SELECTOR,
      SHADOW_BTN_CSS: SHADOW_BTN_CSS,
      ensureMediaPlaceholder: ensureMediaPlaceholder,
      scanForGatedMedia: scanForGatedMedia,
      startMediaObserver: startMediaObserver,
      teardownMediaPlaceholders: teardownMediaPlaceholders,
      ensureTopBarToggler: ensureTopBarToggler,
      teardownTopBarToggler: teardownTopBarToggler,
      visitShadowRoot: visitShadowRoot,
      scanForShadowRoots: scanForShadowRoots,
      startShadowRootScan: startShadowRootScan,
      setForceButtonColors: setForceButtonColors,
      injectShadowButtonStyle: injectShadowButtonStyle,
      removeShadowButtonStyle: removeShadowButtonStyle,
    };
  }
})();
