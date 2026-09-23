import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Same loading pattern as table-striping.test.js / reddit-selectors.test.js.
const require = createRequire(import.meta.url);
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CSS_PATH = path.join(__dirname, "..", "content", "content.css");

// Fixture modeled on the real report: a site-hardcoded dark <pre> (black
// background designed for the site's own light text) with plain and
// syntax-highlighted code, plus the inline monospace elements that carry
// the same hardcoded-chip failure mode.
const DOC_HTML = `<!doctype html><html><body>
  <pre><code class="language-js">const plain = true;</code></pre>
  <pre>plain pre, no inner code</pre>
  <pre><code class="hljs"><span class="hljs-keyword">const</span> x = 1;</code></pre>
  Inline <code>code chip</code>, <kbd>Ctrl</kbd>, <samp>output</samp>.
</body></html>`;

function loadDoc() {
  const dom = new JSDOM(DOC_HTML, { url: "https://example.com/docs" });
  return dom.window.document;
}

describe("code block repaint rules in content.css", () => {
  let css;

  beforeAll(() => {
    css = fs.readFileSync(CSS_PATH, "utf-8");
  });

  it("repaints pre/code/kbd/samp text and surface from theme vars", () => {
    // All four monospace surfaces must get BOTH a forced text color and a
    // theme-derived background — forcing only the text is exactly what made
    // light themes unreadable on site-hardcoded dark blocks.
    ["pre", "code", "kbd", "samp"].forEach((el) => {
      // Match the repaint rule specifically (selector list ordered pre then
      // code — the earlier font-family rule lists code before pre).
      const rule = css.match(
        new RegExp(
          "html\\.gr-active pre,\\s*html\\.gr-active code,[\\s\\S]*?{([\\s\\S]*?)}"
        )
      );
      expect(rule).not.toBeNull();
      expect(rule[1]).toContain("color: var(--gr-text");
      expect(rule[1]).toContain("background-color: color-mix(in srgb, var(--gr-text");
      expect(rule[1]).toContain("var(--gr-bg");
      // The element must also appear somewhere in the repaint selector list
      // (last-listed selectors end with `{`, not a comma).
      expect(css).toMatch(new RegExp("html\\.gr-active " + el + "\\s*(,|\\{)"));
    });
  });

  it("resets syntax-highlight token colors inside pre to inherit", () => {
    // Highlighters pick token colors for the site's own (often dark) scheme;
    // left alone they can be near-invisible on the retinted surface.
    const rule = css.match(/html\.gr-active pre \*\s*{([\s\S]*?)}/);
    expect(rule).not.toBeNull();
    expect(rule[1]).toContain("color: inherit");
  });
});

describe("code block selectors against the fixture", () => {
  const doc = loadDoc();

  it("matches every monospace surface element", () => {
    expect(doc.querySelectorAll("pre").length).toBe(3);
    expect(doc.querySelectorAll("code").length).toBe(3); // 2 in pre + 1 inline
    expect(doc.querySelectorAll("kbd").length).toBe(1);
    expect(doc.querySelectorAll("samp").length).toBe(1);
  });

  it("reaches highlighted token spans through the pre * reset", () => {
    expect(doc.querySelectorAll("pre .hljs-keyword").length).toBe(1);
    expect(doc.querySelectorAll("pre *").length).toBe(3); // 2 code + 1 span
  });
});
