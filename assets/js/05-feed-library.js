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
        let feedFilterUsersCache = [];       // [{id, username, display_name, icon}] of people you follow (for the Filter modal)
        let feedFilterPrefsLoaded = false;

        let libraryBound = false;
        let libraryOffset = 0;
        const libraryLimit = 25;
        let libraryHasMore = true;
        let libraryLoading = false;
        let libraryViewMode = 'list';
        let libraryWatchCountMax = 0;
        let libraryPendingWatchCountMaxOnly = false;

        const LIBRARY_LATEST_WATCH_VIEW = 'user_movie_latest_watch';
        const LIBRARY_ITEMS_VIEW = 'user_library_items_v2';
        let libraryItems = [];
        let libraryFacetsLoaded = false;

        // (director filter is applied via modal Save)

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

            document.addEventListener('click', (e) => {
                const card = e?.target?.closest ? e.target.closest('[data-feed-card]') : null;
                if (!card) return;

                // Don't toggle when clicking buttons/controls.
                const actionEl = e?.target?.closest ? e.target.closest('[data-feed-action]') : null;
                if (actionEl) return;

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

                if (action === 'open_filter') {
                    await openFeedFilterModal();
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
                try {
                    if (guardGuestWrite()) return;
                    const { user } = await requireAuthOrThrow();
                    authedUser = user;
                } catch (err) {
                    showToast(String(err?.message || err), { level: 'warn' });
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

                if (cb.classList && cb.classList.contains('feed-filter-user-cb')) {
                    const uid = String(cb.dataset.feedUserId || '').trim();
                    if (!uid) return;
                    if (cb.checked) feedExcludedUserIds.delete(uid);
                    else feedExcludedUserIds.add(uid);
                    saveFeedFilterPrefs();
                }
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
                if (action === 'load_more') {
                    await loadLibraryMore({ replace: false });
                    return;
                }

                if (action === 'open_sort_filter') {
                    openLibrarySortFilterModal();
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
            const wrap = document.getElementById('library-view-toggle');
            if (!wrap) return;
            wrap.querySelectorAll('[data-library-view]').forEach((btn) => {
                const isOn = String(btn.dataset.libraryView || '').trim().toLowerCase() === libraryViewMode;
                btn.classList.remove('btn-glass', 'btn-outline');
                btn.classList.add(isOn ? 'btn-glass' : 'btn-outline');
                btn.setAttribute('aria-pressed', isOn ? 'true' : 'false');
            });
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
                directorContains: '',
                actorContains: '',
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
                director: document.getElementById('library-modal-filter-director'),
                actor: document.getElementById('library-modal-filter-actor'),
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
            els.sortDir.value = (String(state?.sortDir || 'desc') === 'asc') ? 'asc' : 'desc';
            if (els.tier) els.tier.value = String(state?.tier || '');
            if (els.decade) els.decade.value = String(state?.decade || '');
            if (els.director) els.director.value = String(state?.directorContains || '');
            if (els.actor) els.actor.value = String(state?.actorContains || '');
            if (els.mpa) els.mpa.value = String(state?.mpa || '');
            if (els.genre) els.genre.value = String(state?.genre || '');
            if (els.watchMethod) els.watchMethod.value = String(state?.watchMethod || '');
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
                sortDir: (getVal(els.sortDir) === 'asc') ? 'asc' : 'desc',
                tier: getVal(els.tier),
                decade: getVal(els.decade),
                directorContains: getVal(els.director),
                actorContains: getVal(els.actor),
                movieId: '',
                movieTitle: '',
                mpa: getVal(els.mpa),
                genre: getVal(els.genre),
                watchMethod: getVal(els.watchMethod),
                watchCountMin: useMin,
                watchCountMax: useMax,
                timeframe: getVal(els.timeframe) || 'all_time',
            };
        }

        function openLibrarySortFilterModal() {
            ensureLibrarySortFilterStateInitialized();
            const els = getLibrarySortFilterModalEls();
            if (!els.overlay) return;
            // snapshot current inputs as draft
            librarySortFilterDraft = { ...librarySortFilterState };
            loadLibraryFacets().catch(() => null);
            setLibrarySortFilterModalFromState(librarySortFilterState);
            initLibraryWatchCountRange();
            setLibraryWatchCountRangeFromState(librarySortFilterState);
            els.overlay.style.display = 'flex';
            setTimeout(() => {
                try { els.sortKey?.focus?.(); } catch (_) {}
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

        function renderLibraryList() {
            const elList = document.getElementById('library-list');
            const elMeta = document.getElementById('library-meta');
            const wrap = document.getElementById('library-load-more-wrap');
            if (!elList) return;

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
                    const overallGrid = dashFormatScore(it?.overall_rating);
                    const watchCountRaw = Number(it?.watch_count ?? 0);
                    const watchCount = Number.isFinite(watchCountRaw) ? watchCountRaw : 0;
                    const metaParts = [];
                    if (overallGrid) metaParts.push(dashRenderHelpScore(overallGrid));
                    if (tierLabel) metaParts.push(dashRenderHelpTier(tierLabel));
                    if (watchCount > 0) metaParts.push(`<span class="text-gray">${watchCount} Times</span>`);
                    return `
                        <div class="dash-kpi-movie-card">
                            <div class="dash-kpi-movie-poster">
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

                return `
                    <div class="glass-panel" style="padding: 0.9rem; border-radius: 1rem;">
                        <div class="library-card-row">
                            <div class="library-card-left">
                                <div class="library-card-poster">
                                    <div class="library-poster-flip">
                                        <div class="library-poster-flip-inner">
                                            <div class="library-poster-face library-poster-front">
                                                ${posterUrl
                                                    ? `<img src="${posterUrl}" loading="lazy" decoding="async" alt="${escapeHtml(title)}" style="width:100%; height:100%; object-fit: cover; display:block;" onerror="this.style.display='none';">`
                                                    : `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; color: var(--text-muted); font-size: 12px;">No poster</div>`}
                                            </div>
                                            <div class="library-poster-face library-poster-back">
                                                ${posterBackDetailsHtml || `<div class="text-xs text-gray" style="text-align:center;">No details</div>`}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div class="library-under">
                                    ${mostRecentLabel
                                        ? `<div class="text-xs text-gray tabular-nums" style="margin-top: 0.55rem;">Most Recent Watch: ${escapeHtml(mostRecentLabel)}</div>`
                                        : ''
                                    }
                                </div>
                            </div>

                            <div class="feed-card-main">
                                <div class="text-white font-bold" style="white-space: normal; overflow: hidden;">
                                    <span class="library-title-line">${escapeHtml(title)}${year ? ` <span style="color: rgba(255,255,255,0.65); font-weight: 800;">(${escapeHtml(year)})</span>` : ''}</span>
                                    ${(directorVal || mpaVal)
                                        ? `<span class="library-title-meta">${directorVal ? `<span class="library-title-sep"> — </span>${escapeHtml(directorVal)}` : ''}${mpaVal ? `<span class="library-title-sep"> — </span>${escapeHtml(mpaVal)}` : ''}</span>`
                                        : ''}
                                </div>

                                ${(overall || tierLabel)
                                    ? `<div class="feed-metrics">${ratingChips}</div>`
                                    : `<div class="text-xs text-gray" style="margin-top: 0.25rem;">No rating yet</div>`
                                }

                                ${movie_id ? `
                                    <div style="margin-top: 0.65rem; display:flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end;">
                                        <button
                                            type="button"
                                            class="btn btn-outline"
                                            data-library-action="edit_entry"
                                            data-movie-id="${escapeHtml(movie_id)}"
                                            data-movie-title="${escapeHtml(title)}"
                                            data-tmdb-id="${escapeHtml(String(it?.tmdb_id ?? ''))}"
                                            data-poster-path="${escapeHtml(poster_path)}"
                                            style="border-radius: 0.85rem; padding: 0.5rem 0.75rem; border-color: color-mix(in srgb, var(--brand-2) 60%, transparent); color: rgba(255,255,255,0.95); background: color-mix(in srgb, var(--brand-2) 22%, transparent);"
                                            title="Edit this movie's rating"
                                        >Edit</button>
                                        <button
                                            type="button"
                                            class="btn btn-outline"
                                            data-library-action="delete_entry"
                                            data-movie-id="${escapeHtml(movie_id)}"
                                            data-movie-title="${escapeHtml(title)}"
                                            style="border-radius: 0.85rem; padding: 0.5rem 0.75rem; border-color: rgba(239,68,68,0.55); color: rgba(239,68,68,0.95); background: rgba(239,68,68,0.10);"
                                            title="Delete rating and/or watch logs"
                                        >Delete</button>
                                        <button
                                            type="button"
                                            class="btn btn-outline"
                                            data-library-action="recommend"
                                            data-movie-id="${escapeHtml(movie_id)}"
                                            data-movie-title="${escapeHtml(title)}"
                                            style="border-radius: 0.85rem; padding: 0.5rem 0.75rem; border-color: color-mix(in srgb, var(--brand) 55%, transparent); color: rgba(255,255,255,0.95); background: color-mix(in srgb, var(--brand) 18%, transparent);"
                                            title="Recommend this movie to people you follow"
                                        >Recommend</button>
                                    </div>
                                ` : ''}

                                <div class="library-chip-row library-subratings" style="margin-top: 0.6rem;">
                                    ${subRatingRows.map(d => `<span class=\"dash-quote-pill\">${escapeHtml(d.k)}: ${escapeHtml(d.v)}</span>`).join('')}
                                </div>

                                ${String(extraMovieChips || '').trim()
                                    ? `<div class="library-chip-row" style="margin-top: 0.55rem;">${extraMovieChips}</div>`
                                    : ''
                                }

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

                const openBtn = document.getElementById('library-open-sortfilter');
                if (openBtn) {
                    openBtn.title = model?.summaryText || '';
                    if (model?.isDefault) {
                        openBtn.style.borderColor = '';
                        openBtn.style.background = '';
                    } else {
                        openBtn.style.borderColor = 'rgba(20, 184, 166, 0.65)';
                        openBtn.style.background = 'rgba(20, 184, 166, 0.12)';
                    }
                }
            }
            if (wrap) wrap.style.display = libraryHasMore ? 'flex' : 'none';
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

                decadeEl.innerHTML = `<option value="">Release Decade (All)</option>` +
                    sortedDecades.map(d => `<option value="${escapeHtml(String(d))}">${escapeHtml(String(d))}s</option>`).join('');
                mpaEl.innerHTML = `<option value="">MPA (All)</option>` +
                    sortedMpas.map(v => `<option value="${escapeHtml(String(v))}">${escapeHtml(String(v))}</option>`).join('');
                genreEl.innerHTML = `<option value="">Genre (All)</option>` +
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
                        <option value="all_time">Watch Date (All Time)</option>
                        <option value="this_year">Watch Date (This Year)</option>
                        <option value="this_month">Watch Date (This Month)</option>
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

        function formatPctForDisplay(pct) {
            const n = Number(pct);
            if (!Number.isFinite(n)) return '';
            const v = String(dashFormatScore(n) || '').trim();
            if (!v) return '';
            return /%\s*$/.test(v) ? v : `${v}%`;
        }

        function getAnyStringField(row, { preferKeys = [], avoidKeysRe = null } = {}) {
            if (!row || typeof row !== 'object') return '';
            const avoid = avoidKeysRe instanceof RegExp ? avoidKeysRe : null;
            for (const k of preferKeys) {
                const v = row?.[k];
                if (typeof v === 'string' && v.trim()) return v.trim();
            }
            for (const [k, v] of Object.entries(row)) {
                if (avoid && avoid.test(k)) continue;
                if (typeof v === 'string' && v.trim()) return v.trim();
            }
            return '';
        }

        function getMovieIdFromAnyRow(r) {
            if (!r || typeof r !== 'object') return '';
            const candidates = [
                r?.movie_id,
                r?.movieId,
                r?.movie_uuid,
                r?.movieUuid,
                r?.movie,
                r?.movieID,
            ];
            for (const c of candidates) {
                const s = String(c ?? '').trim();
                if (s) return s;
            }
            return '';
        }

        async function selectAllFromFirstAvailableTable(tableNames, idCandidates, ids) {
            const tables = Array.isArray(tableNames) ? tableNames : [];
            const cols = Array.isArray(idCandidates) ? idCandidates : [];
            let lastErr = null;

            for (const table of tables) {
                for (const col of cols) {
                    try {
                        const { data, error } = await supabaseClient
                            .from(table)
                            .select('*')
                            .in(col, ids);
                        if (error) throw error;
                        return data;
                    } catch (err) {
                        lastErr = err;
                        const msg = String(err?.message || err);
                        // Try next table/column on common schema mismatches.
                        if (/relation\s+"?.+"?\s+does\s+not\s+exist/i.test(msg)) continue;
                        if (/column\s+"?.+"?\s+does\s+not\s+exist/i.test(msg)) continue;
                        // Otherwise bubble up.
                        throw err;
                    }
                }
            }

            if (lastErr) throw lastErr;
            return null;
        }

        async function loadLibraryHydratedGenreDirectorImdb({ movieIds }) {
            const genresByMovieId = new Map();
            const directorByMovieId = new Map();
            const imdbPctByMovieId = new Map();
            const ids = Array.isArray(movieIds) ? movieIds : [];
            if (!supabaseClient || ids.length === 0) {
                return { genresByMovieId, directorByMovieId, imdbPctByMovieId };
            }

            // Genres
            try {
                const genreRows = await selectAllFromFirstAvailableTable(
                    ['Movies Genres', 'Movie Genres', 'Movies_Genres', 'movie_genres', 'movies_genres'],
                    ['movie_id', 'movieId', 'movie_uuid', 'movieUuid'],
                    ids
                );
                const rows = Array.isArray(genreRows) ? genreRows : [];
                for (const r of rows) {
                    const mid = getMovieIdFromAnyRow(r);
                    if (!mid) continue;
                    const g = getAnyStringField(r, {
                        preferKeys: ['genre', 'genre_name', 'name', 'genreName', 'genre_title', 'title'],
                        avoidKeysRe: /(id|uuid|created|updated|tmdb|imdb)/i,
                    });
                    if (!g) continue;
                    const arr = genresByMovieId.get(mid) || [];
                    if (!arr.includes(g)) arr.push(g);
                    genresByMovieId.set(mid, arr);
                }
            } catch (_) {}

            // Directors (from crew)
            try {
                const crewRows = await selectAllFromFirstAvailableTable(
                    ['Movie Crew', 'Movie Crew Table', 'Movies Crew', 'movie_crew', 'movies_crew'],
                    ['movie_id', 'movieId', 'movie_uuid', 'movieUuid'],
                    ids
                );
                const rows = Array.isArray(crewRows) ? crewRows : [];
                for (const r of rows) {
                    const mid = getMovieIdFromAnyRow(r);
                    if (!mid || directorByMovieId.has(mid)) continue;
                    const job = String(r?.job ?? r?.role ?? r?.credit_job ?? r?.job_name ?? r?.job_title ?? r?.position ?? '').trim();
                    const dept = String(r?.department ?? r?.dept ?? r?.known_for_department ?? '').trim();
                    const isDirector = (r?.is_director === true) || /director/i.test(job) || (/directing/i.test(dept) && (!job || /director/i.test(job)));
                    if (!isDirector) continue;
                    const name = getAnyStringField(r, {
                        preferKeys: ['name', 'person_name', 'crew_name', 'full_name', 'display_name', 'person'],
                        avoidKeysRe: /(movie|job|role|department|dept|id|uuid|created|updated)/i,
                    });
                    if (!name) continue;
                    directorByMovieId.set(mid, name);
                }
            } catch (_) {}

            // IMDb (external ratings)
            try {
                const extRows = await selectAllFromFirstAvailableTable(
                    ['Movie External Ratings', 'Movies External Ratings', 'movie_external_ratings', 'movies_external_ratings'],
                    ['movie_id', 'movieId', 'movie_uuid', 'movieUuid'],
                    ids
                );
                const rows = Array.isArray(extRows) ? extRows : [];
                for (const r of rows) {
                    const mid = getMovieIdFromAnyRow(r);
                    if (!mid) continue;

                    // Common schema: a single row per movie with imdb_rating_pct
                    const directPct = parsePercentLike(r?.imdb_rating_pct ?? r?.imdbPct ?? r?.imdb_rating ?? r?.imdb, { imdb: true });
                    if (directPct !== null && directPct !== undefined) {
                        imdbPctByMovieId.set(mid, directPct);
                        continue;
                    }

                    // Multi-source schema: provider/source + rating
                    const provider = String(r?.provider ?? r?.source ?? r?.site ?? r?.rating_source ?? r?.type ?? '').trim().toLowerCase();
                    if (provider && !provider.includes('imdb')) continue;
                    const pct = parsePercentLike(r?.rating_pct ?? r?.ratingPercent ?? r?.percent ?? r?.score_pct ?? r?.scorePercent ?? r?.score ?? r?.rating, { imdb: true });
                    if (pct !== null && pct !== undefined) {
                        imdbPctByMovieId.set(mid, pct);
                    }
                }
            } catch (_) {}

            return { genresByMovieId, directorByMovieId, imdbPctByMovieId };
        }

        async function loadLibraryTmdbFallbackForMovies({ movieIds, moviesById, genresByMovieId, directorByMovieId }) {
            if (!Array.isArray(movieIds) || movieIds.length === 0) return;

            // Build a list of tmdb_ids we still need details for.
            const needs = [];
            for (const id of movieIds) {
                const m = moviesById.get(id) || null;
                const mid = String(m?.id || id || '').trim();
                if (!mid) continue;

                const hasGenre = (() => {
                    const arr = genresByMovieId.get(mid);
                    if (Array.isArray(arr) && arr.length) return true;
                    if (Array.isArray(m?.genres) && m.genres.length) return true;
                    return Boolean(String(m?.genre ?? '').trim());
                })();
                const hasDirector = (() => {
                    if (directorByMovieId.has(mid)) return true;
                    return Boolean(String(m?.director ?? m?.director_name ?? '').trim());
                })();

                if (hasGenre && hasDirector) continue;
                const tmdb = Number(m?.tmdb_id);
                if (!Number.isFinite(tmdb) || tmdb <= 0) continue;
                needs.push({ mid, tmdb, needGenre: !hasGenre, needDirector: !hasDirector });
            }

            if (needs.length === 0) return;

            // De-dupe by tmdb_id (1:1 in your schema, but safe).
            const byTmdb = new Map();
            for (const n of needs) {
                const prev = byTmdb.get(n.tmdb) || { tmdb: n.tmdb, movieIds: [], needGenre: false, needDirector: false };
                prev.movieIds.push(n.mid);
                prev.needGenre = prev.needGenre || n.needGenre;
                prev.needDirector = prev.needDirector || n.needDirector;
                byTmdb.set(n.tmdb, prev);
            }

            const items = Array.from(byTmdb.values());
            const concurrency = 4;
            for (let i = 0; i < items.length; i += concurrency) {
                const chunk = items.slice(i, i + concurrency);
                await Promise.allSettled(chunk.map(async (it) => {
                    try {
                        const details = await callSwiftApiGetMovieDetails({ tmdb_id: it.tmdb });
                        const genres = Array.isArray(details?.genres)
                            ? details.genres.map(s => String(s).trim()).filter(Boolean)
                            : (String(details?.genre || '').trim() ? [String(details.genre).trim()] : []);
                        const director = String(details?.director || '').trim();

                        for (const mid of it.movieIds) {
                            if (it.needGenre && genres.length) {
                                genresByMovieId.set(mid, genres);
                            }
                            if (it.needDirector && director) {
                                directorByMovieId.set(mid, director);
                            }
                        }
                    } catch (_) {
                        // ignore
                    }
                }));
            }
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
                elList.innerHTML = `<div class="text-gray">Loading…</div>`;
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

            const directorNeedle = String(state?.directorContains || '').trim();
            if (directorNeedle) {
                q = q.ilike('director', `%${directorNeedle}%`);
            }

            const actorNeedle = String(state?.actorContains || '').trim();
            if (actorNeedle) {
                q = q.ilike('actors', `%${actorNeedle}%`);
            }

            const movieId = String(state?.movieId || '').trim();
            if (movieId) {
                q = q.eq('movie_id', movieId);
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
                let q = libraryBuildServerQuery({ userId: authedUser.id, offset: start, limit: limitPlusOne });
                let { data, error } = await q;

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
                        const directorNeedle = String(state?.directorContains || '').trim();
                        if (directorNeedle) q = q.ilike('director', `%${directorNeedle}%`);
                        const actorNeedle = String(state?.actorContains || '').trim();
                        if (actorNeedle) q = q.ilike('actors', `%${actorNeedle}%`);

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

        async function loadMyFollowingIds() {
            feedFollowingIds = new Set();
            if (!supabaseClient) return;
            let authedUser = null;
            if (guestMode) {
                authedUser = cachedAuthUser;
            } else {
                try {
                    const { data } = await supabaseClient.auth.getUser();
                    authedUser = data?.user || null;
                } catch (_) {
                    authedUser = null;
                }
            }
            if (!authedUser?.id) return;

            const { data, error } = await supabaseClient
                .from('Follows')
                .select('followed_id')
                .eq('follower_id', authedUser.id);
            if (error) throw error;
            const rows = Array.isArray(data) ? data : [];
            for (const r of rows) {
                const id = String(r?.followed_id || '').trim();
                if (id) feedFollowingIds.add(id);
            }
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
            // this view glow once, then read as normal next time.
            try { feedHighlightSince = getNotifLastSeen(FEED_LAST_SEEN_KEY); } catch (_) { feedHighlightSince = ''; }

            try {
                await loadMyFollowingIds();
                await loadFeedFollowingList();
                await loadFeedItems();
                markFeedSeen(); // viewing the feed clears its unread badge
            } catch (err) {
                showToast(`Feed failed: ${String(err?.message || err)}`, { level: 'warn' });
            }
        }

        let feedHighlightSince = ''; // items with updated_at newer than this glow as "new" for one view

        // ===== Nav notification badges (Feed = new follow activity, Lists = new recs) =====
        const FEED_LAST_SEEN_KEY = 'ct_feed_last_seen';
        const RECS_LAST_SEEN_KEY = 'ct_recs_last_seen';

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

        function setNavBadge(elId, count) {
            const el = document.getElementById(elId);
            if (!el) return;
            const n = Number(count) || 0;
            if (n > 0) {
                el.textContent = n > 99 ? '99+' : String(n);
                el.classList.add('show');
            } else {
                el.textContent = '';
                el.classList.remove('show');
            }
        }

        async function refreshNavBadges() {
            try {
                if (!supabaseClient || !cachedIsAuthed) {
                    setNavBadge('nav-badge-feed', 0);
                    setNavBadge('nav-badge-lists', 0);
                    return;
                }
                const meId = String(cachedAuthUser?.id || '').trim();
                if (!meId) return;

                // Lists badge: recommendations sent to me since last seen.
                try {
                    const since = getNotifLastSeen(RECS_LAST_SEEN_KEY);
                    const { count } = await supabaseClient
                        .from('Recommendations')
                        .select('id', { count: 'exact', head: true })
                        .eq('to_user_id', meId)
                        .gt('created_at', since);
                    setNavBadge('nav-badge-lists', count || 0);
                } catch (_) { /* Recommendations table may not exist pre-migration */ }

                // Feed badge: ratings from people I follow (excluding me) since last seen.
                try {
                    await loadMyFollowingIds();
                    const followed = Array.from(feedFollowingIds).filter(id => id && id !== meId);
                    if (followed.length) {
                        const since = getNotifLastSeen(FEED_LAST_SEEN_KEY);
                        const { count } = await supabaseClient
                            .from('Movie Ratings')
                            .select('id', { count: 'exact', head: true })
                            .in('user_id', followed)
                            .gt('updated_at', since);
                        setNavBadge('nav-badge-feed', count || 0);
                    } else {
                        setNavBadge('nav-badge-feed', 0);
                    }
                } catch (_) {}
            } catch (_) {}
        }

        function markFeedSeen() {
            try { localStorage.setItem(FEED_LAST_SEEN_KEY, new Date().toISOString()); } catch (_) {}
            setNavBadge('nav-badge-feed', 0);
        }

        function markRecsSeen() {
            try { localStorage.setItem(RECS_LAST_SEEN_KEY, new Date().toISOString()); } catch (_) {}
            setNavBadge('nav-badge-lists', 0);
        }

        // ===== Public profile overview (opened by clicking a user in the Feed) =====
        // Computes the user's KPIs client-side and reuses the Data Dash card markup +
        // helpers so the posters/ratings/tiers look IDENTICAL to the dashboard.
        let profileMode = 'recent'; // 'recent' | 'top'
        let profileTop5 = [];
        let profileRecent5 = [];

        async function openUserProfile(userId) {
            const uid = String(userId || '').trim();
            if (!uid) return;
            if (!supabaseClient || !cachedIsAuthed) { openAuthModal(); return; }

            const overlay = document.getElementById('profile-overlay');
            const body = document.getElementById('profile-body');
            const titleEl = document.getElementById('profile-title');
            if (!overlay || !body) return;
            overlay.style.display = 'flex';
            overlay.classList.add('open');
            if (titleEl) titleEl.textContent = 'Profile';
            body.innerHTML = `<div class="text-gray" style="padding:1rem;">Loading…</div>`;
            profileMode = 'recent';
            profileTop5 = [];
            profileRecent5 = [];

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
                    .select('movie_id, overall_rating, tier, watch_date')
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
                        .from('Movies').select('id, title, release_year, tmdb_id, poster_path').in('id', movieIds);
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
                        tier: String(rr?.tier || '').trim(),
                    };
                };

                // Top 5 by overall rating.
                profileTop5 = ratings
                    .filter(r => Number.isFinite(Number(r?.overall_rating)))
                    .sort((a, b) => Number(b.overall_rating) - Number(a.overall_rating))
                    .slice(0, 5)
                    .map(r => toItem(r.movie_id));

                // 5 most recently watched (latest Watch Log date), matching My Movies order.
                profileRecent5 = Array.from(latestByMovie.entries())
                    .sort((a, b) => b[1].localeCompare(a[1]))
                    .slice(0, 5)
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

                if (titleEl) titleEl.textContent = displayName;
                body.innerHTML = renderProfileBody({ iconId, displayName, username, uniqueCount, avgOverall, highestDirector, highestDirectorAvg });
                renderProfileGrid();
            } catch (err) {
                body.innerHTML = `<div class="text-gray" style="padding:1rem;">Could not load profile: ${escapeHtml(String(err?.message || err))}</div>`;
            }
        }

        function renderProfileBody({ iconId, displayName, username, uniqueCount, avgOverall, highestDirector, highestDirectorAvg }) {
            const avgText = (avgOverall === null) ? '—' : dashFormatScore(avgOverall);
            const dirText = highestDirector
                ? `${escapeHtml(highestDirector)}${highestDirectorAvg !== null ? ` (${dashFormatScore(highestDirectorAvg)})` : ''}`
                : '—';
            return `
                <div class="profile-head">
                    ${renderUserIconHtml(iconId, 64)}
                    <div style="min-width:0;">
                        <div class="profile-name">${escapeHtml(displayName)}</div>
                        ${username ? `<div class="text-xs text-gray">@${escapeHtml(username)}</div>` : ''}
                    </div>
                </div>
                <div class="profile-kpis">
                    <div class="profile-kpi"><div class="profile-kpi-value tabular-nums">${uniqueCount}</div><div class="profile-kpi-label">Movies Watched</div></div>
                    <div class="profile-kpi"><div class="profile-kpi-value tabular-nums">${avgText}</div><div class="profile-kpi-label">Avg Overall</div></div>
                    <div class="profile-kpi"><div class="profile-kpi-value" style="font-size:0.95rem;">${dirText}</div><div class="profile-kpi-label">Highest-Rated Director</div></div>
                </div>
                <div class="profile-toggle">
                    <button type="button" class="nav-link profile-toggle-btn" data-profile-mode="recent" onclick="setProfileMode('recent')">Recent</button>
                    <button type="button" class="nav-link profile-toggle-btn" data-profile-mode="top" onclick="setProfileMode('top')">Top Rated</button>
                </div>
                <div id="profile-grid"></div>
            `;
        }

        function renderProfileMovieCard(it) {
            const title = String(it?.title || '').trim() || 'Untitled';
            const year = (it?.release_year === null || it?.release_year === undefined) ? '' : String(it.release_year);
            const tmdb_id = Number(it?.tmdb_id);
            const poster_path = dashNormalizePosterPath(String(it?.poster_path || '').trim() || (Number.isFinite(tmdb_id) ? (dashPosterCacheByTmdbId.get(tmdb_id) || '') : ''));
            const posterUrl = dashBuildPosterUrl(poster_path, 'w342');
            const metricText = dashFormatScore(it?.overall_rating);
            const tierLabel = dashNormalizeTierLabel(it?.tier);
            const metaHtml = dashJoinHelpParts([
                year ? escapeHtml(year) : '',
                metricText ? `${dashRenderHelpScore(metricText)} Overall` : '',
                tierLabel ? dashRenderHelpTier(tierLabel) : '',
            ]);
            return `
                <div style="display:flex; flex-direction: column; gap: 8px;">
                    <div style="width: 100%; aspect-ratio: 2/3; border-radius: 14px; overflow: hidden; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.06);">
                        ${posterUrl
                            ? `<img src="${posterUrl}" loading="lazy" decoding="async" alt="${escapeHtml(title)}" style="width: 100%; height: 100%; object-fit: cover; display:block;">`
                            : `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; color: var(--text-muted); font-size: 12px;">No poster</div>`
                        }
                    </div>
                    <div class="text-sm text-white" style="font-weight: 700; line-height: 1.2;">${escapeHtml(title)}</div>
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
            const items = profileMode === 'top' ? profileTop5 : profileRecent5;
            grid.innerHTML = items.length
                ? `<div class="dash-fav-grid">${items.map(renderProfileMovieCard).join('')}</div>`
                : `<div class="text-gray" style="padding:0.5rem;">No rated movies yet.</div>`;
        }

        function setProfileMode(mode) {
            profileMode = (mode === 'top') ? 'top' : 'recent';
            renderProfileGrid();
        }

        function closeUserProfile() {
            const overlay = document.getElementById('profile-overlay');
            if (overlay) { overlay.style.display = 'none'; overlay.classList.remove('open'); }
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
            btn.textContent = active ? 'Filter •' : 'Filter';
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

            list.innerHTML = filtered.map((u) => {
                const id = String(u?.id || '').trim();
                const username = String(u?.username || '').trim();
                const name = String(u?.display_name || '').trim() || (username ? `@${username}` : 'User');
                const iconId = String(u?.icon || '').trim();
                const checked = !feedExcludedUserIds.has(id);
                return `
                    <label class="feed-filter-user-row">
                        <input type="checkbox" class="feed-filter-cb feed-filter-user-cb" data-feed-user-id="${escapeHtml(id)}" ${checked ? 'checked' : ''}>
                        ${renderUserIconHtml(iconId, 26)}
                        <div style="min-width:0;">
                            <div class="feed-filter-user-name" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(name)}</div>
                            ${username ? `<div class="text-xs text-gray">@${escapeHtml(username)}</div>` : ''}
                        </div>
                    </label>
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
            // appendInCommon=true → "Load More" pressed: fetch the next in-common page
            // and re-render WITHOUT resetting the accumulated rows or the scroll-jarring
            // "Loading…" placeholder.
            const appendInCommon = opts.appendInCommon === true;
            const elList = document.getElementById('feed-list');
            const elMeta = document.getElementById('feed-meta');
            if (!elList) return;

            // Hide the "Jump to New" pill during (re)loads; it's re-shown after render.
            document.getElementById('feed-jump-new-btn')?.classList.remove('show');

            if (!supabaseClient || !cachedIsAuthed) {
                elList.innerHTML = `<div class="text-gray">Log in to view your feed.</div>`;
                if (elMeta) elMeta.textContent = '';
                return;
            }

            // Logged-in user's id — needed for "Compare Own" and to mark your own cards.
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

            loadFeedFilterPrefs();
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

            if (!appendInCommon) {
                elList.innerHTML = `<div class="text-gray">Loading…</div>`;
                if (elMeta) elMeta.textContent = '';
            }

            const ratingCols = 'user_id, movie_id, overall_rating, tier, watch_date, updated_at, fav_quote, notes, sound_rating, pacing_rating, imagery_rating, acting_rating, plot_rating, dialogue_rating';

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
                const { data: watches, error: wErr } = await supabaseClient
                    .from('Watch Logs')
                    .select('user_id, movie_id, watch_date')
                    .in('user_id', queryUserIds)
                    .order('watch_date', { ascending: false })
                    .limit(60);
                if (wErr) throw wErr;
                wrows = Array.isArray(watches) ? watches : [];
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
                return;
            }

            const movieIds = Array.from(new Set(rows.map(r => r?.movie_id).filter(Boolean)));
            const userIds = Array.from(new Set(rows.map(r => r?.user_id).filter(Boolean)));

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

            // Posters are lazy-loaded from stored DB poster_path; no TMDb calls.

            if (elMeta) {
                const modeLabel = feedCompareOwn ? 'You + selected follows' : 'Selected follows';
                elMeta.textContent = `${rows.length} item${rows.length === 1 ? '' : 's'} • ${modeLabel} • Most recent watches first`;
            }

            const renderFeedCard = (r) => {
                const actorId = String(r?.user_id || '').trim();
                const actor = usersById.get(actorId) || null;
                const actorUsernameRaw = String(actor?.username || '').trim().replace(/^@+/, '');
                const actorUsername = actorUsernameRaw ? `@${actorUsernameRaw}` : 'User';
                const actorIconId = String(actor?.icon || '').trim();

                const movie = moviesById.get(r?.movie_id) || null;
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

                // Highlight only OTHER people's new/updated entries — never your own.
                const isNew = feedHighlightSince
                    && actorId !== authedUserId
                    && String(r?.updated_at || '') > feedHighlightSince;

                return `
                    <div class="glass-panel feed-item-card${isNew ? ' is-new' : ''}" data-feed-card="1" style="padding: 0.9rem; border-radius: 1rem;">
                        <div class="feed-card-row">
                            <div class="feed-card-poster">
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
                                ${renderUserIconHtml(actorIconId, 52)}
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
                        </div>
                    </div>
                `;
            };

            // Group entries by movie: same movie → one container with member cards stacked
            // flush together. Group order follows most-recent watch (rows already sorted desc).
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

            // In-common mode: offer "Load More" if there may be more watch logs to scan.
            renderFeedInCommonLoadMore(elList);

            // Surface the floating "Jump to New" pill when there are highlighted entries.
            updateFeedJumpNewButton();
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

        // Show/hide + label the floating "Jump to New" button based on how many
        // highlighted (new/updated, non-own) feed cards are currently rendered.
        function updateFeedJumpNewButton() {
            const btn = document.getElementById('feed-jump-new-btn');
            if (!btn) return;
            const list = document.getElementById('feed-list');
            const newCount = list ? list.querySelectorAll('.feed-item-card.is-new').length : 0;
            if (newCount > 0) {
                const label = btn.querySelector('span');
                if (label) label.textContent = `↓ Jump to New (${newCount})`;
                btn.classList.add('show');
            } else {
                btn.classList.remove('show');
            }
        }

        // Scroll the first new/updated feed card into view.
        function jumpToNewFeed() {
            const list = document.getElementById('feed-list');
            if (!list) return;
            const first = list.querySelector('.feed-item-card.is-new');
            if (!first) return;
            try { first.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
            catch (_) { first.scrollIntoView(); }
        }


