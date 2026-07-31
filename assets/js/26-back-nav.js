        // ===== Unified Back navigation ===========================================
        // The app's single answer to "where does Back go?". Two pieces live here:
        //
        //   1. pushBackState() — lets an IN-PAGE state change register itself as a real
        //      Back step: opening a game from the Games hub, opening one list from the
        //      Lists overview, switching to a non-default Account/results tab. Before
        //      this, Back only knew about router PAGES, so backing out of a game blew
        //      past the hub and left the Games page entirely.
        //   2. initBackSwipe() — the whole-screen swipe-left gesture that drives
        //      router.goBack(), with the page tracking the finger so the gesture reads
        //      as direct manipulation rather than a hidden shortcut.
        //
        // A sub-state pushes a REAL history entry alongside its router.navStack entry,
        // so the OS/browser back button unwinds it identically — see router.goBack()
        // and the popstate handler in 02-router.js, which are the consumers of both.

        // Record an in-page sub-state. `label` is a namespaced string ("game:spottle",
        // "list:<id>", "acct-tab:profile") so dropBackState can find it again by prefix;
        // `restore` is the callback that returns the page to the state it was in BEFORE
        // this change (e.g. closeGame, showListsOverview).
        function pushBackState(label, restore) {
            if (typeof restore !== 'function') return;
            try {
                router.navStack.push({
                    subState: true,
                    label: String(label || ''),
                    page: router.currentPage,
                    mode: router.formMode,
                    restore,
                });
                history.pushState(
                    { page: router.currentPage, mode: router.formMode, sub: String(label || '') },
                    '', location.pathname
                );
            } catch (_) {}
        }

        // Safety net for sub-states that were exited by some route OTHER than Back —
        // tapping the Lists tab while inside a list, a game finishing and returning to
        // the hub on its own. Removes the topmost entry whose label starts with
        // `prefix` so the stack can't accumulate steps that no longer mean anything.
        // Deliberately does NOT touch history (that would double-unwind when this is
        // called from inside a restore callback); a stray history entry just costs one
        // extra OS-back press, whereas a stale navStack entry would eat a swipe.
        function dropBackState(prefix) {
            const p = String(prefix || '');
            if (!p) return;
            try {
                for (let i = router.navStack.length - 1; i >= 0; i--) {
                    const e = router.navStack[i];
                    if (e?.subState && String(e.label || '').startsWith(p)) {
                        router.navStack.splice(i, 1);
                        return;
                    }
                }
            } catch (_) {}
        }

        // Re-arm infinite scroll on a page that was restored from a snapshot.
        // restoreSnapshot() replaces #app-root's innerHTML, which DETACHES the sentinel
        // node the shared IntersectionObserver was watching — the observer survives but
        // now points at a node that will never intersect anything, so the restored page
        // would silently stop loading more as you scroll. Re-point it at the sentinel in
        // the freshly restored DOM, with the same callback that page's renderer uses.
        // (No sentinel = that page had nothing more to load; nothing to do.)
        function reattachInfiniteScrollForPage(page) {
            try {
                if (page === 'library') {
                    const wrap = document.getElementById('library-load-more-wrap');
                    if (wrap) attachInfiniteScroll(wrap, () => { loadLibraryMore({ replace: false }); });
                } else if (page === 'feed') {
                    const sentinel = document.getElementById('feed-load-sentinel');
                    if (sentinel) attachInfiniteScroll(sentinel, () => { loadFeedItems({ appendNormal: true }); });
                } else if (page === 'lists') {
                    const sentinel = document.getElementById('lists-load-sentinel');
                    if (sentinel) attachInfiniteScroll(sentinel, () => { renderListsMoreCards(); });
                }
            } catch (_) {}
        }

        // Drop stored page HTML that a mutation has just made wrong, so Back re-renders
        // (and refetches) that page instead of restoring a copy that predates the change.
        // Thin wrapper over router.invalidateSnapshots so callers don't reach into the
        // router; `pages` is a page key or array of them, omitted = all.
        function invalidatePageSnapshots(pages) {
            try { router.invalidateSnapshots(pages); } catch (_) {}
        }

        // True while a back-swipe is actively dragging the page sideways. Pull-to-refresh
        // (09-home-ui.js) checks this so a diagonal drag can't run both gestures at once.
        let backSwipeEngaged = false;
        function isBackSwipeEngaged() { return backSwipeEngaged; }

        // ===== Swipe-left-to-go-back ==============================================
        // Replaces the old account-only version (initAccountBackSwipe in 09-home-ui.js).
        // Works on every mobile page EXCEPT the two that already own the horizontal
        // axis: Data Dash (swipe = change section) and Discover (swipe = rate the card).
        (function initBackSwipe() {
            const THRESHOLD = 70;    // px of leftward travel before release triggers Back
            const MAX_PULL = 140;    // cap on how far the page can be dragged
            const RESIST = 0.45;     // page moves at ~half the finger
            const LOCK = 10;         // px of travel before we commit to an axis

            // Pages whose horizontal swipe already means something else.
            const EXCLUDED_PAGES = new Set(['dashboard', 'discover']);
            // Elements that own their own horizontal drag, or where a stray swipe would
            // destroy work in progress.
            const EXCLUDED_TARGETS = [
                'input', 'textarea', 'select', '[contenteditable="true"]',
                '.auth-overlay', '.more-sheet-overlay', '.feed-follows-panel',
                '.discover-card', '.rank-list', '.movie-spotlight-modal',
            ].join(', ');

            let startX = 0, startY = 0, dx = 0;
            let tracking = false, locked = false;

            function swipeActive() {
                try {
                    if (!isMobileViewport()) return false;
                    if (EXCLUDED_PAGES.has(document.body.dataset.page)) return false;
                    return !!(router && router.canGoBack && router.canGoBack());
                } catch (_) { return false; }
            }

            // True if the gesture began inside something that scrolls sideways (the
            // "You Might Like" strip, the spotlight tab row, the Activity chart) — that
            // element's own scroll wins.
            function startedInHScroller(target) {
                let el = target;
                while (el && el !== document.body) {
                    try {
                        const ox = getComputedStyle(el).overflowX;
                        if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 4) return true;
                    } catch (_) {}
                    el = el.parentElement;
                }
                return false;
            }

            const root = () => document.getElementById('app-root');

            function dragTo(px) {
                const r = root();
                if (!r) return;
                const dist = Math.max(-MAX_PULL, px * RESIST);
                r.style.transition = 'none';
                r.style.transform = `translateX(${dist}px)`;
                r.style.opacity = String(Math.max(0.55, 1 + dist / (MAX_PULL * 2.4)));
            }
            function clearDrag() {
                const r = root();
                if (!r) return;
                r.style.transition = '';
                r.style.transform = '';
                r.style.opacity = '';
            }
            function snapBack() {
                const r = root();
                if (!r) { backSwipeEngaged = false; return; }
                r.style.transition = 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.22s ease';
                r.style.transform = 'translateX(0)';
                r.style.opacity = '1';
                window.setTimeout(() => { clearDrag(); backSwipeEngaged = false; }, 240);
            }
            function commit() {
                const r = root();
                try { if (navigator.vibrate) navigator.vibrate(8); } catch (_) {}
                if (!r) { backSwipeEngaged = false; try { router.goBack(); } catch (_) {} return; }
                r.style.transition = 'transform 0.16s ease-in, opacity 0.16s ease-in';
                r.style.transform = `translateX(-${MAX_PULL}px)`;
                r.style.opacity = '0';
                window.setTimeout(() => {
                    // Clear the inline transform BEFORE the new view renders — otherwise
                    // it lingers on #app-root and both offsets the incoming page and
                    // traps any fixed-position child in a transformed ancestor.
                    clearDrag();
                    backSwipeEngaged = false;
                    try { router.goBack(); } catch (_) {}
                }, 165);
            }

            document.addEventListener('touchstart', (e) => {
                tracking = false; locked = false; dx = 0;
                if (backSwipeEngaged || !swipeActive() || e.touches.length !== 1) return;
                const t = e.target;
                if (t && t.closest && t.closest(EXCLUDED_TARGETS)) return;
                if (startedInHScroller(t)) return;
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
                tracking = true;
            }, { passive: true });

            document.addEventListener('touchmove', (e) => {
                if (!tracking || e.touches.length !== 1) return;
                dx = e.touches[0].clientX - startX;
                const dy = e.touches[0].clientY - startY;

                if (!locked) {
                    if (Math.abs(dx) < LOCK && Math.abs(dy) < LOCK) return;
                    // Commit to one axis on the first real movement. A mostly-vertical
                    // drag is scrolling (or pull-to-refresh) and must fall straight
                    // through; only a clearly leftward drag becomes a back-swipe.
                    if (dx > 0 || Math.abs(dx) < Math.abs(dy) * 1.3) { tracking = false; return; }
                    locked = true;
                    backSwipeEngaged = true;
                }
                // Own the gesture now, so the page underneath doesn't scroll with it.
                if (e.cancelable) e.preventDefault();
                dragTo(Math.min(0, dx));
            }, { passive: false });

            document.addEventListener('touchend', () => {
                if (!tracking) return;
                tracking = false;
                if (!locked) return;
                locked = false;
                if (dx <= -THRESHOLD) commit();
                else snapBack();
            }, { passive: true });

            document.addEventListener('touchcancel', () => {
                tracking = false;
                if (locked) { locked = false; snapBack(); }
            }, { passive: true });
        })();
