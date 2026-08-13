# AGENTS.md

## Project

GoodReddit is a Firefox extension (Manifest V3) that improves readability of
Reddit's new layout — hiding ads/promoted posts, decluttering sidebars,
widening content, and applying themes & typography — plus general readability
features (themes, fonts, spacing) intended to work on any website over time.

## Layout

- `manifest.json` — extension manifest (Manifest V3).
- `lib/shared.js` — constants/defaults and helpers shared by background,
  content script, popup, and options page.
- `background/background.js` — keyboard shortcut (`Alt+R`) and toolbar badge.
- `content/content.js` — reads settings and toggles classes/CSS vars on
  `<html>`; runs on every page (`<all_urls>`).
- `content/content.css` — general, site-agnostic readability CSS.
- `content/reddit.css` — Reddit-specific selectors that hide/restyle new-Reddit
  DOM elements based on the feature classes set by `content.js`.
- `popup/`, `options/` — toolbar panel UI and full options page (per-site or
  global settings), each with matching `.html`/`.css`/`.js`.
- `reddit/` — saved (logged-out) Reddit page captures, used as a DOM
  reference when writing/updating CSS selectors (see below).

## Working with the `reddit/` reference captures

- `reddit/<page-type>/*.html` plus its matching `*_files/` folder is a full
  offline snapshot of a real, **logged-out** Reddit page (new-Reddit UI),
  saved for reference only. There are currently four captures, all taken
  2026-08-13, one per page type/purpose, each in its own subfolder:
  - `reddit/frontpage/Reddit - Netin sydän.html` (+ `..._files/`) — the
    logged-out front page (a feed of posts from multiple subreddits).
  - `reddit/subreddit/Today I Learned (TIL).html` (+ `..._files/`) — a
    single subreddit feed (`r/todayilearned`).
  - `reddit/post/poolside_Laguna-S-2.1 released! Finally an interesting
    120B contender! _ r_LocalLLaMA.html` (+ `..._files/`) — a post detail /
    comments page (the original capture from before the other two were
    added), text-heavy with no embedded post/comment media.
  - `reddit/post_with_media/what's in this bag _ r_whatisit.html`
    (+ `..._files/`) — a post detail/comments page picked specifically for
    having lots of user-added media (comment-embedded images and gifs), used
    to verify the click-to-load-media feature.
- Use these to inspect real DOM structure/class names when adding or fixing
  selectors in `content/reddit.css` — e.g. open the `.html` file in a
  browser or grep it — instead of guessing at Reddit's markup. Prefer the
  frontpage/subreddit captures for feed-only widgets (promoted feed posts,
  right-rail community/ad widgets) and the post capture for post/comment-
  page-only elements (post media container, comment tree).
- Reddit ships frequent redesigns; selectors here can go stale. If a capture
  looks outdated, prefer checking live Reddit and, if helpful, saving a
  fresh capture of the current logged-out page layout to replace it
  (removing the old capture folder/files) rather than layering multiple
  captures of the *same* page type.
- Since the extension may target other sites in the future, similar
  reference captures for other sites can be added the same way in sibling
  top-level folders (e.g. `other-site/frontpage/`, `other-site/post/`).
- Cross-checking all captures confirmed `#right-sidebar-container`,
  `#right-sidebar-contents`, `#left-sidebar-container`, `#main-content`,
  `.grid-container`, `shreddit-post`, `shreddit-comment`, `.promotedlink`
  (used by the real `<shreddit-ad-post>` element), `#subreddit-right-rail__
  partial` and `reddit-search-large`. The frontpage capture also confirmed
  the "Popular communities" right-rail box is `.right-rail-popular-
  communities` — its `aria-label` is localized (e.g. "Suositut yhteisöt" in
  Finnish for this capture), so the old `[aria-label="Popular Communities"]`
  selector never matched non-English locales and has been replaced with the
  class selector. `community-highlight-carousel` and
  `[slot="sidebar-contents"]` were not found in any of the frontpage/
  subreddit/post captures and have been removed as stale. `#reddit-trending-searches-partial-
  container` still isn't present in any static capture (likely only
  rendered client-side on search-box focus) — kept as best-effort.

## Widen-content gotcha

