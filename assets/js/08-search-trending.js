        async function callSwiftApiSearchMovies({ query, page = 1, signal }) {
            try {
                const year = homeSearchAppliedYear;
                const mpa = homeSearchAppliedMpa;
                return await callSwiftApiPublic({ action: 'search', query, page, year, mpa, limit: 8 }, { signal });
            } catch (err) {
                throw new Error(`Search failed: ${String(err?.message || err)}`);
            }
        }

        async function callSwiftApiSearchMoviesForLists({ query, page = 1, signal }) {
            try {
                // Uses the add-movie modal's own Year/MPA filter state (mirrors Home search).
                const year = (typeof listsAddAppliedYear !== 'undefined') ? listsAddAppliedYear : '';
                const mpa = (typeof listsAddAppliedMpa !== 'undefined') ? listsAddAppliedMpa : '';
                return await callSwiftApiPublic({ action: 'search', query, page, year, mpa, limit: 8 }, { signal });
            } catch (err) {
                throw new Error(`Search failed: ${String(err?.message || err)}`);
            }
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

        function renderHomeSearchResults(items) {
            const results = document.getElementById('search-results');
            if (!results) return;

            // Keep the dropdown lightweight.
            homeSearchItems = Array.isArray(items) ? items.slice(0, 4) : [];

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

            listsSearchItems = Array.isArray(items) ? items.slice(0, 6) : [];
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

            // Keep it lightweight; wait until the user types at least 3 characters.
            if (q.length < 3) {
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

