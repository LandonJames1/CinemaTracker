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
                // Tapping the Lists tab while inside a specific list returns to the
                // all-lists overview (not just a scroll-to-top).
                if (page === 'lists' && typeof listsViewMode !== 'undefined' && listsViewMode === 'detail') {
                    try { showListsOverview(); } catch (_) {}
                    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) { window.scrollTo(0, 0); }
                    return;
                }
                try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) { window.scrollTo(0, 0); }
                return;
            }
            router.navigate(page);
        }

        // Phase 4 — loading skeletons. Shimmering placeholders shaped like the real
        // content instead of a "Loading…" line, on BOTH mobile and desktop. `kind`:
        // 'rows' (library/feed stacked cards) or 'posters' (lists poster grid).
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
            return kind === 'posters' ? skeletonPosters() : skeletonRows();
        }

        // ===== Infinite scroll (shared) =====
        // One IntersectionObserver shared across the app — only one infinitely-scrolling
        // list (My Movies / Feed / a Lists detail) is ever on screen at a time in this SPA.
        // A page renders a sentinel element at the bottom of its list and calls
        // attachInfiniteScroll(sentinel, onReach); when the sentinel scrolls near the
        // viewport, onReach() loads/renders the next page. rootMargin prefetches a bit
        // before the very bottom for a smooth feel.
        let _infiniteScrollObserver = null;
        function attachInfiniteScroll(sentinel, onReach) {
            detachInfiniteScroll();
            if (!sentinel || typeof IntersectionObserver === 'undefined' || typeof onReach !== 'function') return;
            _infiniteScrollObserver = new IntersectionObserver((entries) => {
                if (entries.some((e) => e.isIntersecting)) { try { onReach(); } catch (_) {} }
            }, { root: null, rootMargin: '500px 0px', threshold: 0 });
            _infiniteScrollObserver.observe(sentinel);
        }
        function detachInfiniteScroll() {
            if (_infiniteScrollObserver) { try { _infiniteScrollObserver.disconnect(); } catch (_) {} _infiniteScrollObserver = null; }
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

            // True if any modal/sheet overlay is currently visible. While a modal is
            // open, a downward drag belongs to the modal (scroll or swipe-to-dismiss),
            // never to the page behind it — so pull-to-refresh must NOT engage.
            function anyModalOpen() {
                try {
                    const ovs = document.querySelectorAll('.auth-overlay, [id$="-overlay"], #more-sheet-overlay');
                    for (let i = 0; i < ovs.length; i++) {
                        const ov = ovs[i];
                        if (ov.id === 'ptr-indicator' || ov.id === 'loading-overlay') continue;
                        const cs = window.getComputedStyle(ov);
                        if (cs.display !== 'none' && cs.visibility !== 'hidden') return true;
                    }
                    // Bespoke `.open`-toggled bottom sheets that aren't `*-overlay` ids
                    // (e.g. the Feed "Follows" panel + its backdrop). Without this, a
                    // downward drag on one of these refreshes the page behind it.
                    if (document.querySelector('.feed-follows-panel.open, .more-sheet-overlay.open')) return true;
                } catch (_) {}
                return false;
            }

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
                if (refreshing || !pageSupportsPullToRefresh() || window.scrollY > 0 || e.touches.length !== 1
                    || anyModalOpen()) {
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

        // Swipe-to-dismiss for EVERY mobile modal (the shared ".auth-overlay >
        // .auth-modal" pattern + the bottom-tab "More" nav sheet). Drag the modal down
        // past a threshold and it animates out + closes via the overlay's own
        // backdrop-close handler (every overlay closes on a backdrop click); below the
        // threshold it snaps back. This intentionally covers ALL pop-ups now — including
        // the auth/login modal and the two achievement celebration popups, even though
        // those aren't docked as bottom-sheets by the sheet CSS (they still slide down
        // with the finger and dismiss). The drag also calls preventDefault while pulling
        // down so the content BEHIND the modal never scrolls along with the gesture.
        (function initSheetSwipeDismiss() {
            const CLOSE_THRESHOLD = 110;   // px dragged before release dismisses the sheet
            // ONLY the loading overlay is excluded: it's a blocking spinner with no close
            // handler, so "dismissing" it would hide the spinner while the operation runs.
            const EXCLUDE = new Set(['loading-overlay']);
            let modal = null, overlay = null, closeFn = null, scroller = null, startY = 0, dy = 0, dragging = false;

            // The element whose scroll position decides "are we at the top?". A sheet can
            // contain a NESTED scroll container (e.g. the Add-to-list movie results list,
            // `.lists-add-results`, has its own overflow:auto). Without this, scrolling that
            // inner list dragged the whole sheet instead — the "glitchy, moves around"
            // bug. Walk from the touch target up to the modal and use the first scrollable
            // ancestor; fall back to the modal itself.
            function findScroller(target, boundary) {
                let el = target;
                while (el && el !== boundary && el.parentElement) {
                    try {
                        const oy = window.getComputedStyle(el).overflowY;
                        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) return el;
                    } catch (_) {}
                    el = el.parentElement;
                }
                return boundary;
            }

            function sheetsActive() {
                try { return isMobileViewport() && document.body.classList.contains('app-sheets'); } catch (_) { return false; }
            }
            function findSheet(target) {
                if (!target || !target.closest) return null;
                // Bespoke bottom-sheets that AREN'T the shared `.auth-overlay > .auth-modal`
                // pattern — they have their own `.open` class + a dedicated close fn (the
                // sheet IS the draggable element; no overlay wrapper). The Feed "Follows"
                // panel is one of these. Returning a `close` callback routes dismissSheet
                // through the right teardown (which also re-homes the moved DOM node).
                const follows = target.closest('.feed-follows-panel');
                if (follows) {
                    if (!follows.classList.contains('open')) return null;
                    return { m: follows, ov: follows, close: (typeof closeFeedFollows === 'function') ? closeFeedFollows : null };
                }
                // Covers BOTH the shared `.auth-overlay > .auth-modal` data modals AND
                // the bottom-tab "More" nav sheet (`.more-sheet-overlay > .more-sheet`).
                const m = target.closest('.auth-modal, .more-sheet');
                if (!m) return null;
                const ov = m.closest('.auth-overlay, .more-sheet-overlay');
                if (!ov || EXCLUDE.has(ov.id)) return null;
                try {
                    if (ov.classList.contains('more-sheet-overlay')) {
                        if (!ov.classList.contains('open')) return null;   // toggles a class, not display
                    } else if (window.getComputedStyle(ov).display === 'none') {
                        return null;
                    }
                } catch (_) {}
                return { m, ov, close: null };
            }
            function dismissSheet(ov, close) {
                // Bespoke sheets close through their own teardown fn (re-homes the DOM
                // node + hides its backdrop); for these, that's all that's needed.
                if (typeof close === 'function') { try { close(); } catch (_) {} return; }
                // Every overlay closes on a backdrop click (target === overlay).
                try { ov.click(); } catch (_) {}
                try {
                    if (ov.classList.contains('more-sheet-overlay')) {
                        // Class-toggled sheet: just ensure it's closed; NEVER inline-hide
                        // it (an inline display:none would break the next open).
                        ov.classList.remove('open');
                    } else if (window.getComputedStyle(ov).display !== 'none') {
                        // Fallback for any data overlay without a backdrop-close handler.
                        ov.style.display = 'none';
                        ov.classList.remove('open');
                    }
                } catch (_) {}
            }
            function reset(m) {
                if (!m) return;
                m.style.transition = '';
                m.style.transform = '';
            }

            document.addEventListener('touchstart', (e) => {
                dragging = false; modal = null; overlay = null; closeFn = null; scroller = null;
                if (!sheetsActive() || e.touches.length !== 1) return;
                // Don't hijack drags that start on a text/range control.
                if (e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
                const found = findSheet(e.target);
                if (!found) return;
                // The scroll container under the finger (the modal, or a nested scroller
                // like the Add-to-list results list). Only start a sheet drag when it's at
                // its top — otherwise let it scroll its own content first.
                scroller = findScroller(e.target, found.m);
                if (scroller.scrollTop > 0) return;
                modal = found.m; overlay = found.ov; closeFn = found.close || null;
                startY = e.touches[0].clientY; dy = 0;
                dragging = true;
            }, { passive: true });

            document.addEventListener('touchmove', (e) => {
                if (!dragging || !modal) return;
                dy = e.touches[0].clientY - startY;
                if ((scroller || modal).scrollTop > 0) { dragging = false; reset(modal); return; }
                if (dy <= 0) { dy = 0; modal.style.transform = ''; return; }
                // We're actively dragging the sheet down: consume the gesture so the
                // page/content BEHIND the modal does not scroll along with it. (Listener
                // is non-passive specifically so this preventDefault is honored.)
                if (e.cancelable) e.preventDefault();
                modal.style.transition = 'none';
                modal.style.transform = `translateY(${dy}px)`;
            }, { passive: false });

            document.addEventListener('touchend', () => {
                if (!dragging || !modal) { modal = null; overlay = null; closeFn = null; return; }
                dragging = false;
                const m = modal, ov = overlay, cf = closeFn;
                modal = null; overlay = null; closeFn = null;
                if (dy > CLOSE_THRESHOLD) {
                    m.style.transition = 'transform 0.2s ease';
                    m.style.transform = 'translateY(100%)';
                    window.setTimeout(() => {
                        reset(m);
                        dismissSheet(ov, cf);
                    }, 200);
                } else {
                    m.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
                    m.style.transform = 'translateY(0)';
                    window.setTimeout(() => reset(m), 260);
                }
            }, { passive: true });
        })();

        // Mobile Data Dash: keep the active tab pill scrolled into view inside the
        // sticky segmented indicator (the tab row is a horizontal scroller on phones).
        // Called from setDashboardTab (06) and the swipe handler below.
        function dashCenterActivePill() {
            try {
                if (!isMobileViewport()) return;
                const row = document.querySelector('.dash-tabs-row');
                if (!row) return;
                const active = row.querySelector('.btn-glass');
                if (active && active.scrollIntoView) {
                    active.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
                }
            } catch (_) {}
        }

        // Mobile Data Dash: swipe left/right anywhere on the page to move between the
        // six sections (the layout the user picked: bento tiles + swipe nav). The tab
        // pills double as the position indicator. Horizontal swipes that start inside a
        // horizontally-scrollable child (the Activity chart) are ignored so that
        // element keeps its own scroll; mostly-vertical drags fall through to scrolling.
        (function initDashSwipeNav() {
            const ORDER = ['general', 'ratings', 'tiers', 'favorites', 'charts', 'quotes'];
            const H_THRESHOLD = 60;   // min horizontal px to count as a swipe
            let startX = 0, startY = 0, tracking = false;

            function dashActive() {
                try { return isMobileViewport() && document.body.dataset.page === 'dashboard'; } catch (_) { return false; }
            }
            // True if the gesture started inside an element that can scroll sideways.
            function startedInHScroller(target) {
                let el = target;
                while (el && el !== document.body) {
                    try {
                        const ox = getComputedStyle(el).overflowX;
                        if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 4) return true;
                    } catch (_) {}
                    if (el.classList && el.classList.contains('container')) break;
                    el = el.parentElement;
                }
                return false;
            }
            function go(dir) {
                const cur = (typeof dashboardActiveTab !== 'undefined' && dashboardActiveTab) ? dashboardActiveTab : 'general';
                let i = ORDER.indexOf(cur);
                if (i < 0) i = 0;
                const ni = i + dir;
                if (ni < 0 || ni >= ORDER.length) return; // no wrap-around at the ends
                const next = ORDER[ni];
                const pane = document.getElementById('dash-pane-' + next);
                try { if (typeof setDashboardTab === 'function') setDashboardTab(next); } catch (_) {}
                try { if (navigator.vibrate) navigator.vibrate(8); } catch (_) {}
                if (pane && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
                    const cls = dir > 0 ? 'dash-pane-in-right' : 'dash-pane-in-left';
                    pane.classList.remove('dash-pane-in-right', 'dash-pane-in-left');
                    void pane.offsetWidth; // restart the animation
                    pane.classList.add(cls);
                    pane.addEventListener('animationend', () => pane.classList.remove(cls), { once: true });
                }
                try { dashCenterActivePill(); } catch (_) {}
            }

            document.addEventListener('touchstart', (e) => {
                tracking = false;
                if (!dashActive() || e.touches.length !== 1) return;
                const t = e.target;
                if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"], .dash-tabs-row')) return;
                if (startedInHScroller(t)) return;
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
                tracking = true;
            }, { passive: true });

            document.addEventListener('touchend', (e) => {
                if (!tracking) return;
                tracking = false;
                const touch = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0] : null;
                if (!touch) return;
                const dx = touch.clientX - startX;
                const dy = touch.clientY - startY;
                if (Math.abs(dx) < H_THRESHOLD) return;
                if (Math.abs(dx) < Math.abs(dy) * 1.3) return; // mostly vertical → let it scroll
                go(dx < 0 ? 1 : -1); // swipe left → next section, swipe right → previous
            }, { passive: true });
        })();

        // ===== Swipe-left-to-go-back on another user's Account page ================
        // When viewing SOMEONE ELSE's account (opened from a feed/leaderboard avatar),
        // a whole-screen left swipe returns to the exact previous page (router.goBack
        // restores the snapshot). Scoped to that page only, so it never fights the
        // Discover deck / Data Dash horizontal swipes or the vertical sheet gestures.
        (function initAccountBackSwipe() {
            const H_THRESHOLD = 70;
            let startX = 0, startY = 0, tracking = false;

            function onOtherAccount() {
                try {
                    if (!isMobileViewport() || document.body.dataset.page !== 'account') return false;
                    const me = (typeof getActiveUserId === 'function') ? getActiveUserId() : '';
                    return !!accountHomeViewUserId && accountHomeViewUserId !== me;
                } catch (_) { return false; }
            }

            document.addEventListener('touchstart', (e) => {
                tracking = false;
                if (!onOtherAccount() || e.touches.length !== 1) return;
                const t = e.target;
                if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"], .auth-overlay, .more-sheet-overlay')) return;
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
                tracking = true;
            }, { passive: true });

            document.addEventListener('touchend', (e) => {
                if (!tracking) return;
                tracking = false;
                if (!onOtherAccount()) return;
                const touch = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0] : null;
                if (!touch) return;
                const dx = touch.clientX - startX;
                const dy = touch.clientY - startY;
                if (dx >= 0 || Math.abs(dx) < H_THRESHOLD) return;     // only a leftward swipe
                if (Math.abs(dx) < Math.abs(dy) * 1.3) return;          // mostly vertical → let it scroll
                try { if (navigator.vibrate) navigator.vibrate(8); } catch (_) {}
                try { router.goBack(); } catch (_) {}
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