- The "Widen" toggle (`gr-rd-widen`) originally only overrode `max-width` on
  `<main>`/`#main-content`/`.grid-container`, but none of those elements
  actually carry a `max-width` on current Reddit (verified in the
  `reddit/post/` capture) — the real width constraints are `#subgrid-container`'s fixed
  `width` (`w-[1120px]`) and `.main-container`'s fixed-pixel
  `grid-template-columns` (`756px`/`316px`), so the rule had no visible
  effect. `content/reddit.css` now overrides those two instead (plus
  collapses the sidebar grid track entirely when combined with
  `gr-rd-noright`), keeping the old `max-width` rules as a harmless
  fallback for other/older layouts.
- Widening still left a large empty gap on the left. Root cause (per the
  `reddit/post/` capture): `#left-sidebar-container` (the desktop nav/xpromo
  rail) is a grid item of `.grid-container` sitting in the first column,
  but it's `position: fixed`, so it renders as a floating overlay while its
  grid column is still reserved — `#subgrid-container` (which lives in
  `.grid-container`'s second column, `m:col-start-2`) was never able to use
  that space even after its own width was uncapped. Fixed by collapsing
  `.grid-container` to a single `1fr` column and spanning
  `#subgrid-container` across it (`grid-column: 1 / -1`) whenever
  `gr-rd-widen` is active, so content is centered in the fully reclaimed
  width instead of leaning right. This is independent of `gr-rd-noleft`
  (which only hides the sidebar element visually, it doesn't touch the
  grid track).
- Widening also clipped the post page's `pdp-back-button` ("back to
  subreddit" control, confirmed in the `reddit/post/` and `reddit/
  post_with_media/` captures): Reddit positions it at `inset-inline-start:
  -2.5rem` relative to its local container, floating leftward into the
  (formerly reserved) left-sidebar grid column — fine normally, since that
  column's empty space absorbs it, but `gr-rd-widen` collapses the column
  and shifts `#subgrid-container` flush to the reclaimed edge, so the same
  negative offset now pushes the button partly past the actual content
  edge. First fix attempt just overrode `inset-inline-start` to a small
  positive value, which stopped the clipping but exposed a second problem:
  `pdp-back-button` only gets `position: absolute` (and its offsets) at all
  via a plain Reddit `@media (min-width: 1472px)` rule inlined in the
  page's own Tailwind stylesheet (verified by inspecting the captures'
  inlined `<style id="tailwind">` — it's a fixed viewport breakpoint, not a
  container query, so it's unrelated to our grid changes but just as
  fragile). Below that breakpoint the button is a normal in-flow flex item
  next to the credit-bar avatar instead, so the offset-only fix had no
  effect there and the button could still end up rendered in the wrong
  place relative to the post content. Fixed properly by forcing
  `position: absolute` (plus `top`, the inset, and a `z-index`)
  unconditionally on `pdp-back-button` whenever `gr-rd-widen` is active,
  anchored to `#pdp-credit-bar` (the nearest `position: relative`
  ancestor), so it always floats cleanly regardless of viewport width
  instead of depending on Reddit's own breakpoint.
- Making `pdp-back-button` float (above) left its normal flex-row slot
  empty, so its very next sibling — the subreddit avatar (`<pdp-back-
  button>` is immediately followed by `<span class="avatar ...">` inside
  `#pdp-credit-bar`, confirmed in both the `reddit/post/` and `reddit/
  post_with_media/` captures) and, by extension, the subreddit-name/
  timestamp block after it — slid left to fill that gap and ended up
  rendered underneath the now-floating button instead of beside it. Fixed
  by giving that `.avatar` sibling a `margin-inline-start` (whenever
  `gr-rd-widen` is active) roughly matching the back button's width plus
  clearance, so the credit-bar's own content shifts right and no longer
  overlaps it.
