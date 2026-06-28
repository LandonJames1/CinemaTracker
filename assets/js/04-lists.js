        const LIST_ITEMS_VIEW = 'user_list_items_v1'; // pre-joined list rows (see lists_views.sql)
        let listsBound = false;
        let listsLoading = false;
        let listsActiveListId = null;
        let listsActiveListName = '';
        let listsViewMode = 'overview';  // 'overview' (cover grid of all lists) | 'detail' (one list's movies)
        let listsCoverUploadBusy = false;
        let listsAddAppliedYear = '';    // Year/MPA filters for the add-movie modal search
        let listsAddAppliedMpa = '';
        let listsPendingSelectName = ''; // when set, loadListsPage opens the list with this name (deep-links, e.g. "Recs")
        let listsPendingSelectId = '';   // when set, loadListsPage opens the list with this id (deep-links, e.g. a shared-list-add push)
        let recByDataByMovieId = new Map(); // movie_id -> [{ id, username, icon }] recommenders (for the Recs "+" modal)
        // Lists detail infinite scroll: the whole list loads in one query, but we render
        // only the first LISTS_RENDER_PAGE cards and append the rest as the user scrolls.
        const LISTS_RENDER_PAGE = 100;
        let listsPendingCardsHtml = []; // remaining pre-built card HTML strings not yet in the DOM
        let cachedLists = [];
        let cachedListsUserId = null;

        let listsMoviePrefillById = new Map();
        let listsPlatformsByMovieId = new Map();

        let cachedBucketListId = null;
        let bucketListEnsuredForUserId = null;

        let listPickerSelectedMovie = null;
        let listPickerBusy = false;
        let listPickerSelectedIds = new Set();   // list ids highlighted for multi-add
        let listPickerExistingIds = new Set();   // list ids the movie is already in (greyed out)
        let listPickerAllLists = [];             // every loaded list (unfiltered), for search
        let listPickerInfoCache = null;          // cached per-list cover/count info, so search doesn't re-query
        let listPickerSearchQuery = '';          // current search text filtering the list grid
        let listsCreateBusy = false;
        let listsRenameBusy = false;
        let listsDeleteBusy = false;

        // Shared (group) list state.
        let listsCreateShared = false;                 // Create modal: shared toggle
        let listsCreateSelectedMemberIds = new Set();  // Create modal: chosen members
        let listsFollowsCache = [];                    // [{id, username, display_name, icon}]
        let listsFollowsCacheUserId = '';
        let listsEditMembers = [];                      // Edit modal: current members of the active list
        let listsEditAddMode = false;                   // Edit modal: showing the "add member" picker?

        // ===== Shared segmented-pill controls (Filters & Sort modals) =====
        // A `.sf-seg` group is a row of `<button data-val="…">` pills with exactly one
        // `.is-active`; it replaces a small fixed-option <select> in the My Movies +
        // Lists filter modals. Defined here because 04 loads before 05, so both modals
        // share these globals. State is read on Save via sfSegGetValue.
        let sfSegListenerBound = false;
        function ensureSfSegListener() {
            if (sfSegListenerBound) return;
            sfSegListenerBound = true;
            document.addEventListener('click', (e) => {
                const btn = e?.target?.closest ? e.target.closest('.sf-seg button[data-val]') : null;
                if (!btn) return;
                const group = btn.closest('.sf-seg');
                if (!group) return;
                e.preventDefault();
                sfSegSetValue(group, String(btn.dataset.val || ''));
            });
        }
        function sfSegSetValue(container, val) {
            if (!container) return;
            const want = String(val == null ? '' : val);
            const btns = Array.from(container.querySelectorAll('button[data-val]'));
            if (!btns.length) return;
            let matched = false;
            btns.forEach((b) => {
                const on = String(b.dataset.val || '') === want;
                b.classList.toggle('is-active', on);
                if (on) matched = true;
            });
            // Unknown value → fall back to the first pill (its data-val is the default).
            if (!matched) btns.forEach((b, i) => b.classList.toggle('is-active', i === 0));
        }
        function sfSegGetValue(container) {
            if (!container) return '';
            const active = container.querySelector('button[data-val].is-active');
            return active ? String(active.dataset.val || '') : '';
        }

        function isBucketList({ list_id, list_name } = {}) {
            const lid = String(list_id || '').trim();
            if (lid && cachedBucketListId && String(cachedBucketListId) === lid) return true;
            const name = String(list_name || '').trim().toLowerCase();
            return name === 'bucket list';
        }

        function closeListPickerModal() {
            const overlay = document.getElementById('list-picker-overlay');
            if (!overlay) return;
            overlay.style.display = 'none';

            const statusEl = document.getElementById('list-picker-status');
            if (statusEl) statusEl.textContent = '';
            const nameEl = document.getElementById('list-picker-new-name');
            if (nameEl) nameEl.value = '';
            const searchEl = document.getElementById('list-picker-search');
            if (searchEl) searchEl.value = '';
            listPickerSelectedMovie = null;
            listPickerBusy = false;
            listPickerSelectedIds = new Set();
            listPickerExistingIds = new Set();
            listPickerAllLists = [];
            listPickerInfoCache = null;
            listPickerSearchQuery = '';
        }

        // ===== Movie Recommendations =====
        // Recommend a movie to people you follow. "Send Rec" adds the movie to each
        // recipient's auto-managed "Recs" list (server-side, via the swift-api Edge
        // Function) and sends them a web-push notification.
        let recPendingMovie = null;      // { db_movie_id, title, year, tmdb_id, accessToken, user_id }
        let recSelectedUserIds = new Set();
        let recRecipientsCache = [];     // [{ id, username, display_name, icon }] of people you follow
        let recSeenInfoByUserId = new Map(); // user_id -> their Movie Ratings row for the pending movie (already seen it)
        let recAlreadyRecByUserId = new Set(); // user_ids I've already recommended this movie to (still pending in their Recs)
        let recBound = false;
        let recSending = false;

        function bindRecModal() {
            if (recBound) return;
            recBound = true;

            // Recipient checkbox toggles.
            document.addEventListener('change', (e) => {
                const cb = e?.target;
                if (!cb || cb.type !== 'checkbox' || !cb.classList || !cb.classList.contains('rec-user-cb')) return;
                const uid = String(cb.dataset.recUserId || '').trim();
                if (!uid) return;
                if (cb.checked) recSelectedUserIds.add(uid);
                else recSelectedUserIds.delete(uid);
            });

            // Search box filters the followed-users list.
            document.addEventListener('input', (e) => {
                if (e?.target?.id !== 'rec-modal-search') return;
                renderRecModalList();
            });

            // Send / select-all / deselect-all buttons.
            document.addEventListener('click', (e) => {
                const btn = e?.target?.closest ? e.target.closest('[data-rec-action]') : null;
                if (!btn) return;
                const a = String(btn.dataset.recAction || '');
                if (a === 'send') {
                    sendRecommendation();
                } else if (a === 'select_all') {
                    for (const u of recRecipientsCache) {
                        const id = String(u?.id || '').trim();
                        if (id) recSelectedUserIds.add(id);
                    }
                    renderRecModalList();
                } else if (a === 'deselect_all') {
                    recSelectedUserIds.clear();
                    renderRecModalList();
                }
            });
        }

        // Open the Recommend modal from the Home search flow (uses the selected movie).
        async function openRecModalFromHome() {
            const picked = router?.selectedMovie || null;
            if (!picked) { showToast('Select a movie first.', { level: 'warn' }); return; }
            await openRecModal({
                title: String(picked?.title || '').trim(),
                year: Number(picked?.year ?? picked?.release_year ?? null),
                tmdb_id: Number(picked?.tmdb_id ?? picked?.tmdbId ?? picked?.id ?? null),
                db_movie_id: isUuidLike(picked?.id) ? String(picked.id).trim() : null,
            });
        }

        async function openRecModal({ title, year, tmdb_id, db_movie_id } = {}) {
            if (guardGuestWrite()) return;
            if (!supabaseClient) { showToast('Supabase SDK failed to load.', { level: 'warn' }); return; }

            let authedUser = null, accessToken = null;
            try {
                const res = await requireAuthOrThrow();
                authedUser = res.user; accessToken = res.accessToken;
            } catch (_) { openAuthModal(); return; }

            recPendingMovie = {
                title: String(title || '').trim(),
                year: Number.isFinite(Number(year)) ? Number(year) : null,
                tmdb_id: Number.isFinite(Number(tmdb_id)) ? Number(tmdb_id) : null,
                db_movie_id: isUuidLike(db_movie_id) ? String(db_movie_id).trim() : null,
                accessToken,
                user_id: authedUser.id,
            };
            recSelectedUserIds = new Set();

            bindRecModal();

            const overlay = document.getElementById('rec-modal-overlay');
            if (overlay) { overlay.style.display = 'flex'; overlay.classList.add('open'); }

            const movieEl = document.getElementById('rec-modal-movie');
            if (movieEl) {
                const t = recPendingMovie.title, y = recPendingMovie.year;
                movieEl.textContent = t
                    ? `Recommend: ${t}${(Number.isFinite(y) && y > 0) ? ` (${y})` : ''}`
                    : 'Recommend this movie';
            }
            const statusEl = document.getElementById('rec-modal-status');
            if (statusEl) statusEl.textContent = '';
            const searchEl = document.getElementById('rec-modal-search');
            if (searchEl) searchEl.value = '';

            const listEl = document.getElementById('rec-modal-list');
            if (listEl) listEl.innerHTML = `<div class="text-gray" style="padding: 0.6rem;">Loading…</div>`;

            try {
                await loadRecRecipients();
            } catch (err) {
                if (listEl) listEl.innerHTML = `<div class="text-gray" style="padding: 0.6rem;">Could not load follows: ${escapeHtml(String(err?.message || err))}</div>`;
                return;
            }
            renderRecModalList();
        }

        function closeRecModal() {
            const overlay = document.getElementById('rec-modal-overlay');
            if (overlay) { overlay.style.display = 'none'; overlay.classList.remove('open'); }
            recPendingMovie = null;
            recSelectedUserIds = new Set();
            recSeenInfoByUserId = new Map();
            recSending = false;
        }

        // Shows a follower's existing review of the pending movie (opened from the
        // "View review" link next to a greyed-out, already-seen recipient).
        function openRecReviewModal(userId) {
            const uid = String(userId || '').trim();
            const row = recSeenInfoByUserId.get(uid) || null;
            const u = recRecipientsCache.find(x => String(x?.id) === uid) || null;

            const overlay = document.getElementById('rec-review-overlay');
            const titleEl = document.getElementById('rec-review-title');
            const bodyEl = document.getElementById('rec-review-body');
            if (!overlay || !bodyEl) return;

            if (!row) {
                if (titleEl) titleEl.textContent = 'Review';
                bodyEl.innerHTML = `<div class="text-gray" style="padding:0.6rem;">No review found.</div>`;
            } else {
                const username = String(u?.username || '').trim();
                const name = String(u?.display_name || '').trim() || (username ? `@${username}` : 'User');
                const movieTitle = String(recPendingMovie?.title || 'this movie').trim();
                const overall = dashFormatScoreWhole(row?.overall_rating);
                const tierLabel = dashNormalizeTierLabel(row?.tier);
                const watched = String(row?.watch_date || '').trim();
                const quote = String(row?.fav_quote || '').trim();
                const notes = String(row?.notes || '').trim();
                const subs = [
                    { k: 'Sound', v: dashFormatScoreWhole(row?.sound_rating) },
                    { k: 'Pace', v: dashFormatScoreWhole(row?.pacing_rating) },
                    { k: 'Imagery', v: dashFormatScoreWhole(row?.imagery_rating) },
                    { k: 'Acting', v: dashFormatScoreWhole(row?.acting_rating) },
                    { k: 'Plot', v: dashFormatScoreWhole(row?.plot_rating) },
                    { k: 'Dialogue', v: dashFormatScoreWhole(row?.dialogue_rating) },
                ].filter(x => String(x.v || '').trim());

                if (titleEl) titleEl.textContent = `${name} · ${movieTitle}`;
                bodyEl.innerHTML = `
                    ${(overall || tierLabel)
                        ? `<div class="feed-metrics" style="margin-bottom: 0.5rem;">${overall ? dashRenderHelpScore(overall) : ''}${tierLabel ? dashRenderHelpTier(tierLabel) : ''}</div>`
                        : `<div class="text-xs text-gray">No rating recorded.</div>`}
                    ${watched ? `<div class="text-xs" style="color: rgba(255,255,255,0.55); margin-bottom: 0.5rem;">Watched: ${escapeHtml(watched)}</div>` : ''}
                    ${subs.length ? `<div class="library-chip-row" style="margin-top: 0.4rem;">${subs.map(d => `<span class="dash-quote-pill">${escapeHtml(d.k)}: ${escapeHtml(d.v)}</span>`).join('')}</div>` : ''}
                    ${quote ? `<div style="margin-top: 0.75rem;"><div class="text-xs text-gray" style="margin-bottom: 0.25rem;">Favorite Quote</div><div class="text-white" style="line-height: 1.4;">${escapeHtml(quote)}</div></div>` : ''}
                    ${notes ? `<div style="margin-top: 0.75rem;"><div class="text-xs text-gray" style="margin-bottom: 0.25rem;">Notes</div><div class="text-white" style="line-height: 1.4; white-space: pre-wrap;">${escapeHtml(notes)}</div></div>` : ''}
                `;
            }

            overlay.style.display = 'flex';
            overlay.classList.add('open');
        }

        function closeRecReviewModal() {
            const overlay = document.getElementById('rec-review-overlay');
            if (overlay) { overlay.style.display = 'none'; overlay.style.zIndex = ''; overlay.classList.remove('open'); }
        }

        // ===== Recs poster viewer (Movie Details + followed users' reviews) =====
        // Opened by clicking a poster in the "Recs" list. Flow:
        //   - reviewers found → choice screen (Movie Details | User Reviews)
        //       User Reviews → list of followed users who rated it → their review
        //   - no reviewers (recommender hasn't watched it) → straight to Movie Details
        let recsViewMovie = null;        // prefill row (title/genre/mpa/runtime/imdb/etc.)
        let recsViewReviewers = [];      // [{ id, username, name, icon, row }]
        let recsViewPlatforms = [];      // streaming platforms (the old "Watch Options")
        let recsViewHasChoice = false;   // whether the choice screen applies
        let recsViewState = 'choice';    // choice | details | reviewers | review | watch

        async function openRecsMovieModal(movieId) {
            const mid = String(movieId || '').trim();
            if (!mid) return;
            recsViewMovie = listsMoviePrefillById.get(mid) || null;
            recsViewReviewers = [];

            // Candidates = people who recommended me this movie + people I follow.
            const recommenders = (recByDataByMovieId.get(mid) || []).map(r => String(r?.id || '').trim()).filter(Boolean);
            let followed = [];
            try { await loadMyFollowingIds(); followed = Array.from(feedFollowingIds || []); } catch (_) {}
            const myId = String(cachedAuthUser?.id || '').trim();
            const candidates = Array.from(new Set([...recommenders, ...followed]
                .map(x => String(x || '').trim()).filter(x => x && x !== myId)));

            // Which of them actually rated this movie?
            const rowByUser = new Map();
            if (candidates.length) {
                try {
                    const { data } = await supabaseClient
                        .from('Movie Ratings')
                        .select('user_id, overall_rating, tier, watch_date, fav_quote, notes, sound_rating, pacing_rating, imagery_rating, acting_rating, plot_rating, dialogue_rating')
                        .eq('movie_id', mid)
                        .in('user_id', candidates);
                    for (const row of (Array.isArray(data) ? data : [])) {
                        const uid = String(row?.user_id || '').trim();
                        if (uid) rowByUser.set(uid, row);
                    }
                } catch (_) {}
            }

            const reviewerIds = Array.from(rowByUser.keys());
            // User info: seed from the recommender cache, then fetch any missing.
            const infoById = new Map();
            for (const r of (recByDataByMovieId.get(mid) || [])) {
                const rid = String(r?.id || '').trim();
                if (rid) infoById.set(rid, { id: rid, username: String(r?.username || '').trim(), icon: String(r?.icon || '').trim() });
            }
            const missing = reviewerIds.filter(id => !infoById.has(id));
            if (missing.length) {
                try {
                    let us = null;
                    try {
                        const r1 = await supabaseClient.from('Users').select('id, username, display_name, icon').in('id', missing);
                        if (r1.error) throw r1.error; us = r1.data;
                    } catch (e1) {
                        if (/column\s+"?icon"?\s+does\s+not\s+exist/i.test(String(e1?.message || e1))) {
                            const r2 = await supabaseClient.from('Users').select('id, username, display_name').in('id', missing);
                            if (!r2.error) us = r2.data;
                        }
                    }
                    for (const u of (Array.isArray(us) ? us : [])) {
                        const uid = String(u?.id || '').trim();
                        if (uid) infoById.set(uid, { id: uid, username: String(u?.username || '').trim(), display_name: String(u?.display_name || '').trim(), icon: String(u?.icon || '').trim() });
                    }
                } catch (_) {}
            }

            recsViewReviewers = reviewerIds.map(uid => {
                const info = infoById.get(uid) || { id: uid };
                const username = String(info?.username || '').trim();
                const name = String(info?.display_name || '').trim() || (username ? `@${username}` : 'User');
                return { id: uid, username, name, icon: String(info?.icon || '').trim(), row: rowByUser.get(uid) };
            });
            // Streaming availability (the former standalone "Watch Options" button).
            recsViewPlatforms = listsPlatformsByMovieId.get(mid) || [];
            // Show the choice screen when there's more than just Movie Details to offer.
            recsViewHasChoice = recsViewReviewers.length > 0 || recsViewPlatforms.length > 0;

            const overlay = document.getElementById('recs-movie-overlay');
            if (!overlay) return;
            overlay.style.display = 'flex';
            overlay.classList.add('open');

            // Nothing extra → straight to Movie Details; otherwise the choice screen.
            if (recsViewHasChoice) recsMovieRenderChoice();
            else recsMovieRenderDetails();
        }

        function closeRecsMovieModal() {
            const overlay = document.getElementById('recs-movie-overlay');
            if (overlay) { overlay.style.display = 'none'; overlay.classList.remove('open'); }
        }

        function recsMovieBack() {
            // From a single-reviewer review there's no list to go back to → choice.
            if (recsViewState === 'review' && recsViewReviewers.length > 1) recsMovieRenderReviewers();
            else recsMovieRenderChoice();
        }

        // "User Reviews" → list of reviewers, or straight to the review if there's one.
        function recsMovieShowReviews() {
            if (recsViewReviewers.length === 1) recsMovieRenderReview(recsViewReviewers[0].id);
            else recsMovieRenderReviewers();
        }

        function recsMovieSetBody(html, { title = 'Recommended Movie', showBack = false } = {}) {
            const body = document.getElementById('recs-movie-body');
            const titleEl = document.getElementById('recs-movie-title');
            const backBtn = document.getElementById('recs-movie-back');
            if (titleEl) titleEl.textContent = title;
            if (backBtn) backBtn.style.display = showBack ? '' : 'none';
            if (body) body.innerHTML = html;
        }

        function recsMovieRenderChoice() {
            recsViewState = 'choice';
            const t = String(recsViewMovie?.title || 'this movie').trim();
            const reviewsBtn = recsViewReviewers.length ? `
                    <button type="button" class="btn btn-outline" onclick="recsMovieShowReviews()" style="border-radius:0.85rem; padding:0.85rem; text-align:left;">
                        <div class="text-white font-bold">User Reviews</div>
                        <div class="text-xs text-gray" style="margin-top:0.2rem;">${recsViewReviewers.length} ${recsViewReviewers.length === 1 ? 'review' : 'reviews'} from people you know.</div>
                    </button>` : '';
            const watchBtn = recsViewPlatforms.length ? `
                    <button type="button" class="btn btn-outline" onclick="recsMovieRenderWatchOptions()" style="border-radius:0.85rem; padding:0.85rem; text-align:left;">
                        <div class="text-white font-bold">Watch Options</div>
                        <div class="text-xs text-gray" style="margin-top:0.2rem;">Where to stream it (${recsViewPlatforms.length} ${recsViewPlatforms.length === 1 ? 'platform' : 'platforms'}).</div>
                    </button>` : '';
            recsMovieSetBody(`
                <div class="text-xs text-gray" style="margin-bottom:0.85rem;">What do you want to see for “${escapeHtml(t)}”?</div>
                <div style="display:flex; flex-direction:column; gap:10px;">
                    <button type="button" class="btn btn-outline" onclick="recsMovieRenderDetails()" style="border-radius:0.85rem; padding:0.85rem; text-align:left;">
                        <div class="text-white font-bold">Movie Details</div>
                        <div class="text-xs text-gray" style="margin-top:0.2rem;">Genre, MPA, runtime, year, director, IMDb.</div>
                    </button>
                    ${reviewsBtn}
                    ${watchBtn}
                </div>
            `, { title: 'Recommended Movie', showBack: false });
        }

        // "Watch Options" → the streaming platforms the movie is available on (moved here
        // from the old per-card "Watch Options" button).
        function recsMovieRenderWatchOptions() {
            recsViewState = 'watch';
            const platforms = Array.isArray(recsViewPlatforms) ? recsViewPlatforms : [];
            const body = platforms.length ? `
                <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px;">
                    ${platforms.map((p) => {
                        const full = normalizePlatformName(p);
                        const label = platformShortLabel(full) || full;
                        const theme = platformBrandTheme(full);
                        const pillStyle = `background: ${theme.bg}; border: 1px solid ${theme.border}; color: ${theme.text};`;
                        return `
                            <div style="display:flex; align-items:center; justify-content: center; padding: 0.7rem; border-radius: 0.85rem; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.10);">
                                <span style="display:inline-flex; align-items:center; padding: 0.28rem 0.6rem; border-radius: 999px; font-weight: 900; font-size: 0.88rem; line-height: 1; ${pillStyle}">${escapeHtml(label)}</span>
                            </div>
                        `;
                    }).join('')}
                </div>
            ` : `<div class="text-gray">No watch options found yet.</div>`;
            recsMovieSetBody(body, { title: 'Watch Options', showBack: recsViewHasChoice });
        }

        function recsMovieRenderDetails() {
            recsViewState = 'details';
            const m = recsViewMovie || {};
            const title = String(m?.title || 'Untitled').trim();
            const year = (m?.year ?? m?.release_year ?? '') === '' ? '' : String(m?.year ?? m?.release_year);
            const poster = (() => {
                const raw = String(m?.poster_path || m?.posterPath || '').trim();
                if (!raw) return '';
                if (/^https?:\/\//i.test(raw)) return raw;
                return `https://image.tmdb.org/t/p/w342${raw.startsWith('/') ? raw : `/${raw}`}`;
            })();
            const genre = normalizeMovieFieldValue(m?.genre);
            const mpa = normalizeMovieFieldValue(m?.mpa ?? m?.mpa_rating);
            const director = normalizeMovieFieldValue(m?.director);
            const runtimeVal = (() => { const n = Number(m?.runtime ?? m?.runtime_minutes); return (Number.isFinite(n) && n > 0) ? `${Math.round(n)} min` : ''; })();
            const imdbVal = (() => { const raw = (m?.imdb ?? m?.imdb_rating_pct ?? m?.imdb_pct ?? m?.imdb_rating); const n = parsePercentLike(raw, { imdb: true }); return (n !== null && n !== undefined) ? formatPctForDisplay(n) : ''; })();
            const rows = [
                ['Year', year], ['Genre', genre], ['MPA', mpa], ['Runtime', runtimeVal], ['Director', director], ['IMDb', imdbVal],
            ].filter(r => String(r[1] || '').trim());
            recsMovieSetBody(`
                <div style="display:flex; flex-direction:column; align-items:center; gap:12px;">
                    ${poster ? `<img src="${poster}" alt="${escapeHtml(title)}" style="width:140px; aspect-ratio:2/3; object-fit:cover; border-radius:12px; border:1px solid rgba(255,255,255,0.1);">` : ''}
                    <div style="text-align:center; color:#fff; font-weight:800; font-size:1.1rem;">${escapeHtml(title)}</div>
                </div>
                <div style="margin-top:12px; display:grid; gap:2px;">
                    ${rows.length ? rows.map(([k, v]) => `<div style="display:flex; justify-content:space-between; gap:12px; border-bottom:1px solid rgba(255,255,255,0.06); padding:0.45rem 0;"><span class="text-xs text-gray">${escapeHtml(k)}</span><span class="text-white" style="font-weight:600; text-align:right;">${escapeHtml(String(v))}</span></div>`).join('') : `<div class="text-xs text-gray">No details available.</div>`}
                </div>
            `, { title: 'Movie Details', showBack: recsViewHasChoice });
        }

        function recsMovieRenderReviewers() {
            if (!recsViewReviewers.length) { recsMovieRenderDetails(); return; }
            recsViewState = 'reviewers';
            const list = recsViewReviewers.map(rv => `
                <button type="button" onclick="recsMovieRenderReview('${escapeHtml(rv.id)}')" style="display:flex; align-items:center; gap:12px; width:100%; box-sizing:border-box; padding:10px 12px; border-radius:10px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); cursor:pointer; text-align:left;">
                    ${renderUserIconHtml(rv.icon, 34)}
                    <span style="flex:1 1 auto; min-width:0; color:#fff; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(rv.name)}</span>
                    <span class="text-xs text-gray" style="white-space:nowrap;">View review ›</span>
                </button>
            `).join('');
            recsMovieSetBody(`
                <div class="text-xs text-gray" style="margin-bottom:0.65rem;">${recsViewReviewers.length} ${recsViewReviewers.length === 1 ? 'person' : 'people'} you know rated this — tap to read:</div>
                <div style="display:flex; flex-direction:column; gap:8px;">${list}</div>
            `, { title: 'User Reviews', showBack: true });
        }

        function recsMovieRenderReview(userId) {
            recsViewState = 'review';
            const uid = String(userId || '').trim();
            const rv = recsViewReviewers.find(x => String(x.id) === uid) || null;
            const row = rv?.row || null;
            const movieTitle = String(recsViewMovie?.title || 'this movie').trim();
            if (!row) { recsMovieSetBody(`<div class="text-gray" style="padding:0.6rem;">No review found.</div>`, { title: 'Review', showBack: true }); return; }
            const overall = dashFormatScoreWhole(row?.overall_rating);
            const tierLabel = dashNormalizeTierLabel(row?.tier);
            const watched = String(row?.watch_date || '').trim();
            const quote = String(row?.fav_quote || '').trim();
            const notes = String(row?.notes || '').trim();
            const subs = [
                ['Sound', dashFormatScoreWhole(row?.sound_rating)],
                ['Pace', dashFormatScoreWhole(row?.pacing_rating)],
                ['Imagery', dashFormatScoreWhole(row?.imagery_rating)],
                ['Acting', dashFormatScoreWhole(row?.acting_rating)],
                ['Plot', dashFormatScoreWhole(row?.plot_rating)],
                ['Dialogue', dashFormatScoreWhole(row?.dialogue_rating)],
            ].filter(x => String(x[1] || '').trim());
            recsMovieSetBody(`
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:0.6rem;">
                    ${renderUserIconHtml(rv?.icon, 30)}
                    <div class="text-white" style="font-weight:800;">${escapeHtml(rv?.name || 'User')}</div>
                </div>
                ${(overall || tierLabel) ? `<div class="feed-metrics" style="margin-bottom:0.5rem;">${overall ? dashRenderHelpScore(overall) : ''}${tierLabel ? dashRenderHelpTier(tierLabel) : ''}</div>` : `<div class="text-xs text-gray">No rating recorded.</div>`}
                ${watched ? `<div class="text-xs" style="color:rgba(255,255,255,0.55); margin-bottom:0.5rem;">Watched: ${escapeHtml(watched)}</div>` : ''}
                ${subs.length ? `<div class="library-chip-row" style="margin-top:0.4rem;">${subs.map(([k, v]) => `<span class="dash-quote-pill">${escapeHtml(k)}: ${escapeHtml(v)}</span>`).join('')}</div>` : ''}
                ${quote ? `<div style="margin-top:0.75rem;"><div class="text-xs text-gray" style="margin-bottom:0.25rem;">Favorite Quote</div><div class="text-white" style="line-height:1.4;">${escapeHtml(quote)}</div></div>` : ''}
                ${notes ? `<div style="margin-top:0.75rem;"><div class="text-xs text-gray" style="margin-bottom:0.25rem;">Notes</div><div class="text-white" style="line-height:1.4; white-space:pre-wrap;">${escapeHtml(notes)}</div></div>` : ''}
            `, { title: `${rv?.name || 'Review'} · ${movieTitle}`, showBack: true });
        }

        async function loadRecRecipients() {
            const uid = String(recPendingMovie?.user_id || '').trim();
            recRecipientsCache = [];
            recSeenInfoByUserId = new Map();
            recAlreadyRecByUserId = new Set();
            if (!uid) return;

            const { data: f, error: fErr } = await supabaseClient
                .from('Follows').select('followed_id').eq('follower_id', uid);
            if (fErr) throw fErr;
            const ids = Array.from(new Set((Array.isArray(f) ? f : [])
                .map((r) => String(r?.followed_id || '').trim()).filter(Boolean)));
            if (ids.length === 0) return;

            let data = null;
            try {
                const r1 = await supabaseClient.from('Users').select('id, username, display_name, icon').in('id', ids);
                if (r1.error) throw r1.error; data = r1.data;
            } catch (e1) {
                if (/column\s+"?icon"?\s+does\s+not\s+exist/i.test(String(e1?.message || e1))) {
                    const r2 = await supabaseClient.from('Users').select('id, username, display_name').in('id', ids);
                    if (r2.error) throw r2.error; data = r2.data;
                } else { throw e1; }
            }
            recRecipientsCache = Array.isArray(data) ? data : [];

            // Best-effort: figure out which of these followers have already SEEN
            // (rated/reviewed) this movie, so we can grey them out and link to their
            // review. Resolve a read-only movie id first (don't create the movie here).
            try {
                let movieId = isUuidLike(recPendingMovie?.db_movie_id) ? String(recPendingMovie.db_movie_id).trim() : null;
                if (!movieId && Number.isFinite(Number(recPendingMovie?.tmdb_id)) && Number(recPendingMovie.tmdb_id) > 0) {
                    const mapped = await getDbMovieIdByTmdbId(Number(recPendingMovie.tmdb_id));
                    if (isUuidLike(mapped)) movieId = String(mapped).trim();
                }
                recPendingMovie.resolved_movie_id = movieId || null;

                if (movieId) {
                    const { data: ratings, error: rErr } = await supabaseClient
                        .from('Movie Ratings')
                        .select('user_id, overall_rating, tier, watch_date, fav_quote, notes, sound_rating, pacing_rating, imagery_rating, acting_rating, plot_rating, dialogue_rating')
                        .eq('movie_id', movieId)
                        .in('user_id', ids);
                    if (!rErr && Array.isArray(ratings)) {
                        for (const row of ratings) {
                            const ruid = String(row?.user_id || '').trim();
                            if (ruid) recSeenInfoByUserId.set(ruid, row);
                        }
                    }

                    // Recipients I've ALREADY recommended this movie to. The
                    // Recommendations row is cleared when they remove the movie from
                    // their Recs list (without watching), so a still-present row means
                    // the rec is pending → grey them out + block re-recommending.
                    const { data: myRecs, error: recErr } = await supabaseClient
                        .from('Recommendations')
                        .select('to_user_id')
                        .eq('from_user_id', uid)
                        .eq('movie_id', movieId)
                        .in('to_user_id', ids);
                    if (!recErr && Array.isArray(myRecs)) {
                        for (const row of myRecs) {
                            const ruid = String(row?.to_user_id || '').trim();
                            if (ruid) recAlreadyRecByUserId.add(ruid);
                        }
                    }
                }
            } catch (_) {
                // If the lookups fail, fall back to no grey-out (send-time still blocks).
            }
        }

        function renderRecModalList() {
            const list = document.getElementById('rec-modal-list');
            if (!list) return;
            const query = String(document.getElementById('rec-modal-search')?.value || '').trim().toLowerCase();

            if (recRecipientsCache.length === 0) {
                list.innerHTML = `<div class="text-gray" style="padding: 0.6rem;">You aren’t following anyone yet.</div>`;
                return;
            }
            const filtered = query
                ? recRecipientsCache.filter((u) => {
                    const uname = String(u?.username || '').toLowerCase();
                    const dname = String(u?.display_name || '').toLowerCase();
                    return uname.includes(query) || dname.includes(query);
                })
                : recRecipientsCache;

            if (filtered.length === 0) {
                list.innerHTML = `<div class="text-gray" style="padding: 0.6rem;">No matches for “${escapeHtml(query)}”.</div>`;
                return;
            }

            // Fully self-contained inline styles (no .feed-filter-* / global input
            // classes) so inherited CSS can't push the avatar/name off-screen: a
            // fixed-size checkbox + avatar on the left, name fills the rest.
            const rowStyle = 'display:flex; align-items:center; gap:12px; width:100%; box-sizing:border-box; padding:10px 12px; border-radius:10px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08);';
            const cbStyle = 'flex:0 0 auto; width:22px; height:22px; min-width:22px; margin:0; accent-color:var(--brand); cursor:pointer;';
            const nameWrap = 'flex:1 1 auto; min-width:0; display:flex; flex-direction:column; gap:2px; text-align:left;';
            const nameStyle = 'color:#fff; font-weight:700; font-size:0.92rem; line-height:1.2; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;';
            const subStyle = 'color:rgba(255,255,255,0.55); font-weight:600; font-size:0.78rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;';

            list.innerHTML = filtered.map((u) => {
                const id = String(u?.id || '').trim();
                const username = String(u?.username || '').trim();
                const name = String(u?.display_name || '').trim() || (username ? `@${username}` : 'User');
                const iconId = String(u?.icon || '').trim();

                // Already saw this movie → not selectable; link to their review instead.
                if (recSeenInfoByUserId.has(id)) {
                    recSelectedUserIds.delete(id);
                    return `
                        <div style="${rowStyle}">
                            <span style="flex:1 1 auto; min-width:0; display:flex; align-items:center; gap:10px; opacity:0.55;">
                                ${renderUserIconHtml(iconId, 34)}
                                <span style="${nameWrap}">
                                    <span style="${nameStyle}">${escapeHtml(name)}</span>
                                    <span style="${subStyle}">✓ Already seen this</span>
                                </span>
                            </span>
                            <button type="button" style="flex:0 0 auto; width:auto; padding:0.4rem 0.7rem; border-radius:0.7rem; font-size:0.78rem; font-weight:700; white-space:nowrap; color:#fff; background:color-mix(in srgb, var(--brand) 22%, transparent); border:1px solid color-mix(in srgb, var(--brand) 50%, transparent); cursor:pointer;" onclick="openRecReviewModal('${escapeHtml(id)}')">View review</button>
                        </div>
                    `;
                }

                // Already recommended by me (still pending in their Recs) → greyed out
                // + not selectable, just like the "already seen" state.
                if (recAlreadyRecByUserId.has(id)) {
                    recSelectedUserIds.delete(id);
                    return `
                        <div style="${rowStyle}">
                            <span style="flex:1 1 auto; min-width:0; display:flex; align-items:center; gap:10px; opacity:0.55;">
                                ${renderUserIconHtml(iconId, 34)}
                                <span style="${nameWrap}">
                                    <span style="${nameStyle}">${escapeHtml(name)}</span>
                                    <span style="${subStyle}">✓ Already recommended</span>
                                </span>
                            </span>
                        </div>
                    `;
                }

                const checked = recSelectedUserIds.has(id);
                return `
                    <label style="${rowStyle} cursor:pointer;">
                        <input type="checkbox" class="rec-user-cb" data-rec-user-id="${escapeHtml(id)}" style="${cbStyle}" ${checked ? 'checked' : ''}>
                        ${renderUserIconHtml(iconId, 34)}
                        <span style="${nameWrap}">
                            <span style="${nameStyle}">${escapeHtml(name)}</span>
                            ${username ? `<span style="${subStyle}">@${escapeHtml(username)}</span>` : ''}
                        </span>
                    </label>
                `;
            }).join('');
        }

        async function sendRecommendation() {
            if (recSending) return;
            if (!recPendingMovie) { showToast('No movie selected.', { level: 'warn' }); return; }

            const recipientIds = Array.from(recSelectedUserIds);
            if (recipientIds.length === 0) { showToast('Pick at least one person.', { level: 'warn' }); return; }

            const statusEl = document.getElementById('rec-modal-status');
            const sendBtn = document.getElementById('rec-modal-send');
            const setStatus = (s) => { if (statusEl) statusEl.textContent = String(s || ''); };

            recSending = true;
            if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Sending…'; }
            setStatus('Preparing movie…');

            try {
                const accessToken = String(recPendingMovie.accessToken || '').trim();

                const movieId = await ensureMovieFullySyncedForLists({
                    accessToken,
                    title: recPendingMovie.title,
                    release_year: recPendingMovie.year,
                    tmdb_id: recPendingMovie.tmdb_id,
                    movie_id: recPendingMovie.db_movie_id,
                });
                if (!isUuidLike(movieId)) throw new Error('Could not resolve the movie.');

                setStatus('Sending recommendation…');
                const res = await callSwiftApi({
                    action: 'send_recommendation',
                    movie_id: movieId,
                    recipient_ids: recipientIds,
                }, accessToken);

                const added = Number(res?.added || 0);
                const results = Array.isArray(res?.results) ? res.results : [];
                const movieTitle = String(recPendingMovie?.title || 'this movie').trim();

                const namesFor = (arr) => arr.map(b => {
                    const u = recRecipientsCache.find(x => String(x?.id) === String(b?.recipient));
                    const uname = String(u?.username || '').trim();
                    return uname ? `@${uname}` : 'that user';
                }).join(', ');

                // Recipients who have already SEEN (rated/logged) this movie.
                const seen = results.filter(r => r?.seen);
                if (seen.length) {
                    const names = namesFor(seen);
                    const verb = seen.length === 1 ? 'has' : 'have';
                    showToast(`${names} ${verb} already seen this movie`, { level: 'warn' });
                }

                // Recipients this sender had already recommended this movie to.
                const blocked = results.filter(r => r?.already);
                if (blocked.length) {
                    showToast(`You already recommended "${movieTitle}" to ${namesFor(blocked)}`, { level: 'warn' });
                }

                if (added > 0) {
                    showToast(`Recommended to ${added} ${added === 1 ? 'person' : 'people'}.`, { level: 'success' });
                    closeRecModal();
                } else if (seen.length || blocked.length) {
                    setStatus('Pick someone else.');
                } else {
                    setStatus('Nothing sent.');
                }
            } catch (err) {
                const msg = String(err?.message || err);
                setStatus(`Failed: ${msg}`);
                showToast(`Recommend failed: ${msg}`, { level: 'warn' });
            } finally {
                recSending = false;
                if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Send Rec'; }
            }
        }

        // Modal listing everyone who recommended a given movie (Recs list "+" button).
        function openRecByModal(movieId) {
            const recs = recByDataByMovieId.get(String(movieId || '')) || [];
            const overlay = document.getElementById('rec-by-overlay');
            const listEl = document.getElementById('rec-by-list');
            if (!overlay || !listEl) return;
            listEl.innerHTML = recs.length
                ? recs.map(u => `
                    <div class="feed-filter-user-row">
                        ${renderUserIconHtml(u.icon, 28)}
                        <div class="feed-filter-user-name">@${escapeHtml(u.username)}</div>
                    </div>
                `).join('')
                : `<div class="text-gray" style="padding:0.6rem;">No recommenders.</div>`;
            overlay.style.display = 'flex';
            overlay.classList.add('open');
        }

        function closeRecByModal() {
            const overlay = document.getElementById('rec-by-overlay');
            if (overlay) { overlay.style.display = 'none'; overlay.classList.remove('open'); }
        }

        function openListsCreateModal() {
            const overlay = document.getElementById('lists-create-overlay');
            if (!overlay) return;
            overlay.style.display = 'flex';

            const statusEl = document.getElementById('lists-create-status');
            if (statusEl) statusEl.textContent = '';
            const input = document.getElementById('lists-create-name');
            if (input) {
                input.value = '';
                try { input.focus(); } catch (_) {}
            }
            // Reset shared-list state.
            listsCreateShared = false;
            listsCreateSelectedMemberIds = new Set();
            const sharedCb = document.getElementById('lists-create-shared');
            if (sharedCb) sharedCb.checked = false;
            const wrap = document.getElementById('lists-create-members-wrap');
            if (wrap) wrap.style.display = 'none';
            const search = document.getElementById('lists-create-members-search');
            if (search) search.value = '';
            listsCreateBusy = false;
        }

        function closeListsCreateModal() {
            const overlay = document.getElementById('lists-create-overlay');
            if (!overlay) return;
            overlay.style.display = 'none';
            const statusEl = document.getElementById('lists-create-status');
            if (statusEl) statusEl.textContent = '';
            const input = document.getElementById('lists-create-name');
            if (input) input.value = '';
            listsCreateBusy = false;
        }

        // --- Shared-list member picker (Create modal) --------------------------
        // Load the people the current user follows (reused by the Create + Edit
        // member pickers). Cached per user.
        async function loadListsFollows({ user_id, force = false } = {}) {
            const uid = String(user_id || '').trim();
            if (!uid) return [];
            if (!force && listsFollowsCacheUserId === uid && listsFollowsCache.length) return listsFollowsCache;

            const { data: f } = await supabaseClient
                .from('Follows').select('followed_id').eq('follower_id', uid);
            const ids = Array.from(new Set((Array.isArray(f) ? f : [])
                .map(r => String(r?.followed_id || '').trim()).filter(Boolean)));
            if (!ids.length) { listsFollowsCache = []; listsFollowsCacheUserId = uid; return []; }

            let data = null;
            try {
                const r1 = await supabaseClient.from('Users').select('id, username, display_name, icon').in('id', ids);
                if (r1.error) throw r1.error; data = r1.data;
            } catch (e1) {
                if (/column\s+"?icon"?\s+does\s+not\s+exist/i.test(String(e1?.message || e1))) {
                    const r2 = await supabaseClient.from('Users').select('id, username, display_name').in('id', ids);
                    data = r2.data;
                }
            }
            listsFollowsCache = Array.isArray(data) ? data : [];
            listsFollowsCacheUserId = uid;
            return listsFollowsCache;
        }

        async function toggleListsCreateShared() {
            const cb = document.getElementById('lists-create-shared');
            const wrap = document.getElementById('lists-create-members-wrap');
            listsCreateShared = Boolean(cb?.checked);
            if (wrap) wrap.style.display = listsCreateShared ? '' : 'none';
            if (listsCreateShared) {
                try {
                    const { user } = await requireAuthOrThrow();
                    await loadListsFollows({ user_id: user.id });
                } catch (_) {}
                renderListsCreateMembers();
            }
        }

        // Generic member-row renderer (a checkbox/avatar/name row), shared by the
        // Create picker and the Edit "add member" picker.
        function renderMemberPickRow(u, { checked, onchangeFn }) {
            const id = String(u?.id || '').trim();
            const username = String(u?.username || '').trim();
            const name = String(u?.display_name || '').trim() || (username ? `@${username}` : 'User');
            const sub = username ? `@${username}` : '';
            const rowStyle = 'display:flex; align-items:center; gap:12px; width:100%; box-sizing:border-box; padding:10px 12px; border-radius:10px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); cursor:pointer;';
            const cbStyle = 'flex:0 0 auto; width:22px; height:22px; min-width:22px; margin:0; accent-color:var(--brand); cursor:pointer;';
            return `
                <label style="${rowStyle}">
                    <input type="checkbox" ${checked ? 'checked' : ''} style="${cbStyle}" onchange="${onchangeFn}('${escapeHtml(id)}', this.checked)">
                    ${renderUserIconHtml(String(u?.icon || ''), 34)}
                    <span style="flex:1 1 auto; min-width:0; display:flex; flex-direction:column; gap:2px; text-align:left;">
                        <span style="color:#fff; font-weight:700; font-size:0.92rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(name)}</span>
                        ${sub ? `<span style="color:rgba(255,255,255,0.55); font-weight:600; font-size:0.78rem;">${escapeHtml(sub)}</span>` : ''}
                    </span>
                </label>`;
        }

        function renderListsCreateMembers() {
            const list = document.getElementById('lists-create-members-list');
            if (!list) return;
            const query = String(document.getElementById('lists-create-members-search')?.value || '').trim().toLowerCase();
            if (!listsFollowsCache.length) {
                list.innerHTML = `<div class="text-gray" style="padding:0.5rem;">You aren’t following anyone yet — follow people from the Feed to share lists with them.</div>`;
                return;
            }
            const filtered = query
                ? listsFollowsCache.filter(u => (String(u?.username || '') + ' ' + String(u?.display_name || '')).toLowerCase().includes(query))
                : listsFollowsCache;
            if (!filtered.length) { list.innerHTML = `<div class="text-gray" style="padding:0.5rem;">No matches for “${escapeHtml(query)}”.</div>`; return; }
            list.innerHTML = filtered.map(u =>
                renderMemberPickRow(u, { checked: listsCreateSelectedMemberIds.has(String(u.id)), onchangeFn: 'toggleListsCreateMember' })
            ).join('');
        }

        function toggleListsCreateMember(id, checked) {
            const uid = String(id || '').trim();
            if (!uid) return;
            if (checked) listsCreateSelectedMemberIds.add(uid);
            else listsCreateSelectedMemberIds.delete(uid);
        }

        // Insert (or upsert) membership rows for a shared list.
        async function addListMembers({ list_id, owner_id, member_ids }) {
            const lid = String(list_id || '').trim();
            const ids = Array.from(new Set((Array.isArray(member_ids) ? member_ids : [])
                .map(x => String(x || '').trim()).filter(x => x && x !== String(owner_id || '').trim())));
            if (!lid || !ids.length) return;
            const rows = ids.map(uid => ({ list_id: lid, user_id: uid, added_by: String(owner_id || '').trim() || null, role: 'editor' }));
            const { error } = await supabaseClient
                .from('List Members')
                .upsert(rows, { onConflict: 'list_id,user_id' });
            if (error) throw error;
        }

        function openListsRenameModal() {
            const lid = String(listsActiveListId || '').trim();
            if (!lid) {
                showToast('Select a list first.', { level: 'warn' });
                return;
            }
            if (isBucketList({ list_id: lid, list_name: listsActiveListName })) {
                showToast('Bucket List can’t be renamed.', { level: 'warn' });
                return;
            }

            const overlay = document.getElementById('lists-rename-overlay');
            if (!overlay) return;
            overlay.style.display = 'flex';

            const statusEl = document.getElementById('lists-rename-status');
            if (statusEl) statusEl.textContent = '';
            const input = document.getElementById('lists-rename-name');
            if (input) {
                input.value = String(listsActiveListName || '').trim();
                try { input.focus(); input.select?.(); } catch (_) {}
            }
            listsRenameBusy = false;
        }

        function closeListsRenameModal() {
            const overlay = document.getElementById('lists-rename-overlay');
            if (!overlay) return;
            overlay.style.display = 'none';
            const statusEl = document.getElementById('lists-rename-status');
            if (statusEl) statusEl.textContent = '';
            const input = document.getElementById('lists-rename-name');
            if (input) input.value = '';
            listsRenameBusy = false;
        }

        // Auto-managed lists (Bucket List + Recs) can't be renamed or deleted — only
        // their cover photo is editable. (Renaming would break the name-based lookups.)
        function isSpecialAutoList(list_id, list_name) {
            const n = String(list_name || '').trim().toLowerCase();
            return isBucketList({ list_id, list_name }) || n === 'recs';
        }

        // --- Shared (group) list helpers ---------------------------------------
        // A list's row in cachedLists (tagged with owner_id/shared/is_owner by
        // loadUserLists). Movie Lists rows for a shared list always carry the
        // OWNER's user_id, so reads key on the owner, not the viewer.
        function getCachedListRow(list_id) {
            const lid = String(list_id || '').trim();
            return (cachedLists || []).find(l => String(l?.id) === lid) || null;
        }
        function isSharedList(list_id) {
            return Boolean(getCachedListRow(list_id)?.shared);
        }
        // Whose user_id keys the Movie Lists rows / view query for this list.
        function listOwnerId(list_id, fallbackUserId) {
            const owner = String(getCachedListRow(list_id)?.owner_id || '').trim();
            return owner || String(fallbackUserId || '').trim();
        }

        // The "Edit" button on a list → the combined edit modal: change cover photo
        // (all lists) + rename + delete (non-special lists only).
        function openListsEditModal() {
            const lid = String(listsActiveListId || '').trim();
            if (!lid) { showToast('Select a list first.', { level: 'warn' }); return; }
            const overlay = document.getElementById('lists-rename-overlay');
            if (!overlay) return;

            const special = isSpecialAutoList(lid, listsActiveListName);
            const renameSec = document.getElementById('lists-edit-rename-section');
            const deleteSec = document.getElementById('lists-edit-delete-section');
            if (renameSec) renameSec.style.display = special ? 'none' : '';
            if (deleteSec) deleteSec.style.display = special ? 'none' : '';

            // Recs / Bucket List use a fixed branded cover — no upload control.
            const coverUploadBtn = document.getElementById('lists-edit-cover-upload');
            if (coverUploadBtn) coverUploadBtn.style.display = special ? 'none' : '';

            const titleEl = document.getElementById('lists-rename-title');
            if (titleEl) titleEl.textContent = listsActiveListName ? `Edit “${listsActiveListName}”` : 'Edit List';

            const statusEl = document.getElementById('lists-rename-status');
            if (statusEl) statusEl.textContent = '';
            const input = document.getElementById('lists-rename-name');
            if (input) input.value = String(listsActiveListName || '').trim();

            // Members section — shown only for shared lists. Reset the add picker.
            const membersSec = document.getElementById('lists-edit-members-section');
            const shared = isSharedList(lid);
            if (membersSec) membersSec.style.display = shared ? '' : 'none';
            listsEditAddMode = false;
            const addWrap = document.getElementById('lists-edit-add-member-wrap');
            if (addWrap) addWrap.style.display = 'none';
            const addBtn = document.getElementById('lists-edit-add-member-btn');
            if (addBtn) addBtn.textContent = 'Add member';
            if (shared) loadListsEditMembers(lid).catch(() => null);

            refreshListsEditCoverPreview();
            overlay.style.display = 'flex';
            listsRenameBusy = false;
        }

        // --- Edit-modal member management (shared lists) -----------------------
        async function loadListsEditMembers(list_id) {
            const lid = String(list_id || '').trim();
            const listEl = document.getElementById('lists-edit-members-list');
            if (!lid || !listEl) return;
            listEl.innerHTML = `<div class="text-gray" style="padding:0.4rem;">Loading members…</div>`;
            try {
                const ownerId = listOwnerId(lid, '');
                const { data: memRows } = await supabaseClient
                    .from('List Members').select('user_id, added_by').eq('list_id', lid);
                const memberIds = (Array.isArray(memRows) ? memRows : [])
                    .map(r => String(r?.user_id || '').trim()).filter(Boolean);
                // The owner is an implicit member (not stored in List Members).
                const allIds = Array.from(new Set([ownerId, ...memberIds].filter(Boolean)));

                let users = [];
                if (allIds.length) {
                    let data = null;
                    try {
                        const r1 = await supabaseClient.from('Users').select('id, username, display_name, icon').in('id', allIds);
                        if (r1.error) throw r1.error; data = r1.data;
                    } catch (e1) {
                        const r2 = await supabaseClient.from('Users').select('id, username, display_name').in('id', allIds);
                        data = r2.data;
                    }
                    users = Array.isArray(data) ? data : [];
                }
                // Owner first.
                users.sort((a, b) => (String(a.id) === ownerId ? -1 : String(b.id) === ownerId ? 1 : 0));
                listsEditMembers = users;
                renderListsEditMembers(ownerId);
            } catch (err) {
                listEl.innerHTML = `<div class="text-gray" style="padding:0.4rem;">Couldn’t load members.</div>`;
            }
        }

        function renderListsEditMembers(ownerId) {
            const listEl = document.getElementById('lists-edit-members-list');
            if (!listEl) return;
            const owner = String(ownerId || listOwnerId(listsActiveListId, '') || '').trim();
            if (!listsEditMembers.length) { listEl.innerHTML = `<div class="text-gray" style="padding:0.4rem;">No members yet.</div>`; return; }
            const rowStyle = 'display:flex; align-items:center; gap:12px; width:100%; box-sizing:border-box; padding:9px 12px; border-radius:10px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08);';
            listEl.innerHTML = listsEditMembers.map(u => {
                const id = String(u?.id || '').trim();
                const username = String(u?.username || '').trim();
                const name = String(u?.display_name || '').trim() || (username ? `@${username}` : 'User');
                const isOwner = id === owner;
                const removeBtn = isOwner
                    ? `<span style="flex:0 0 auto; color:rgba(255,255,255,0.45); font-size:0.72rem; font-weight:700; text-transform:uppercase;">Owner</span>`
                    : `<button type="button" class="btn btn-outline" style="flex:0 0 auto; width:auto; border-radius:0.6rem; padding:0.3rem 0.7rem; font-size:0.78rem; border-color:rgba(239,68,68,0.5); background:#3a1a1d;" onclick="removeListMember('${escapeHtml(id)}')">Remove</button>`;
                return `
                    <div style="${rowStyle}">
                        ${renderUserIconHtml(String(u?.icon || ''), 32)}
                        <span style="flex:1 1 auto; min-width:0; display:flex; flex-direction:column; gap:1px; text-align:left;">
                            <span style="color:#fff; font-weight:700; font-size:0.9rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(name)}</span>
                            ${username ? `<span style="color:rgba(255,255,255,0.55); font-weight:600; font-size:0.76rem;">@${escapeHtml(username)}</span>` : ''}
                        </span>
                        ${removeBtn}
                    </div>`;
            }).join('');
        }

        async function removeListMember(userId) {
            const lid = String(listsActiveListId || '').trim();
            const uid = String(userId || '').trim();
            if (!lid || !uid) return;
            if (uid === listOwnerId(lid, '')) { showToast('The owner can’t be removed.', { level: 'warn' }); return; }
            try {
                const { error } = await supabaseClient
                    .from('List Members').delete().eq('list_id', lid).eq('user_id', uid);
                if (error) throw error;
                listsEditMembers = listsEditMembers.filter(u => String(u.id) !== uid);
                renderListsEditMembers();
                cachedListsUserId = null;
                showToast('Member removed.', { level: 'success' });
            } catch (err) {
                showToast(`Couldn’t remove member: ${String(err?.message || err)}`, { level: 'warn' });
            }
        }

        async function toggleListsEditAddMode() {
            listsEditAddMode = !listsEditAddMode;
            const wrap = document.getElementById('lists-edit-add-member-wrap');
            const btn = document.getElementById('lists-edit-add-member-btn');
            if (wrap) wrap.style.display = listsEditAddMode ? '' : 'none';
            if (btn) btn.textContent = listsEditAddMode ? 'Done' : 'Add member';
            if (listsEditAddMode) {
                try {
                    const { user } = await requireAuthOrThrow();
                    await loadListsFollows({ user_id: user.id });
                } catch (_) {}
                renderListsEditAddPicker();
            }
        }

        function renderListsEditAddPicker() {
            const listEl = document.getElementById('lists-edit-add-member-list');
            if (!listEl) return;
            const existing = new Set(listsEditMembers.map(u => String(u.id)));
            const query = String(document.getElementById('lists-edit-members-search')?.value || '').trim().toLowerCase();
            let candidates = listsFollowsCache.filter(u => !existing.has(String(u.id)));
            if (query) candidates = candidates.filter(u => (String(u?.username || '') + ' ' + String(u?.display_name || '')).toLowerCase().includes(query));
            if (!listsFollowsCache.length) { listEl.innerHTML = `<div class="text-gray" style="padding:0.5rem;">You aren’t following anyone yet.</div>`; return; }
            if (!candidates.length) { listEl.innerHTML = `<div class="text-gray" style="padding:0.5rem;">Everyone you follow is already a member.</div>`; return; }
            listEl.innerHTML = candidates.map(u =>
                renderMemberPickRow(u, { checked: false, onchangeFn: 'addListMemberFromPicker' })
            ).join('');
        }

        async function addListMemberFromPicker(userId) {
            const lid = String(listsActiveListId || '').trim();
            const uid = String(userId || '').trim();
            if (!lid || !uid) return;
            try {
                const { user } = await requireAuthOrThrow();
                await addListMembers({ list_id: lid, owner_id: listOwnerId(lid, user.id), member_ids: [uid] });
                cachedListsUserId = null;
                await loadListsEditMembers(lid);
                renderListsEditAddPicker();
                showToast('Member added.', { level: 'success' });
            } catch (err) {
                showToast(`Couldn’t add member: ${String(err?.message || err)}`, { level: 'warn' });
            }
        }

        // --- Shared-list movie reviews popup -----------------------------------
        // Tapping a poster on a SHARED list opens this: a list of the members who
        // have reviewed the movie. Pick one to read their full diary entry (only
        // reviews that actually exist are shown). Mirrors the per-member model the
        // user designed: a member with no review for the movie simply isn't listed.
        async function openSharedListMovieModal(movieId) {
            const mid = String(movieId || '').trim();
            const lid = String(listsActiveListId || '').trim();
            if (!mid || !lid) return;
            if (!supabaseClient || !cachedIsAuthed) { openAuthModal(); return; }

            const overlay = document.getElementById('shared-movie-overlay');
            const titleEl = document.getElementById('shared-movie-title');
            const body = document.getElementById('shared-movie-body');
            if (!overlay || !body) return;
            body.innerHTML = `<div class="text-gray" style="padding:1rem;">Loading…</div>`;
            overlay.style.display = 'flex';
            overlay.style.zIndex = '200';
            overlay.classList.add('open');

            try {
                const { user } = await requireAuthOrThrow();
                const meId = String(user.id);
                const ownerId = listOwnerId(lid, meId);

                // Members = the owner + everyone in List Members.
                const { data: memRows } = await supabaseClient
                    .from('List Members').select('user_id').eq('list_id', lid);
                const memberIds = Array.from(new Set([
                    ownerId,
                    ...((Array.isArray(memRows) ? memRows : []).map(r => String(r?.user_id || '').trim())),
                ].filter(Boolean)));

                // Names + icons.
                const usersById = new Map();
                if (memberIds.length) {
                    let data = null;
                    try {
                        const r1 = await supabaseClient.from('Users').select('id, username, display_name, icon').in('id', memberIds);
                        if (r1.error) throw r1.error; data = r1.data;
                    } catch (e1) {
                        const r2 = await supabaseClient.from('Users').select('id, username, display_name').in('id', memberIds);
                        data = r2.data;
                    }
                    for (const u of (Array.isArray(data) ? data : [])) usersById.set(String(u.id), u);
                }

                // Which members have a review of this movie (+ their overall/tier).
                const { data: viewRows } = await supabaseClient
                    .from(LIBRARY_ITEMS_VIEW)
                    .select('user_id, overall_rating, tier, title, release_year')
                    .eq('movie_id', mid)
                    .in('user_id', memberIds);
                const reviews = (Array.isArray(viewRows) ? viewRows : [])
                    .filter(r => r?.overall_rating !== null && r?.overall_rating !== undefined);

                // Title (from any review row, else the cached list prefill).
                const titleRow = reviews[0] || null;
                let movieTitle = String(titleRow?.title || '').trim();
                const movieYear = (titleRow?.release_year ?? '') === '' ? '' : String(titleRow.release_year);
                if (!movieTitle) movieTitle = String(listsMoviePrefillById?.get(mid)?.title || 'Movie').trim();
                if (titleEl) titleEl.textContent = movieTitle + (movieYear ? ` (${movieYear})` : '');

                if (!reviews.length) {
                    body.innerHTML = `<div class="text-gray" style="padding:1rem;">No one in this list has reviewed this movie yet.</div>`;
                    return;
                }

                // Sort: me first (labeled "You"), then by overall desc.
                reviews.sort((a, b) => {
                    const am = String(a.user_id) === meId, bm = String(b.user_id) === meId;
                    if (am !== bm) return am ? -1 : 1;
                    return (Number(b.overall_rating) || 0) - (Number(a.overall_rating) || 0);
                });

                const rowStyle = 'display:flex; align-items:center; gap:12px; width:100%; box-sizing:border-box; padding:11px 12px; border-radius:12px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.09); cursor:pointer; text-align:left;';
                body.innerHTML = `<div style="color:rgba(255,255,255,0.6); font-weight:600; font-size:0.84rem; margin-bottom:0.6rem;">Tap a member to read their review:</div>`
                    + `<div style="display:grid; gap:8px;">` + reviews.map(r => {
                        const uid = String(r.user_id);
                        const u = usersById.get(uid) || {};
                        const username = String(u.username || '').trim();
                        const isMe = uid === meId;
                        const name = isMe ? 'You' : (String(u.display_name || '').trim() || (username ? `@${username}` : 'User'));
                        const scoreText = dashFormatScore(r.overall_rating);
                        const tier = dashNormalizeTierLabel(r.tier);
                        const meta = dashJoinHelpParts([
                            scoreText ? `${dashRenderHelpScore(scoreText)} Overall` : '',
                            tier ? dashRenderHelpTier(tier) : '',
                        ]);
                        return `
                            <button type="button" style="${rowStyle}" onclick="openProfileMovieReview('${escapeHtml(uid)}','${escapeHtml(mid)}')">
                                ${renderUserIconHtml(String(u.icon || ''), 38)}
                                <span style="flex:1 1 auto; min-width:0; display:flex; flex-direction:column; gap:3px;">
                                    <span style="color:#fff; font-weight:700; font-size:0.94rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(name)}${isMe && username ? ` <span style="color:rgba(255,255,255,0.45); font-weight:600;">@${escapeHtml(username)}</span>` : ''}</span>
                                    <span style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">${meta}</span>
                                </span>
                                <span style="flex:0 0 auto; color:rgba(255,255,255,0.4); font-size:1.3rem; line-height:1;">›</span>
                            </button>`;
                    }).join('') + `</div>`;
            } catch (err) {
                body.innerHTML = `<div class="text-gray" style="padding:1rem;">Could not load reviews: ${escapeHtml(String(err?.message || err))}</div>`;
            }
        }

        function closeSharedListMovieModal() {
            const overlay = document.getElementById('shared-movie-overlay');
            if (!overlay) return;
            overlay.style.display = 'none';
            overlay.classList.remove('open');
        }

        // Render the current cover (or a placeholder) inside the Edit modal.
        function refreshListsEditCoverPreview() {
            const lid = String(listsActiveListId || '').trim();
            const row = (cachedLists || []).find(l => String(l.id) === lid);
            const special = isSpecialAutoList(lid, row?.list_name || listsActiveListName);
            const cover = String(row?.cover || '').trim();
            const prev = document.getElementById('lists-edit-cover-preview');
            const removeBtn = document.getElementById('lists-edit-remove-cover');
            if (prev) {
                prev.innerHTML = cover
                    ? `<img src="${escapeHtml(cover)}" alt="Cover">`
                    : `<span class="lists-edit-cover-empty">${icons.film}</span>`;
            }
            // The auto-managed lists keep their branded cover — can't be removed.
            if (removeBtn) removeBtn.style.display = (!special && cover) ? '' : 'none';
        }

        async function removeListCover() {
            const lid = String(listsActiveListId || '').trim();
            if (!lid) return;
            if (guardGuestWrite()) return;
            try {
                const { user } = await requireAuthOrThrow();
                const { error } = await supabaseClient
                    .from('Lists')
                    .update({ cover: null })
                    .eq('id', lid)
                    .eq('user_id', listOwnerId(lid, user.id));
                if (error) throw error;
                const row = (cachedLists || []).find(l => String(l.id) === lid);
                if (row) row.cover = null;
                refreshListsEditCoverPreview();
                loadListsOverview().catch(() => null);
                showToast('Cover removed.', { level: 'success' });
            } catch (err) {
                showToast(`Couldn’t remove cover: ${err?.message || err}`, { level: 'error' });
            }
        }

        // Delete from inside the Edit modal → swap to the existing delete-confirm modal.
        function openListsDeleteFromEdit() {
            closeListsRenameModal();
            openListsDeleteModal();
        }

        // The single "Save" button on the Edit modal: save the (possibly changed) name
        // for normal lists — the rename form handler saves + closes (and just closes if
        // the name is unchanged). Cover changes already persist on pick. Special lists
        // (no name field) just close.
        function submitListsEditModal() {
            const lid = String(listsActiveListId || '').trim();
            const form = document.getElementById('lists-rename-form');
            if (lid && form && !isSpecialAutoList(lid, listsActiveListName)) {
                if (typeof form.requestSubmit === 'function') form.requestSubmit();
                else form.dispatchEvent(new Event('submit', { cancelable: true }));
                return;
            }
            closeListsRenameModal();
        }

        function openListsDeleteModal() {
            const lid = String(listsActiveListId || '').trim();
            if (!lid) {
                showToast('Select a list first.', { level: 'warn' });
                return;
            }
            if (isSpecialAutoList(lid, listsActiveListName)) {
                showToast('This list can’t be deleted.', { level: 'warn' });
                return;
            }

            const overlay = document.getElementById('lists-delete-overlay');
            if (!overlay) return;
            overlay.style.display = 'flex';

            const statusEl = document.getElementById('lists-delete-status');
            if (statusEl) statusEl.textContent = '';
            const nameEl = document.getElementById('lists-delete-name');
            if (nameEl) nameEl.textContent = `“${String(listsActiveListName || 'this list').trim() || 'this list'}”`;
            listsDeleteBusy = false;
        }

        function closeListsDeleteModal() {
            const overlay = document.getElementById('lists-delete-overlay');
            if (!overlay) return;
            overlay.style.display = 'none';
            const statusEl = document.getElementById('lists-delete-status');
            if (statusEl) statusEl.textContent = '';
            const nameEl = document.getElementById('lists-delete-name');
            if (nameEl) nameEl.textContent = '';
            listsDeleteBusy = false;
        }

        function hexToRgba(hex, alpha) {
            const h = String(hex || '').trim().replace('#', '');
            if (!/^[0-9a-f]{6}$/i.test(h)) return `rgba(255,255,255,${Number(alpha) || 0.15})`;
            const r = parseInt(h.slice(0, 2), 16);
            const g = parseInt(h.slice(2, 4), 16);
            const b = parseInt(h.slice(4, 6), 16);
            const a = Math.max(0, Math.min(1, Number(alpha)));
            return `rgba(${r},${g},${b},${a})`;
        }

        function platformBrandTheme(platformName) {
            const raw = normalizePlatformName(platformName);
            const n = raw.toLowerCase();

            // Defaults (neutral).
            let bg = 'rgba(255,255,255,0.06)';
            let border = 'rgba(255,255,255,0.14)';
            let text = 'rgba(255,255,255,0.92)';

            const solid = (hex) => {
                bg = hexToRgba(hex, 0.18);
                border = hexToRgba(hex, 0.55);
                text = '#fff';
            };

            if (n.includes('netflix')) {
                solid('#E50914');
            } else if (n.includes('prime video') || (n.includes('amazon') && n.includes('prime'))) {
                solid('#00A8E1');
            } else if (n === 'amazon video' || (n.includes('amazon') && !n.includes('prime'))) {
                solid('#FF9900');
            } else if (n.includes('disney')) {
                bg = 'linear-gradient(90deg, rgba(17,60,207,0.30), rgba(0,209,255,0.22))';
                border = 'rgba(0,209,255,0.55)';
                text = '#fff';
            } else if (n === 'max' || n.includes('hbo') || n.includes('hbo max')) {
                solid('#7D2AE8');
            } else if (n.includes('hulu')) {
                solid('#1CE783');
            } else if (n.includes('apple tv') || n === 'apple tv+' || n.includes('itunes')) {
                bg = 'rgba(255,255,255,0.10)';
                border = 'rgba(255,255,255,0.35)';
                text = '#fff';
            } else if (n.includes('paramount')) {
                solid('#0064FF');
            } else if (n.includes('peacock')) {
                solid('#00A7E1');
            } else if (n.includes('crunchyroll')) {
                solid('#F47521');
            } else if (n.includes('tubi')) {
                solid('#FF1D5E');
            } else if (n.includes('pluto')) {
                bg = 'rgba(255, 236, 0, 0.18)';
                border = 'rgba(255, 236, 0, 0.55)';
                text = 'rgba(255,255,255,0.95)';
            } else if (n.includes('youtube')) {
                solid('#FF0000');
            } else if (n.includes('google play') || (n.includes('google') && n.includes('play'))) {
                solid('#34A853');
            } else if (n.includes('vudu')) {
                solid('#0077C8');
            } else if (n.includes('plex')) {
                solid('#E5A00D');
            } else if (n.includes('mubi')) {
                bg = 'rgba(255,255,255,0.10)';
                border = 'rgba(255,255,255,0.28)';
                text = '#fff';
            }

            return { bg, border, text };
        }

        function openListsWatchOptionsModal({ movie_id, title } = {}) {
            const mid = String(movie_id || '').trim();
            if (!mid) return;

            const overlay = document.getElementById('lists-watch-options-overlay');
            if (!overlay) return;
            overlay.style.display = 'flex';

            const movieEl = document.getElementById('lists-watch-options-movie');
            if (movieEl) {
                const t = String(title || '').trim();
                movieEl.textContent = t ? `Movie: ${t}` : 'Movie';
            }

            const bodyEl = document.getElementById('lists-watch-options-body');
            if (!bodyEl) return;

            const platforms = listsPlatformsByMovieId.get(mid) || [];
            if (!platforms.length) {
                bodyEl.innerHTML = `<div class="text-gray">No watch options found yet.</div>`;
                return;
            }

            bodyEl.innerHTML = `
                <div class="text-white font-bold" style="margin-bottom: 0.55rem;">Available on</div>
                <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px;">
                    ${platforms.map((p) => {
                        const full = normalizePlatformName(p);
                        const label = platformShortLabel(full) || full;
                        const theme = platformBrandTheme(full);
                        const pillStyle = `background: ${theme.bg}; border: 1px solid ${theme.border}; color: ${theme.text};`;

                        return `
                            <div style="display:flex; align-items:center; justify-content: center; padding: 0.7rem; border-radius: 0.85rem; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.10);">
                                <span style="display:inline-flex; align-items:center; padding: 0.28rem 0.6rem; border-radius: 999px; font-weight: 900; font-size: 0.88rem; line-height: 1; ${pillStyle}">${escapeHtml(label)}</span>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        }

        function closeListsWatchOptionsModal() {
            const overlay = document.getElementById('lists-watch-options-overlay');
            if (!overlay) return;
            overlay.style.display = 'none';
            const movieEl = document.getElementById('lists-watch-options-movie');
            if (movieEl) movieEl.textContent = '';
            const bodyEl = document.getElementById('lists-watch-options-body');
            if (bodyEl) bodyEl.innerHTML = `<div class="text-gray">Loading…</div>`;
        }

        function setListsActiveListActionsEnabledState() {
            const filterBtn = document.getElementById('lists-filter-btn');
            const sortBtn = document.getElementById('lists-sort-btn');
            const editBtn = document.getElementById('lists-edit-btn');
            const lid = String(listsActiveListId || '').trim();

            // Filter / Sort / Edit all work for every list (Edit = cover for special
            // lists, full rename/delete for the rest — gated inside the Edit modal).
            const ready = Boolean(lid) && !listsLoading;
            if (sortBtn) sortBtn.disabled = !ready;
            if (editBtn) editBtn.disabled = !Boolean(lid);

            const filtersEnabled = Boolean(lid) && !listsLoading;
            if (filterBtn) filterBtn.disabled = !filtersEnabled;

            if (filterBtn) {
                ensureListsSortFilterStateInitialized();
                const labels = {
                    sortKey: {
                        rec_added: 'Recommended (newest)',
                        watch_date: 'Watch Date',
                        watch_count: 'Watch Count',
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
                    state: listsSortFilterState,
                    defaults: getDefaultListsSortFilterStateForActiveList(),
                    labels,
                });

                filterBtn.title = model?.summaryText || '';
                // Light up Filter when a FILTER is active, Sort when SORT is non-default.
                const def = getDefaultListsSortFilterStateForActiveList();
                const st = listsSortFilterState || {};
                // Normalize watchOptions to its EFFECTIVE value (empty when none OR all
                // selected) so "Select all" reads the same as default (not an active filter).
                const stNorm = { ...st, watchOptions: listsEffectiveWatchOptions(st) };
                const sortActive = String(st.sortKey ?? '') !== String(def.sortKey ?? '')
                    || String(st.sortDir ?? '') !== String(def.sortDir ?? '');
                const filterActive = Object.keys({ ...def, ...stNorm }).some(k =>
                    k !== 'sortKey' && k !== 'sortDir' && String(stNorm[k] ?? '') !== String(def[k] ?? ''));
                filterBtn.classList.toggle('filter-active', filterActive);
                const sortBtnEl = document.getElementById('lists-sort-btn');
                if (sortBtnEl) sortBtnEl.classList.toggle('filter-active', sortActive);
            }
        }

        let listsSortFilterState = null;
        let listsSortFilterDraft = null;
        let listsFacetOptions = { decades: [], mpas: [], genres: [], watchMethods: [], timeframes: [], platforms: [] };
        let listsWatchCountMax = 0;

        function buildSortFilterStatusLine({ state, defaults, labels }) {
            const st = state || {};
            const def = defaults || {};

            const sortKey = String(st.sortKey || def.sortKey || '').trim();
            const sortDir = String(st.sortDir || def.sortDir || '').trim().toLowerCase();
            const sortDefault = (sortKey === String(def.sortKey || '').trim()) && (sortDir === String(def.sortDir || '').trim().toLowerCase());

            const parts = [];

            const filterPairs = [];
            const pushFilter = (k, v, { label = '' } = {}) => {
                const val = String(v || '').trim();
                if (!val) return;
                filterPairs.push({ k, label: label || k, v: val });
            };

            pushFilter('tier', st.tier, { label: 'Tier' });
            pushFilter('decade', st.decade, { label: 'Decade' });
            pushFilter('directorContains', st.directorContains, { label: 'Director' });
            pushFilter('actorContains', st.actorContains, { label: 'Actor' });
            pushFilter('movieId', st.movieTitle || st.movieId, { label: 'Movie' });
            pushFilter('mpa', st.mpa, { label: 'MPA' });
            pushFilter('genre', st.genre, { label: 'Genre' });
            pushFilter('watchMethod', st.watchMethod, { label: 'Watch Method' });
            if (String(st.recommendedBy || '').trim()) {
                pushFilter('recommendedBy', recByUsernameLabel(st.recommendedBy), { label: 'Recommended by' });
            }
            const effWatchOpts = listsEffectiveWatchOptions(st);
            if (effWatchOpts.length) {
                pushFilter('watchOptions', effWatchOpts.map((p) => platformShortLabel(p) || p).join(', '), { label: 'Watch options' });
            }
            if (String(st.timeframe || '').trim() && String(st.timeframe || '').trim() !== 'all_time') {
                pushFilter('timeframe', st.timeframe, { label: 'Timeframe' });
            }
            if (st.watchCountMin || st.watchCountMax) {
                const minVal = String(st.watchCountMin || '').trim();
                const maxVal = String(st.watchCountMax || '').trim();
                const label = minVal && maxVal ? `${minVal}-${maxVal}` : (minVal ? `${minVal}+` : `≤ ${maxVal}`);
                pushFilter('watchCount', label, { label: 'Watch Count' });
            }

            const hasAnyFilters = filterPairs.length > 0;

            const sortLabel = labels?.sortKey?.[sortKey] || sortKey || 'Watch Date';
            const dirArrow = (sortDir === 'asc') ? '↑' : '↓';
            const sortPart = `Sort: ${sortLabel} ${dirArrow}`;

            const formatFilter = (p) => {
                if (p.k === 'directorContains') return `${p.label} contains “${p.v}”`;
                if (p.k === 'actorContains') return `${p.label} contains “${p.v}”`;
                if (p.k === 'watchCount') return `${p.label}: ${p.v}`;
                if (p.k === 'watchMethod') return `${p.label}: ${p.v}`;
                if (p.k === 'tier' && p.v === 'UNRANKED') return `${p.label}: Unranked`;
                if (p.k === 'timeframe') return `${p.label}: ${p.v}`;
                return `${p.label}: ${p.v}`;
            };

            if (!hasAnyFilters && sortDefault) {
                return { isDefault: true, text: 'Filters/Sort: Default' };
            }

            if (hasAnyFilters) {
                const shown = filterPairs.slice(0, 3).map(formatFilter);
                const extra = filterPairs.length - shown.length;
                parts.push(`Filters: ${shown.join(', ')}${extra > 0 ? ` (+${extra})` : ''}`);
            }
            if (!sortDefault) parts.push(sortPart);
            if (sortDefault && hasAnyFilters) parts.push('Sort: Default');

            return { isDefault: false, text: parts.join(' • ') };
        }

        function buildSortFilterChipModel({ state, defaults, labels }) {
            const st = state || {};
            const def = defaults || {};
            const status = buildSortFilterStatusLine({ state: st, defaults: def, labels });

            const sortKey = String(st.sortKey || def.sortKey || '').trim();
            const sortDir = String(st.sortDir || def.sortDir || '').trim().toLowerCase();
            const sortChanged = (sortKey !== String(def.sortKey || '').trim()) || (sortDir !== String(def.sortDir || '').trim().toLowerCase());

            const sortLabel = labels?.sortKey?.[sortKey] || sortKey || 'Watch Date';
            const dirArrow = (sortDir === 'asc') ? '↑' : '↓';

            const chips = [];

            const addFilterChip = (part, text) => {
                const t = String(text || '').trim();
                if (!t) return;
                chips.push({ part, kind: 'filter', text: t });
            };

            const tier = String(st.tier || '').trim();
            if (tier) addFilterChip('tier', `Tier: ${tier === 'UNRANKED' ? 'Unranked' : tier}`);

            const decade = String(st.decade || '').trim();
            if (decade) addFilterChip('decade', `Decade: ${decade}`);

            const director = String(st.directorContains || '').trim();
            if (director) addFilterChip('directorContains', `Director contains “${director}”`);

            const actor = String(st.actorContains || '').trim();
            if (actor) addFilterChip('actorContains', `Actor contains “${actor}”`);

            const movieLabel = String(st.movieTitle || st.movieId || '').trim();
            if (movieLabel) addFilterChip('movieId', `Movie: ${movieLabel}`);

            const mpa = String(st.mpa || '').trim();
            if (mpa) addFilterChip('mpa', `MPA: ${mpa}`);

            const genre = String(st.genre || '').trim();
            if (genre) addFilterChip('genre', `Genre: ${genre}`);

            const watchMethod = String(st.watchMethod || '').trim();
            if (watchMethod) addFilterChip('watchMethod', `Watch Method: ${watchMethod}`);

            const recBy = String(st.recommendedBy || '').trim();
            if (recBy) addFilterChip('recommendedBy', `Recommended by ${recByUsernameLabel(recBy)}`);

            const effWatch = listsEffectiveWatchOptions(st);
            if (effWatch.length) {
                addFilterChip('watchOptions', `Watch options: ${effWatch.map((p) => platformShortLabel(p) || p).join(', ')}`);
            }

            const watchMin = String(st.watchCountMin || '').trim();
            const watchMax = String(st.watchCountMax || '').trim();
            if (watchMin || watchMax) {
                const label = watchMin && watchMax ? `${watchMin}-${watchMax}` : (watchMin ? `${watchMin}+` : `≤ ${watchMax}`);
                addFilterChip('watchCount', `Watch Count: ${label}`);
            }

            const timeframe = String(st.timeframe || '').trim();
            if (timeframe && timeframe !== 'all_time') addFilterChip('timeframe', `Timeframe: ${timeframe}`);

            if (sortChanged) {
                chips.push({ part: 'sort', kind: 'sort', text: `Sort: ${sortLabel} ${dirArrow}` });
            }

            return {
                isDefault: Boolean(status?.isDefault),
                summaryText: String(status?.text || ''),
                chips,
            };
        }

        function renderSortFilterChipsHtml({ model, namespace }) {
            const m = model || { isDefault: true, summaryText: '', chips: [] };
            const ns = String(namespace || '').trim();
            const wrapStyle = 'display:flex; flex-wrap: wrap; gap: 8px; align-items: center;';
            const xStyle = 'width: 18px; height: 18px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.22); background: rgba(0,0,0,0.18); color: rgba(255,255,255,0.80); font-weight: 900; line-height: 1; display:inline-flex; align-items:center; justify-content:center; cursor:pointer;';

            // No "Default" pill — when nothing is filtered/sorted we show nothing.
            if (m.isDefault) {
                return '';
            }

            const chipHtml = (c) => {
                const text = String(c?.text || '').trim();
                const part = String(c?.part || '').trim();
                if (!text || !part) return '';
                const clearBtn = `<button type="button" style="${xStyle}" data-${escapeHtml(ns)}-action="clear_sort_filter_part" data-part="${escapeHtml(part)}" aria-label="Clear ${escapeHtml(text)}" title="Clear">×</button>`;
                return `<span class="dash-quote-pill" style="display:inline-flex; align-items:center; gap: 8px;">${escapeHtml(text)}${clearBtn}</span>`;
            };

            const chips = (Array.isArray(m.chips) ? m.chips : []).map(chipHtml).filter(Boolean).join('');
            return chips ? `<div style="${wrapStyle}">${chips}</div>` : '';
        }

        function getDefaultListsSortFilterState() {
            return {
                sortKey: 'watch_date',
                sortDir: 'desc',
                tier: '',
                decade: '',
                directorContains: '',
                actorContains: '',
                mpa: '',
                genre: '',
                watchMethod: '',
                watchCountMin: '',
                watchCountMax: '',
                timeframe: 'all_time',
                recommendedBy: '',   // Recs only: filter to one recommender (user id)
                watchOptions: [],    // multi-select: platform names; movie matches ANY
            };
        }

        function isRecsList() {
            return String(listsActiveListName || '').trim().toLowerCase() === 'recs';
        }

        // Bucket List + Recs only ever hold UNWATCHED movies (logging a movie auto-removes
        // it via removeMovieFromAutoLists), so rating/watch-based filters & sorts don't apply.
        function isUnwatchedAutoList() {
            return isRecsList() || isBucketList({ list_id: listsActiveListId, list_name: listsActiveListName });
        }

        function getDefaultListsSortFilterStateForActiveList() {
            const base = getDefaultListsSortFilterState();
            // Unwatched lists default to most-recently added first (Recs = newest rec).
            if (isUnwatchedAutoList()) {
                return { ...base, sortKey: 'rec_added', sortDir: 'desc' };
            }
            return base;
        }

        function getAllowedListsSortKeysForActiveList() {
            // Unwatched lists have no personal ratings/watch data, so only offer
            // date-added, release year, and IMDb.
            if (isUnwatchedAutoList()) {
                return ['rec_added', 'release_year', 'imdb'];
            }
            return [
                'watch_date',
                'watch_count',
                'overall',
                'sound',
                'pace',
                'imagery',
                'acting',
                'plot',
                'dialogue',
                'imdb',
                'release_year',
            ];
        }

        function ensureListsSortFilterStateInitialized() {
            if (!listsSortFilterState) {
                listsSortFilterState = getDefaultListsSortFilterStateForActiveList();
            }
        }

        // Show/hide a `data-sf-field` row inside the Lists filter modal.
        function setListsFilterFieldVisible(name, visible) {
            const overlay = document.getElementById('lists-sortfilter-overlay');
            if (!overlay) return;
            const el = overlay.querySelector(`[data-sf-field="${name}"]`);
            if (el) el.style.display = visible ? '' : 'none';
        }

        function configureListsSortFilterModalForActiveList() {
            const els = getListsSortFilterModalEls();
            if (!els.sortKey) return;

            const unwatched = isUnwatchedAutoList();
            const isRecs = isRecsList();

            // Unwatched lists (Bucket List + Recs) have no personal ratings/watch data,
            // so hide every filter tied to one. The "Recommended by" filter is Recs-only.
            setListsFilterFieldVisible('timeframe', !unwatched);
            setListsFilterFieldVisible('watchmethod', !unwatched);
            setListsFilterFieldVisible('tier', !unwatched);
            setListsFilterFieldVisible('watchcount', !unwatched);
            setListsFilterFieldVisible('recby', isRecs);
            // Watch options apply to every list — show only when this list's movies have
            // any known platforms (else the filter would be empty).
            const hasPlatforms = Array.isArray(listsFacetOptions?.platforms) && listsFacetOptions.platforms.length > 0;
            setListsFilterFieldVisible('watchoptions', hasPlatforms);

            const allowed = new Set(getAllowedListsSortKeysForActiveList());

            // Date-added is labeled per list: "Recommended (newest)" on Recs, else generic.
            const addedLabel = isRecs ? 'Recommended (newest)' : 'Recently added';
            const sortOptions = [
                { value: 'rec_added', label: addedLabel },
                { value: 'watch_date', label: 'Watch Date' },
                { value: 'watch_count', label: 'Watch Count' },
                { value: 'overall', label: 'Overall %' },
                { value: 'sound', label: 'Sound %' },
                { value: 'pace', label: 'Pace %' },
                { value: 'imagery', label: 'Imagery %' },
                { value: 'acting', label: 'Acting %' },
                { value: 'plot', label: 'Plot %' },
                { value: 'dialogue', label: 'Dialogue %' },
                { value: 'imdb', label: 'IMDb %' },
                { value: 'release_year', label: 'Release Year' },
            ].filter(o => allowed.has(o.value));

            const prev = String(els.sortKey.value || '').trim();
            els.sortKey.innerHTML = sortOptions.map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('');
            if (prev && allowed.has(prev)) {
                els.sortKey.value = prev;
            }

            // If current state is incompatible with this list, coerce it to the
            // list's own default (e.g. entering "Recs" → newest-recommended first), and
            // clear any hidden filter values so they don't silently filter the list.
            ensureListsSortFilterStateInitialized();
            const def = getDefaultListsSortFilterStateForActiveList();
            const next = { ...listsSortFilterState };

            if (!allowed.has(String(next.sortKey || '').trim())) {
                next.sortKey = def.sortKey;
                next.sortDir = def.sortDir;
            }
            if (unwatched) {
                next.tier = '';
                next.watchMethod = '';
                next.watchCountMin = '';
                next.watchCountMax = '';
                next.timeframe = 'all_time';
            }
            if (!isRecs) next.recommendedBy = '';
            if (!hasPlatforms) next.watchOptions = [];

            listsSortFilterState = next;
        }

        // Build the "Recommended by" pill row from the distinct recommenders of the
        // movies currently on the Recs list (populated by loadListsPage). Recs-only.
        function populateListsRecByPills() {
            const group = document.getElementById('lists-modal-filter-recby');
            if (!group) return;
            if (!isRecsList()) { group.innerHTML = ''; return; }

            const byId = new Map(); // userId -> { id, username, icon }
            recByDataByMovieId.forEach((arr) => {
                (Array.isArray(arr) ? arr : []).forEach((r) => {
                    const id = String(r?.id || '').trim();
                    if (id && !byId.has(id)) byId.set(id, r);
                });
            });

            const people = Array.from(byId.values())
                .sort((a, b) => String(a?.username || '').localeCompare(String(b?.username || '')));

            const selected = String(listsSortFilterState?.recommendedBy || '').trim();
            const pills = [`<button type="button" data-val="">All</button>`].concat(
                people.map((p) => {
                    const id = String(p?.id || '').trim();
                    const uname = String(p?.username || '').trim() || 'user';
                    return `<button type="button" data-val="${escapeHtml(id)}" title="@${escapeHtml(uname)}">${renderUserIconHtml(String(p?.icon || ''), 22)}<span class="sf-recby-name">@${escapeHtml(uname)}</span></button>`;
                })
            );
            group.innerHTML = pills.join('');
            // Reflect current selection (falls back to "All" if the recommender is gone).
            sfSegSetValue(group, selected);
        }

        // Resolve a recommender user id → "@username" (for the active-filter chip/summary).
        function recByUsernameLabel(userId) {
            const id = String(userId || '').trim();
            if (!id) return '';
            let uname = '';
            recByDataByMovieId.forEach((arr) => {
                if (uname) return;
                (Array.isArray(arr) ? arr : []).forEach((r) => {
                    if (!uname && String(r?.id || '').trim() === id) uname = String(r?.username || '').trim();
                });
            });
            return uname ? `@${uname}` : 'a user';
        }

        // ---- Watch options (streaming platforms) MULTI-select filter ----------------
        // A platform pill grid that is its OWN scrollable section at the bottom of the
        // filters modal. Multi-select: it deliberately does NOT use the `.sf-seg` class
        // (the shared ensureSfSegListener enforces single-select on any .sf-seg). Each
        // pill is brand-color-coded exactly like the Watch Options movie popup
        // (platformBrandTheme). Selected platforms sort to the TOP. The selection is the
        // source of truth in `listsWatchOptionsSelected` (a Set of full platform names),
        // so a search-filtered-out-but-selected platform is never lost. A per-section
        // search bar + Select all / Deselect all live above the grid.
        let listsWatchOptionsSelected = new Set();  // selected full platform names
        let listsWatchOptionsSearchQuery = '';
        let listsWatchOptionsListenerBound = false;

        function listsWatchOptPlatforms() {
            return Array.isArray(listsFacetOptions?.platforms) ? listsFacetOptions.platforms : [];
        }

        function ensureListsWatchOptionListener() {
            if (listsWatchOptionsListenerBound) return;
            listsWatchOptionsListenerBound = true;
            document.addEventListener('click', (e) => {
                const t = e?.target;
                if (!t || !t.closest) return;
                // Select all / Deselect all action buttons.
                const act = t.closest('#lists-watchoptions-field [data-watchopt-action]');
                if (act) {
                    e.preventDefault();
                    const action = String(act.dataset.watchoptAction || '');
                    if (action === 'select_all') {
                        listsWatchOptPlatforms().forEach((p) => listsWatchOptionsSelected.add(String(p)));
                    } else if (action === 'deselect_all') {
                        listsWatchOptionsSelected.clear();
                    }
                    paintListsWatchOptionPills();
                    return;
                }
                // Toggle a single platform pill.
                const btn = t.closest('#lists-modal-filter-watchoptions button[data-val]');
                if (!btn) return;
                e.preventDefault();
                const name = String(btn.dataset.val || '').trim();
                if (!name) return;
                if (listsWatchOptionsSelected.has(name)) listsWatchOptionsSelected.delete(name);
                else listsWatchOptionsSelected.add(name);
                paintListsWatchOptionPills();  // re-sort so the just-selected pill jumps to top
            });
        }

        // Search box just for this section (global so the inline oninput can call it).
        function applyListsWatchOptionsSearch(q) {
            listsWatchOptionsSearchQuery = String(q || '');
            paintListsWatchOptionPills();
        }

        // Render the pills: SELECTED first (then alpha), filtered by the section search,
        // each color-coded by its brand theme like the Watch Options movie popup.
        function paintListsWatchOptionPills() {
            const group = document.getElementById('lists-modal-filter-watchoptions');
            if (!group) return;
            const selectedLower = new Set(Array.from(listsWatchOptionsSelected).map((s) => String(s).toLowerCase()));
            const isOn = (p) => selectedLower.has(String(p).toLowerCase());

            const sorted = listsWatchOptPlatforms().slice().sort((a, b) => {
                const sa = isOn(a) ? 0 : 1;
                const sb = isOn(b) ? 0 : 1;
                if (sa !== sb) return sa - sb;
                return String(a).localeCompare(String(b));
            });

            const q = normalizeSearchText(listsWatchOptionsSearchQuery || '');
            const filtered = q
                ? sorted.filter((p) => {
                    const full = normalizePlatformName(p);
                    const label = platformShortLabel(full) || full;
                    return normalizeSearchText(label).includes(q) || normalizeSearchText(full).includes(q);
                })
                : sorted;

            if (!filtered.length) {
                group.innerHTML = `<div class="sf-watchopt-empty text-xs text-gray">${q ? 'No matches.' : 'No watch options on this list yet.'}</div>`;
                return;
            }

            group.innerHTML = filtered.map((p) => {
                const full = normalizePlatformName(p);
                const label = platformShortLabel(full) || full;
                const on = isOn(p);
                const theme = platformBrandTheme(full);
                const style = `background:${theme.bg}; border:1px solid ${theme.border}; color:${theme.text};`;
                return `<button type="button" data-val="${escapeHtml(String(p))}" class="${on ? 'is-active' : ''}" style="${style}">${on ? '✓ ' : ''}${escapeHtml(label)}</button>`;
            }).join('');
        }

        // Read the current selection (the Set is the source of truth, NOT the DOM, so
        // search-hidden selections survive). Used by readListsSortFilterModalState.
        function listsWatchOptionsGet() {
            return Array.from(listsWatchOptionsSelected);
        }

        // Seed the selection from state + repaint. Used by setListsSortFilterModalFromState.
        function listsWatchOptionsSet(_group, arr) {
            listsWatchOptionsSelected = new Set((Array.isArray(arr) ? arr : []).map((v) => String(v || '').trim()).filter(Boolean));
            listsWatchOptionsSearchQuery = '';
            const search = document.getElementById('lists-watchoptions-search');
            if (search) search.value = '';
            paintListsWatchOptionPills();
        }

        // Build/refresh the pills reflecting the current state's selection.
        function populateListsWatchOptionPills() {
            listsWatchOptionsSet(null, Array.isArray(listsSortFilterState?.watchOptions) ? listsSortFilterState.watchOptions : []);
        }

        // Lowercased list of EVERY platform available on the active list.
        function listsAllFacetPlatformsLower() {
            return listsWatchOptPlatforms().map((p) => String(p || '').trim().toLowerCase()).filter(Boolean);
        }

        // True when the selection covers every available platform — treated the SAME as
        // an empty selection (consider ALL), so "Select all" behaves like the default.
        function listsWatchOptionsCoversAll(arr) {
            const all = listsAllFacetPlatformsLower();
            if (!all.length) return false;
            const sel = new Set((Array.isArray(arr) ? arr : []).map((s) => String(s || '').trim().toLowerCase()));
            return all.every((p) => sel.has(p));
        }

        // The EFFECTIVE filter: empty when nothing is selected OR everything is selected
        // (both mean "show all"); otherwise the chosen platforms.
        function listsEffectiveWatchOptions(st) {
            const arr = Array.isArray(st?.watchOptions) ? st.watchOptions : [];
            if (!arr.length) return [];
            if (listsWatchOptionsCoversAll(arr)) return [];
            return arr;
        }

        function getListsSortFilterModalEls() {
            return {
                overlay: document.getElementById('lists-sortfilter-overlay'),
                sortKey: document.getElementById('lists-modal-sort-key'),
                sortDir: document.getElementById('lists-modal-sort-dir'),
                tier: document.getElementById('lists-modal-filter-tier'),
                decade: document.getElementById('lists-modal-filter-decade'),
                director: document.getElementById('lists-modal-filter-director'),
                actor: document.getElementById('lists-modal-filter-actor'),
                mpa: document.getElementById('lists-modal-filter-mpa'),
                genre: document.getElementById('lists-modal-filter-genre'),
                watchMethod: document.getElementById('lists-modal-filter-watchmethod'),
                recBy: document.getElementById('lists-modal-filter-recby'),
                watchOptions: document.getElementById('lists-modal-filter-watchoptions'),
                timeframe: document.getElementById('lists-modal-filter-timeframe'),
                watchRail: document.getElementById('lists-watch-count-rail'),
                watchMinLabel: document.getElementById('lists-watch-count-min'),
                watchMaxLabel: document.getElementById('lists-watch-count-max'),
            };
        }

        function setListsWatchCountRangeUI({ minVal, maxVal, maxAvail }) {
            const els = getListsSortFilterModalEls();
            if (!els.watchRail) return;

            const maxAvailable = Math.max(0, Number(maxAvail) || 0);
            const minV = Number.isFinite(Number(minVal)) ? Number(minVal) : 1;
            const maxV = Number.isFinite(Number(maxVal)) ? Number(maxVal) : maxAvailable || 1;

            els.watchRail.dataset.minVal = String(minV);
            els.watchRail.dataset.maxVal = String(maxV);
            els.watchRail.dataset.maxAvail = String(maxAvailable);

            const disabled = maxAvailable <= 0;
            els.watchRail.classList.toggle('is-disabled', disabled);
            if (els.watchMinLabel) els.watchMinLabel.textContent = disabled ? '—' : String(minV);
            if (els.watchMaxLabel) els.watchMaxLabel.textContent = disabled ? '—' : String(maxV);

            const fill = els.watchRail.querySelector('.library-watch-rail-fill');
            const minHandle = els.watchRail.querySelector('[data-handle="min"]');
            const maxHandle = els.watchRail.querySelector('[data-handle="max"]');
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

        function setListsWatchCountRangeFromState(state) {
            const maxAvailable = Math.max(0, Number(listsWatchCountMax) || 0);
            const minState = Number(state?.watchCountMin);
            const maxState = Number(state?.watchCountMax);
            let minVal = Number.isFinite(minState) && minState > 0 ? minState : 1;
            let maxVal = Number.isFinite(maxState) && maxState > 0 ? maxState : (maxAvailable || 1);
            if (maxAvailable > 0) {
                minVal = Math.max(1, Math.min(minVal, maxAvailable));
                maxVal = Math.max(minVal, Math.min(maxVal, maxAvailable));
            }
            setListsWatchCountRangeUI({ minVal, maxVal, maxAvail: maxAvailable });
        }

        function initListsWatchCountRange() {
            const els = getListsSortFilterModalEls();
            if (!els.watchRail) return;
            if (els.watchRail.dataset.boundRange) return;
            els.watchRail.dataset.boundRange = 'true';

            let activeHandle = null;

            const valueFromClientX = (clientX) => {
                const maxAvailable = Math.max(0, Number(els.watchRail.dataset.maxAvail) || 0);
                if (maxAvailable <= 0) return 1;
                const rect = els.watchRail.getBoundingClientRect();
                const raw = (clientX - rect.left) / Math.max(1, rect.width);
                const pct = Math.max(0, Math.min(1, raw));
                const val = Math.round(1 + pct * Math.max(1, maxAvailable - 1));
                return Math.max(1, Math.min(maxAvailable, val));
            };

            const updateValues = (nextMin, nextMax) => {
                const maxAvailable = Math.max(0, Number(els.watchRail.dataset.maxAvail) || 0);
                if (maxAvailable <= 0) return;
                let minVal = Math.max(1, Math.min(nextMin, maxAvailable));
                let maxVal = Math.max(1, Math.min(nextMax, maxAvailable));
                if (minVal > maxVal) {
                    if (activeHandle === 'min') minVal = maxVal;
                    else maxVal = minVal;
                }
                setListsWatchCountRangeUI({ minVal, maxVal, maxAvail: maxAvailable });
            };

            const pickNearestHandle = (clientX) => {
                const minVal = Number(els.watchRail.dataset.minVal) || 1;
                const maxVal = Number(els.watchRail.dataset.maxVal) || 1;
                const targetVal = valueFromClientX(clientX);
                return Math.abs(targetVal - minVal) <= Math.abs(targetVal - maxVal) ? 'min' : 'max';
            };

            const onPointerMove = (e) => {
                if (!activeHandle) return;
                const minVal = Number(els.watchRail.dataset.minVal) || 1;
                const maxVal = Number(els.watchRail.dataset.maxVal) || 1;
                const nextVal = valueFromClientX(e.clientX);
                if (activeHandle === 'min') updateValues(nextVal, maxVal);
                else updateValues(minVal, nextVal);
            };

            const onPointerUp = () => {
                activeHandle = null;
                document.removeEventListener('pointermove', onPointerMove);
                document.removeEventListener('pointerup', onPointerUp);
            };

            els.watchRail.addEventListener('pointerdown', (e) => {
                if (els.watchRail.classList.contains('is-disabled')) return;
                const handle = e?.target?.closest ? e.target.closest('[data-handle]') : null;
                activeHandle = handle ? String(handle.dataset.handle || '').trim() : pickNearestHandle(e.clientX);
                onPointerMove(e);
                document.addEventListener('pointermove', onPointerMove);
                document.addEventListener('pointerup', onPointerUp);
            });
        }

        function setSelectOptions(el, { baseOptions = [], values = [] } = {}) {
            if (!el) return;
            const keep = baseOptions.map(o => ({ value: String(o?.value ?? ''), label: String(o?.label ?? '') }));
            const uniq = Array.from(new Set((Array.isArray(values) ? values : []).map(v => String(v || '').trim()).filter(Boolean)));
            const items = uniq.sort((a, b) => a.localeCompare(b));
            el.innerHTML = [
                ...keep.map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`),
                ...items.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`),
            ].join('');
        }

        function loadListsFacetsIntoModal() {
            const els = getListsSortFilterModalEls();
            // Genre / MPA / Decade stay as <select>; Watch Method is now a fixed .sf-seg
            // pill group, so it is NOT rebuilt here (that would wipe the pills).
            setSelectOptions(els.decade, {
                baseOptions: [{ value: '', label: 'All' }],
                values: listsFacetOptions?.decades || [],
            });
            setSelectOptions(els.mpa, {
                baseOptions: [{ value: '', label: 'All' }],
                values: listsFacetOptions?.mpas || [],
            });
            setSelectOptions(els.genre, {
                baseOptions: [{ value: '', label: 'All' }],
                values: listsFacetOptions?.genres || [],
            });

            if (els.timeframe) {
                const monthOptions = (Array.isArray(listsFacetOptions?.timeframes) ? listsFacetOptions.timeframes : [])
                    .map((m) => {
                        const parts = String(m).split('-');
                        const year = Number(parts[0]);
                        const month = Number(parts[1]);
                        const labelDate = Number.isFinite(year) && Number.isFinite(month)
                            ? new Date(year, month - 1, 1)
                            : null;
                        const label = labelDate
                            ? labelDate.toLocaleDateString(undefined, { year: 'numeric', month: 'long' })
                            : String(m);
                        return `<option value="${escapeHtml(String(m))}">${escapeHtml(label)}</option>`;
                    })
                    .join('');

                const keepVal = String(els.timeframe.value || 'all_time');
                els.timeframe.innerHTML = `
                    <option value="all_time">All time</option>
                    <option value="this_year">This year</option>
                    <option value="this_month">This month</option>
                    ${monthOptions}
                `;
                els.timeframe.value = keepVal || 'all_time';
            }

            setListsWatchCountRangeFromState(listsSortFilterState || {});
        }

        function setListsSortFilterModalFromState(state) {
            const els = getListsSortFilterModalEls();
            if (!els.sortKey || !els.sortDir) return;
            els.sortKey.value = String(state?.sortKey || 'watch_date');
            // Watch Method / Tier / Sort direction / Recommended-by are .sf-seg pill groups.
            sfSegSetValue(els.sortDir, (String(state?.sortDir || 'desc') === 'asc') ? 'asc' : 'desc');
            sfSegSetValue(els.tier, String(state?.tier || ''));
            sfSegSetValue(els.watchMethod, String(state?.watchMethod || ''));
            if (els.recBy) sfSegSetValue(els.recBy, String(state?.recommendedBy || ''));
            if (els.watchOptions) listsWatchOptionsSet(els.watchOptions, Array.isArray(state?.watchOptions) ? state.watchOptions : []);
            if (els.decade) els.decade.value = String(state?.decade || '');
            if (els.director) els.director.value = String(state?.directorContains || '');
            if (els.actor) els.actor.value = String(state?.actorContains || '');
            if (els.mpa) els.mpa.value = String(state?.mpa || '');
            if (els.genre) els.genre.value = String(state?.genre || '');
            if (els.timeframe) els.timeframe.value = String(state?.timeframe || 'all_time');
            setListsWatchCountRangeFromState(state || {});
        }

        function readListsSortFilterModalState() {
            const els = getListsSortFilterModalEls();
            const getVal = (el) => String(el?.value || '').trim();
            const maxAvail = Number(els.watchRail?.dataset?.maxAvail ?? 0);
            const rawMin = Number(els.watchRail?.dataset?.minVal ?? NaN);
            const rawMax = Number(els.watchRail?.dataset?.maxVal ?? NaN);
            const minVal = Number.isFinite(rawMin) ? rawMin : '';
            const maxVal = Number.isFinite(rawMax) ? rawMax : '';
            const useMin = (Number.isFinite(minVal) && maxAvail > 0 && minVal > 1) ? minVal : '';
            const useMax = (Number.isFinite(maxVal) && maxAvail > 0 && maxVal < maxAvail) ? maxVal : '';
            return {
                sortKey: getVal(els.sortKey) || 'watch_date',
                sortDir: (sfSegGetValue(els.sortDir) === 'asc') ? 'asc' : 'desc',
                tier: sfSegGetValue(els.tier),
                decade: getVal(els.decade),
                directorContains: getVal(els.director),
                actorContains: getVal(els.actor),
                mpa: getVal(els.mpa),
                genre: getVal(els.genre),
                watchMethod: sfSegGetValue(els.watchMethod),
                recommendedBy: els.recBy ? sfSegGetValue(els.recBy) : '',
                watchOptions: els.watchOptions ? listsWatchOptionsGet(els.watchOptions) : [],
                watchCountMin: useMin,
                watchCountMax: useMax,
                timeframe: getVal(els.timeframe) || 'all_time',
            };
        }

        function openListsSortFilterModal(mode) {
            ensureListsSortFilterStateInitialized();
            ensureSfSegListener();
            const els = getListsSortFilterModalEls();
            if (!els.overlay) return;
            const lid = String(listsActiveListId || '').trim();
            if (!lid) {
                showToast('Select a list first.', { level: 'warn' });
                return;
            }
            listsSortFilterDraft = { ...listsSortFilterState };
            // Reflect the active list (field visibility, sort options, recby pills) each open.
            configureListsSortFilterModalForActiveList();
            populateListsRecByPills();
            populateListsWatchOptionPills();
            ensureListsWatchOptionListener();
            loadListsFacetsIntoModal();
            setListsSortFilterModalFromState(listsSortFilterState);
            initListsWatchCountRange();
            setListsWatchCountRangeFromState(listsSortFilterState);

            // Show only the requested section (both still save together) — mirrors My Movies.
            const showSort = mode !== 'filters';
            const showFilters = mode !== 'sort';
            const sortSec = els.overlay.querySelector('[data-sf="sort"]');
            const filterSec = els.overlay.querySelector('[data-sf="filters"]');
            const divider = els.overlay.querySelector('.lists-sf-divider');
            if (sortSec) sortSec.style.display = showSort ? '' : 'none';
            if (filterSec) filterSec.style.display = showFilters ? '' : 'none';
            if (divider) divider.style.display = (showSort && showFilters) ? '' : 'none';
            const titleEl = document.getElementById('lists-sortfilter-title');
            if (titleEl) titleEl.textContent = mode === 'sort' ? 'Sort' : (mode === 'filters' ? 'Filters' : 'Filters & Sort');

            els.overlay.style.display = 'flex';
            setTimeout(() => {
                try { (showSort ? els.sortKey : filterSec?.querySelector('.input-field'))?.focus?.(); } catch (_) {}
            }, 0);
        }

        function closeListsSortFilterModal({ restoreDraft = false } = {}) {
            const els = getListsSortFilterModalEls();
            if (!els.overlay) return;
            if (restoreDraft && listsSortFilterDraft) {
                loadListsFacetsIntoModal();
                setListsSortFilterModalFromState(listsSortFilterDraft);
            }
            els.overlay.style.display = 'none';
        }

        function saveListsSortFilterModal() {
            ensureListsSortFilterStateInitialized();
            const next = readListsSortFilterModalState();
            listsSortFilterState = next;
            listsSortFilterDraft = null;
            closeListsSortFilterModal({ restoreDraft: false });
            loadListsPage({ reset: false }).catch(() => null);
        }

        function resetListsSortFilterDraft() {
            ensureListsSortFilterStateInitialized();
            const next = getDefaultListsSortFilterStateForActiveList();
            listsSortFilterDraft = next;
            configureListsSortFilterModalForActiveList();
            populateListsRecByPills();
            populateListsWatchOptionPills();
            loadListsFacetsIntoModal();
            setListsSortFilterModalFromState(next);
        }

        function listsDecadeLabelFromYear(year) {
            const y = Number(year);
            if (!Number.isFinite(y) || y <= 0) return '';
            const decade = Math.floor(y / 10) * 10;
            return `${decade}s`;
        }

        // Utility: De-duplicate array of strings, preserving order
        function uniqStrings(arr) {
            if (!Array.isArray(arr)) return [];
            const seen = new Set();
            const out = [];
            for (const s of arr) {
                const v = String(s || '').trim();
                if (v && !seen.has(v)) {
                    seen.add(v);
                    out.push(v);
                }
            }
            return out;
        }

        function listsNormalizeGenresToArray(movie) {
            if (!movie) return [];
            if (Array.isArray(movie?.genres) && movie.genres.length) {
                return uniqStrings(movie.genres.map(x => String(x || '').trim()).filter(Boolean));
            }
            const raw = String(movie?.genre || '').trim();
            if (!raw) return [];
            return uniqStrings(raw.split(',').map(s => String(s || '').trim()).filter(Boolean));
        }

        function applyListsSortFilter(items, state) {
            const st = state || getDefaultListsSortFilterStateForActiveList();
            const wantedTier = String(st.tier || '').trim();
            const wantedDecade = String(st.decade || '').trim();
            const wantedDirector = String(st.directorContains || '').trim().toLowerCase();
            const wantedActor = String(st.actorContains || '').trim().toLowerCase();
            const wantedMpa = String(st.mpa || '').trim().toLowerCase();
            const wantedGenre = String(st.genre || '').trim().toLowerCase();
            const wantedWatchMethod = String(st.watchMethod || '').trim();
            const wantedWatchMinRaw = String(st.watchCountMin || '').trim();
            const wantedWatchMaxRaw = String(st.watchCountMax || '').trim();
            const wantedWatchMin = wantedWatchMinRaw ? Number(wantedWatchMinRaw) : null;
            const wantedWatchMax = wantedWatchMaxRaw ? Number(wantedWatchMaxRaw) : null;
            const wantedRecBy = String(st.recommendedBy || '').trim();
            const wantedPlatforms = listsEffectiveWatchOptions(st)
                .map((s) => String(s || '').trim().toLowerCase())
                .filter(Boolean);
            const timeframeRange = libraryComputeTimeframeRange(st?.timeframe);

            const filtered = (Array.isArray(items) ? items : []).filter((it) => {
                if (!it) return false;

                if (wantedRecBy) {
                    const recs = recByDataByMovieId.get(String(it?.movie_id || '')) || [];
                    if (!recs.some(r => String(r?.id || '').trim() === wantedRecBy)) return false;
                }

                if (wantedPlatforms.length) {
                    const have = (listsPlatformsByMovieId.get(String(it?.movie_id || '')) || [])
                        .map((p) => String(p || '').trim().toLowerCase());
                    if (!wantedPlatforms.some((w) => have.includes(w))) return false;
                }

                if (wantedTier) {
                    const t = String(it?.tier || '').trim();
                    if (wantedTier === 'UNRANKED') {
                        if (t) return false;
                    } else {
                        if (t !== wantedTier) return false;
                    }
                }

                if (wantedDecade) {
                    const decade = listsDecadeLabelFromYear(it?.release_year);
                    if (decade !== wantedDecade) return false;
                }

                if (wantedDirector) {
                    const dir = String(it?.director || '').toLowerCase();
                    if (!dir.includes(wantedDirector)) return false;
                }

                if (wantedActor) {
                    const actor = String(it?.actor || '').toLowerCase();
                    if (!actor.includes(wantedActor)) return false;
                }

                if (wantedMpa) {
                    const mpa = String(it?.mpa_rating || '').trim().toLowerCase();
                    if (!mpa || mpa !== wantedMpa) return false;
                }

                if (wantedGenre) {
                    const genres = Array.isArray(it?.genresArr) ? it.genresArr : [];
                    const ok = genres.some(g => String(g || '').trim().toLowerCase() === wantedGenre);
                    if (!ok) return false;
                }

                if (wantedWatchMethod) {
                    const methodRaw = String(it?.watch_method || '').trim().toLowerCase();
                    const needle = wantedWatchMethod.toLowerCase().includes('theater')
                        ? 'theater'
                        : (wantedWatchMethod.toLowerCase().includes('home') ? 'home' : wantedWatchMethod.toLowerCase());
                    if (!methodRaw.includes(needle)) return false;
                }

                if (Number.isFinite(wantedWatchMin) && wantedWatchMin > 0) {
                    const count = Number(it?.watch_count ?? NaN);
                    if (!Number.isFinite(count) || count < wantedWatchMin) return false;
                }

                if (Number.isFinite(wantedWatchMax) && wantedWatchMax > 0) {
                    const count = Number(it?.watch_count ?? NaN);
                    if (!Number.isFinite(count) || count > wantedWatchMax) return false;
                }

                if (timeframeRange?.start_date && timeframeRange?.end_date) {
                    const raw = String(it?.latest_watch_date || '').trim();
                    if (!raw) return false;
                    const d = new Date(raw.includes('T') ? raw : `${raw}T00:00:00`);
                    if (Number.isNaN(d.getTime())) return false;
                    const t = d.getTime();
                    const start = new Date(`${timeframeRange.start_date}T00:00:00`).getTime();
                    const end = new Date(`${timeframeRange.end_date}T00:00:00`).getTime();
                    if (!(t >= start && t < end)) return false;
                }

                return true;
            });

            const sortKey = String(st.sortKey || 'watch_date');
            const asc = String(st.sortDir || 'desc') === 'asc';
            const dirMul = asc ? 1 : -1;

            const getSortVal = (it) => {
                if (sortKey === 'rec_added') {
                    const raw = String(it?.added_at || '').trim();
                    if (!raw) return null;
                    const d = new Date(raw);
                    return Number.isNaN(d.getTime()) ? null : d.getTime();
                }
                if (sortKey === 'watch_date') {
                    const raw = String(it?.latest_watch_date || '').trim();
                    if (!raw) return null;
                    const d = new Date(raw.includes('T') ? raw : `${raw}T00:00:00`);
                    return Number.isNaN(d.getTime()) ? null : d.getTime();
                }
                if (sortKey === 'release_year') {
                    const y = Number(it?.release_year);
                    return Number.isFinite(y) ? y : null;
                }
                if (sortKey === 'imdb') {
                    const n = parsePercentLike(it?.imdb_rating_pct ?? it?.imdb_pct ?? it?.imdb_rating ?? it?.imdb, { imdb: true });
                    return (n === null || n === undefined) ? null : Number(n);
                }
                if (sortKey === 'overall') return (it?.overall_rating === null || it?.overall_rating === undefined) ? null : Number(it.overall_rating);
                if (sortKey === 'watch_count') return (it?.watch_count === null || it?.watch_count === undefined) ? null : Number(it.watch_count);
                if (sortKey === 'sound') return (it?.sound_rating === null || it?.sound_rating === undefined) ? null : Number(it.sound_rating);
                if (sortKey === 'pace') return (it?.pacing_rating === null || it?.pacing_rating === undefined) ? null : Number(it.pacing_rating);
                if (sortKey === 'imagery') return (it?.imagery_rating === null || it?.imagery_rating === undefined) ? null : Number(it.imagery_rating);
                if (sortKey === 'acting') return (it?.acting_rating === null || it?.acting_rating === undefined) ? null : Number(it.acting_rating);
                if (sortKey === 'plot') return (it?.plot_rating === null || it?.plot_rating === undefined) ? null : Number(it.plot_rating);
                if (sortKey === 'dialogue') return (it?.dialogue_rating === null || it?.dialogue_rating === undefined) ? null : Number(it.dialogue_rating);
                return null;
            };

            const cmp = (a, b) => {
                const av = getSortVal(a);
                const bv = getSortVal(b);
                const aNull = (av === null || av === undefined || Number.isNaN(av));
                const bNull = (bv === null || bv === undefined || Number.isNaN(bv));
                if (aNull && bNull) {
                    const at = String(a?.title || '').toLowerCase();
                    const bt = String(b?.title || '').toLowerCase();
                    return at.localeCompare(bt);
                }
                if (aNull) return 1;
                if (bNull) return -1;
                if (av < bv) return -1 * dirMul;
                if (av > bv) return 1 * dirMul;
                const at = String(a?.title || '').toLowerCase();
                const bt = String(b?.title || '').toLowerCase();
                return at.localeCompare(bt);
            };

            return filtered.sort(cmp);
        }

        async function ensureBucketListForUser({ user_id }) {
            if (!supabaseClient) throw new Error('Supabase client not initialized.');
            const uid = String(user_id || '').trim();
            if (!uid) throw new Error('Missing user_id.');

            if (bucketListEnsuredForUserId === uid && cachedBucketListId) return cachedBucketListId;

            const row = { user_id: uid, list_name: 'Bucket List' };
            const { data, error } = await supabaseClient
                .from('Lists')
                .upsert(row, { onConflict: 'user_id,list_name' })
                .select('id, list_name')
                .single();

            if (error) throw error;
            cachedBucketListId = data?.id || null;
            bucketListEnsuredForUserId = uid;
            return cachedBucketListId;
        }

        function normalizeListName(name) {
            const s = String(name ?? '').trim();
            if (!s) return '';
            return s.replace(/\s+/g, ' ').trim();
        }

        function normalizePlatformName(name) {
            const s = String(name ?? '').trim();
            if (!s) return '';
            return s.replace(/\s+/g, ' ').trim();
        }

        function platformShortLabel(platformName) {
            const raw = normalizePlatformName(platformName);
            const n = raw.toLowerCase();
            if (!n) return '';

            if (n.includes('netflix')) return 'Netflix';
            if (n.includes('amazon') || n.includes('prime video') || n === 'prime') return 'Prime';
            if (n.includes('disney')) return 'Disney+';
            if (n === 'max' || n.includes('hbo') || n.includes('hbo max')) return 'Max';
            if (n.includes('hulu')) return 'Hulu';
            if (n.includes('apple tv') || n.includes('apple') || n.includes('itunes')) return 'Apple TV';
            if (n.includes('paramount')) return 'Paramount+';
            if (n.includes('peacock')) return 'Peacock';
            if (n.includes('crunchyroll')) return 'Crunchyroll';
            if (n.includes('tubi')) return 'Tubi';
            if (n.includes('pluto')) return 'Pluto';
            if (n.includes('youtube')) return 'YouTube';
            if (n.includes('google play') || n.includes('google') || n.includes('play')) return 'Google Play';
            if (n.includes('vudu')) return 'Vudu';
            if (n.includes('mubi')) return 'MUBI';
            if (n.includes('kanopy')) return 'Kanopy';
            if (n.includes('plex')) return 'Plex';

            // Fallback: keep short names readable.
            if (raw.length <= 14) return raw;
            return raw.slice(0, 12).trim() + '…';
        }

        function renderPlatformPills(platformNames) {
            const names = Array.isArray(platformNames) ? platformNames : [];
            const labels = [];
            const seen = new Set();

            for (const name of names) {
                const label = platformShortLabel(name);
                const key = String(label || '').toLowerCase();
                if (!label || seen.has(key)) continue;
                seen.add(key);
                labels.push(label);
            }

            const max = 4;
            const head = labels.slice(0, max);
            const more = labels.length - head.length;

            const chips = head.map((l) => (`<span class="lists-platform-pill">${escapeHtml(l)}</span>`));
            if (more > 0) chips.push(`<span class="lists-platform-pill more">+${escapeHtml(String(more))}</span>`);
            return chips.join('');
        }

        async function loadUserLists({ user_id, force = false } = {}) {
            if (!supabaseClient) throw new Error('Supabase client not initialized.');
            const uid = String(user_id || '').trim();
            if (!uid) throw new Error('Missing user_id.');

            if (!force && cachedListsUserId === uid && Array.isArray(cachedLists) && cachedLists.length) {
                return cachedLists;
            }

            // `cover` is the optional per-list square image (data URL); see
            // lists_cover_column.sql. `is_shared`/`user_id` come from shared_lists.sql.
            // Fall back to leaner selects on older DBs that haven't run those
            // migrations yet, so the page still works.
            const FULL_COLS = 'id, list_name, created_at, cover, user_id, is_shared';
            let data, error;
            ({ data, error } = await supabaseClient
                .from('Lists')
                .select(FULL_COLS)
                .eq('user_id', uid)
                .order('created_at', { ascending: true }));
            if (error && /column .*(cover|is_shared).* does not exist/i.test(String(error?.message || ''))) {
                ({ data, error } = await supabaseClient
                    .from('Lists')
                    .select('id, list_name, created_at, user_id')
                    .eq('user_id', uid)
                    .order('created_at', { ascending: true }));
            }
            if (error) throw error;

            let rows = Array.isArray(data) ? data : [];

            // SHARED LISTS: also pull lists this user is a member of (owned by
            // someone else). Membership rows → their Lists rows (RLS allows members
            // to read them). Merge + dedupe by id. Best-effort: if the shared-lists
            // migration hasn't run, the List Members query errors and we skip it.
            try {
                const { data: memRows, error: memErr } = await supabaseClient
                    .from('List Members')
                    .select('list_id')
                    .eq('user_id', uid);
                if (!memErr) {
                    const sharedIds = Array.from(new Set(
                        (Array.isArray(memRows) ? memRows : [])
                            .map(r => String(r?.list_id || '').trim())
                            .filter(Boolean)));
                    const ownIds = new Set(rows.map(r => String(r.id)));
                    const wantIds = sharedIds.filter(id => !ownIds.has(id));
                    if (wantIds.length) {
                        let sData, sErr;
                        ({ data: sData, error: sErr } = await supabaseClient
                            .from('Lists').select(FULL_COLS).in('id', wantIds));
                        if (sErr && /column .*(cover|is_shared).* does not exist/i.test(String(sErr?.message || ''))) {
                            ({ data: sData } = await supabaseClient
                                .from('Lists').select('id, list_name, created_at, user_id').in('id', wantIds));
                        }
                        if (Array.isArray(sData) && sData.length) rows = rows.concat(sData);
                    }
                }
            } catch (_) {}

            // Tag each row: owner_id, whether shared, and whether I own it.
            rows = rows.map(r => ({
                ...r,
                owner_id: String(r?.user_id || '').trim(),
                shared: Boolean(r?.is_shared) || String(r?.user_id || '').trim() !== uid,
                is_owner: String(r?.user_id || '').trim() === uid,
            }));

            rows.sort((a, b) => {
                const an = String(a?.list_name || '').toLowerCase();
                const bn = String(b?.list_name || '').toLowerCase();
                if (an === 'bucket list' && bn !== 'bucket list') return -1;
                if (bn === 'bucket list' && an !== 'bucket list') return 1;
                return 0;
            });

            cachedLists = rows;
            cachedListsUserId = uid;

            const bucket = rows.find(r => String(r?.list_name || '').toLowerCase() === 'bucket list');
            if (bucket?.id) {
                cachedBucketListId = bucket.id;
                bucketListEnsuredForUserId = uid;
            }

            return cachedLists;
        }

        async function createUserList({ user_id, list_name, is_shared = false }) {
            if (!supabaseClient) throw new Error('Supabase client not initialized.');
            const uid = String(user_id || '').trim();
            const name = normalizeListName(list_name);
            if (!uid) throw new Error('Missing user_id.');
            if (!name) throw new Error('List name is required.');

            const row = { user_id: uid, list_name: name };
            if (is_shared) row.is_shared = true;
            let { data, error } = await supabaseClient
                .from('Lists')
                .insert(row)
                .select('id, list_name, created_at')
                .single();
            // Pre-migration DBs lack is_shared — retry without it.
            if (error && /column .*is_shared.* does not exist/i.test(String(error?.message || ''))) {
                ({ data, error } = await supabaseClient
                    .from('Lists')
                    .insert({ user_id: uid, list_name: name })
                    .select('id, list_name, created_at')
                    .single());
            }
            if (error) throw error;
            return data;
        }

        async function addMovieToList({ user_id, list_id, movie_id }) {
            if (!supabaseClient) throw new Error('Supabase client not initialized.');
            const uid = String(user_id || '').trim();
            const lid = String(list_id || '').trim();
            const mid = String(movie_id || '').trim();
            if (!uid) throw new Error('Missing user_id.');
            if (!lid) throw new Error('Missing list_id.');
            if (!mid) throw new Error('Missing movie_id.');

            // SHARED lists: every row carries the OWNER's user_id (so the owner-keyed
            // view/reads resolve), and `added_by` records who actually added it.
            const ownerId = listOwnerId(lid, uid);
            let { error } = await supabaseClient
                .from('Movie Lists')
                .insert({ user_id: ownerId, list_id: lid, movie_id: mid, added_by: uid });
            // Pre-migration DBs lack the added_by column — retry without it.
            if (error && /column .*added_by.* does not exist/i.test(String(error?.message || ''))) {
                ({ error } = await supabaseClient
                    .from('Movie Lists')
                    .insert({ user_id: ownerId, list_id: lid, movie_id: mid }));
            }
            if (error) throw error;

            // Best-effort, fire-and-forget: on a SHARED list, push-notify the OTHER
            // members that a new movie was added. Never let a notify error affect
            // the add itself.
            if (isSharedList(lid)) {
                (async () => {
                    try {
                        const { data: s } = await supabaseClient.auth.getSession();
                        const token = s?.session?.access_token;
                        if (token) {
                            callSwiftApi({ action: 'notify_list_add', list_id: lid, movie_id: mid }, token).catch(() => null);
                        }
                    } catch (_) {}
                })();
            }
        }

        async function removeMovieFromList({ user_id, list_id, movie_id }) {
            if (!supabaseClient) throw new Error('Supabase client not initialized.');
            const uid = String(user_id || '').trim();
            const lid = String(list_id || '').trim();
            const mid = String(movie_id || '').trim();
            if (!uid || !lid || !mid) return;

            // Rows are keyed on the list owner (shared) or the user (own) — resolve it.
            const ownerId = listOwnerId(lid, uid);
            const { error } = await supabaseClient
                .from('Movie Lists')
                .delete()
                .eq('user_id', ownerId)
                .eq('list_id', lid)
                .eq('movie_id', mid);
            if (error) throw error;
        }

        async function removeMovieFromBucketList({ user_id, movie_id }) {
            const uid = String(user_id || '').trim();
            const mid = String(movie_id || '').trim();
            if (!uid || !mid) return;

            let bucketId = cachedBucketListId;
            try {
                bucketId = await ensureBucketListForUser({ user_id: uid });
            } catch (_) {}
            if (!bucketId) return;

            await removeMovieFromList({ user_id: uid, list_id: bucketId, movie_id: mid });
        }

        // When a movie gets logged/rated, pull it out of the user's auto lists
        // ("Bucket List" and "Recs") since it's no longer something to-watch.
        async function removeMovieFromAutoLists({ user_id, movie_id }) {
            if (!supabaseClient) return;
            const uid = String(user_id || '').trim();
            const mid = String(movie_id || '').trim();
            if (!uid || !mid) return;
            try {
                const { data: lists, error } = await supabaseClient
                    .from('Lists')
                    .select('id, list_name')
                    .eq('user_id', uid)
                    .in('list_name', ['Bucket List', 'Recs']);
                if (error) throw error;
                const ids = (Array.isArray(lists) ? lists : [])
                    .map((l) => String(l?.id || '').trim()).filter(Boolean);
                if (ids.length === 0) return;
                await supabaseClient
                    .from('Movie Lists')
                    .delete()
                    .eq('user_id', uid)
                    .eq('movie_id', mid)
                    .in('list_id', ids);
            } catch (_) {
                // Best-effort cleanup; never block the diary save on this.
            }
        }

        // When a user removes a movie from their Recs list WITHOUT watching it,
        // clear the recommendation log for that movie so any sender can recommend it
        // again. (Watched movies stay blocked by the separate "already seen" check.)
        // Needs the Recommendations DELETE-by-recipient RLS policy (recommendations_tracking.sql).
        async function clearReceivedRecommendations({ user_id, movie_id }) {
            if (!supabaseClient) return;
            const uid = String(user_id || '').trim();
            const mid = String(movie_id || '').trim();
            if (!uid || !mid) return;
            await supabaseClient
                .from('Recommendations')
                .delete()
                .eq('to_user_id', uid)
                .eq('movie_id', mid);
        }

        async function openAddToListModal() {
            if (guardGuestWrite()) return;
            if (!supabaseClient) {
                showToast('Supabase SDK failed to load.', { level: 'warn' });
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

            const picked = router?.selectedMovie || null;
            if (!picked) {
                showToast('Select a movie first.', { level: 'warn' });
                return;
            }

            const title = String(picked?.title || '').trim();
            const year = Number(picked?.year ?? picked?.release_year ?? null);
            const tmdbId = Number(picked?.tmdb_id ?? picked?.tmdbId ?? picked?.id ?? null);
            const existingDbMovieId = (isUuidLike(picked?.id) ? String(picked.id).trim() : '');

            // Best-effort resolve of the catalog movie id (lookup only, no sync) so we
            // can tell which lists already contain this movie and grey them out.
            let resolvedMovieId = existingDbMovieId || null;
            if (!resolvedMovieId && Number.isFinite(tmdbId) && tmdbId > 0) {
                try {
                    const mapped = await getDbMovieIdByTmdbId(tmdbId);
                    if (isUuidLike(mapped)) resolvedMovieId = String(mapped).trim();
                } catch (_) {}
            }

            listPickerSelectedMovie = {
                title,
                year: Number.isFinite(year) ? year : null,
                tmdb_id: Number.isFinite(tmdbId) ? tmdbId : null,
                db_movie_id: existingDbMovieId || null,
                resolved_movie_id: resolvedMovieId,
                accessToken,
                user_id: authedUser.id,
            };
            listPickerSelectedIds = new Set();
            listPickerExistingIds = new Set();
            listPickerAllLists = [];
            listPickerInfoCache = null;
            listPickerSearchQuery = '';
            const searchEl = document.getElementById('list-picker-search');
            if (searchEl) searchEl.value = '';

            const overlay = document.getElementById('list-picker-overlay');
            if (overlay) overlay.style.display = 'flex';

            const movieEl = document.getElementById('list-picker-movie');
            if (movieEl) {
                movieEl.textContent = title ? `Movie: ${title}${(Number.isFinite(year) && year > 0) ? ` (${year})` : ''}` : 'Movie: (unknown)';
            }

            const listsEl = document.getElementById('list-picker-lists');
            if (listsEl) listsEl.innerHTML = `<div class="text-gray" style="grid-column:1/-1;">Loading…</div>`;
            syncListPickerSaveButton();

            await ensureBucketListForUser({ user_id: authedUser.id }).catch(() => null);
            const lists = await loadUserLists({ user_id: authedUser.id, force: true }).catch(() => []);
            await renderListPickerLists(lists);
        }

        // Loads, per list: a few poster paths for the collage cover, and whether the
        // movie is already on that list (so it can be greyed out).
        async function loadListPickerInfo(lists, resolvedMovieId) {
            const infoByList = new Map();
            const ids = (Array.isArray(lists) ? lists : []).map(l => String(l?.id || '')).filter(Boolean);
            ids.forEach(id => infoByList.set(id, { count: 0, posters: [], _ids: [] }));
            const existingIds = new Set();
            if (!ids.length) return { infoByList, existingIds };

            try {
                const { data: joinRows } = await supabaseClient
                    .from('Movie Lists')
                    .select('list_id, movie_id, created_at')
                    .in('list_id', ids)
                    .order('created_at', { ascending: false });

                const wantIds = new Set();
                const movId = isUuidLike(resolvedMovieId) ? String(resolvedMovieId).trim() : '';
                (Array.isArray(joinRows) ? joinRows : []).forEach(r => {
                    const lid = String(r?.list_id || '');
                    const mid = String(r?.movie_id || '');
                    const info = infoByList.get(lid);
                    if (!info || !mid) return;
                    info.count += 1;
                    if (info._ids.length < 4) { info._ids.push(mid); wantIds.add(mid); }
                    if (movId && mid === movId) existingIds.add(lid);
                });

                if (wantIds.size) {
                    const { data: movieRows } = await supabaseClient
                        .from('Movies')
                        .select('id, poster_path')
                        .in('id', Array.from(wantIds));
                    const posterById = new Map(
                        (Array.isArray(movieRows) ? movieRows : []).map(m => [String(m.id), String(m.poster_path || '')]));
                    infoByList.forEach(info => {
                        info.posters = info._ids.map(id => posterById.get(id)).filter(Boolean);
                    });
                }
            } catch (_) {}

            return { infoByList, existingIds };
        }

        async function renderListPickerLists(lists) {
            const el = document.getElementById('list-picker-lists');
            if (!el) return;
            const rows = Array.isArray(lists) ? lists : [];
            listPickerAllLists = rows;
            if (rows.length === 0) {
                listPickerInfoCache = null;
                el.innerHTML = `<div class="text-gray" style="grid-column:1/-1;">No lists yet — create one below.</div>`;
                syncListPickerSaveButton();
                return;
            }

            const { infoByList, existingIds } = await loadListPickerInfo(rows, listPickerSelectedMovie?.resolved_movie_id);
            listPickerExistingIds = existingIds;
            listPickerInfoCache = infoByList;

            paintListPickerTiles();
        }

        // Paints the list grid from the cached lists + info, honoring the current
        // search query. Called on first render and on every search keystroke
        // (no DB re-query — search is purely client-side over the cached lists).
        function paintListPickerTiles() {
            const el = document.getElementById('list-picker-lists');
            if (!el) return;
            const infoByList = listPickerInfoCache || new Map();
            const q = normalizeSearchText(listPickerSearchQuery || '');
            const rows = (Array.isArray(listPickerAllLists) ? listPickerAllLists : []).filter((l) => {
                if (!q) return true;
                const name = normalizeSearchText(String(l?.list_name || ''));
                return name.includes(q);
            });

            if (rows.length === 0) {
                el.innerHTML = `<div class="text-gray" style="grid-column:1/-1;">${q ? 'No lists match your search.' : 'No lists yet — create one below.'}</div>`;
                syncListPickerSaveButton();
                return;
            }

            el.innerHTML = rows
                .map((l) => {
                    const name = String(l?.list_name || '').trim() || 'Untitled';
                    const id = String(l?.id || '').trim();
                    if (!id) return '';
                    const info = infoByList.get(id) || { posters: [] };
                    const inList = listPickerExistingIds.has(id);
                    const selected = listPickerSelectedIds.has(id);
                    return `
                        <button
                            type="button"
                            class="list-picker-tile${selected ? ' is-selected' : ''}${inList ? ' is-in-list' : ''}"
                            data-list-picker-action="toggle"
                            data-list-id="${escapeHtml(id)}"
                            ${inList ? 'disabled aria-disabled="true"' : ''}
                        >
                            <span class="lists-cover-art">
                                ${renderListCoverArt(l, info)}
                                <span class="list-picker-check">${icons.checkCircle || '✓'}</span>
                                ${inList ? `<span class="list-picker-added-badge">Added</span>` : ''}
                            </span>
                            <span class="lists-cover-name">${escapeHtml(name)}</span>
                        </button>
                    `;
                })
                .filter(Boolean)
                .join('');
            syncListPickerSaveButton();
        }

        function applyListPickerSearch() {
            const input = document.getElementById('list-picker-search');
            listPickerSearchQuery = input ? String(input.value || '') : '';
            paintListPickerTiles();
        }

        function toggleListPickerSelection(list_id) {
            const lid = String(list_id || '').trim();
            if (!lid || listPickerExistingIds.has(lid)) return;
            if (listPickerSelectedIds.has(lid)) listPickerSelectedIds.delete(lid);
            else listPickerSelectedIds.add(lid);

            const tile = document.querySelector(`#list-picker-lists [data-list-id="${(window.CSS && CSS.escape) ? CSS.escape(lid) : lid}"]`);
            if (tile) tile.classList.toggle('is-selected', listPickerSelectedIds.has(lid));
            syncListPickerSaveButton();
        }

        function syncListPickerSaveButton() {
            const n = listPickerSelectedIds.size;
            const btn = document.getElementById('list-picker-save-btn');
            const labelEl = document.getElementById('list-picker-save-label');
            if (labelEl) labelEl.textContent = `Add to ${n} list${n === 1 ? '' : 's'}`;
            if (btn) btn.disabled = (n === 0 || listPickerBusy);
        }

        async function handleListPickerSaveMulti() {
            if (listPickerBusy) return;
            if (!listPickerSelectedMovie) {
                showToast('No movie selected.', { level: 'warn' });
                return;
            }
            const targetIds = Array.from(listPickerSelectedIds).filter(id => !listPickerExistingIds.has(id));
            if (!targetIds.length) return;

            const statusEl = document.getElementById('list-picker-status');
            const setStatus = (s) => { if (statusEl) statusEl.textContent = String(s || ''); };

            listPickerBusy = true;
            syncListPickerSaveButton();
            setStatus('Syncing movie metadata…');

            try {
                const uid = String(listPickerSelectedMovie.user_id || '').trim();
                const accessToken = String(listPickerSelectedMovie.accessToken || '').trim();

                const ensuredMovieId = await ensureMovieFullySyncedForLists({
                    accessToken,
                    title: listPickerSelectedMovie.title,
                    release_year: listPickerSelectedMovie.year,
                    tmdb_id: listPickerSelectedMovie.tmdb_id,
                    movie_id: listPickerSelectedMovie.db_movie_id || listPickerSelectedMovie.resolved_movie_id,
                });
                if (!ensuredMovieId) throw new Error('Failed to ensure movie exists.');

                setStatus(`Adding to ${targetIds.length} list${targetIds.length === 1 ? '' : 's'}…`);

                let added = 0;
                let already = 0;
                for (const lid of targetIds) {
                    try {
                        await addMovieToList({ user_id: uid, list_id: lid, movie_id: ensuredMovieId });
                        added += 1;
                    } catch (err) {
                        const msg = String(err?.message || err);
                        if (/duplicate|unique/i.test(msg)) { already += 1; continue; }
                        throw err;
                    }
                }

                if (added > 0) {
                    showToast(`Added to ${added} list${added === 1 ? '' : 's'}!`, { level: 'success' });
                } else if (already > 0) {
                    showToast('Already in those lists.', { level: 'warn' });
                }

                if (router?.currentPage === 'lists') {
                    if (listsViewMode === 'overview') await loadListsOverview().catch(() => {});
                    else await loadListsPage({ reset: false }).catch(() => {});
                }

                closeListPickerModal();
            } catch (err) {
                setStatus('');
                showToast(`Add to list failed: ${String(err?.message || err)}`, { level: 'warn' });
            } finally {
                listPickerBusy = false;
                syncListPickerSaveButton();
            }
        }

        async function ensureMovieFullySyncedForLists({ accessToken, title, release_year, tmdb_id, movie_id }) {
            const token = String(accessToken || '').trim();
            if (!token) throw new Error('Missing access token.');

            const uuidLike = isUuidLike;
            let dbMovieId = uuidLike(movie_id) ? String(movie_id).trim() : null;

            if (!dbMovieId && Number.isFinite(Number(tmdb_id)) && Number(tmdb_id) > 0) {
                try {
                    const mapped = await getDbMovieIdByTmdbId(Number(tmdb_id));
                    if (uuidLike(mapped)) dbMovieId = mapped;
                } catch (_) {}
            }

            if (dbMovieId) {
                const res = await callSwiftApi({ movie_id: dbMovieId, sync_people: true }, token);
                const outId = res?.movie_id || dbMovieId;
                return String(outId || '').trim();
            }

            const t = String(title || '').trim();
            const y = (release_year === null || release_year === undefined) ? null : Number(release_year);
            if (!t) throw new Error('Missing movie title.');

            const res = await callSwiftApi({ title: t, release_year: Number.isFinite(y) ? y : null, sync_people: true }, token);
            return String(res?.movie_id || '').trim();
        }

        function initListsPage() {
            if (listsBound) return;
            listsBound = true;

            document.addEventListener('click', (e) => {
                const el = e?.target?.closest ? e.target.closest('[data-lists-action]') : null;
                if (!el) return;
                const action = String(el.dataset.listsAction || '').trim();
                if (!action) return;

                if (action === 'refresh') {
                    (async () => {
                        if (listsViewMode === 'overview') await loadListsOverview();
                        else await loadListsPage({ reset: true });
                    })().catch(() => {});
                    return;
                }

                if (action === 'edit_list') {
                    openListsEditModal();
                    return;
                }

                if (action === 'rename_list') {       // legacy entry point (kept harmless)
                    openListsEditModal();
                    return;
                }

                if (action === 'delete_list') {
                    openListsDeleteModal();
                    return;
                }

                if (action === 'open_filters') {
                    openListsSortFilterModal('filters');
                    return;
                }

                if (action === 'open_sort') {
                    openListsSortFilterModal('sort');
                    return;
                }

                if (action === 'open_sort_filter') {   // legacy entry point (both sections)
                    openListsSortFilterModal();
                    return;
                }

                if (action === 'cancel_sort_filter') {
                    closeListsSortFilterModal({ restoreDraft: true });
                    return;
                }

                if (action === 'save_sort_filter') {
                    saveListsSortFilterModal();
                    return;
                }

                if (action === 'reset_sort_filter_draft') {
                    resetListsSortFilterDraft();
                    return;
                }

                if (action === 'clear_sort_filter_part') {
                    ensureListsSortFilterStateInitialized();
                    const part = String(el.dataset.part || '').trim();
                    const def = getDefaultListsSortFilterStateForActiveList();
                    const next = { ...listsSortFilterState };

                    if (part === 'sort') {
                        next.sortKey = def.sortKey;
                        next.sortDir = def.sortDir;
                    } else if (part === 'watchOptions') {
                        next.watchOptions = [];
                    } else if (Object.prototype.hasOwnProperty.call(next, part)) {
                        next[part] = '';
                    }

                    listsSortFilterState = next;
                    listsSortFilterDraft = null;
                    loadListsPage({ reset: false }).catch(() => null);
                    return;
                }

                if (action === 'confirm_delete_list') {
                    (async () => {
                        if (guardGuestWrite()) return;
                        if (listsDeleteBusy) return;

                        const lid = String(listsActiveListId || '').trim();
                        if (!lid) return;
                        if (isSpecialAutoList(lid, listsActiveListName)) {
                            showToast('This list can’t be deleted.', { level: 'warn' });
                            return;
                        }

                        const statusEl = document.getElementById('lists-delete-status');
                        const setStatus = (s) => { if (statusEl) statusEl.textContent = String(s || ''); };

                        let authedUser = null;
                        try {
                            const { user } = await requireAuthOrThrow();
                            authedUser = user;
                        } catch (_) {
                            setStatus('Please log in first.');
                            openAuthModal();
                            return;
                        }

                        listsDeleteBusy = true;
                        setListsActiveListActionsEnabledState();
                        setStatus('Deleting…');

                        try {
                            // Shared lists are keyed on the owner; any member may
                            // delete (RLS lists_delete_member). Remove joins first
                            // (safe even if there are none; FK cascade also covers it).
                            const ownerId = listOwnerId(lid, authedUser.id);
                            const { error: joinsErr } = await supabaseClient
                                .from('Movie Lists')
                                .delete()
                                .eq('user_id', ownerId)
                                .eq('list_id', lid);
                            if (joinsErr) throw joinsErr;

                            const { error: delErr } = await supabaseClient
                                .from('Lists')
                                .delete()
                                .eq('user_id', ownerId)
                                .eq('id', lid);
                            if (delErr) throw delErr;

                            cachedListsUserId = null;
                            listsActiveListId = null;
                            listsActiveListName = '';

                            closeListsDeleteModal();
                            showListsOverview(); // the deleted list is gone — return to the grid
                            showToast('List deleted.', { level: 'success' });
                        } catch (err) {
                            setStatus('');
                            showToast(`Delete failed: ${String(err?.message || err)}`, { level: 'warn' });
                        } finally {
                            listsDeleteBusy = false;
                            setListsActiveListActionsEnabledState();
                        }
                    })().catch(() => {});
                    return;
                }

                if (action === 'watch_options') {
                    const mid = String(el.dataset.movieId || '').trim();
                    if (!mid) return;
                    const title = String(el.dataset.movieTitle || '').trim();
                    openListsWatchOptionsModal({ movie_id: mid, title });
                    return;
                }

                if (action === 'open_movie') {
                    const mid = String(el.dataset.movieId || '').trim();
                    if (!mid) return;

                    // On the Recs list, a poster opens the recommendation viewer
                    // (Movie Details / followed users' reviews) instead of the log form.
                    if (String(listsActiveListName || '').trim().toLowerCase() === 'recs') {
                        openRecsMovieModal(mid).catch((err) => showToast(`Open failed: ${String(err?.message || err)}`, { level: 'warn' }));
                        return;
                    }

                    // On a SHARED list, a poster opens the member-reviews popup: pick
                    // any member who has reviewed the movie to read their full review.
                    if (isSharedList(listsActiveListId)) {
                        openSharedListMovieModal(mid).catch((err) => showToast(`Open failed: ${String(err?.message || err)}`, { level: 'warn' }));
                        return;
                    }

                    (async () => {
                        const prefill = listsMoviePrefillById.get(mid) || null;
                        if (!prefill) {
                            showToast('Movie details not available yet. Try Refresh.', { level: 'warn' });
                            return;
                        }

                        // Decide whether to open fully-populated Log New Entry (no existing rating)
                        // or fully-populated Update Ratings (existing rating).
                        let authedUser = null;
                        try {
                            const res = await requireAuthOrThrow();
                            authedUser = res.user;
                        } catch (_) {
                            openAuthModal();
                            return;
                        }

                        const alreadyRated = await hasExistingMovieRating({ user_id: authedUser.id, movie_id: mid });

                        // Start from our cached DB prefill, but route through the existing flows
                        // so MPA/Runtime/Series and rating fields are always filled correctly.
                        router.selectedMovie = { ...prefill, id: mid, detailsReadonly: false };
                        router.pendingTitle = String(prefill?.title || '').trim();

                        if (alreadyRated) {
                            await router.startUpdateRatings();
                        } else {
                            await router.startNewEntry();
                        }
                    })().catch((err) => {
                        showToast(`Open entry failed: ${String(err?.message || err)}`, { level: 'warn' });
                    });
                    return;
                }

                if (action === 'remove_movie') {
                    const lid = String(el.dataset.listId || '').trim();
                    const mid = String(el.dataset.movieId || '').trim();
                    if (!lid || !mid) return;

                    (async () => {
                        let authedUser = null;
                        try {
                            const { user } = await requireAuthOrThrow();
                            authedUser = user;
                        } catch (_) {
                            openAuthModal();
                            return;
                        }

                        try {
                            await removeMovieFromList({ user_id: authedUser.id, list_id: lid, movie_id: mid });
                            // Removing from the Recs list clears the recommendation log
                            // so it can be recommended to you again later (#re-recommend).
                            if (String(listsActiveListName || '').trim().toLowerCase() === 'recs') {
                                try { await clearReceivedRecommendations({ user_id: authedUser.id, movie_id: mid }); } catch (_) {}
                            }
                            showToast('Removed.', { level: 'success' });
                            await loadListsPage({ reset: false });
                        } catch (err) {
                            showToast(`Remove failed: ${String(err?.message || err)}`, { level: 'warn' });
                        }
                    })().catch(() => {});
                }
            }, { capture: true });

            document.addEventListener('change', async (e) => {
                const sel = e?.target?.closest ? e.target.closest('#lists-select') : null;
                if (!sel) return;
                const lid = String(sel.value || '').trim();
                if (!lid) return;
                listsActiveListId = lid;
                const label = String(sel.selectedOptions?.[0]?.textContent || '').trim();
                if (label) listsActiveListName = label;

                // Reset the quick-add search UI when changing lists.
                try {
                    const input = document.getElementById('lists-movie-search-input');
                    if (input) input.value = '';
                    clearListsSearchUI();
                    setListsQuickAddEnabledState();
                } catch (_) {}

                await loadListsPage({ reset: false });
            }, { capture: true });

            document.addEventListener('click', async (e) => {
                const el = e?.target?.closest ? e.target.closest('[data-list-picker-action]') : null;
                if (!el) return;
                const action = String(el.dataset.listPickerAction || '').trim();
                if (action !== 'toggle') return;
                const lid = String(el.dataset.listId || '').trim();
                if (!lid) return;
                toggleListPickerSelection(lid);
            }, { capture: true });

            const createForm = document.getElementById('list-picker-create-form');
            if (createForm) {
                createForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    if (listPickerBusy) return;

                    const statusEl = document.getElementById('list-picker-status');
                    const nameEl = document.getElementById('list-picker-new-name');
                    const setStatus = (s) => { if (statusEl) statusEl.textContent = String(s || ''); };

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

                    const name = normalizeListName(nameEl?.value || '');
                    if (!name) {
                        setStatus('List name is required.');
                        return;
                    }

                    if (!listPickerSelectedMovie) {
                        setStatus('Select a movie first.');
                        return;
                    }

                    listPickerBusy = true;
                    setStatus('Creating list…');

                    try {
                        const newList = await createUserList({ user_id: authedUser.id, list_name: name });
                        cachedListsUserId = null;

                        setStatus('Syncing movie metadata…');
                        const ensuredMovieId = await ensureMovieFullySyncedForLists({
                            accessToken,
                            title: listPickerSelectedMovie.title,
                            release_year: listPickerSelectedMovie.year,
                            tmdb_id: listPickerSelectedMovie.tmdb_id,
                            movie_id: listPickerSelectedMovie.db_movie_id,
                        });

                        if (!ensuredMovieId) throw new Error('Failed to ensure movie exists.');
                        setStatus('Adding to list…');
                        await addMovieToList({ user_id: authedUser.id, list_id: newList.id, movie_id: ensuredMovieId });

                        showToast('Created list and added movie!', { level: 'success' });
                        closeListPickerModal();
                    } catch (err) {
                        const msg = String(err?.message || err);
                        if (/duplicate|unique/i.test(msg)) {
                            setStatus('You already have a list with that name.');
                            return;
                        }
                        setStatus('');
                        showToast(`Create/add failed: ${msg}`, { level: 'warn' });
                    } finally {
                        listPickerBusy = false;
                    }
                }, { capture: true });
            }

            const listsCreateForm = document.getElementById('lists-create-form');
            if (listsCreateForm) {
                listsCreateForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    if (listsCreateBusy) return;

                    const statusEl = document.getElementById('lists-create-status');
                    const nameEl = document.getElementById('lists-create-name');
                    const setStatus = (s) => { if (statusEl) statusEl.textContent = String(s || ''); };

                    const name = normalizeListName(nameEl?.value || '');
                    if (!name) {
                        setStatus('List name is required.');
                        return;
                    }

                    let authedUser = null;
                    try {
                        const { user } = await requireAuthOrThrow();
                        authedUser = user;
                    } catch (_) {
                        setStatus('Please log in first.');
                        openAuthModal();
                        return;
                    }

                    const wantShared = Boolean(listsCreateShared);
                    const memberIds = Array.from(listsCreateSelectedMemberIds);
                    if (wantShared && memberIds.length === 0) {
                        setStatus('Pick at least one member, or turn off “Shared list”.');
                        return;
                    }

                    listsCreateBusy = true;
                    setStatus('Saving…');

                    try {
                        const created = await createUserList({ user_id: authedUser.id, list_name: name, is_shared: wantShared });
                        cachedListsUserId = null;

                        // Shared list: add the selected followers as members.
                        if (wantShared && created?.id && memberIds.length) {
                            setStatus('Adding members…');
                            try {
                                await addListMembers({ list_id: created.id, owner_id: authedUser.id, member_ids: memberIds });
                            } catch (mErr) {
                                showToast(`List created, but adding members failed: ${String(mErr?.message || mErr)}`, { level: 'warn' });
                            }
                        }

                        // Auto-select the newly created list.
                        if (created?.id) {
                            listsActiveListId = String(created.id);
                            listsActiveListName = String(created?.list_name || name).trim();
                        }

                        closeListsCreateModal();
                        // Open the new list's (empty) detail view, or fall back to overview.
                        if (created?.id) {
                            openListFromOverview(String(created.id), String(created?.list_name || name).trim());
                        } else {
                            showListsOverview();
                        }
                        showToast('List created!', { level: 'success' });
                    } catch (err) {
                        const msg = String(err?.message || err);
                        if (/duplicate|unique/i.test(msg)) {
                            setStatus('You already have a list with that name.');
                            return;
                        }
                        setStatus('');
                        showToast(`Create list failed: ${msg}`, { level: 'warn' });
                    } finally {
                        listsCreateBusy = false;
                    }
                }, { capture: true });
            }

            const listsRenameForm = document.getElementById('lists-rename-form');
            if (listsRenameForm) {
                listsRenameForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    if (listsRenameBusy) return;

                    const lid = String(listsActiveListId || '').trim();
                    if (!lid) return;
                    if (isSpecialAutoList(lid, listsActiveListName)) {
                        showToast('This list can’t be renamed.', { level: 'warn' });
                        return;
                    }

                    const statusEl = document.getElementById('lists-rename-status');
                    const nameEl = document.getElementById('lists-rename-name');
                    const setStatus = (s) => { if (statusEl) statusEl.textContent = String(s || ''); };

                    const name = normalizeListName(nameEl?.value || '');
                    if (!name) {
                        setStatus('List name is required.');
                        return;
                    }

                    if (name.toLowerCase() === 'bucket list') {
                        setStatus('That name is reserved.');
                        return;
                    }

                    if (String(listsActiveListName || '').trim() === name) {
                        closeListsRenameModal();
                        return;
                    }

                    let authedUser = null;
                    try {
                        const { user } = await requireAuthOrThrow();
                        authedUser = user;
                    } catch (_) {
                        setStatus('Please log in first.');
                        openAuthModal();
                        return;
                    }

                    listsRenameBusy = true;
                    setListsActiveListActionsEnabledState();
                    setStatus('Saving…');

                    try {
                        const { data, error } = await supabaseClient
                            .from('Lists')
                            .update({ list_name: name })
                            .eq('user_id', listOwnerId(lid, authedUser.id))
                            .eq('id', lid)
                            .select('id, list_name')
                            .single();
                        if (error) throw error;

                        cachedListsUserId = null;
                        listsActiveListName = String(data?.list_name || name).trim();

                        closeListsRenameModal();
                        await loadListsPage({ reset: true });
                        showToast('List renamed!', { level: 'success' });
                    } catch (err) {
                        const msg = String(err?.message || err);
                        if (/duplicate|unique/i.test(msg)) {
                            setStatus('You already have a list with that name.');
                            return;
                        }
                        setStatus('');
                        showToast(`Rename failed: ${msg}`, { level: 'warn' });
                    } finally {
                        listsRenameBusy = false;
                        setListsActiveListActionsEnabledState();
                    }
                }, { capture: true });
            }
        }

        // ===== Lists overview (Spotify-style cover grid of all lists) =====

        function listsCoverPosterUrl(path) {
            const raw = String(path || '').trim();
            if (!raw) return '';
            return `https://image.tmdb.org/t/p/w342${raw.startsWith('/') ? raw : `/${raw}`}`;
        }

        // The visible art for one list card: the saved cover (an inline data URL,
        // including the branded covers the DB stores for the auto-managed Recs /
        // Bucket List — see lists_branded_covers.sql), else a poster collage of its
        // movies, else a colored fallback tile with an icon.
        function renderListCoverArt(list, info) {
            const cover = String(list?.cover || '').trim();
            if (cover) {
                return `<img class="lists-cover-img" src="${escapeHtml(cover)}" alt="" loading="lazy" decoding="async">`;
            }
            const posters = (info?.posters || []).map(listsCoverPosterUrl).filter(Boolean).slice(0, 4);
            if (posters.length >= 4) {
                return `<div class="lists-cover-collage lists-cover-collage-4">${
                    posters.map(u => `<span style="background-image:url('${escapeHtml(u)}')"></span>`).join('')
                }</div>`;
            }
            if (posters.length >= 1) {
                // 1–3 posters: show them side-by-side as vertical strips.
                return `<div class="lists-cover-collage lists-cover-collage-strip" style="grid-template-columns: repeat(${posters.length}, 1fr);">${
                    posters.map(u => `<span style="background-image:url('${escapeHtml(u)}')"></span>`).join('')
                }</div>`;
            }
            const name = String(list?.list_name || '').trim().toLowerCase();
            const icon = name === 'recs' ? icons.star : icons.film;
            return `<div class="lists-cover-fallback"><span class="lists-cover-fallback-icon">${icon}</span></div>`;
        }

        async function loadListsOverview() {
            const grid = document.getElementById('lists-overview-grid');
            if (!grid) return;

            if (!supabaseClient || !cachedIsAuthed) {
                grid.innerHTML = `<div class="text-gray">Log in to view your lists.</div>`;
                return;
            }

            try {
                const { user } = await requireAuthOrThrow();
                await ensureBucketListForUser({ user_id: user.id }).catch(() => null);
                const allLists = await loadUserLists({ user_id: user.id, force: true });

                // Overview order: Recs first, then Bucket List, then the rest as-is.
                const listRank = (l) => {
                    const n = String(l?.list_name || '').trim().toLowerCase();
                    if (n === 'recs') return 0;
                    if (n === 'bucket list') return 1;
                    return 2;
                };
                const lists = [...allLists].sort((a, b) => listRank(a) - listRank(b));

                // One pass to get movie counts + a few posters per list for the collage
                // fallback. Two simple queries (no FK-embed assumptions): the join rows,
                // then the posters for those movies.
                const infoByList = new Map(); // list_id -> { count, posters: [poster_path] }
                lists.forEach(l => infoByList.set(String(l.id), { count: 0, posters: [], _ids: [] }));

                // Query by list_id (not user_id) so SHARED lists owned by someone
                // else — whose Movie Lists rows carry the owner's user_id — are
                // included too. RLS lets members read these rows.
                const allListIds = lists.map(l => String(l.id)).filter(Boolean);
                const { data: joinRows } = allListIds.length
                    ? await supabaseClient
                        .from('Movie Lists')
                        .select('list_id, movie_id, created_at')
                        .in('list_id', allListIds)
                        .order('created_at', { ascending: false })
                    : { data: [] };

                const wantIds = new Set();
                (Array.isArray(joinRows) ? joinRows : []).forEach(r => {
                    const lid = String(r?.list_id || '');
                    const mid = String(r?.movie_id || '');
                    const info = infoByList.get(lid);
                    if (!info || !mid) return;
                    info.count += 1;
                    if (info._ids.length < 4) { info._ids.push(mid); wantIds.add(mid); }
                });

                if (wantIds.size) {
                    const { data: movieRows } = await supabaseClient
                        .from('Movies')
                        .select('id, poster_path')
                        .in('id', Array.from(wantIds));
                    const posterById = new Map(
                        (Array.isArray(movieRows) ? movieRows : []).map(m => [String(m.id), String(m.poster_path || '')]));
                    infoByList.forEach(info => {
                        info.posters = info._ids.map(id => posterById.get(id)).filter(Boolean);
                    });
                }

                if (!lists.length) {
                    grid.innerHTML = `<div class="text-gray" style="grid-column:1/-1;">No lists yet — tap “New List” to create one.</div>`;
                    return;
                }

                grid.innerHTML = lists.map(l => {
                    const id = String(l?.id || '').trim();
                    const name = String(l?.list_name || '').trim() || 'Untitled';
                    if (!id) return '';
                    const info = infoByList.get(id) || { count: 0, posters: [] };
                    const countLabel = `${info.count} movie${info.count === 1 ? '' : 's'}`;
                    // The Recs cover carries an unseen-recs badge (mirrors the nav/tab-bar
                    // Lists badge); refreshNavBadges/setNavBadge keep it in sync live.
                    const isRecs = name.toLowerCase() === 'recs';
                    const recsUnseen = (typeof lastRecsUnseen === 'number') ? lastRecsUnseen : 0;
                    const recsBadge = isRecs
                        ? `<span id="lists-cover-badge-recs" class="lists-cover-badge${recsUnseen > 0 ? ' show' : ''}">${recsUnseen > 99 ? '99+' : recsUnseen}</span>`
                        : '';
                    // A small "people" chip marks shared (group) lists.
                    const sharedChip = l?.shared
                        ? `<span class="lists-cover-shared" title="Shared list">${icons.users || '👥'}</span>`
                        : '';
                    return `
                        <button type="button" class="lists-cover-card" onclick="openListFromOverview('${escapeHtml(id)}')">
                            <span class="lists-cover-art">
                                ${renderListCoverArt(l, info)}
                                ${recsBadge}
                                ${sharedChip}
                            </span>
                            <span class="lists-cover-name">${escapeHtml(name)}</span>
                            <span class="lists-cover-count">${escapeHtml(countLabel)}</span>
                        </button>
                    `;
                }).filter(Boolean).join('');
                // Reconcile the Recs cover badge against the live unseen-recs count.
                try { refreshNavBadges(); } catch (_) {}
            } catch (err) {
                grid.innerHTML = `<div class="text-gray">Couldn’t load your lists.</div>`;
                emitLog?.(`Lists overview failed: ${err?.message || err}`, 'error');
            }
        }

        // Entry point when the Lists page mounts: deep-link (e.g. "Recs" from a push)
        // opens that list directly; otherwise show the cover-grid overview.
        async function enterListsPage() {
            if (listsPendingSelectName || listsPendingSelectId) {
                listsViewMode = 'detail';
                const ov = document.getElementById('lists-overview');
                const dt = document.getElementById('lists-detail');
                if (ov) ov.style.display = 'none';
                if (dt) dt.style.display = '';
                updateListsFab();
                await loadListsPage({ reset: true }).catch(() => null); // resolves the pending name/id
                return;
            }
            showListsOverview();
        }

        // The floating "+" FAB (body-level). It's contextual: on the overview it creates a
        // NEW LIST; inside a list it opens the ADD-MOVIE modal. Hidden on the auto-managed
        // Recs list (no manual adds).
        function setListsFabVisible(show) {
            const fab = document.getElementById('lists-fab');
            if (fab) fab.style.display = show ? 'flex' : 'none';
        }
        function updateListsFab() {
            const inDetail = listsViewMode === 'detail';
            const isRecs = String(listsActiveListName || '').trim().toLowerCase() === 'recs';
            // Mobile FAB (CSS hides it on desktop): visible everywhere except inside Recs.
            setListsFabVisible(!(inDetail && isRecs));
            // Desktop buttons (CSS hides these on mobile): "New List" on the overview,
            // "Add Movie" inside a non-Recs list.
            const newBtn = document.getElementById('lists-new-list-btn');
            if (newBtn) newBtn.style.display = inDetail ? 'none' : '';
            const addBtn = document.getElementById('lists-add-movie-btn');
            if (addBtn) addBtn.style.display = (inDetail && !isRecs) ? '' : 'none';
        }
        function listsFabAction() {
            if (listsViewMode === 'detail') openListsAddModal();
            else openListsCreateModal();
        }

        // ===== Add-movie-to-list modal (Home-style search + Year/MPA filters) =====
        function openListsAddModal() {
            const lid = String(listsActiveListId || '').trim();
            if (!lid) { showToast('Select a list first.', { level: 'warn' }); return; }
            const overlay = document.getElementById('lists-add-overlay');
            if (!overlay) return;
            const nameEl = document.getElementById('lists-add-title-name');
            if (nameEl) nameEl.textContent = String(listsActiveListName || 'this list').trim() || 'this list';

            const input = document.getElementById('lists-movie-search-input');
            if (input) { input.value = ''; input.disabled = false; }
            listsAddAppliedYear = '';
            listsAddAppliedMpa = '';
            const yEl = document.getElementById('lists-add-year'); if (yEl) yEl.value = '';
            const mEl = document.getElementById('lists-add-mpa'); if (mEl) mEl.value = '';
            try { clearListsSearchUI(); } catch (_) {}

            overlay.style.display = 'flex';
            setTimeout(() => { try { input?.focus(); } catch (_) {} }, 0);
        }
        function closeListsAddModal() {
            const overlay = document.getElementById('lists-add-overlay');
            if (overlay) overlay.style.display = 'none';
            try { clearListsSearchUI(); } catch (_) {}
        }
        function applyListsAddFilters() {
            const yEl = document.getElementById('lists-add-year');
            const mEl = document.getElementById('lists-add-mpa');
            const yRaw = yEl ? String(yEl.value || '').trim() : '';
            listsAddAppliedYear = /^\d{4}$/.test(yRaw) ? yRaw : '';
            listsAddAppliedMpa = mEl ? String(mEl.value || '').trim() : '';
            const input = document.getElementById('lists-movie-search-input');
            const q = String(input?.value || '').trim();
            if (q.length >= 3) handleListsAddMovieSearch(q, { force: true });
        }

        // Mobile header bar: "Lists" on the overview, "Lists - <name>" inside a list.
        // (The desktop nav hides #mobile-page-title, so this is a no-op there.)
        function setListsMobileHeader() {
            try {
                const el = document.getElementById('mobile-page-title');
                if (!el || document.body.dataset.page !== 'lists') return;
                const name = String(listsActiveListName || '').trim();
                el.textContent = (listsViewMode === 'detail' && name) ? `Lists - ${name}` : 'Lists';
            } catch (_) {}
        }

        // Show the overview grid (hide the single-list detail panel).
        function showListsOverview() {
            listsViewMode = 'overview';
            const ov = document.getElementById('lists-overview');
            const dt = document.getElementById('lists-detail');
            if (ov) ov.style.display = '';
            if (dt) dt.style.display = 'none';
            updateListsFab();
            setListsMobileHeader();
            loadListsOverview().catch(() => null);
        }

        // Open one list's movies (the existing detail layout).
        function openListFromOverview(listId, listName) {
            const id = String(listId || '').trim();
            if (!id) return;
            listsActiveListId = id;
            if (listName) listsActiveListName = String(listName);
            listsViewMode = 'detail';
            const ov = document.getElementById('lists-overview');
            const dt = document.getElementById('lists-detail');
            if (ov) ov.style.display = 'none';
            if (dt) dt.style.display = '';
            updateListsFab();
            setListsMobileHeader();
            try {
                const input = document.getElementById('lists-movie-search-input');
                if (input) input.value = '';
                clearListsSearchUI();
            } catch (_) {}
            loadListsPage({ reset: true }).catch(() => null);
            try { window.scrollTo(0, 0); } catch (_) {}
        }

        // Cover upload: trigger the shared hidden file input for a specific list.
        function triggerListCoverPick(listId) {
            if (guardGuestWrite()) return;
            const input = document.getElementById('lists-cover-input');
            if (!input) return;
            input.dataset.listId = String(listId || '').trim();
            input.value = '';
            input.click();
        }

        async function handleListCoverPick(file) {
            const input = document.getElementById('lists-cover-input');
            const listId = String(input?.dataset?.listId || '').trim();
            if (!file || !listId) return;
            if (guardGuestWrite()) return;
            if (listsCoverUploadBusy) return;

            try {
                listsCoverUploadBusy = true;
                showToast('Updating cover…');
                const { user } = await requireAuthOrThrow();
                const dataUrl = await processAccountIconFile(file, 320);

                const { error } = await supabaseClient
                    .from('Lists')
                    .update({ cover: dataUrl })
                    .eq('id', listId)
                    .eq('user_id', listOwnerId(listId, user.id));
                if (error) throw error;

                // Update the cache so the grid re-renders with the new art instantly.
                const row = (cachedLists || []).find(l => String(l.id) === listId);
                if (row) row.cover = dataUrl;
                await loadListsOverview();
                try { refreshListsEditCoverPreview(); } catch (_) {} // if the Edit modal is open
                showToast('Cover updated.', { level: 'success' });
            } catch (err) {
                showToast(`Couldn’t update cover: ${err?.message || err}`, { level: 'error' });
            } finally {
                listsCoverUploadBusy = false;
            }
        }

        async function loadListsPage({ reset = true } = {}) {
            const elLists = document.getElementById('lists-list');
            const elItems = document.getElementById('lists-items');
            const elTitle = document.getElementById('lists-active-title');
            const elSub = document.getElementById('lists-active-subtitle');
            if (!elLists || !elItems) return;

            listsMoviePrefillById = new Map();
            listsPlatformsByMovieId = new Map();

            if (!supabaseClient || !cachedIsAuthed) {
                elLists.innerHTML = `<div class="text-gray">Log in to view your lists.</div>`;
                elItems.innerHTML = `<div class="text-gray">Log in to view your lists.</div>`;
                if (elTitle) elTitle.textContent = 'Lists';
                if (elSub) elSub.textContent = '';
                try { setListsQuickAddEnabledState(); } catch (_) {}
                return;
            }

            if (listsLoading) return;
            listsLoading = true;
            if (reset) {
                elLists.innerHTML = `<div class="text-gray">Loading…</div>`;
                elItems.innerHTML = loadingPlaceholder('posters');
            }

            try {
                const { user } = await requireAuthOrThrow();

                await ensureBucketListForUser({ user_id: user.id }).catch(() => null);
                const lists = await loadUserLists({ user_id: user.id, force: true });

                // Deep-link: open a specific list by id (e.g. a shared-list-add push).
                if (listsPendingSelectId) {
                    const want = lists.find(l => String(l?.id || '') === String(listsPendingSelectId));
                    if (want?.id) listsActiveListId = String(want.id);
                    listsPendingSelectId = '';
                }

                // Deep-link: open a specific list by name (e.g. "Recs" from a notification link).
                if (listsPendingSelectName) {
                    const want = lists.find(l =>
                        String(l?.list_name || '').trim().toLowerCase() === listsPendingSelectName.toLowerCase());
                    if (want?.id) listsActiveListId = String(want.id);
                    listsPendingSelectName = '';
                }

                if (!listsActiveListId) {
                    // Default to the "Recs" list when nothing is selected yet.
                    const recsList = lists.find(l =>
                        String(l?.list_name || '').trim().toLowerCase() === 'recs');
                    listsActiveListId = (recsList?.id) || cachedBucketListId || (lists[0]?.id || null);
                }

                const active = lists.find(l => String(l?.id || '') === String(listsActiveListId || '')) || null;
                listsActiveListName = String(active?.list_name || listsActiveListName || '').trim();

                // If user switches lists (especially into Bucket List), make sure we don't keep incompatible sort/filter state.
                configureListsSortFilterModalForActiveList();

                elLists.innerHTML = lists.length
                    ? `
                        <select id="lists-select" class="input-field" style="width:100%; border-radius: 0.7rem; height: 34px; font-size: 0.84rem; padding: 0 0.65rem;">
                            ${lists.map((l) => {
                                const id = String(l?.id || '').trim();
                                const name = String(l?.list_name || '').trim() || 'Untitled';
                                if (!id) return '';
                                const selected = (String(listsActiveListId || '') === id) ? 'selected' : '';
                                return `<option value="${escapeHtml(id)}" ${selected}>${escapeHtml(name)}</option>`;
                            }).filter(Boolean).join('')}
                        </select>
                    `
                    : `
                        <select id="lists-select" class="input-field" style="width:100%; border-radius: 0.7rem; height: 34px; font-size: 0.84rem; padding: 0 0.65rem;" disabled>
                            <option value="">No lists found</option>
                        </select>
                    `;

                if (elTitle) elTitle.textContent = listsActiveListName || 'List';
                setListsMobileHeader();
                if (elSub) {
                    ensureListsSortFilterStateInitialized();
                    const labels = {
                        sortKey: {
                            rec_added: 'Recommended (newest)',
                            watch_date: 'Watch Date',
                            watch_count: 'Watch Count',
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
                        state: listsSortFilterState,
                        defaults: getDefaultListsSortFilterStateForActiveList(),
                        labels,
                    });
                    elSub.innerHTML = renderSortFilterChipsHtml({ model, namespace: 'lists' });
                }
                try { setListsQuickAddEnabledState(); } catch (_) {}
                try { setListsActiveListActionsEnabledState(); } catch (_) {}
                try { if (listsViewMode === 'detail') updateListsFab(); } catch (_) {}

                if (!listsActiveListId) {
                    elItems.innerHTML = `<div class="text-gray">Create a list to get started.</div>`;
                    try { setListsQuickAddEnabledState(); } catch (_) {}
                    return;
                }

                // ONE query: user_list_items_v1 returns every movie in the active list
                // with all metadata pre-joined (genre / IMDb / director / runtime / MPA /
                // actors / the user's own rating / watch info). This replaces the old
                // Movies fetch + a live per-movie TMDB call for each movie, which is what
                // made this page slow / "never load". See lists_views.sql.
                // For a SHARED list the "Movie Lists" rows carry the list OWNER's
                // user_id, so key the view on the owner (not the viewer) — this is
                // what lets a member read a list owned by someone else. Metadata is
                // movie-level so it's correct regardless of which user_id keys it.
                const viewUserId = isSharedList(listsActiveListId)
                    ? listOwnerId(listsActiveListId, user.id)
                    : user.id;
                const { data: viewRows, error: viewErr } = await supabaseClient
                    .from(LIST_ITEMS_VIEW)
                    .select('*')
                    .eq('user_id', viewUserId)
                    .eq('list_id', listsActiveListId)
                    .order('added_at', { ascending: false });
                if (viewErr) throw viewErr;

                const rows = Array.isArray(viewRows) ? viewRows : [];
                const movieIds = rows.map(r => r?.movie_id).filter(Boolean).map(String);
                if (movieIds.length === 0) {
                    elItems.innerHTML = `<div class="text-gray">No movies in this list yet.</div>`;
                    try { setListsQuickAddEnabledState(); } catch (_) {}
                    try { setListsActiveListActionsEnabledState(); } catch (_) {}
                    return;
                }

                // Build the lookup maps the renderer expects. Each view row already
                // carries movie meta + the user's rating + watch info, so all four maps
                // point at the same row.
                const moviesById = new Map();
                const addedAtByMovieId = new Map();   // drives the "Recommended (newest)" sort
                const ratingsByMovieId = new Map();   // the user's own rating (null if unwatched)
                const latestWatchByMovieId = new Map();
                const libraryByMovieId = new Map();   // watch_count / watch_method / actors
                for (const row of rows) {
                    const mid = String(row?.movie_id || '').trim();
                    if (!mid) continue;
                    moviesById.set(mid, row);
                    if (!addedAtByMovieId.has(mid)) addedAtByMovieId.set(mid, row?.added_at || null);
                    ratingsByMovieId.set(mid, row);
                    if (row?.latest_watch_date) latestWatchByMovieId.set(mid, row.latest_watch_date);
                    libraryByMovieId.set(mid, row);
                }

                // On a SHARED list the view rows carry the OWNER's rating/watch info
                // (not the viewer's), so don't paint a personal rating overlay on the
                // cards — tapping a poster opens the per-member reviews popup instead.
                if (isSharedList(listsActiveListId)) {
                    ratingsByMovieId.clear();
                    latestWatchByMovieId.clear();
                }

                // For the "Recs" list: who recommended each movie (avatars + "+" modal),
                // and which recommendations are new since last view (for highlighting).
                const isRecsList = String(listsActiveListName || '').trim().toLowerCase() === 'recs';
                const recsNewByMovieId = new Set();
                if (isRecsList) {
                    recByDataByMovieId = new Map();
                    let recsHighlightSince = '';
                    // DB-aware so a rec seen on another device doesn't re-glow here.
                    try {
                        const seen = await loadSeenTimesFromDb();
                        recsHighlightSince = effectiveSeen(RECS_LAST_SEEN_KEY, seen.recs);
                    } catch (_) { try { recsHighlightSince = getNotifLastSeen(RECS_LAST_SEEN_KEY); } catch (_) {} }
                    try {
                        const { data: recRows } = await supabaseClient
                            .from('Recommendations')
                            .select('from_user_id, movie_id, created_at')
                            .eq('to_user_id', user.id)
                            .in('movie_id', movieIds);
                        const recDataRows = Array.isArray(recRows) ? recRows : [];
                        const senderIds = Array.from(new Set(recDataRows.map(r => String(r?.from_user_id || '').trim()).filter(Boolean)));
                        const userById = new Map();
                        if (senderIds.length) {
                            let us = null;
                            try {
                                const r1 = await supabaseClient.from('Users').select('id, username, display_name, icon').in('id', senderIds);
                                if (r1.error) throw r1.error; us = r1.data;
                            } catch (e1) {
                                if (/column\s+"?icon"?\s+does\s+not\s+exist/i.test(String(e1?.message || e1))) {
                                    const r2 = await supabaseClient.from('Users').select('id, username, display_name').in('id', senderIds);
                                    if (r2.error) throw r2.error; us = r2.data;
                                } else { throw e1; }
                            }
                            for (const u of (Array.isArray(us) ? us : [])) {
                                const uname = String(u?.username || '').trim();
                                userById.set(String(u.id), {
                                    id: String(u.id),
                                    username: uname || String(u?.display_name || '').trim() || 'someone',
                                    icon: String(u?.icon || '').trim(),
                                });
                            }
                        }
                        for (const r of recDataRows) {
                            const mid = String(r?.movie_id || '').trim();
                            const fid = String(r?.from_user_id || '').trim();
                            if (!mid || !fid) continue;
                            const info = userById.get(fid) || { id: fid, username: 'someone', icon: '' };
                            if (!recByDataByMovieId.has(mid)) recByDataByMovieId.set(mid, []);
                            const arr = recByDataByMovieId.get(mid);
                            if (!arr.some(x => x.id === info.id)) arr.push(info);
                            // New recommendation since last view?
                            if (recsHighlightSince && String(r?.created_at || '') > recsHighlightSince) {
                                recsNewByMovieId.add(mid);
                            }
                        }
                    } catch (_) { /* table may not exist pre-migration */ }
                    try { markRecsSeen(); } catch (_) {}
                }

                // Fetch watch platforms for these movies (best-effort; do not fail page).
                const platformsByMovieId = new Map();
                try {
                    const { data: mpRows, error: mpErr } = await supabaseClient
                        .from('Movie Platforms')
                        .select('movie_id, platform_id')
                        .in('movie_id', movieIds);
                    if (!mpErr) {
                        const rows = Array.isArray(mpRows) ? mpRows : [];
                        const platformIds = Array.from(new Set(rows.map(r => r?.platform_id).filter(Boolean)));

                        let platformNameById = new Map();
                        if (platformIds.length > 0) {
                            const { data: plats, error: platsErr } = await supabaseClient
                                .from('Platforms')
                                .select('id, name')
                                .in('id', platformIds);
                            if (!platsErr) {
                                platformNameById = new Map(
                                    (Array.isArray(plats) ? plats : [])
                                        .filter(p => p?.id)
                                        .map(p => [p.id, normalizePlatformName(p?.name) || String(p?.name || '').trim()]),
                                );
                            }
                        }

                        for (const r of rows) {
                            const mid = String(r?.movie_id || '').trim();
                            const pid = r?.platform_id;
                            if (!mid || pid === null || pid === undefined) continue;
                            const pname = platformNameById.get(pid);
                            if (!pname) continue;
                            const arr = platformsByMovieId.get(mid) || [];
                            arr.push(pname);
                            platformsByMovieId.set(mid, arr);
                        }

                        // De-dupe + keep stable ordering.
                        for (const [mid, arr] of platformsByMovieId.entries()) {
                            platformsByMovieId.set(mid, uniqStrings(arr));
                        }
                    }
                } catch (_) {
                    // Ignore platform fetch errors.
                }

                // Promote to global map for the Watch Options modal.
                listsPlatformsByMovieId = platformsByMovieId;

                // Compute facets for Lists filters.
                try {
                    const decades = new Set();
                    const mpas = new Set();
                    const genres = new Set();
                    const watchMethods = new Set();
                    const months = new Set();
                    let maxWatchCount = 0;

                    for (const id of movieIds) {
                        const movie = moviesById.get(id) || null;
                        if (!movie) continue;

                        const dec = listsDecadeLabelFromYear(movie?.release_year);
                        if (dec) decades.add(dec);

                        const mpa = normalizeMovieFieldValue(movie?.mpa_rating ?? movie?.mpa);
                        if (mpa) mpas.add(mpa);

                        for (const g of listsNormalizeGenresToArray(movie)) {
                            if (g) genres.add(g);
                        }

                        const lib = libraryByMovieId.get(String(id)) || null;
                        const wm = String(lib?.watch_method || '').trim();
                        if (wm) watchMethods.add(wm.toLowerCase().includes('theater') ? 'In Theater' : 'At Home');

                        const wc = Number(lib?.watch_count ?? 0);
                        if (Number.isFinite(wc) && wc > maxWatchCount) maxWatchCount = wc;

                        const watchRaw = String(latestWatchByMovieId.get(String(id)) || '').trim();
                        if (watchRaw) {
                            const d = new Date(watchRaw.includes('T') ? watchRaw : `${watchRaw}T00:00:00`);
                            if (!Number.isNaN(d.getTime())) {
                                const month = String(d.getMonth() + 1).padStart(2, '0');
                                months.add(`${d.getFullYear()}-${month}`);
                            }
                        }
                    }

                    const decadeArr = Array.from(decades);
                    decadeArr.sort((a, b) => {
                        const an = Number(String(a).replace(/\D/g, ''));
                        const bn = Number(String(b).replace(/\D/g, ''));
                        if (Number.isFinite(an) && Number.isFinite(bn)) return bn - an;
                        return String(b).localeCompare(String(a));
                    });

                    const sortedMonths = Array.from(months).sort((a, b) => b.localeCompare(a));

                    // Distinct platforms present on this list's movies (for the Watch
                    // options multi-select filter), from the already-loaded platform map.
                    const platforms = new Set();
                    listsPlatformsByMovieId.forEach((arr) => {
                        (Array.isArray(arr) ? arr : []).forEach((p) => {
                            const name = String(p || '').trim();
                            if (name) platforms.add(name);
                        });
                    });

                    listsFacetOptions = {
                        decades: decadeArr,
                        mpas: Array.from(mpas).sort((a, b) => a.localeCompare(b)),
                        genres: Array.from(genres).sort((a, b) => a.localeCompare(b)),
                        watchMethods: Array.from(watchMethods).sort((a, b) => a.localeCompare(b)),
                        timeframes: sortedMonths,
                        platforms: Array.from(platforms).sort((a, b) => a.localeCompare(b)),
                    };
                    listsWatchCountMax = Math.max(0, Number(maxWatchCount) || 0);
                } catch (_) {
                    // Ignore facet computation errors.
                }

                ensureListsSortFilterStateInitialized();

                // Refresh subtitle now that platform facets exist.
                if (elSub) {
                    const labels = {
                        sortKey: {
                            rec_added: 'Recommended (newest)',
                            watch_date: 'Watch Date',
                            watch_count: 'Watch Count',
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
                        state: listsSortFilterState,
                        defaults: getDefaultListsSortFilterStateForActiveList(),
                        labels,
                    });
                    elSub.innerHTML = renderSortFilterChipsHtml({ model, namespace: 'lists' });
                }

                const items = movieIds.map((id) => {
                    const movie = moviesById.get(id) || null;
                    const r = ratingsByMovieId.get(String(id)) || null;
                    const genresArr = listsNormalizeGenresToArray(movie);
                    return {
                        movie_id: String(id),
                        added_at: addedAtByMovieId.get(String(id)) || null,
                        title: String(movie?.title || '').trim() || 'Untitled',
                        release_year: movie?.release_year ?? null,
                        director: normalizeMovieFieldValue(movie?.director ?? movie?.director_name),
                        actor: normalizeMovieFieldValue((libraryByMovieId.get(String(id)) || {})?.actors),
                        mpa_rating: normalizeMovieFieldValue(movie?.mpa_rating ?? movie?.mpa),
                        genre: normalizeMovieFieldValue(movie?.genre),
                        genresArr,
                        imdb_rating_pct: movie?.imdb_rating_pct ?? movie?.imdb_pct ?? movie?.imdb_rating ?? movie?.imdb,
                        latest_watch_date: latestWatchByMovieId.get(String(id)) || null,
                        watch_count: Number((libraryByMovieId.get(String(id)) || {})?.watch_count ?? 0) || 0,
                        watch_method: normalizeMovieFieldValue((libraryByMovieId.get(String(id)) || {})?.watch_method),
                        overall_rating: r?.overall_rating ?? null,
                        sound_rating: r?.sound_rating ?? null,
                        pacing_rating: r?.pacing_rating ?? null,
                        imagery_rating: r?.imagery_rating ?? null,
                        acting_rating: r?.acting_rating ?? null,
                        plot_rating: r?.plot_rating ?? null,
                        dialogue_rating: r?.dialogue_rating ?? null,
                        tier: String(r?.tier || '').trim(),
                    };
                });

                const visibleItems = applyListsSortFilter(items, listsSortFilterState);

                // Build EVERY card's HTML (the map also fully populates
                // listsMoviePrefillById for all items), but only the first
                // LISTS_RENDER_PAGE get injected now; the rest stream in on scroll.
                const cardHtmlArr = visibleItems
                    .map((it) => {
                        const id = String(it?.movie_id || '').trim();
                        const movie = moviesById.get(id) || null;
                        const title = String(movie?.title || '').trim() || 'Untitled';
                        const year = (movie?.release_year === null || movie?.release_year === undefined) ? '' : String(movie.release_year);
                        const tmdb_id = Number(movie?.tmdb_id);
                        const poster_path = String(movie?.poster_path || '').trim();
                        const posterUrl = poster_path ? `https://image.tmdb.org/t/p/w500${poster_path.startsWith('/') ? poster_path : `/${poster_path}`}` : '';

                        const directorVal = normalizeMovieFieldValue(movie?.director ?? movie?.director_name);
                        const genreVal = (() => {
                            if (Array.isArray(movie?.genres) && movie.genres.length) {
                                return normalizeMovieFieldValue(movie.genres.map(s => String(s).trim()).filter(Boolean).join(', '));
                            }
                            return normalizeMovieFieldValue(movie?.genre);
                        })();
                        const imdbVal = (() => {
                            const raw = (movie?.imdb_rating_pct ?? movie?.imdb_pct ?? movie?.imdb_rating ?? movie?.imdb);
                            const n = parsePercentLike(raw, { imdb: true });
                            return (n !== null && n !== undefined) ? formatPctForDisplay(n) : '';
                        })();

                        const metaLines = [];
                        if (directorVal) metaLines.push({ label: 'Director', value: directorVal });
                        if (genreVal) metaLines.push({ label: 'Genres', value: genreVal });
                        if (imdbVal) metaLines.push({ label: 'IMDb', value: imdbVal });

                        const platforms = platformsByMovieId.get(String(id)) || [];

                        // Cache a prefill object for poster-click navigation to the Log New Entry flow.
                        listsMoviePrefillById.set(String(id), {
                            ...(movie || {}),
                            id: String(id),
                            title,
                            year: year || null,
                            release_year: movie?.release_year ?? null,
                            director: directorVal || normalizeMovieFieldValue(movie?.director ?? movie?.director_name) || '',
                            genre: genreVal || normalizeMovieFieldValue(movie?.genre) || '',
                            imdb: imdbVal || '',
                            tmdb_id: Number.isFinite(tmdb_id) ? tmdb_id : undefined,
                            poster_path: poster_path || movie?.posterPath || movie?.poster_url || movie?.posterUrl || '',
                            mpa: String(movie?.mpa_rating ?? movie?.mpa ?? '').trim(),
                            runtime: (() => {
                                const n = Number(movie?.runtime_minutes ?? movie?.runtime);
                                return Number.isFinite(n) ? n : (movie?.runtime_minutes ?? movie?.runtime ?? null);
                            })(),
                            isSeries: (movie?.is_series ?? movie?.isSeries) === true,
                            detailsReadonly: false,
                        });

                        // Hover-flip back face (mirrors My Movies): Director / Runtime / MPA / Genre / IMDb.
                        const posterBackDetailsHtml = (() => {
                            const lines = [];
                            const runtimeBackVal = (() => {
                                const n = Number(movie?.runtime_minutes ?? movie?.runtime);
                                if (!Number.isFinite(n) || n <= 0) return '';
                                const h = Math.floor(n / 60), m = n % 60;
                                let out = '';
                                if (h > 0) out += `${h}h`;
                                if (m > 0 || h === 0) out += `${h > 0 ? ' ' : ''}${m}m`;
                                return out.trim();
                            })();
                            const mpaBackVal = String(movie?.mpa_rating ?? movie?.mpa ?? '').trim();
                            const genreBackHtml = (() => {
                                const raw = String(genreVal || '').trim();
                                if (!raw) return '';
                                const parts = raw.split(/[,|;]/g).map(s => String(s).trim()).filter(Boolean);
                                return parts.length ? parts.map(p => escapeHtml(p)).join('<br>') : '';
                            })();
                            if (directorVal) lines.push(`<div class="library-poster-back-line"><span class="library-poster-back-key">Director</span><span class="library-poster-back-val">${escapeHtml(directorVal)}</span></div>`);
                            if (runtimeBackVal) lines.push(`<div class="library-poster-back-line"><span class="library-poster-back-key">Runtime</span><span class="library-poster-back-val">${escapeHtml(runtimeBackVal)}</span></div>`);
                            if (mpaBackVal) lines.push(`<div class="library-poster-back-line"><span class="library-poster-back-key">MPA</span><span class="library-poster-back-val">${escapeHtml(mpaBackVal)}</span></div>`);
                            if (genreBackHtml) lines.push(`<div class="library-poster-back-line"><span class="library-poster-back-key">Genre</span><span class="library-poster-back-val">${genreBackHtml}</span></div>`);
                            if (imdbVal) lines.push(`<div class="library-poster-back-line"><span class="library-poster-back-key">IMDb</span><span class="library-poster-back-val">${escapeHtml(imdbVal)}</span></div>`);
                            return lines.join('');
                        })();

                        return `
                            <div class="lists-movie-card${recsNewByMovieId.has(String(id)) ? ' is-new' : ''}">
                                <div class="lists-poster-wrap">
                                    <button type="button" class="lists-poster-btn" data-lists-action="open_movie" data-movie-id="${escapeHtml(String(id))}" title="Open entry">
                                        <div class="lists-poster" style="width:100%; aspect-ratio:2/3;">
                                            <div class="library-poster-flip">
                                                <div class="library-poster-flip-inner">
                                                    <div class="library-poster-face library-poster-front">
                                                        ${posterUrl
                                                            ? `<img src="${posterUrl}" loading="lazy" decoding="async" alt="${escapeHtml(title)}" style="display:block; width:100%; height:100%; object-fit:cover;" onerror="this.style.display='none';">`
                                                            : `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; color: var(--text-muted); font-size: 12px;">No poster</div>`}
                                                    </div>
                                                    <div class="library-poster-face library-poster-back">
                                                        ${posterBackDetailsHtml || `<div class="text-xs text-gray" style="text-align:center;">No details</div>`}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </button>
                                    <button type="button" class="lists-remove-x" title="Remove from list" data-lists-action="remove_movie" data-list-id="${escapeHtml(String(listsActiveListId))}" data-movie-id="${escapeHtml(String(id))}">&times;</button>
                                </div>

                                <div style="width:100%; display:flex; flex-direction:column; align-items:center; gap:0.3rem;">
                                    <div class="lists-title">
                                        ${escapeHtml(title)}
                                        ${year ? ` <span class=\"lists-title-year\">(${escapeHtml(year)})</span>` : ''}
                                    </div>
                                    ${(() => {
                                        const recs = recByDataByMovieId.get(String(id)) || [];
                                        if (!recs.length) return '';
                                        const first = recs[0];
                                        const avatar = renderUserIconHtml(first.icon, 42);
                                        if (recs.length === 1) {
                                            return `<div class="lists-rec-by" title="Recommended by @${escapeHtml(first.username)}">${avatar}</div>`;
                                        }
                                        return `<button type="button" class="lists-rec-by lists-rec-by-multi" title="Recommended by ${recs.length} people" onclick="event.stopPropagation(); openRecByModal('${escapeHtml(String(id))}')">${avatar}<span class="lists-rec-plus">+</span></button>`;
                                    })()}
                                </div>
                            </div>
                        `;
                    });

                const firstCards = cardHtmlArr.slice(0, LISTS_RENDER_PAGE);
                listsPendingCardsHtml = cardHtmlArr.slice(LISTS_RENDER_PAGE);
                elItems.innerHTML = `
                    <div class="lists-grid">${firstCards.join('')}</div>
                `;
                // Stream the rest in as the user scrolls toward the bottom.
                renderListsMoreCards({ initial: true });
            } catch (err) {
                const msg = String(err?.message || err);
                elLists.innerHTML = `<div class="text-gray">Failed to load lists: ${escapeHtml(msg)}</div>`;
                elItems.innerHTML = `<div class="text-gray">Failed to load list items.</div>`;
            } finally {
                try { setListsQuickAddEnabledState(); } catch (_) {}
                listsLoading = false;
                try { setListsActiveListActionsEnabledState(); } catch (_) {}
            }
        }

        // Lists detail infinite scroll: append the next page of already-built card HTML
        // (from listsPendingCardsHtml) into the grid and keep a bottom sentinel observed
        // until everything's rendered. Pure client-side windowing — no extra DB calls.
        function renderListsMoreCards({ initial = false } = {}) {
            const elItems = document.getElementById('lists-items');
            if (!elItems) return;
            const grid = elItems.querySelector('.lists-grid');

            if (!initial && grid && listsPendingCardsHtml.length) {
                const next = listsPendingCardsHtml.splice(0, LISTS_RENDER_PAGE);
                grid.insertAdjacentHTML('beforeend', next.join(''));
            }

            let sentinel = document.getElementById('lists-load-sentinel');
            if (!listsPendingCardsHtml.length) {
                if (sentinel) sentinel.remove();
                detachInfiniteScroll();
                return;
            }
            if (!sentinel) {
                sentinel = document.createElement('div');
                sentinel.id = 'lists-load-sentinel';
                sentinel.className = 'infinite-sentinel';
            }
            elItems.appendChild(sentinel); // keep it last, after the grid
            attachInfiniteScroll(sentinel, () => { renderListsMoreCards(); });
        }

