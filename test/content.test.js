import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// content/content.js and lib/shared.js are plain CommonJS-ish scripts (no
// `import`/`export`), loaded via Node's `require()` — this test file itself
// stays ESM to satisfy Vitest, which forbids `require("vitest")`.
const require = createRequire(import.meta.url);
const path = require("path");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// content/content.js references the global `GR` object (normally provided
// by lib/shared.js, loaded first as a separate <script> in the real
// extension — see manifest.json's content_scripts.js order) and the
// `browser` WebExtension API. We stub both before requiring the module, and
// avoid defining `browser` here so the guarded auto-init at the bottom of
// content.js stays inert (see the module.exports guard added there).
const GR = require(path.join(__dirname, "..", "lib", "shared.js"));

const CONTENT_JS_PATH = path.join(__dirname, "..", "content", "content.js");

function loadContentModule() {
  global.GR = GR;
  // Fresh module instance per test so each test starts with clean
  // module-level state (shadowRootsSeen, forceButtonColorsEnabled, etc.).
  // `require()` here is Node's own (via createRequire), which caches by
  // resolved path independently of Vitest's module graph, so `vi.
  // resetModules()` alone wouldn't clear it — evict it manually instead.
  delete require.cache[CONTENT_JS_PATH];
  return require(CONTENT_JS_PATH);
}

describe("content.js buildCSS", () => {
  it("writes the theme's colors and typography settings into :root.gr-active", () => {
    const content = loadContentModule();
    const css = content.buildCSS({
      theme: "dark",
      fontFamily: "serif",
      fontSize: 120,
      lineHeight: 1.8,
      letterSpacing: 0.02,
      wordSpacing: 0.05,
      textWidth: 60,
    });
    expect(css).toContain("--gr-font-size: 120%;");
    expect(css).toContain("--gr-line-height: 1.8;");
    expect(css).toContain("--gr-letter-spacing: 0.02em;");
    expect(css).toContain("--gr-word-spacing: 0.05em;");
    expect(css).toContain("--gr-text-width: 60ch;");
    expect(css).toContain("--gr-bg: " + GR.THEMES.dark.bg + ";");
    expect(css).toContain("--gr-color-scheme: dark;");
    expect(css).toContain("color-scheme: dark;");
  });

  it("falls back to the sepia theme and sans font stack for unknown values", () => {
    const content = loadContentModule();
    const css = content.buildCSS({
      theme: "not-a-real-theme",
      fontFamily: "not-a-real-font",
      fontSize: 100,
      lineHeight: 1.5,
      letterSpacing: 0,
      wordSpacing: 0,
      textWidth: 70,
    });
    expect(css).toContain("--gr-bg: " + GR.THEMES.sepia.bg + ";");
    expect(css).toContain("--gr-font: " + GR.FONT_STACKS.sans + ";");
  });

  it("falls back to default numbers for corrupted numeric settings", () => {
    const content = loadContentModule();
    const css = content.buildCSS({
      theme: "dark",
      fontFamily: "sans",
      fontSize: "garbage",
      lineHeight: null,
      letterSpacing: undefined,
      wordSpacing: {},
      textWidth: NaN,
    });
    expect(css).toContain("--gr-font-size: " + GR.DEFAULTS.fontSize + "%;");
    expect(css).toContain("--gr-line-height: " + GR.DEFAULTS.lineHeight + ";");
    expect(css).toContain("--gr-letter-spacing: " + GR.DEFAULTS.letterSpacing + "em;");
    expect(css).toContain("--gr-word-spacing: " + GR.DEFAULTS.wordSpacing + "em;");
    expect(css).toContain("--gr-text-width: " + GR.DEFAULTS.textWidth + "ch;");
  });
});