- Widening also broke down when combined with a **visible** left sidebar
  (i.e. `gr-rd-widen` active but `gr-rd-noleft` *not*): Reddit's real
  `.grid-container:not(.grid-full)` rule (found in the `reddit/post/`
  capture's inlined Tailwind stylesheet) reserves a genuine first grid
  column via `grid-template-columns: var(--flex-nav-width) 1fr`
  (`--flex-nav-width` is 272-315px), which is what `#left-sidebar-container`
  — itself `position: fixed` — visually sits on top of. The earlier widen
  fix collapsed `.grid-container` to a single `1fr` column and spanned
  `#subgrid-container` across it *unconditionally*, so with the sidebar
  still visible the widened content now started at the page edge and slid
  underneath the fixed sidebar overlay instead of stopping clear of it.
  Fixed by scoping that collapse/span pair to `gr-rd-widen.gr-rd-noleft`
  only; when the sidebar stays visible, Reddit's own reserved column (and
  its own `m:col-start-2` placement of `#subgrid-container`) is left
  intact, so widened content still starts to the right of the sidebar
  instead of overlapping it.

## Click-to-load media gotcha

- New opt-in setting `reddit.clickToLoadMedia` (toggle: "Click to show images
  & videos", off by default) gates **user-added** media only — a post's
  primary media and images/video embedded in comments — not avatars, icons,
  or other UI chrome.
- Per the `reddit/post/` capture, a post's primary media (image, gallery,
  video player) always lives inside `<shreddit-post>`'s
  `div[slot="post-media-container"]`; that's the selector `content/reddit.css`
  gates behind the `gr-rd-clicktoload` class.
- Comment media is gated via `figure.rte-media` — Reddit's rich-text
  embedded-media wrapper, used for both plain `<img>` comment images and
  `shreddit-player`-based comment gifs. Confirmed against the
  `reddit/post_with_media/` capture (picked for having lots of comment
  media), which also caught a real bug: the previous selector (`shreddit-
  comment img`/`video`) also matched user **avatars** and **achievement-
  badge icons** — both plain `<img>` elements inside `<shreddit-comment>` —
  which violates the "not avatars/icons" scope of this feature.
  `figure.rte-media` wraps only actual user-embedded media, not
  avatars/badges (which use unrelated markup — a `faceplate-tracker`/`span`
  avatar wrapper and an `author-hovercard-trigger` badge wrapper,
  respectively), and gating the whole `<figure>` also sidesteps some gif
  wrappers' fixed inline `width`/`height` that would otherwise still reserve
  layout space even with the inner element hidden.
- This only gates the *view*, not loading: Reddit's own custom elements
  (`shreddit-player`, `gallery-carousel`) still run their own
  viewport-intersection logic underneath, so it's not a bandwidth
  optimization, just a click-to-reveal UI.
- Originally implemented as a blur overlay on the media element itself, but
  that still reserved the element's original (often large) width/height in
  the layout. Replaced with a fully `display: none`-gated media element plus
  a small injected `.gr-media-placeholder` link ("Click to show") so gated
  posts/comments collapse to a single compact line instead of a big blurred
  box. `content/content.js` scans for `MEDIA_GATE_SELECTOR` matches (via
  `scanForGatedMedia`/`ensureMediaPlaceholder`) and inserts the placeholder
  before each gated element, plus runs a `MutationObserver`
  (`startMediaObserver`) so media added later by Reddit's SPA (infinite
  scroll, comment pagination) still gets a placeholder. Clicking the
  placeholder adds `.gr-media-revealed` to the real element (lifting the CSS
  `display: none` gate) and removes the placeholder; toggling the setting
  off calls `teardownMediaPlaceholders` to remove any leftover placeholders.

## Hide top bar + subtle toggler

- New opt-in setting `reddit.hideTopBar` (toggle: "Hide top bar (search /
  login)", off by default) hides the sticky bar with the logo, search box,
  and register/login buttons.
- Confirmed on all three captures (`reddit/frontpage/`, `reddit/subreddit/`,
  `reddit/post/`), that bar is the `<reddit-header-large>` custom
  element (`position: fixed; top-0/start-0/end-0`), so `display: none`-ing it
  via `gr-rd-notopbar` leaves no layout gap — no other element reserves space
  for it.
- Hiding it also removes the only way to reach search/login/the hamburger
  menu, so it can't just be a one-way toggle in settings: `content.js`
  (`ensureTopBarToggler`) injects a single tiny `<button class="gr-topbar-
  toggler">` fixed to the very top edge of the viewport (~5px tall, ~35%
  opacity, no text) whenever `gr-rd-notopbar` is active; clicking it toggles
  `.gr-rd-topbar-shown` on `<html>`, which lifts the CSS gate on
  `reddit-header-large` via a `:not(.gr-rd-topbar-shown)` selector. The tab
  is deliberately positioned to overlap the header's own top edge (rather
  than trying to track its height) so it works regardless of desktop/mobile
  header layout differences.
