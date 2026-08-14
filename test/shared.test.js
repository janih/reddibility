import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// lib/shared.js is a plain CommonJS-ish script (no `import`/`export`), so
// it's loaded via `require()` rather than `import` — this test file itself
// stays ESM to satisfy Vitest, which forbids `require("vitest")`.
const require = createRequire(import.meta.url);
const path = require("path");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// It exposes the global `GR` object (see the module.exports guard added at
// the bottom of the file, which is a no-op in the real browser context).
const GR = require(path.join(__dirname, "..", "lib", "shared.js"));

describe("GR.getDomain", () => {
  it("strips the www. prefix", () => {
    expect(GR.getDomain("https://www.reddit.com/r/foo")).toBe("reddit.com");
  });

  it("returns the bare hostname when there is no www. prefix", () => {
    expect(GR.getDomain("https://old.reddit.com/r/foo")).toBe("old.reddit.com");
  });

  it("returns an empty string for an invalid URL", () => {
    expect(GR.getDomain("not a url")).toBe("");
  });

  it("returns an empty string for a URL without a hostname", () => {
    expect(GR.getDomain("javascript:void(0)")).toBe("");
  });
});

describe("GR.emptyState", () => {
  it("returns global defaults, an empty perDomain map, and default prefs", () => {
    const state = GR.emptyState();
    expect(state.global).toEqual(GR.DEFAULTS);
    expect(state.perDomain).toEqual({});
    expect(state.prefs).toEqual(GR.DEFAULT_PREFS);
  });

  it("returns independent copies that don't mutate top-level GR.DEFAULTS fields", () => {
    const state = GR.emptyState();
    state.global.fontSize = 999;
    expect(GR.DEFAULTS.fontSize).not.toBe(999);
  });

  it("deep-copies the nested reddit sub-object (regression: edits used to leak into DEFAULTS)", () => {
    // Object.assign({}, DEFAULTS) only shallow-copies, so state.global.reddit
    // used to BE GR.DEFAULTS.reddit — mutating a setting (e.g. via the
    // options page) rewrote the shared defaults table, and even "Reset
    // everything" returned the mutated values.
    const state = GR.emptyState();
    expect(state.global.reddit).toEqual(GR.DEFAULTS.reddit);
    expect(state.global.reddit).not.toBe(GR.DEFAULTS.reddit);
    const original = GR.DEFAULTS.reddit.widen;
    state.global.reddit.widen = !original;
    expect(GR.DEFAULTS.reddit.widen).toBe(original);
  });
});

describe("GR.effective", () => {
  it("returns the global settings when there is no per-domain override", () => {
    const state = GR.emptyState();
    const result = GR.effective(state, "example.com");
    expect(result).toEqual(state.global);
  });

  it("merges a per-domain override on top of the global settings", () => {
    const state = GR.emptyState();
    state.perDomain["reddit.com"] = { fontSize: 150, theme: "dark" };
    const result = GR.effective(state, "reddit.com");
    expect(result.fontSize).toBe(150);
    expect(result.theme).toBe("dark");
    // Untouched fields still come from global defaults.
    expect(result.lineHeight).toBe(state.global.lineHeight);
  });

  it("falls back to global settings when domain is falsy", () => {
    const state = GR.emptyState();
    state.perDomain["reddit.com"] = { fontSize: 150 };
    const result = GR.effective(state, "");
    expect(result).toEqual(state.global);
  });

  it("never aliases the nested reddit object between global and override (regression)", () => {
    // A per-site override used to share the global reddit object, so edits
    // made with "This site only" active wrote through into global settings.
    const state = GR.emptyState();
    state.perDomain["reddit.com"] = { fontSize: 150, reddit: { widen: false } };
    const result = GR.effective(state, "reddit.com");
    expect(result.reddit).not.toBe(state.global.reddit);
    expect(result.reddit).not.toBe(state.perDomain["reddit.com"].reddit);
    expect(result.reddit.widen).toBe(false);
    expect(result.reddit.hideAds).toBe(GR.DEFAULTS.reddit.hideAds);
  });

  it("backfills reddit.* defaults missing from a stale override (settings upgrade)", () => {
    // e.g. minimizeJoinButtons was added later; overrides saved by an older
    // version must pick up its default instead of reading as undefined.
    const state = GR.emptyState();
    state.perDomain["reddit.com"] = { reddit: { hideAds: false } };
    const result = GR.effective(state, "reddit.com");
    expect(result.reddit.hideAds).toBe(false);
    expect(result.reddit.minimizeJoinButtons).toBe(GR.DEFAULTS.reddit.minimizeJoinButtons);
    expect(result.reddit.hideAvatars).toBe(GR.DEFAULTS.reddit.hideAvatars);
  });
});

