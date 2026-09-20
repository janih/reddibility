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

  it("is enabled by default (fresh installs are active immediately)", () => {
    // A brand-new install has nothing stored, so emptyState() — driven by
    // these defaults — is what every apply path reads. Off-by-default here
    // meant the extension silently did nothing until the user found and
    // flipped the popup's master switch.
    expect(GR.DEFAULTS.enabled).toBe(true);
    expect(GR.emptyState().global.enabled).toBe(true);
  });

  it("defaults every reddit tweak to on (users opt out individually)", () => {
    // Policy: a fresh install gets the full cleanup; opting out is a
    // per-tweak user action. Adding a new toggle with `false` here must be
    // a conscious decision — update this test if it truly should be opt-in.
    Object.keys(GR.DEFAULTS.reddit).forEach((k) => {
      expect(GR.DEFAULTS.reddit[k]).toBe(true);
    });
    const fresh = GR.emptyState().global.reddit;
    Object.keys(fresh).forEach((k) => expect(fresh[k]).toBe(true));
  });

  it("keeps a stored per-tweak opt-out off even though defaults are on", async () => {
    global.browser = {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({
            reddibility: { global: { reddit: { hideTopBar: false } } },
          }),
        },
      },
    };
    const state = await GR.load();
    expect(state.global.reddit.hideTopBar).toBe(false);
    expect(GR.effective(state, "reddit.com").reddit.hideTopBar).toBe(false);
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
            reddibility: {
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

  it("load() migrates settings still stored under the legacy pre-rename key", async () => {
    // The project was renamed to Reddibility; data saved under the old
    // "goodreadability" key must still load, be copied to the new key, and
    // the legacy copy removed.
    const get = vi.fn().mockResolvedValue({ goodreadability: { global: { fontSize: 130 } } });
    const set = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    global.browser = { storage: { local: { get, set, remove } } };

    const state = await GR.load();

    expect(state.global.fontSize).toBe(130);
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ reddibility: state });
    // The legacy removal chains off the set() promise.
    await new Promise((r) => setTimeout(r, 0));
    expect(remove).toHaveBeenCalledWith("goodreadability");
  });

  it("load() deep-merges stored reddit settings with current defaults", async () => {
    // Settings saved by an older version lack newer reddit.* keys; they must
    // be backfilled, and the stored object must not alias GR.DEFAULTS.reddit.
    global.browser = {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({
            reddibility: { global: { reddit: { hideAds: false } } },
          }),
        },
      },
    };
    const state = await GR.load();
    expect(state.global.reddit.hideAds).toBe(false);
    expect(state.global.reddit.hideAvatars).toBe(GR.DEFAULTS.reddit.hideAvatars);
    expect(state.global.reddit).not.toBe(GR.DEFAULTS.reddit);
  });

  it("load() keeps a stored opt-out off even though the default is on", async () => {
    // enabled defaults to true, but anyone who ever disabled the extension
    // has `enabled: false` materialized in storage — the default must never
    // resurrect an explicit opt-out (e.g. after an update).
    global.browser = {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({
            reddibility: { global: { enabled: false } },
          }),
        },
      },
    };
    const state = await GR.load();
    expect(state.global.enabled).toBe(false);
    expect(GR.effective(state, "reddit.com").enabled).toBe(false);
  });

  it("save() writes the state under the 'reddibility' key", async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    global.browser = { storage: { local: { set } } };
    const state = GR.emptyState();
    await GR.save(state);
    expect(set).toHaveBeenCalledWith({ reddibility: state });
  });
});

describe("GR.applyToTab", () => {
  let originalBrowser;

  beforeEach(() => {
    originalBrowser = global.browser;
  });

  afterEach(() => {
    global.browser = originalBrowser;
  });

  it("sends the apply message directly when the content script is already there", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    global.browser = { tabs: { sendMessage }, scripting: {} };
    await GR.applyToTab(7, { enabled: true });
    expect(sendMessage).toHaveBeenCalledWith(7, { type: "apply", settings: { enabled: true } });
  });

  it("injects CSS + JS before retrying when no content script is loaded", async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("no receiver"))
      .mockResolvedValueOnce(undefined);
    const insertCSS = vi.fn().mockResolvedValue(undefined);
    const executeScript = vi.fn().mockResolvedValue(undefined);
    global.browser = { tabs: { sendMessage }, scripting: { insertCSS, executeScript } };

    await GR.applyToTab(7, { enabled: true });

    // CSS must be injected too — a JS-only fallback used to toggle gr-*
    // classes that had no matching rules.
    expect(insertCSS).toHaveBeenCalledWith({
      target: { tabId: 7 },
      files: ["content/content.css", "content/reddit.css"],
    });
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 7 },
      files: ["lib/shared.js", "content/content.js"],
    });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it("rejects (for the caller to ignore) on restricted pages", async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error("no receiver"));
    const insertCSS = vi.fn().mockRejectedValue(new Error("restricted"));
    global.browser = { tabs: { sendMessage }, scripting: { insertCSS } };
    await expect(GR.applyToTab(7, {})).rejects.toThrow("restricted");
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});