- `teardownTopBarToggler` removes the injected button and resets
  `.gr-rd-topbar-shown` when the setting is turned off or Reddit features are
  disabled entirely, so no stray toggler tab is left behind.

## Minimize "Join" buttons

- New setting `reddit.minimizeJoinButtons` (toggle: "Minimize \"Join\"
  buttons", **on by default** — unlike the other recent opt-in additions,
  this is a pure declutter tweak with no hidden-functionality tradeoff, so
  it follows the same default-on pattern as `hideAds`/`hideRightSidebar`/
  etc.) shrinks and fades the prominent per-post "Join" button in the feed.
- Confirmed only on the `reddit/frontpage/` capture: each feed post's credit
  bar (subreddit name + timestamp line) carries a `<shreddit-join-button
  data-testid="credit-bar-join-button">`, since the front page aggregates
  posts from many subreddits the reader may not have joined. Not present in
  the `reddit/subreddit/` or `reddit/post/` captures — a single-subreddit
  page already surfaces join/leave status elsewhere (e.g. the sidebar), so
  there's no equivalent per-post button to minimize there.
- Rather than fully hiding it (which would remove a real, sometimes-wanted
  action), `content/reddit.css` gates it behind `gr-rd-minjoin` with a
  shrink (`scale(0.82)`) + fade (`opacity: 0.35`) that reverts to full
  size/opacity on `:hover`/`:focus-within`, so the button stays reachable
  (including via keyboard) but no longer competes visually with post
  content. No `content.js` changes were needed beyond toggling the class —
  unlike the media/top-bar features, this one needs no injected DOM or
  teardown logic.

## Vote button / comment action bar / share button always-black gotcha

