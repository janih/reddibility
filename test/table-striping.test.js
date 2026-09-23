import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Same loading pattern as reddit-selectors.test.js: plain scripts and HTML
// via Node's require(), this file stays ESM for Vitest.
const require = createRequire(import.meta.url);
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CSS_PATH = path.join(__dirname, "..", "content", "content.css");

// Fixture: a real reported table (Tailwind spec-style, every-other row
// striped dark by the site itself) that exposed the bug — on light themes
// the theme-forced dark text landed on the site's own near-black stripes.
// Kept verbatim from the report so the selectors are tested against the
// exact markup that failed.
const TABLE_HTML = `<table class="overflow-x-auto">
  <thead>
    <tr>
      <th class="align-left">Model</th><th class="align-left">Year</th><th class="align-left">Weight</th><th class="align-left">Thickness</th>
    </tr>
    <tr></tr>
  </thead>
  <tbody>
    <tr><td class="align-left">iPhone 18 Pro Max</td><td class="align-left">2026</td><td class="align-left">8.78 oz / 249 g</td><td class="align-left">8.75 mm</td></tr>
    <tr><td class="align-left">iPhone 17 Pro Max</td><td class="align-left">2025</td><td class="align-left">8.22 oz / 233 g</td><td class="align-left">8.75 mm</td></tr>
    <tr><td class="align-left">iPhone 16 Pro Max</td><td class="align-left">2024</td><td class="align-left">7.99 oz / 227 g</td><td class="align-left">8.25 mm</td></tr>
    <tr><td class="align-left">iPhone 15 Pro Max</td><td class="align-left">2023</td><td class="align-left">7.81 oz / 221 g</td><td class="align-left">8.25 mm</td></tr>
    <tr><td class="align-left">iPhone 14 Pro Max</td><td class="align-left">2022</td><td class="align-left">8.47 oz / 240 g</td><td class="align-left">7.85 mm</td></tr>
    <tr><td class="align-left">iPhone 13 Pro Max</td><td class="align-left">2021</td><td class="align-left">8.39 oz / 238 g</td><td class="align-left">7.65 mm</td></tr>
    <tr><td class="align-left">iPhone 12 Pro Max</td><td class="align-left">2020</td><td class="align-left">8.03 oz / 228 g</td><td class="align-left">7.40 mm</td></tr>
    <tr><td class="align-left">iPhone 11 Pro Max</td><td class="align-left">2019</td><td class="align-left">7.97 oz / 226 g</td><td class="align-left">8.10 mm</td></tr>
    <tr><td class="align-left">iPhone XS Max</td><td class="align-left">2018</td><td class="align-left">7.34 oz / 208 g</td><td class="align-left">7.70 mm</td></tr>
    <tr><td class="align-left">iPhone 8 Plus</td><td class="align-left">2017</td><td class="align-left">7.13 oz / 202 g</td><td class="align-left">7.50 mm</td></tr>
    <tr><td class="align-left">iPhone 7 Plus</td><td class="align-left">2016</td><td class="align-left">6.63 oz / 188 g</td><td class="align-left">7.30 mm</td></tr>
  </tbody>
</table>`;

// A real (non-opaque) URL avoids jsdom's "localStorage is not available for
// opaque origins" SecurityError during async teardown — same gotcha as
// reddit-selectors.test.js.
function loadDoc() {
  const dom = new JSDOM(`<!doctype html><html><body>${TABLE_HTML}</body></html>`, {
    url: "https://example.com/specs",
  });
  return dom.window.document;
}

describe("table striping rules in content.css", () => {
  let css;
  beforeAll(() => {
    css = fs.readFileSync(CSS_PATH, "utf-8");
  });

  it("neutralizes hardcoded backgrounds on table parts", () => {
    // The transparent reset must cover rows and cells — site stripes are set
    // on either depending on the framework. Each part must still be listed
    // as a selector in the reset rule.
    ["table", "thead", "tbody", "tfoot", "tr", "th", "td"].forEach((part) => {
      expect(css).toMatch(new RegExp("html\\.gr-active " + part + "\\s*(,|\\{)"));
    });
    expect(css).toMatch(
      /html\.gr-active td\s*\{\s*background-color:\s*transparent\s*!important/
    );
  });

  it("re-stripes even body rows with a theme-derived color-mix", () => {
    // The replacement stripe must come from the theme vars (adapts to light
    // AND dark schemes), not a hardcoded color that could fail one of them.
    const rule = css.match(
      /html\.gr-active tbody tr:nth-child\(even\) td,[\s\S]*?{([\s\S]*?)}/
    );
    expect(rule).not.toBeNull();
    expect(rule[1]).toContain("color-mix(in srgb, var(--gr-text");
    expect(rule[1]).toContain("var(--gr-bg");
  });

  it("tints header cells so sticky theads stay opaque", () => {
    const rule = css.match(/html\.gr-active thead th\s*{([\s\S]*?)}/);
    expect(rule).not.toBeNull();
    expect(rule[1]).toContain("color-mix(in srgb, var(--gr-text");
  });
});

describe("table striping selectors against the reported table", () => {
  const doc = loadDoc();

  it("matches the even-row stripe cells (5 of 11 rows × 4 cells)", () => {
    expect(doc.querySelectorAll("tbody tr:nth-child(even) td").length).toBe(20);
  });

  it("matches header cells but not the empty spacer row", () => {
    expect(doc.querySelectorAll("thead th").length).toBe(4);
    expect(doc.querySelectorAll("thead tr:nth-child(2)").length).toBe(1); // exists, stays untouched
  });

  it("matches the neutralize reset on every cell and row", () => {
    expect(doc.querySelectorAll("table").length).toBe(1);
    expect(doc.querySelectorAll("tr").length).toBe(13); // 1 header + 1 empty + 11 body
    expect(doc.querySelectorAll("td").length).toBe(44);
  });
});
