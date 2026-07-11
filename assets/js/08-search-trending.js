        async function callSwiftApiSearchMovies({ query, page = 1, signal }) {
            try {
                const year = homeSearchAppliedYear;
                const mpa = homeSearchAppliedMpa;
                return await callSwiftApiPublic({ action: 'search', query, page, year, mpa, limit: 25 }, { signal });
            } catch (err) {
                throw new Error(`Search failed: ${String(err?.message || err)}`);
            }
        }

        async function callSwiftApiSearchMoviesForLists({ query, page = 1, signal }) {
            try {
                // Uses the add-movie modal's own Year/MPA filter state (mirrors Home search).
                const year = (typeof listsAddAppliedYear !== 'undefined') ? listsAddAppliedYear : '';
                const mpa = (typeof listsAddAppliedMpa !== 'undefined') ? listsAddAppliedMpa : '';
                return await callSwiftApiPublic({ action: 'search', query, page, year, mpa, limit: 25 }, { signal });
            } catch (err) {
                throw new Error(`Search failed: ${String(err?.message || err)}`);
            }
        }

        // Shared inline "×" clear button for the movie-search bars (Home, Lists, Games).
        // Shows only while the input has text; clicking empties it, runs the bar's own
        // clear/hide callback, and refocuses. Idempotent per input.
        function initSearchClearButton(inputId, onClear) {
            const input = document.getElementById(inputId);
            if (!input || input.dataset.clearBtnBound === '1') return;
            const parent = input.parentElement;
            if (!parent) return;
            input.dataset.clearBtnBound = '1';
            try { if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative'; } catch (_) {}
            parent.classList.add('has-search-clear');
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'search-clear-btn';
            btn.setAttribute('aria-label', 'Clear search');
            btn.innerHTML = '&times;';
            btn.style.display = input.value ? '' : 'none';
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                input.value = '';
                btn.style.display = 'none';
                try { if (typeof onClear === 'function') onClear(); } catch (_) {}
                try { input.focus(); } catch (_) {}
            });
            input.addEventListener('input', () => { btn.style.display = input.value ? '' : 'none'; });
            parent.appendChild(btn);
        }

        async function callSwiftApiGetMovieDetails({ tmdb_id, signal }) {
            try {
                return await callSwiftApiPublic({ action: 'details', tmdb_id }, { signal });
            } catch (err) {
                throw new Error(`Details failed: ${String(err?.message || err)}`);
            }
        }

        async function callSwiftApiGetTrendingMovies({ time_window = 'day', limit = 10, signal } = {}) {
            try {
                return await callSwiftApiPublic({ action: 'trending', time_window, limit }, { signal });
            } catch (err) {
                throw new Error(`Trending failed: ${String(err?.message || err)}`);
            }
        }

        function renderTrendingNow(items) {
            const safeItems = Array.isArray(items) ? items : [];
            const cardsHTML = safeItems.map((m) => {
                const title = String(m?.title || '').trim();
                const genre = String(m?.genre || '').trim();
                const posterPath = String(m?.poster_path || '').trim();
                const posterUrl = posterPath ? `https://image.tmdb.org/t/p/w342${posterPath}` : '';
                if (!posterUrl) return '';

                const tmdbId = Number(m?.tmdb_id ?? m?.id) || '';
                return `
                    <div class="trending-card" role="button" tabindex="0" data-trending-tmdb="${tmdbId}">
                        <img src="${posterUrl}" alt="${escapeHtml(title)}" onerror="this.closest('.trending-card')?.remove?.()">
                        <div class="movie-overlay">
                            ${genre ? `<span class=\"text-xs text-brand font-bold uppercase mb-1\">${escapeHtml(genre)}</span>` : ''}
                            <h4 class="text-white font-bold text-sm">${escapeHtml(title)}</h4>
                        </div>
                    </div>
                `;
            }).join('');

            const track1 = document.getElementById('trending-track-1');
            const track2 = document.getElementById('trending-track-2');
            if (track1) track1.innerHTML = cardsHTML;
            if (track2) track2.innerHTML = cardsHTML;

            // Tapping a trending card opens the rich Movie Spotlight modal (turns the
            // marquee into a discovery surface, not just decoration). Delegated once
            // per track; cards are duplicated across both tracks for the loop.
            [track1, track2].forEach((track) => {
                if (!track || track.dataset.boundTrendingClicks) return;
                track.dataset.boundTrendingClicks = 'true';
                track.addEventListener('click', (e) => {
                    const card = e?.target?.closest ? e.target.closest('.trending-card[data-trending-tmdb]') : null;
                    if (!card) return;
                    const tmdbId = Number(card.getAttribute('data-trending-tmdb'));
                    if (!Number.isFinite(tmdbId) || tmdbId <= 0) return;
                    const picked = (Array.isArray(homeTrendingItems) ? homeTrendingItems : [])
                        .find((it) => Number(it?.tmdb_id ?? it?.id) === tmdbId);
                    if (picked && typeof openMovieSpotlight === 'function') openMovieSpotlight(picked);
                });

                // Prefetch details on pointerdown so the spotlight opens instantly. (No
                // hover-prefetch here — the marquee auto-scrolls cards under a stationary
                // cursor, which would fire pointerover constantly and prefetch junk.)
                track.addEventListener('pointerdown', (e) => {
                    const card = e?.target?.closest ? e.target.closest('.trending-card[data-trending-tmdb]') : null;
                    if (!card) return;
                    const id = Number(card.getAttribute('data-trending-tmdb'));
                    if (Number.isFinite(id) && id > 0 && typeof prefetchMovieDetails === 'function') prefetchMovieDetails(id);
                });
            });
        }

        async function loadTrendingNow() {
            const track1 = document.getElementById('trending-track-1');
            const track2 = document.getElementById('trending-track-2');
            if (!track1 || !track2) return;

            // Cancel any in-flight trending request (e.g., navigating home repeatedly).
            try { homeTrendingAbortController?.abort?.(); } catch (_) {}
            homeTrendingAbortController = new AbortController();

            // Lightweight loading state (no hardcoded movies/posters).
            track1.innerHTML = `<div class="text-gray" style="padding: 0 1.5rem;">Loading trending…</div>`;
            track2.innerHTML = `<div class="text-gray" style="padding: 0 1.5rem;">Loading trending…</div>`;

            try {
                const data = await callSwiftApiGetTrendingMovies({ time_window: 'day', limit: 20, signal: homeTrendingAbortController.signal });
                const items = Array.isArray(data?.results) ? data.results : [];
                homeTrendingItems = items;
                renderTrendingNow(items);
            } catch (err) {
                if (String(err?.name || '').toLowerCase() === 'aborterror') return;
                // Quiet failure: keep marquee area but show a small message.
                const msg = `Trending unavailable`;
                track1.innerHTML = `<div class="text-gray" style="padding: 0 1.5rem;">${escapeHtml(msg)}</div>`;
                track2.innerHTML = `<div class="text-gray" style="padding: 0 1.5rem;">${escapeHtml(msg)}</div>`;
            }
        }

        // ── "You Might Like" home strip ─────────────────────────────────────────
        // Taste-based picks from the swift-api `swipe_deck` action (scored off the
        // user's Taste Profile). This is NOT the "Recs" list — swipe_deck explicitly
        // EXCLUDES movies already in Recs/Bucket List, movies already WATCHED, and
        // UNRELEASED movies (all filtered server-side). Clean posters (no % badge); the
        // taste-match % is surfaced INSIDE the Movie Spotlight instead (the tapped card
        // carries `taste_score`, which openMovieSpotlight reads). Rendered as an
        // auto-scrolling marquee on desktop (two duplicate tracks) + a manual horizontal
        // scroll on mobile (CSS disables the animation + hides track-2 ≤768px).
        function foryouCardHtml(m) {
            const title = String(m?.title || '').trim();
            const posterPath = String(m?.poster_path || '').trim();
            const posterUrl = posterPath ? `https://image.tmdb.org/t/p/w342${posterPath}` : '';
            if (!posterUrl) return '';
            const tmdbId = Number(m?.tmdb_id ?? m?.id) || '';
            return `
                <div class="foryou-card" role="button" tabindex="0" data-foryou-tmdb="${tmdbId}">
                    <img src="${posterUrl}" alt="${escapeHtml(title)}" loading="lazy" onerror="this.closest('.foryou-card')?.remove?.()">
                    <div class="movie-overlay">
                        <h4 class="text-white font-bold text-sm">${escapeHtml(title)}</h4>
                    </div>
                </div>
            `;
        }

        function renderHomeForYou(items) {
            const wrap = document.getElementById('home-foryou');
            const track1 = document.getElementById('home-foryou-track-1');
            const track2 = document.getElementById('home-foryou-track-2');
            if (!track1) return;

            const safeItems = Array.isArray(items) ? items : [];
            const cardsHTML = safeItems.map(foryouCardHtml).join('');
            track1.innerHTML = cardsHTML;
            if (track2) track2.innerHTML = cardsHTML; // duplicate set → seamless desktop marquee loop
            if (wrap) wrap.style.display = cardsHTML ? 'block' : 'none';

            // Bind interactions once per track (both tracks carry cards on desktop).
            [track1, track2].forEach((track) => {
                if (!track || track.dataset.boundForYou) return;
                track.dataset.boundForYou = 'true';

                // Tapping a card carries its taste_score into the Movie Spotlight, where the
                // "% match" tile renders (only movies opened from here have a taste_score).
                track.addEventListener('click', (e) => {
                    const card = e?.target?.closest ? e.target.closest('.foryou-card[data-foryou-tmdb]') : null;
                    if (!card) return;
                    const tmdbId = Number(card.getAttribute('data-foryou-tmdb'));
                    if (!Number.isFinite(tmdbId) || tmdbId <= 0) return;
                    const picked = (Array.isArray(homeForYouItems) ? homeForYouItems : [])
                        .find((it) => Number(it?.tmdb_id ?? it?.id) === tmdbId);
                    if (picked && typeof openMovieSpotlight === 'function') openMovieSpotlight(picked);
                });

                // Prefetch details so the spotlight opens instantly. pointerdown always;
                // hover only on mobile (on desktop the marquee moves cards under a stationary
                // cursor, which would fire pointerover constantly and prefetch junk).
                const prefetch = (e) => {
                    const card = e?.target?.closest ? e.target.closest('.foryou-card[data-foryou-tmdb]') : null;
                    if (!card) return;
                    const id = Number(card.getAttribute('data-foryou-tmdb'));
                    if (Number.isFinite(id) && id > 0 && typeof prefetchMovieDetails === 'function') prefetchMovieDetails(id);
                };
                track.addEventListener('pointerdown', prefetch);
                track.addEventListener('pointerover', (e) => {
                    if (typeof isMobileViewport === 'function' && !isMobileViewport()) return;
                    prefetch(e);
                });
            });
        }

        // ── Fetch + cache (perf: instant paint on repeat visits) ────────────────
        const HOME_FORYOU_MIN = 10;            // always fill the strip to at least this many cards
        const HOME_FORYOU_MAX_BATCHES = 5;     // page swipe_deck this many times max to reach the minimum
        const HOME_FORYOU_LIMIT = 40;          // one big first call almost always yields >=10 → no extra round trips
        const HOME_FORYOU_TTL_MS = 10 * 60 * 1000;   // a cached deck is "fresh" (no refetch) for 10 min
        const HOME_FORYOU_CACHE_KEY = 'ct_foryou_cache_v1';

        function homeForYouCacheHas(userId) {
            return !!(homeForYouCache && homeForYouCache.userId === userId
                && Array.isArray(homeForYouCache.items) && homeForYouCache.items.length);
        }
        function homeForYouCacheFresh(userId) {
            return homeForYouCacheHas(userId) && (Date.now() - homeForYouCache.ts) < HOME_FORYOU_TTL_MS;
        }
        function hydrateHomeForYouCacheFromSession() {
            if (homeForYouCache) return; // in-memory wins
            try {
                const raw = sessionStorage.getItem(HOME_FORYOU_CACHE_KEY);
                if (!raw) return;
                const parsed = JSON.parse(raw);
                if (parsed && parsed.userId && Array.isArray(parsed.items) && parsed.items.length) homeForYouCache = parsed;
            } catch (_) {}
        }
        function saveHomeForYouCache(userId, items) {
            homeForYouCache = { userId, items, ts: Date.now() };
            try { sessionStorage.setItem(HOME_FORYOU_CACHE_KEY, JSON.stringify(homeForYouCache)); } catch (_) {}
        }
        // Drop the cache so the next Home visit refetches — call after a rating save so a
        // just-watched movie can't linger in the strip within the TTL window.
        function invalidateHomeForYouCache() {
            homeForYouCache = null;
            homeForYouInflight = null;
            try { sessionStorage.removeItem(HOME_FORYOU_CACHE_KEY); } catch (_) {}
        }

        // The set of tmdb_ids the viewer has already rated — used to filter the precomputed
        // deck in case they watched one of its movies AFTER the last daily recompute (so a
        // just-watched movie never lingers in "You Might Like"). Fail-open (empty on error).
        async function fetchWatchedTmdbSet(userId) {
            const set = new Set();
            try {
                const { data } = await supabaseClient
                    .from('Movie Ratings')
                    .select('Movies(tmdb_id)')
                    .eq('user_id', userId);
                (Array.isArray(data) ? data : []).forEach((r) => {
                    const rel = r?.Movies;
                    const t = Number((Array.isArray(rel) ? rel[0]?.tmdb_id : rel?.tmdb_id));
                    if (Number.isFinite(t) && t > 0) set.add(t);
                });
            } catch (_) { /* fail open */ }
            return set;
        }

        // Live deep-paging of swipe_deck — the FALLBACK when a user has no precomputed row
        // yet (brand-new user the daily cron hasn't reached). swipe_deck already excludes
        // watched/swiped/Recs/Bucket-List AND unreleased movies server-side. Returns [] on
        // total failure.
        async function fetchHomeForYouLive() {
            const items = [];
            const seen = new Set();
            for (let b = 0; b < HOME_FORYOU_MAX_BATCHES && items.length < HOME_FORYOU_MIN; b += 1) {
                // First (b=0) call asks for a big pool so ONE round trip usually suffices.
                const limit = b === 0 ? HOME_FORYOU_LIMIT : 25;
                const data = await callSwiftApiPublic({ action: 'swipe_deck', limit, batch: b });
                const cards = Array.isArray(data?.cards) ? data.cards : [];
                let added = 0;
                for (const c of cards) {
                    const id = Number(c?.tmdb_id ?? c?.id);
                    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
                    seen.add(id); items.push(c); added += 1;
                }
                if (added === 0) break; // pool exhausted — deeper batches won't add anything
            }
            return items;
        }

        // Returns the deck cards for a user. FAST PATH: read the daily-precomputed row from
        // "Home Recommendations" (one indexed query, no TMDB) and filter out anything watched
        // since the last recompute. SLOW PATH (new user, no row yet): compute live via
        // swipe_deck so they still get picks immediately (the next cron backfills their row).
        async function fetchHomeForYouCards(userId) {
            if (userId && supabaseClient) {
                try {
                    const [recRes, watched] = await Promise.all([
                        supabaseClient.from('Home Recommendations').select('cards').eq('user_id', userId).maybeSingle(),
                        fetchWatchedTmdbSet(userId),
                    ]);
                    let cards = Array.isArray(recRes?.data?.cards) ? recRes.data.cards : [];
                    if (cards.length) {
                        cards = cards.filter((c) => !watched.has(Number(c?.tmdb_id ?? c?.id)));
                        if (cards.length) return cards;
                    }
                } catch (_) { /* fall through to live */ }
            }
            return fetchHomeForYouLive();
        }

        // Returns the deck for `userId`, using the cache when fresh and DE-DUPING concurrent
        // fetches (the boot prefetch + a Home render share one in-flight promise, so we never
        // hit swipe_deck twice). `force` bypasses the freshness check (background revalidation)
        // but still de-dupes in-flight.
        function ensureHomeForYouItems(userId, { force = false } = {}) {
            if (!force && homeForYouCacheFresh(userId)) return Promise.resolve(homeForYouCache.items);
            if (homeForYouInflight) return homeForYouInflight;
            homeForYouInflight = (async () => {
                try {
                    const items = await fetchHomeForYouCards(userId);
                    if (items && items.length) saveHomeForYouCache(userId, items);
                    return items;
                } finally {
                    homeForYouInflight = null;
                }
            })();
            return homeForYouInflight;
        }

        // Warm the cache as early as possible (called from the boot sequence once auth
        // resolves) so the FIRST Home visit paints instantly. Fire-and-forget.
        function prefetchHomeForYou() {
            try {
                const userId = (typeof getActiveUserId === 'function') ? getActiveUserId() : null;
                if (!userId || !supabaseClient) return;
                hydrateHomeForYouCacheFromSession();
                if (homeForYouCacheFresh(userId)) return; // already warm
                ensureHomeForYouItems(userId).catch(() => {});
            } catch (_) {}
        }

        async function loadHomeForYou() {
            const wrap = document.getElementById('home-foryou');
            const track1 = document.getElementById('home-foryou-track-1');
            const trendingWrap = document.querySelector('.home-trending');
            if (!track1) return;

            const showTrendingFallback = () => {
                if (wrap) wrap.style.display = 'none';
                if (trendingWrap) trendingWrap.style.display = '';   // let CSS govern (desktop shows, mobile hidden)
                loadTrendingNow();
            };

            const userId = (typeof getActiveUserId === 'function') ? getActiveUserId() : null;

            // Logged out: can't personalize — hide the strip and show the Trending marquee instead.
            if (!userId || !supabaseClient) { showTrendingFallback(); return; }

            // The for-you strip REPLACES Trending on desktop, so hide the marquee.
            if (trendingWrap) trendingWrap.style.display = 'none';
            if (wrap) wrap.style.display = 'block';

            hydrateHomeForYouCacheFromSession();

            // Stale-while-revalidate: if we have ANY cached deck for this user, paint it
            // INSTANTLY (0 network). Otherwise show the skeleton while the first fetch runs.
            if (homeForYouCacheHas(userId)) {
                homeForYouItems = homeForYouCache.items;
                renderHomeForYou(homeForYouItems);
            } else {
                const track2 = document.getElementById('home-foryou-track-2');
                const skel = Array.from({ length: 8 }).map(() => `<div class="foryou-card skel"></div>`).join('');
                track1.innerHTML = skel;
                if (track2) track2.innerHTML = skel;
            }

            // Fresh cache → don't touch the network at all.
            if (homeForYouCacheFresh(userId)) return;

            // Revalidate (or first-load). Guard against navigating away / switching account
            // before it resolves so we never paint into the wrong page.
            try {
                const items = await ensureHomeForYouItems(userId, { force: true });
                const stillHome = (document.body?.dataset?.page === 'home');
                const stillSameUser = ((typeof getActiveUserId === 'function') ? getActiveUserId() : null) === userId;
                if (!stillHome || !stillSameUser) return;
                if (items && items.length) {
                    homeForYouItems = items;
                    renderHomeForYou(items);
                } else if (!homeForYouCacheHas(userId)) {
                    showTrendingFallback();
                }
            } catch (_) {
                if (!homeForYouCacheHas(userId)) showTrendingFallback();
            }
        }

        function renderHomeSearchResults(items) {
            const results = document.getElementById('search-results');
            if (!results) return;

            // Show all results, including any franchise-collection movies the server
            // appended (the dropdown scrolls). Capped generously so a huge collection
            // can't blow it up.
            homeSearchItems = Array.isArray(items) ? items.slice(0, 50) : [];

            if (homeSearchItems.length === 0) {
                results.innerHTML = `<div class="search-item text-gray justify-center">No movies found</div>`;
                results.classList.remove('hidden');
                return;
            }

            results.innerHTML = homeSearchItems.map((m, idx) => {
                const title = String(m?.title || '').trim();
                const year = m?.year ? String(m.year) : '';
                const genres = Array.isArray(m?.genres)
                    ? m.genres.map(s => String(s).trim()).filter(Boolean)
                    : String(m?.genre || '').split(',').map(s => s.trim()).filter(Boolean);
                const posterPath = String(m?.poster_path || '').trim();
                const posterUrl = posterPath ? `https://image.tmdb.org/t/p/w154${posterPath}` : '';

                // Dropdown preview: do not show director (only fetched on details after selection).
                const metaParts = [
                    year,
                    (genres.length ? genres.join(', ') : ''),
                ].filter(Boolean);

                return `
                    <div class="search-item" data-idx="${idx}">
                        <div style="display:flex; align-items:center; gap: 0.75rem;">
                            <div style="width: 34px; height: 51px; flex: 0 0 34px; border-radius: 7px; overflow:hidden; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08); display:flex; align-items:center; justify-content:center;">
                                ${posterUrl
                                    ? `<img src="${posterUrl}" alt="" style="width: 100%; height: 100%; object-fit: cover; display:block;" onerror="this.style.display='none'; this.parentElement.style.opacity='0.6';">`
                                    : `<div style="opacity:0.65; color: var(--text-muted); width: 16px; height: 16px; display:flex; align-items:center; justify-content:center;">${icons.film}</div>`
                                }
                            </div>
                            <div>
                                <div class="text-white font-semibold">${escapeHtml(title)}</div>
                                <div class="text-xs text-gray">${escapeHtml(metaParts.join(' • '))}</div>
                            </div>
                        </div>
                        <div style="color:var(--text-muted);">${icons.arrowRightCircle}</div>
                    </div>
                `;
            }).join('');
            results.classList.remove('hidden');

            // On mobile the dropdown floats over the page with the fixed bottom
            // tab bar overlapping its lower edge. With the default 360px max-height
            // the (up to 4) results all fit, so overflow-y:auto never engages — the
            // last result ends up hidden behind the tab bar AND can't be scrolled
            // into view (the "stuck dropdown" bug). Cap the height to the space
            // between the dropdown's top and just above the tab bar so the list
            // actually becomes scrollable when it would otherwise be clipped.
            try {
                if (typeof isMobileViewport === 'function' && isMobileViewport()) {
                    const rect = results.getBoundingClientRect();
                    const tabbar = document.getElementById('mobile-tabbar');
                    const tabH = tabbar ? tabbar.getBoundingClientRect().height : 0;
                    const avail = Math.floor(window.innerHeight - rect.top - tabH - 12);
                    if (avail > 120) results.style.maxHeight = avail + 'px';
                } else {
                    results.style.maxHeight = '';
                }
            } catch (_) {}

            if (!results.dataset.boundClicks) {
                results.dataset.boundClicks = 'true';
                results.addEventListener('click', (e) => {
                    const row = e?.target?.closest ? e.target.closest('.search-item[data-idx]') : null;
                    if (!row) return;
                    const idx = Number(row.getAttribute('data-idx'));
                    const picked = Number.isFinite(idx) ? homeSearchItems[idx] : null;
                    if (!picked) return;
                    // Open the rich Movie Spotlight modal (poster/backdrop/cast/IMDb +
                    // the same Log/Update/List/Recommend actions). Falls back to the
                    // old inline selection if the modal isn't available.
                    if (typeof openMovieSpotlight === 'function') {
                        const input = document.getElementById('movie-search-input');
                        if (input) input.value = picked.title || '';
                        const dropdown = document.getElementById('search-results');
                        if (dropdown) dropdown.classList.add('hidden');
                        openMovieSpotlight(picked);
                    } else {
                        router.selectMovie(picked);
                    }
                });

                // Warm the Movie Spotlight details cache before the click lands so the
                // modal opens with no spinner: hover (desktop) + pointerdown (the head
                // start on touch, fires before the tap's click).
                const warm = (e) => {
                    const row = e?.target?.closest ? e.target.closest('.search-item[data-idx]') : null;
                    if (!row) return;
                    const idx = Number(row.getAttribute('data-idx'));
                    const picked = Number.isFinite(idx) ? homeSearchItems[idx] : null;
                    const id = Number(picked?.tmdb_id ?? picked?.id);
                    if (Number.isFinite(id) && id > 0 && typeof prefetchMovieDetails === 'function') prefetchMovieDetails(id);
                };
                results.addEventListener('pointerover', warm);
                results.addEventListener('pointerdown', warm);
            }
        }

        let listsSearchItems = [];
        let listsSearchDebounceTimer = null;
        let listsSearchAbortController = null;
        let listsQuickAddBusy = false;

        function setListsQuickAddEnabledState() {
            const input = document.getElementById('lists-movie-search-input');
            if (!input) return;
            // The "Recs" list is auto-managed by recommendations — hide its manual
            // add-movies search entirely.
            const isRecs = String(listsActiveListName || '').trim().toLowerCase() === 'recs';
            const wrap = input.closest ? input.closest('.lists-add-search') : null;
            if (wrap) wrap.style.display = isRecs ? 'none' : '';
            const hasList = Boolean(String(listsActiveListId || '').trim());
            input.disabled = !hasList || listsQuickAddBusy;
            input.placeholder = hasList
                ? `Add movies to “${String(listsActiveListName || 'this list').trim() || 'this list'}”…`
                : 'Select a list to add movies…';

            try { setListsActiveListActionsEnabledState(); } catch (_) {}
        }

        async function addListsSearchMovieToActiveList(picked) {
            if (listsQuickAddBusy) return;

            if (!supabaseClient) {
                showToast('Supabase SDK failed to load.', { level: 'warn' });
                return;
            }

            const lid = String(listsActiveListId || '').trim();
            if (!lid) {
                showToast('Select a list first.', { level: 'warn' });
                setListsQuickAddEnabledState();
                return;
            }

            let authedUser = null;
            let accessToken = null;
            try {
                const res = await requireAuthOrThrow();
                authedUser = res.user;
                accessToken = res.accessToken;
            } catch (_) {
                openAuthModal();
                return;
            }

            const title = String(picked?.title || '').trim();
            const year = Number(picked?.year ?? picked?.release_year ?? null);
            const tmdbId = Number(picked?.tmdb_id ?? picked?.tmdbId ?? picked?.id ?? null);
            const existingDbMovieId = (isUuidLike(picked?.id) ? String(picked.id).trim() : '');

            if (!title) {
                showToast('Movie title missing. Try a different result.', { level: 'warn' });
                return;
            }

            listsQuickAddBusy = true;
            setListsQuickAddEnabledState();

            try {
                const ensuredMovieId = await ensureMovieFullySyncedForLists({
                    accessToken,
                    title,
                    release_year: Number.isFinite(year) ? year : null,
                    tmdb_id: Number.isFinite(tmdbId) ? tmdbId : null,
                    movie_id: existingDbMovieId || null,
                });

                if (!ensuredMovieId) throw new Error('Failed to ensure movie exists.');

                try {
                    await addMovieToList({ user_id: authedUser.id, list_id: lid, movie_id: ensuredMovieId });
                } catch (err) {
                    const msg = String(err?.message || err);
                    if (/duplicate|unique/i.test(msg)) {
                        showToast('Already in this list.', { level: 'warn' });
                        return;
                    }
                    throw err;
                }

                const listLabel = String(listsActiveListName || '').trim() || 'list';
                showToast(`Added to ${listLabel}!`, { level: 'success' });
                await loadListsPage({ reset: false });
            } catch (err) {
                showToast(`Add failed: ${String(err?.message || err)}`, { level: 'warn' });
            } finally {
                listsQuickAddBusy = false;
                setListsQuickAddEnabledState();
            }
        }

        function setListsSearchLoading() {
            const results = document.getElementById('lists-movie-search-results');
            if (!results) return;
            results.innerHTML = `
                <div class="search-item text-gray justify-center" style="gap:0.5rem;">
                    <span class="icon-sm">${icons.loader}</span>
                    Searching…
                </div>
            `;
            results.classList.remove('hidden');
        }

        function clearListsSearchUI() {
            const results = document.getElementById('lists-movie-search-results');
            if (results) results.classList.add('hidden');
            listsSearchItems = [];
        }

        function renderListsAddMovieSearchResults(items) {
            const results = document.getElementById('lists-movie-search-results');
            if (!results) return;

            listsSearchItems = Array.isArray(items) ? items.slice(0, 50) : [];
            if (listsSearchItems.length === 0) {
                results.innerHTML = `<div class="search-item text-gray justify-center">No movies found</div>`;
                results.classList.remove('hidden');
                return;
            }

            results.innerHTML = listsSearchItems.map((m, idx) => {
                const title = String(m?.title || '').trim();
                const year = m?.year ? String(m.year) : '';
                const genres = Array.isArray(m?.genres)
                    ? m.genres.map(s => String(s).trim()).filter(Boolean)
                    : String(m?.genre || '').split(',').map(s => s.trim()).filter(Boolean);
                const posterPath = String(m?.poster_path || '').trim();
                const posterUrl = posterPath ? `https://image.tmdb.org/t/p/w154${posterPath}` : '';
                const metaParts = [year, (genres.length ? genres.join(', ') : '')].filter(Boolean);

                return `
                    <div class="search-item" data-lists-idx="${idx}" title="Add to list">
                        <div style="display:flex; align-items:center; gap: 0.75rem;">
                            <div style="width: 34px; height: 51px; flex: 0 0 34px; border-radius: 7px; overflow:hidden; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08); display:flex; align-items:center; justify-content:center;">
                                ${posterUrl
                                    ? `<img src="${posterUrl}" alt="" style="width: 100%; height: 100%; object-fit: cover; display:block;" onerror="this.style.display='none'; this.parentElement.style.opacity='0.6';">`
                                    : `<div style="opacity:0.65; color: var(--text-muted); width: 16px; height: 16px; display:flex; align-items:center; justify-content:center;">${icons.film}</div>`
                                }
                            </div>
                            <div>
                                <div class="text-white font-semibold">${escapeHtml(title)}</div>
                                <div class="text-xs text-gray">${escapeHtml(metaParts.join(' • '))}</div>
                            </div>
                        </div>
                        <div style="color:var(--text-muted);">${icons.plusCircle}</div>
                    </div>
                `;
            }).join('');
            results.classList.remove('hidden');

            if (!results.dataset.boundClicks) {
                results.dataset.boundClicks = 'true';
                results.addEventListener('click', (e) => {
                    const row = e?.target?.closest ? e.target.closest('.search-item[data-lists-idx]') : null;
                    if (!row) return;
                    const idx = Number(row.getAttribute('data-lists-idx'));
                    const picked = Number.isFinite(idx) ? listsSearchItems[idx] : null;
                    if (!picked) return;

                    // This Lists-only search does ONE thing: add the picked movie to the active list.
                    const input = document.getElementById('lists-movie-search-input');
                    if (input) input.value = '';
                    clearListsSearchUI();
                    addListsSearchMovieToActiveList(picked).catch(() => null);
                });
            }
        }

        function handleListsAddMovieSearch(query, opts = {}) {
            const inputEl = document.getElementById('lists-movie-search-input');
            const results = document.getElementById('lists-movie-search-results');
            // If the Lists page isn't mounted, do nothing.
            if (!inputEl || !results) return;

            initSearchClearButton('lists-movie-search-input', clearListsSearchUI);

            if (inputEl.disabled) return;

            const q = String(query || '').trim();
            if (!q || q.length < 1) {
                if (listsSearchDebounceTimer) clearTimeout(listsSearchDebounceTimer);
                if (listsSearchAbortController) listsSearchAbortController.abort();
                clearListsSearchUI();
                return;
            }

            // Debounce + cancel in-flight request.
            if (listsSearchDebounceTimer) clearTimeout(listsSearchDebounceTimer);
            if (listsSearchAbortController) listsSearchAbortController.abort();
            listsSearchAbortController = new AbortController();

            // Keep it lightweight; wait until the user types at least 2 characters
            // (2-char titles like "Up"/"Us" must be searchable).
            if (q.length < 2) {
                results.classList.add('hidden');
                listsSearchItems = [];
                return;
            }

            const debounceMs = opts?.force ? 0 : 320;
            listsSearchDebounceTimer = setTimeout(async () => {
                try {
                    setListsSearchLoading();

                    const data = await callSwiftApiSearchMoviesForLists({
                        query: q,
                        page: 1,
                        signal: listsSearchAbortController.signal,
                    });

                    const items = Array.isArray(data?.results) ? data.results : [];
                    renderListsAddMovieSearchResults(items);
                } catch (err) {
                    // Ignore aborts
                    if (String(err?.name || '').toLowerCase() === 'aborterror') return;
                    if (String(err?.message || '').toLowerCase().includes('aborted')) return;

                    results.innerHTML = `<div class="search-item text-gray justify-center">Search unavailable — please try again</div>`;
                    results.classList.remove('hidden');
                }
            }, debounceMs);
        }

