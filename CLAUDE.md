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
manifest.webmanifest           PWA manifest (installable web app; name/icons/colors)
service-worker.js              PWA service worker — PUSH-ONLY (no fetch/caching, so no
                               staleness); registered in 19-logging-boot.js
assets/icons/                  PWA icons (icon.svg source + generated PNGs:
                               icon-192/512, icon-maskable-512, apple-touch-icon 180)
_original_backup/              Byte-identical pre-refactor originals (safety net)
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
| `02-router.js` | The `router` object — **all page view HTML templates** (home, feed, library, lists, ai_picks, dashboard, account) live here as template strings. Largest file; one big object literal. |
| `03-home-dashboard-core.js` | `loadDashboard`, dashboard data helpers (`dash*` formatting/poster/person), feed/library/lists auth warnings |
| `04-lists.js` | Lists feature: state, create/rename/delete modals, sort+filter modal, add-to-list, bucket list, `initListsPage`, `loadListsPage`. **Movie Recommendations** modal (`openRecModal`/`openRecModalFromHome`/`sendRecommendation`): pick people you follow → `send_recommendation` Edge action adds the movie to each recipient's auto "Recs" list + email-to-SMS. Recs cards show recommender avatar(s) + a "+" that opens `openRecByModal` (all recommenders); send blocks recipients who already saw the movie or were already recommended it. In the modal, followers who have **already seen** the movie are greyed out + un-checkable with an "Already seen this" note and a **"View review"** button (`openRecReviewModal`) that shows their rating/review in the `#rec-review-overlay` modal (seen-status computed in `loadRecRecipients` by reading their `Movie Ratings` for the resolved movie id). New recs glow (`.is-new`) until the Recs list is viewed. **"Recs" is the default list shown when opening the Lists tab** (falls back to Bucket List / first list). List posters **hover-flip** to a details back face (Director/Runtime/MPA/Genre/IMDb) reusing the My Movies `.library-poster-flip*` classes. Logging/rating a movie auto-removes it from the user's **Bucket List + Recs** via `removeMovieFromAutoLists` (called from the diary save). |
| `05-feed-library.js` | "My Movies" library (render/filter/sort/paginate, Edit/Delete/Recommend buttons) AND social Feed (following, user search, feed items grouped by movie, Filter modal: per-follow checkboxes + Compare Own + **"Only show movies in common"** = keep only movies watched by 2+ of the shown users, `feedInCommonOnly`; this mode loads watch logs 1000 at a time with a **"Load More"** button (`renderFeedInCommonLoadMore`, `loadFeedItems({appendInCommon:true})`) so older overlaps aren't cut off). Also the **nav notification badges** (`refreshNavBadges`/`markFeedSeen`/`markRecsSeen`): red count on the Feed nav button = new follow ratings since last view, on the Lists button = new recs received; last-seen times in `localStorage`. New/updated feed cards from **other** users glow (`.is-new`) — never your own; a NEW entry for a movie **you recommended to that person** glows a distinct violet (`.is-new-rec`, via `myRecSentPairs` from the `Recommendations` table) — and a floating **"Jump to New"** pill (`updateFeedJumpNewButton`/`jumpToNewFeed`, `#feed-jump-new-btn`) appears when such entries exist, scrolling to the first one. Also the **user profile overview modal** (`openUserProfile`): click a user in the Feed → KPIs (movies watched, avg overall, highest-rated director) + Recent/Top-Rated poster grid, computed client-side and rendered with the Data Dash helpers (`dashRenderHelpScore`/`dashRenderHelpTier`/`dashBuildPosterUrl`/`.dash-fav-grid`) for an exact visual match. When viewing **someone else's** profile it also shows a **Taste Match** card: a compatibility % (`100 − avg absolute overall-rating gap` over movies you've both rated) + count in common + the 3 biggest disagreements (computed in `openUserProfile`, rendered via `renderProfileBody`'s `compat`). |
| `06-dashboard-controls.js` | Data Dash UI: KPI clicks, tab/timeframe/metric controls, chart control wiring, `setDashboardTab`, favorites |
| `07-dashboard-charts.js` | Data Dash rendering: `loadDashboardCharts/Ratings/General/Tiers/QuoteWall`, pie/bar/donut chart drawing |
| `08-search-trending.js` | TMDB-backed movie search + trending (`callSwiftApi*`), home search results, lists quick-add search |
| `09-home-ui.js` | Home page UI helpers, search filters panel, duplicate-rating modal, `handleSearch`, `toggleMobileMenu`, `escapeHtml` |
| `10-logging-form.js` | The "log a movie" diary form: watch-method toggle, genre chips, validation, `handleFormSubmit`. **Watch Date / Times Watched / Watch Method are NOT on the main form for new entries** — after the review validates, `handleFormSubmit` opens the post-save **Watch Details** modal (`promptWatchDetails`: when / where / have-you-watched-before?); a "Yes" then opens the **Previous Watches** modal (`promptPriorWatches`) whose own count input drives how many date+method rows appear → bulk `Watch Logs`. On **update**, those three fields still render inline (locked) and the existing update watch modals are used. |
| `11-achievements.js` | Achievements + tiers: definitions/loading, popups & animations, rating milestones, admin signup toggle, ratings-success modal |
| `12-watch-modals.js` | Update/delete watch & rating modals, watch-method & prior-watches prompts, the new-entry **Watch Details** prompt (`promptWatchDetails` + `select/submit/closeWatchDetailsModal`), the count-driven **Previous Watches** modal (`promptPriorWatches`/`renderPriorWatchesRows`/`submitPriorWatchesModal`), loading overlay, **DB helpers** (`insertWatchLog*`, `getDbMovieIdByTmdbId`, `callSwiftApi`, `callColorThemeEdge`, etc.) |
| `13-auth-guest.js` | Guest/demo mode (`enterGuestMode`/`exitGuestMode`), `getActiveUserId`, `guardGuestWrite` |
| `14-themes.js` | Theme system: load/apply themes & colors, background images, theme-creator data layer, help/feature popups, `refreshAuthStateAndUI` |
| `15-auth-account-modals.js` | Auth modal (login/signup/logout/forgot-password), account-section modal, username validation |
| `16-ai-picks.js` | AI Picks page: filters modal, provider/genre selection, similar-movie search, loading images, `initAiPicksPage` |
| `17-theme-creator.js` | Theme Creator UI (backdrop/AI search, selection, save/delete), `initThemeCreatorPage` (gated to `THEME_CREATOR_OWNER_EMAIL`) |
| `18-account-page.js` | Account page: load/save profile (incl. `phone` + `carrier` for SMS notifications), change password, feature requests |
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
- Edge Functions: `EdgeFunc` (deployed as `swift-api`), `edgefunccopy`,
  `color_theme_edge.js`, `taste_profile_edge.js` (the front end calls these via
  `callSwiftApi*` / `callColorThemeEdge` in `12-watch-modals.js` and
  `08-search-trending.js`). `EdgeFunc` dispatches by `body.action`; notable actions
  include `search`, AI picks, `send_recommendation` (adds a movie to each
  recipient's "Recs" list + sends email-to-SMS), and `test_sms` (admin button in
  Account → texts the caller's own phone to verify the pipeline). The diary save also sends an `mpa`
  override so user-entered MPA persists when TMDb lacks it.
  - Env vars for recommendations (Gmail SMTP via `denomailer`): `GMAIL_USER`,
    `GMAIL_APP_PASSWORD`, optional `SITE_URL`. Email-to-SMS gateways:
    Verizon→`vtext.com`, AT&T→`txt.att.net`. If creds are unset, the Recs add
    still works, the text is just skipped.
- SQL: `dashboard_rpc.sql`, `achievements_*.sql`, `lists_schema.sql`,
  `library_views.sql`, `user_tiers.sql`, `cascades.sql`, `recs_and_profile.sql`
  (auto "Recs" list per user + `Users.phone`/`Users.carrier`),
  `recommendations_tracking.sql` (`Recommendations` table + unique movie-per-list),
  `signup_system.sql` (**authoritative, idempotent signup provisioning — run this
  for new-user setup**: a `SECURITY DEFINER` trigger `handle_new_auth_user()` on
  `auth.users` fully provisions each new account server-side — creates the
  `public."Users"` row (username/display_name from signup metadata, `privacy_level`,
  starting tier = lowest `points_needed`, `achievement_points`=0) plus the
  **"Bucket List"** and **"Recs"** lists. Works regardless of RLS / client auth
  timing / email-confirmation. Also sets `Users` RLS (authenticated read +
  self-insert/update) and backfills missing rows/lists. **Admin gate:** self-service
  signups (client sends `self_signup='true'` in `signUp({ options:{ data } })`) are
  blocked when `Settings.allow_signups` is false; admin/dashboard-created users
  bypass the gate. Supersedes the list triggers in `bucket_list_auto.sql` /
  `recs_and_profile.sql`, which remain harmless),
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
| `Users` | `id, created_at, display_name, privacy_level, username, icon, theme_id, tier_id, achievement_points, phone, carrier` |
| `Follows` | `follower_id, followed_id, created_at` (follower → followed) |
| `Lists` | `id, created_at, list_name, user_id` (unique `(user_id, list_name)`; auto special lists: **"Bucket List"**, **"Recs"**) |
| `Movie Lists` | `list_id, movie_id, created_at, user_id` (unique `(list_id, movie_id)` — no duplicate movie per list) |
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