describe("GR site access helpers (opt-in non-Reddit sites)", () => {
  let originalBrowser;

  beforeEach(() => {
    originalBrowser = global.browser;
  });

  afterEach(() => {
    global.browser = originalBrowser;
  });

  it("recognizes reddit.com and its subdomains as statically permitted", () => {
    expect(GR.isRedditDomain("reddit.com")).toBe(true);
    expect(GR.isRedditDomain("old.reddit.com")).toBe(true);
    expect(GR.isRedditDomain("notreddit.com")).toBe(false);
    expect(GR.isRedditDomain("reddit.com.evil.io")).toBe(false);
    expect(GR.isRedditDomain("")).toBe(false);
  });

  it("builds both origin pattern forms for a domain", () => {
    expect(GR.originPatternsForDomain("example.com")).toEqual([
      "*://example.com/*",
      "*://*.example.com/*",
    ]);
  });

  it("derives the domain back from either origin pattern form", () => {
    expect(GR.domainFromOriginPattern("*://example.com/*")).toBe("example.com");
    expect(GR.domainFromOriginPattern("*://*.example.com/*")).toBe("example.com");
    expect(GR.domainFromOriginPattern("<all_urls>")).toBe("");
    expect(GR.domainFromOriginPattern("")).toBe("");
  });

  it("hasSiteAccess resolves true without probing for Reddit (static permission)", async () => {
    const contains = vi.fn();
    global.browser = { permissions: { contains } };
    await expect(GR.hasSiteAccess("reddit.com")).resolves.toBe(true);
    expect(contains).not.toHaveBeenCalled();
  });

  it("hasSiteAccess probes each origin pattern individually", async () => {
    // contains() requires ALL listed origins to be granted, so the two
    // pattern forms must be checked separately (either one suffices).
    const contains = vi
      .fn()
      .mockResolvedValueOnce(false) // bare form
      .mockResolvedValueOnce(true); // wildcard form
    global.browser = { permissions: { contains } };
    await expect(GR.hasSiteAccess("example.com")).resolves.toBe(true);
    expect(contains).toHaveBeenCalledTimes(2);
  });

  it("ensureSiteAccess prompts and registers a dynamic content script on grant", async () => {
    global.browser = {
      permissions: {
        contains: vi.fn().mockResolvedValue(false),
        request: vi.fn().mockResolvedValue(true),
      },
      scripting: {
        getRegisteredContentScripts: vi.fn().mockResolvedValue([]),
        registerContentScripts: vi.fn().mockResolvedValue(undefined),
      },
    };
    await expect(GR.ensureSiteAccess("example.com")).resolves.toBe(true);
    expect(global.browser.permissions.request).toHaveBeenCalledWith({
      origins: ["*://example.com/*", "*://*.example.com/*"],
    });
    expect(global.browser.scripting.registerContentScripts).toHaveBeenCalledTimes(1);
    const spec = global.browser.scripting.registerContentScripts.mock.calls[0][0][0];
    expect(spec.id).toBe("gr-site-example.com");
    expect(spec.matches).toEqual(["*://example.com/*", "*://*.example.com/*"]);
    expect(spec.runAt).toBe("document_start");
    expect(spec.persistAcrossSessions).toBe(true);
    expect(spec.js).toEqual(["lib/shared.js", "content/content.js"]);
    expect(spec.css).toEqual(["content/content.css", "content/reddit.css"]);
  });

  it("ensureSiteAccess resolves false and registers nothing when denied", async () => {
    global.browser = {
      permissions: {
        contains: vi.fn().mockResolvedValue(false),
        request: vi.fn().mockResolvedValue(false),
      },
      scripting: {
        getRegisteredContentScripts: vi.fn().mockResolvedValue([]),
        registerContentScripts: vi.fn(),
      },
    };
    await expect(GR.ensureSiteAccess("example.com")).resolves.toBe(false);
    expect(global.browser.scripting.registerContentScripts).not.toHaveBeenCalled();
  });

  it("ensureSiteAccess skips the prompt when access is already granted", async () => {
    global.browser = {
      permissions: {
        contains: vi.fn().mockResolvedValue(true),
        request: vi.fn(),
      },
    };
    await expect(GR.ensureSiteAccess("example.com")).resolves.toBe(true);
    expect(global.browser.permissions.request).not.toHaveBeenCalled();
  });

  it("reconcileSiteScripts registers granted-but-missing sites and unregisters stale ones", async () => {
    const registerContentScripts = vi.fn().mockResolvedValue(undefined);
    const unregisterContentScripts = vi.fn().mockResolvedValue(undefined);
    global.browser = {
      permissions: {
        getAll: vi.fn().mockResolvedValue({
          origins: ["*://*.a.com/*", "*://*.b.com/*", "*://*.reddit.com/*", "<all_urls>"],
        }),
      },
      scripting: {
        getRegisteredContentScripts: vi.fn().mockResolvedValue([
          { id: "gr-site-b.com" }, // registered + granted: keep
          { id: "gr-site-c.com" }, // registered but no grant: stale
          { id: "someone-elses-script" }, // not ours: leave alone
        ]),
        registerContentScripts,
        unregisterContentScripts,
      },
    };

    await GR.reconcileSiteScripts();

    // a.com is granted but missing → registered; b.com untouched;
    // reddit/<all_urls> ignored; c.com stale → unregistered.
    expect(registerContentScripts).toHaveBeenCalledTimes(1);
    expect(registerContentScripts.mock.calls[0][0][0].id).toBe("gr-site-a.com");
    expect(unregisterContentScripts).toHaveBeenCalledWith({ ids: ["gr-site-c.com"] });
  });

  it("revokeSiteAccess removes the origin permissions and reconciles", async () => {
    const remove = vi.fn().mockResolvedValue(true);
    const unregisterContentScripts = vi.fn().mockResolvedValue(undefined);
    global.browser = {
      permissions: {
        remove,
        getAll: vi.fn().mockResolvedValue({ origins: [] }),
      },
      scripting: {
        getRegisteredContentScripts: vi
          .fn()
          .mockResolvedValue([{ id: "gr-site-example.com" }]),
        unregisterContentScripts,
      },
    };

    await GR.revokeSiteAccess("example.com");

    expect(remove).toHaveBeenCalledWith({
      origins: ["*://example.com/*", "*://*.example.com/*"],
    });
    // Reconcile ran and unregistered the now-unpermitted site script.
    expect(unregisterContentScripts).toHaveBeenCalledWith({ ids: ["gr-site-example.com"] });
  });

  it("revokeSiteAccess is a no-op for Reddit (required permission)", async () => {
    const remove = vi.fn();
    global.browser = { permissions: { remove } };
    await expect(GR.revokeSiteAccess("reddit.com")).resolves.toBeUndefined();
    expect(remove).not.toHaveBeenCalled();
  });
});

describe("GR.updateBadge", () => {
  let originalBrowser;

  beforeEach(() => {
    originalBrowser = global.browser;
  });

  afterEach(() => {
    global.browser = originalBrowser;
  });

  it("shows ON for enabled tabs and clears it for disabled ones", async () => {
    const setBadgeText = vi.fn().mockResolvedValue(undefined);
    const setBadgeBackgroundColor = vi.fn().mockResolvedValue(undefined);
    global.browser = { action: { setBadgeText, setBadgeBackgroundColor } };

    await GR.updateBadge(5, true);
    expect(setBadgeText).toHaveBeenCalledWith({ text: "ON", tabId: 5 });

    await GR.updateBadge(5, false);
    expect(setBadgeText).toHaveBeenCalledWith({ text: "", tabId: 5 });
  });

  it("is a no-op without browser.action (e.g. content-script contexts)", async () => {
    global.browser = { storage: {} };
    await expect(GR.updateBadge(5, true)).resolves.toBeUndefined();
  });
});
