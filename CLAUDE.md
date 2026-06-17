# CinemaTracker — Codebase Guide

A single-page web app for tracking movies watched, ratings, lists, social feed,
data dashboards, AI recommendations, achievements, and custom themes. Vanilla
JS + HTML + CSS on the front end; **Supabase** (Postgres + Auth + Storage + Edge
Functions) on the back end. No build step, no framework, no bundler.

## 📌 KEEP THIS FILE CURRENT (do this every time)

**Whenever you add/remove/rename/move a file, feature, page, or notable function,
update this `CLAUDE.md` in the same change** so the file map, function list, and
script-load order below stay accurate. Treat updating this guide as part of the
task, not an optional extra. Specifically:
- New `assets/js/*.js` file → add it to the **File structure**, the **JS file map**
  table, and add its `<script src>` tag to `index.html` in the correct order.
- New/removed/renamed function → update the affected row in the JS file map.
- New page/route → note it under `02-router.js`.
- New back-end dependency (edge function / SQL / RPC) → update the **Back end**
  section.
After structural edits, you can regenerate the function inventory with:
`grep -rnE "^        (async function|function|class) " assets/js/`

## ⚠️ Critical constraints — read before editing JS

The front end was refactored from one giant `index.html` into many files, but it
is **NOT modular**. All the `assets/js/*.js` files are loaded as ordinary
(classic) `<script>` tags, in numeric order, at the end of `<body>` in
`index.html`. They all share **one single global scope**. This has hard rules:

1. **Load order matters.** The `<script src=...>` tags in `index.html` are
   ordered `01` → `19` and must stay that way. `01-config.js` defines globals
   (`supabaseClient`, `icons`, `COL_WATCH_DATE`) that everything else depends on;
   `19-logging-boot.js` runs the boot sequence (`DOMContentLoaded`, etc.) and
   must stay last.
2. **No `import`/`export`, no `type="module"`.** Adding modules would break the
   shared-scope model and every inline `onclick="..."` handler.
3. **Functions are global by design.** The HTML markup in `index.html` calls them
   inline (e.g. `onclick="router.navigate('home')"`, `onclick="openAuthModal()"`).
   A function defined in any file is callable from any other file and from inline
   handlers. Do not wrap files in IIFEs or change a top-level `function`/`const`
   to something scoped.
4. **A function can live in a different file than where it's used.** Files were
   split by original source order, not perfectly by domain. If you can't find a
   function, grep all of `assets/js/`:
   `grep -rn "functionName" assets/js/`
5. **Don't assume a file is self-contained.** Cross-file calls are everywhere
   (e.g. dashboard code calls theme/auth helpers).

If you ever need to recombine or re-split, the untouched pre-refactor originals
are in `_original_backup/` (`index.html.bak`, `reset-password.html.bak`).

## File structure

```
index.html                     HTML markup only; <link> to CSS + ordered <script src> tags.
                               Includes the top `.navbar` (desktop nav + the now
                               mobile-hidden hamburger/`#mobile-menu`) AND the mobile-only
                               `#mobile-tabbar` bottom tab bar (Home/Feed/My Movies/Lists/More)
                               + the `#more-sheet-overlay` "More" bottom sheet (AI Picks,
                               Data Dash, Achievements, Account, auth). Tab bar + sheet are
                               styled mobile-only (≤768px) in styles.css. On mobile the top
                               nav bar keeps the compact **logo** on the left (the
                               "CinemaTracker" wordmark `.nav-brand-text` is hidden) followed by
                               `#mobile-page-title` — a dynamic header showing the current page
                               name (set in `router.navigate` from a page→title map); the
                               account/avatar button stays on the right for all pages — its avatar
                               (rendered at 60px) is forced to fill the 34px icon button so it
                               doesn't overflow. Mobile header sizing is unified across ALL
                               widths (incl. ≤520 + Home): `--header-height` 64px, logo 46px,
                               avatar button 34px. Also holds `#ptr-indicator`, the
                               pull-to-refresh spinner.
