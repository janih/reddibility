# AGENTS.md

## Project

Reddibility is a Firefox extension (Manifest V3) that improves readability of
Reddit's new layout — hiding ads/promoted posts, decluttering sidebars,
widen content, and applying themes & typography — plus general readability
features (themes, fonts, spacing) intended to work on any website over time.

The project was renamed GoodReddit → Reddibility. The storage key moved to
"reddibility" (with a one-time migration from the old "goodreadability" key
in `lib/shared.js`'s `load()`), and the extension id is now
`reddibility@local.extension`. The internal `GR` global and `gr-*` class
prefixes predate the rename and are intentionally kept — renaming them
would churn every CSS selector and test for no user-visible benefit.

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

- The captures are **local-only reference data**: the `reddit/` folder is
  gitignored and never committed (large page snapshots with bundled assets,
  not meant for publication). The capture regression tests
  (`test/reddit-selectors.test.js`) auto-skip when the folder is absent,
  e.g. on a fresh clone or CI. Keep your local copy around.
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

## Hide avatars (blank placeholder)

- New opt-in setting `reddit.hideAvatars` (toggle: "Hide avatars (blank
  placeholder)", off by default) hides the post/comment author headshot
  image and leaves a plain, neutral circle in its place instead of removing
  the element entirely (which would collapse the layout).
- Confirmed against the `reddit/post_with_media/` capture: every author
  headshot — on post credit bars and comment author lines alike — lives
  inside a `<span rpl avatar="">` wrapper (e.g. reached via
  `<faceplate-tracker noun="comment_author_avatar">` > `<a>` >
  `span[avatar]`). As previously noted (see the click-to-load media
  section), a bare `[avatar]` selector is too broad: `<shreddit-comment>`
  itself also carries an `avatar="<url>"` attribute holding the profile
  picture URL, so `span[avatar]` is used instead to target only the actual
  avatar-icon wrapper.
- The visible headshot inside that wrapper is rendered either as a plain
  `<img>` (most avatars) or, for "snoovatar" users, an `<svg>` containing an
  `<image>` — `content/reddit.css` hides both (`span[avatar] img`,
  `span[avatar] svg`) behind the new `gr-rd-noavatars` class so either case
  is covered.
- `span[avatar]`'s own box already carries fixed width/height (Tailwind
  `w-xl`/`h-xl`/`min-w-*`/`min-h-*` etc.) and `rounded-full` styling, so
  hiding just the inner image/svg leaves the box's size and shape intact —
  it's given a neutral `background-color` (mixed from the active theme's
  `--gr-text`/`--gr-bg`, same `color-mix()` pattern used elsewhere) so it
  reads as an intentional blank placeholder circle rather than an empty
   gap or invisible hole.
- No `content.js` DOM injection or teardown logic was needed beyond adding
  `gr-rd-noavatars` to `RD_CLASSES` and toggling it from
  `rd.hideAvatars` in `applyReddit` — this is a pure CSS gate, unlike the
  media/top-bar features.
- Follow-up report: some hidden avatars kept a colorful gradient background
  instead of the flat neutral placeholder. Root cause: "snoovatar" avatars
  wrap their `<svg>` in a nested span carrying Tailwind's
  `bg-[image:var(--color-avatar-gradient)]` class — a real `background-
  image` independent of the already-hidden `img`/`svg`. Fixed by forcing
  `background-image: none`/`background-color: transparent` on every
  descendant of `span[avatar]`, so only the single `color-mix()` background
  on the outer wrapper remains visible for every avatar type.
- Follow-up report: the subreddit icon image (confirmed against the
  `reddit/subreddit/` capture: `<span rpl avatar="" id="subreddit-icon-img">`
  /`id="subreddit-icon-img-desktop">`, wrapping an inner
  `img.shreddit-subreddit-icon__icon`) was rendering underneath/overlapping
  the subreddit name whenever "Hide avatars" was enabled. Root cause: the
  subreddit icon wrapper *also* carries the same `avatar=""` attribute used
  by real post/comment author avatars, so the bare `span[avatar]` selector
  matched it too, hiding its `img` and painting the neutral placeholder
  circle over it. Fixed by scoping all three `gr-rd-noavatars` rules to
  `span[avatar]:not([id^="subreddit-icon-img"])`, which covers both the
  mobile (`subreddit-icon-img`) and desktop (`subreddit-icon-img-desktop`)
  variants and leaves the subreddit icon fully visible while still hiding
  real author avatars.

## Vote button / comment action bar / share button always-black gotcha