- `rpl-vote-button-group`, `comments-action-button`, and
  `shreddit-post-share-button` aren't present in any current `reddit/`
  capture (they're part of a newer Reddit UI change, not yet re-captured),
  but were reported always rendering with a black background regardless of
  the selected GoodReddit theme.
- Unlike most Reddit RPL surfaces — recolored by the existing
  `html.gr-reddit, html.gr-reddit *` block, which overrides Reddit's
  overridable `--color-*` design tokens via `color-mix()` — these
  components most likely resolve their background via the CSS
  `light-dark()` function keyed off the `color-scheme` property, which by
  default tracks the OS/browser dark-mode preference rather than Reddit's
  own tokens. That would explain why the background stayed black
  independent of the chosen theme/token overrides.
- Each theme in `lib/shared.js` now carries a `scheme: "light" | "dark"`
  field (light for Light/Sepia/Solarized Light, dark for Dark/High
  Contrast/Solarized Dark/Nord). `content.js`'s `buildCSS` writes both a
  `--gr-color-scheme` custom property and an actual `color-scheme:
  <scheme>;` declaration into the `:root.gr-active` style block, so the
  active theme's lightness is reflected in a real, inheritable CSS property
  — not just a custom property Reddit's own code has no reason to read —
  and it flows down into shadow trees the normal way (shadow hosts inherit
  from their light-DOM ancestors).
- `content/reddit.css` re-declares `color-scheme` (from `--gr-color-scheme`)
  directly on the three components as a safety net, in case their shadow
  root sets its own `color-scheme` on `:host` (which would otherwise win
  over the inherited value), plus a direct `background-color: var(--gr-bg)`
  fallback in case their internal styles don't consult `color-scheme` at
  all.
- The fix above didn't actually help, because the selectors were wrong:
  given the real inner HTML (supplied directly by the user, still not in
  any `reddit/` capture), `rpl-vote-button-group` and `comments-action-
  button` are **not** element tag names at all. `.rpl-vote-button-group` is
  a *class* on a `<span rpl data-post-click-location="vote">` wrapping the
  upvote/downvote `<button>`s, and `comments-action-button` is the `name`
  attribute of the comments `<a data-action-bar-action="comments">` — so
  `html.gr-reddit rpl-vote-button-group`/`comments-action-button` as tag
  selectors never matched anything. `shreddit-post-share-button` genuinely
  is a custom element tag, so that selector was already correct. Fixed by
  switching to `.rpl-vote-button-group`, `.rpl-vote-button-group button`
  (to also reach the individual upvote/downvote buttons inside),
  `[data-action-bar-action="comments"]`, and `a[name="comments-action-
  button"]`.
- Forcing these three components' colors is a deliberate fix for a Reddit-
  side contrast bug (see above), but not every reader wants it — some may
  prefer Reddit's own (even if low-contrast) look on
  just these elements. Added `reddit.forceButtonColors` (default `true`,
  `lib/shared.js`), toggled as `gr-rd-forcebtncolors` on `<html>` by
  `content.js`; the CSS rule above is now scoped to
  `html.gr-reddit.gr-rd-forcebtncolors ...` instead of unconditionally on
  `html.gr-reddit`, so turning the new "Force theme colors on vote/comment/
  share buttons" setting off (in `popup/` or `options/`) restores Reddit's
  own colors on just those three components without affecting any other
  theming.

## Typography settings gotchas

- `--gr-font-size` is applied on `html.gr-active` (the root element), not
  `body`, because most modern sites (including Reddit) size text in `rem`
  units, which are always relative to the root font-size regardless of any
  cascade — scaling `body` alone left almost all text unaffected.
- `--gr-line-height` has the opposite problem: `line-height` is a normally
  *inherited* property, so any element that sets its own line-height
  (common with utility-class frameworks, e.g. Reddit's `leading-*`/RPL
  tokens) simply overrides whatever was inherited from `body`/`html`.
  `content/content.css` forces it with a universal
  `html.gr-active * { line-height: var(--gr-line-height) !important; }`
  rule so the slider actually has an effect site-wide; more specific
  selectors (e.g. headings) can still opt out with their own line-height.

## Conventions

- Feature toggles are implemented as CSS classes (`gr-active`, `gr-reddit`,
  `gr-rd-*`) applied to `<html>` by `content.js`; styling is purely
  declarative CSS so it keeps working as Reddit's SPA loads content
  dynamically.
- When Reddit's markup changes, only `content/reddit.css` selectors should
  need updating — the feature classes set by `content.js` should stay stable.
- Settings are stored per-site or globally (see `lib/shared.js`); keep new
  settings consistent with that pattern and update both `popup/` and
  `options/` UIs when adding one.

## Verifying changes

- No build step: load `manifest.json` via
  `about:debugging#/runtime/this-firefox` → "Load Temporary Add-on…" in
  Firefox, then reload the extension after edits.
- There is no automated test suite; verify manually on `reddit.com` (and a
  couple of generic sites for the non-Reddit readability features).
  
## Workflow

### Before Starting

1. `git status -sb` — note unrelated changes and leave them alone.

### During Work

- Keep changes scoped to one logical unit (one doc, one phase milestone).

### After Changes (before claiming done)

- Run the tests, linter, typecheck
- **Commit immediately** when the logical unit is complete and validation passes.


### Git Discipline

Explicit, auto-commit-after-validation. Many small, atomic, working-state commits with clear provenance — not fewer larger ones.

### Commit Mechanics (hard rules)

- **Never** use `git add .`, `git add -A`, or `git commit -a`.
- **Never** revert, checkout, or restore files you did not modify for the current task.
- **Always** stage files explicitly: `git add <path1> <path2> …`.
- **Always** verify before committing:
  ```bash
  git status -sb
  git diff --staged --name-only
  git diff --staged
  ```
- If unrelated changes or staged files you didn't create exist, leave them alone — another agent or the human owns them.

### Commit Messages

```
type: short summary (imperative, ≤ 72 chars)

- Non-obvious context
```

Prefixes: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, `perf:`. **No bylines** — no `Co-authored-by`, no agent attribution, no generated-by footers.

### Never Committed

- Compiled files, dumps, logs
- Local env / secrets

### Never Discard Others' Work

Do not run `git restore`, `git checkout --`, `git reset --hard`, `git clean -fd`, `rm -rf` across tracked paths, or bulk rewrites (aggressive formatters, mass import reordering) unless the user explicitly asks.


