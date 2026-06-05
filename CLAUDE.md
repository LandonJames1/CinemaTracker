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
index.html                     HTML markup only; <link> to CSS + ordered <script src> tags
reset-password.html            Standalone password-reset page (Supabase recovery flow)
assets/css/styles.css          All app styles (~3,400 lines)
assets/css/reset-password.css  Styles for reset-password page
assets/js/01..19-*.js          App logic (see map below)
assets/js/reset-password.js    Logic for reset-password page
_original_backup/              Byte-identical pre-refactor originals (safety net)
```

The refactor was verified byte-for-byte: concatenating the split files
reproduces the originals exactly. No logic was changed.

## JS file map (where to look for what)

| File | Domain |
|------|--------|
| `01-config.js` | Supabase client init (`SUPABASE_URL`/`SUPABASE_KEY`), `icons` SVG map, `COL_WATCH_DATE`, nav logo loading |
| `02-router.js` | The `router` object — **all page view HTML templates** (home, feed, library, lists, ai_picks, dashboard, account) live here as template strings. Largest file; one big object literal. |
| `03-home-dashboard-core.js` | `loadDashboard`, dashboard data helpers (`dash*` formatting/poster/person), feed/library/lists auth warnings |
| `04-lists.js` | Lists feature: state, create/rename/delete modals, sort+filter modal, add-to-list, bucket list, `initListsPage`, `loadListsPage` |
| `05-feed-library.js` | "My Movies" library (render/filter/sort/paginate, Edit/Delete buttons) AND social Feed (following, user search, feed items grouped by movie, Filter modal: per-follow checkboxes + Compare Own) |
| `06-dashboard-controls.js` | Data Dash UI: KPI clicks, tab/timeframe/metric controls, chart control wiring, `setDashboardTab`, favorites |
| `07-dashboard-charts.js` | Data Dash rendering: `loadDashboardCharts/Ratings/General/Tiers/QuoteWall`, pie/bar/donut chart drawing |
| `08-search-trending.js` | TMDB-backed movie search + trending (`callSwiftApi*`), home search results, lists quick-add search |
| `09-home-ui.js` | Home page UI helpers, search filters panel, duplicate-rating modal, `handleSearch`, `toggleMobileMenu`, `escapeHtml` |
| `10-logging-form.js` | The "log a movie" diary form: watch-method toggle, genre chips, validation, `handleFormSubmit` |
| `11-achievements.js` | Achievements + tiers: definitions/loading, popups & animations, rating milestones, admin signup toggle, ratings-success modal |
| `12-watch-modals.js` | Update/delete watch & rating modals, watch-method & prior-watches prompts, loading overlay, **DB helpers** (`insertWatchLog*`, `getDbMovieIdByTmdbId`, `callSwiftApi`, `callColorThemeEdge`, etc.) |
| `13-auth-guest.js` | Guest/demo mode (`enterGuestMode`/`exitGuestMode`), `getActiveUserId`, `guardGuestWrite` |
| `14-themes.js` | Theme system: load/apply themes & colors, background images, theme-creator data layer, help/feature popups, `refreshAuthStateAndUI` |
| `15-auth-account-modals.js` | Auth modal (login/signup/logout/forgot-password), account-section modal, username validation |
| `16-ai-picks.js` | AI Picks page: filters modal, provider/genre selection, similar-movie search, loading images, `initAiPicksPage` |
| `17-theme-creator.js` | Theme Creator UI (backdrop/AI search, selection, save/delete), `initThemeCreatorPage` (gated to `THEME_CREATOR_OWNER_EMAIL`) |
| `18-account-page.js` | Account page: load/save profile, change password, feature requests |
| `19-logging-boot.js` | Message log + toast (`showToast`, `emitLog`), global error handlers, and the **boot sequence** (`DOMContentLoaded`, auth-state listener). Must load last. |

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
- Edge Functions: `EdgeFunc`, `edgefunccopy`, `color_theme_edge.js`,
  `taste_profile_edge.js` (the front end calls these via `callSwiftApi*` /
  `callColorThemeEdge` in `12-watch-modals.js` and `08-search-trending.js`).
- SQL: `dashboard_rpc.sql`, `achievements_*.sql`, `lists_schema.sql`,
  `library_views.sql`, `user_tiers.sql`, `cascades.sql`, etc.; more in
  `Supabase Setup/`.
- Gating constants in JS: `ADMIN_EMAIL` (admin panel), `THEME_CREATOR_OWNER_EMAIL`
  (theme creator), `DEMO_USER_ID` (guest mode).

## Editing conventions

- Match the existing style: top-level code in each file is indented **8 spaces**
  (carried over from when it was nested inside `<script>` in `index.html`). Keep
  new code consistent with the surrounding lines rather than re-indenting.
- Inline `onclick`/`oninput` handlers in `index.html` markup require their target
  functions to remain global — don't rename a function without updating its
  callers in `02-router.js` templates and `index.html`.
- When adding a new feature file, give it the next number, add its `<script src>`
  tag to `index.html` in the correct order, and update this map.
