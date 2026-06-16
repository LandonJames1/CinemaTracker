        function setHomeActionsVisible(isVisible) {
            const actions = document.getElementById('movie-actions');
            if (!actions) return;
            const placeholder = document.getElementById('home-action-placeholder');
            if (placeholder) {
                placeholder.style.display = isVisible ? 'none' : 'block';
            }
            if (isVisible) {
                actions.classList.remove('hidden');
                actions.classList.add('flex');
            } else {
                actions.classList.add('hidden');
                actions.classList.remove('flex');
            }
        }

        function setUpdateOptionsHidden() {
            const updateBtn = document.getElementById('update-existing-btn');
            const updateOpts = document.getElementById('update-options');
            if (updateOpts) {
                updateOpts.classList.add('hidden');
                updateOpts.classList.remove('grid');
            }
            if (updateBtn) {
                updateBtn.disabled = true;
                updateBtn.style.opacity = '0.5';
                updateBtn.style.pointerEvents = 'none';
            }
        }

        function setHomeSearchLoading() {
            const results = document.getElementById('search-results');
            if (!results) return;
            results.innerHTML = `
                <div class="search-item text-gray justify-center" style="gap:0.5rem;">
                    <span class="icon-sm">${icons.loader}</span>
                    Searching…
                </div>
            `;
            results.classList.remove('hidden');
        }

        function clearHomeSearchUI() {
            const results = document.getElementById('search-results');
            if (results) results.classList.add('hidden');
            setHomeActionsVisible(false);
            setUpdateOptionsHidden();
            router.selectedMovie = null;
            router.pendingTitle = '';
            homeSearchItems = [];
        }

        function escapeHtml(s) {
            return String(s ?? '')
                .replaceAll('&', '&amp;')
                .replaceAll('<', '&lt;')
                .replaceAll('>', '&gt;')
                .replaceAll('"', '&quot;')
                .replaceAll("'", '&#39;');
        }

        let homeSearchAppliedYear = '';
        let homeSearchAppliedMpa = '';
        let homeSearchFiltersDirty = false;

        function resetHomeSearchAndFilters() {
            // Clear applied filter state (so nothing is accidentally carried over).
            homeSearchAppliedYear = '';
            homeSearchAppliedMpa = '';
            homeSearchFiltersDirty = false;

            const input = document.getElementById('movie-search-input');
            if (input) input.value = '';

            const yearEl = document.getElementById('movie-search-year');
            const mpaEl = document.getElementById('movie-search-mpa');
            if (yearEl) yearEl.value = '';
            if (mpaEl) mpaEl.value = '';

            const panel = document.getElementById('movie-search-filters');
            if (panel) panel.classList.add('hidden');

            const btn = document.getElementById('movie-search-filters-toggle');
            if (btn) btn.textContent = 'Use Filters';

            // Clear any results/actions from prior home interactions.
            try { clearHomeSearchUI(); } catch (_) {}
        }

        function toggleSearchFiltersPanel() {
            const panel = document.getElementById('movie-search-filters');
            if (!panel) return;
            const btn = document.getElementById('movie-search-filters-toggle');
            const isHidden = panel.classList.contains('hidden');
            if (isHidden) {
                panel.classList.remove('hidden');
                if (btn) btn.textContent = 'Hide Filters';
            } else {
                panel.classList.add('hidden');
                if (btn) btn.textContent = 'Use Filters';
            }
        }

        function markSearchFiltersDirty() {
            homeSearchFiltersDirty = true;
        }

        function applySearchFilters() {
            const yearEl = document.getElementById('movie-search-year');
            const mpaEl = document.getElementById('movie-search-mpa');
            const yearRaw = yearEl ? String(yearEl.value || '').trim() : '';
            const year = yearRaw && /^\d{4}$/.test(yearRaw) ? yearRaw : '';
            const mpa = mpaEl ? String(mpaEl.value || '').trim() : '';

            homeSearchAppliedYear = year;
            homeSearchAppliedMpa = mpa;
            homeSearchFiltersDirty = false;

            const input = document.getElementById('movie-search-input');
            const q = String(input?.value || '').trim();
            if (q.length < 3) {
                showToast('Type at least 3 characters, then apply filters.', { level: 'warn' });
                return;
            }
            handleSearch(q, { force: true });
        }

        function clearSearchFilters() {
            const yearEl = document.getElementById('movie-search-year');
            const mpaEl = document.getElementById('movie-search-mpa');
            if (yearEl) yearEl.value = '';
            if (mpaEl) mpaEl.value = '';
            homeSearchAppliedYear = '';
            homeSearchAppliedMpa = '';
            homeSearchFiltersDirty = false;
            const input = document.getElementById('movie-search-input');
            const q = String(input?.value || '').trim();
            if (!q) {
                clearHomeSearchUI();
                return;
            }
            handleSearch(q, { force: true });
        }

        let duplicateRatingContext = null;

        function openDuplicateRatingModal({ movie_id, tmdb_id, title } = {}) {
            duplicateRatingContext = {
                movie_id: movie_id || null,
                tmdb_id: tmdb_id || null,
                title: String(title || '').trim(),
            };

            const overlay = document.getElementById('duplicate-rating-overlay');
            const label = document.getElementById('duplicate-rating-movie');
            if (label) label.textContent = duplicateRatingContext.title || 'this movie';
            if (!overlay) return;
            overlay.style.display = 'flex';
            overlay.classList.add('open');
        }

        function closeDuplicateRatingModal() {
            const overlay = document.getElementById('duplicate-rating-overlay');
            if (overlay) {
                overlay.classList.remove('open');
                overlay.style.display = 'none';
            }
            duplicateRatingContext = null;
        }

        async function proceedDuplicateUpdateRatings() {
            const ctx = duplicateRatingContext;
            closeDuplicateRatingModal();

            const movieId = String(ctx?.movie_id || '').trim();
            if (!isUuidLike(movieId)) {
                showToast('Could not determine this movie record. Please search and select it again.', { level: 'warn' });
                router.navigate('home');
                return;
            }

            // Reuse the same update flow as the Home dropdown "Update Ratings" entry point
            // so we get the same prefill + locks.
            router.selectedMovie = {
                id: movieId,
                tmdb_id: Number.isFinite(Number(ctx?.tmdb_id)) ? Number(ctx.tmdb_id) : undefined,
                title: String(ctx?.title || '').trim(),
                detailsReadonly: true,
            };
            router.pendingTitle = router.selectedMovie.title || '';

            try {
                await router.startUpdateRatings();
            } catch (err) {
                showToast(`Update Ratings failed: ${String(err?.message || err)}`, { level: 'warn' });
            }
        }

        function proceedDuplicateReturnHome() {
            closeDuplicateRatingModal();
            router.navigate('home');
        }

        function handleSearch(query, opts = {}) {
            const results = document.getElementById('search-results');

            const q = String(query || '').trim();
            if (!results || !q || q.length < 1) {
                if (homeSearchDebounceTimer) clearTimeout(homeSearchDebounceTimer);
                if (homeSearchAbortController) homeSearchAbortController.abort();
                clearHomeSearchUI();
                return;
            }

            router.selectedMovie = null;
            router.pendingTitle = q;
            setHomeActionsVisible(false);
            setUpdateOptionsHidden();

            // Debounce + cancel in-flight request
            if (homeSearchDebounceTimer) clearTimeout(homeSearchDebounceTimer);
            if (homeSearchAbortController) homeSearchAbortController.abort();
            homeSearchAbortController = new AbortController();

            // Keep dropdown behavior similar: show results panel quickly, but avoid hammering the server.
            // Do not search until the user types at least 3 characters.
            if (q.length < 3) {
                results.classList.add('hidden');
                homeSearchItems = [];
                return;
            }

            const debounceMs = opts?.force ? 0 : 320;
            homeSearchDebounceTimer = setTimeout(async () => {
                try {
                    setHomeSearchLoading();

                    const data = await callSwiftApiSearchMovies({
                        query: q,
                        page: 1,
                        signal: homeSearchAbortController.signal,
                    });

                    const items = Array.isArray(data?.results) ? data.results : [];
                    renderHomeSearchResults(items);

                    // If nothing found, do not allow manual entry.
                    if (!items || items.length === 0) {
                        setHomeActionsVisible(false);
                        setUpdateOptionsHidden();
                    }
                } catch (err) {
                    // Ignore aborts
                    if (String(err?.name || '').toLowerCase() === 'aborterror') return;
                    if (String(err?.message || '').toLowerCase().includes('aborted')) return;

                    showToast(`Search failed: ${String(err?.message || err)}`, { level: 'warn' });
                    results.innerHTML = `<div class="search-item text-gray justify-center">Search unavailable — please try again</div>`;
                    results.classList.remove('hidden');
                    setHomeActionsVisible(false);
                    setUpdateOptionsHidden();
                }
            }, debounceMs);
        }

        function toggleMobileMenu() {
            const menu = document.getElementById('mobile-menu');
            menu.classList.toggle('open');
        }

        // Mobile bottom tab bar — the "More" bottom sheet (secondary routes).
        function openMoreSheet() {
            try { if (navigator.vibrate) navigator.vibrate(8); } catch (_) {}
            const overlay = document.getElementById('more-sheet-overlay');
            if (!overlay) return;
            overlay.classList.add('open');
        }
        function closeMoreSheet() {
            const overlay = document.getElementById('more-sheet-overlay');
            if (!overlay) return;
            overlay.classList.remove('open');
        }

        // True only at phone widths — the native-feel touches below are mobile-only.
        function isMobileViewport() {
            try { return window.matchMedia('(max-width: 768px)').matches; } catch (_) { return false; }
        }

        // Phase 2 — play a quick "page enter" animation on the app root whenever the
        // route's content is swapped in. Mobile-only + respects reduced-motion. The
        // class is removed on animationend so no transform lingers to trap fixed
        // descendants (modals/overlays). Called from router.navigate before the swap.
        function animatePageEnter(root) {
            try {
                if (!root || !isMobileViewport()) return;
                if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
                root.classList.remove('page-enter');
                void root.offsetWidth; // force reflow so the animation restarts each nav
                root.classList.add('page-enter');
                root.addEventListener('animationend', () => root.classList.remove('page-enter'), { once: true });
            } catch (_) {}
        }

        // Phase 2 — bottom tab-bar tap handler: light haptic, and tapping the tab you're
        // already on smooth-scrolls to top (native behavior) instead of re-rendering.
        function tabNav(page) {
            try { if (navigator.vibrate) navigator.vibrate(8); } catch (_) {}
            if (router && router.currentPage === page) {
                try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) { window.scrollTo(0, 0); }
                return;
            }
            router.navigate(page);
        }

        // Phase 4 — loading skeletons. On mobile we show shimmering placeholders shaped
        // like the real content instead of a "Loading…" line; desktop keeps the text so
        // its loading state is unchanged. `kind`: 'rows' (library/feed stacked cards) or
        // 'posters' (lists poster grid).
        function skeletonRows(n = 6) {
            let out = '';
            for (let i = 0; i < n; i++) {
                out += `<div class="skel-card"><div class="skel skel-poster"></div><div class="skel-lines"><div class="skel skel-line lg"></div><div class="skel skel-line"></div><div class="skel skel-line sm"></div></div></div>`;
            }
            return out;
        }
        function skeletonPosters(n = 12) {
            let out = '<div class="lists-grid">';
            for (let i = 0; i < n; i++) out += `<div class="skel skel-tile"></div>`;
            out += '</div>';
            return out;
        }
        function loadingPlaceholder(kind) {
            if (!isMobileViewport()) return `<div class="text-gray">Loading…</div>`;
            return kind === 'posters' ? skeletonPosters() : skeletonRows();
        }

        // Pull-to-refresh (mobile, Instagram-style): drag down at the top of a refreshable
        // page to reload it. Per-page refresh is dispatched in pullToRefreshAction(); right
        // now only the Feed opts in (more pages can be added here later).
        function pullToRefreshAction() {
            const page = router && router.currentPage;
            if (page === 'feed') return loadFeedPage();
            if (page === 'library') return loadLibraryPage({ reset: true });
            // Lists: refresh the cover-grid overview (detail view has its own reload paths).
            if (page === 'lists' && typeof listsViewMode !== 'undefined' && listsViewMode === 'overview') {
                return loadListsOverview();
            }
            return null;
        }
        function pageSupportsPullToRefresh() {
            const page = router && router.currentPage;
            if (!isMobileViewport()) return false;
            if (page === 'feed' || page === 'library') return true;
            // Only the Lists overview (not an open list) opts in.
            if (page === 'lists' && typeof listsViewMode !== 'undefined' && listsViewMode === 'overview') return true;
            return false;
        }
        (function initPullToRefresh() {
            const THRESHOLD = 70;     // px pulled before a release triggers a refresh
            const MAX_PULL = 120;     // hard cap on how far the content can be dragged
            const RESIST = 0.5;       // drag resistance (content moves at half the finger)
            let startY = 0, pulling = false, armed = false, refreshing = false;
            const ind = () => document.getElementById('ptr-indicator');
            const root = () => document.getElementById('app-root');

            // Move BOTH the spinner and the page content down with the finger.
            function dragTo(pull) {
                const dist = Math.min(pull * RESIST, MAX_PULL);
                const el = ind();
                if (el) {
                    el.classList.add('show');
                    el.style.opacity = String(Math.min(1, pull / THRESHOLD));
                    el.style.transform = `translateX(-50%) translateY(${dist}px) rotate(${pull * 2.2}deg)`;
                }
                const r = root();
                if (r) { r.style.transition = 'none'; r.style.transform = `translateY(${dist}px)`; }
            }
            // Snap content back to rest; optionally keep the spinner up while refreshing.
            function release(spinning) {
                const r = root();
                if (r) {
                    r.style.transition = 'transform 0.25s ease';
                    r.style.transform = 'translateY(0)';
                    window.setTimeout(() => { if (r) { r.style.transition = ''; r.style.transform = ''; } }, 280);
                }
                const el = ind();
                if (!el) return;
                if (spinning) {
                    el.classList.add('refreshing');
                    el.style.opacity = '1';
                    el.style.transform = 'translateX(-50%) translateY(56px)';
                } else {
                    hideIndicator();
                }
            }
            function hideIndicator() {
                const el = ind();
                if (!el) return;
                el.classList.remove('refreshing', 'show');
                el.style.opacity = '0';
                el.style.transform = 'translateX(-50%) translateY(0)';
            }

            document.addEventListener('touchstart', (e) => {
                if (refreshing || !pageSupportsPullToRefresh() || window.scrollY > 0 || e.touches.length !== 1) {
                    pulling = false; return;
                }
                startY = e.touches[0].clientY;
                pulling = true; armed = false;
            }, { passive: true });

            document.addEventListener('touchmove', (e) => {
                if (!pulling || refreshing) return;
                if (window.scrollY > 0) { pulling = false; release(false); return; }
                const dy = e.touches[0].clientY - startY;
                if (dy <= 0) { dragTo(0); armed = false; return; }
                dragTo(dy);
                armed = dy >= THRESHOLD;
            }, { passive: true });

            document.addEventListener('touchend', async () => {
                if (!pulling || refreshing) return;
                pulling = false;
                if (armed) {
                    refreshing = true;
                    release(true);              // snap content back, keep spinner up
                    try { await pullToRefreshAction(); } catch (_) {}
                    refreshing = false;
                    hideIndicator();
                } else {
                    release(false);
                }
            }, { passive: true });
        })();

        // Close the Lists-only movie search dropdown when clicking outside it.
        // (This is separate from the Home page search UI.)
        document.addEventListener('click', (e) => {
            const results = document.getElementById('lists-movie-search-results');
            const input = document.getElementById('lists-movie-search-input');
            if (!results || !input) return;
            const within = (e?.target && (results.contains(e.target) || input.contains(e.target)));
            if (!within) {
                try { results.classList.add('hidden'); } catch (_) {}
            }
        }, { capture: true });