describe("GR.formatValue", () => {
  it("formats fontSize as a percentage", () => {
    expect(GR.formatValue("fontSize", "108")).toBe("108%");
  });

  it("formats lineHeight with two decimal places", () => {
    expect(GR.formatValue("lineHeight", "1.5")).toBe("1.50");
  });

  it("formats letterSpacing with three decimal places and an em suffix", () => {
    expect(GR.formatValue("letterSpacing", "0.01")).toBe("0.010em");
  });

  it("formats wordSpacing with two decimal places and an em suffix", () => {
    expect(GR.formatValue("wordSpacing", "0.04")).toBe("0.04em");
  });

  it("formats textWidth as ch units", () => {
    expect(GR.formatValue("textWidth", "78")).toBe("78ch");
  });

  it("falls back to a plain string for unknown ids", () => {
    expect(GR.formatValue("unknown", "42")).toBe("42");
  });
});

describe("GR.ensureReddit", () => {
  it("adds a reddit sub-object (a copy of the defaults) if missing", () => {
    const obj = {};
    const rd = GR.ensureReddit(obj);
    expect(rd).toEqual(GR.DEFAULTS.reddit);
    expect(obj.reddit).toBe(rd);
  });

  it("returns the existing reddit sub-object unchanged if already present", () => {
    const existing = { widen: false };
    const obj = { reddit: existing };
    const rd = GR.ensureReddit(obj);
    expect(rd).toBe(existing);
  });
});

describe("GR.resolveUiMode", () => {
  it("returns 'light' as-is", () => {
    expect(GR.resolveUiMode("light")).toBe("light");
  });

  it("returns 'dark' as-is", () => {
    expect(GR.resolveUiMode("dark")).toBe("dark");
  });

  it("resolves 'auto' via matchMedia when available", () => {
    const matchMediaMock = vi.fn().mockReturnValue({ matches: true });
    const original = window.matchMedia;
    window.matchMedia = matchMediaMock;
    expect(GR.resolveUiMode("auto")).toBe("dark");
    expect(matchMediaMock).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
    window.matchMedia = original;
  });

  it("falls back to 'light' for 'auto' when matchMedia prefers light", () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    expect(GR.resolveUiMode("auto")).toBe("light");
    window.matchMedia = original;
  });
});

describe("GR.THEMES", () => {
  it("assigns a valid scheme ('light' or 'dark') to every theme", () => {
    Object.keys(GR.THEMES).forEach((key) => {
      expect(["light", "dark"]).toContain(GR.THEMES[key].scheme);
    });
  });

  it("marks the sepia theme as light and the dark theme as dark", () => {
    expect(GR.THEMES.sepia.scheme).toBe("light");
    expect(GR.THEMES.dark.scheme).toBe("dark");
  });
});

describe("GR.load / GR.save", () => {
  let originalBrowser;

  beforeEach(() => {
    originalBrowser = global.browser;
  });

  afterEach(() => {
    global.browser = originalBrowser;
  });

  it("load() returns emptyState() when storage is empty", async () => {
    global.browser = {
      storage: { local: { get: vi.fn().mockResolvedValue({}) } },
    };
    const state = await GR.load();
    expect(state).toEqual(GR.emptyState());
  });

  it("load() merges stored global/perDomain/prefs onto the defaults", async () => {
    global.browser = {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({
            goodreadability: {
              global: { fontSize: 200 },
              perDomain: { "reddit.com": { theme: "dark" } },
              prefs: { uiMode: "dark" },
            },
          }),
        },
      },
    };
    const state = await GR.load();
    expect(state.global.fontSize).toBe(200);
    expect(state.perDomain["reddit.com"]).toEqual({ theme: "dark" });
    expect(state.prefs.uiMode).toBe("dark");
  });

  it("load() deep-merges stored reddit settings with current defaults", async () => {
    // Settings saved by an older version lack newer reddit.* keys; they must
    // be backfilled, and the stored object must not alias GR.DEFAULTS.reddit.
    global.browser = {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({
            goodreadability: { global: { reddit: { hideAds: false } } },
          }),
        },
      },
    };
    const state = await GR.load();
    expect(state.global.reddit.hideAds).toBe(false);
    expect(state.global.reddit.hideAvatars).toBe(GR.DEFAULTS.reddit.hideAvatars);
    expect(state.global.reddit).not.toBe(GR.DEFAULTS.reddit);
  });

  it("save() writes the state under the 'goodreadability' key", async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    global.browser = { storage: { local: { set } } };
    const state = GR.emptyState();
    await GR.save(state);
    expect(set).toHaveBeenCalledWith({ goodreadability: state });
  });
});