describe("content.js isReddit", () => {
  it("returns true on reddit.com", () => {
    const content = loadContentModule();
    global.location = { hostname: "www.reddit.com", href: "https://www.reddit.com/" };
    expect(content.isReddit()).toBe(true);
  });

  it("returns false on a non-Reddit domain", () => {
    const content = loadContentModule();
    global.location = { hostname: "example.com", href: "https://example.com/" };
    expect(content.isReddit()).toBe(false);
  });
});

describe("content.js applyReddit", () => {
  let content;
  let html;

  beforeEach(() => {
    document.documentElement.className = "";
    global.location = { hostname: "www.reddit.com", href: "https://www.reddit.com/" };
    content = loadContentModule();
    html = document.documentElement;
  });

  it("adds no gr-rd-* classes when Reddit features are disabled entirely", () => {
    content.applyReddit(html, {
      enabled: true,
      reddit: Object.assign({}, GR.DEFAULTS.reddit, { enabled: false }),
    });
    content.RD_CLASSES.forEach((c) => expect(html.classList.contains(c)).toBe(false));
  });

  it("adds no gr-rd-* classes when GoodReddit itself is disabled", () => {
    content.applyReddit(html, { enabled: false, reddit: GR.DEFAULTS.reddit });
    content.RD_CLASSES.forEach((c) => expect(html.classList.contains(c)).toBe(false));
  });

  it("adds no gr-rd-* classes on a non-Reddit domain", () => {
    global.location = { hostname: "example.com", href: "https://example.com/" };
    content.applyReddit(html, { enabled: true, reddit: GR.DEFAULTS.reddit });
    content.RD_CLASSES.forEach((c) => expect(html.classList.contains(c)).toBe(false));
  });

  it("toggles each gr-rd-* class based on the matching reddit.* setting", () => {
    content.applyReddit(html, {
      enabled: true,
      reddit: {
        enabled: true,
        hideAds: true,
        hideRightSidebar: false,
        hideLeftClutter: true,
        hideTrending: false,
        widen: true,
        compactFeed: false,
        cleanComments: true,
        clickToLoadMedia: false,
        hideTopBar: false,
        minimizeJoinButtons: true,
        forceButtonColors: false,
        hideAvatars: true,
      },
    });
    expect(html.classList.contains("gr-reddit")).toBe(true);
    expect(html.classList.contains("gr-rd-ads")).toBe(true);
    expect(html.classList.contains("gr-rd-noright")).toBe(false);
    expect(html.classList.contains("gr-rd-noleft")).toBe(true);
    expect(html.classList.contains("gr-rd-notrending")).toBe(false);
    expect(html.classList.contains("gr-rd-widen")).toBe(true);
    expect(html.classList.contains("gr-rd-compact")).toBe(false);
    expect(html.classList.contains("gr-rd-comments")).toBe(true);
    expect(html.classList.contains("gr-rd-clicktoload")).toBe(false);
    expect(html.classList.contains("gr-rd-notopbar")).toBe(false);
    expect(html.classList.contains("gr-rd-minjoin")).toBe(true);
    expect(html.classList.contains("gr-rd-forcebtncolors")).toBe(false);
    expect(html.classList.contains("gr-rd-noavatars")).toBe(true);
  });

  it("defaults forceButtonColors to on when the field is missing (undefined)", () => {
    const rd = Object.assign({}, GR.DEFAULTS.reddit);
    delete rd.forceButtonColors;
    content.applyReddit(html, { enabled: true, reddit: rd });
    expect(html.classList.contains("gr-rd-forcebtncolors")).toBe(true);
  });

  it("removes previously-set gr-rd-* classes when Reddit features get disabled", () => {
    content.applyReddit(html, { enabled: true, reddit: GR.DEFAULTS.reddit });
    expect(html.classList.contains("gr-reddit")).toBe(true);
    content.applyReddit(html, {
      enabled: true,
      reddit: Object.assign({}, GR.DEFAULTS.reddit, { enabled: false }),
    });
    content.RD_CLASSES.forEach((c) => expect(html.classList.contains(c)).toBe(false));
  });
});

