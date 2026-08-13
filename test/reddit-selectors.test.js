import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// This test file stays ESM (required by Vitest), but uses Node's own
// `require()` for plain CommonJS packages/paths.
const require = createRequire(import.meta.url);
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Regression tests: load the real, saved (logged-out) Reddit page captures
// under reddit/ (see AGENTS.md, "Working with the reddit/ reference
// captures") and assert that the selectors content/reddit.css relies on
// still match real elements. This guards against the failure mode that has
// bitten this project repeatedly: a Reddit redesign silently makes a
// selector stop matching anything, with no error, just a feature that
// quietly stops working.
//
// `resources: "usable"` is intentionally NOT set (defaults to none) so
// JSDOM never tries to fetch the captures' external CSS/JS/images — we
// only care about the static DOM structure here.

const REDDIT_DIR = path.join(__dirname, "..", "reddit");

// Reddit's inlined Tailwind <style> blocks use arbitrary-value class names
// (e.g. w-[1120px]) that jsdom's CSS parser can choke on; that only affects
// jsdom's (unused, since we don't check computed styles) CSSOM and would
// otherwise just spam stderr with "Could not parse CSS stylesheet" — silence
// it via a virtual console that drops jsdomError events only.
const { VirtualConsole } = require("jsdom");
const virtualConsole = new VirtualConsole();
virtualConsole.on("error", () => {});
virtualConsole.on("warn", () => {});

// Returns the full JSDOM instance (not just `.window.document`) so callers
// can explicitly `.window.close()` it once a describe block is done. Without
// this, letting each JSDOM instance become garbage-collectable mid-suite can
// trigger its internal cleanup (which touches localStorage) asynchronously
// during a *later*, unrelated test — surfacing as a stray "localStorage is
// not available for opaque origins" SecurityError in that later test.
function loadCapture(...segments) {
  const filePath = path.join(REDDIT_DIR, ...segments);
  const html = fs.readFileSync(filePath, "utf-8");
  return new JSDOM(html, { virtualConsole, url: "https://www.reddit.com/" });
}

describe("reddit/frontpage/ capture selectors", () => {
  let dom;
  let doc;

  beforeAll(() => {
    dom = loadCapture("frontpage", "Reddit - Netin sydän.html");
    doc = dom.window.document;
  });

  it("contains at least one shreddit-post", () => {
    expect(doc.querySelectorAll("shreddit-post").length).toBeGreaterThan(0);
  });

  it("contains the 'Popular communities' right-rail box via its stable class", () => {
    expect(doc.querySelectorAll(".right-rail-popular-communities").length).toBeGreaterThan(0);
  });

  it("contains at least one per-post credit-bar join button", () => {
    expect(
      doc.querySelectorAll('shreddit-join-button[data-testid="credit-bar-join-button"]').length
    ).toBeGreaterThan(0);
  });

  it("contains the sticky top bar custom element", () => {
    expect(doc.querySelectorAll("reddit-header-large").length).toBeGreaterThan(0);
  });

  it("contains the right/left sidebar containers", () => {
    expect(doc.querySelectorAll("#right-sidebar-container").length).toBeGreaterThan(0);
    expect(doc.querySelectorAll("#left-sidebar-container").length).toBeGreaterThan(0);
  });
});

describe("reddit/subreddit/ capture selectors", () => {
  let dom;
  let doc;

  beforeAll(() => {
    dom = loadCapture("subreddit", "Today I Learned (TIL).html");
    doc = dom.window.document;
  });

  it("contains at least one shreddit-post", () => {
    expect(doc.querySelectorAll("shreddit-post").length).toBeGreaterThan(0);
  });

  it("contains the subreddit-specific right-rail partial", () => {
    expect(doc.querySelectorAll("#subreddit-right-rail__partial").length).toBeGreaterThan(0);
  });

  it("contains the sticky top bar custom element", () => {
    expect(doc.querySelectorAll("reddit-header-large").length).toBeGreaterThan(0);
  });

  it("does NOT contain a per-post join button (single-subreddit page)", () => {
    // Documented in AGENTS.md: this selector is frontpage-only, since a
    // single-subreddit page surfaces join/leave status elsewhere.
    expect(
      doc.querySelectorAll('shreddit-join-button[data-testid="credit-bar-join-button"]').length
    ).toBe(0);
  });
});

describe("reddit/post/ capture selectors", () => {
  let dom;
  let doc;

  beforeAll(() => {
    dom = loadCapture(
      "post",
      "poolside_Laguna-S-2.1 released! Finally an interesting 120B contender! _ r_LocalLLaMA.html"
    );
    doc = dom.window.document;
  });

  it("contains the post-page structural elements widen-content relies on", () => {
    expect(doc.querySelectorAll("#subgrid-container").length).toBeGreaterThan(0);
    expect(doc.querySelectorAll(".main-container").length).toBeGreaterThan(0);
    expect(doc.querySelectorAll(".grid-container").length).toBeGreaterThan(0);
  });

  it("contains pdp-back-button immediately followed by the credit-bar avatar", () => {
    const backButtons = doc.querySelectorAll("pdp-back-button");
    expect(backButtons.length).toBeGreaterThan(0);
    const sibling = backButtons[0].nextElementSibling;
    expect(sibling).not.toBeNull();
    expect(sibling.classList.contains("avatar")).toBe(true);
  });

  it("contains at least one shreddit-comment", () => {
    expect(doc.querySelectorAll("shreddit-comment").length).toBeGreaterThan(0);
  });
});

describe("reddit/post_with_media/ capture selectors", () => {
  let dom;
  let doc;

  beforeAll(() => {
    dom = loadCapture("post_with_media", "what\u2019s in this bag _ r_whatisit.html");
    doc = dom.window.document;
  });

  it("contains figure.rte-media wrappers for comment-embedded media", () => {
    expect(doc.querySelectorAll("figure.rte-media").length).toBeGreaterThan(0);
  });

  it("figure.rte-media never wraps an avatar-icon span", () => {
    // Regression guard for the bug fixed in this project's history: a bare
    // "shreddit-comment img" selector used to also match avatars/badges.
    // Real comment avatar icons are wrapped in a `<span rpl avatar="">`
    // (note: <shreddit-comment> itself also carries an `avatar="<url>"`
    // attribute holding the profile picture URL, so a plain `[avatar]`
    // selector is too broad and matches every comment as an ancestor;
    // `span[avatar]` is the actual avatar-icon wrapper we care about).
    doc.querySelectorAll("figure.rte-media").forEach((figure) => {
      expect(figure.closest("span[avatar]")).toBeNull();
      expect(figure.querySelector("span[avatar]")).toBeNull();
    });
  });

  it("avatar-icon spans exist but are never inside figure.rte-media", () => {
    const avatars = doc.querySelectorAll("shreddit-comment span[avatar]");
    expect(avatars.length).toBeGreaterThan(0);
    avatars.forEach((avatar) => {
      expect(avatar.closest("figure.rte-media")).toBeNull();
    });
  });

  it("contains the post's primary media container", () => {
    expect(doc.querySelectorAll('div[slot="post-media-container"]').length).toBeGreaterThan(0);
  });
});