- `rpl-vote-button-group`, `comments-action-button`, and
  `shreddit-post-share-button` aren't present in any current `reddit/`
  capture (they're part of a newer Reddit UI change, not yet re-captured),
  but were reported always rendering with a black background regardless of
  the selected Reddibility theme.
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
- Even with the corrected selectors, the setting still had no visible
  effect — because the fix so far only lived in `content/reddit.css`, a
  stylesheet injected into the main document, and **CSS selectors cannot
  cross shadow DOM boundaries**. A fresh devtools-copied snippet of the
  action row (supplied directly by the user) contains literal `<slot>`
  elements (e.g. `<slot name="share-button"> <shreddit-post-share-button
  ...> </slot>`) — `<slot>` only ever exists inside a shadow root template,
  which proves this entire vote/comment/share action row is rendered
  inside an **open shadow root** (most likely owned by `shreddit-post` or
  a similar wrapper custom element). That's also why none of this markup
  ever shows up in any static `reddit/` capture: Firefox's "Save Page As"
  only serializes light DOM, never the contents of a JS-attached shadow
  root.
- Fixed by adding shadow-DOM-aware JS in `content/content.js` instead of
  relying on document-level CSS alone: `visitShadowRoot`/
  `scanForShadowRoots`/`startShadowRootScan` recursively discover every
  shadow root on the page (including nested ones), inject a `<style
  id="gr-shadow-btn-style">` directly inside each one with the same
  vote/comments/share selectors and `color-scheme`/`background-color`
  rules, and watch (via per-shadow-root `MutationObserver`s, plus a
  top-level one on `document.documentElement`) for shadow roots attached
  later as Reddit's SPA renders more posts/comments while scrolling.
  `setForceButtonColors(enabled)` ties this into the existing
  `gr-rd-forcebtncolors` toggle: turning the setting off removes the
  injected `<style>` from every previously-seen shadow root instead of
  just leaving stale (or absent) CSS in place. CSS custom properties
  (`--gr-bg`, `--gr-color-scheme`) still inherit across the shadow
  boundary normally, so the injected rule can keep referencing them
  without needing to duplicate their values in JS. The original
  `content/reddit.css` selectors are kept as a harmless fallback in case
  Reddit ever renders this markup in light DOM instead.
- Even after the shadow-DOM-aware fix, the share button ("Jaa"/"Share")
  stayed black — because `shreddit-post-share-button` renders its visible
  `<button class="... button-secondary ...">` inside its **own separate,
  nested shadow root**, distinct from the shadow root that hosts the vote/
  comments action row. Styling only the `shreddit-post-share-button` host
  tag (from the action row's shadow root) never reached that inner button
  in its own nested tree. Confirmed via a devtools-copied snippet of just
  that button (supplied directly by the user): it carries the same
  `button-secondary` class already used by the vote/comment buttons.
  Fixed by adding a generic `.button-secondary` selector (in both
  `content/reddit.css` and the JS-injected `SHADOW_BTN_CSS` in
  `content/content.js`) alongside the more specific selectors — since
  `visitShadowRoot` recursively discovers and styles *every* shadow root
  including nested ones, this reaches the share button's inner button too,
  and is a harmless no-op on shadow roots/elements that don't have that
  class.
- Follow-up report: in Light/Sepia the buttons rendered white text on a
  near-white background. Root cause: the rule only ever forced
  `background-color: var(--gr-bg)`, never a matching `color`, so Reddit's
  own (light-theme-oriented) button text stayed white/illegible once the
  background was pinned to the theme's near-white `--gr-bg`. Fixed (in
  both `content/reddit.css` and the JS-injected `SHADOW_BTN_CSS` in
  `content/content.js`) by also forcing `color: var(--gr-text)`, and by
  mixing a bit of `--gr-text` into the background via
  `color-mix(in srgb, var(--gr-text) 12%, var(--gr-bg))` — the same
  color-mix() pattern already used for the RPL surface tokens above — so
  the button reads as a slightly darker, distinct surface rather than
  blending into the page background.

## Site access permissions model (opt-in non-Reddit hosts)

- The extension's required install-time permissions are deliberately
  minimal: `storage`, `tabs`, `scripting`, and host access to
  `*://*.reddit.com/*` only. Broad host access (`<all_urls>`) is declared
  under `optional_host_permissions` instead of `host_permissions`, so the
  install prompt only mentions Reddit, and AMO review risk stays low.
- The static content script (manifest.json) therefore only matches
  reddit.com. Non-Reddit sites get the content script **dynamically**:
  when the user flips the popup's enable switch on a site without access,
  `GR.ensureSiteAccess(domain)` (lib/shared.js) requests the origin
  permission — `permissions.request` must run inside a user gesture in an
  extension page, which is why the popup (not the background) owns this —
  and on grant registers a per-site content script via
  `scripting.registerContentScripts` (id `gr-site-<domain>`, same
  js/css/runAt as the static Reddit entry, `persistAcrossSessions: true`).
- Both origin pattern forms (`*://domain/*` and `*://*.domain/*`) are
  requested/matched/checked everywhere because engines differ on whether
  `*.example.com` covers the bare host; `GR.hasSiteAccess` probes them
  individually since `permissions.contains` requires ALL listed origins.
- Firefox keeps running a dynamically registered script after its
  permission is revoked (bug 1772698), so revocation MUST be answered with
  an explicit unregister: `GR.reconcileSiteScripts()` (background, on
  `permissions.onAdded`/`onRemoved` and at startup) makes the registered
  set match the granted non-Reddit origins, registering missing and
  unregistering stale scripts. `GR.revokeSiteAccess` (options page's
  per-site "Remove" and "Reset everything") removes the optional origin
  permission and reconciles.
- Alt+R on a non-Reddit site without access just saves the setting; the
  background best-effort calls `browser.action.openPopup()` so the user
  can grant access from the popup (the background can't `permissions.
  request` directly — no user-gesture context).
- `optional_host_permissions` requires Firefox 128+ — that's why
  `strict_min_version` is `128.0` (also the reason `activeTab` was dropped:
  redundant with `tabs` + host permissions, pure permission hygiene).
- The popup shows a hint row (`#site-perm-hint`) when the current site is
  non-Reddit and has no access yet, so the permission prompt isn't a
  surprise.

## Settings copy/merge + tab-delivery gotchas

- `Object.assign` is shallow. Copying settings with it (`emptyState`,
  `load`, `effective`, and every place that seeded a per-domain override:
  popup scope switch, popup `getEditable`, Alt+R toggle, popup Reset)
  used to alias the nested `reddit` object, so per-site edits leaked into
  global settings, and `emptyState()`'s alias of `DEFAULTS.reddit` meant
  options-page edits mutated the shared defaults table itself — "Reset
  everything" returned the mutated values. `lib/shared.js` now deep-copies
  (`cloneSettings`) / deep-merges (`effective`) the `reddit` sub-object;
  all seeding sites go through `GR.effective`, which returns a fully
  detached object. The deep merge also backfills `reddit.*` keys added in
  newer versions for settings saved by older ones (upgrade path), which is
  why feature code can rely on `!!rd.<key>` rather than per-key fallbacks.
- `GR.applyToTab(tabId, settings)` (in `lib/shared.js`, used by
  background, popup, and options) delivers the "apply" message and, when
  the tab has no content script (page predates the extension), falls back
  to `scripting.insertCSS` (`content.css` + `reddit.css`) **before**
  `executeScript` — a JS-only fallback used to toggle `gr-*` classes that
  had no matching rules. Repeated injections are safe because
  `content.js` starts with a `window.__grLoaded` guard (in the content
  script's isolated world, shared between injections of the same
  extension, invisible to page code; skipped under Node where `module` is
  defined so tests can `require()` repeatedly).
- `GR.updateBadge(tabId, enabled)` (also `lib/shared.js`; no-op without
  `browser.action`) is called from background, popup, and options — the
  badge used to go stale when toggling from anywhere other than Alt+R or
  a page load.
- The shadow-DOM scan keeps a `Set` of seen roots plus a `Map` of their
  observers. Reddit virtualizes its feeds, so scrolled-past posts leave
  detached shadow roots; without pruning these were strong references
  with live observers, growing memory without bound. `pruneShadowRoots()`
  (throttled from the top-level observer callback) forgets roots whose
  host is disconnected — they self-heal via `visitShadowRoot` if Reddit
  re-attaches them. `setForceButtonColors(false)` tears the whole scan
  down (observers disconnected, sets cleared); re-enabling rescans from
  scratch. The media observer is likewise disconnected whenever
  click-to-load is off.
- Content scripts run at `document_start` (manifest.json) so the theme
  classes/variables land before first paint; the code already guards for
  `document.head`/`document.body` not existing yet (style/toggler attach
  to `document.documentElement` as a fallback).

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

- No build step for the extension itself: load `manifest.json` via
  `about:debugging#/runtime/this-firefox` → "Load Temporary Add-on…" in
  Firefox, then reload the extension after edits.
- There's still no automated way to verify visual behavior; manually check
  `reddit.com` (and a couple of generic sites for the non-Reddit
  readability features) after any change that affects layout/appearance.
  Note the opt-in model when testing non-Reddit sites: enabling from the
  popup triggers Firefox's site-permission prompt once per site (see
  "Site access permissions model" above).
- There **is** now an automated test suite (`npm test`, via Vitest +
  jsdom — see `package.json`/`vitest.config.js`) covering everything that's
  practical to test without a real browser: run it after any change to
  `lib/shared.js` or `content/content.js`, and add/update tests alongside
  those changes. See "Automated tests" below for what's covered and how to
  extend it.

## Automated tests

- `npm install` once, then `npm test` runs the full suite (Vitest, jsdom
  environment) under `test/`. There's no CI wired up yet — this is a local,
  on-demand suite.
- `lib/shared.js` and `content/content.js` are plain (non-ESM) scripts,
  written for direct `<script>` inclusion in the extension (see
  `manifest.json`'s `content_scripts`). Each now ends with a
  `if (typeof module !== "undefined" && module.exports) { module.exports =
  ...; }` guard so Node/Vitest can `require()` them directly (exposing `GR`
  and, for `content.js`, its internal functions for testing) — this is a
  no-op in the real browser context, where `module` is never defined.
  Similarly, `content.js`'s real auto-init call (`browser.runtime.
  onMessage.addListener(...)` + `init()`) is now guarded behind `typeof
  browser !== "undefined"`, so requiring the file under Node never touches
  the real `browser` extension API or tries to auto-run against a bare
  jsdom document unless a test explicitly stubs `global.browser`.
- `test/shared.test.js` — unit tests for `lib/shared.js`'s pure(ish)
  functions: `getDomain`, `emptyState`, `effective` (including per-domain
  override merging, the deep-copy/no-aliasing behavior of the nested
  `reddit` object, and default backfill for stale overrides), `formatValue`,
  `ensureReddit`, `resolveUiMode`, the `THEMES` table's `scheme` field,
  `load`/`save` (with `browser.storage.local` stubbed via `vi.fn()`), plus
  `applyToTab` (direct send vs. CSS+JS fallback injection) and
  `updateBadge`. Several of these functions are exactly where this project
  has previously introduced subtle regressions (e.g. per-domain merge
  behavior, theme `scheme` defaults, settings aliasing).
- `test/content.test.js` — DOM tests (via Vitest's jsdom environment) for
  `content/content.js`: `buildCSS`'s generated custom properties (including
  corrupted-value fallbacks), `isReddit`, `applyReddit`'s `gr-rd-*` class
  toggling for every `reddit.*` setting (including the enabled/disabled and
  non-Reddit-domain no-op cases), the click-to-load media placeholder
  lifecycle (`ensureMediaPlaceholder`/`scanForGatedMedia`/
  `teardownMediaPlaceholders`, including the figure.rte-media-vs-avatar
  distinction), and the shadow-DOM button theming
  (`visitShadowRoot`/`setForceButtonColors`, including nested shadow roots
  like the share button's own, detached-root pruning, and the
  disable/re-enable rescan). Each test calls a small `loadContentModule()`
  helper that stubs `global.GR`/`global.location` and evicts `content.js`
  from Node's own `require.cache` (NOT the same cache Vitest's
  `vi.resetModules()` manages, since this file is loaded via `require()`
  rather than `import`) so every test starts from clean module-level state
  (`shadowRootsSeen`, `forceButtonColorsEnabled`, etc.).
- `test/reddit-selectors.test.js` — regression tests that load the real
  `reddit/**/*.html` captures (local-only, see "Working with the `reddit/`
  reference captures" above — the suite auto-skips without them) into jsdom
  and assert that the selectors `content/
  reddit.css`/`content.js` rely on (`.right-rail-popular-communities`,
  `#subreddit-right-rail__partial`, `pdp-back-button` + its avatar sibling,
  `reddit-header-large`, `figure.rte-media`, the per-post join button,
  etc.) still match real elements — this directly guards against the
  "selector silently stopped matching after a Reddit redesign" failure mode
  that has bitten this project repeatedly. Two jsdom gotchas worth knowing
  if you touch this file: (1) each `JSDOM(html, ...)` call needs an
  explicit `url` option (a real URL, not the default `about:blank`) —
  without it, jsdom's default opaque origin can make later, unrelated
  `localStorage` access throw `SecurityError: localStorage is not
  available for opaque origins`, surfacing as a confusing failure in a
  *different* test; (2) a `VirtualConsole` with silenced `error`/`warn`
  handlers is used to suppress harmless "Could not parse CSS stylesheet"
  noise from jsdom trying (and failing) to parse Reddit's inlined Tailwind
  `<style>` blocks, which use arbitrary-value class names jsdom's CSS
  parser chokes on. Also note: a `<shreddit-comment>` element itself
  carries an `avatar="<url>"` attribute (the profile picture URL) — a bare
  `[avatar]` selector matches every comment as an ancestor, so tests that
  care about the actual avatar-*icon* wrapper must use the more specific
  `span[avatar]` instead.
  
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


