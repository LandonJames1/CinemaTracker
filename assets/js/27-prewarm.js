        // ===== Boot prewarm ======================================================
        // Load what the user is ABOUT to look at before they ask for it, so the first
        // visit to a page is as instant as the second (which the router page cache in
        // 02-router.js already handles).
        //
        // The idea: a page's first paint waits on (a) its DB round-trips and then (b) a
        // screenful of poster images, each its own request. Both can be done in the
        // background while the user is still on Home. Each surface has a `take*Prewarm`
        // consumer wired into its EXISTING loader, so a hit removes the round-trip and
        // a miss is simply the code that ran before — there is no separate render path.
        //
        // ⚠️ Rules this follows, because prewarming is easy to get wrong:
        //   • it costs the user real bandwidth, so it's skipped on Save-Data and on 2g,
        //     runs at idle, and is staggered so it never competes with Home's own load;
        //   • a prewarmed payload is CONSUMED ONCE (take, not peek) and never re-fetched
        //     on a schedule — it exists to cover the FIRST open, after which the page
        //     cache takes over. That keeps it inside the same rule as everything else:
        //     data refreshes on a user action, not on a timer;
        //   • anything a mutation invalidates must drop the matching payload too, which
        //     is why invalidatePrewarm() is called from router.invalidateSnapshots().
        // =========================================================================

        let prewarmRunning = false;
        let prewarmedForUserId = '';

        // Roughly the first screenful or two per surface. Poster requests are small but
        // they're not free, and anything past this is scrolled to, not landed on.
        const PREWARM_IMG_CAP = 24;

        // Payloads, each keyed by the user they were fetched for.
        let listsOverviewPrewarm = null;    // { userId, lists, infoByList }
        let libraryFirstPagePrewarm = null; // { userId, signature, rows }
        let feedFirstPagePrewarm = null;    // { userId, usersKey, rows }

        function prewarmAllowed() {
            try {
                if (!supabaseClient || !cachedIsAuthed) return false;
                if (guestMode) return false;   // demo data isn't the user's, don't spend bandwidth on it
                const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
                if (c?.saveData) return false;
                const t = String(c?.effectiveType || '');
                if (t === 'slow-2g' || t === '2g') return false;
            } catch (_) {}
            return true;
        }

        // Run `fn` when the browser is idle, so prewarming never delays the page the user
        // is actually looking at. requestIdleCallback isn't universal (older Safari), so
        // fall back to a plain timeout.
        function prewarmWhenIdle(fn, timeoutMs = 2000) {
            try {
                if (typeof requestIdleCallback === 'function') {
                    requestIdleCallback(() => { try { fn(); } catch (_) {} }, { timeout: timeoutMs });
                    return;
                }
            } catch (_) {}
            setTimeout(() => { try { fn(); } catch (_) {} }, Math.min(timeoutMs, 1200));
        }

        // Warm the browser's image cache. These never touch the DOM — the point is that
        // when the real <img> is rendered later, its src is already downloaded and decoded,
        // so the page paints complete instead of filling in tile by tile.
        function preloadImages(urls, cap = PREWARM_IMG_CAP) {
            const seen = new Set();
            let n = 0;
            for (const raw of (Array.isArray(urls) ? urls : [])) {
                const url = String(raw || '').trim();
                if (!url || seen.has(url)) continue;
                seen.add(url);
                if (++n > cap) break;
                try {
                    const img = new Image();
                    img.decoding = 'async';
                    img.src = url;
                } catch (_) {}
            }
            return n;
        }

        function prewarmPosterUrl(path, size = 'w500') {
            const p = String(path || '').trim();
            if (!p) return '';
            if (/^https?:|^data:/i.test(p)) return p;
            return `https://image.tmdb.org/t/p/${size}${p.startsWith('/') ? p : `/${p}`}`;
        }

        // ---- Lists ---------------------------------------------------------------
        // The user's own example: don't make them open Lists and wait to see their lists.
        // Fetches the overview grid's data, preloads every cover / collage poster, then
        // (fire-and-forget) prefetches each list's full contents so clicking IN is instant
        // too — that second part reuses the existing prefetchAllListsDetails cache.
        async function prewarmLists(userId) {
            const uid = String(userId || '').trim();
            if (!uid) return;
            try { await ensureBucketListForUser({ user_id: uid }); } catch (_) {}
            const data = await fetchListsOverviewData(uid);
            if (!data || !Array.isArray(data.lists)) return;
            listsOverviewPrewarm = { userId: uid, lists: data.lists, infoByList: data.infoByList };

            // Cover art, exactly as renderListCoverArt resolves it: the list's saved cover
            // (a data URL — free) first, else the poster collage (real requests).
            const urls = [];
            for (const l of data.lists) {
                const cover = String(l?.cover || '').trim();
                if (cover) { urls.push(cover); continue; }
                const info = data.infoByList.get(String(l?.id || '')) || {};
                for (const p of (info.posters || [])) urls.push(prewarmPosterUrl(p, 'w342'));
            }
            preloadImages(urls, 40);   // covers are cheap; a cover grid is the whole page

            try { prefetchAllListsDetails(data.lists, uid); } catch (_) {}
        }

        function takeListsOverviewPrewarm(userId) {
            const uid = String(userId || '').trim();
            const p = listsOverviewPrewarm;
            if (!p || p.userId !== uid) return null;
            listsOverviewPrewarm = null;   // covers the FIRST open only; the page cache has it after that
            return { lists: p.lists, infoByList: p.infoByList };
        }

        // ---- My Movies -----------------------------------------------------------
        // Only ever the DEFAULT view (no filters, no sort change, no search) — that's what
        // a first visit shows. The signature is captured at fetch time and re-checked on
        // consume, so if the user sets a filter before they get there, this is discarded
        // and the normal query runs.
        function librarySignature() {
            try {
                ensureLibrarySortFilterStateInitialized();
                return JSON.stringify({ s: librarySortFilterState, q: String(librarySearchQuery || ''), n: libraryLimit });
            } catch (_) { return ''; }
        }

        async function prewarmLibrary(userId) {
            const uid = String(userId || '').trim();
            if (!uid) return;
            const signature = librarySignature();
            if (!signature) return;
            const { data, error } = await libraryBuildServerQuery({ userId: uid, offset: 0, limit: libraryLimit });
            if (error || !Array.isArray(data)) return;
            libraryFirstPagePrewarm = { userId: uid, signature, rows: data };
            preloadImages(data.map(r => prewarmPosterUrl(r?.poster_path)), PREWARM_IMG_CAP);
        }

        function takeLibraryFirstPagePrewarm(userId) {
            const uid = String(userId || '').trim();
            const p = libraryFirstPagePrewarm;
            if (!p || p.userId !== uid) return null;
            libraryFirstPagePrewarm = null;
            // The view changed since we fetched (a filter, a sort, a search) — those rows
            // are the wrong rows now, so let the real query run.
            if (p.signature !== librarySignature()) return null;
            return p.rows;
        }

        // ---- Feed ----------------------------------------------------------------
        // Warms two things the feed serially waits on: who you follow, and the first page
        // of their most recent reviews (the query every later step depends on).
        async function prewarmFeed(userId) {
            const uid = String(userId || '').trim();
            if (!uid) return;
            try { await loadMyFollowingIds(); } catch (_) {}
            const ids = Array.from(feedFollowingIds || []).map(x => String(x || '').trim()).filter(Boolean);
            if (!ids.length) return;
            const { data, error } = await supabaseClient
                .from('Movie Ratings')
                .select('user_id, movie_id, watch_date, updated_at, created_at')
                .in('user_id', ids)
                .order('created_at', { ascending: false, nullsFirst: false })
                .range(0, FEED_NORMAL_PAGE - 1);
            if (error || !Array.isArray(data)) return;
            feedFirstPagePrewarm = { userId: uid, usersKey: prewarmUsersKey(ids), rows: data };

            // Warm the posters for the movies that will be on screen first.
            const movieIds = Array.from(new Set(data.map(r => String(r?.movie_id || '')).filter(Boolean))).slice(0, PREWARM_IMG_CAP);
            if (!movieIds.length) return;
            const { data: movies } = await supabaseClient
                .from('Movies').select('id, poster_path').in('id', movieIds);
            preloadImages((Array.isArray(movies) ? movies : []).map(m => prewarmPosterUrl(m?.poster_path)), PREWARM_IMG_CAP);
        }

        function prewarmUsersKey(ids) {
            return Array.from(new Set((Array.isArray(ids) ? ids : []).map(x => String(x || '').trim()).filter(Boolean)))
                .sort().join(',');
        }

        function takeFeedFirstPagePrewarm(queryUserIds) {
            const p = feedFirstPagePrewarm;
            if (!p) return null;
            feedFirstPagePrewarm = null;
            // A Filter change (excluded users / Compare Own) means a different query.
            if (p.usersKey !== prewarmUsersKey(queryUserIds)) return null;
            return p.rows;
        }

        // ---- Invalidation --------------------------------------------------------
        // Called from router.invalidateSnapshots (so every existing mutation site covers
        // it) and on identity change. A prewarmed payload is just another stored copy of
        // page data; the same thing that makes a cached PAGE wrong makes this wrong.
        function invalidatePrewarm(pages) {
            const set = pages ? new Set([].concat(pages)) : null;
            if (!set || set.has('lists')) listsOverviewPrewarm = null;
            if (!set || set.has('library')) libraryFirstPagePrewarm = null;
            if (!set || set.has('feed')) feedFirstPagePrewarm = null;
            if (!set) { prewarmedForUserId = ''; }
        }

        // ---- Orchestration -------------------------------------------------------
        // Staggered on purpose: Lists first (the biggest win — a whole grid of cover art),
        // then My Movies, then Feed. Each waits for the previous so we never fire three
        // concurrent query bursts at a phone that is still painting Home.
        async function prewarmApp() {
            if (prewarmRunning) return;
            if (!prewarmAllowed()) return;
            const uid = (typeof getActiveUserId === 'function') ? String(getActiveUserId() || '') : '';
            if (!uid || uid === prewarmedForUserId) return;

            prewarmRunning = true;
            prewarmedForUserId = uid;
            try {
                for (const step of [prewarmLists, prewarmLibrary, prewarmFeed]) {
                    // One surface failing (offline, RLS, a missing table) must not stop the
                    // others; each is an optimization, never a requirement.
                    try { await step(uid); } catch (e) {
                        try { emitLog('warn', `Prewarm step failed: ${String(e?.message || e)}`); } catch (_) {}
                    }
                    if (String(getActiveUserId() || '') !== uid) break;   // signed out / switched mid-run
                }
            } finally {
                prewarmRunning = false;
            }
        }

        // Entry point: called from the boot sequence once auth has resolved, and again on
        // a real sign-in. Idle-scheduled so Home's own render always wins the main thread.
        function schedulePrewarm(delayMs = 1200) {
            if (!prewarmAllowed()) return;
            setTimeout(() => prewarmWhenIdle(() => { prewarmApp().catch(() => {}); }), delayMs);
        }