describe("content.js click-to-load media placeholders", () => {
  let content;

  beforeEach(() => {
    document.documentElement.className = "gr-rd-clicktoload";
    document.body.innerHTML = "";
    global.location = { hostname: "www.reddit.com", href: "https://www.reddit.com/" };
    content = loadContentModule();
  });

  it("inserts a 'Click to show' placeholder link before a gated media element", () => {
    const media = document.createElement("div");
    media.setAttribute("slot", "post-media-container");
    document.body.appendChild(media);

    content.ensureMediaPlaceholder(media);

    const placeholder = document.body.querySelector(".gr-media-placeholder");
    expect(placeholder).not.toBeNull();
    // A <button>, not an <a href="javascript:void(0)"> — same behavior,
    // without the javascript: URL smell.
    expect(placeholder.tagName).toBe("BUTTON");
    expect(placeholder.textContent).toBe("Click to show");
    expect(placeholder.nextSibling).toBe(media);
  });

  it("is idempotent: calling it twice on the same element only adds one placeholder", () => {
    const media = document.createElement("div");
    media.setAttribute("slot", "post-media-container");
    document.body.appendChild(media);

    content.ensureMediaPlaceholder(media);
    content.ensureMediaPlaceholder(media);

    expect(document.body.querySelectorAll(".gr-media-placeholder").length).toBe(1);
  });

  it("skips elements already marked as revealed", () => {
    const media = document.createElement("div");
    media.setAttribute("slot", "post-media-container");
    media.classList.add("gr-media-revealed");
    document.body.appendChild(media);

    content.ensureMediaPlaceholder(media);

    expect(document.body.querySelector(".gr-media-placeholder")).toBeNull();
  });

  it("clicking the placeholder reveals the media and removes the placeholder", () => {
    const media = document.createElement("div");
    media.setAttribute("slot", "post-media-container");
    document.body.appendChild(media);

    content.ensureMediaPlaceholder(media);
    const placeholder = document.body.querySelector(".gr-media-placeholder");
    placeholder.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));

    expect(media.classList.contains("gr-media-revealed")).toBe(true);
    expect(document.body.querySelector(".gr-media-placeholder")).toBeNull();
  });

  it("scanForGatedMedia matches figure.rte-media (comment media) but not plain avatar/badge images", () => {
    const comment = document.createElement("shreddit-comment");
    const figure = document.createElement("figure");
    figure.className = "rte-media";
    const img = document.createElement("img");
    figure.appendChild(img);
    comment.appendChild(figure);

    // Mirrors the real markup (confirmed in the reddit/post_with_media/
    // capture): the comment avatar wrapper is a <span avatar> containing a
    // plain <img>, not wrapped in figure.rte-media.
    const avatarWrapper = document.createElement("span");
    avatarWrapper.setAttribute("avatar", "");
    const avatarImg = document.createElement("img");
    avatarWrapper.appendChild(avatarImg);
    comment.appendChild(avatarWrapper);

    document.body.appendChild(comment);

    content.scanForGatedMedia(document);

    // The figure (comment media) got a placeholder immediately before it, ...
    expect(figure.previousElementSibling.classList.contains("gr-media-placeholder")).toBe(true);
    // ... but the avatar wrapper (not wrapped in figure.rte-media) did not
    // get a placeholder inserted right before it.
    expect(avatarWrapper.previousElementSibling).toBe(figure);
  });

  it("scanForGatedMedia does nothing when gr-rd-clicktoload is not active", () => {
    document.documentElement.classList.remove("gr-rd-clicktoload");
    const media = document.createElement("div");
    media.setAttribute("slot", "post-media-container");
    document.body.appendChild(media);

    content.scanForGatedMedia(document);

    expect(document.body.querySelector(".gr-media-placeholder")).toBeNull();
  });

  it("teardownMediaPlaceholders removes all injected placeholders", () => {
    const media = document.createElement("div");
    media.setAttribute("slot", "post-media-container");
    document.body.appendChild(media);
    content.ensureMediaPlaceholder(media);
    expect(document.body.querySelector(".gr-media-placeholder")).not.toBeNull();

    content.teardownMediaPlaceholders();

    expect(document.body.querySelector(".gr-media-placeholder")).toBeNull();
  });
});

