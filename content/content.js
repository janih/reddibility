/* GoodReddit content script.
   Applies the merged settings to the page by toggling the .gr-active class on
   <html> and writing CSS variables into a <style> element. */
(function () {
  "use strict";

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
      "}"
    );
  }

  var RD_CLASSES = [
    "gr-reddit", "gr-rd-ads", "gr-rd-noright", "gr-rd-noleft",
    "gr-rd-notrending", "gr-rd-widen", "gr-rd-compact", "gr-rd-comments",
    "gr-rd-clicktoload", "gr-rd-notopbar", "gr-rd-topbar-shown",
    "gr-rd-minjoin",
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

  browser.runtime.onMessage.addListener(function (msg) {
    if (msg && msg.type === "apply") {
      apply(msg.settings);
    }
  });

  init();
})();