reset-password.html            Standalone password-reset page (Supabase recovery flow)
assets/css/styles.css          All app styles (~3,400 lines)
assets/css/reset-password.css  Styles for reset-password page
assets/js/01..19-*.js          App logic (see map below)
assets/js/reset-password.js    Logic for reset-password page
manifest.webmanifest           PWA manifest (installable web app; name/icons/colors)
service-worker.js              PWA service worker — push notifications + NETWORK-FIRST
                               fetch (always loads latest deploy, cache only as offline
                               fallback) + on-activate it messages clients to reload onto
                               the new version (installed PWA auto-updates, no reinstall).
                               Bump CACHE_VERSION to force. Registered in 19-logging-boot.js.
                               `push` handler sets the iOS app-icon badge from the payload's
                               numeric `badge`; `notificationclick` focuses an open client +
                               posts `NOTIFICATION_NAV` (or opens at the #hash) so the app
                               routes to Feed/Recs and clears the badge.
assets/icons/                  PWA icons (icon.svg source + generated PNGs:
                               icon-192/512, icon-maskable-512, apple-touch-icon 180)
_original_backup/              Byte-identical pre-refactor originals (safety net)
.github/workflows/refresh-imdb.yml  Daily GitHub Actions cron → calls the swift-api
                               `refresh_imdb_ratings` Edge action (keeps IMDb ratings fresh)
```

PWA install (iPhone): `index.html` `<head>` has the `apple-mobile-web-app-*` meta
tags + `apple-touch-icon` + `<link rel="manifest">`, so Safari → Share → Add to
Home Screen launches it full-screen. Push notifications need this install (iOS
16.4+). Test button on the Account page (`enableNotificationsTest` in
`18-account-page.js`) fires a LOCAL notification to verify display; real remote
push (VAPID keys + subscription table + edge-function send) is not built yet.

The refactor was verified byte-for-byte: concatenating the split files
reproduces the originals exactly. No logic was changed.

## JS file map (where to look for what)

| File | Domain |
|------|--------|
| `01-config.js` | Supabase client init (`SUPABASE_URL`/`SUPABASE_KEY`), `icons` SVG map, `COL_WATCH_DATE`, nav logo loading |
| `02-router.js` | The `router` object — **all page view HTML templates** (home, feed, library, lists, ai_picks, dashboard, account, **achievements**) live here as template strings. Largest file; one big object literal. The **Achievements** view is its own gated route (`renderAchievements`, reached from the Account page's "Achievements" card / `open_achievements`) so the long badge list no longer clutters the Account page; it reuses the same DOM ids + shared handlers as the old inline panel (loaded by `loadAchievementsPage` in `18-account-page.js`). Its header controls are two buttons — **Filter** (`#account-achievement-filter-btn`) + **Sort** (`#account-achievement-sort-btn`) — that share ONE popover (`#account-achievement-filters-pop`); `setAchievementFiltersOpen(isOpen, mode)` shows only the `[data-af="sort"]` or `[data-af="filter"]` row (state in `achievementFiltersMode`). The old single "Sort/Filter" button + the "Back" button were removed. |
| `03-home-dashboard-core.js` | `loadDashboard`, dashboard data helpers (`dash*` formatting/poster/person), feed/library/lists auth warnings |
| `04-lists.js` | Lists feature: state, create/rename/delete modals, sort+filter modal, add-to-list, bucket list, `initListsPage`, `loadListsPage`. **Perf:** `loadListsPage` reads the **`user_list_items_v1` SQL view** (`LIST_ITEMS_VIEW`, see `lists_views.sql`) in ONE query — all movie metadata (genre/IMDb/director/runtime/MPA/actors + the user's own rating + watch info) is pre-joined in the DB, replacing the old per-movie live TMDB calls that made this page slow / sometimes never load. Recs recommender avatars + watch platforms remain separate single batched queries. **Movie Recommendations** modal (`openRecModal`/`openRecModalFromHome`/`sendRecommendation`): pick people you follow → `send_recommendation` Edge action adds the movie to each recipient's auto "Recs" list + sends a web push. Recs cards show recommender avatar(s) + a "+" that opens `openRecByModal` (all recommenders); send blocks recipients who already saw the movie or were already recommended it. In the modal, followers who have **already seen** the movie are greyed out + un-checkable with an "Already seen this" note and a **"View review"** button (`openRecReviewModal`) that shows their rating/review in the `#rec-review-overlay` modal (seen-status computed in `loadRecRecipients` by reading their `Movie Ratings` for the resolved movie id). Followers you've **already recommended** this movie to are likewise greyed out + un-checkable ("Already recommended", `recAlreadyRecByUserId` from reading your own `Recommendations` rows). The recommendation log is the source of truth for "pending rec": when a recipient **removes** the movie from their Recs list without watching it, `clearReceivedRecommendations` deletes the `Recommendations` rows (needs the recipient-DELETE RLS policy in `recommendations_tracking.sql`) so a sender can recommend it again; watched movies stay blocked by the seen-check. New recs glow (`.is-new`) until the Recs list is viewed. **"Recs" is the default list shown when opening the Lists tab** (falls back to Bucket List / first list). When the active list is **Recs**, the manual "Add movies" search bar (`.lists-add-search`, hidden in `setListsQuickAddEnabledState`) and the **Watch Count Range** filter (`#lists-watch-count-range`, hidden in `configureListsSortFilterModalForActiveList`) are hidden (Recs is auto-managed + unwatched). List posters **hover-flip** to a details back face (Director/Runtime/MPA/Genre/IMDb) reusing the My Movies `.library-poster-flip*` classes. On the **Recs** list, tapping a poster opens the **Recs viewer** (`openRecsMovieModal` → `#recs-movie-overlay`) instead of the log form: if anyone you know (the recommender(s) + people you follow) has rated the movie it shows a choice screen — **Movie Details** (genre/MPA/runtime/year/director/IMDb), **User Reviews** (their feed-style review, one reviewer = straight to it), and/or **Watch Options** (`recsMovieRenderWatchOptions` — the streaming platforms, from `recsViewPlatforms`/`listsPlatformsByMovieId`); the choice screen now appears when there are reviewers OR platforms, else it goes straight to Movie Details. Reviewer rating rows are read from `Movie Ratings` for the candidate user ids. The old per-card **"Watch Options" button was removed** (its platforms list moved into this viewer), as were the per-card IMDb/runtime subtext lines (shown under Movie Details instead); the recommender avatar on each card is slightly larger. (The standalone `openListsWatchOptionsModal`/`#lists-watch-options-overlay` are now unused/dead.) Logging/rating a movie auto-removes it from the user's **Bucket List + Recs** via `removeMovieFromAutoLists` (called from the diary save). **Lists overview (Spotify-style):** the Lists page now opens to a **cover grid of all lists** (`#lists-overview` / `loadListsOverview`, 3-up on mobile, auto-fill on desktop) instead of a text dropdown; each card's art (`renderListCoverArt`) is: the list's saved `cover` image (an inline data URL — including the **branded covers the DB stores for the auto-managed Recs / Bucket List**, see `lists_branded_covers.sql`; this replaced the old front-end `specialListCoverUrl` that forced large local PNGs and lagged behind normal covers), else a 2×2/strip **collage of its movie posters**, else a colored fallback tile (`icons.star` for Recs, `icons.film` otherwise). The Recs / Bucket List covers are still **non-editable** (the Edit modal hides cover upload + "Remove photo" for them via `isSpecialAutoList`). Tapping a card → `openListFromOverview(id)` switches to the **detail view** (`#lists-detail` — the existing per-list movie layout, now with an `← All Lists` back button → `showListsOverview`). The overview orders **Recs first, then Bucket List, then the rest**. The **Recs cover shows an unseen-recs badge** in its top-right corner (`#lists-cover-badge-recs`, `.lists-cover-badge`) — `setNavBadge('nav-badge-lists', …)` in `05-feed-library.js` updates it as another twin of the nav/tab-bar Lists badge, and `loadListsOverview` calls `refreshNavBadges()` after render to reconcile it. `enterListsPage` (called from `router.navigate`) shows the overview by default but opens a list directly on deep-link (`listsPendingSelectName`, e.g. "Recs" from a push). Per-list **cover upload** (the old per-card pencil overlay was removed — covers are now changed only from inside a list via the Edit modal): `triggerListCoverPick` → shared hidden `#lists-cover-input` → `handleListCoverPick` center-crops/downscales the photo to a ~320px JPEG **data URL** via the shared `processAccountIconFile` and saves it to `Lists.cover` (needs `lists_cover_column.sql`). The old `#lists-select` dropdown is kept hidden (still drives `loadListsPage`). `listsViewMode` ('overview'|'detail') gates which panel shows. **New List / Add Movie** — the action is the same everywhere (Create List on the overview = `openListsCreateModal`; **Add-Movie modal** inside a list = `#lists-add-overlay` / `openListsAddModal`, a Home-style search `#lists-movie-search-input` → `handleListsAddMovieSearch` with **Year/MPA filters** `applyListsAddFilters` → `listsAddAppliedYear/Mpa` → `callSwiftApiSearchMoviesForLists`; picking a result adds it to the active list), but the **trigger differs by viewport**: **MOBILE** uses a single contextual **`+` FAB** (`#lists-fab` → `listsFabAction`); **DESKTOP** uses clearly-labelled inline buttons — **"New List"** (`#lists-new-list-btn`, in the page header row) on the overview and **"Add Movie"** (`#lists-add-movie-btn`, in the detail toprow) inside a list. Both inline buttons carry the `.lists-desktop-action` class (CSS hides them ≤768px); the FAB is hidden ≥769px (CSS) — so exactly one control shows per viewport. `updateListsFab()` drives all three: it hides the FAB **and** the "Add Movie" button inside the auto-managed **Recs** list (no manual adds), shows "New List" only on the overview, and "Add Movie" only inside a non-Recs list. The FAB lives at **body level in `index.html`** (NOT inside `#app-root`, because the page wrapper `.fade-in` keeps a `transform` via `animation-fill-mode: forwards`, which would make a `fixed` child anchor to the page box instead of the viewport — that bug put it mid-screen). It's fixed bottom-right (above content + the tab bar, z-index 120), shown only on the Lists page via `setListsFabVisible()` + a `body:not([data-page="lists"]) #lists-fab { display:none }` gate. **Refresh** was removed in favor of **pull-to-refresh** (the Lists overview opts into `pullToRefreshAction`/`pageSupportsPullToRefresh` in `09-home-ui.js`). The **detail** view's top is a single row: **← All Lists** (back) + **Filter** + **Sort** + **Edit** + (desktop) **Add Movie** (heading sits below). Filter+Sort open the shared `#lists-sortfilter-overlay` showing only the `[data-sf=filters]` or `[data-sf=sort]` section (`openListsSortFilterModal(mode)`, mirrors My Movies); **Edit** (`openListsEditModal`) opens the combined edit modal (the old "Rename List" overlay, now "Edit List") = change/remove **cover photo** (a large centered preview with a small camera upload button `#lists-edit-cover-upload`; the upload button + "Remove photo" are hidden for **Recs**/**Bucket List** since they use the fixed branded cover) + **rename** + **delete** (the latter two hidden for the auto-managed **Recs**/**Bucket List** via `isSpecialAutoList`, which also can't be renamed/deleted). The modal has **one Save button** (`submitListsEditModal` → saves the name via the rename form if changed, else just closes; cover changes persist immediately on pick). Delete still routes through the existing `#lists-delete-overlay` confirm (`openListsDeleteFromEdit`). |
| `05-feed-library.js` | "My Movies" library (render/filter/sort/paginate, Edit/Delete/Recommend buttons; **tapping a grid poster opens `openLibraryMovieModal` — full diary entry: ratings, sub-ratings, watch info, quote, notes + Edit/Delete/Recommend — via the `#library-movie-overlay` modal**; `openLibraryMovieModal` self-fetches the row from `LIBRARY_ITEMS_VIEW` if it's not in the `libraryItems` cache, so it also works when opened from the **Data Dashboard**) AND social Feed (following, user search — by **username OR email** via the `search_users` RPC (`search_users.sql`), with a username-only client-query fallback; feed items grouped by movie and ordered by **`Movie Ratings.updated_at` desc** — most-recently added/edited reviews first, not watch date — in the normal feed via `loadFeedItems` (the "in common" mode still uses Watch Logs); Filter modal: per-follow checkboxes + Compare Own + **"Only show movies in common"** = keep only movies watched by 2+ of the shown users, `feedInCommonOnly`; this mode loads watch logs 1000 at a time with a **"Load More"** button (`renderFeedInCommonLoadMore`, `loadFeedItems({appendInCommon:true})`) so older overlaps aren't cut off). Also the **nav notification badges** (`refreshNavBadges`/`markFeedSeen`/`markRecsSeen`): red count on the Feed nav button = new follow ratings since last view, on the Lists button = new recs received; last-seen times are **cross-device**: the authoritative value lives in `Users.feed_seen_at`/`recs_seen_at` (read via `loadSeenTimesFromDb`), with `localStorage` only a per-device cache; `effectiveSeen` uses the LATER of the two so a badge cleared on one device reads cleared on another (badges also re-check on tab focus/`visibilitychange`). New/updated feed cards from **other** users glow in the **theme's primary color** (`.is-new`, `var(--brand)`) — never your own; a NEW entry for a movie **you recommended to that person** glows in the **theme's secondary accent** (`.is-new-rec`, `var(--brand-2)`, distinct from `.is-new`, via `myRecSentPairs` from the `Recommendations` table). Also the **user profile overview modal** (`openUserProfile`): click a user in the Feed → KPIs (movies watched, avg overall, highest-rated director) + Recent/Top-Rated poster grid, computed client-side and rendered with the Data Dash helpers (`dashRenderHelpScore`/`dashRenderHelpTier`/`dashBuildPosterUrl`/`.dash-fav-grid`) for an exact visual match. When viewing **someone else's** profile it also shows a **Taste Match** card: a compatibility % based on the **Pearson correlation** of your overall ratings across movies you've both rated (mapped `(r+1)/2 → 0–100%`, so it measures how similarly you RANK films, immune to harsh/generous-rater offset — a random pair ≈ 50%), with **confidence shrinkage toward 50%** by shared-movie count (`(n·raw + 4·50)/(n+4)`) and a fallback to the simple `100 − avg gap` closeness when there are <3 shared movies or no rating spread to correlate + count in common + the 3 biggest disagreements (computed in `openUserProfile`, rendered via `renderProfileBody`'s `compat`). In **Biggest disagreements** each row shows two clickable chips: **You — N Overall** (the score is colored by YOUR tier for that movie, tap → `openLibraryMovieModal`) and **@them — N Overall** (score colored by THEIR tier, tap → `openProfileMovieReview(userId, movieId)` which shows that user's full diary entry for the movie in the **exact same Diary Entry modal** (`#library-movie-overlay`) as your own — both `openLibraryMovieModal` and `openProfileMovieReview` build the body via the shared `renderLibraryDiaryBody(it, {showActions})` helper off a flattened `LIBRARY_ITEMS_VIEW` row (`openProfileMovieReview` reads the other user's view row by `user_id`+`movie_id`, sets the header to "Name's Review", passes `showActions:false`, and bumps the overlay z-index above the profile modal); the "N% apart" label is forced white. The profile poster cards title-line is **"Title (Year)"** with the score/tier on the line below. |
| `06-dashboard-controls.js` | Data Dash UI: KPI clicks, tab/timeframe/metric controls, chart control wiring, `setDashboardTab`, favorites. Clicking any movie poster (`[data-dash-movie-id]`) opens the **My Movies diary popup** (`openLibraryMovieModal`, with `initLibraryPage()` first so its Edit/Delete/Recommend handlers are bound) — NOT the Update Ratings form. **Favorites tab posters** show a circular rank badge (`.dash-fav-rank`, styled in styles.css) in the top-left corner — `#1`, `#2`, … (`idx + 1` within each Top/Bottom row) — and the Favorites grid is **3-up on mobile** (base `.dash-fav-grid` = 3 cols). `setDashboardTab` also calls `dashCenterActivePill()` (defined in `09`) to keep the active pill centered in the **mobile sticky tab indicator** (see the mobile Data Dash overhaul note on `09`). |
| `07-dashboard-charts.js` | Data Dash rendering: `loadDashboardCharts/Ratings/General/Tiers/QuoteWall`, pie/bar/donut chart drawing |
| `08-search-trending.js` | TMDB-backed movie search + trending (`callSwiftApi*`), home search results, lists quick-add search |
| `09-home-ui.js` | Home page UI helpers, search filters panel, duplicate-rating modal, `handleSearch`, `toggleMobileMenu`, `escapeHtml`. Also the **mobile bottom-tab-bar "More" sheet** (`openMoreSheet`/`closeMoreSheet` toggle `#more-sheet-overlay.open`). The tab bar's **active state is pure CSS** (`body[data-page=...]` selectors in styles.css — `router.navigate` already sets `document.body.dataset.page`, so no JS wiring). Feed/Lists tab badges reuse `setNavBadge` in `05-feed-library.js`, which now mirrors counts to the `-t` (tab-bar) twin ids alongside the existing `-m` (mobile-menu) twins. The "More" auth row (`#more-auth-btn`) label is kept in sync wherever `#mobile-auth-btn` is (`14-themes.js` `refreshAuthStateAndUI`, `13-auth-guest.js` enter/exit guest). The 4 primary tabs call **`tabNav(page)`** (not `router.navigate` directly): light haptic (`navigator.vibrate`, no-op on iOS) + tapping the tab you're already on smooth-scrolls to top instead of re-rendering. **Native-feel helpers** (all here, all mobile-gated via `isMobileViewport()`): `animatePageEnter(root)` — Phase 2 page transition, called by `router.navigate` right after it grabs `#app-root`, toggles the `.page-enter` class (CSS `@keyframes pageEnter` fade+slide, removed on `animationend` so no transform lingers to trap fixed overlays; respects `prefers-reduced-motion`); `skeletonRows`/`skeletonPosters`/`loadingPlaceholder(kind)` — Phase 4 loading skeletons (`'rows'` = library/feed stacked cards, `'posters'` = lists poster grid) injected in place of the old "Loading…" text **only on mobile** (desktop keeps the text) by `loadLibraryPage`/`loadFeedItems` (`05`) + `loadListsPage` (`04`). **Mobile CSS (Phases 1/2/4):** styles.css also has the global "kill browser tells" block (`overscroll-behavior:none`, no tap-highlight, no iOS callout on chrome/posters), the **full-bleed mobile container** rules (≤768px, scoped to `#app-root`: zero `.container` side padding, slim `.glass-panel` horizontal padding, direct-child `.glass-panel > .glass-panel` flatten so there's no container-in-container), the `.page-enter` transition, `:active` press-feedback scale on tappables, and the `.skel*` shimmer skeleton styles. **Phase 3 — bottom-sheet modals:** because the whole app shares the `.auth-overlay > .auth-modal` modal pattern, ONE gated CSS block (keyed on `body.app-sheets`, set on the `<body>` tag in index.html) docks every modal to the bottom of the screen on mobile as a slide-up sheet with a grab handle (CSS `@keyframes sheetUp`, not a transition, so it animates even though modals open via inline `display:flex`). Two celebration popups (`#achievement-earned-overlay`/`#achievement-detail-overlay`) **and the login/auth modal `#auth-overlay`** are excluded (the three sheet selectors carry `:not(#auth-overlay)`). The auth modal instead uses the compact **top-anchored** mobile styling (`align-items:flex-start`, content-height) so it's smaller and — critically — its top stays reachable when the on-screen keyboard pushes content up (a bottom-docked sheet had its top scrolled off-screen). **To revert bottom sheets, remove the `app-sheets` class from `<body>`** — no other change needed. **Swipe-to-dismiss** (`initSheetSwipeDismiss` IIFE in `09-home-ui.js`, mobile + `app-sheets` only): dragging a sheet down (only when it's scrolled to its top, so internal scroll wins first) translates it with the finger; releasing past ~110px animates it out and closes it (`dismissSheet`), otherwise it snaps back. `findSheet` covers **both** the shared `.auth-overlay > .auth-modal` data modals **and** the bottom-tab **"More" nav sheet** (`.more-sheet-overlay > .more-sheet`, whose visibility is the `.open` class, not `display`). `dismissSheet` closes via the overlay's own backdrop-close handler (`ov.click()` — every overlay closes on a backdrop click) plus a force-hide fallback, but **never inline-hides the More sheet** (it toggles a class; an inline `display:none` would break re-open). **The touchmove listener is non-passive and calls `preventDefault()` while actively dragging a sheet down, so the page/data BEHIND the modal does NOT scroll along with the drag.** `EXCLUDE` skips `auth-overlay` + the two celebration popups (not bottom sheets) + `loading-overlay` (a blocking spinner that must not be swiped away); drags that start on an `input`/`textarea`/`select`/`contenteditable` are ignored. **Equal-size top-row buttons (mobile):** each page's top control group stretches its buttons to equal width — `.library-controls-row` + `.lists-detail-toprow` (existing), plus `.feed-controls-actions` (Feed's Follows/Filter wrapper) and `.achievement-filter-wrap` (Achievements' Filter/Sort), all via `> button { flex: 1 1 0 }`. **Mobile page-layout overhaul:** a ≤768px block (scoped to `#app-root`) flattens the `.page-title-card` header (transparent, no card chrome, smaller `h1`/subtitle), drops the inline 2rem/3rem `.container` top/bottom padding, and tightens the `mb-6` header gap (via `:has(.page-title-card)`, with a `.lists-header-row` fallback) so Feed / My Movies / Lists / AI Picks / Data Dash / Achievements / Log form stop wasting space and read seamlessly. **AI Picks / Data Dash / Achievements fully HIDE their redundant in-page title+subtitle on mobile** (the header bar already names the page) — `body[data-page="dashboard"|"achievements"] #app-root .page-title-card { display:none }` and `body[data-page="ai_picks"] #app-root .container > .glass-panel:first-child { display:none }` (AI Picks' header is a bespoke glass-panel, not a `.page-title-card`); **Account** also hides its `.page-title-card`. **All these selectors stay `#app-root`-scoped on purpose:** an unscoped `…[data-page] .container {…}` rule also matches the fixed navbar's `.container.nav-inner` and shoves the header-bar text down (that bug). The header→first-content top gap is unified to **0.6rem** on every page (`#app-root .container { padding-top: 0.6rem }`). Home is intentionally left alone. **Active-filter highlight:** filter/sort buttons across Feed / My Movies / Lists / Achievements get the vibrant **`.filter-active`** class (solid brand fill + a little white **dot** via `::after`, never see-through) when a filter (or sort) is non-default — the Filter button lights up for active filters, the Sort button for non-default sort. **No see-through buttons:** the button classes are opaque — `--btn-outline-bg` is a solid `#202024`, `.btn-glass`/`.choice-btn`/`.nav-auth-btn` use solid fills, and the inline red "delete"/accent button fills were converted from low-alpha rgba to solid colors. **Pull-to-refresh** (`initPullToRefresh`/`pullToRefreshAction`/`pageSupportsPullToRefresh` in `09-home-ui.js`): drag down at the top of a mobile page to reload it — the page content (`#app-root`) **drags down with the finger** (damped) and snaps back, with the `#ptr-indicator` spinner riding along. Opted in for **Feed** (`loadFeedPage`) + **My Movies** (`loadLibraryPage`); extend by editing those two helpers. **Per-page mobile redesigns (one page at a time):** **Feed** hides its redundant in-page title row (`.feed-title-row`), the "Following Activity"/`#feed-meta` heading (`.feed-activity-heading`), and the **Refresh** button (→ pull-to-refresh); its Filter modal hides grey help text (`.feed-filter-help` + `.feed-filter-toggle-sub`). **My Movies** mirrors it: hides the title row (`.library-title-row`), the "Recent Watches"/`#library-meta` heading (`.library-section-heading`), and **Refresh** (`#library-refresh` → pull-to-refresh), and flattens the wrapper panel (`.library-panel`) so the movie cards aren't a container-in-a-container (keeps the slim full-bleed gutter). The old combined **Filters/Sort** button is split into separate **Filters** and **Sort** buttons (`open_filters`/`open_sort` actions) — both open the one `#library-sortfilter-overlay` modal via `openLibrarySortFilterModal(mode)`, which shows only the `[data-sf="sort"]` or `[data-sf="filters"]` section (state still saves together). The view control is **one button** (`#library-view-toggle-btn`, `toggle_view` action) showing the view you'll switch TO (label flips List View ⇄ Grid View via `syncLibraryViewUI`); it shares **one full-width row** with Filters + Sort (`.library-controls-row`, each `flex:1`). **List view** renders compact **Feed-style cards** (`.library-feed-card`, reusing `.feed-card-row/-poster/-main`) and tapping a card opens the same `openLibraryMovieModal` diary popup (Edit/Delete/Recommend live in the modal); **Grid view** stays the poster grid. `libraryViewMode` ('list' default | 'grid') is honored on mobile (no more forced grid). The website-y **`<footer>`** (copyright + social icons) is fully hidden on mobile. **Lists** mirrors the same pattern: hides the title card + the active-list heading/grey subtitle (`.lists-active-heading`) and flattens the data panel (`.lists-panel`); the New List / list-picker top controls stay. **Identical spacing:** Feed / My Movies / Lists share one mobile rule so the header→buttons gap (`.container` `padding-top`) and the buttons→data gap (the items container `margin-top`) are the same value (0.6rem) on all three, with the wrapping panels adding no extra top padding. **Tab-bar badges:** the Feed/Lists unseen-count badges (`nav-badge-feed-t`/`nav-badge-lists-t`, fed by `setNavBadge`'s `-t` twins) are direct children of their `.tabbar-btn` (class `.tabbar-badge`) positioned at the individual button's top-right corner. **Mobile Data Dash overhaul (swipe + bento):** `initDashSwipeNav` (IIFE here) lets you **swipe left/right anywhere on the Data Dash to move between the six sections** (`general → ratings → tiers → favorites → charts → quotes`, no wrap) by calling `setDashboardTab`; mostly-vertical drags fall through to scrolling and swipes that start inside a horizontally-scrollable child (the Activity chart) are ignored. The six **tab pills become a sticky "dots + centered label" position indicator** at the top (styled in a ≤768px block in styles.css): the active section renders as a highlighted pill showing its name while the other five collapse to small dots (`.btn-outline` → 8px dot via `::before` inside a 24px tap target, `.btn-glass` → labelled pill), the whole cluster centered — e.g. `General • • • • •` / `• • Tiers • • •`. `dashCenterActivePill()` (also here) is a harmless no-op now the row no longer scrolls, but is still called by the swipe handler + `setDashboardTab`. Each pane is reflowed into a **compact bento layout** — General order (via `display:contents` on `.dash-gen-top` + `order`): full-width **share wheel** which on mobile is a **two-view card** (`.dash-general-pie-card[data-pie-view]`): a **Chart/List toggle button** (`#dash-pie-view-toggle`, `initDashboardGeneralPieViewToggle` in `06`) swaps between the **wheel** (default `chart` view, ~200px) and the **legend as a clean full-width list** (`list` view) so they never crowd the card at once (desktop still shows both side by side). The MPA/Decade/Genre legend chips are **borderless/transparent** (no boxed container; only the selected `.is-active` chip keeps a highlight box). **Tapping a wheel slice** (`initDashboardGeneralPieTap` in `06`, via `dashAngleFromEvent`/`dashFindPieIndex`) highlights it and reveals that slice's data in the `#dash-pie-segment-detail` chip (label / share% / count); tapping the chip drills into My Movies filtered by the slice (shared `dashNavigateToPieSegment`, also used by the legend-row clicks). Next is the **watch-method KPI** rendered as a **vibrant brand→accent gradient hero banner** (`.dash-watch-method-card`, big % left + counts right via a 2-col grid, with a soft radial glow `::after`) → the three **Most-Watched** tiles (Director / Movie / Actor as identical clean horizontal list rows: a fixed `--mw-poster-size` (72px) poster flush-left + a left-aligned, vertically-centered text column. Each card's text is wrapped in a `.dash-person-text`/`.dash-most-movie-text` div that is `display:contents` on desktop — so the desktop vertical card is untouched — and becomes a single `flex` column on mobile, which is what makes all three rows align identically rather than drifting to different x-positions; replaced the older `grid-template-areas` approach); Ratings shows highest/lowest director side by side. The mobile control row (`.dash-dashboard-row`) drops the glass-panel card chrome + the "Timeframe"/"Counts"/"Rank by" captions; **Timeframe + Counts become connected iOS-style segmented controls** (`.dash-ctl-pills.dash-seg` — a tinted track of equal connected segments with a gradient-filled active segment, the `dash-seg` class added in the `02-router.js` markup), while **Rank by** (7 options, Favorites tab, `#dash-fav-metric-wrap`) — too many for one row — is laid out on mobile as a **balanced equal-width pill grid** (`flex-wrap` + `justify-content:center`, each pill `flex: 0 0 calc(25% - 6px)`): 4 pills on top, 3 centered below, all the same width and all visible at once (no scroll, no dropdown). The active pill gets the brand→accent gradient fill so it reads as one cohesive surface with the Timeframe/Counts segmented controls. The native dropdowns (`.dash-ctl-select`) stay hidden on mobile. The **Ratings-tab** metric toggle (`#dash-ratings-chart-tab-wrap`) uses the General tab's `.dash-general-pie-toggle` and gets **no special mobile sizing**, so its Genre/Decade/MPA pills render byte-for-byte like the General tab's MPA/Decade/Genre pills (title left, content-width pills in one row right); to keep that single row, the title is shortened to a static **"Avg Rating"** (`dashRatingsChartTitleForTab` in `06`) and the grey meta line (`#dash-ratings-genre-meta`) is hidden on mobile. The **Tiers-tab** poster cards show "Title (Year)" on line 1 and "X% Overall" on line 2 where only the **% is tier-colored** (`.dash-tier-score[data-tier]` reusing the `--tier-*-rgb` vars, like `.dash-tier-pill`) and "Overall" stays white; the tier grid is 3-up on mobile. Mostly CSS (panes get a directional slide-in `.dash-pane-in-left/-right`, `@keyframes dashPaneInLeft/Right`). **One content change (desktop too):** the old **Watch Method stacked-bar chart was replaced by a simple KPI** ("X% — Y of Z watched in theaters") — markup in `02-router.js`'s `renderDashboard` (`.dash-watch-kpi`), populated by `dashSetWatchMethodDisplay` in `07-dashboard-charts.js` (now writes `#dash-general-theater-pct`/`-theater-count`/`-watch-total`/`-home-count` instead of the removed stack bar + at-home/in-theater rows). |
| `10-logging-form.js` | The "log a movie" diary form: watch-method toggle, genre chips, validation, `handleFormSubmit`. **Watch Date / Times Watched / Watch Method are NOT on the main form for new entries** — after the review validates, `handleFormSubmit` opens the post-save **Watch Details** modal (`promptWatchDetails`: when / where / "Was this your first time watching this film?"); answering **"No"** (i.e. NOT first time — internally `watched_before=true`) then opens the **Previous Watches** modal (`promptPriorWatches`) whose own count input drives how many date+method rows appear → bulk `Watch Logs`. ("Yes"/first time skips straight to save.) The **Update Ratings** form no longer shows Date Watched / Times Watched / Watch Method at all (they're set once at first log; adding a watch on update still uses the separate update-watch modals). The **"Movie Details" panel is collapsible** (`toggleSubmitDetails`/`initSubmitDetailsCollapse`, `.submit-details-panel`): the header + poster stay visible; the caret shows an **Expand/Collapse** label (`updateSubmitDetailsToggleLabel`); the metadata fields live in `.submit-details-body` that defaults **open on desktop** and **collapsed on mobile** — except it auto-opens (and red-highlights via `.submit-field-missing` + a "Needs info" badge) when any of Year/MPA/Runtime/Series/Director/Genre is missing (`detailsAnyMissing`, computed in `renderSubmit`). The red highlights **clear live** as each field is filled (`refreshMovieDetailMissingHighlights`); ratings are never highlighted at render — only after a failed save via `blockSubmitWithValidationUI` (which also force-opens the panel). The **Detailed Scoring** number boxes **hard-enforce 0–100 in real time** (`enforceRatingScore` reverts an out-of-range keystroke to the last valid value; `syncScoreFromSlider` mirrors the paired range slider) — `inputmode="numeric"` keypad, `data-last-valid` seeds the initial value. |
| `11-achievements.js` | Achievements + tiers: definitions/loading, popups & animations, rating milestones, admin signup toggle, ratings-success modal |
| `12-watch-modals.js` | Update/delete watch & rating modals, watch-method & prior-watches prompts, the new-entry **Watch Details** prompt (`promptWatchDetails` + `select/submit/closeWatchDetailsModal`), the count-driven **Previous Watches** modal (`promptPriorWatches`/`renderPriorWatchesRows`/`submitPriorWatchesModal`), loading overlay, **DB helpers** (`insertWatchLog*`, `getDbMovieIdByTmdbId`, `callSwiftApi`, `callColorThemeEdge`, etc.) |
| `13-auth-guest.js` | Guest/demo mode (`enterGuestMode`/`exitGuestMode`), `getActiveUserId`, `guardGuestWrite` |
| `14-themes.js` | Theme system: load/apply themes & colors, background images, theme-creator data layer, help/feature popups, `refreshAuthStateAndUI` |
| `15-auth-account-modals.js` | Auth modal (login/signup/logout/forgot-password), account-section modals (`openAccountSectionModal(kind)` for `profile`/`notifications`/`security`/`feature`), username validation. **Signup no longer collects a Display Name** (set null) and the **"Forgot password?" link is hidden in Sign Up mode** (only shown when logging in). `display_name` is no longer editable anywhere in the UI — existing values are left untouched (the column still exists + drives the nav fallback name). On a successful signup it sets `localStorage.ct_prompt_push_signup='1'` so the app prompts to enable push on the first authenticated boot. **Multi-device:** both `signOut()` calls use **`{ scope: 'local' }`** so logging out (or the invalid-token cleanup) on one device never revokes other devices' sessions. NOTE: if logging in on a new device still kicks out other devices, that's the Supabase **dashboard** setting *Authentication → Sessions → "Single session per user"* (server-side; can't be changed in client code — turn it OFF). |
| `16-ai-picks.js` | AI Picks page: filters modal, provider/genre selection, similar-movie search, loading images, `initAiPicksPage` |
| `17-theme-creator.js` | Theme Creator UI (backdrop/AI search, selection, save/delete), `initThemeCreatorPage` (gated to `THEME_CREATOR_OWNER_EMAIL`) |
| `18-account-page.js` | Account page: load/save profile, change password, feature requests, and the **Achievements** page loader (`loadAchievementsPage` — Achievements is now its own route, not inline). **Profile photo** (`handleAccountIconPick`/`handleAccountIconRemove`/`processAccountIconFile`/`setAccountIconPreview`): the Profile modal shows **one large centered avatar** (`.account-icon-wrap` → `#account-icon-preview`) with a small **camera "upload" button** at its corner (`.account-icon-upload`, `data-account-action="pick_icon"`) + hidden `<input type=file accept=image/*>` (camera roll on mobile) — mirrors the Edit-list cover control; the old "Change photo"/"Remove" text buttons were removed (`handleAccountIconRemove` / `remove_icon` still exist but are no longer wired to any button). The chosen image is client-side center-cropped + downscaled to a ~256px square JPEG **data URL** stored directly in `Users.icon` (no Storage bucket — `renderUserIconHtml`/`isUserIconUrl` in `15-auth-account-modals.js` already render `data:`/`http` icons); on change it updates `Users.icon`, the cached nav avatar (`cachedUserIcon`), and calls `refreshAuthStateAndUI`. **Web Push** opt-in (`savePushSetting`/`enablePushOnThisDevice`/`disablePushOnThisDevice`/`refreshPushToggleState`): lives in its **own "Notifications" account-section modal** (`open_notifications`, separate from Profile) — a "Push notifications" toggle → on Save it requests OS permission, subscribes via `PushManager` (`VAPID_PUBLIC_KEY` from `01-config.js`), and upserts the subscription to `push_subscriptions`. `enableNotificationsTest` fires a LOCAL test notification. **New-user prompt:** `maybePromptPushAfterSignup` (called on boot) shows the `#push-prompt-overlay` welcome modal (`openPushPromptModal`/`closePushPromptModal`/`confirmPushPromptEnable`) when `ct_prompt_push_signup` is set + the user is authed + push isn't already on — "Enable Notifications" triggers the same OS-permission/subscribe flow. The Account page is organized as option cards: **Profile** (username + photo only — display name removed), **Notifications**, **Achievements**, **Feature Requests**, **Security**, Theme, and a red **Log out** card last (`.account-logout-card`). (Email-to-SMS / phone + carrier were fully removed — push only.) |
| `19-logging-boot.js` | Message log + toast (`showToast`, `emitLog`), global error handlers, the **service-worker registration + "New version available" update prompt** (`showUpdatePrompt`, fired by the SW's `SW_ACTIVATED` message), **push-notification deep-link routing** (`handleNotificationRoute`: sends the app to Feed on `#feed` / the Recs list on `#recs` — used both on cold start from the URL hash and while already running via the SW's `NOTIFICATION_NAV` postMessage; this is what makes the badge clear on tap), the **new-user push prompt** trigger (`maybePromptPushAfterSignup`, run once auth is resolved on boot), and the **boot sequence** (`DOMContentLoaded`, auth-state listener). Must load last. |

To regenerate this index after edits:
`grep -rnE "^        (async function|function|class) " assets/js/`

## Running & testing locally

- Serve from the project root (paths are relative):
  `python3 -m http.server 8080` then open `http://localhost:8080`.
  (VSCode `launch.json` is also set to `http://localhost:8080`.)
- **Primary debug signal:** the browser DevTools **Console**. A broken script
  load shows as a 404/net error; a missing global shows as
  `ReferenceError: X is not defined` when the relevant UI is used.
- There is no automated test suite and no JS runtime installed locally (no
  node/deno) — validation is manual in the browser.

## Back end (reference, in repo root)

These are deployed to Supabase, not loaded by the front end, but document the API
the front end calls:
- Edge Functions: `EdgeFunc` (deployed as `swift-api`), `edgefunccopy`,
  `color_theme_edge.js`, `taste_profile_edge.js` (the front end calls these via
  `callSwiftApi*` / `callColorThemeEdge` in `12-watch-modals.js` and
  `08-search-trending.js`). `EdgeFunc` dispatches by `body.action`; notable actions
  include `search`, AI picks, `send_recommendation` (adds a movie to each
  recipient's "Recs" list, then sends a **Web Push** via `sendPushToUser` if the
  recipient has `push_subscriptions` rows), `notify_new_review` (web-push every
  FOLLOWER when the caller posts a **brand-new** review — fired fire-and-forget by
  `handleFormSubmit` in `10-logging-form.js` only on the new-entry insert path,
  never on updates; body = `Check out @user's new review of "Title"`,
  `url:"/#feed"`), `test_push` (sends a real Web Push to the caller's own
  subscribed devices), and `refresh_imdb_ratings` (**cron**, gated by an `x-cron-secret`
  header == `CRON_SECRET` env, no user session — re-pulls OMDb IMDb ratings for the
  ~300 STALEST movies by `Movie External Ratings.fetched_at` and overwrites them in
  place, so ratings drift over time; daily runs rotate through the whole catalog).
  `refresh_imdb_ratings` is triggered by **`.github/workflows/refresh-imdb.yml`** — a
  GitHub Actions daily cron that just `curl`s the Edge Function (the function does the
  DB writes). Needs GitHub repo secrets `SUPABASE_FUNCTION_URL` (the `…/functions/v1/swift-api`
  URL), `SUPABASE_PUBLISHABLE_KEY` (the `sb_publishable_…` key, same one in `01-config.js`;
  swift-api has Verify-JWT OFF so only the `apikey` header is needed — no Authorization
  bearer / deprecated anon key), `CRON_SECRET`; and edge secrets `CRON_SECRET` (same value)
  + `OMDB_API_KEY`. **Notifications are push-only** — the old email-to-SMS path
  (Gmail SMTP / `denomailer` / carrier gateways / `test_sms` / `Users.phone`+`carrier`)
  was removed. All push payloads carry a numeric `badge` from `computeUnseenBadge()`
  (= unseen feed ratings since `Users.feed_seen_at` + unseen recs since
  `Users.recs_seen_at`), which the service worker mirrors onto the iOS home-screen
  app-icon badge. The diary save also sends an `mpa` override so user-entered MPA
  persists when TMDb lacks it.
  - **Web Push** (`npm:web-push@3.6.7`): edge secrets `VAPID_PUBLIC`,
    `VAPID_PRIVATE`, optional `VAPID_SUBJECT` (mailto). PUBLIC key also lives in
    `01-config.js` as `VAPID_PUBLIC_KEY`. Subscriptions in `push_subscriptions`
    (RLS, see SQL). The service worker's `push` handler shows the notification.
- SQL: `dashboard_rpc.sql`, `achievements_*.sql`, `lists_schema.sql`,
  `library_views.sql` (`user_library_items_v2` — flattened My Movies rows),
  `lists_views.sql` (`user_list_items_v1` — same idea keyed on `Movie Lists`, so
  the Lists page reads a whole list in one query; mirrors the library view's
  owner-rights security model — the app always filters by `user_id`),
  `lists_cover_column.sql` (adds the optional `Lists.cover` text column — a
  per-list square JPEG data URL for the Lists overview cover grid; idempotent,
  reuses the existing `lists_update_own` RLS policy),
  `lists_branded_covers.sql` (**run once** — stores the branded **Recs** /
  **Bucket List** cover art as 320px-square JPEG data URLs in the DB instead of
  forcing large local PNGs from the front end: creates a `list_cover_defaults`
  lookup table (one row per branded list name), backfills `Lists.cover` for every
  existing auto-managed list, and is the source `signup_system.sql` reads to set
  the cover on new users' default lists; idempotent — re-run to re-brand),
  `user_tiers.sql`, `cascades.sql`, `recs_and_profile.sql`
  (auto "Recs" list per user + `Users.phone`/`Users.carrier` — the phone/carrier
  columns are now **unused/deprecated** since email-to-SMS was removed; left in
  place, harmless),
  `recommendations_tracking.sql` (`Recommendations` table + unique movie-per-list;
  RLS: read recs you sent/received + **delete recs you received** so removing a
  movie from your Recs list lets it be recommended again + **read the recommender's
  `Movie Ratings` row for the recommended movie** `movie_ratings_select_recommenders`
  so the Recs poster viewer can show their review under strict RLS),
  `search_users.sql` (`search_users(p_query)` SECURITY DEFINER RPC — Feed people-search
  matches **username OR email** by joining `auth.users`; returns only safe columns,
  never the email),
  `push_subscriptions.sql` (Web Push subscription rows + RLS; one per opted-in
  device, read by the edge fn with the service role to send pushes),
  `signup_system.sql` (**authoritative, idempotent signup provisioning — run this
  for new-user setup**: a `SECURITY DEFINER` trigger `handle_new_auth_user()` on
  `auth.users` fully provisions each new account server-side — creates the
  `public."Users"` row (username/display_name from signup metadata, `privacy_level`,
  starting tier = lowest `points_needed`, `achievement_points`=0) plus the
  **"Bucket List"** and **"Recs"** lists — each created with its branded `cover`
  read from `list_cover_defaults` (see `lists_branded_covers.sql`; NULL-safe if
  that table is empty). Works regardless of RLS / client auth
  timing / email-confirmation. Also sets `Users` RLS (authenticated read +
  self-insert/update) and backfills missing rows/lists. **Admin gate:** self-service
  signups (client sends `self_signup='true'` in `signUp({ options:{ data } })`) are
  blocked when `Settings.allow_signups` is false; admin/dashboard-created users
  bypass the gate. Supersedes the list triggers in `bucket_list_auto.sql` /
  `recs_and_profile.sql`, which remain harmless),
  `notification_seen_columns.sql` (`Users.feed_seen_at` / `Users.recs_seen_at` —
  the "last viewed Feed/Recs" timestamps that drive every unseen-count badge),
  etc.; more in `Supabase Setup/`.
- Gating constants in JS: `ADMIN_EMAIL` (admin panel), `THEME_CREATOR_OWNER_EMAIL`
  (theme creator), `DEMO_USER_ID` (guest mode).

## ⚠️ Database schema — where every field actually lives

**Source of truth: the CSV exports in `Supabase Setup/` (one file per table; the
header row = that table's columns).** Read the relevant CSV header before writing
any query. Do NOT guess column locations.

**The #1 trap: movie metadata is split across tables. `Movies` holds only core
fields. Genre, director/cast, platforms, and external (IMDb) ratings each live in
their own join tables — they are NOT columns on `Movies`.** Selecting a
non-existent column makes the whole PostgREST query fail and return nothing.

### Tables and columns (exact)

| Table | Columns |
|-------|---------|
| `Movies` | `id, created_at, tmdb_id, imdb_id, title, release_year, runtime_minutes, mpa_rating, is_series, poster_path` — **no genre, no director, no cast, no platform, no imdb rating** |
| `Movie Genres` | `movie_id, genre_id, created_at` → join to `Genres` |
| `Genres` | `id, name` |
| `Movie Cast` | `movie_id, person_id, character, created_at` → join to `People` |
| `Movie Crew` | `movie_id, person_id, job, created_at` → join to `People` (director = `job` = 'Director') |
| `People` | `id, created_at, tmdb_person_id, name` |
| `Movie Platforms` | `movie_id, created_at, platform_id` → join to `Platforms` |
| `Platforms` | `id, name` |
| `Movie External Ratings` | `movie_id, source, rating, fetched_at` (IMDb etc.; no user_id) |
| `Movie Ratings` | `id, watch_date, updated_at, user_id, movie_id, tier, overall_rating, acting_rating, pacing_rating, sound_rating, imagery_rating, plot_rating, dialogue_rating, notes, fav_quote` (one per user+movie; **no movie metadata here**) |
| `Watch Logs` | `id, watch_date, user_id, movie_id, watch_method` |
| `Users` | `id, created_at, display_name, privacy_level, username, icon, theme_id, tier_id, achievement_points, phone, carrier, feed_seen_at, recs_seen_at` (`phone`/`carrier` are **deprecated/unused** — email-to-SMS removed; `feed_seen_at`/`recs_seen_at` added by `notification_seen_columns.sql`, not in the CSV export — they drive unseen-count badges) |
| `Follows` | `follower_id, followed_id, created_at` (follower → followed) |
| `Lists` | `id, created_at, list_name, user_id, cover` (unique `(user_id, list_name)`; auto special lists: **"Bucket List"**, **"Recs"**; `cover` = optional per-list square image as a JPEG **data URL**, added by `lists_cover_column.sql` — drives the Lists overview cover grid, falls back to a movie-poster collage when null) |
| `Movie Lists` | `list_id, movie_id, created_at, user_id` (unique `(list_id, movie_id)` — no duplicate movie per list) |
| `list_cover_defaults` | `list_name, cover` (branded cover data URLs for the auto-managed **Recs** / **Bucket List**; one row per name. Source of truth read by the signup trigger + the `lists_branded_covers.sql` backfill) |
| `Recommendations` | `id, created_at, from_user_id, to_user_id, movie_id` (unique `(from_user_id, to_user_id, movie_id)`; logs who recommended what to whom — blocks re-recommends + drives "Recommended Again") |
| `Achievements` | `id, created_at, name, description, icon_url, tier, points, is_active, type, rule` |
| `User Achievements` | `id, user_id, achievement_id, earned_at` |
| `User Tiers` | `id, created_at, tier_icon_url, name, points_needed` |
| `Genres` | `id, name` |
| `Themes` | `id, created_at, name, colors` |
| `Logos` | `id, created_at, theme_id, url` |
| `Background Images` | `id, created_at, page, url, name, theme_id` |
| `Loading Images` | `id, image_url, last_used` |
| `Help Pop-ups` | `user_id, "AI Picks Help", "New Feature News"` |
| `Feature Requests` | `user_id, created_at, feature` |
| `Settings` | `id, created_at, allow_signups` |
| `Taste Profiles` | `user_id, computed_at, mean_overall, std_overall, like_threshold, runtime_bins_json, decade_bins_json, people_affinity_json, subrating_weights_json, imdb_delta, median_overall` |

### How to read denormalized movie data
The front end usually reads **genre/director/platforms together via SQL views**
(`library_views.sql` → `user_library_items_v2`, `user_movie_latest_watch`), not by
joining the base tables itself. Server-side (Edge Function) you must join the base
tables manually: genre = `Movie Genres`→`Genres`; director = `Movie Crew`
(`job='Director'`)→`People`.

## Editing conventions

- Match the existing style: top-level code in each file is indented **8 spaces**
  (carried over from when it was nested inside `<script>` in `index.html`). Keep
  new code consistent with the surrounding lines rather than re-indenting.
- Inline `onclick`/`oninput` handlers in `index.html` markup require their target
  functions to remain global — don't rename a function without updating its
  callers in `02-router.js` templates and `index.html`.
- When adding a new feature file, give it the next number, add its `<script src>`
  tag to `index.html` in the correct order, and update this map.