describe("content.js shadow-DOM button theming", () => {
  let content;

  beforeEach(() => {
    document.documentElement.className = "";
    document.body.innerHTML = "";
    global.location = { hostname: "www.reddit.com", href: "https://www.reddit.com/" };
    content = loadContentModule();
  });

  afterEach(() => {
    content.setForceButtonColors(false);
  });

  it("injects the shadow button style into a shadow root when enabled", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const btn = document.createElement("span");
    btn.className = "rpl-vote-button-group";
    shadow.appendChild(btn);

    content.visitShadowRoot(shadow);
    content.setForceButtonColors(true);

    const style = shadow.getElementById("gr-shadow-btn-style");
    expect(style).not.toBeNull();
    expect(style.textContent).toContain(".rpl-vote-button-group");
    expect(style.textContent).toContain(".button-secondary");
  });

  it("removes the injected style when the setting is turned off", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    content.visitShadowRoot(shadow);
    content.setForceButtonColors(true);
    expect(shadow.getElementById("gr-shadow-btn-style")).not.toBeNull();

    content.setForceButtonColors(false);

    expect(shadow.getElementById("gr-shadow-btn-style")).toBeNull();
  });

  it("restarts the scan from scratch when re-enabled after being disabled", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    content.setForceButtonColors(true);
    expect(shadow.getElementById("gr-shadow-btn-style")).not.toBeNull();

    content.setForceButtonColors(false);
    expect(shadow.getElementById("gr-shadow-btn-style")).toBeNull();

    // Disabling tears the scan down entirely; re-enabling must rescan the
    // document and re-style still-connected shadow roots.
    content.setForceButtonColors(true);
    expect(shadow.getElementById("gr-shadow-btn-style")).not.toBeNull();
  });

  it("prunes detached shadow roots so memory doesn't grow during infinite scroll", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    content.setForceButtonColors(true);
    content.visitShadowRoot(shadow);
    expect(content.shadowRootsSeen.has(shadow)).toBe(true);

    // Reddit virtualizes its feeds: scrolled-past posts (and their shadow
    // roots) get detached. Pruning must forget them so they can be GC'd.
    host.remove();
    content.pruneShadowRoots();
    expect(content.shadowRootsSeen.has(shadow)).toBe(false);

    // A still-connected root survives pruning.
    const liveHost = document.createElement("div");
    document.body.appendChild(liveHost);
    const liveShadow = liveHost.attachShadow({ mode: "open" });
    content.visitShadowRoot(liveShadow);
    content.pruneShadowRoots();
    expect(content.shadowRootsSeen.has(liveShadow)).toBe(true);
  });

  it("recursively discovers nested shadow roots (e.g. the share button's own shadow root)", () => {
    const outerHost = document.createElement("div");
    document.body.appendChild(outerHost);
    const outerShadow = outerHost.attachShadow({ mode: "open" });

    const innerHost = document.createElement("shreddit-post-share-button");
    outerShadow.appendChild(innerHost);
    const innerShadow = innerHost.attachShadow({ mode: "open" });
    const innerButton = document.createElement("button");
    innerButton.className = "button-secondary";
    innerShadow.appendChild(innerButton);

    content.setForceButtonColors(true);
    content.visitShadowRoot(outerShadow);

    expect(outerShadow.getElementById("gr-shadow-btn-style")).not.toBeNull();
    expect(innerShadow.getElementById("gr-shadow-btn-style")).not.toBeNull();
  });
});
