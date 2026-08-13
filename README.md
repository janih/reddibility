# GoodReddit

A Firefox extension that makes **Reddit** (and any website) easier to read.
Declutter the new-Reddit feed and sidebars, hide promoted posts, widen the
content, and apply comfortable themes & typography. Settings can be global or
per-site.

> Built on Firefox Manifest V3. Reddit's DOM changes often, so the cleanup
> rules are best-effort and easy to edit in `content/reddit.css`.

## Features

### Reddit tweaks (the headline)
- **Hide promoted posts & ads** in the feed
- **Hide the right sidebar** (community rail, popular communities, highlights)
- **Declutter the left sidebar** (Games on Reddit, recent pages, explore…)
- **Hide trending searches**
- **Widen** the main content column
- **Compact feed** — tighter post cards
- **Better comment spacing** for easier reading
- **Click to show images & videos** — replaces user-added post/comment media
  with a compact "Click to show" link until you choose to reveal it (opt-in,
  off by default)
- **Hide top bar** — hides the sticky search/login/register bar (opt-in, off
  by default); a tiny tab pinned to the very top edge lets you bring it back
  with one click
- **Minimize "Join" buttons** — shrinks and fades the per-post "Join" button
  shown in the feed's subreddit credit bar (on by default); it's still one
  click away, just far less prominent, and returns to full size on hover

### General readability (works everywhere)
- **7 themes** — Light, Sepia, Dark, High Contrast, Solarized Light/Dark, Nord
- **Typography** — font family, font size, line height, letter & word spacing,
  and a max text width
- **Per-site or global** — flip “This site only” to override a single domain
- **Keyboard shortcut** — `Alt+R` toggles readability on the current page
- **Badge indicator** — shows `ON` on the toolbar icon when active
- **Optional clutter hiding** — hides common cookie banners & newsletter popups
- **Panel theme** — force the toolbar panel & options page to light/dark, or follow your system (Auto)

## Install (temporary, for development)

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on…**
3. Select the `manifest.json` file in this folder.

> Temporary add-ons are removed when Firefox restarts. To install permanently,
> package the extension and sign it through
> [addons.mozilla.org](https://addons.mozilla.org/developers/) (or load it
> unsigned in Firefox Developer Edition / Nightly with
> `xpinstall.signatures.required` set to `false`).

## Package as `.xpi`

```bash
zip -r -FS goodreddit.xpi * -x "*.xpi" -x "*.DS_Store"
```

## Usage

1. Go to `reddit.com` and click the toolbar icon.
2. Flip the master switch **on** — by default this affects **only the current
   site**, so Reddit gets cleaned up (ads gone, sidebars hidden, content
   widened) without changing other sites.
3. Fine-tune via the **Reddit tweaks** checkboxes, and pick a theme/typography.
4. Uncheck **This site only** to apply your changes to *all* sites instead.
5. Press `Alt+R` to toggle the current site quickly.

## File layout

```
manifest.json            Extension manifest (Manifest V3)
lib/shared.js            Constants + helpers shared by all contexts
content/content.js       Applies settings: toggles classes on <html>
content/content.css      General readability CSS (variable-driven)
content/reddit.css       Reddit-specific cleanup (new Reddit selectors)
background/background.js Keyboard shortcut handling + toolbar badge
popup/                   Toolbar panel UI
options/                 Full-page options & per-site manager
icons/icon.svg           Toolbar / store icon
reddit/                  Saved logged-out Reddit page captures (dev reference)
```

## How it works

The content script toggles a `gr-active` class on `<html>` and writes a small
set of CSS custom properties into a `<style>` tag for the theme/typography. On Reddit it also adds `gr-reddit` plus feature classes (`gr-rd-ads`,
`gr-rd-noright`, …) that drive the cleanup rules in `content/reddit.css`, and
overrides Reddit's own design-token CSS variables (`--color-neutral-*`) so the
chosen theme actually recolors the whole site.

Because the styling is purely declarative CSS, it keeps working as Reddit
dynamically loads new posts and comments (a single-page app) without any extra
work. When disabled, the classes are removed and the page reverts to normal.

### Updating the Reddit selectors

If Reddit ships a redesign and a rule stops matching, open
`content/reddit.css` and adjust the selectors. The feature classes set by
`content/content.js` (`gr-rd-*`) don’t need to change — only the CSS targets do.

Before guessing at markup, check the offline DOM references saved under
`reddit/` — logged-out captures of a front page (`reddit/frontpage/`), a
subreddit feed (`reddit/subreddit/`), a post/comments page (`reddit/post/`),
and a media-heavy post/comments page (`reddit/post_with_media/`, useful for
verifying the click-to-load-media feature), each with its `*_files/` assets.
Open the `.html` file in a browser or grep it to confirm real class/id/tag
names instead of guessing.
If a capture looks outdated, save a fresh one to replace it (see `AGENTS.md`
for details).
