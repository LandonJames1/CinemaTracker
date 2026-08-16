        let feedBound = false;
        let feedFollowingIds = new Set();
        let feedLastSearchQuery = '';
        let feedExcludedUserIds = new Set(); // followed users the active user has UNchecked (excluded from feed)
        let feedCompareOwn = false;          // include the active user's own entries in the feed
        let feedInCommonOnly = false;        // only show movies watched by 2+ of the shown users
        // In-common paging: load 1000 watch logs at a time, "Load More" appends another page.
        const FEED_IN_COMMON_PAGE = 1000;
        let feedInCommonWatchRows = [];      // accumulated raw watch logs across loaded pages
        let feedInCommonOffset = 0;          // how many watch-log rows fetched so far
        let feedInCommonHasMore = false;     // last page came back full → more may exist
        // Normal-feed paging: top 100 newest reviews, then infinite-scroll appends the
        // next 100 at the bottom (mirrors the in-common accumulation above).
        const FEED_NORMAL_PAGE = 100;
        let feedNormalRows = [];             // accumulated driver rows (Movie Ratings) across pages
        let feedNormalOffset = 0;            // how many driver rows fetched so far
        let feedNormalHasMore = false;       // last page came back full → more may exist
        let feedFilterUsersCache = [];       // [{id, username, display_name, icon}] of people you follow (for the Filter modal)
        let feedFilterPrefsLoaded = false;

        let libraryBound = false;
        let libraryOffset = 0;
        const libraryLimit = 100; // top 100, then infinite-scroll loads the next 100 at the bottom
        let libraryHasMore = true;
        let libraryLoading = false;
        let libraryViewMode = 'list';
        let libraryWatchCountMax = 0;
        let libraryPendingWatchCountMaxOnly = false;

        const LIBRARY_LATEST_WATCH_VIEW = 'user_movie_latest_watch';
        const LIBRARY_ITEMS_VIEW = 'user_library_items_v2';
        let libraryItems = [];
        let libraryFacetsLoaded = false;
        // Set by a diary save; consumed by the next renderLibraryList to scroll that
        // entry into view (see consumePendingLibraryScroll).
        let pendingLibraryScrollMovieId = '';

        // (director filter is applied via modal Save)

        // ===== Page title search (My Movies + Feed) =====
        // A small magnifier button on each page opens the shared #page-search-overlay
        // popup; submitting filters the page to movies whose title (close-)matches the
        // query. My Movies filters server-side (ilike, paginated); Feed filters the
        // already-loaded rows client-side. Both use loose/"fuzzy" matching so "Du" finds
        // "Dune". Empty query = no filter.
        let librarySearchQuery = '';
        let feedSearchQuery = '';
        let pageSearchContext = ''; // 'library' | 'feed' — which page the open popup targets

        // Normalize a string for loose matching: lowercase, strip accents + anything that
        // isn't a letter/number/space, collapse whitespace.
        function normalizeSearchText(s) {
            return String(s || '')
                .toLowerCase()
                .normalize('NFD').replace(/[̀-ͯ]/g, '')
                .replace(/[^a-z0-9\s]+/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        }

        // Loose title match used by the Feed (client-side). Every whitespace-separated
        // word in the query must appear (as a substring) somewhere in the title — so
        // "du" → "Dune", "dark knight" → "The Dark Knight", order-independent.
        function movieTitleMatchesSearch(title, query) {
            const q = normalizeSearchText(query);
            if (!q) return true;
            const hay = normalizeSearchText(title);
            if (!hay) return false;
            return q.split(' ').every((word) => word && hay.includes(word));
        }

        // Apply the My Movies magnifier search to a library query. Loose/"fuzzy" match by
        // TITLE **or** ACTOR **or** DIRECTOR: every query word must appear (as a substring)
        // in the title, OR every word in the actors list, OR every word in the director —
        // so "Jake Gyl" finds Jake Gyllenhaal movies and "Nolan" finds Christopher Nolan's;
        // word order doesn't matter. Empty query = no-op.
        function applyLibrarySearchFilter(q) {
            const searchNeedle = String(librarySearchQuery || '').trim();
            if (!searchNeedle) return q;
            // Strip characters that would break PostgREST's or() filter grammar.
            const words = searchNeedle.split(/\s+/)
                .map((w) => w.replace(/[,()*%\\]/g, '').trim())
                .filter(Boolean);
            if (!words.length) return q;
            const titleAnd = 'and(' + words.map((w) => `title.ilike.*${w}*`).join(',') + ')';
            const actorAnd = 'and(' + words.map((w) => `actors.ilike.*${w}*`).join(',') + ')';
            const directorAnd = 'and(' + words.map((w) => `director.ilike.*${w}*`).join(',') + ')';
            return q.or(`${titleAnd},${actorAnd},${directorAnd}`);
        }

        // ===== My Movies search typeahead (movies + actors from the user's library) =====
        // As the user types (≥2 chars) in the My Movies search popup we show a dropdown of
        // matching MOVIES (with posters) and ACTORS (with headshots) drawn ONLY from their
        // own library. Picking one runs the search; but selecting is optional — hitting
        // Enter with any text (e.g. "harry pot") still runs the loose title/actor search.
        let librarySearchIndex = null;        // { movies:[…], actors:[…] } for the current user
        let librarySearchIndexUserId = null;
        let librarySearchIndexInflight = null;
        let librarySuggestDebounceTimer = null;
        let librarySuggestToken = 0;          // guards stale renders / lazy headshot loads

        function invalidateLibrarySearchIndex() {
            librarySearchIndex = null;
            librarySearchIndexUserId = null;
            librarySearchIndexInflight = null;
        }

        // Build a { movies, actors, directors } typeahead index from `user_library_items_*`
        // view rows (each row has title/poster_path/tmdb_id/actors/director/release_year).
        // Shared by My Movies (whole library) AND the Lists detail search (one list's rows).
        function buildSearchIndexFromRows(rows) {
            const list = Array.isArray(rows) ? rows : [];
            const movies = [];
            const actorMap = new Map();    // norm-name → { name, norm, count, poster_path, tmdb_id }
            const directorMap = new Map(); // same shape (a movie usually has one director)
            const addPerson = (map, rawName, r) => {
                const name = String(rawName || '').trim();
                if (!name) return;
                const norm = normalizeSearchText(name);
                if (!norm) return;
                const existing = map.get(norm);
                if (existing) {
                    existing.count += 1;
                    if (!existing.poster_path && r?.poster_path) existing.poster_path = r.poster_path;
                } else {
                    map.set(norm, { name, norm, count: 1, poster_path: r?.poster_path || null, tmdb_id: r?.tmdb_id ?? null });
                }
            };
            for (const r of list) {
                const title = String(r?.title || '').trim();
                if (title) {
                    movies.push({
                        title,
                        norm: normalizeSearchText(title),
                        poster_path: r?.poster_path || null,
                        tmdb_id: r?.tmdb_id ?? null,
                        movie_id: r?.movie_id ? String(r.movie_id) : '',
                        year: (r?.release_year === null || r?.release_year === undefined) ? '' : String(r.release_year),
                    });
                }
                const actorsStr = String(r?.actors || '').trim();
                if (actorsStr) actorsStr.split(',').forEach((raw) => addPerson(actorMap, raw, r));
                // Director is usually a single name, but split on commas for co-directors.
                const directorStr = String(r?.director || '').trim();
                if (directorStr) directorStr.split(',').forEach((raw) => addPerson(directorMap, raw, r));
            }
            return { movies, actors: Array.from(actorMap.values()), directors: Array.from(directorMap.values()) };
        }

        async function buildLibrarySearchIndex(userId) {
            const uid = String(userId || '').trim();
            if (!uid || !supabaseClient) return { movies: [], actors: [], directors: [] };
            const { data, error } = await supabaseClient
                .from(LIBRARY_ITEMS_VIEW)
                .select('movie_id, title, tmdb_id, poster_path, actors, director, release_year')
                .eq('user_id', uid)
                .limit(3000);
            if (error) throw error;
            return buildSearchIndexFromRows(data);
        }

        async function ensureLibrarySearchIndex() {
            let uid = librarySearchIndexUserId;
            try {
                const { user } = await requireAuthOrThrow();
                uid = String(user?.id || '').trim();
            } catch (_) { /* keep whatever we had */ }
            if (librarySearchIndex && librarySearchIndexUserId === uid) return librarySearchIndex;
            if (librarySearchIndexInflight) return librarySearchIndexInflight;
            librarySearchIndexInflight = buildLibrarySearchIndex(uid)
                .then((idx) => {
                    librarySearchIndex = idx;
                    librarySearchIndexUserId = uid;
                    librarySearchIndexInflight = null;
                    return idx;
                })
                .catch((e) => { librarySearchIndexInflight = null; throw e; });
            return librarySearchIndexInflight;
        }

        // The search popup's typeahead serves two contexts: 'library' (My Movies, whole
        // library) and 'lists' (a Lists detail page, that one list). Feed has none.
        function pageSearchHasTypeahead() {
            return pageSearchContext === 'library' || pageSearchContext === 'lists';
        }
        function currentSearchIndex() {
            return pageSearchContext === 'lists' ? listsSearchIndex : librarySearchIndex;
        }
        async function ensureSearchIndexForContext() {
            if (pageSearchContext === 'lists') {
                return (typeof ensureListsSearchIndex === 'function') ? ensureListsSearchIndex() : (listsSearchIndex || { movies: [], actors: [] });
            }
            return ensureLibrarySearchIndex();
        }

        // Every query word must appear (as a substring) in the normalized haystack —
        // loose + order-independent, matching the server-side search behavior.
        function librarySuggestMatches(normHay, words) {
            return words.every((w) => normHay.includes(w));
        }

        function librarySuggestThumbHtml({ img, isActor }) {
            const cls = `page-search-suggest-thumb${isActor ? ' is-actor' : ''}`;
            if (img) return `<span class="${cls}"><img src="${escapeHtml(img)}" alt="" loading="lazy" onerror="this.style.display='none'"></span>`;
            return `<span class="${cls}"></span>`;
        }

        function renderLibrarySuggestions(rawValue) {
            const box = document.getElementById('page-search-suggest');
            if (!box) return;
            const value = String(rawValue || '');
            const norm = normalizeSearchText(value);
            if (norm.length < 2 || !pageSearchHasTypeahead()) {
                hideLibrarySuggestions();
                return;
            }
            const words = norm.split(' ').filter(Boolean);
            const scopeLabel = (pageSearchContext === 'lists') ? 'this list' : 'your library';

            const index = currentSearchIndex();
            if (!index) {
                box.style.display = 'block';
                box.innerHTML = `<div class="page-search-suggest-loading">Searching…</div>`;
                return;
            }

            const MAX_EACH = 6;
            const movies = index.movies
                .filter((m) => librarySuggestMatches(m.norm, words))
                .slice(0, MAX_EACH);
            const actors = index.actors
                .filter((a) => librarySuggestMatches(a.norm, words))
                .sort((a, b) => b.count - a.count)
                .slice(0, MAX_EACH);
            const directors = (index.directors || [])
                .filter((d) => librarySuggestMatches(d.norm, words))
                .sort((a, b) => b.count - a.count)
                .slice(0, MAX_EACH);

            if (!movies.length && !actors.length && !directors.length) {
                box.style.display = 'block';
                box.innerHTML = `<div class="page-search-suggest-empty">No matches in ${scopeLabel} — press Enter to search anyway.</div>`;
                return;
            }

            const token = ++librarySuggestToken;
            const parts = [];
            if (movies.length) {
                parts.push(`<div class="page-search-suggest-head">Movies</div>`);
                movies.forEach((m) => {
                    const poster = m.poster_path ? dashBuildPosterUrl(m.poster_path, 'w92') : '';
                    parts.push(
                        `<button type="button" class="page-search-suggest-row" data-suggest-kind="movie" data-suggest-value="${escapeHtml(m.title)}">`
                        + librarySuggestThumbHtml({ img: poster, isActor: false })
                        + `<span class="page-search-suggest-text"><span class="pss-title">${escapeHtml(m.title)}</span>`
                        + `<span class="pss-sub">Movie${m.year ? ` · ${escapeHtml(m.year)}` : ''}</span></span></button>`
                    );
                });
            }
            if (actors.length) {
                parts.push(`<div class="page-search-suggest-head">Actors</div>`);
                actors.forEach((a, i) => {
                    const thumbId = `pss-actor-${token}-${i}`;
                    parts.push(
                        `<button type="button" class="page-search-suggest-row" data-suggest-kind="actor" data-suggest-value="${escapeHtml(a.name)}">`
                        + `<span class="page-search-suggest-thumb is-actor" id="${thumbId}"></span>`
                        + `<span class="page-search-suggest-text"><span class="pss-title">${escapeHtml(a.name)}</span>`
                        + `<span class="pss-sub">Actor · ${a.count} movie${a.count === 1 ? '' : 's'}</span></span></button>`
                    );
                    // Lazy-load the real headshot (cached across the app via dashPersonAvatarCache).
                    loadSuggestActorHeadshot(a.name, thumbId, token, 'Acting');
                });
            }
            if (directors.length) {
                parts.push(`<div class="page-search-suggest-head">Directors</div>`);
                directors.forEach((d, i) => {
                    const thumbId = `pss-director-${token}-${i}`;
                    parts.push(
                        `<button type="button" class="page-search-suggest-row" data-suggest-kind="director" data-suggest-value="${escapeHtml(d.name)}">`
                        + `<span class="page-search-suggest-thumb is-actor" id="${thumbId}"></span>`
                        + `<span class="page-search-suggest-text"><span class="pss-title">${escapeHtml(d.name)}</span>`
                        + `<span class="pss-sub">Director · ${d.count} movie${d.count === 1 ? '' : 's'}</span></span></button>`
                    );
                    loadSuggestActorHeadshot(d.name, thumbId, token, 'Directing');
                });
            }
            box.style.display = 'block';
            box.innerHTML = parts.join('');
        }

        async function loadSuggestActorHeadshot(name, thumbId, token, department = 'Acting') {
            let path = null;
            try { path = await dashFetchPersonProfile({ name, department }); } catch (_) { path = null; }
            if (token !== librarySuggestToken) return; // a newer render superseded this one
            const el = document.getElementById(thumbId);
            if (!el || !path) return;
            const url = dashBuildPersonUrl(path, 'w185');
            if (!url) return;
            el.innerHTML = `<img src="${escapeHtml(url)}" alt="" loading="lazy" onerror="this.style.display='none'">`;
        }

        function hideLibrarySuggestions() {
            const box = document.getElementById('page-search-suggest');
            if (box) { box.style.display = 'none'; box.innerHTML = ''; }
        }

        function handleLibrarySearchInput(rawValue) {
            if (!pageSearchHasTypeahead()) { hideLibrarySuggestions(); return; }
            const value = String(rawValue || '');
            const norm = normalizeSearchText(value);
            if (norm.length < 2) { hideLibrarySuggestions(); return; }
            // Make sure the right index is loaded (My Movies: one cached query; Lists: the
            // active list's rows, already built by loadListsPage).
            ensureSearchIndexForContext().then(() => {
                const input = document.getElementById('page-search-input');
                if (input && pageSearchHasTypeahead()) renderLibrarySuggestions(input.value);
            }).catch(() => {});
            if (librarySuggestDebounceTimer) clearTimeout(librarySuggestDebounceTimer);
            librarySuggestDebounceTimer = setTimeout(() => renderLibrarySuggestions(value), 110);
        }

        // Delegated click for a suggestion row: fill the input + run the search.
        function pickLibrarySuggestion(value) {
            const input = document.getElementById('page-search-input');
            if (input) input.value = String(value || '');
            hideLibrarySuggestions();
            submitPageSearch();
        }

        // Reflect the active-search state on a page's magnifier button (solid highlight +
        // tooltip showing what's being searched).
        function syncPageSearchButton(context) {
            // Lists owns its own control-row sync (button enable/highlight + clear state).
            if (context === 'lists') {
                if (typeof setListsActiveListActionsEnabledState === 'function') setListsActiveListActionsEnabledState();
                return;
            }
            const btnId = context === 'feed' ? 'feed-search-btn' : 'library-search-btn';
            const query = context === 'feed' ? feedSearchQuery : librarySearchQuery;
            const btn = document.getElementById(btnId);
            if (!btn) return;
            const active = !!String(query || '').trim();
            btn.classList.toggle('filter-active', active);
            btn.title = active
                ? `Searching: "${query}" — tap to change`
                : (context === 'feed' ? 'Search by title' : 'Search by title, actor, or director');
            // Keep the RED Clear highlight in sync — a title search also counts as
            // something to clear.
            if (context === 'feed') syncFeedClearButton();
            else syncLibraryClearButton();
        }

        // Bind the delegated click handler for the typeahead dropdown (once).
        let pageSearchSuggestBound = false;
        function ensurePageSearchSuggestListener() {
            if (pageSearchSuggestBound) return;
            const box = document.getElementById('page-search-suggest');
            if (!box) return;
            box.addEventListener('click', (e) => {
                const row = e.target?.closest ? e.target.closest('.page-search-suggest-row') : null;
                if (!row) return;
                e.preventDefault();
                pickLibrarySuggestion(row.dataset.suggestValue || '');
            });
            pageSearchSuggestBound = true;
        }

        function openPageSearch(context) {
            pageSearchContext = (context === 'feed') ? 'feed' : (context === 'lists' ? 'lists' : 'library');
            const overlay = document.getElementById('page-search-overlay');
            const input = document.getElementById('page-search-input');
            const titleEl = document.getElementById('page-search-title');
            const labelEl = document.getElementById('page-search-label');
            if (!overlay || !input) return;
            const isFeed = pageSearchContext === 'feed';
            const isLists = pageSearchContext === 'lists';
            ensurePageSearchSuggestListener();
            hideLibrarySuggestions();
            if (titleEl) titleEl.textContent = isFeed ? 'Search Feed' : (isLists ? 'Search This List' : 'Search My Movies');
            if (labelEl) labelEl.textContent = isFeed ? 'Movie title' : 'Movie, actor, or director';
            input.placeholder = isFeed ? 'e.g. Dune' : 'e.g. Dune, Gyllenhaal, or Nolan';
            input.value = isFeed ? feedSearchQuery : (isLists ? listsSearchQuery : librarySearchQuery);
            overlay.style.display = 'flex';
            // Warm the index so the first keystroke shows suggestions instantly (Lists' index
            // is already built by loadListsPage; My Movies runs one cached query).
            if (pageSearchHasTypeahead()) ensureSearchIndexForContext().catch(() => {});
            // Focus after the overlay paints so mobile keyboards reliably open.
            setTimeout(() => { try { input.focus(); input.select(); } catch (_) {} }, 30);
        }

        function closePageSearch() {
            hideLibrarySuggestions();
            const overlay = document.getElementById('page-search-overlay');
            if (overlay) overlay.style.display = 'none';
        }

        async function submitPageSearch(e) {
            if (e && e.preventDefault) e.preventDefault();
            const input = document.getElementById('page-search-input');
            const value = String(input?.value || '').trim();
            const context = pageSearchContext;
            closePageSearch();
            if (context === 'feed') {
                feedSearchQuery = value;
                syncPageSearchButton('feed');
                await loadFeedItems();
            } else if (context === 'lists') {
                listsSearchQuery = value;
                syncPageSearchButton('lists');
                if (typeof loadListsPage === 'function') await loadListsPage({ reset: false });
            } else {
                librarySearchQuery = value;
                syncPageSearchButton('library');
                await loadLibraryPage({ reset: true });
            }
        }

        async function clearPageSearch() {
            const context = pageSearchContext;
            const input = document.getElementById('page-search-input');
            if (input) input.value = '';
            closePageSearch();
            if (context === 'feed') {
                if (!feedSearchQuery) return;
                feedSearchQuery = '';
                syncPageSearchButton('feed');
                await loadFeedItems();
            } else if (context === 'lists') {
                if (!listsSearchQuery) return;
                listsSearchQuery = '';
                syncPageSearchButton('lists');
                if (typeof loadListsPage === 'function') await loadListsPage({ reset: false });
            } else {
                if (!librarySearchQuery) return;
                librarySearchQuery = '';
                syncPageSearchButton('library');
                await loadLibraryPage({ reset: true });
            }
        }

        function formatFeedTimestamp(ts) {
            if (!ts) return '';
            const d = new Date(ts);
            if (Number.isNaN(d.getTime())) return '';
            try {
                return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
            } catch (_) {
                return String(ts);
            }
        }

        function initFeedPage() {
            if (feedBound) return;
            feedBound = true;

            // "Who reacted" popup — desktop hover over a count pill shows the reactor
            // avatars; leaving the pill (or popup) hides it after a short grace period.
            document.addEventListener('mouseover', (e) => {
                if (typeof isMobileViewport === 'function' && isMobileViewport()) return;
                const pill = e?.target?.closest ? e.target.closest('.feed-react-pill') : null;
                if (!pill) return;
                showFeedReactWhoPop(pill, pill.dataset.ratingId, pill.dataset.emoji);
            });
            document.addEventListener('mouseout', (e) => {
                if (typeof isMobileViewport === 'function' && isMobileViewport()) return;
                const pill = e?.target?.closest ? e.target.closest('.feed-react-pill') : null;
                if (!pill) return;
                // If we're moving into the popup, its own mouseenter cancels the hide.
                const to = e.relatedTarget;
                if (to && feedReactWhoPopEl && (to === feedReactWhoPopEl || feedReactWhoPopEl.contains(to))) return;
                scheduleHideFeedReactWhoPop();
            });
            // Mobile: any tap outside a count pill / the popup dismisses it.
            document.addEventListener('click', (e) => {
                if (!feedReactWhoPopEl || feedReactWhoPopEl.hasAttribute('hidden')) return;
                const t = e?.target;
                if (t && t.closest && (t.closest('.feed-react-pill') || t.closest('#feed-react-who-pop'))) return;
                hideFeedReactWhoPop();
            }, true);
            // Reposition-safety: scrolling dismisses the popup so it can't float orphaned.
            window.addEventListener('scroll', () => hideFeedReactWhoPop(), true);

            document.addEventListener('click', (e) => {
                const card = e?.target?.closest ? e.target.closest('[data-feed-card]') : null;
                if (!card) return;

                // Don't toggle when clicking buttons/controls.
                const actionEl = e?.target?.closest ? e.target.closest('[data-feed-action]') : null;
                if (actionEl) return;
                // Don't collapse the card when tapping inside the reaction picker/counts
                // padding (which carries no data-feed-action).
                if (e?.target?.closest && e.target.closest('.feed-react-picker, .feed-react-counts')) return;

                card.classList.toggle('is-open');
            });

            document.addEventListener('click', async (e) => {
                const btn = e?.target?.closest ? e.target.closest('[data-feed-action]') : null;
                if (!btn) return;
                const action = String(btn.dataset.feedAction || '').trim();
                const targetUserId = String(btn.dataset.feedUserId || '').trim();
                if (!action) return;

                if (action === 'refresh') {
                    await loadFeedPage();
                    return;
                }

                if (action === 'open_profile') {
                    if (targetUserId) openUserProfile(targetUserId);
                    return;
                }

                // Tapping ONLY the poster opens the full Movie Spotlight modal (same one
                // as Home search + Lists). Clicking anywhere else on the card still toggles
                // the review/expand. Builds a spotlight-compatible movie object from the
                // poster's data attrs; the spotlight fetches full TMDB details by tmdb_id.
                if (action === 'open_spotlight') {
                    if (typeof openMovieSpotlight !== 'function') return;
                    const tmdbId = Number(btn.dataset.feedMovieTmdb);
                    const movie = {
                        id: String(btn.dataset.feedMovieId || '').trim(),
                        tmdb_id: (Number.isFinite(tmdbId) && tmdbId > 0) ? tmdbId : undefined,
                        title: String(btn.dataset.feedMovieTitle || '').trim(),
                        year: String(btn.dataset.feedMovieYear || '').trim() || null,
                        release_year: String(btn.dataset.feedMovieYear || '').trim() || null,
                        poster_path: String(btn.dataset.feedMoviePoster || '').trim(),
                    };
                    try { openMovieSpotlight(movie); } catch (err) {
                        showToast(`Open details failed: ${String(err?.message || err)}`, { level: 'warn' });
                    }
                    return;
                }

                if (action === 'open_filter') {
                    await openFeedFilterModal();
                    return;
                }

                if (action === 'clear') {
                    // Reset ALL feed filters (follow excludes, compare-own, in-common) +
                    // the title search back to default.
                    feedExcludedUserIds.clear();
                    feedCompareOwn = false;
                    feedInCommonOnly = false;
                    feedSearchQuery = '';
                    saveFeedFilterPrefs();        // persists + syncs the Filter button
                    syncPageSearchButton('feed');
                    await loadFeedPage();
                    return;
                }

                if (action === 'open_search') {
                    openPageSearch('feed');
                    return;
                }

                // Toggle the emoji picker open/closed for one review (scoped to this card).
                if (action === 'open_reactions') {
                    const details = btn.closest ? btn.closest('.feed-card-details') : null;
                    const picker = details ? details.querySelector('.feed-react-picker') : null;
                    if (picker) {
                        if (picker.hasAttribute('hidden')) picker.removeAttribute('hidden');
                        else picker.setAttribute('hidden', '');
                    }
                    return;
                }

                if (action === 'filter_apply') {
                    await closeFeedFilterModal();
                    return;
                }

                if (action === 'filter_select_all') {
                    feedExcludedUserIds.clear();
                    saveFeedFilterPrefs();
                    renderFeedFilterList();
                    return;
                }

                if (action === 'filter_select_none') {
                    for (const u of feedFilterUsersCache) {
                        const id = String(u?.id || '').trim();
                        if (id) feedExcludedUserIds.add(id);
                    }
                    saveFeedFilterPrefs();
                    renderFeedFilterList();
                    return;
                }

                if (!supabaseClient) {
                    showToast('Supabase SDK failed to load.', { level: 'warn' });
                    return;
                }

                let authedUser = null;
                let authedAccessToken = null;
                try {
                    if (guardGuestWrite()) return;
                    const { user, accessToken } = await requireAuthOrThrow();
                    authedUser = user;
                    authedAccessToken = accessToken;
                } catch (err) {
                    showToast(String(err?.message || err), { level: 'warn' });
                    return;
                }

                // Add a feed movie straight to the user's Bucket List. The movie is
                // already in the catalog (it came from a Movie Ratings row), so we add
                // by movie_id directly — no TMDB sync needed. Blocks duplicates with a
                // quick, brief toast instead of inserting twice.
                if (action === 'add_bucket') {
                    const movieId = String(btn.dataset.feedMovieId || '').trim();
                    const movieTitle = String(btn.dataset.feedMovieTitle || '').trim() || 'This movie';
                    if (!movieId) return;
                    try {
                        const bucketId = await ensureBucketListForUser({ user_id: authedUser.id });
                        if (!bucketId) return;
                        const { count, error: dupErr } = await supabaseClient
                            .from('Movie Lists')
                            .select('movie_id', { count: 'exact', head: true })
                            .eq('list_id', bucketId)
                            .eq('movie_id', movieId);
                        if (dupErr) throw dupErr;
                        if (Number(count) > 0) {
                            feedBucketMovieIds.add(movieId);
                            markFeedBucketButtons(movieId);  // solid star on every card for this movie
                            showToast(`${movieTitle} is already in your Bucket List`, { level: 'info', durationMs: 1600 });
                            return;
                        }
                        await addMovieToList({ user_id: authedUser.id, list_id: bucketId, movie_id: movieId });
                        feedBucketMovieIds.add(movieId);
                        markFeedBucketButtons(movieId);      // solid star: just added
                        showToast(`Added ${movieTitle} to Bucket List`, { level: 'success', durationMs: 1600 });
                    } catch (err) {
                        const msg = String(err?.message || err);
                        if (/duplicate|unique/i.test(msg)) {
                            feedBucketMovieIds.add(movieId);
                            markFeedBucketButtons(movieId);  // already there — reflect it
                            showToast(`${movieTitle} is already in your Bucket List`, { level: 'info', durationMs: 1600 });
                            return;
                        }
                        showToast(`Could not add to Bucket List: ${msg}`, { level: 'warn' });
                    }
                    return;
                }

                // Toggle one emoji reaction on a review. Optimistically updates the local
                // counts + repaints the bar, then writes to the DB. Adding a reaction to
                // someone else's review pushes a notification to its author.
                if (action === 'toggle_reaction') {
                    const ratingId = String(btn.dataset.ratingId || '').trim();
                    const emoji = String(btn.dataset.emoji || '').trim();
                    if (!ratingId || !emoji) return;

                    // You can't react to your OWN review — clicking/tapping a count pill on it
                    // just reveals who reacted (the 🙂 add button/picker aren't rendered there).
                    if (feedOwnRatingIds.has(ratingId)) {
                        if (btn.classList && btn.classList.contains('feed-react-pill')) showFeedReactWhoPop(btn, ratingId, emoji);
                        return;
                    }

                    // On mobile there's no hover, so tapping an existing count pill reveals
                    // the "who reacted" popup instead of toggling. The 🙂 picker is how you
                    // add/remove your own reaction on mobile. Desktop clicks still toggle.
                    if (btn.classList && btn.classList.contains('feed-react-pill') && typeof isMobileViewport === 'function' && isMobileViewport()) {
                        showFeedReactWhoPop(btn, ratingId, emoji);
                        return;
                    }

                    const entry = feedReactionEnsureEntry(ratingId);
                    const hadIt = entry.mine.has(emoji);
                    const myId = String(authedUser.id || '').trim();
                    // Make sure the viewer's own avatar is available to the popup (they're
                    // labeled "You", so only the icon matters here).
                    if (myId && !feedReactorInfoById.has(myId)) {
                        feedReactorInfoById.set(myId, { username: '', icon: cachedUserIcon || '' });
                    }
                    if (myId) feedReactWhoViewerId = myId;

                    const usersOf = (em) => { if (!entry.users.has(em)) entry.users.set(em, []); return entry.users.get(em); };

                    // Optimistic local update.
                    if (hadIt) {
                        entry.mine.delete(emoji);
                        entry.counts.set(emoji, Math.max(0, (entry.counts.get(emoji) || 0) - 1));
                        if ((entry.counts.get(emoji) || 0) <= 0) entry.counts.delete(emoji);
                        entry.users.set(emoji, usersOf(emoji).filter((u) => u !== myId));
                    } else {
                        entry.mine.add(emoji);
                        entry.counts.set(emoji, (entry.counts.get(emoji) || 0) + 1);
                        if (myId && !usersOf(emoji).includes(myId)) usersOf(emoji).push(myId);
                    }
                    // Grab the picker BEFORE repainting — repaint rewrites the picker's
                    // innerHTML, which detaches the clicked button (so btn.closest would
                    // then return null). Close it once a reaction is made (this card only).
                    const reactDetails = btn.closest ? btn.closest('.feed-card-details') : null;
                    const reactPicker = reactDetails ? reactDetails.querySelector('.feed-react-picker') : null;

                    repaintFeedReactionBars(ratingId);

                    if (reactPicker) reactPicker.setAttribute('hidden', '');

                    try {
                        if (hadIt) {
                            const { error } = await supabaseClient
                                .from('Review Reactions')
                                .delete()
                                .eq('rating_id', ratingId)
                                .eq('user_id', authedUser.id)
                                .eq('emoji', emoji);
                            if (error) throw error;
                        } else {
                            const { error } = await supabaseClient
                                .from('Review Reactions')
                                .insert({ rating_id: ratingId, user_id: authedUser.id, emoji });
                            // A duplicate (already reacted on another device) is fine.
                            if (error && !/duplicate|unique/i.test(String(error.message || error))) throw error;
                            // Notify the review's author (best-effort; the edge action
                            // resolves the author and skips self-reactions).
                            callSwiftApi({ action: 'notify_review_reaction', rating_id: ratingId, emoji }, authedAccessToken).catch(() => null);
                        }
                    } catch (err) {
                        // Roll back the optimistic change on failure.
                        if (hadIt) {
                            entry.mine.add(emoji);
                            entry.counts.set(emoji, (entry.counts.get(emoji) || 0) + 1);
                            if (myId && !usersOf(emoji).includes(myId)) usersOf(emoji).push(myId);
                        } else {
                            entry.mine.delete(emoji);
                            entry.counts.set(emoji, Math.max(0, (entry.counts.get(emoji) || 0) - 1));
                            if ((entry.counts.get(emoji) || 0) <= 0) entry.counts.delete(emoji);
                            entry.users.set(emoji, usersOf(emoji).filter((u) => u !== myId));
                        }
                        repaintFeedReactionBars(ratingId);
                        showToast(`Could not save reaction: ${String(err?.message || err)}`, { level: 'warn' });
                    }
                    return;
                }

                if (!targetUserId) return;
                if (targetUserId === authedUser.id) {
                    showToast('You cannot follow yourself.', { level: 'warn' });
                    return;
                }

                try {
                    if (action === 'follow') {
                        const { error } = await supabaseClient
                            .from('Follows')
                            .insert({ follower_id: authedUser.id, followed_id: targetUserId });
                        if (error) throw error;
                        showToast('Followed!', { level: 'success' });
                        // Best-effort, fire-and-forget: push-notify the person I just
                        // followed ("@me started following you").
                        try {
                            callSwiftApi({ action: 'notify_new_follower', followed_id: targetUserId }, authedAccessToken).catch(() => null);
                        } catch (_) {}
                    }

                    if (action === 'unfollow') {
                        const { error } = await supabaseClient
                            .from('Follows')
                            .delete()
                            .eq('follower_id', authedUser.id)
                            .eq('followed_id', targetUserId);
                        if (error) throw error;
                        showToast('Unfollowed.', { level: 'success' });
                    }

                    // Who I follow drives the feed, the account follow counts and the
                    // leaderboard, so no stored copy of those pages is valid any more.
                    try { invalidatePageSnapshots(['feed', 'account', 'leaderboard']); } catch (_) {}

                    await loadMyFollowingIds();
                    await loadFeedFollowingList();
                    await loadFeedItems();
                    if (feedLastSearchQuery) {
                        await searchFeedUsers(feedLastSearchQuery);
                    }
                } catch (err) {
                    const msg = String(err?.message || err);
                    // Common duplicate follow error
                    if (/duplicate|unique/i.test(msg)) {
                        showToast('You are already following that user.', { level: 'warn' });
                        return;
                    }
                    showToast(`Feed action failed: ${msg}`, { level: 'warn' });
                }
            }, { capture: true });

            // Filter modal: checkbox toggles (followed users + "Compare Own").
            document.addEventListener('change', (e) => {
                const cb = e?.target;
                if (!cb || cb.type !== 'checkbox') return;

                if (cb.id === 'feed-filter-compare-own') {
                    feedCompareOwn = Boolean(cb.checked);
                    saveFeedFilterPrefs();
                    return;
                }

                if (cb.id === 'feed-filter-in-common') {
                    feedInCommonOnly = Boolean(cb.checked);
                    saveFeedFilterPrefs();
                    return;
                }
            });

            // Filter modal: tap an avatar chip to toggle whether that person appears.
            document.addEventListener('click', (e) => {
                const chip = e?.target?.closest ? e.target.closest('.feed-filter-chip') : null;
                if (!chip) return;
                const uid = String(chip.dataset.feedUserId || '').trim();
                if (!uid) return;
                const nowSelected = feedExcludedUserIds.has(uid); // toggling: was excluded → now shown
                if (nowSelected) feedExcludedUserIds.delete(uid);
                else feedExcludedUserIds.add(uid);
                chip.classList.toggle('is-selected', nowSelected);
                chip.setAttribute('aria-pressed', nowSelected ? 'true' : 'false');
                saveFeedFilterPrefs();
            });

            // Filter modal: live search over people you follow.
            document.addEventListener('input', (e) => {
                if (e?.target?.id !== 'feed-filter-search') return;
                renderFeedFilterList();
            });
        }

        function initLibraryPage() {
            if (libraryBound) return;
            libraryBound = true;

            document.addEventListener('click', async (e) => {
                const btn = e?.target?.closest ? e.target.closest('[data-library-action]') : null;
                if (!btn) return;
                const action = String(btn.dataset.libraryAction || '').trim();
                if (!action) return;

                if (action === 'refresh') {
                    await loadLibraryPage({ reset: true });
                    return;
                }
                if (action === 'set_view') {
                    const view = String(btn.dataset.libraryView || '').trim().toLowerCase();
                    setLibraryViewMode(view);
                    return;
                }
                if (action === 'toggle_view') {
                    setLibraryViewMode(libraryViewMode === 'grid' ? 'list' : 'grid');
                    return;
                }
                if (action === 'load_more') {
                    await loadLibraryMore({ replace: false });
                    return;
                }

                if (action === 'open_sort_filter') {
                    openLibrarySortFilterModal();
                    return;
                }
                if (action === 'open_sort') {
                    openLibrarySortFilterModal('sort');
                    return;
                }
                if (action === 'open_filters') {
                    openLibrarySortFilterModal('filters');
                    return;
                }

                if (action === 'clear') {
                    // Reset ALL filters/sort + the title search back to default.
                    librarySortFilterState = getDefaultLibrarySortFilterState();
                    librarySortFilterDraft = null;
                    librarySearchQuery = '';
                    syncPageSearchButton('library');
                    await loadLibraryPage({ reset: true });
                    return;
                }

                if (action === 'open_search') {
                    openPageSearch('library');
                    return;
                }

                if (action === 'cancel_sort_filter') {
                    closeLibrarySortFilterModal({ restoreDraft: true });
                    return;
                }

                if (action === 'reset_sort_filter_draft') {
                    ensureLibrarySortFilterStateInitialized();
                    setLibrarySortFilterModalFromState(getDefaultLibrarySortFilterState());
                    return;
                }

                if (action === 'save_sort_filter') {
                    saveLibrarySortFilterModal();
                    return;
                }

                if (action === 'clear_sort_filter_part') {
                    const part = String(btn.dataset.part || '').trim();
                    if (!clearLibrarySortFilterPart(part)) return;
                    await loadLibraryPage({ reset: true });
                    return;
                }

                if (action === 'edit_entry') {
                    const mid = String(btn.dataset.movieId || '').trim();
                    const title = String(btn.dataset.movieTitle || '').trim();
                    const tmdbRaw = String(btn.dataset.tmdbId || '').trim();
                    const posterRaw = String(btn.dataset.posterPath || '').trim();
                    if (!mid && !tmdbRaw) return;

                    e.preventDefault?.();
                    e.stopPropagation?.();

                    // Close whichever surface this was clicked from — the standalone
                    // diary popup or the spotlight's "My Review" tab — so it doesn't
                    // sit on top of the Update Ratings page we're about to open.
                    closeLibraryMovieModal();
                    try { closeMovieSpotlight(); } catch (_) {}

                    (async () => {
                        try {
                            // Reuse the exact same update-ratings flow as the Home search dropdown
                            // (and Data Dash poster clicks): set selectedMovie, then jump straight
                            // to the update-ratings page with the existing rating + watch logs loaded.
                            router.selectedMovie = {
                                id: mid || undefined,
                                db_movie_id: mid || undefined,
                                tmdb_id: tmdbRaw ? Number(tmdbRaw) : undefined,
                                title: title || undefined,
                                poster_path: posterRaw || undefined,
                            };
                            await router.startUpdateRatings();
                        } catch (err) {
                            const msg = String(err?.message || err);
                            if (/log in/i.test(msg)) {
                                openAuthModal();
                                return;
                            }
                            showToast(msg, { level: 'warn' });
                        }
                    })().catch(() => {});
                    return;
                }

                if (action === 'delete_entry') {
                    const mid = String(btn.dataset.movieId || '').trim();
                    const title = String(btn.dataset.movieTitle || '').trim();
                    if (!mid) return;

                    (async () => {
                        try {
                            await openDeleteRatingModalForMovie({ movie_id: mid, title, source: 'library' });
                        } catch (err) {
                            const msg = String(err?.message || err);
                            if (/log in/i.test(msg)) {
                                openAuthModal();
                                return;
                            }
                            showToast(msg, { level: 'warn' });
                        }
                    })().catch(() => {});
                    return;
                }

                if (action === 'recommend') {
                    const mid = String(btn.dataset.movieId || '').trim();
                    const title = String(btn.dataset.movieTitle || '').trim();
                    if (!mid) return;
                    openRecModal({ db_movie_id: mid, title }).catch(() => {});
                    return;
                }
            }, { capture: true });

            syncLibraryViewUI();
        }

        function setLibraryViewMode(view) {
            const next = String(view || '').trim().toLowerCase() === 'grid' ? 'grid' : 'list';
            libraryViewMode = next;
            syncLibraryViewUI();
            renderLibraryList();
        }

        function syncLibraryViewUI() {
            const btn = document.getElementById('library-view-toggle-btn');
            if (!btn) return;
            // Icon-only: shows the view you'll switch TO when you tap it (grid icon while in
            // list view, list icon while in grid view).
            const switchingToGrid = libraryViewMode !== 'grid';
            btn.innerHTML = switchingToGrid ? icons.grid : icons.list;
            const label = switchingToGrid ? 'Grid view' : 'List view';
            btn.title = label;
            btn.setAttribute('aria-label', label);
            // Plain outline button — same look as Filters/Sort (no brand fill).
            btn.classList.remove('filter-active');
        }

        function getLibraryWatchCountRangeEls() {
            return {
                rail: document.getElementById('library-watch-count-rail'),
                minLabel: document.getElementById('library-watch-count-min'),
                maxLabel: document.getElementById('library-watch-count-max'),
            };
        }

        function setLibraryWatchCountRangeUI({ minVal, maxVal, maxAvail }) {
            const els = getLibraryWatchCountRangeEls();
            if (!els.rail) return;

            const maxAvailable = Math.max(0, Number(maxAvail) || 0);
            const minV = Number.isFinite(Number(minVal)) ? Number(minVal) : 1;
            const maxV = Number.isFinite(Number(maxVal)) ? Number(maxVal) : maxAvailable || 1;

            els.rail.dataset.minVal = String(minV);
            els.rail.dataset.maxVal = String(maxV);
            els.rail.dataset.maxAvail = String(maxAvailable);

            const disabled = maxAvailable <= 0;
            els.rail.classList.toggle('is-disabled', disabled);
            if (els.minLabel) els.minLabel.textContent = disabled ? '—' : String(minV);
            if (els.maxLabel) els.maxLabel.textContent = disabled ? '—' : String(maxV);

            const fill = els.rail.querySelector('.library-watch-rail-fill');
            const minHandle = els.rail.querySelector('[data-handle="min"]');
            const maxHandle = els.rail.querySelector('[data-handle="max"]');
            if (!fill || !minHandle || !maxHandle || disabled) {
                if (fill) {
                    fill.style.left = '0%';
                    fill.style.right = '100%';
                }
                if (minHandle) minHandle.style.left = '0%';
                if (maxHandle) maxHandle.style.left = '100%';
                return;
            }

            const denom = Math.max(1, maxAvailable - 1);
            const minPct = ((minV - 1) / denom) * 100;
            const maxPct = ((maxV - 1) / denom) * 100;
            const left = Math.max(0, Math.min(100, minPct));
            const right = Math.max(0, Math.min(100, 100 - maxPct));
            fill.style.left = `${left}%`;
            fill.style.right = `${right}%`;
            minHandle.style.left = `${left}%`;
            maxHandle.style.left = `${maxPct}%`;
        }

        function setLibraryWatchCountRangeFromState(state) {
            const maxAvailable = Math.max(0, Number(libraryWatchCountMax) || 0);
            const minState = Number(state?.watchCountMin);
            const maxState = Number(state?.watchCountMax);
            let minVal = Number.isFinite(minState) && minState > 0 ? minState : 1;
            let maxVal = Number.isFinite(maxState) && maxState > 0 ? maxState : (maxAvailable || 1);
            if (maxAvailable > 0) {
                minVal = Math.max(1, Math.min(minVal, maxAvailable));
                maxVal = Math.max(minVal, Math.min(maxVal, maxAvailable));
            }
            setLibraryWatchCountRangeUI({ minVal, maxVal, maxAvail: maxAvailable });
        }

        function initLibraryWatchCountRange() {
            const els = getLibraryWatchCountRangeEls();
            if (!els.rail) return;
            if (els.rail.dataset.boundRange) return;
            els.rail.dataset.boundRange = 'true';

            let activeHandle = null;

            const valueFromClientX = (clientX) => {
                const maxAvailable = Math.max(0, Number(els.rail.dataset.maxAvail) || 0);
                if (maxAvailable <= 0) return 1;
                const rect = els.rail.getBoundingClientRect();
                const raw = (clientX - rect.left) / Math.max(1, rect.width);
                const pct = Math.max(0, Math.min(1, raw));
                const val = Math.round(1 + pct * Math.max(1, maxAvailable - 1));
                return Math.max(1, Math.min(maxAvailable, val));
            };

            const updateValues = (nextMin, nextMax) => {
                const maxAvailable = Math.max(0, Number(els.rail.dataset.maxAvail) || 0);
                if (maxAvailable <= 0) return;
                let minVal = Math.max(1, Math.min(nextMin, maxAvailable));
                let maxVal = Math.max(1, Math.min(nextMax, maxAvailable));
                if (minVal > maxVal) {
                    if (activeHandle === 'min') minVal = maxVal;
                    else maxVal = minVal;
                }
                setLibraryWatchCountRangeUI({ minVal, maxVal, maxAvail: maxAvailable });
            };

            const pickNearestHandle = (clientX) => {
                const minVal = Number(els.rail.dataset.minVal) || 1;
                const maxVal = Number(els.rail.dataset.maxVal) || 1;
                const targetVal = valueFromClientX(clientX);
                return Math.abs(targetVal - minVal) <= Math.abs(targetVal - maxVal) ? 'min' : 'max';
            };

            const onPointerMove = (e) => {
                if (!activeHandle) return;
                const minVal = Number(els.rail.dataset.minVal) || 1;
                const maxVal = Number(els.rail.dataset.maxVal) || 1;
                const nextVal = valueFromClientX(e.clientX);
                if (activeHandle === 'min') updateValues(nextVal, maxVal);
                else updateValues(minVal, nextVal);
            };

            const onPointerUp = () => {
                activeHandle = null;
                document.removeEventListener('pointermove', onPointerMove);
                document.removeEventListener('pointerup', onPointerUp);
            };

            els.rail.addEventListener('pointerdown', (e) => {
                if (els.rail.classList.contains('is-disabled')) return;
                const handle = e?.target?.closest ? e.target.closest('[data-handle]') : null;
                activeHandle = handle ? String(handle.dataset.handle || '').trim() : pickNearestHandle(e.clientX);
                onPointerMove(e);
                document.addEventListener('pointermove', onPointerMove);
                document.addEventListener('pointerup', onPointerUp);
            });
        }

        let librarySortFilterState = null;
        let librarySortFilterDraft = null;

        function getDefaultLibrarySortFilterState() {
            return {
                sortKey: 'watch_date',
                sortDir: 'desc',
                tier: '',
                decade: '',
                movieId: '',
                movieTitle: '',
                mpa: '',
                genre: '',
                watchMethod: '',
                watchCountMin: '',
                watchCountMax: '',
                timeframe: 'all_time',
            };
        }

        function ensureLibrarySortFilterStateInitialized() {
            if (!librarySortFilterState) {
                librarySortFilterState = getDefaultLibrarySortFilterState();
            }
        }

        function clearLibrarySortFilterPart(part) {
            const key = String(part || '').trim();
            if (!key) return false;
            ensureLibrarySortFilterStateInitialized();
            const def = getDefaultLibrarySortFilterState();
            const next = { ...librarySortFilterState };

            if (key === 'sort') {
                next.sortKey = def.sortKey;
                next.sortDir = def.sortDir;
            } else if (key === 'timeframe') {
                next.timeframe = def.timeframe;
            } else if (key === 'watchCount') {
                next.watchCountMin = '';
                next.watchCountMax = '';
            } else if (key === 'movieId') {
                next.movieId = '';
                next.movieTitle = '';
            } else if (Object.prototype.hasOwnProperty.call(next, key)) {
                next[key] = '';
            } else {
                return false;
            }

            librarySortFilterState = next;
            librarySortFilterDraft = null;
            return true;
        }

        function getLibrarySortFilterModalEls() {
            return {
                overlay: document.getElementById('library-sortfilter-overlay'),
                sortKey: document.getElementById('library-modal-sort-key'),
                sortDir: document.getElementById('library-modal-sort-dir'),
                tier: document.getElementById('library-modal-filter-tier'),
                decade: document.getElementById('library-modal-filter-decade'),
                mpa: document.getElementById('library-modal-filter-mpa'),
                genre: document.getElementById('library-modal-filter-genre'),
                watchMethod: document.getElementById('library-modal-filter-watchmethod'),
                timeframe: document.getElementById('library-modal-filter-timeframe'),
            };
        }

        function setLibrarySortFilterModalFromState(state) {
            const els = getLibrarySortFilterModalEls();
            if (!els.sortKey || !els.sortDir) return;
            els.sortKey.value = String(state?.sortKey || 'watch_date');
            // Watch Method / Tier / Sort direction are .sf-seg pill groups, not <select>.
            sfSegSetValue(els.sortDir, (String(state?.sortDir || 'desc') === 'asc') ? 'asc' : 'desc');
            sfSegSetValue(els.tier, String(state?.tier || ''));
            sfSegSetValue(els.watchMethod, String(state?.watchMethod || ''));
            if (els.decade) els.decade.value = String(state?.decade || '');
            if (els.mpa) els.mpa.value = String(state?.mpa || '');
            if (els.genre) els.genre.value = String(state?.genre || '');
            if (els.timeframe) els.timeframe.value = String(state?.timeframe || 'all_time');
            setLibraryWatchCountRangeFromState(state || {});
        }

        function readLibrarySortFilterModalState() {
            const els = getLibrarySortFilterModalEls();
            const getVal = (el) => String(el?.value || '').trim();
            const rangeEls = getLibraryWatchCountRangeEls();
            const maxAvail = Number(rangeEls.rail?.dataset?.maxAvail ?? 0);
            const rawMin = Number(rangeEls.rail?.dataset?.minVal ?? NaN);
            const rawMax = Number(rangeEls.rail?.dataset?.maxVal ?? NaN);
            const minVal = Number.isFinite(rawMin) ? rawMin : '';
            const maxVal = Number.isFinite(rawMax) ? rawMax : '';
            const useMin = (Number.isFinite(minVal) && maxAvail > 0 && minVal > 1) ? minVal : '';
            const useMax = (Number.isFinite(maxVal) && maxAvail > 0 && maxVal < maxAvail) ? maxVal : '';
            return {
                sortKey: getVal(els.sortKey) || 'watch_date',
                sortDir: (sfSegGetValue(els.sortDir) === 'asc') ? 'asc' : 'desc',
                tier: sfSegGetValue(els.tier),
                decade: getVal(els.decade),
                movieId: '',
                movieTitle: '',
                mpa: getVal(els.mpa),
                genre: getVal(els.genre),
                watchMethod: sfSegGetValue(els.watchMethod),
                watchCountMin: useMin,
                watchCountMax: useMax,
                timeframe: getVal(els.timeframe) || 'all_time',
            };
        }

        // mode: 'sort' | 'filters' | undefined(both). The Sort + Filters controls live in
        // one modal; the two My Movies buttons just open it focused on one section.
        function openLibrarySortFilterModal(mode) {
            ensureLibrarySortFilterStateInitialized();
            ensureSfSegListener();
            const els = getLibrarySortFilterModalEls();
            if (!els.overlay) return;
            // snapshot current inputs as draft
            librarySortFilterDraft = { ...librarySortFilterState };
            loadLibraryFacets().catch(() => null);
            setLibrarySortFilterModalFromState(librarySortFilterState);
            initLibraryWatchCountRange();
            setLibraryWatchCountRangeFromState(librarySortFilterState);

            // Show only the requested section (both inputs still save together).
            const showSort = mode !== 'filters';
            const showFilters = mode !== 'sort';
            const sortSec = els.overlay.querySelector('[data-sf="sort"]');
            const filterSec = els.overlay.querySelector('[data-sf="filters"]');
            const divider = els.overlay.querySelector('.library-sf-divider');
            if (sortSec) sortSec.style.display = showSort ? '' : 'none';
            if (filterSec) filterSec.style.display = showFilters ? '' : 'none';
            if (divider) divider.style.display = (showSort && showFilters) ? '' : 'none';
            const titleEl = document.getElementById('library-sortfilter-title');
            if (titleEl) titleEl.textContent = mode === 'sort' ? 'Sort' : (mode === 'filters' ? 'Filters' : 'Filters & Sort');

            els.overlay.style.display = 'flex';
            setTimeout(() => {
                try { (showSort ? els.sortKey : els.overlay.querySelector('[data-sf="filters"] .input-field'))?.focus?.(); } catch (_) {}
            }, 0);
        }

        function closeLibrarySortFilterModal({ restoreDraft = false } = {}) {
            const els = getLibrarySortFilterModalEls();
            if (!els.overlay) return;
            if (restoreDraft && librarySortFilterDraft) {
                setLibrarySortFilterModalFromState(librarySortFilterDraft);
            }
            els.overlay.style.display = 'none';
        }

        function saveLibrarySortFilterModal() {
            ensureLibrarySortFilterStateInitialized();
            const next = readLibrarySortFilterModalState();
            next.movieId = String(librarySortFilterState?.movieId || '').trim();
            next.movieTitle = String(librarySortFilterState?.movieTitle || '').trim();
            librarySortFilterState = next;
            librarySortFilterDraft = null;
            closeLibrarySortFilterModal({ restoreDraft: false });
            loadLibraryPage({ reset: true }).catch(() => null);
        }

        function closeLibraryMovieModal() {
            const overlay = document.getElementById('library-movie-overlay');
            if (overlay) { overlay.classList.remove('open'); overlay.style.display = 'none'; overlay.style.zIndex = ''; }
            const titleEl = document.getElementById('library-movie-title');
            if (titleEl) titleEl.textContent = 'Diary Entry';
        }

        // Read ONE of my own diary rows straight from the library view. Used when the
        // movie isn't in the My Movies cache (Data Dash, a spotlight opened from Home)
        // and whenever a caller needs a guaranteed-fresh copy.
        async function fetchMyLibraryEntry(userId, movieId) {
            const uid = String(userId || '').trim();
            const mid = String(movieId || '').trim();
            if (!uid || !mid || !supabaseClient) return undefined;
            try {
                const { data, error } = await supabaseClient
                    .from(LIBRARY_ITEMS_VIEW)
                    .select('*')
                    .eq('user_id', uid)
                    .eq('movie_id', mid)
                    .limit(1);
                if (error) return undefined;               // query failed — caller keeps what it had
                return Array.isArray(data) && data.length ? data[0] : null;  // null = no such entry
            } catch (_) {
                return undefined;
            }
        }

        // Map a library-view row onto the movie shape the Movie Spotlight expects, so
        // the hero + Info tab paint from data we already have (zero network) while the
        // TMDb details fetch fills in backdrop/cast/watch options.
        function libraryRowToSpotlightMovie(it) {
            const mid = String(it?.movie_id || '').trim();
            const tmdbId = Number(it?.tmdb_id);
            return {
                ...it,
                id: mid,
                db_movie_id: mid,
                tmdb_id: (Number.isFinite(tmdbId) && tmdbId > 0) ? tmdbId : undefined,
                title: String(it?.title || '').trim(),
                year: it?.release_year ?? null,
                poster_path: String(it?.poster_path || '').trim(),
                genre: normalizeMovieFieldValue(it?.genre) || '',
                director: normalizeMovieFieldValue(it?.director) || '',
                mpa: normalizeMovieFieldValue(it?.mpa_rating ?? it?.mpa) || '',
                runtime: (() => { const n = Number(it?.runtime_minutes ?? it?.runtime); return Number.isFinite(n) && n > 0 ? n : undefined; })(),
                imdb_rating_pct: (() => {
                    const n = parsePercentLike(it?.imdb_rating_pct ?? it?.imdb_pct ?? it?.imdb_rating ?? it?.imdb, { imdb: true });
                    return (typeof n === 'number') ? n : undefined;
                })(),
                // Picked up by openMovieSpotlight → the "My Review" tab, so it paints
                // immediately instead of waiting on the spotlight's own row fetch.
                _myEntry: it,
            };
        }

        // Tapping a poster/card in My Movies (and the Data Dash posters + the profile
        // "You —" chip) opens the full **Movie Spotlight** on its **My Review** tab —
        // your diary entry with its Edit/Recommend/Delete row, plus Info / Brief / Cast /
        // Where alongside it, so general movie info is one tap away instead of a trip
        // back to the Home search. (The old standalone `#library-movie-overlay` popup is
        // still used by `openProfileMovieReview` for ANOTHER user's entry.)
        //
        // `opts.fresh` skips the My Movies cache and always re-reads the row from the
        // library view — `libraryItems` can still hold a PRE-edit row while the page's
        // own reload is in flight.
        async function openLibraryMovieModal(movieId, opts) {
            const mid = String(movieId || '').trim();
            if (!mid) return;
            let it = (opts && opts.fresh)
                ? null
                : (Array.isArray(libraryItems) ? libraryItems : []).find(x => String(x?.movie_id || '').trim() === mid);
            if (!it) {
                const fetched = await fetchMyLibraryEntry(cachedAuthUser?.id, mid);
                it = fetched || null;
            }
            if (!it) return;

            // Bind the delegated [data-library-action] handlers the diary action row
            // needs — the spotlight can be opened from pages that never ran this.
            try { initLibraryPage(); } catch (_) {}
            try { openMovieSpotlight(libraryRowToSpotlightMovie(it), { tab: 'mine' }); } catch (_) {}
        }

        // Action row at the bottom of the diary body (the spotlight's "My Review" tab).
        //
        // **Delete only.** It used to be Edit / Recommend / Delete, from when this was a
        // standalone popup. Inside the spotlight those two are duplicates of the action
        // footer that's already on screen — Edit did exactly what "Update Ratings" does
        // (`router.startUpdateRatings`), and Recommend opens the same rec modal — so the
        // row now carries only the one action the footer does NOT offer.
        function renderDiaryActionsHtml(it, mid, title, poster_path, esc) {
            return `
                <div class="diary-actions-row">
                    <button type="button" class="diary-action-btn diary-action-delete" data-library-action="delete_entry" data-movie-id="${esc(mid)}" data-movie-title="${esc(title)}">
                        <span class="diary-action-ico">${icons.trash2}</span><span class="diary-action-lbl">Delete</span>
                    </button>
                </div>`;
        }

        // Shared renderer for the Diary Entry modal body — used both for the
        // current user's own entry (`openLibraryMovieModal`, with Edit/Delete/
        // Recommend actions) and for another user's review opened from the
        // profile "Biggest disagreements" chips (`openProfileMovieReview`,
        // `showActions:false`). `it` is a flattened LIBRARY_ITEMS_VIEW row.
        // `showHeader: false` drops the poster + title + meta block at the top — used by
        // the Movie Spotlight's "My Review" tab, whose hero already shows all of that.
        function renderLibraryDiaryBody(it, { showActions = true, showHeader = true } = {}) {
            const mid = String(it?.movie_id || '').trim();
            const esc = (s) => escapeHtml(String(s ?? ''));
            const title = String(it?.title || '').trim() || 'Untitled';
            const year = (it?.release_year === null || it?.release_year === undefined) ? '' : String(it.release_year);
            const poster_path = String(it?.poster_path || '').trim();
            const posterUrl = poster_path ? `https://image.tmdb.org/t/p/w342${poster_path.startsWith('/') ? poster_path : `/${poster_path}`}` : '';
            const tierLabel = dashNormalizeTierLabel(it?.tier);
            const overall = dashFormatScoreWhole(it?.overall_rating);
            const quote = String(it?.fav_quote ?? '').trim();
            const notes = String(it?.notes ?? '').trim();

            const fmtDate = (iso) => {
                const raw = String(iso || '').trim();
                if (!raw) return '';
                const d = new Date(raw.includes('T') ? raw : `${raw}T00:00:00`);
                if (Number.isNaN(d.getTime())) return raw;
                try { return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (_) { return raw; }
            };
            const mostRecent = fmtDate(it?.latest_watch_date);

            const runtimeVal = (() => { const v = normalizeMovieFieldValue(it?.runtime_minutes ?? it?.runtime); if (!v) return ''; const n = Number(v); return (Number.isFinite(n) && n > 0) ? `${Math.round(n)} min` : v; })();
            const mpaVal = normalizeMovieFieldValue(it?.mpa_rating ?? it?.mpa);
            const directorVal = normalizeMovieFieldValue(it?.director);
            const genreVal = normalizeMovieFieldValue(it?.genre);
            const imdbVal = (() => { const raw = (it?.imdb_rating_pct ?? it?.imdb_pct ?? it?.imdb_rating ?? it?.imdb); const n2 = parsePercentLike(raw, { imdb: true }); return (n2 !== null && n2 !== undefined) ? formatPctForDisplay(n2) : ''; })();
            // Whole-number IMDb (no decimals) for the mobile title line, e.g. "88% IMDb".
            const imdbWhole = (() => { const raw = (it?.imdb_rating_pct ?? it?.imdb_pct ?? it?.imdb_rating ?? it?.imdb); const n2 = parsePercentLike(raw, { imdb: true }); return (n2 !== null && n2 !== undefined && Number.isFinite(Number(n2))) ? Math.round(Number(n2)) : null; })();
            const watchCount = Number(it?.watch_count ?? 0);
            const metaBits = [year, directorVal, mpaVal, runtimeVal, genreVal].filter(Boolean).map(esc).join(' · ');
            // On mobile the year + IMDb move up to the title line, so drop them from the meta row.
            const metaBitsNoYear = [directorVal, mpaVal, runtimeVal, genreVal].filter(Boolean).map(esc).join(' · ');

            const subRatings = [
                ['Sound', dashFormatScoreWhole(it?.sound_rating)],
                ['Pace', dashFormatScoreWhole(it?.pacing_rating)],
                ['Imagery', dashFormatScoreWhole(it?.imagery_rating)],
                ['Acting', dashFormatScoreWhole(it?.acting_rating)],
                ['Plot', dashFormatScoreWhole(it?.plot_rating)],
                ['Dialogue', dashFormatScoreWhole(it?.dialogue_rating)],
            ].filter(x => String(x[1] || '').trim());

            if (isMobileViewport()) {
                // Color-coded tier pill: background + text tinted to the movie's tier color.
                const tierLetter = dashTierLetterFromLabel(tierLabel);
                const tierRgb = tierLetter ? `var(--tier-${tierLetter.toLowerCase()}-rgb)` : '107, 114, 128';
                const lastWatchLine = mostRecent
                    ? `<div style="text-align:center; color:rgba(255,255,255,0.55); font-size:0.78rem; margin-bottom:10px;">Last watch: ${esc(mostRecent)}${watchCount > 0 ? ` · ${watchCount} time${watchCount === 1 ? '' : 's'}` : ''}</div>`
                    : '';
                const titleLine = `${esc(title)}${year ? ` (${esc(year)})` : ''}${imdbWhole !== null ? ` - ${imdbWhole}% IMDb` : ''}`;
                const actionsHtml = showActions ? renderDiaryActionsHtml(it, mid, title, poster_path, esc) : '';
                return `
                    ${lastWatchLine}
                    ${showHeader ? `
                    <div style="display:flex; flex-direction:column; align-items:center; gap:12px;">
                        ${posterUrl ? `<img src="${posterUrl}" alt="${esc(title)}" style="width:150px; aspect-ratio:2/3; object-fit:cover; border-radius:12px; border:1px solid rgba(255,255,255,0.1);">` : ''}
                        <div style="text-align:center;">
                            <div style="color:#fff; font-weight:800; font-size:1.15rem; line-height:1.2;">${titleLine}</div>
                            ${metaBitsNoYear ? `<div style="color:rgba(255,255,255,0.6); font-size:0.82rem; margin-top:4px;">${metaBitsNoYear}</div>` : ''}
                        </div>
                    </div>` : ''}
                    <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; justify-content:center; margin-top:12px;">
                        ${overall ? `<span class="dash-quote-pill" style="color:var(--brand); border-color:color-mix(in srgb, var(--brand) 45%, transparent); font-weight:900;">Overall ${esc(overall)}</span>` : ''}
                        ${tierLabel ? `<span class="dash-quote-pill" style="background:rgba(${tierRgb}, 0.22); border-color:rgba(${tierRgb}, 0.5); color:rgb(${tierRgb}); font-weight:900;">${esc(tierLabel)}</span>` : ''}
                    </div>
                    ${subRatings.length ? `<div style="display:flex; flex-wrap:wrap; gap:6px; justify-content:center; margin-top:12px;">${subRatings.map(([k, v]) => `<span class="dash-quote-pill">${esc(k)}: ${esc(v)}</span>`).join('')}</div>` : ''}
                    ${quote ? `<div style="margin-top:14px;"><div style="color:rgba(255,255,255,0.5); font-size:0.72rem; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:4px;">Favorite Quote</div><div style="color:#fff; line-height:1.4;">${esc(quote)}</div></div>` : ''}
                    ${notes ? `<div style="margin-top:14px;"><div style="color:rgba(255,255,255,0.5); font-size:0.72rem; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:4px;">Notes / Review</div><div class="review-notes-scroll" style="color:rgba(255,255,255,0.9); line-height:1.45; white-space:pre-wrap;">${esc(notes)}</div></div>` : ''}
                    ${actionsHtml}
                `;
            }

            const actionsHtmlDesktop = showActions ? renderDiaryActionsHtml(it, mid, title, poster_path, esc) : '';
            return `
                ${showHeader ? `
                <div style="display:flex; flex-direction:column; align-items:center; gap:12px;">
                    ${posterUrl ? `<img src="${posterUrl}" alt="${esc(title)}" style="width:150px; aspect-ratio:2/3; object-fit:cover; border-radius:12px; border:1px solid rgba(255,255,255,0.1);">` : ''}
                    <div style="text-align:center;">
                        <div style="color:#fff; font-weight:800; font-size:1.15rem; line-height:1.2;">${esc(title)}</div>
                        ${metaBits ? `<div style="color:rgba(255,255,255,0.6); font-size:0.82rem; margin-top:4px;">${metaBits}</div>` : ''}
                    </div>
                </div>` : ''}
                <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; justify-content:center; margin-top:12px;">
                    ${overall ? `${dashRenderHelpScore(overall)} <span style="color:rgba(255,255,255,0.6); font-size:0.8rem;">Overall</span>` : ''}
                    ${tierLabel ? dashRenderHelpTier(tierLabel) : ''}
                    ${imdbVal ? `<span class="dash-quote-pill">IMDb ${esc(imdbVal)}</span>` : ''}
                </div>
                ${mostRecent ? `<div style="text-align:center; color:rgba(255,255,255,0.55); font-size:0.78rem; margin-top:8px;">Most recent watch: ${esc(mostRecent)}${watchCount > 0 ? ` · ${watchCount} time${watchCount === 1 ? '' : 's'}` : ''}</div>` : ''}
                ${subRatings.length ? `<div style="display:flex; flex-wrap:wrap; gap:6px; justify-content:center; margin-top:12px;">${subRatings.map(([k, v]) => `<span class="dash-quote-pill">${esc(k)}: ${esc(v)}</span>`).join('')}</div>` : ''}
                ${quote ? `<div style="margin-top:14px;"><div style="color:rgba(255,255,255,0.5); font-size:0.72rem; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:4px;">Favorite Quote</div><div style="color:#fff; line-height:1.4;">${esc(quote)}</div></div>` : ''}
                ${notes ? `<div style="margin-top:14px;"><div style="color:rgba(255,255,255,0.5); font-size:0.72rem; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:4px;">Notes / Review</div><div class="review-notes-scroll" style="color:rgba(255,255,255,0.9); line-height:1.45; white-space:pre-wrap;">${esc(notes)}</div></div>` : ''}
                ${actionsHtmlDesktop}
            `;
        }

        function renderLibraryList() {
            const elList = document.getElementById('library-list');
            const elMeta = document.getElementById('library-meta');
            const wrap = document.getElementById('library-load-more-wrap');
            if (!elList) return;

            // Both views work on phones now (the list view uses compact Feed-style cards).
            const isGrid = String(libraryViewMode || '').trim().toLowerCase() === 'grid';
            elList.style.display = isGrid ? 'block' : 'grid';
            elList.style.gap = '12px';

            const shown = Array.isArray(libraryItems) ? libraryItems.length : 0;
            const slice = Array.isArray(libraryItems) ? libraryItems : [];

            const formatIsoDateLabel = (iso) => {
                const raw = String(iso || '').trim();
                if (!raw) return '';
                const d = new Date(raw.includes('T') ? raw : `${raw}T00:00:00`);
                if (Number.isNaN(d.getTime())) return raw;
                try {
                    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
                } catch (_) {
                    return raw;
                }
            };

            const html = slice.map((it) => {
                const movie_id = String(it?.movie_id || '').trim();
                const title = String(it?.title || '').trim() || 'Untitled';
                const year = (it?.release_year === null || it?.release_year === undefined) ? '' : String(it.release_year);
                const poster_path = String(it?.poster_path || '').trim();
                const posterUrl = poster_path ? `https://image.tmdb.org/t/p/w342${poster_path.startsWith('/') ? poster_path : `/${poster_path}`}` : '';

                const tierLabel = dashNormalizeTierLabel(it?.tier);

                if (isGrid) {
                    // One movie's own score — whole number. Decimals are for averages.
                    const overallGrid = dashFormatScoreWhole(it?.overall_rating);
                    const watchCountRaw = Number(it?.watch_count ?? 0);
                    const watchCount = Number.isFinite(watchCountRaw) ? watchCountRaw : 0;
                    const metaParts = [];
                    if (overallGrid) metaParts.push(dashRenderHelpScore(overallGrid));
                    if (tierLabel) metaParts.push(dashRenderHelpTier(tierLabel));
                    if (watchCount > 0) metaParts.push(`<span class="text-gray">${watchCount} ${watchCount === 1 ? 'Time' : 'Times'}</span>`);
                    const tmdbGrid = Number(it?.tmdb_id);
                    return `
                        <div class="dash-kpi-movie-card"${movie_id ? ` data-library-entry="${escapeHtml(movie_id)}"` : ''}>
                            <div class="dash-kpi-movie-poster" ${movie_id ? `onclick="openLibraryMovieModal('${escapeHtml(movie_id)}')" title="View diary entry"${(Number.isFinite(tmdbGrid) && tmdbGrid > 0) ? ` onpointerdown="if(typeof prefetchMovieDetails==='function')prefetchMovieDetails(${tmdbGrid})"` : ''}` : ''}>
                                ${posterUrl
                                    ? `<img src="${posterUrl}" loading="lazy" decoding="async" alt="${escapeHtml(title)}" style="width: 100%; height: 100%; object-fit: cover; display:block;" onerror="this.closest('div')?.remove?.()">`
                                    : `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; color: var(--text-muted); font-size: 12px;">No poster</div>`
                                }
                            </div>
                            <div class="library-grid-title text-sm text-white">${escapeHtml(title)}${year ? ` <span class="library-grid-year">(${escapeHtml(year)})</span>` : ''}</div>
                            <div class="library-grid-meta tabular-nums">${metaParts.join(' - ')}</div>
                        </div>
                    `;
                }

                const overall = dashFormatScoreWhole(it?.overall_rating);
                const quote = String(it?.fav_quote ?? '').trim();
                const notes = String(it?.notes ?? '').trim();

                const mostRecentLabel = formatIsoDateLabel(it?.latest_watch_date);

                const runtimeRaw = (it?.runtime_minutes ?? it?.runtime);
                const runtimeVal = (() => {
                    const v = normalizeMovieFieldValue(runtimeRaw);
                    if (!v) return '';
                    const n = Number(v);
                    if (Number.isFinite(n) && n > 0) return `${Math.round(n)} min`;
                    return /min/i.test(v) ? v : v;
                })();
                const mpaVal = normalizeMovieFieldValue(it?.mpa_rating ?? it?.mpa);
                const directorVal = normalizeMovieFieldValue(it?.director);
                const genreVal = normalizeMovieFieldValue(it?.genre);
                const imdbVal = (() => {
                    const raw = (it?.imdb_rating_pct ?? it?.imdb_pct ?? it?.imdb_rating ?? it?.imdb);
                    const n2 = parsePercentLike(raw, { imdb: true });
                    if (n2 !== null && n2 !== undefined) return formatPctForDisplay(n2);
                    return '';
                })();

                const ratingChips = [
                    overall ? dashRenderHelpScore(overall) : '',
                    tierLabel ? dashRenderHelpTier(tierLabel) : '',
                ].join('');

                const subRatingRows = [
                    { k: 'Sound', v: dashFormatScoreWhole(it?.sound_rating) },
                    { k: 'Pace', v: dashFormatScoreWhole(it?.pacing_rating) },
                    { k: 'Imagery', v: dashFormatScoreWhole(it?.imagery_rating) },
                    { k: 'Acting', v: dashFormatScoreWhole(it?.acting_rating) },
                    { k: 'Plot', v: dashFormatScoreWhole(it?.plot_rating) },
                    { k: 'Dialogue', v: dashFormatScoreWhole(it?.dialogue_rating) },
                ].filter(x => String(x.v || '').trim());

                const extraMovieChips = renderLibraryInfoChips(it || {}, {
                    blacklist: [
                        // Identity / paging
                        'id', 'user_id', 'movie_id', 'latest_watch_date',

                        // Already shown elsewhere on the card
                        'title', 'release_year', 'tmdb_id', 'imdb_id',
                        'genre', 'genres', 'director', 'director_name',
                        'runtime', 'runtime_minutes', 'mpa', 'mpa_rating', 'is_series',
                        'imdb', 'imdb_rating', 'imdb_pct', 'imdb_rating_pct',

                        // Ratings + tier are already rendered as chips/subchips
                        'overall_rating', 'tier',
                        'sound_rating', 'pacing_rating', 'imagery_rating', 'acting_rating', 'plot_rating', 'dialogue_rating',

                        // Notes/quote already have dedicated sections
                        'fav_quote', 'notes',

                        // Misc
                        'poster_path', 'posterPath', 'poster_url', 'posterUrl',
                        'created_at', 'updated_at',
                    ],
                });

                const posterBackDetailsHtml = (() => {
                    const lines = [];
                    const genreBackHtml = (() => {
                        const raw = String(genreVal || '').trim();
                        if (!raw) return '';
                        const parts = raw
                            .split(/[,|;]/g)
                            .map(s => String(s).trim())
                            .filter(Boolean);
                        if (!parts.length) return '';
                        return parts.map(p => escapeHtml(p)).join('<br>');
                    })();
                    if (runtimeVal) lines.push(`<div class="library-poster-back-line"><span class="library-poster-back-key">Runtime</span><span class="library-poster-back-val">${escapeHtml(runtimeVal)}</span></div>`);
                    if (mpaVal) lines.push(`<div class="library-poster-back-line"><span class="library-poster-back-key">MPA</span><span class="library-poster-back-val">${escapeHtml(mpaVal)}</span></div>`);
                    if (genreBackHtml) lines.push(`<div class="library-poster-back-line"><span class="library-poster-back-key">Genre</span><span class="library-poster-back-val">${genreBackHtml}</span></div>`);
                    if (imdbVal) lines.push(`<div class="library-poster-back-line"><span class="library-poster-back-key">IMDb</span><span class="library-poster-back-val">${escapeHtml(imdbVal)}</span></div>`);
                    return lines.join('');
                })();

                // List view = compact Feed-style card. Tapping anywhere opens the Movie
                // Spotlight on its "My Review" tab (openLibraryMovieModal), where
                // Edit/Recommend/Delete live alongside the general movie info.
                const tmdbList = Number(it?.tmdb_id);
                return `
                    <div class="glass-panel feed-item-card library-feed-card"${movie_id ? ` data-library-entry="${escapeHtml(movie_id)}"` : ''} ${movie_id ? `onclick="openLibraryMovieModal('${escapeHtml(movie_id)}')" role="button" tabindex="0" title="View diary entry"${(Number.isFinite(tmdbList) && tmdbList > 0) ? ` onpointerdown="if(typeof prefetchMovieDetails==='function')prefetchMovieDetails(${tmdbList})"` : ''}` : ''} style="padding: 0.9rem; border-radius: 1rem; ${movie_id ? 'cursor: pointer;' : ''}">
                        <div class="feed-card-row">
                            <div class="feed-card-poster">
                                ${posterUrl
                                    ? `<img src="${posterUrl}" loading="lazy" decoding="async" alt="${escapeHtml(title)}" style="width:100%; height:100%; object-fit: cover; display:block;" onerror="this.style.display='none';">`
                                    : `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; color: var(--text-muted); font-size: 12px;">No poster</div>`}
                            </div>
                            <div class="feed-card-main">
                                <div class="text-white font-bold" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(title)}${year ? ` <span style="color: rgba(255,255,255,0.65); font-weight: 800;">(${escapeHtml(year)})</span>` : ''}</div>
                                ${(overall || tierLabel)
                                    ? `<div class="feed-metrics">${ratingChips}</div>`
                                    : `<div class="text-xs text-gray" style="margin-top: 0.25rem;">No rating yet</div>`
                                }
                                ${mostRecentLabel ? `<div class="text-xs" style="margin-top: 0.25rem; color: rgba(255,255,255,0.55);">Watched: ${escapeHtml(mostRecentLabel)}</div>` : ''}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            if (isGrid) {
                elList.innerHTML = html
                    ? `<div class="dash-kpi-movie-grid library-movie-grid">${html}</div>`
                    : `<div class="text-gray">No watched movies found yet.</div>`;
            } else {
                elList.innerHTML = html || `<div class="text-gray">No watched movies found yet.</div>`;
            }

            syncLibraryViewUI();

            if (elMeta) {
                ensureLibrarySortFilterStateInitialized();
                const labels = {
                    sortKey: {
                        watch_date: 'Watch Date',
                        overall: 'Overall %',
                        sound: 'Sound %',
                        pace: 'Pace %',
                        imagery: 'Imagery %',
                        acting: 'Acting %',
                        plot: 'Plot %',
                        dialogue: 'Dialogue %',
                        imdb: 'IMDb %',
                        release_year: 'Release Year',
                        runtime: 'Run Time',
                    }
                };
                const model = buildSortFilterChipModel({
                    state: librarySortFilterState,
                    defaults: getDefaultLibrarySortFilterState(),
                    labels,
                });
                const top = `Showing ${shown}${libraryHasMore ? ' • Load more to continue' : ''}`;
                const chipsHtml = renderSortFilterChipsHtml({ model, namespace: 'library' });
                elMeta.innerHTML = `
                    <div>${escapeHtml(top)}</div>
                    <div style="margin-top: 0.35rem; color: rgba(255,255,255,0.72);">${chipsHtml}</div>
                `;

                // Highlight the Filters button when a FILTER is active and the Sort button
                // when SORT is non-default (they share one state, but light up separately).
                const def = getDefaultLibrarySortFilterState();
                const st = librarySortFilterState || {};
                const sortActive = String(st.sortKey ?? '') !== String(def.sortKey ?? '')
                    || String(st.sortDir ?? '') !== String(def.sortDir ?? '');
                const filterActive = Object.keys({ ...def, ...st }).some(k =>
                    k !== 'sortKey' && k !== 'sortDir' && String(st[k] ?? '') !== String(def[k] ?? ''));
                const fBtn = document.getElementById('library-open-filters');
                const sBtn = document.getElementById('library-open-sort');
                if (fBtn) { fBtn.title = model?.summaryText || ''; fBtn.classList.toggle('filter-active', filterActive); }
                if (sBtn) { sBtn.title = model?.summaryText || ''; sBtn.classList.toggle('filter-active', sortActive); }
                syncLibraryClearButton();
            }
            if (wrap) wrap.style.display = libraryHasMore ? 'flex' : 'none';

            consumePendingLibraryScroll();
        }

        // After saving a diary entry we land the user ON that entry in My Movies rather
        // than opening a popup (see `goToDiaryEntryAfterSave` in `10-logging-form.js`):
        // the save sets `pendingLibraryScrollMovieId`, and the next render scrolls that
        // card into view + pulses it so it's obvious which one it is.
        //
        // Deliberately ONE SHOT — the id is cleared whether or not the card was found.
        // Editing an old entry can put it on a later page of results (the default sort
        // is by watch date), and silently yanking the user's scroll position after some
        // later "load more" would be worse than simply leaving them at the top.
        function consumePendingLibraryScroll() {
            const mid = String(pendingLibraryScrollMovieId || '').trim();
            if (!mid) return;
            pendingLibraryScrollMovieId = '';

            const sel = (window.CSS && typeof CSS.escape === 'function') ? CSS.escape(mid) : mid;
            const el = document.querySelector(`#library-list [data-library-entry="${sel}"]`);
            if (!el) return;

            requestAnimationFrame(() => {
                try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
                catch (_) { try { el.scrollIntoView(); } catch (__) {} }
                el.classList.add('library-jump-highlight');
                setTimeout(() => { try { el.classList.remove('library-jump-highlight'); } catch (_) {} }, 2200);
            });
        }

        // Light up the My Movies Clear button in RED when a filter/sort is non-default
        // OR a title search is active (i.e. clearing would actually do something).
        function syncLibraryClearButton() {
            const btn = document.getElementById('library-clear-btn');
            if (!btn) return;
            const def = getDefaultLibrarySortFilterState();
            const st = librarySortFilterState || {};
            const sortActive = String(st.sortKey ?? '') !== String(def.sortKey ?? '')
                || String(st.sortDir ?? '') !== String(def.sortDir ?? '');
            const filterActive = Object.keys({ ...def, ...st }).some(k =>
                k !== 'sortKey' && k !== 'sortDir' && String(st[k] ?? '') !== String(def[k] ?? ''));
            const active = sortActive || filterActive || !!String(librarySearchQuery || '').trim();
            btn.classList.toggle('clear-active', active);
        }

        async function loadLibraryFacets() {
            if (libraryFacetsLoaded) return;
            if (!supabaseClient || !cachedIsAuthed) return;

            const decadeEl = document.getElementById('library-modal-filter-decade');
            const mpaEl = document.getElementById('library-modal-filter-mpa');
            const genreEl = document.getElementById('library-modal-filter-genre');
            const timeframeEl = document.getElementById('library-modal-filter-timeframe');
            if (!decadeEl || !mpaEl || !genreEl) return;

            let authedUser = null;
            try {
                const { user } = await requireAuthOrThrow();
                authedUser = user;
            } catch (_) {
                return;
            }

            try {
                // Grab a capped sample to populate dropdowns without loading the full dataset.
                const { data, error } = await supabaseClient
                    .from(LIBRARY_ITEMS_VIEW)
                    .select('release_year, mpa_rating, genres, genre, latest_watch_date, user_id')
                    .eq('user_id', authedUser.id)
                    .range(0, 999);
                if (error) throw error;
                const rows = Array.isArray(data) ? data : [];

                const decades = new Set();
                const mpas = new Set();
                const genres = new Set();
                const months = new Set();
                for (const r of rows) {
                    const y = Number(r?.release_year);
                    if (Number.isFinite(y) && y > 0) decades.add(Math.floor(y / 10) * 10);
                    const mpa = String(r?.mpa_rating || '').trim();
                    if (mpa) mpas.add(mpa);
                    const arr = Array.isArray(r?.genres) ? r.genres : [];
                    for (const g of arr) {
                        const s = String(g || '').trim();
                        if (s) genres.add(s);
                    }
                    const rawGenre = String(r?.genre || '').trim();
                    if (rawGenre) {
                        rawGenre.split(/[,|;]/g).map(s => String(s).trim()).filter(Boolean).forEach(g => genres.add(g));
                    }

                    const watchRaw = String(r?.latest_watch_date || '').trim();
                    if (watchRaw) {
                        const d = new Date(watchRaw.includes('T') ? watchRaw : `${watchRaw}T00:00:00`);
                        if (!Number.isNaN(d.getTime())) {
                            const month = String(d.getMonth() + 1).padStart(2, '0');
                            const key = `${d.getFullYear()}-${month}`;
                            months.add(key);
                        }
                    }
                }

                const sortedDecades = Array.from(decades).filter(Number.isFinite).sort((a, b) => b - a);
                const sortedMpas = Array.from(mpas).sort((a, b) => a.localeCompare(b));
                const sortedGenres = Array.from(genres).sort((a, b) => a.localeCompare(b));
                const sortedMonths = Array.from(months).sort((a, b) => b.localeCompare(a));

                let maxWatchCount = 0;
                try {
                    const { data: wcRows, error: wcError } = await supabaseClient
                        .from(LIBRARY_ITEMS_VIEW)
                        .select('watch_count')
                        .eq('user_id', authedUser.id)
                        .order('watch_count', { ascending: false, nullsFirst: false })
                        .range(0, 0);
                    if (!wcError) {
                        const raw = Number(wcRows?.[0]?.watch_count ?? 0);
                        maxWatchCount = Number.isFinite(raw) ? raw : 0;
                    }
                } catch (_) {
                    maxWatchCount = 0;
                }
                libraryWatchCountMax = Math.max(0, maxWatchCount);

                const keep = {
                    decade: String(decadeEl.value || ''),
                    mpa: String(mpaEl.value || ''),
                    genre: String(genreEl.value || ''),
                    timeframe: String(timeframeEl?.value || ''),
                };

                decadeEl.innerHTML = `<option value="">All</option>` +
                    sortedDecades.map(d => `<option value="${escapeHtml(String(d))}">${escapeHtml(String(d))}s</option>`).join('');
                mpaEl.innerHTML = `<option value="">All</option>` +
                    sortedMpas.map(v => `<option value="${escapeHtml(String(v))}">${escapeHtml(String(v))}</option>`).join('');
                genreEl.innerHTML = `<option value="">All</option>` +
                    sortedGenres.map(v => `<option value="${escapeHtml(String(v))}">${escapeHtml(String(v))}</option>`).join('');

                if (timeframeEl) {
                    const monthOptions = sortedMonths.map((m) => {
                        const parts = m.split('-');
                        const year = Number(parts[0]);
                        const month = Number(parts[1]);
                        const labelDate = Number.isFinite(year) && Number.isFinite(month)
                            ? new Date(year, month - 1, 1)
                            : null;
                        const label = labelDate
                            ? labelDate.toLocaleDateString(undefined, { year: 'numeric', month: 'long' })
                            : m;
                        return `<option value="${escapeHtml(m)}">${escapeHtml(label)}</option>`;
                    }).join('');

                    timeframeEl.innerHTML = `
                        <option value="all_time">All time</option>
                        <option value="this_year">This year</option>
                        <option value="this_month">This month</option>
                        ${monthOptions}
                    `;
                }

                decadeEl.value = keep.decade;
                mpaEl.value = keep.mpa;
                genreEl.value = keep.genre;
                if (timeframeEl) timeframeEl.value = keep.timeframe || 'all_time';
                setLibraryWatchCountRangeFromState(librarySortFilterState || {});
                libraryFacetsLoaded = true;
            } catch (_) {
                // Keep defaults; do not block modal.
            }
        }

        async function loadLibraryWatchCountMaxForUser(userId) {
            if (!supabaseClient || !userId) return 0;
            try {
                const { data, error } = await supabaseClient
                    .from(LIBRARY_ITEMS_VIEW)
                    .select('watch_count')
                    .eq('user_id', userId)
                    .order('watch_count', { ascending: false, nullsFirst: false })
                    .range(0, 0);
                if (error) return 0;
                const raw = Number(data?.[0]?.watch_count ?? 0);
                return Number.isFinite(raw) ? raw : 0;
            } catch (_) {
                return 0;
            }
        }

        function normalizeMovieFieldValue(v) {
            if (v === null || v === undefined) return '';
            if (typeof v === 'boolean') return v ? 'Yes' : 'No';
            if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
            return String(v).trim();
        }

        function parsePercentLike(raw, { imdb = false } = {}) {
            if (raw === null || raw === undefined) return null;
            if (typeof raw === 'number') {
                if (!Number.isFinite(raw)) return null;
                if (imdb && raw <= 10) return raw * 10;
                return raw;
            }
            const s = String(raw).trim();
            if (!s) return null;
            const m = s.match(/([0-9]+(?:\.[0-9]+)?)/);
            if (!m) return null;
            const n = Number(m[1]);
            if (!Number.isFinite(n)) return null;
            if (imdb && n <= 10) return n * 10;
            return n;
        }

        // Used for IMDb ratings (a crowd average, so a real decimal is meaningful and
        // is kept) — but every value we store is a whole number, so drop a trailing
        // ".0" rather than printing "79.0%" on every card. Same trim as the charts'
        // formatPct in 07-dashboard-charts.js.
        function formatPctForDisplay(pct) {
            const n = Number(pct);
            if (!Number.isFinite(n)) return '';
            const fixed = (Math.round(n * 10) / 10).toFixed(1);
            const trimmed = fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
            return `${trimmed}%`;
        }

        function renderLibraryInfoChips(obj, opts = {}) {
            const blacklist = Array.isArray(opts.blacklist) ? opts.blacklist : [];
            const order = Array.isArray(opts.order) ? opts.order : [];
            const max = Number.isFinite(opts.max) ? Number(opts.max) : 0;

            const keys = Object.keys(obj || {});
            const filtered = keys
                .filter(k => !blacklist.includes(k))
                .filter(k => !/(cast|crew|actor|actress|writers?|producers?)/i.test(k));

            const orderedKeys = [];
            for (const k of order) {
                if (filtered.includes(k)) orderedKeys.push(k);
            }
            for (const k of filtered) {
                if (!orderedKeys.includes(k)) orderedKeys.push(k);
            }

            const chips = [];
            for (const k of orderedKeys) {
                const raw = obj?.[k];
                if (raw === null || raw === undefined) continue;
                if (typeof raw === 'object') continue;
                const v = normalizeMovieFieldValue(raw);
                if (!v) continue;
                chips.push(`<span class="dash-quote-pill">${escapeHtml(k)}: ${escapeHtml(v)}</span>`);
                if (max > 0 && chips.length >= max) break;
            }
            return chips.join('');
        }

        async function loadLibraryPage({ reset = true } = {}) {
            const elList = document.getElementById('library-list');
            const elMeta = document.getElementById('library-meta');
            const wrap = document.getElementById('library-load-more-wrap');
            if (!elList) return;
            // Library contents may have changed (edit/delete/new rating, navigation) —
            // drop the cached search typeahead index so it rebuilds fresh on next open.
            if (reset) invalidateLibrarySearchIndex();
            syncPageSearchButton('library');

            if (!supabaseClient || !cachedIsAuthed) {
                elList.innerHTML = `<div class="text-gray">Log in to view your movies.</div>`;
                if (elMeta) elMeta.textContent = '';
                if (wrap) wrap.style.display = 'none';
                return;
            }

            if (reset) {
                libraryOffset = 0;
                libraryHasMore = true;
                libraryLoading = false;
                libraryItems = [];
                elList.innerHTML = loadingPlaceholder('rows');
                if (wrap) wrap.style.display = 'none';
            }

            await loadLibraryMore({ replace: true });
        }

        function libraryBuildServerQuery({ userId, offset, limit }) {
            ensureLibrarySortFilterStateInitialized();
            const state = librarySortFilterState;

            const sortKey = String(state?.sortKey || 'watch_date');
            const sortDir = (String(state?.sortDir || 'desc') === 'asc') ? 'asc' : 'desc';

            let q = supabaseClient
                .from(LIBRARY_ITEMS_VIEW)
                .select('user_id, movie_id, latest_watch_date, title, release_year, tmdb_id, poster_path, mpa_rating, runtime_minutes, director, actors, genres, genre, imdb_rating_pct, imdb_pct, imdb_rating, overall_rating, tier, fav_quote, notes, sound_rating, pacing_rating, imagery_rating, acting_rating, plot_rating, dialogue_rating, watch_count, watch_method')
                .eq('user_id', userId);

            const range = libraryComputeTimeframeRange(state?.timeframe);
            if (range?.start_date && range?.end_date) {
                q = q.gte('latest_watch_date', range.start_date).lt('latest_watch_date', range.end_date);
            }

            // Filters
            const tierWanted = String(state?.tier || '').trim();
            if (tierWanted) {
                if (tierWanted === 'UNRANKED') {
                    // null/empty or an explicit 'Unranked' value
                    q = q.or('tier.is.null,tier.eq.,tier.eq.UNRANKED,tier.eq.Unranked');
                } else {
                    q = q.eq('tier', tierWanted);
                }
            }

            const decadeWanted = String(state?.decade || '').trim();
            if (decadeWanted) {
                const d = Number(decadeWanted);
                if (Number.isFinite(d)) {
                    q = q.gte('release_year', d).lte('release_year', d + 9);
                }
            }

            const movieId = String(state?.movieId || '').trim();
            if (movieId) {
                q = q.eq('movie_id', movieId);
            }

            // Title/actor search (magnifier popup). Loose match by title OR actor, so
            // "du" → "Dune" and "Jake Gyl" → every Jake Gyllenhaal movie.
            q = applyLibrarySearchFilter(q);

            const watchMethod = String(state?.watchMethod || '').trim();
            if (watchMethod) {
                const needle = watchMethod.toLowerCase().includes('theater')
                    ? '%theater%'
                    : (watchMethod.toLowerCase().includes('home') ? '%home%' : watchMethod);
                q = q.ilike('watch_method', needle);
            }

            const watchMinStr = String(state?.watchCountMin || '').trim();
            const watchMaxStr = String(state?.watchCountMax || '').trim();
            const watchMinVal = watchMinStr ? Number(watchMinStr) : null;
            const watchMaxVal = watchMaxStr ? Number(watchMaxStr) : null;
            const watchMin = Number.isFinite(watchMinVal) && watchMinVal > 0 ? watchMinVal : null;
            const watchMax = Number.isFinite(watchMaxVal) && watchMaxVal > 0 ? watchMaxVal : null;
            if (watchMin !== null) q = q.gte('watch_count', watchMin);
            if (watchMax !== null) q = q.lte('watch_count', watchMax);

            const mpaWanted = String(state?.mpa || '').trim();
            if (mpaWanted) {
                // stored as raw label (e.g. PG-13)
                q = q.ilike('mpa_rating', mpaWanted);
            }

            const genreWanted = String(state?.genre || '').trim();
            if (genreWanted) {
                // Try array first; if the column isn't an array this will error and be handled by caller.
                q = q.contains('genres', [genreWanted]);
            }

            // Sorting
            const asc = (sortDir === 'asc');
            const addOrder = (col) => q.order(col, { ascending: asc, nullsFirst: false }).order('movie_id', { ascending: true });

            if (sortKey === 'watch_date') addOrder('latest_watch_date');
            else if (sortKey === 'release_year') addOrder('release_year');
            else if (sortKey === 'imdb') addOrder('imdb_rating_pct');
            else if (sortKey === 'overall') addOrder('overall_rating');
            else if (sortKey === 'watch_count') addOrder('watch_count');
            else if (sortKey === 'sound') addOrder('sound_rating');
            else if (sortKey === 'pace') addOrder('pacing_rating');
            else if (sortKey === 'imagery') addOrder('imagery_rating');
            else if (sortKey === 'acting') addOrder('acting_rating');
            else if (sortKey === 'plot') addOrder('plot_rating');
            else if (sortKey === 'dialogue') addOrder('dialogue_rating');
            else if (sortKey === 'runtime') addOrder('runtime_minutes');
            else addOrder('latest_watch_date');

            // Pagination (+1 to detect hasMore)
            q = q.range(offset, offset + limit);
            return q;
        }

        function libraryComputeTimeframeRange(timeframe) {
            const tf = String(timeframe || 'all_time').trim().toLowerCase();
            if (tf === 'all_time') return null;

            const now = new Date();
            if (tf === 'this_year') {
                const start = new Date(now.getFullYear(), 0, 1);
                const end = new Date(now.getFullYear() + 1, 0, 1);
                return { start_date: getLocalISODate(start), end_date: getLocalISODate(end) };
            }
            if (tf === 'this_month') {
                const start = new Date(now.getFullYear(), now.getMonth(), 1);
                const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
                return { start_date: getLocalISODate(start), end_date: getLocalISODate(end) };
            }

            const m = tf.match(/^(\d{4})-(\d{2})$/);
            if (m) {
                const year = Number(m[1]);
                const month = Number(m[2]) - 1;
                if (Number.isFinite(year) && Number.isFinite(month) && month >= 0 && month <= 11) {
                    const start = new Date(year, month, 1);
                    const end = new Date(year, month + 1, 1);
                    return { start_date: getLocalISODate(start), end_date: getLocalISODate(end) };
                }
            }
            return null;
        }

        function mapDashboardTimeframeToLibrary(tf) {
            const t = String(tf || '').trim().toLowerCase();
            if (t === 'this_year') return 'this_year';
            if (t === 'this_month') {
                const now = new Date();
                const month = String(now.getMonth() + 1).padStart(2, '0');
                return `${now.getFullYear()}-${month}`;
            }
            return 'all_time';
        }

        async function loadLibraryMore({ replace = false } = {}) {
            const elList = document.getElementById('library-list');
            const wrap = document.getElementById('library-load-more-wrap');
            const btn = document.getElementById('library-load-more');

            if (!elList || !supabaseClient || !cachedIsAuthed) return;
            if (libraryLoading) return;
            if (!libraryHasMore && !replace) return;

            libraryLoading = true;
            if (btn) btn.disabled = true;

            let authedUser = null;
            try {
                const { user } = await requireAuthOrThrow();
                authedUser = user;
            } catch (err) {
                libraryLoading = false;
                if (btn) btn.disabled = false;
                showToast(String(err?.message || err), { level: 'warn' });
                return;
            }

            if (libraryPendingWatchCountMaxOnly) {
                const maxVal = await loadLibraryWatchCountMaxForUser(authedUser?.id);
                libraryWatchCountMax = Math.max(0, Number(maxVal) || 0);
                ensureLibrarySortFilterStateInitialized();
                if (libraryWatchCountMax > 0) {
                    librarySortFilterState.watchCountMin = libraryWatchCountMax;
                    librarySortFilterState.watchCountMax = libraryWatchCountMax;
                }
                libraryPendingWatchCountMaxOnly = false;
            }

            const start = replace ? 0 : libraryOffset;
            const limitPlusOne = libraryLimit; // we pass extra via range end

            try {
                // Primary: server-side sort/filter/paging via `user_library_items`.
                // First page of the DEFAULT view? The boot prewarm (27-prewarm.js) may
                // already hold exactly these rows — and their posters — so the page paints
                // with no round-trip. takeLibraryFirstPagePrewarm checks the sort/filter/
                // search signature still matches, so a filtered view always queries.
                let pre = null;
                if (replace && start === 0) {
                    try { pre = takeLibraryFirstPagePrewarm(authedUser.id); } catch (_) {}
                }
                let q = pre ? null : libraryBuildServerQuery({ userId: authedUser.id, offset: start, limit: limitPlusOne });
                let { data, error } = pre ? { data: pre, error: null } : await q;

                // If genres column isn't an array, `.contains` may fail; retry genre filter via `genre` string.
                if (error && String(error?.message || '').toLowerCase().includes('operator')) {
                    ensureLibrarySortFilterStateInitialized();
                    const genreWanted = String(librarySortFilterState?.genre || '').trim();
                    if (genreWanted) {
                        q = supabaseClient
                            .from(LIBRARY_ITEMS_VIEW)
                            .select('user_id, movie_id, latest_watch_date, title, release_year, tmdb_id, poster_path, mpa_rating, runtime_minutes, director, actors, genres, genre, imdb_rating_pct, imdb_pct, imdb_rating, overall_rating, tier, fav_quote, notes, sound_rating, pacing_rating, imagery_rating, acting_rating, plot_rating, dialogue_rating, watch_count, watch_method')
                            .eq('user_id', authedUser.id);

                        const range = libraryComputeTimeframeRange(librarySortFilterState?.timeframe);
                        if (range?.start_date && range?.end_date) {
                            q = q.gte('latest_watch_date', range.start_date).lt('latest_watch_date', range.end_date);
                        }

                        const state = librarySortFilterState;
                        const tierWanted = String(state?.tier || '').trim();
                        if (tierWanted) {
                            if (tierWanted === 'UNRANKED') q = q.or('tier.is.null,tier.eq.,tier.eq.UNRANKED,tier.eq.Unranked');
                            else q = q.eq('tier', tierWanted);
                        }
                        const decadeWanted = String(state?.decade || '').trim();
                        if (decadeWanted) {
                            const d = Number(decadeWanted);
                            if (Number.isFinite(d)) q = q.gte('release_year', d).lte('release_year', d + 9);
                        }

                        const watchMethod = String(state?.watchMethod || '').trim();
                        if (watchMethod) {
                            const needle = watchMethod.toLowerCase().includes('theater')
                                ? '%theater%'
                                : (watchMethod.toLowerCase().includes('home') ? '%home%' : watchMethod);
                            q = q.ilike('watch_method', needle);
                        }

                        const watchMinStr = String(state?.watchCountMin || '').trim();
                        const watchMaxStr = String(state?.watchCountMax || '').trim();
                        const watchMinVal = watchMinStr ? Number(watchMinStr) : null;
                        const watchMaxVal = watchMaxStr ? Number(watchMaxStr) : null;
                        const watchMin = Number.isFinite(watchMinVal) && watchMinVal > 0 ? watchMinVal : null;
                        const watchMax = Number.isFinite(watchMaxVal) && watchMaxVal > 0 ? watchMaxVal : null;
                        if (watchMin !== null) q = q.gte('watch_count', watchMin);
                        if (watchMax !== null) q = q.lte('watch_count', watchMax);
                        const mpaWanted = String(state?.mpa || '').trim();
                        if (mpaWanted) q = q.ilike('mpa_rating', mpaWanted);

                        q = q.ilike('genre', `%${genreWanted}%`);

                        // Keep the title/actor search applied in the genre-string fallback too.
                        q = applyLibrarySearchFilter(q);

                        const sortKey = String(state?.sortKey || 'watch_date');
                        const sortDir = (String(state?.sortDir || 'desc') === 'asc') ? 'asc' : 'desc';
                        const asc = (sortDir === 'asc');
                        const addOrder = (col) => q.order(col, { ascending: asc, nullsFirst: false }).order('movie_id', { ascending: true });
                        if (sortKey === 'watch_date') addOrder('latest_watch_date');
                        else if (sortKey === 'release_year') addOrder('release_year');
                        else if (sortKey === 'imdb') addOrder('imdb_rating_pct');
                        else if (sortKey === 'overall') addOrder('overall_rating');
                        else if (sortKey === 'watch_count') addOrder('watch_count');
                        else if (sortKey === 'sound') addOrder('sound_rating');
                        else if (sortKey === 'pace') addOrder('pacing_rating');
                        else if (sortKey === 'imagery') addOrder('imagery_rating');
                        else if (sortKey === 'acting') addOrder('acting_rating');
                        else if (sortKey === 'plot') addOrder('plot_rating');
                        else if (sortKey === 'dialogue') addOrder('dialogue_rating');
                        else if (sortKey === 'runtime') addOrder('runtime_minutes');
                        else addOrder('latest_watch_date');
                        q = q.range(start, start + limitPlusOne);

                        ({ data, error } = await q);
                    }
                }

                if (error) throw error;
                const rows = Array.isArray(data) ? data : [];

                // PostgREST range is inclusive; we requested `limit`+1 via range end.
                const hasMore = rows.length > libraryLimit;
                const page = hasMore ? rows.slice(0, libraryLimit) : rows;

                libraryHasMore = hasMore;
                if (replace) {
                    libraryItems = page;
                    libraryOffset = page.length;
                } else {
                    libraryItems = libraryItems.concat(page);
                    libraryOffset += page.length;
                }

                renderLibraryList();
                if (wrap) wrap.style.display = libraryHasMore ? 'flex' : 'none';
                // Infinite scroll: auto-load the next page when the user nears the
                // bottom. The manual "Load More" button stays as a fallback (e.g. if
                // IntersectionObserver is unavailable). Detach once there's no more.
                if (libraryHasMore && wrap) {
                    attachInfiniteScroll(wrap, () => { loadLibraryMore({ replace: false }); });
                } else {
                    detachInfiniteScroll();
                }
            } catch (err) {
                const msg = String(err?.message || err);
                if (replace) {
                    elList.innerHTML = `<div class="text-gray">Could not load movies: ${escapeHtml(msg)}</div>`;
                } else {
                    showToast(`Could not load more: ${msg}`, { level: 'warn' });
                }
                if (wrap) wrap.style.display = 'none';
            } finally {
                libraryLoading = false;
                if (btn) btn.disabled = false;
            }
        }

        // In-flight guard: loadMyFollowingIds() is called from BOTH loadFeedPage() and
        // refreshNavBadges() (which fires on boot, tab focus, app resume, and the 45s
        // notification poll), so two calls routinely overlap. Sharing one promise means the
        // feed and the badges can't fight over the shared set.
        let feedFollowingIdsInflight = null;

        async function loadMyFollowingIds() {
            if (feedFollowingIdsInflight) return feedFollowingIdsInflight;
            feedFollowingIdsInflight = (async () => {
                try {
                    await loadMyFollowingIdsNow();
                } finally {
                    feedFollowingIdsInflight = null;
                }
            })();
            return feedFollowingIdsInflight;
        }

        async function loadMyFollowingIdsNow() {
            if (!supabaseClient) { feedFollowingIds = new Set(); return; }
            // Resolve the user id from the LOCAL session FIRST. auth.getUser() does a
            // server round-trip that comes back EMPTY on a cold boot (session still
            // restoring), which used to leave feedFollowingIds empty → the feed showed
            // "Follow someone…" until a manual pull-to-refresh even though you DO follow
            // people. Mirror the same session-first resolution loadFeedItems() uses.
            let authedUserId = '';
            if (guestMode) {
                authedUserId = String(cachedAuthUser?.id || (typeof DEMO_USER_ID !== 'undefined' ? DEMO_USER_ID : '') || '').trim();
            } else {
                try {
                    const { data: sdata } = await supabaseClient.auth.getSession();
                    authedUserId = String(sdata?.session?.user?.id || '').trim();
                } catch (_) {}
                if (!authedUserId) {
                    try {
                        const { data: udata } = await supabaseClient.auth.getUser();
                        authedUserId = String(udata?.user?.id || '').trim();
                    } catch (_) {}
                }
                if (!authedUserId && typeof getActiveUserId === 'function') {
                    authedUserId = String(getActiveUserId() || '').trim();
                }
                if (!authedUserId) authedUserId = String(cachedAuthUser?.id || '').trim();
            }
            if (!authedUserId) { feedFollowingIds = new Set(); return; }

            // Build into a LOCAL set and only publish it once the rows are in. Assigning
            // `feedFollowingIds = new Set()` up front (as this used to) meant a badge
            // refresh starting mid-feed-load would blank the shared set for the duration of
            // its own network call — and if loadFeedItems() read it in that window it saw
            // zero follows and rendered "Follow someone to see activity here." Building
            // locally also leaves the previous set intact when the query fails.
            const next = new Set();
            const { data, error } = await supabaseClient
                .from('Follows')
                .select('followed_id')
                .eq('follower_id', authedUserId);
            if (error) throw error;
            const rows = Array.isArray(data) ? data : [];
            for (const r of rows) {
                const id = String(r?.followed_id || '').trim();
                if (id) next.add(id);
            }
            feedFollowingIds = next;
        }

        async function loadFeedPage() {
            // Bind per-render DOM elements.
            loadFeedFilterPrefs();
            syncFeedFilterButton();

            const form = document.getElementById('feed-search-form');
            const input = document.getElementById('feed-search-input');
            const clearBtn = document.getElementById('feed-clear-btn');

            if (form && !form.dataset.bound) {
                form.dataset.bound = 'true';
                form.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const q = String(input?.value || '').trim();
                    await searchFeedUsers(q);
                });
            }

            if (clearBtn && !clearBtn.dataset.bound) {
                clearBtn.dataset.bound = 'true';
                clearBtn.addEventListener('click', async () => {
                    if (input) input.value = '';
                    feedLastSearchQuery = '';
                    const el = document.getElementById('feed-search-results');
                    if (el) el.innerHTML = '';
                });
            }

            // Capture the highlight threshold BEFORE marking seen, so new items in
            // this view glow once, then read as normal next time. DB-aware so glows are
            // consistent across devices (an item seen on your phone won't re-glow here).
            try {
                const seen = await loadSeenTimesFromDb();
                feedHighlightSince = effectiveSeen(FEED_LAST_SEEN_KEY, seen.feed);
            } catch (_) { feedHighlightSince = ''; }

            try {
                await loadMyFollowingIds();
                await loadFeedFollowingList();
                await loadFeedItems();
                markFeedSeen(); // viewing the feed clears its unread badge
            } catch (err) {
                showToast(`Feed failed: ${String(err?.message || err)}`, { level: 'warn' });
            }
        }

        let feedHighlightSince = ''; // items with created_at (original post time) newer than this glow as "new" for one view

        // Movie ids known to be in the viewer's Bucket List, so the feed "Bucket List"
        // button renders pre-filled (solid star). Seeded each feed load from a DB query
        // and augmented when the user adds one via the button, so it stays correct across
        // re-renders / navigating back without re-querying.
        const feedBucketMovieIds = new Set();
        // Same, keyed by tmdb_id — a robustness backstop so the star still pre-fills when
        // the catalog happens to hold the movie under a different Movies.id than the one in
        // the bucket list (matches by tmdb_id when the movie_id match misses).
        const feedBucketTmdbIds = new Set();

        // ---- Feed review reactions (emoji) --------------------------------------
        // A small set of reaction emojis a viewer can drop on any review in the feed.
        // Counts + the viewer's own reactions are loaded per feed load and rendered inside
        // each expanded card. Adding one pushes a notification to the review's author
        // (via the swift-api notify_review_reaction edge action).
        const FEED_REACTION_EMOJIS = ['👍', '👎', '❤️', '😂', '💯', '🤯'];
        // rating_id -> { counts: Map(emoji -> n), mine: Set(emoji), users: Map(emoji -> [userId,...]) }
        const feedReactionsByRatingId = new Map();
        // userId -> { username, icon } for everyone who has reacted to a visible review,
        // so the "who reacted" popup can render their avatar + name.
        const feedReactorInfoById = new Map();
        // The viewer's own id, stashed so the popup can label their row "You".
        let feedReactWhoViewerId = '';
        // Review (rating) ids authored by the viewer — you can't react to your OWN entry,
        // so a count-pill tap/click on these just reveals the "who reacted" popup.
        const feedOwnRatingIds = new Set();

        function feedReactionEnsureEntry(rid) {
            let entry = feedReactionsByRatingId.get(rid);
            if (!entry) { entry = { counts: new Map(), mine: new Set(), users: new Map() }; feedReactionsByRatingId.set(rid, entry); }
            if (!entry.users) entry.users = new Map();
            return entry;
        }

        // Batch-load reactions for the given review (Movie Ratings) ids into
        // feedReactionsByRatingId, recording per-emoji counts, which the viewer owns,
        // and the full list of reactor ids per emoji (for the "who reacted" popup).
        async function loadFeedReactions(ratingIds, viewerId) {
            feedReactionsByRatingId.clear();
            feedReactorInfoById.clear();
            feedReactWhoViewerId = String(viewerId || '').trim();
            const ids = Array.from(new Set((Array.isArray(ratingIds) ? ratingIds : [])
                .map((x) => String(x || '').trim()).filter(Boolean)));
            if (!ids.length) return;
            const vid = feedReactWhoViewerId;
            try {
                const rows = [];
                for (let i = 0; i < ids.length; i += 300) {
                    const chunk = ids.slice(i, i + 300);
                    const { data, error } = await supabaseClient
                        .from('Review Reactions')
                        .select('rating_id, user_id, emoji')
                        .in('rating_id', chunk);
                    if (error) throw error;
                    rows.push(...(Array.isArray(data) ? data : []));
                }
                const reactorIds = new Set();
                for (const row of rows) {
                    const rid = String(row?.rating_id || '').trim();
                    const emoji = String(row?.emoji || '').trim();
                    const uid = String(row?.user_id || '').trim();
                    if (!rid || !emoji) continue;
                    const entry = feedReactionEnsureEntry(rid);
                    entry.counts.set(emoji, (entry.counts.get(emoji) || 0) + 1);
                    if (uid) {
                        if (!entry.users.has(emoji)) entry.users.set(emoji, []);
                        entry.users.get(emoji).push(uid);
                        reactorIds.add(uid);
                    }
                    if (vid && uid === vid) entry.mine.add(emoji);
                }
                await loadFeedReactorInfo(Array.from(reactorIds));
            } catch (e) {
                // Best-effort — a missing table / RLS just means no reaction bars.
                try { emitLog('warn', 'Feed reactions load failed: ' + String(e?.message || e)); } catch (_) {}
            }
        }

        // Batch-load username + icon for every reactor into feedReactorInfoById so the
        // "who reacted" popup can render their avatar (reactors aren't always in the feed).
        async function loadFeedReactorInfo(userIds) {
            const ids = Array.from(new Set((Array.isArray(userIds) ? userIds : [])
                .map((x) => String(x || '').trim()).filter(Boolean)));
            if (!ids.length) return;
            for (let i = 0; i < ids.length; i += 300) {
                const chunk = ids.slice(i, i + 300);
                const { data, error } = await supabaseClient
                    .from('Users')
                    .select('id, username, icon')
                    .in('id', chunk);
                if (error) throw error;
                for (const u of (Array.isArray(data) ? data : [])) {
                    const uid = String(u?.id || '').trim();
                    if (!uid) continue;
                    feedReactorInfoById.set(uid, { username: u?.username || '', icon: u?.icon || '' });
                }
            }
        }

        // The count-pills for one review (one per emoji that has ≥1 reaction, the viewer's
        // own highlighted). Returned as the inner HTML of `.feed-react-counts`.
        function feedReactionCountsInner(ratingId) {
            const rid = String(ratingId || '').trim();
            if (!rid) return '';
            const entry = feedReactionsByRatingId.get(rid) || { counts: new Map(), mine: new Set() };
            const pills = [];
            for (const emoji of FEED_REACTION_EMOJIS) {
                const n = entry.counts.get(emoji) || 0;
                if (n <= 0) continue;
                const mine = entry.mine.has(emoji) ? ' is-mine' : '';
                pills.push(`<button type="button" class="feed-react-pill${mine}" data-feed-action="toggle_reaction" data-rating-id="${escapeHtml(rid)}" data-emoji="${escapeHtml(emoji)}" title="${mine ? 'Remove your reaction' : 'React'}"><span class="feed-react-emoji">${emoji}</span><span class="feed-react-count">${n}</span></button>`);
            }
            return pills.join('');
        }

        // The emoji options inside the (hidden) picker for one review.
        function feedReactionPickerInner(ratingId) {
            const rid = String(ratingId || '').trim();
            if (!rid) return '';
            const entry = feedReactionsByRatingId.get(rid) || { counts: new Map(), mine: new Set() };
            return FEED_REACTION_EMOJIS.map((emoji) => {
                const mine = entry.mine.has(emoji) ? ' is-mine' : '';
                return `<button type="button" class="feed-react-opt${mine}" data-feed-action="toggle_reaction" data-rating-id="${escapeHtml(rid)}" data-emoji="${escapeHtml(emoji)}" title="${emoji}">${emoji}</button>`;
            }).join('');
        }

        // The small emoji "React" icon button (opens the picker), shown in the card's
        // action row right beside the Bucket List button.
        function feedReactAddBtnHtml(ratingId) {
            const rid = String(ratingId || '').trim();
            if (!rid) return '';
            return `<button type="button" class="feed-react-add" data-feed-action="open_reactions" data-rating-id="${escapeHtml(rid)}" title="Add a reaction" aria-label="Add a reaction">🙂</button>`;
        }

        // Re-render the count pills + picker options for a review across every on-screen
        // card it appears on (grouped duplicates), preserving each picker's open state.
        function repaintFeedReactionBars(ratingId) {
            const rid = String(ratingId || '').trim();
            if (!rid) return;
            const sel = (window.CSS && CSS.escape) ? CSS.escape(rid) : rid;
            document.querySelectorAll(`.feed-react-counts[data-rating-id="${sel}"]`)
                .forEach((el) => { el.innerHTML = feedReactionCountsInner(rid); });
            document.querySelectorAll(`.feed-react-picker[data-rating-id="${sel}"]`)
                .forEach((el) => { el.innerHTML = feedReactionPickerInner(rid); });
        }

        // ---- "Who reacted" popup (hover on desktop, tap on mobile) --------------
        let feedReactWhoPopEl = null;
        let feedReactWhoHideTimer = null;

        function ensureFeedReactWhoPop() {
            if (feedReactWhoPopEl && document.body.contains(feedReactWhoPopEl)) return feedReactWhoPopEl;
            const el = document.createElement('div');
            el.id = 'feed-react-who-pop';
            el.className = 'feed-react-who-pop';
            el.setAttribute('hidden', '');
            // Keep it open while the pointer is over the popup itself (desktop).
            el.addEventListener('mouseenter', () => {
                if (feedReactWhoHideTimer) { clearTimeout(feedReactWhoHideTimer); feedReactWhoHideTimer = null; }
            });
            el.addEventListener('mouseleave', () => hideFeedReactWhoPop());
            document.body.appendChild(el);
            feedReactWhoPopEl = el;
            return el;
        }

        // Build the popup body: the emoji header + one avatar/name row per reactor.
        function feedReactWhoInner(ratingId, emoji) {
            const rid = String(ratingId || '').trim();
            const em = String(emoji || '').trim();
            const entry = feedReactionsByRatingId.get(rid);
            const ids = (entry && entry.users) ? Array.from(entry.users.get(em) || []) : [];
            if (!ids.length) return '';
            // The viewer sorts to the top and reads as "You".
            ids.sort((a, b) => (a === feedReactWhoViewerId ? -1 : b === feedReactWhoViewerId ? 1 : 0));
            const rows = ids.map((uid) => {
                const info = feedReactorInfoById.get(uid) || {};
                const nameRaw = String(info.username || '').trim().replace(/^@+/, '');
                const label = (uid === feedReactWhoViewerId) ? 'You' : (nameRaw ? '@' + nameRaw : 'User');
                return `<div class="feed-react-who-row">${renderUserIconHtml(info.icon, 22)}<span class="feed-react-who-name">${escapeHtml(label)}</span></div>`;
            }).join('');
            return `<div class="feed-react-who-head"><span class="feed-react-who-emoji">${em}</span></div><div class="feed-react-who-list">${rows}</div>`;
        }

        function showFeedReactWhoPop(anchorEl, ratingId, emoji) {
            if (!anchorEl) return;
            const inner = feedReactWhoInner(ratingId, emoji);
            if (!inner) { hideFeedReactWhoPop(); return; }
            const el = ensureFeedReactWhoPop();
            if (feedReactWhoHideTimer) { clearTimeout(feedReactWhoHideTimer); feedReactWhoHideTimer = null; }
            el.innerHTML = inner;
            el.removeAttribute('hidden');
            // Measure then position centered above the pill (flip below if no room up top).
            const r = anchorEl.getBoundingClientRect();
            const pw = el.offsetWidth;
            const ph = el.offsetHeight;
            let left = r.left + (r.width / 2) - (pw / 2);
            left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
            let top = r.top - ph - 8;
            if (top < 8) top = r.bottom + 8;
            el.style.left = Math.round(left) + 'px';
            el.style.top = Math.round(top) + 'px';
        }

        function hideFeedReactWhoPop() {
            if (feedReactWhoHideTimer) { clearTimeout(feedReactWhoHideTimer); feedReactWhoHideTimer = null; }
            if (feedReactWhoPopEl) feedReactWhoPopEl.setAttribute('hidden', '');
        }

        function scheduleHideFeedReactWhoPop() {
            if (feedReactWhoHideTimer) clearTimeout(feedReactWhoHideTimer);
            feedReactWhoHideTimer = setTimeout(hideFeedReactWhoPop, 180);
        }

        // Fill the star on EVERY currently-rendered feed button for a movie (a movie can
        // appear on multiple grouped cards), so adding it once updates all of them.
        function markFeedBucketButtons(movieId) {
            const mid = String(movieId || '').trim();
            if (!mid) return;
            document.querySelectorAll(`.feed-bucket-btn[data-feed-movie-id="${(window.CSS && CSS.escape) ? CSS.escape(mid) : mid}"]`)
                .forEach((el) => el.classList.add('is-added'));
        }

        // Load the viewer's ENTIRE Bucket List into feedBucketMovieIds (+ a tmdb backstop),
        // so every feed card whose movie is already in the bucket renders a solid star.
        // Resolves the Bucket List via ensureBucketListForUser — the SAME path the
        // add-button click handler uses — so the list id is guaranteed identical (this is
        // the fix: a direct `Lists` name query was returning a different/empty id, so the
        // pre-fill never matched even though the click handler found the movie).
        async function seedFeedBucketMovieIds(preferredUserId) {
            // Diagnostics go through addMessageToLog (the on-screen "Message Log" panel) —
            // NOT emitLog, which only writes to the browser DevTools console — so the load
            // count / any failure is visible IN THE APP while we verify the pre-filled star.
            const blog = (level, msg) => {
                try {
                    if (typeof addMessageToLog === 'function') addMessageToLog(level, msg);
                    else emitLog(level, msg);
                } catch (_) {}
            };
            try {
                // Resolve the viewer id from every available source, capturing what each
                // one returns so the warning below can pinpoint WHY it failed.
                const preferredVal = String(preferredUserId || '').trim();
                const activeVal = (typeof getActiveUserId === 'function') ? String(getActiveUserId() || '').trim() : '';
                let sessionVal = '';
                try {
                    const { data: sdata } = await supabaseClient.auth.getSession();
                    sessionVal = String(sdata?.session?.user?.id || '').trim();
                } catch (e) { blog('warn', 'Bucket pre-fill v2: getSession threw — ' + String(e?.message || e)); }
                let userVal = '';
                if (!preferredVal && !activeVal && !sessionVal) {
                    try {
                        const { data: udata } = await supabaseClient.auth.getUser();
                        userVal = String(udata?.user?.id || '').trim();
                    } catch (_) {}
                }
                const uid = preferredVal || activeVal || sessionVal || userVal;
                // Only skip for an ACTUAL guest session. Do NOT skip on uid === DEMO_USER_ID:
                // a real signed-in account can legitimately have that id (the owner's own
                // account doubles as the demo user), and excluding it blanked the bucket
                // pre-fill for that account.
                if (!uid || (guestMode && uid === DEMO_USER_ID)) {
                    blog('warn', `Bucket pre-fill v2: no usable user id — uid="${uid || '∅'}" guest=${guestMode} preferred="${preferredVal || '∅'}" active="${activeVal || '∅'}" session="${sessionVal || '∅'}" getUser="${userVal || '∅'}".`);
                    return;
                }
                blog('info', `Bucket pre-fill v2: using uid="${uid}".`);

                // Find EVERY "Bucket List" this user owns by reading ALL their lists and
                // matching the name case-insensitively in JS — covers odd-cased / duplicate
                // rows and avoids relying on an exact-name query or a cached list id (the
                // fragile parts that the previous versions depended on).
                const { data: lists, error: lErr } = await supabaseClient
                    .from('Lists')
                    .select('id, list_name')
                    .eq('user_id', uid);
                if (lErr) { blog('warn', 'Bucket pre-fill: could not read your Lists — ' + (lErr.message || lErr)); return; }
                const bucketIds = (Array.isArray(lists) ? lists : [])
                    .filter((l) => String(l?.list_name || '').trim().toLowerCase() === 'bucket list')
                    .map((l) => String(l.id))
                    .filter(Boolean);
                if (!bucketIds.length) { blog('warn', 'Bucket pre-fill: no "Bucket List" found on your account.'); return; }

                const { data: bmovies, error: mErr } = await supabaseClient
                    .from('Movie Lists')
                    .select('movie_id')
                    .in('list_id', bucketIds);
                if (mErr) { blog('warn', 'Bucket pre-fill: could not read Bucket List movies — ' + (mErr.message || mErr)); return; }

                const bucketMovieIds = [];
                for (const row of (Array.isArray(bmovies) ? bmovies : [])) {
                    const mid = String(row?.movie_id || '').trim();
                    if (!mid) continue;
                    feedBucketMovieIds.add(mid);
                    bucketMovieIds.push(mid);
                }
                blog('info', `Bucket pre-fill: loaded ${bucketMovieIds.length} movie(s) from your Bucket List.`);

                // Backstop: also key by tmdb_id, so the star still fills if the feed movie
                // ever resolves to a different Movies.id than the stored bucket row.
                if (bucketMovieIds.length) {
                    const { data: bmrows } = await supabaseClient
                        .from('Movies')
                        .select('tmdb_id')
                        .in('id', bucketMovieIds);
                    for (const m of (Array.isArray(bmrows) ? bmrows : [])) {
                        const t = (m?.tmdb_id === null || m?.tmdb_id === undefined) ? '' : String(m.tmdb_id);
                        if (t) feedBucketTmdbIds.add(t);
                    }
                }
            } catch (e) {
                blog('error', 'Bucket pre-fill crashed: ' + String(e?.message || e));
            }
        }

        // Re-apply the solid-star (.is-added) class to EVERY rendered feed bucket button
        // whose movie is in the viewer's Bucket List. The inline render already does this,
        // but this is a cheap self-healing pass run right after render so the stars are
        // correct even if the seed populated late or a card was re-rendered. Matches by
        // BOTH movie_id and the tmdb_id backstop (read off each button's data attrs).
        function reconcileFeedBucketStars() {
            try {
                let total = 0;
                let filled = 0;
                document.querySelectorAll('.feed-bucket-btn[data-feed-movie-id]').forEach((btn) => {
                    total++;
                    const mid = String(btn.dataset.feedMovieId || '').trim();
                    const tmdb = String(btn.dataset.feedMovieTmdb || '').trim();
                    if ((mid && feedBucketMovieIds.has(mid)) || (tmdb && feedBucketTmdbIds.has(tmdb))) {
                        btn.classList.add('is-added');
                        filled++;
                    }
                });
                // Visible in the on-screen Message Log so we can see match vs load at a glance.
                try {
                    const log = (typeof addMessageToLog === 'function') ? addMessageToLog : emitLog;
                    log('info', `Bucket pre-fill: filled ${filled} of ${total} feed star(s) — bucket set has ${feedBucketMovieIds.size} id(s) / ${feedBucketTmdbIds.size} tmdb.`);
                } catch (_) {}
            } catch (_) {}
        }

        // ===== Nav notification badges (Feed = new follow activity, Lists = new recs) =====
        const FEED_LAST_SEEN_KEY = 'ct_feed_last_seen';
        const RECS_LAST_SEEN_KEY = 'ct_recs_last_seen';
        // Last computed unseen counts per category, so marking one category seen can
        // update the PWA app-icon badge synchronously (to the OTHER category's
        // remaining count) without waiting on refreshNavBadges' network queries.
        let lastFeedUnseen = 0;
        let lastRecsUnseen = 0;

        function getNotifLastSeen(key) {
            try {
                const v = localStorage.getItem(key);
                if (v) return v;
                const now = new Date().toISOString();
                localStorage.setItem(key, now); // first run: start "now" so there's no huge backlog
                return now;
            } catch (_) {
                return new Date().toISOString();
            }
        }

        // ===== Cross-device "last seen" =====
        // The AUTHORITATIVE seen-time lives in Users.feed_seen_at / recs_seen_at (shared
        // across every device); localStorage is only a per-device cache. So a feed/recs
        // badge cleared on your phone must also read as cleared on desktop later.
        async function loadSeenTimesFromDb() {
            try {
                const uid = String(cachedAuthUser?.id || '').trim();
                if (!uid || !supabaseClient || !cachedIsAuthed) return {};
                const { data } = await supabaseClient
                    .from('Users').select('feed_seen_at, recs_seen_at').eq('id', uid).single();
                return { feed: String(data?.feed_seen_at || ''), recs: String(data?.recs_seen_at || '') };
            } catch (_) { return {}; }
        }

        // The effective seen-time = the LATER of (this device's localStorage, the shared
        // DB value). ISO-8601 strings compare lexicographically, so `>` = "more recent".
        // Also catches this device's cache up to the shared latest so glows stay in sync.
        function effectiveSeen(localKey, dbVal) {
            let local = '';
            try { local = localStorage.getItem(localKey) || ''; } catch (_) {}
            const db = String(dbVal || '');
            let eff = (db > local) ? db : local;
            if (!eff) eff = new Date().toISOString(); // brand-new user, no history → no backlog
            try { if (eff !== local) localStorage.setItem(localKey, eff); } catch (_) {}
            return eff;
        }

        function setNavBadge(elId, count) {
            const n = Number(count) || 0;
            // Update the desktop nav badge, its mobile-menu twin ("-m"), and the
            // mobile bottom-tab-bar twin ("-t").
            for (const id of [elId, `${elId}-m`, `${elId}-t`]) {
                const el = document.getElementById(id);
                if (!el) continue;
                if (n > 0) {
                    el.textContent = n > 99 ? '99+' : String(n);
                    el.classList.add('show');
                } else {
                    el.textContent = '';
                    el.classList.remove('show');
                }
            }
            // The Lists badge also drives the Recs cover badge on the Lists overview.
            if (elId === 'nav-badge-lists') {
                const cov = document.getElementById('lists-cover-badge-recs');
                if (cov) {
                    if (n > 0) { cov.textContent = n > 99 ? '99+' : String(n); cov.classList.add('show'); }
                    else { cov.textContent = ''; cov.classList.remove('show'); }
                }
            }
        }

        // "Movies still to rate" reminder badge: the count of Review Drafts (the
        // To Rate / Drafts queue). Painted on the mobile "More" tab-bar button AND
        // the Account/Login row inside the "More" bottom sheet, so users are nudged
        // to finish rating movies they saved for later.
        function setToRateBadge(count) {
            const n = Number(count) || 0;
            const label = n > 99 ? '99+' : String(n);
            const tab = document.getElementById('nav-badge-more-t');
            if (tab) {
                if (n > 0) { tab.textContent = label; tab.classList.add('show'); }
                else { tab.textContent = ''; tab.classList.remove('show'); }
            }
            const row = document.getElementById('more-auth-torate-badge');
            if (row) {
                if (n > 0) { row.textContent = label; row.classList.add('show'); }
                else { row.textContent = ''; row.classList.remove('show'); }
            }
        }

        // Mirror the total feed+lists unread count onto the PWA home-screen icon
        // badge (the little red number). Clears to 0 when nothing is unread.
        function setPwaAppBadge(total) {
            try {
                const n = Math.max(0, Math.floor(Number(total) || 0));
                if (navigator.setAppBadge) { n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge?.(); }
            } catch (_) {}
        }

        async function refreshNavBadges() {
            let feedCount = 0, listsCount = 0;
            try {
                if (!supabaseClient || !cachedIsAuthed) {
                    setNavBadge('nav-badge-feed', 0);
                    setNavBadge('nav-badge-lists', 0);
                    setToRateBadge(0);
                    setPwaAppBadge(0);
                    try { if (typeof refreshNotifBadge === 'function') refreshNotifBadge(); } catch (_) {}
                    return;
                }
                const meId = String(cachedAuthUser?.id || '').trim();
                if (!meId) return;

                // "More" tab / Account row badge: movies still waiting to be rated
                // (the Review Drafts "To Rate" queue).
                try {
                    const { count } = await supabaseClient
                        .from('Review Drafts')
                        .select('id', { count: 'exact', head: true })
                        .eq('user_id', meId);
                    setToRateBadge(count || 0);
                } catch (_) { /* Review Drafts table may not exist pre-migration */ }

                // Pull the shared seen-times once so badges match across devices.
                const seen = await loadSeenTimesFromDb();

                // Lists badge: recommendations sent to me since last seen.
                try {
                    const since = effectiveSeen(RECS_LAST_SEEN_KEY, seen.recs);
                    const { count } = await supabaseClient
                        .from('Recommendations')
                        .select('id', { count: 'exact', head: true })
                        .eq('to_user_id', meId)
                        .gt('created_at', since);
                    listsCount = count || 0;
                    setNavBadge('nav-badge-lists', listsCount);
                } catch (_) { /* Recommendations table may not exist pre-migration */ }

                // Feed badge: NEW reviews from people I follow (excluding me) since last
                // seen — keyed on created_at (original post time), so an edit to an old
                // review doesn't re-ping the badge.
                try {
                    await loadMyFollowingIds();
                    const followed = Array.from(feedFollowingIds).filter(id => id && id !== meId);
                    if (followed.length) {
                        const since = effectiveSeen(FEED_LAST_SEEN_KEY, seen.feed);
                        const { count } = await supabaseClient
                            .from('Movie Ratings')
                            .select('id', { count: 'exact', head: true })
                            .in('user_id', followed)
                            .gt('created_at', since);
                        feedCount = count || 0;
                        setNavBadge('nav-badge-feed', feedCount);
                    } else {
                        setNavBadge('nav-badge-feed', 0);
                    }
                } catch (_) {}
            } catch (_) {}
            lastFeedUnseen = feedCount;
            lastRecsUnseen = listsCount;
            const total = feedCount + listsCount;
            setNavBadge('nav-badge-burger', total);
            try { document.getElementById('menu-icon-btn')?.classList.toggle('has-unseen', total > 0); } catch (_) {}
            setPwaAppBadge(total);
            // Activity inbox bell (own unread count; 24-notifications.js).
            try { if (typeof refreshNotifBadge === 'function') refreshNotifBadge(); } catch (_) {}
        }

        // Persist last-seen server-side too, so push badge counts match "since I looked".
        function persistSeen(col) {
            try {
                const uid = String(cachedAuthUser?.id || '').trim();
                if (uid && supabaseClient) supabaseClient.from('Users').update({ [col]: new Date().toISOString() }).eq('id', uid).then(() => {}, () => {});
            } catch (_) {}
        }
        function markFeedSeen() {
            try { localStorage.setItem(FEED_LAST_SEEN_KEY, new Date().toISOString()); } catch (_) {}
            setNavBadge('nav-badge-feed', 0);
            persistSeen('feed_seen_at');
            // Clear the PWA home-screen icon badge NOW so it goes away on this view,
            // not on a later navigation. Synchronously drop the feed contribution
            // (feed -> 0, only recs may remain), then refreshNavBadges reconciles.
            lastFeedUnseen = 0;
            setPwaAppBadge(lastFeedUnseen + lastRecsUnseen);
            setNavBadge('nav-badge-burger', lastFeedUnseen + lastRecsUnseen);
            try { refreshNavBadges(); } catch (_) {}
            // Seeing the feed also "sees" the follow-review Activity rows, so the
            // navbar bell badge clears too — no separate "Mark all read" needed.
            try { if (typeof markNotificationsReadByType === 'function') markNotificationsReadByType(['new_review']); } catch (_) {}
        }

        function markRecsSeen() {
            try { localStorage.setItem(RECS_LAST_SEEN_KEY, new Date().toISOString()); } catch (_) {}
            setNavBadge('nav-badge-lists', 0);
            persistSeen('recs_seen_at');
            // Same as markFeedSeen: drop the recs contribution immediately.
            lastRecsUnseen = 0;
            setPwaAppBadge(lastFeedUnseen + lastRecsUnseen);
            setNavBadge('nav-badge-burger', lastFeedUnseen + lastRecsUnseen);
            try { refreshNavBadges(); } catch (_) {}
            // Seeing the Recs list also "sees" the recommendation Activity rows.
            try { if (typeof markNotificationsReadByType === 'function') markNotificationsReadByType(['recommendation']); } catch (_) {}
        }

        // "Mark all read" in the Activity inbox (24-notifications.js) must clear
        // EVERY red badge, not just the bell — the user has explicitly acknowledged
        // all activity, so leaving the Feed / Lists nav counts lit reads as a bug.
        // Does both seen-times in ONE pass rather than calling markFeedSeen +
        // markRecsSeen, which would each re-run refreshNavBadges and re-mark
        // notification rows the caller has already marked read.
        function markAllNavBadgesSeen() {
            const nowIso = new Date().toISOString();
            try { localStorage.setItem(FEED_LAST_SEEN_KEY, nowIso); } catch (_) {}
            try { localStorage.setItem(RECS_LAST_SEEN_KEY, nowIso); } catch (_) {}
            setNavBadge('nav-badge-feed', 0);
            setNavBadge('nav-badge-lists', 0);
            persistSeen('feed_seen_at');
            persistSeen('recs_seen_at');
            lastFeedUnseen = 0;
            lastRecsUnseen = 0;
            setPwaAppBadge(0);
            setNavBadge('nav-badge-burger', 0);
            try { document.getElementById('menu-icon-btn')?.classList.remove('has-unseen'); } catch (_) {}
            try { refreshNavBadges(); } catch (_) {}
        }

        // ===== Public profile overview (opened by clicking a user in the Feed) =====
        // Computes the user's KPIs client-side and reuses the Data Dash card markup +
        // helpers so the posters/ratings/tiers look IDENTICAL to the dashboard.
        let profileMode = 'recent'; // 'recent' | 'top'
        let profileViewUserId = ''; // the user whose profile is open (for poster taps)
        let profileTopMetric = 'overall_rating'; // which rating drives the Top Rated grid
        let profileDisagreementMetric = 'overall_rating'; // which rating drives "Biggest disagreements"
        let profileCompat = null; // cached taste-match data (incl. all rating pairs) for re-sorting disagreements
        let profileThemShort = 'Them'; // short label for the other user, used in disagreement chips
        let profileRatedItems = []; // all rated movies (sorted/sliced per metric in render)
        let profileRecent10 = [];

        // Clicking a user's avatar/name anywhere navigates to their Account page
        // (route `account`) instead of opening a modal. The target user id rides on
        // the router `mode` param so OS back/forward keep the right user.
        function openUserProfile(userId) {
            const uid = String(userId || '').trim();
            if (!uid) return;
            if (!supabaseClient || !cachedIsAuthed) { openAuthModal(); return; }
            router.navigate('account', uid);
        }

        // Loads the "profile overview" (KPIs + Taste Match + Biggest Disagreements +
        // Recent/Top-Rated grid) for a user and renders it INTO a container on the
        // Account page. Same data + math as the old profile pop-up; the account hero
        // already shows the avatar/name/bio so we render the body without a head.
        async function loadAccountProfileOverview(userId, containerEl) {
            const uid = String(userId || '').trim();
            const body = containerEl || document.getElementById('account-home-overview');
            if (!uid || !body) return;
            const titleEl = null;
            body.innerHTML = `<div class="text-gray" style="padding:1rem;">Loading…</div>`;
            profileMode = 'recent';
            profileViewUserId = uid;
            profileTopMetric = 'overall_rating';
            profileDisagreementMetric = 'overall_rating';
            profileCompat = null;
            profileThemShort = 'Them';
            profileRatedItems = [];
            profileRecent10 = [];

            try {
                // The user
                let urow = null;
                try {
                    const r1 = await supabaseClient.from('Users').select('id, username, display_name, icon').eq('id', uid).single();
                    if (r1.error) throw r1.error; urow = r1.data;
                } catch (e1) {
                    if (/column\s+"?icon"?\s+does\s+not\s+exist/i.test(String(e1?.message || e1))) {
                        const r2 = await supabaseClient.from('Users').select('id, username, display_name').eq('id', uid).single();
                        urow = r2.data;
                    } else { throw e1; }
                }
                const username = String(urow?.username || '').trim();
                const displayName = String(urow?.display_name || '').trim() || (username ? `@${username}` : 'User');
                const iconId = String(urow?.icon || '').trim();

                // Their ratings
                const { data: ratingsData, error: rErr } = await supabaseClient
                    .from('Movie Ratings')
                    .select('movie_id, overall_rating, acting_rating, pacing_rating, sound_rating, imagery_rating, plot_rating, dialogue_rating, tier, watch_date')
                    .eq('user_id', uid);
                if (rErr) throw rErr;
                const ratings = Array.isArray(ratingsData) ? ratingsData : [];

                const overalls = ratings.map(r => Number(r?.overall_rating)).filter(n => Number.isFinite(n));
                const avgOverall = overalls.length ? (overalls.reduce((a, b) => a + b, 0) / overalls.length) : null;
                const ratingByMovieId = new Map(
                    ratings.map(r => [String(r?.movie_id || '').trim(), r]).filter(e => e[0])
                );

                // Latest watch date per movie from Watch Logs — this is what "My Movies"
                // sorts by, so Recent matches the library's recency order exactly.
                const latestByMovie = new Map();
                try {
                    const { data: wlData } = await supabaseClient
                        .from('Watch Logs').select('movie_id, watch_date').eq('user_id', uid);
                    for (const w of (Array.isArray(wlData) ? wlData : [])) {
                        const mid = String(w?.movie_id || '').trim();
                        const wd = String(w?.watch_date || '').trim();
                        if (!mid || !wd) continue;
                        const prev = latestByMovie.get(mid);
                        if (!prev || wd > prev) latestByMovie.set(mid, wd);
                    }
                } catch (_) {}

                const uniqueCount = latestByMovie.size
                    || new Set(ratings.map(r => String(r?.movie_id || '').trim()).filter(Boolean)).size;

                // Movies (posters/titles/year) for everything rated or watched.
                const movieIds = Array.from(new Set([
                    ...ratings.map(r => r?.movie_id),
                    ...latestByMovie.keys(),
                ].map(x => String(x || '').trim()).filter(Boolean)));
                const moviesById = new Map();
                if (movieIds.length) {
                    const { data: movies } = await supabaseClient
                        .from('Movies').select('id, title, release_year, mpa_rating, tmdb_id, poster_path').in('id', movieIds);
                    for (const m of (Array.isArray(movies) ? movies : [])) moviesById.set(String(m.id), m);
                }

                const toItem = (movieId) => {
                    const id = String(movieId || '').trim();
                    const m = moviesById.get(id) || {};
                    const rr = ratingByMovieId.get(id) || {};
                    return {
                        movie_id: id,
                        title: String(m?.title || '').trim() || 'Untitled',
                        release_year: m?.release_year ?? null,
                        tmdb_id: m?.tmdb_id ?? null,
                        poster_path: String(m?.poster_path || '').trim(),
                        overall_rating: rr?.overall_rating ?? null,
                        acting_rating: rr?.acting_rating ?? null,
                        pacing_rating: rr?.pacing_rating ?? null,
                        sound_rating: rr?.sound_rating ?? null,
                        imagery_rating: rr?.imagery_rating ?? null,
                        plot_rating: rr?.plot_rating ?? null,
                        dialogue_rating: rr?.dialogue_rating ?? null,
                        tier: String(rr?.tier || '').trim(),
                    };
                };

                // All rated movies (full item incl. sub-ratings) — the Top Rated grid
                // sorts/slices this client-side by the selected metric (see renderProfileGrid).
                profileRatedItems = ratings
                    .map(r => toItem(r.movie_id));

                // 10 most recently watched (latest Watch Log date), matching My Movies order.
                profileRecent10 = Array.from(latestByMovie.entries())
                    .sort((a, b) => b[1].localeCompare(a[1]))
                    .slice(0, 10)
                    .map(([mid]) => toItem(mid));

                // Highest-rated director (avg overall, min 2 movies, round 1) — matches the dashboard RPC.
                let highestDirector = '';
                let highestDirectorAvg = null;
                try {
                    if (movieIds.length) {
                        const { data: crew } = await supabaseClient
                            .from('Movie Crew').select('movie_id, person_id, job').in('movie_id', movieIds);
                        const directors = (Array.isArray(crew) ? crew : [])
                            .filter(c => String(c?.job || '').trim().toLowerCase() === 'director');
                        const personIds = Array.from(new Set(directors.map(c => c?.person_id).filter(Boolean)));
                        const nameById = new Map();
                        if (personIds.length) {
                            const { data: ppl } = await supabaseClient.from('People').select('id, name').in('id', personIds);
                            for (const p of (Array.isArray(ppl) ? ppl : [])) nameById.set(String(p.id), String(p?.name || '').trim());
                        }
                        const overallByMovie = new Map(
                            ratings.filter(r => Number.isFinite(Number(r?.overall_rating)))
                                .map(r => [String(r.movie_id), Number(r.overall_rating)])
                        );
                        const agg = new Map(); // name -> { sum, n }
                        for (const c of directors) {
                            const mid = String(c?.movie_id || '');
                            if (!overallByMovie.has(mid)) continue;
                            const name = nameById.get(String(c?.person_id)) || '';
                            if (!name) continue;
                            const cur = agg.get(name) || { sum: 0, n: 0 };
                            cur.sum += overallByMovie.get(mid); cur.n += 1;
                            agg.set(name, cur);
                        }
                        let best = null;
                        for (const [name, { sum, n }] of agg) {
                            if (n < 2) continue;
                            const avg = sum / n;
                            if (!best || avg > best.avg || (avg === best.avg && n > best.n)) best = { name, avg, n };
                        }
                        if (best) { highestDirector = best.name; highestDirectorAvg = best.avg; }
                    }
                } catch (_) {}

                // Taste-match: compare overlapping overall ratings vs. the viewing user.
                // Score = 100 − average absolute rating gap (intuitive "agreement %").
                let compat = null;
                try {
                    const meId = String(getActiveUserId() || '').trim();
                    if (meId && meId !== uid) {
                        const { data: myRatingsData } = await supabaseClient
                            .from('Movie Ratings')
                            .select('movie_id, overall_rating, acting_rating, pacing_rating, sound_rating, imagery_rating, plot_rating, dialogue_rating, tier')
                            .eq('user_id', meId);
                        const myByMovie = new Map();
                        for (const r of (Array.isArray(myRatingsData) ? myRatingsData : [])) {
                            const mid = String(r?.movie_id || '').trim();
                            const v = Number(r?.overall_rating);
                            if (mid && Number.isFinite(v)) myByMovie.set(mid, r);
                        }
                        const pairs = [];
                        for (const [mid, rr] of ratingByMovieId) {
                            const theirs = Number(rr?.overall_rating);
                            if (!Number.isFinite(theirs) || !myByMovie.has(mid)) continue;
                            const me = myByMovie.get(mid);
                            const mrow = moviesById.get(mid) || {};
                            // Keep overall mine/theirs for the Taste Match score, plus the
                            // full rating rows so disagreements can re-sort by any sub-rating.
                            pairs.push({
                                movie_id: mid,
                                title: String(mrow?.title || '').trim() || 'Untitled',
                                release_year: mrow?.release_year ?? null,
                                mpa_rating: String(mrow?.mpa_rating || '').trim(),
                                mine: Number(me?.overall_rating), mineTier: me?.tier, mineRow: me,
                                theirs, theirsTier: rr?.tier, theirsRow: rr,
                            });
                        }
                        if (pairs.length) {
                            // Taste Match = how similarly you two RANK shared movies, not how
                            // close the raw numbers are. Absolute-gap clustered everyone at
                            // 90–100% because most ratings sit in a narrow band; Pearson
                            // correlation removes each rater's offset + scale, so a random
                            // pair sits near 50%, aligned taste high, opposite taste low.
                            const n = pairs.length;
                            const K = 4; // confidence: shrink toward 50% until ~4 shared movies
                            const shrinkToNeutral = (rawPct) => (n * rawPct + K * 50) / (n + K);

                            const meanMine = pairs.reduce((a, p) => a + p.mine, 0) / n;
                            const meanTheirs = pairs.reduce((a, p) => a + p.theirs, 0) / n;
                            let cov = 0, varMine = 0, varTheirs = 0;
                            for (const p of pairs) {
                                const dm = p.mine - meanMine, dt = p.theirs - meanTheirs;
                                cov += dm * dt; varMine += dm * dm; varTheirs += dt * dt;
                            }

                            let rawPct;
                            if (n >= 3 && varMine > 0 && varTheirs > 0) {
                                const r = cov / Math.sqrt(varMine * varTheirs); // -1..1
                                rawPct = ((r + 1) / 2) * 100;                    // 0..100
                            } else {
                                // Too few shared movies, or no rating spread to correlate
                                // → fall back to simple closeness (still shrunk for confidence).
                                const avgAbs = pairs.reduce((a, p) => a + Math.abs(p.mine - p.theirs), 0) / n;
                                rawPct = Math.max(0, 100 - avgAbs);
                            }
                            const score = Math.max(0, Math.min(100, Math.round(shrinkToNeutral(rawPct))));

                            compat = { score, count: pairs.length, userId: uid, pairs };
                        } else {
                            compat = { score: null, count: 0, userId: uid, pairs: [] };
                        }
                    }
                } catch (_) { compat = null; }

                if (titleEl) titleEl.textContent = displayName;
                body.innerHTML = renderProfileBody({ iconId, displayName, username, uniqueCount, avgOverall, highestDirector, highestDirectorAvg, compat, includeHead: false });
                renderProfileGrid();
            } catch (err) {
                body.innerHTML = `<div class="text-gray" style="padding:1rem;">Could not load profile: ${escapeHtml(String(err?.message || err))}</div>`;
            }
        }

        function renderProfileBody({ iconId, displayName, username, uniqueCount, avgOverall, highestDirector, highestDirectorAvg, compat, includeHead = true }) {
            const avgText = (avgOverall === null) ? '—' : dashFormatScore(avgOverall);
            const dirText = highestDirector
                ? `${escapeHtml(highestDirector)}${highestDirectorAvg !== null ? ` (${dashFormatScore(highestDirectorAvg)})` : ''}`
                : '—';

            const themShort = (() => {
                const s = username ? `@${username}` : (String(displayName || '').trim() || 'Them');
                return s.length > 14 ? `${s.slice(0, 13)}…` : s;
            })();
            // Cache for the disagreement-metric dropdown (re-renders without a reload).
            profileCompat = compat || null;
            profileThemShort = themShort;
            const compatHtml = !compat ? '' : `
                <div class="profile-compat">
                    <div class="profile-compat-top">
                        <span class="profile-compat-score tabular-nums">${compat.score === null ? '—' : `${compat.score}%`}</span>
                        <span class="profile-compat-label">Taste Match${compat.count ? ` · ${compat.count} movie${compat.count === 1 ? '' : 's'} in common` : ''}</span>
                    </div>
                    ${compat.score !== null ? `<div class="profile-compat-bar"><div class="profile-compat-bar-fill" style="width:${compat.score}%;"></div></div>` : ''}
                    ${compat.count === 0 ? `<div class="text-xs text-gray" style="margin-top:0.4rem;">No movies in common yet — rate some of the same films to see your match.</div>` : ''}
                    ${(compat.pairs && compat.pairs.length) ? `
                        <div class="profile-compat-subrow">
                            <div class="profile-compat-sub">Biggest disagreements</div>
                            <select id="profile-disagree-metric" class="select-field profile-compat-metric" onchange="setProfileDisagreementMetric(this.value)">
                                ${PROFILE_TOP_METRICS.map(m => `<option value="${m.key}"${m.key === profileDisagreementMetric ? ' selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}
                            </select>
                        </div>
                        <div id="profile-disagree-list">${renderProfileDisagreements()}</div>
                    ` : ''}
                </div>
            `;
            const headHtml = includeHead ? `
                <div class="profile-head">
                    ${renderUserIconHtml(iconId, 64)}
                    <div style="min-width:0;">
                        <div class="profile-name">${escapeHtml(displayName)}</div>
                        ${username ? `<div class="text-xs text-gray">@${escapeHtml(username)}</div>` : ''}
                    </div>
                </div>
            ` : '';
            return `
                ${headHtml}
                <div class="profile-kpis">
                    <div class="profile-kpi"><div class="profile-kpi-value tabular-nums">${uniqueCount}</div><div class="profile-kpi-label">Movies Watched</div></div>
                    <div class="profile-kpi"><div class="profile-kpi-value tabular-nums">${avgText}</div><div class="profile-kpi-label">Avg Overall</div></div>
                    <div class="profile-kpi"><div class="profile-kpi-value" style="font-size:0.95rem;">${dirText}</div><div class="profile-kpi-label">Highest-Rated Director</div></div>
                </div>
                ${compatHtml}
                <div class="profile-toggle">
                    <button type="button" class="nav-link profile-toggle-btn" data-profile-mode="recent" onclick="setProfileMode('recent')">Recent</button>
                    <button type="button" class="nav-link profile-toggle-btn" data-profile-mode="top" onclick="setProfileMode('top')">Top Rated</button>
                    <select id="profile-top-metric" class="select-field profile-compat-metric" onchange="setProfileTopMetric(this.value)" style="display:none;">
                        ${PROFILE_TOP_METRICS.map(m => `<option value="${m.key}"${m.key === profileTopMetric ? ' selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}
                    </select>
                </div>
                <div id="profile-grid"></div>
            `;
        }

        // View another user's diary entry for a specific movie (opened from the
        // profile modal's "Biggest disagreements" chips). Reuses the EXACT same
        // Diary Entry modal (#library-movie-overlay) + renderer as your own
        // entry — just with the other user's LIBRARY_ITEMS_VIEW row, no actions,
        // and stacked above the open profile modal.
        async function openProfileMovieReview(userId, movieId) {
            const uid = String(userId || '').trim();
            const mid = String(movieId || '').trim();
            if (!uid || !mid) return;
            if (!supabaseClient || !cachedIsAuthed) { openAuthModal(); return; }

            const overlay = document.getElementById('library-movie-overlay');
            const titleEl = document.getElementById('library-movie-title');
            const body = document.getElementById('library-movie-body');
            if (!overlay || !body) return;
            if (titleEl) titleEl.textContent = 'Review';
            body.innerHTML = `<div class="text-gray" style="padding:1rem;">Loading…</div>`;
            overlay.style.display = 'flex';
            overlay.style.zIndex = '210'; // stack above the open profile modal (z-index 200)
            overlay.classList.add('open');

            try {
                const [vRes, uRes] = await Promise.all([
                    supabaseClient.from(LIBRARY_ITEMS_VIEW).select('*').eq('user_id', uid).eq('movie_id', mid).limit(1),
                    supabaseClient.from('Users').select('username, display_name').eq('id', uid).maybeSingle(),
                ]);
                const it = Array.isArray(vRes?.data) && vRes.data.length ? vRes.data[0] : null;
                const username = String(uRes?.data?.username || '').trim();
                const name = String(uRes?.data?.display_name || '').trim() || (username ? `@${username}` : 'User');

                if (!it) {
                    if (titleEl) titleEl.textContent = `${name}'s Review`;
                    body.innerHTML = `<div class="text-gray" style="padding:1rem;">No review found.</div>`;
                    return;
                }

                if (titleEl) titleEl.textContent = `${name}'s Review`;
                body.innerHTML = renderLibraryDiaryBody(it, { showActions: false });
            } catch (err) {
                body.innerHTML = `<div class="text-gray" style="padding:1rem;">Could not load review: ${escapeHtml(String(err?.message || err))}</div>`;
            }
        }

        // The rating types the Top Rated grid can sort by (column → display label).
        const PROFILE_TOP_METRICS = [
            { key: 'overall_rating', label: 'Overall' },
            { key: 'acting_rating', label: 'Acting' },
            { key: 'imagery_rating', label: 'Cinematography' },
            { key: 'plot_rating', label: 'Plot' },
            { key: 'pacing_rating', label: 'Pacing' },
            { key: 'dialogue_rating', label: 'Dialogue' },
            { key: 'sound_rating', label: 'Sound' },
        ];
        function profileMetricLabel(key) {
            const m = PROFILE_TOP_METRICS.find(x => x.key === key);
            return m ? m.label : 'Overall';
        }

        // Tie-breaking for the Top Rated grid. Sorting on the selected metric alone
        // left every tie resolved by the order Postgres happened to return the
        // unordered `Movie Ratings` select — arbitrary, and liable to reshuffle
        // between loads. Ties are common (round-number scores cluster hard), so this
        // was reordering most of a typical top 10.
        //
        // Tie-break = the average of the OTHER six ratings, i.e. all seven rating
        // columns minus whichever one is being sorted by. Ranking by Overall breaks
        // ties on the six sub-ratings; ranking by Sound breaks ties on Overall plus
        // the other five. Two movies that tie on the headline number are separated by
        // which one is stronger everywhere else.
        const PROFILE_RATING_KEYS = [
            'overall_rating', 'acting_rating', 'imagery_rating',
            'plot_rating', 'pacing_rating', 'dialogue_rating', 'sound_rating',
        ];

        // Mean of every rating EXCEPT the one being sorted by. All seven are required
        // by the log form, but the columns are nullable, so average over what's really
        // there rather than letting a null read as a 0 and sink the movie.
        function profileOtherRatingsMean(it, metricKey) {
            const vals = PROFILE_RATING_KEYS
                .filter(k => k !== metricKey)
                .map(k => Number(it?.[k]))
                .filter(n => Number.isFinite(n));
            return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) : null;
        }

        function compareProfileTopRated(a, b, metricKey) {
            const key = metricKey || 'overall_rating';

            // The selected metric — the actual ranking signal.
            const byMetric = Number(b?.[key]) - Number(a?.[key]);
            if (byMetric) return byMetric;

            // Tied: rank by the average of everything else. A movie with no other
            // ratings at all has nothing to compare on, so it sorts last of its group.
            const aMean = profileOtherRatingsMean(a, key);
            const bMean = profileOtherRatingsMean(b, key);
            if (aMean === null && bMean === null) return 0;
            if (aMean === null) return 1;
            if (bMean === null) return -1;
            return bMean - aMean;
        }

        function renderProfileMovieCard(it, metricKey) {
            const key = metricKey || 'overall_rating';
            const title = String(it?.title || '').trim() || 'Untitled';
            const year = (it?.release_year === null || it?.release_year === undefined) ? '' : String(it.release_year);
            const tmdb_id = Number(it?.tmdb_id);
            const poster_path = dashNormalizePosterPath(String(it?.poster_path || '').trim() || (Number.isFinite(tmdb_id) ? (dashPosterCacheByTmdbId.get(tmdb_id) || '') : ''));
            const posterUrl = dashBuildPosterUrl(poster_path, 'w342');
            // One movie's own score — whole number. Decimals are for averages.
            const metricText = dashFormatScoreWhole(it?.[key]);
            const metricLabel = profileMetricLabel(key);
            const tierLabel = dashNormalizeTierLabel(it?.tier);
            const titleLine = `${escapeHtml(title)}${year ? ` (${escapeHtml(year)})` : ''}`;
            const metaHtml = dashJoinHelpParts([
                metricText ? `${dashRenderHelpScore(metricText)} ${escapeHtml(metricLabel)}` : '',
                // Tier reflects the movie's overall standing — always show its colored
                // badge regardless of which metric the grid is sorted by.
                tierLabel ? dashRenderHelpTier(tierLabel) : '',
            ]);
            const movieId = String(it?.movie_id || '').trim();
            const clickable = movieId && profileViewUserId;
            const clickAttrs = clickable
                ? ` role="button" tabindex="0" onclick="openProfileMovieReview('${profileViewUserId}','${movieId}')"`
                : '';
            return `
                <div${clickAttrs} style="display:flex; flex-direction: column; gap: 8px;${clickable ? ' cursor:pointer;' : ''}">
                    <div style="width: 100%; aspect-ratio: 2/3; border-radius: 14px; overflow: hidden; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.06);">
                        ${posterUrl
                            ? `<img src="${posterUrl}" loading="lazy" decoding="async" alt="${escapeHtml(title)}" style="width: 100%; height: 100%; object-fit: cover; display:block;">`
                            : `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; color: var(--text-muted); font-size: 12px;">No poster</div>`
                        }
                    </div>
                    <div class="text-sm text-white" style="font-weight: 700; line-height: 1.2;">${titleLine}</div>
                    <div class="text-xs text-gray tabular-nums">${metaHtml}</div>
                </div>
            `;
        }

        function renderProfileGrid() {
            const grid = document.getElementById('profile-grid');
            if (!grid) return;
            document.querySelectorAll('.profile-toggle-btn').forEach(b => {
                b.classList.toggle('active', String(b.dataset.profileMode || '') === profileMode);
            });
            // The Top Rated metric dropdown only applies to the Top Rated view.
            const metricSel = document.getElementById('profile-top-metric');
            if (metricSel) {
                metricSel.style.display = (profileMode === 'top') ? '' : 'none';
                metricSel.value = profileTopMetric;
            }
            const isTop = profileMode === 'top';
            const metricKey = isTop ? profileTopMetric : 'overall_rating';
            const items = isTop
                ? profileRatedItems
                    .filter(it => Number.isFinite(Number(it?.[metricKey])))
                    .sort((a, b) => compareProfileTopRated(a, b, metricKey))
                    .slice(0, 10)
                : profileRecent10;
            grid.innerHTML = items.length
                ? `<div class="dash-fav-grid">${items.map(it => renderProfileMovieCard(it, metricKey)).join('')}</div>`
                : `<div class="text-gray" style="padding:0.5rem;">No rated movies yet.</div>`;
        }

        function setProfileMode(mode) {
            profileMode = (mode === 'top') ? 'top' : 'recent';
            renderProfileGrid();
        }

        function setProfileTopMetric(key) {
            const valid = PROFILE_TOP_METRICS.some(m => m.key === key);
            profileTopMetric = valid ? key : 'overall_rating';
            renderProfileGrid();
        }

        // Builds the "Biggest disagreements" rows for the profile modal, ranked by
        // the chosen rating metric (overall by default; acting/plot/etc. selectable).
        // Only movies where BOTH users rated that metric count toward the ranking.
        function renderProfileDisagreements() {
            const compat = profileCompat;
            if (!compat || !Array.isArray(compat.pairs) || !compat.pairs.length) return '';
            const metricKey = PROFILE_TOP_METRICS.some(m => m.key === profileDisagreementMetric)
                ? profileDisagreementMetric : 'overall_rating';
            const metricLabel = profileMetricLabel(metricKey);
            const themUid = escapeHtml(String(compat.userId || ''));
            const tierStyle = (tierRaw) => {
                const letter = dashTierLetterFromLabel(dashNormalizeTierLabel(tierRaw));
                return letter ? ` style="color:rgb(var(--tier-${letter.toLowerCase()}-rgb));"` : '';
            };

            const ranked = compat.pairs
                .map(p => ({
                    ...p,
                    mineVal: Number(p?.mineRow?.[metricKey]),
                    theirsVal: Number(p?.theirsRow?.[metricKey]),
                }))
                .filter(p => Number.isFinite(p.mineVal) && Number.isFinite(p.theirsVal))
                .sort((a, b) => Math.abs(b.mineVal - b.theirsVal) - Math.abs(a.mineVal - a.theirsVal))
                .slice(0, 3);

            if (!ranked.length) {
                return `<div class="text-xs text-gray" style="margin-top:0.4rem;">No movies you both rated for ${escapeHtml(metricLabel)} yet.</div>`;
            }
            return ranked.map(d => {
                const mid = escapeHtml(String(d.movie_id || ''));
                // Title formatted "Movie Title (Year) - MPA RATING" (year/MPA omitted if missing).
                const yearStr = (d.release_year === null || d.release_year === undefined || d.release_year === '')
                    ? '' : String(d.release_year);
                const mpaStr = String(d.mpa_rating || '').trim();
                const metaBits = [yearStr ? `(${escapeHtml(yearStr)})` : '', mpaStr ? `- ${escapeHtml(mpaStr)}` : '']
                    .filter(Boolean).join(' ');
                return `
                <div class="profile-compat-item">
                    <div class="profile-compat-title">${escapeHtml(d.title)}${metaBits ? ` <span class="profile-compat-title-meta">${metaBits}</span>` : ''}</div>
                    <div class="profile-compat-chips">
                        <span class="profile-compat-chip" role="button" tabindex="0" style="cursor:pointer;" onclick="try{initLibraryPage()}catch(e){}openLibraryMovieModal('${mid}')">You — <strong${tierStyle(d.mineTier)}>${dashFormatScoreWhole(d.mineVal)}</strong> ${escapeHtml(metricLabel)}</span>
                        <span class="profile-compat-chip" role="button" tabindex="0" style="cursor:pointer;" onclick="openProfileMovieReview('${themUid}','${mid}')">${escapeHtml(profileThemShort)} — <strong${tierStyle(d.theirsTier)}>${dashFormatScoreWhole(d.theirsVal)}</strong> ${escapeHtml(metricLabel)}</span>
                        <span class="profile-compat-gap" style="color:#fff;">${Math.round(Math.abs(d.mineVal - d.theirsVal))}% apart</span>
                    </div>
                </div>
                `;
            }).join('');
        }

        function setProfileDisagreementMetric(key) {
            const valid = PROFILE_TOP_METRICS.some(m => m.key === key);
            profileDisagreementMetric = valid ? key : 'overall_rating';
            const list = document.getElementById('profile-disagree-list');
            if (list) list.innerHTML = renderProfileDisagreements();
        }

        // Follow / unfollow from another user's Account page. Mirrors the Feed's
        // follow handler (insert/delete on Follows + best-effort new-follower push).
        // Returns the new follow state (true = now following) or null on failure.
        async function toggleAccountFollow(targetUserId, isFollowing, btn) {
            const targetId = String(targetUserId || '').trim();
            if (!targetId) return null;
            let authedUser = null;
            let authedAccessToken = null;
            try {
                if (guardGuestWrite()) return null;
                const { user, accessToken } = await requireAuthOrThrow();
                authedUser = user;
                authedAccessToken = accessToken;
            } catch (err) {
                showToast(String(err?.message || err), { level: 'warn' });
                return null;
            }
            if (targetId === authedUser.id) {
                showToast('You cannot follow yourself.', { level: 'warn' });
                return null;
            }
            const prevLabel = btn ? btn.textContent : '';
            if (btn) { btn.disabled = true; btn.textContent = '…'; }
            // Follow state drives the feed, the account follow counts and the leaderboard,
            // so no stored copy of those pages survives this.
            try { invalidatePageSnapshots(['feed', 'account', 'leaderboard']); } catch (_) {}
            try {
                if (isFollowing) {
                    const { error } = await supabaseClient
                        .from('Follows').delete()
                        .eq('follower_id', authedUser.id).eq('followed_id', targetId);
                    if (error) throw error;
                    showToast('Unfollowed.', { level: 'success' });
                    return false;
                } else {
                    const { error } = await supabaseClient
                        .from('Follows').insert({ follower_id: authedUser.id, followed_id: targetId });
                    if (error) throw error;
                    showToast('Followed!', { level: 'success' });
                    try { callSwiftApi({ action: 'notify_new_follower', followed_id: targetId }, authedAccessToken).catch(() => null); } catch (_) {}
                    return true;
                }
            } catch (err) {
                if (btn) { btn.disabled = false; btn.textContent = prevLabel; }
                showToast(`Could not update: ${String(err?.message || err)}`, { level: 'warn' });
                return null;
            }
        }

        const FEED_FILTER_EXCLUDED_KEY = 'ct_feed_excluded_user_ids';
        const FEED_FILTER_COMPARE_OWN_KEY = 'ct_feed_compare_own';
        const FEED_FILTER_IN_COMMON_KEY = 'ct_feed_in_common_only';

        function loadFeedFilterPrefs() {
            if (feedFilterPrefsLoaded) return;
            feedFilterPrefsLoaded = true;
            try {
                const rawEx = localStorage.getItem(FEED_FILTER_EXCLUDED_KEY);
                if (rawEx) {
                    const arr = JSON.parse(rawEx);
                    if (Array.isArray(arr)) feedExcludedUserIds = new Set(arr.map((x) => String(x)));
                }
                feedCompareOwn = localStorage.getItem(FEED_FILTER_COMPARE_OWN_KEY) === '1';
                feedInCommonOnly = localStorage.getItem(FEED_FILTER_IN_COMMON_KEY) === '1';
            } catch (_) {
                // Best-effort; defaults already set.
            }
        }

        function saveFeedFilterPrefs() {
            try {
                localStorage.setItem(FEED_FILTER_EXCLUDED_KEY, JSON.stringify(Array.from(feedExcludedUserIds)));
                localStorage.setItem(FEED_FILTER_COMPARE_OWN_KEY, feedCompareOwn ? '1' : '0');
                localStorage.setItem(FEED_FILTER_IN_COMMON_KEY, feedInCommonOnly ? '1' : '0');
            } catch (_) {
                // Best-effort.
            }
            syncFeedFilterButton();
        }

        // Updates the "Filter" button to show when a non-default filter is active.
        function syncFeedFilterButton() {
            const btn = document.getElementById('feed-filter-btn');
            if (!btn) return;
            const followed = Array.from(feedFollowingIds);
            const excludedCount = followed.filter((id) => feedExcludedUserIds.has(id)).length;
            const active = excludedCount > 0 || feedCompareOwn || feedInCommonOnly;
            btn.classList.toggle('active', active);
            btn.classList.toggle('filter-active', active); // vibrant solid highlight
            // NOTE: the button is now an icon — don't set textContent (it would wipe the SVG).
            syncFeedClearButton();
        }

        // Light up the Clear button in RED when there's anything to clear (an active
        // filter OR a title search).
        function syncFeedClearButton() {
            const btn = document.getElementById('feed-clear-btn');
            if (!btn) return;
            const followed = Array.from(feedFollowingIds);
            const excludedCount = followed.filter((id) => feedExcludedUserIds.has(id)).length;
            const active = excludedCount > 0 || feedCompareOwn || feedInCommonOnly
                || !!String(feedSearchQuery || '').trim();
            btn.classList.toggle('clear-active', active);
        }

        // Fetch the people the active user follows (for the Filter modal list).
        async function loadFeedFilterUsers() {
            const ids = Array.from(feedFollowingIds);
            if (ids.length === 0) {
                feedFilterUsersCache = [];
                return;
            }
            let data = null;
            try {
                const r1 = await supabaseClient
                    .from('Users')
                    .select('id, username, display_name, icon')
                    .in('id', ids);
                if (r1.error) throw r1.error;
                data = r1.data;
            } catch (err1) {
                const msg1 = String(err1?.message || err1);
                if (/column\s+"?icon"?\s+does\s+not\s+exist/i.test(msg1)) {
                    const r2 = await supabaseClient
                        .from('Users')
                        .select('id, username, display_name')
                        .in('id', ids);
                    if (r2.error) throw r2.error;
                    data = r2.data;
                } else {
                    throw err1;
                }
            }
            const rows = Array.isArray(data) ? data : [];
            const map = new Map(rows.map((r) => [String(r?.id || '').trim(), r]));
            // Preserve follow order, then sort by display name for the picker.
            feedFilterUsersCache = ids
                .map((id) => map.get(id))
                .filter(Boolean)
                .sort((a, b) => {
                    const an = String(a?.display_name || a?.username || '').toLowerCase();
                    const bn = String(b?.display_name || b?.username || '').toLowerCase();
                    return an.localeCompare(bn);
                });
        }

        // Render the (optionally search-filtered) checklist of followed users.
        function renderFeedFilterList() {
            const list = document.getElementById('feed-filter-list');
            if (!list) return;

            const query = String(document.getElementById('feed-filter-search')?.value || '').trim().toLowerCase();

            if (feedFilterUsersCache.length === 0) {
                list.innerHTML = `<div class="text-gray" style="padding: 0.6rem;">You aren’t following anyone yet.</div>`;
                return;
            }

            const filtered = query
                ? feedFilterUsersCache.filter((u) => {
                    const uname = String(u?.username || '').toLowerCase();
                    const dname = String(u?.display_name || '').toLowerCase();
                    return uname.includes(query) || dname.includes(query);
                })
                : feedFilterUsersCache;

            if (filtered.length === 0) {
                list.innerHTML = `<div class="text-gray" style="padding: 0.6rem;">No matches for “${escapeHtml(query)}”.</div>`;
                return;
            }

            // Tap-to-toggle avatar chips (selected = shown in feed). Compact wrap grid.
            list.innerHTML = filtered.map((u) => {
                const id = String(u?.id || '').trim();
                const username = String(u?.username || '').trim();
                const name = String(u?.display_name || '').trim() || (username ? `@${username}` : 'User');
                const iconId = String(u?.icon || '').trim();
                const selected = !feedExcludedUserIds.has(id);
                return `
                    <button type="button" class="feed-filter-chip${selected ? ' is-selected' : ''}" data-feed-user-id="${escapeHtml(id)}" aria-pressed="${selected ? 'true' : 'false'}" title="${escapeHtml(name)}">
                        ${renderUserIconHtml(iconId, 30)}
                        <span class="feed-filter-chip-name">${escapeHtml(name)}</span>
                    </button>
                `;
            }).join('');
        }

        async function openFeedFilterModal() {
            const overlay = document.getElementById('feed-filter-overlay');
            if (!overlay) return;

            loadFeedFilterPrefs();

            // Sync the "Compare Own" checkbox.
            const ownCb = document.getElementById('feed-filter-compare-own');
            if (ownCb) ownCb.checked = Boolean(feedCompareOwn);

            // Sync the "Only movies in common" checkbox.
            const commonCb = document.getElementById('feed-filter-in-common');
            if (commonCb) commonCb.checked = Boolean(feedInCommonOnly);

            // Reset the search box each open.
            const search = document.getElementById('feed-filter-search');
            if (search) search.value = '';

            const list = document.getElementById('feed-filter-list');
            if (list) list.innerHTML = `<div class="text-gray" style="padding: 0.6rem;">Loading…</div>`;

            overlay.style.display = 'flex';
            overlay.classList.add('open');

            try {
                await loadFeedFilterUsers();
            } catch (err) {
                if (list) list.innerHTML = `<div class="text-gray" style="padding: 0.6rem;">Couldn’t load your follows: ${escapeHtml(String(err?.message || err))}</div>`;
                return;
            }
            renderFeedFilterList();
        }

        async function closeFeedFilterModal() {
            const overlay = document.getElementById('feed-filter-overlay');
            if (overlay) {
                overlay.classList.remove('open');
                overlay.style.display = 'none';
            }
            // Apply the chosen filters.
            syncFeedFilterButton();
            try {
                await loadFeedItems();
            } catch (err) {
                showToast(`Feed failed: ${String(err?.message || err)}`, { level: 'warn' });
            }
        }

        async function loadFeedFollowingList() {
            const el = document.getElementById('feed-following');
            if (!el) return;

            if (!supabaseClient || !cachedIsAuthed) {
                el.innerHTML = `<div class="text-gray">Log in to manage follows.</div>`;
                return;
            }

            const ids = Array.from(feedFollowingIds);
            if (ids.length === 0) {
                el.innerHTML = `<div class="text-gray">You aren’t following anyone yet.</div>`;
                return;
            }

            let data = null;
            try {
                const r1 = await supabaseClient
                    .from('Users')
                    .select('id, username, display_name, privacy_level, icon')
                    .in('id', ids);
                if (r1.error) throw r1.error;
                data = r1.data;
            } catch (err1) {
                const msg1 = String(err1?.message || err1);
                if (/column\s+"?icon"?\s+does\s+not\s+exist/i.test(msg1)) {
                    const r2 = await supabaseClient
                        .from('Users')
                        .select('id, username, display_name, privacy_level')
                        .in('id', ids);
                    if (r2.error) throw r2.error;
                    data = r2.data;
                } else {
                    throw err1;
                }
            }

            const rows = Array.isArray(data) ? data : [];
            // Preserve the order of ids.
            const map = new Map(rows.map(r => [String(r?.id || '').trim(), r]));
            const ordered = ids.map(id => map.get(id)).filter(Boolean);

            el.innerHTML = ordered.map((u) => {
                const id = String(u?.id || '').trim();
                const username = String(u?.username || '').trim();
                const name = String(u?.display_name || '').trim() || (username ? `@${username}` : 'User');
                const privacy = String(u?.privacy_level || 'public').trim();
                const iconId = String(u?.icon || '').trim();
                return `
                    <div class="glass-panel" style="padding: 0.75rem; border-radius: 0.9rem; display:flex; align-items:center; justify-content: space-between; gap: 10px;">
                        <div style="min-width:0; display:flex; gap: 10px; align-items: center; cursor:pointer;" data-feed-action="open_profile" data-feed-user-id="${escapeHtml(id)}" role="button" tabindex="0" title="View ${escapeHtml(username || 'profile')}">
                            ${renderUserIconHtml(iconId, 28)}
                            <div style="min-width:0;">
                                <div class="text-white font-semibold" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(name)}</div>
                                <div class="text-xs text-gray" style="margin-top: 0.15rem;">${username ? `@${escapeHtml(username)}` : ''}${privacy ? ` • ${escapeHtml(privacy)}` : ''}</div>
                            </div>
                        </div>
                        <button type="button" class="btn btn-outline" data-feed-action="unfollow" data-feed-user-id="${escapeHtml(id)}" style="padding: 0.45rem 0.7rem; border-radius: 0.75rem;">Unfollow</button>
                    </div>
                `;
            }).join('');
        }

        async function searchFeedUsers(query) {
            const el = document.getElementById('feed-search-results');
            if (!el) return;
            const q = String(query || '').trim();
            feedLastSearchQuery = q;

            if (!q) {
                el.innerHTML = `<div class="text-gray">Type a username to search.</div>`;
                return;
            }

            if (!supabaseClient || !cachedIsAuthed) {
                el.innerHTML = `<div class="text-gray">Log in to search users.</div>`;
                return;
            }

            el.innerHTML = `<div class="text-gray">Searching…</div>`;

            let data = null;
            // Search by username OR email via the SECURITY DEFINER RPC (email lives in
            // auth.users and is never returned — see search_users.sql).
            try {
                const r = await supabaseClient.rpc('search_users', { p_query: q });
                if (r.error) throw r.error;
                data = r.data;
            } catch (errRpc) {
                // Fallback (e.g. search_users() not created yet): username-only query.
                try {
                    const r1 = await supabaseClient
                        .from('Users')
                        .select('id, username, display_name, privacy_level, icon')
                        .ilike('username', `%${q}%`)
                        .limit(20);
                    if (r1.error) throw r1.error;
                    data = r1.data;
                } catch (err1) {
                    const msg1 = String(err1?.message || err1);
                    if (/column\s+"?icon"?\s+does\s+not\s+exist/i.test(msg1)) {
                        const r2 = await supabaseClient
                            .from('Users')
                            .select('id, username, display_name, privacy_level')
                            .ilike('username', `%${q}%`)
                            .limit(20);
                        if (r2.error) throw r2.error;
                        data = r2.data;
                    } else {
                        throw err1;
                    }
                }
            }

            const rows = Array.isArray(data) ? data : [];
            if (rows.length === 0) {
                el.innerHTML = `<div class="text-gray">No users found for “${escapeHtml(q)}”.</div>`;
                return;
            }

            // Determine authed user id so we can hide follow-self.
            let authedUserId = '';
            if (guestMode) {
                authedUserId = DEMO_USER_ID;
            } else {
                try {
                    const { data: udata } = await supabaseClient.auth.getUser();
                    authedUserId = String(udata?.user?.id || '').trim();
                } catch (_) {
                    authedUserId = '';
                }
            }

            el.innerHTML = rows.map((u) => {
                const id = String(u?.id || '').trim();
                const username = String(u?.username || '').trim();
                const name = String(u?.display_name || '').trim() || (username ? `@${username}` : 'User');
                const privacy = String(u?.privacy_level || 'public').trim();
                const iconId = String(u?.icon || '').trim();
                const isMe = authedUserId && id === authedUserId;
                const isFollowing = feedFollowingIds.has(id);

                const right = isMe
                    ? `<span class="text-xs text-gray" style="white-space: nowrap;">This is you</span>`
                    : (isFollowing
                        ? `<button type="button" class="btn btn-outline" data-feed-action="unfollow" data-feed-user-id="${escapeHtml(id)}" style="padding: 0.45rem 0.7rem; border-radius: 0.75rem;">Unfollow</button>`
                        : `<button type="button" class="btn btn-primary" data-feed-action="follow" data-feed-user-id="${escapeHtml(id)}" style="padding: 0.45rem 0.7rem; border-radius: 0.75rem;">Follow</button>`);

                return `
                    <div class="glass-panel" style="padding: 0.75rem; border-radius: 0.9rem; display:flex; align-items:center; justify-content: space-between; gap: 10px;">
                        <div style="min-width:0; display:flex; gap: 10px; align-items: center;">
                            ${renderUserIconHtml(iconId, 28)}
                            <div style="min-width:0;">
                                <div class="text-white font-semibold" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(name)}</div>
                                <div class="text-xs text-gray" style="margin-top: 0.15rem;">${username ? `@${escapeHtml(username)}` : ''}${privacy ? ` • ${escapeHtml(privacy)}` : ''}</div>
                            </div>
                        </div>
                        ${right}
                    </div>
                `;
            }).join('');
        }

        async function loadFeedItems(opts = {}) {
            // appendInCommon=true → in-common "Load More": fetch the next in-common page.
            // appendNormal=true   → normal-feed infinite scroll: fetch the next 100 newest
            //                       reviews. Both append to their accumulator + re-render
            //                       WITHOUT resetting or re-showing the loading skeleton.
            const appendInCommon = opts.appendInCommon === true;
            const appendNormal = opts.appendNormal === true;
            const elList = document.getElementById('feed-list');
            const elMeta = document.getElementById('feed-meta');
            if (!elList) return;
            syncPageSearchButton('feed');


            if (!supabaseClient || !cachedIsAuthed) {
                elList.innerHTML = `<div class="text-gray">Log in to view your feed.</div>`;
                if (elMeta) elMeta.textContent = '';
                return;
            }

            // Logged-in user's id — needed for "Compare Own", to mark your own cards, and
            // to seed the Bucket List star pre-fill. Resolve from the LOCAL session first
            // (auth.getSession, the same source the working add-to-bucket path uses):
            // auth.getUser() validates server-side and was coming back EMPTY here, which
            // left authedUserId blank, so the bucket-star seed bailed with "no signed-in
            // user id resolved" and no star ever pre-filled.
            let authedUserId = '';
            if (guestMode) {
                authedUserId = DEMO_USER_ID;
            } else {
                try {
                    const { data: sdata } = await supabaseClient.auth.getSession();
                    authedUserId = String(sdata?.session?.user?.id || '').trim();
                } catch (_) {}
                if (!authedUserId) {
                    try {
                        const { data: udata } = await supabaseClient.auth.getUser();
                        authedUserId = String(udata?.user?.id || '').trim();
                    } catch (_) {}
                }
                if (!authedUserId && typeof getActiveUserId === 'function') {
                    authedUserId = String(getActiveUserId() || '').trim();
                }
            }

            loadFeedFilterPrefs();

            // Last-resort guard against rendering the "Follow someone…" empty state off a
            // set that just hasn't loaded yet (a concurrent caller could still be resolving
            // it). If we have a signed-in user but zero follows, re-resolve once and only
            // then trust the empty answer.
            if (feedFollowingIds.size === 0 && authedUserId) {
                try { await loadMyFollowingIds(); } catch (_) {}
            }
            const followedIds = Array.from(feedFollowingIds);

            // Whose entries to show: followed users that are NOT unchecked in the Filter,
            // plus the active user's own entries when "Compare Own" is enabled.
            const selectedFollowed = followedIds.filter((id) => !feedExcludedUserIds.has(id));
            const queryUserIds = [...selectedFollowed];
            if (feedCompareOwn && authedUserId && !queryUserIds.includes(authedUserId)) {
                queryUserIds.push(authedUserId);
            }

            if (followedIds.length === 0 && !feedCompareOwn) {
                elList.innerHTML = `<div class="text-gray">Follow someone to see activity here.</div>`;
                if (elMeta) elMeta.textContent = '';
                return;
            }
            if (queryUserIds.length === 0) {
                elList.innerHTML = `<div class="text-gray">No one selected. Tap “Filter” to choose whose entries to show.</div>`;
                if (elMeta) elMeta.textContent = '';
                return;
            }

            if (!appendInCommon && !appendNormal) {
                elList.innerHTML = loadingPlaceholder('rows');
                if (elMeta) elMeta.textContent = '';
            }

            const ratingCols = 'id, user_id, movie_id, overall_rating, tier, watch_date, updated_at, created_at, fav_quote, notes, sound_rating, pacing_rating, imagery_rating, acting_rating, plot_rating, dialogue_rating';

            // 1) Watch logs. Normal feed = recent 60. "In common" loads 1000 at a
            //    time (accumulated across "Load More"), so older overlaps aren't cut off.
            let wrows = [];
            if (feedInCommonOnly) {
                if (!appendInCommon) { feedInCommonWatchRows = []; feedInCommonOffset = 0; feedInCommonHasMore = false; }
                const { data, error: wErr } = await supabaseClient
                    .from('Watch Logs')
                    .select('user_id, movie_id, watch_date')
                    .in('user_id', queryUserIds)
                    .order('watch_date', { ascending: false })
                    .range(feedInCommonOffset, feedInCommonOffset + FEED_IN_COMMON_PAGE - 1);
                if (wErr) throw wErr;
                const batch = Array.isArray(data) ? data : [];
                feedInCommonWatchRows.push(...batch);
                feedInCommonOffset += batch.length;
                feedInCommonHasMore = batch.length === FEED_IN_COMMON_PAGE;
                wrows = feedInCommonWatchRows;
            } else {
                // Normal feed: drive selection + order by the most recently
                // POSTED reviews (Movie Ratings.created_at = when the review was first
                // written), NOT updated_at — so going back to EDIT an old rating updates
                // it in place without resurfacing it to the top of followers' feeds.
                // Top 100, then infinite-scroll appends the next 100 (accumulated in
                // feedNormalRows). Shaped like watch rows so the dedup/merge is unchanged.
                if (!appendNormal) { feedNormalRows = []; feedNormalOffset = 0; feedNormalHasMore = false; }
                // The boot prewarm (27-prewarm.js) may already hold this exact first page —
                // it's the query everything below depends on, so skipping it removes a full
                // round-trip from the critical path. Only valid for page 1 of the same set
                // of users (takeFeedFirstPagePrewarm checks that).
                let pre = null;
                if (!appendNormal) {
                    try { pre = takeFeedFirstPagePrewarm(queryUserIds); } catch (_) {}
                }
                let recent = pre;
                if (!pre) {
                    const { data, error: wErr } = await supabaseClient
                        .from('Movie Ratings')
                        .select('user_id, movie_id, watch_date, updated_at, created_at')
                        .in('user_id', queryUserIds)
                        .order('created_at', { ascending: false, nullsFirst: false })
                        .range(feedNormalOffset, feedNormalOffset + FEED_NORMAL_PAGE - 1);
                    if (wErr) throw wErr;
                    recent = data;
                }
                const batch = Array.isArray(recent) ? recent : [];
                feedNormalRows.push(...batch);
                feedNormalOffset += batch.length;
                feedNormalHasMore = batch.length === FEED_NORMAL_PAGE;
                wrows = feedNormalRows;
            }

            // 2) Dedup to one (user, movie) pair, keeping the most recent watch.
            let pairs = [];
            {
                const seen = new Set();
                for (const w of wrows) {
                    const uid = String(w?.user_id || '').trim();
                    const mid = String(w?.movie_id || '').trim();
                    if (!uid || !mid) continue;
                    const k = `${uid}|${mid}`;
                    if (seen.has(k)) continue;
                    seen.add(k);
                    pairs.push({ user_id: uid, movie_id: mid, watch_date: w?.watch_date });
                }
            }

            // 3) "Only movies in common": keep only movies watched by 2+ shown users.
            if (feedInCommonOnly && pairs.length) {
                const usersByMovie = new Map();
                for (const p of pairs) {
                    if (!usersByMovie.has(p.movie_id)) usersByMovie.set(p.movie_id, new Set());
                    usersByMovie.get(p.movie_id).add(p.user_id);
                }
                pairs = pairs.filter(p => (usersByMovie.get(p.movie_id)?.size || 0) >= 2);
            }

            // 4) Fetch ratings for just these pairs (chunked movie ids to keep the URL
            //    sane) and merge into the display rows.
            let rows = [];
            if (pairs.length) {
                const movieIds2 = Array.from(new Set(pairs.map(p => p.movie_id)));
                const userIds2 = Array.from(new Set(pairs.map(p => p.user_id)));
                const ratingMap = new Map();
                for (let i = 0; i < movieIds2.length; i += 300) {
                    const chunk = movieIds2.slice(i, i + 300);
                    const { data, error: rErr } = await supabaseClient
                        .from('Movie Ratings')
                        .select(ratingCols)
                        .in('movie_id', chunk)
                        .in('user_id', userIds2);
                    if (rErr) throw rErr;
                    for (const rr of (Array.isArray(data) ? data : [])) {
                        const kk = `${String(rr?.user_id || '').trim()}|${String(rr?.movie_id || '').trim()}`;
                        if (kk !== '|') ratingMap.set(kk, rr);
                    }
                }
                for (const p of pairs) {
                    const rr = ratingMap.get(`${p.user_id}|${p.movie_id}`) || {};
                    rows.push({ ...rr, user_id: p.user_id, movie_id: p.movie_id, watch_date: p.watch_date });
                }
            }

            if (rows.length === 0) {
                if (feedInCommonOnly) {
                    const tip = feedCompareOwn ? '' : ' Tip: enable “Compare Own” to include your own movies.';
                    const more = feedInCommonHasMore ? ' Use “Load More” to scan older watches.' : '';
                    elList.innerHTML = `<div class="text-gray">No movies in common yet — the people shown haven't watched the same movie.${tip}${more}</div>`;
                    if (elMeta) elMeta.textContent = '';
                    renderFeedInCommonLoadMore(elList);
                    return;
                }
                elList.innerHTML = `<div class="text-gray">No recent watch logs found (or privacy blocks access).</div>`;
                if (elMeta) elMeta.textContent = '';
                renderFeedNormalLoadMore(elList);
                return;
            }

            const movieIds = Array.from(new Set(rows.map(r => r?.movie_id).filter(Boolean)));
            const userIds = Array.from(new Set(rows.map(r => r?.user_id).filter(Boolean)));

            // Movies the active user recommended to the people shown — so a NEW entry
            // for one of those gets a distinct "your rec paid off" highlight.
            const myRecSentPairs = new Set(); // `${to_user_id}|${movie_id}`
            if (authedUserId && movieIds.length && userIds.length) {
                try {
                    const { data: recsSent } = await supabaseClient
                        .from('Recommendations')
                        .select('to_user_id, movie_id')
                        .eq('from_user_id', authedUserId)
                        .in('movie_id', movieIds)
                        .in('to_user_id', userIds);
                    for (const rr of (Array.isArray(recsSent) ? recsSent : [])) {
                        const k = `${String(rr?.to_user_id || '').trim()}|${String(rr?.movie_id || '').trim()}`;
                        if (k !== '|') myRecSentPairs.add(k);
                    }
                } catch (_) { /* best-effort; falls back to normal highlight */ }
            }

            const moviesById = new Map();
            if (movieIds.length) {
                const { data: moviesData, error: moviesErr } = await supabaseClient
                    .from('Movies')
                    .select('id, title, release_year, tmdb_id, poster_path')
                    .in('id', movieIds);
                if (moviesErr) throw moviesErr;
                const mrows = Array.isArray(moviesData) ? moviesData : [];
                for (const m of mrows) moviesById.set(m.id, m);
            }

            const usersById = new Map();
            if (userIds.length) {
                let usersData = null;
                try {
                    const r1 = await supabaseClient
                        .from('Users')
                        .select('id, username, display_name, icon')
                        .in('id', userIds);
                    if (r1.error) throw r1.error;
                    usersData = r1.data;
                } catch (err1) {
                    const msg1 = String(err1?.message || err1);
                    if (/column\s+"?icon"?\s+does\s+not\s+exist/i.test(msg1)) {
                        const r2 = await supabaseClient
                            .from('Users')
                            .select('id, username, display_name')
                            .in('id', userIds);
                        if (r2.error) throw r2.error;
                        usersData = r2.data;
                    } else {
                        throw err1;
                    }
                }

                const urows = Array.isArray(usersData) ? usersData : [];
                for (const u of urows) usersById.set(u.id, u);
            }

            // Which of these feed movies are ALREADY in the viewer's Bucket List, so
            // their add-button renders pre-filled (solid star). Resolve the Bucket List
            // the EXACT same way the add-button's click handler does — via
            // ensureBucketListForUser — so the list id is guaranteed identical (an earlier
            // direct Lists query was resolving to nothing/another id, which is why the star
            // never pre-filled even though the click handler found the movie). Then read
            // the WHOLE list once and cache every movie_id.
            await seedFeedBucketMovieIds(authedUserId);

            // Posters are lazy-loaded from stored DB poster_path; no TMDb calls.

            // Title search (magnifier popup): narrow the already-loaded rows to movies
            // whose title (close-)matches the query before grouping/rendering.
            if (String(feedSearchQuery || '').trim()) {
                rows = rows.filter((r) => movieTitleMatchesSearch(moviesById.get(r?.movie_id)?.title, feedSearchQuery));
                if (rows.length === 0) {
                    elList.innerHTML = `<div class="text-gray">No reviews match “${escapeHtml(feedSearchQuery)}”.</div>`;
                    if (elMeta) elMeta.textContent = '';
                    renderFeedInCommonLoadMore(elList);
                    // Keep paging older reviews so the search can scan beyond this batch.
                    renderFeedNormalLoadMore(elList);
                    return;
                }
            }

            // Track which about-to-render reviews are the viewer's own, so a count-pill
            // tap on them reveals the "who reacted" popup instead of toggling a reaction.
            feedOwnRatingIds.clear();
            for (const r of rows) {
                const rid = String(r?.id || '').trim();
                if (rid && String(r?.user_id || '').trim() === String(authedUserId || '').trim()) feedOwnRatingIds.add(rid);
            }

            // Load emoji reactions for every review about to render, so each card's
            // reaction bar shows current counts + the viewer's own reactions.
            await loadFeedReactions(rows.map((r) => r?.id), authedUserId);

            if (elMeta) {
                const modeLabel = feedCompareOwn ? 'You + selected follows' : 'Selected follows';
                const orderLabel = feedInCommonOnly ? 'Most recent watches first' : 'Most recently updated first';
                elMeta.textContent = `${rows.length} item${rows.length === 1 ? '' : 's'} • ${modeLabel} • ${orderLabel}`;
            }

            const renderFeedCard = (r) => {
                const actorId = String(r?.user_id || '').trim();
                const actor = usersById.get(actorId) || null;
                const actorUsernameRaw = String(actor?.username || '').trim().replace(/^@+/, '');
                const actorUsername = actorUsernameRaw ? `@${actorUsernameRaw}` : 'User';
                const actorIconId = String(actor?.icon || '').trim();

                const movie = moviesById.get(r?.movie_id) || null;
                const movieIdStr = String(r?.movie_id || '').trim();
                const movieTmdbStr = (movie?.tmdb_id === null || movie?.tmdb_id === undefined) ? '' : String(movie.tmdb_id);
                const inBucket = (movieIdStr && feedBucketMovieIds.has(movieIdStr))
                    || (movieTmdbStr && feedBucketTmdbIds.has(movieTmdbStr));
                const title = String(movie?.title || '').trim() || 'Untitled';
                const year = (movie?.release_year === null || movie?.release_year === undefined) ? '' : String(movie.release_year);

                const overall = dashFormatScoreWhole(r?.overall_rating);
                const tierLabel = dashNormalizeTierLabel(r?.tier);

                const tmdb_id = Number(movie?.tmdb_id);
                const poster_path = dashNormalizePosterPath(String(movie?.poster_path ?? '').trim() || (Number.isFinite(tmdb_id) ? (dashPosterCacheByTmdbId.get(tmdb_id) || '') : ''));
                const posterUrl = dashBuildPosterUrl(poster_path, 'w342');

                const quote = String(r?.fav_quote ?? '').trim();
                const notes = String(r?.notes ?? '').trim();
                const updatedAt = formatFeedTimestamp(r?.updated_at);
                const watched = String(r?.watch_date ?? '').trim();

                const subRatingRows = [
                    { k: 'Sound', v: dashFormatScoreWhole(r?.sound_rating) },
                    { k: 'Pace', v: dashFormatScoreWhole(r?.pacing_rating) },
                    { k: 'Imagery', v: dashFormatScoreWhole(r?.imagery_rating) },
                    { k: 'Acting', v: dashFormatScoreWhole(r?.acting_rating) },
                    { k: 'Plot', v: dashFormatScoreWhole(r?.plot_rating) },
                    { k: 'Dialogue', v: dashFormatScoreWhole(r?.dialogue_rating) },
                ].filter(x => String(x.v || '').trim());

                // Highlight only OTHER people's brand-NEW entries (by created_at, the
                // original post time) since you last looked — never your own, and never
                // a mere edit of an old review.
                const isNew = feedHighlightSince
                    && actorId !== authedUserId
                    && String(r?.created_at || '') > feedHighlightSince;
                // A new entry for a movie YOU recommended to this person → distinct glow.
                const isRecFulfilled = isNew && myRecSentPairs.has(`${actorId}|${String(r?.movie_id || '').trim()}`);
                const highlightClass = isNew ? (isRecFulfilled ? ' is-new-rec' : ' is-new') : '';

                return `
                    <div class="glass-panel feed-item-card${highlightClass}" data-feed-card="1" style="padding: 0.9rem; border-radius: 1rem;">
                        <div class="feed-card-row">
                            <div class="feed-card-poster" data-feed-action="open_spotlight" data-feed-movie-id="${escapeHtml(movieIdStr)}" data-feed-movie-tmdb="${escapeHtml(movieTmdbStr)}" data-feed-movie-title="${escapeHtml(title)}" data-feed-movie-year="${escapeHtml(year)}" data-feed-movie-poster="${escapeHtml(poster_path)}" role="button" tabindex="0" title="View movie details" style="cursor:pointer;"${(Number.isFinite(tmdb_id) && tmdb_id > 0) ? ` onpointerdown="if(typeof prefetchMovieDetails==='function')prefetchMovieDetails(${tmdb_id})"` : ''}>
                                ${posterUrl
                                    ? `<img src="${posterUrl}" loading="lazy" decoding="async" alt="${escapeHtml(title)}" style="width:100%; height:100%; object-fit: cover; display:block;" onerror="this.style.display='none';">`
                                    : `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; color: var(--text-muted); font-size: 12px;">No poster</div>`}
                            </div>

                            <div class="feed-card-main">
                                <div class="text-white font-bold" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(title)}${year ? ` <span style="color: rgba(255,255,255,0.65); font-weight: 800;">(${escapeHtml(year)})</span>` : ''}</div>

                                ${(overall || tierLabel)
                                    ? `<div class="feed-metrics">${overall ? dashRenderHelpScore(overall) : ''}${tierLabel ? dashRenderHelpTier(tierLabel) : ''}</div>`
                                    : `<div class="text-xs text-gray" style="margin-top: 0.25rem;">No rating yet</div>`
                                }

                                ${watched ? `<div class="text-xs" style="margin-top: 0.25rem; color: rgba(255,255,255,0.55);">Watched: ${escapeHtml(watched)}</div>` : ''}
                            </div>

                            <div class="feed-card-actor" title="View ${escapeHtml(actorUsernameRaw || 'profile')}" data-feed-action="open_profile" data-feed-user-id="${escapeHtml(actorId)}" role="button" tabindex="0" style="cursor:pointer;">
                                ${/* Demo/guest mode: hide real profile photos — show the default avatar for everyone so no one's identity is exposed in the public demo. */ ''}
                                ${renderUserIconHtml(guestMode ? '' : actorIconId, 52)}
                                <span class="feed-card-actor-name">${(authedUserId && actorId === authedUserId) ? 'You' : escapeHtml(actorUsername)}</span>
                            </div>
                        </div>

                        <div class="feed-card-details">
                            ${subRatingRows.length
                                ? `<div class="library-chip-row" style="margin-top: 0.55rem;">
                                        ${subRatingRows.map(d => `<span class=\"dash-quote-pill\">${escapeHtml(d.k)}: ${escapeHtml(d.v)}</span>`).join('')}
                                   </div>`
                                : ''}

                            ${quote ? `
                                <div style="margin-top: 0.75rem;">
                                    <div class="text-xs text-gray" style="margin-bottom: 0.25rem;">Favorite Quote</div>
                                    <div class="text-white" style="line-height: 1.4;">${escapeHtml(quote)}</div>
                                </div>
                            ` : ''}

                            ${notes ? `
                                <div style="margin-top: 0.75rem;">
                                    <div class="text-xs text-gray" style="margin-bottom: 0.25rem;">Notes</div>
                                    <div class="text-white" style="line-height: 1.4; white-space: pre-wrap;">${escapeHtml(notes)}</div>
                                </div>
                            ` : ''}

                            ${(() => {
                                const ratingIdStr = String(r?.id || '').trim();
                                const isOwnReview = actorId === authedUserId;
                                // Everyone can SEE reactions (incl. on your own review), but you
                                // can't react to your OWN entry — so the count pills always show,
                                // while the 🙂 add button + picker are hidden on your own cards.
                                const showCounts = !!ratingIdStr;
                                const showReactAdd = !!ratingIdStr && !isOwnReview;
                                const showBucket = !!(movieIdStr && !isOwnReview);
                                if (!showCounts && !showBucket) return '';
                                const showActions = showBucket || showReactAdd;
                                return `
                                    ${showCounts ? `<div class="feed-react-counts" data-rating-id="${escapeHtml(ratingIdStr)}">${feedReactionCountsInner(ratingIdStr)}</div>` : ''}
                                    ${showActions ? `<div class="feed-card-actions">
                                        ${showBucket ? `<button type="button" class="feed-bucket-btn${inBucket ? ' is-added' : ''}" data-feed-action="add_bucket" data-feed-movie-id="${escapeHtml(movieIdStr)}" data-feed-movie-tmdb="${escapeHtml(movieTmdbStr)}" data-feed-movie-title="${escapeHtml(title)}" title="${inBucket ? 'In your Bucket List' : 'Add to Bucket List'}" aria-label="${inBucket ? `${escapeHtml(title)} is in your Bucket List` : `Add ${escapeHtml(title)} to Bucket List`}">
                                            <svg class="feed-bucket-star" viewBox="0 0 24 24" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg><span>Bucket List</span>
                                        </button>` : ''}
                                        ${showReactAdd ? feedReactAddBtnHtml(ratingIdStr) : ''}
                                    </div>` : ''}
                                    ${showReactAdd ? `<div class="feed-react-picker" data-rating-id="${escapeHtml(ratingIdStr)}" hidden>${feedReactionPickerInner(ratingIdStr)}</div>` : ''}
                                `;
                            })()}
                        </div>
                    </div>
                `;
            };

            // Group entries by movie: same movie → one container with member cards stacked
            // flush together. Group order follows the rows' order (most recently updated
            // review first for the normal feed; most-recent watch for in-common mode).
            const groupOrder = [];
            const groupsByMovie = new Map();
            for (const r of rows) {
                const mid = String(r?.movie_id || '').trim();
                if (!groupsByMovie.has(mid)) {
                    groupsByMovie.set(mid, []);
                    groupOrder.push(mid);
                }
                groupsByMovie.get(mid).push(r);
            }

            elList.innerHTML = groupOrder.map((mid) => {
                const entries = groupsByMovie.get(mid) || [];
                if (entries.length <= 1) return renderFeedCard(entries[0]);
                return `<div class="feed-group">${entries.map(renderFeedCard).join('')}</div>`;
            }).join('');

            // Self-healing pass: make sure every bucket-list movie's star is filled,
            // even if the seed populated late or a card got re-rendered.
            reconcileFeedBucketStars();

            // Warm the Movie Spotlight cache for the top (most-recent) 10 movies the
            // moment the feed renders, so tapping a poster opens the spotlight with no
            // spinner. Fire-and-forget; prefetchMovieDetails dedupes + caches.
            try {
                if (typeof prefetchMovieDetails === 'function') {
                    let warmed = 0;
                    for (const mid of groupOrder) {
                        if (warmed >= 10) break;
                        const movie = moviesById.get(mid) || null;
                        const tmdbId = Number(movie?.tmdb_id);
                        if (!Number.isFinite(tmdbId) || tmdbId <= 0) continue;
                        prefetchMovieDetails(tmdbId).catch(() => {});
                        warmed++;
                    }
                }
            } catch (_) {}

            // In-common mode: offer "Load More" if there may be more watch logs to scan.
            renderFeedInCommonLoadMore(elList);
            // Normal mode: infinite-scroll sentinel that auto-loads the next 100.
            renderFeedNormalLoadMore(elList);
        }

        // Appends an infinite-scroll sentinel for the NORMAL feed (a skeleton "loading
        // more" hold) when another page may exist, and observes it so scrolling near the
        // bottom auto-loads the next 100 newest reviews. Detaches when there's no more.
        function renderFeedNormalLoadMore(elList) {
            if (feedInCommonOnly) return;
            const el = elList || document.getElementById('feed-list');
            if (!el) return;
            if (!feedNormalHasMore) { detachInfiniteScroll(); return; }
            const sentinel = document.createElement('div');
            sentinel.id = 'feed-load-sentinel';
            sentinel.className = 'infinite-sentinel';
            sentinel.style.cssText = 'grid-column: 1 / -1;';
            sentinel.innerHTML = skeletonRows(2);
            el.appendChild(sentinel);
            attachInfiniteScroll(sentinel, () => { loadFeedItems({ appendNormal: true }); });
        }

        // Appends a "Load More" button (in-common mode only) when the last page came
        // back full, so the next 1000 watch logs can be scanned for more overlaps.
        function renderFeedInCommonLoadMore(elList) {
            if (!feedInCommonOnly || !feedInCommonHasMore) return;
            const el = elList || document.getElementById('feed-list');
            if (!el) return;
            const wrap = document.createElement('div');
            wrap.style.cssText = 'grid-column: 1 / -1; display:flex; justify-content:center; margin-top: 0.6rem;';
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-outline';
            btn.style.cssText = 'padding: 0.55rem 1.1rem; border-radius: 0.85rem;';
            btn.textContent = 'Load 1000 more';
            btn.onclick = () => {
                btn.disabled = true;
                btn.textContent = 'Loading…';
                loadFeedItems({ appendInCommon: true });
            };
            wrap.appendChild(btn);
            el.appendChild(wrap);
        }

        // Mobile: the "Follow People" panel becomes a full-screen overlay opened by
        // the "Follows" button (it's hidden inline on phones). Same DOM node + ids, so
        // search/following wiring keeps working. We move it to <body> while open so
        // position:fixed covers the whole viewport (the .fade-in page wrapper has a
        // lingering transform that would otherwise trap a fixed child to its box).
        let feedFollowsHome = null;
        function openFeedFollows() {
            const p = document.getElementById('feed-follows-panel');
            if (!p) return;
            if (p.parentNode !== document.body) {
                feedFollowsHome = { parent: p.parentNode, next: p.nextSibling };
                document.body.appendChild(p);
            }
            // Dimmed backdrop behind the bottom sheet — tap it to close (matches Filter).
            let bd = document.getElementById('feed-follows-backdrop');
            if (!bd) {
                bd = document.createElement('div');
                bd.id = 'feed-follows-backdrop';
                bd.className = 'feed-follows-backdrop';
                bd.addEventListener('click', closeFeedFollows);
                document.body.appendChild(bd);
            }
            bd.classList.add('open');
            p.classList.add('open');
        }
        function closeFeedFollows() {
            const p = document.getElementById('feed-follows-panel');
            const bd = document.getElementById('feed-follows-backdrop');
            if (bd) bd.classList.remove('open');
            if (!p) return;
            p.classList.remove('open');
            if (feedFollowsHome && feedFollowsHome.parent && feedFollowsHome.parent.isConnected) {
                feedFollowsHome.parent.insertBefore(p, feedFollowsHome.next);
            } else if (p.parentNode === document.body) {
                // Original spot is gone (navigated away) — drop the orphan; the next
                // feed render recreates the panel inside the grid.
                p.remove();
            }
            feedFollowsHome = null;
        }



