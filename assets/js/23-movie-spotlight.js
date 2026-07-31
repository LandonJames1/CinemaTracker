        // =====================================================================
        // Movie Spotlight modal — a rich, exploration-focused movie detail popup.
        //
        // Opened from the Home search dropdown (renderHomeSearchResults) and the
        // "Trending Now" marquee cards (renderTrendingNow). Instead of just dumping
        // a title into the search bar, picking a movie now opens a cinematic modal:
        // a backdrop hero + poster, all the metadata (MPA / runtime / director /
        // cast / IMDb rating + vote count / release date / genres / overview),
        // organized into Overview / Cast / Details tabs, plus the same action row
        // as the home page (Log / Update / Add to List / Recommend).
        //
        // Details come from the swift-api `details` action (callSwiftApiGetMovieDetails),
        // which now also returns backdrop_path / tagline / release_date /
        // vote_average / cast_detailed. The base movie object from search already
        // carries title/year/genres/poster_path, so the hero paints instantly and
        // is enriched once details resolve.
        // =====================================================================

        let movieSpotlightState = {
            movie: null,
            details: null,
            tab: 'details',
            loading: false,
            rated: false,
            token: 0,
            reviews: null,        // null = not loaded yet; [] = loaded, none found
            reviewsLoading: false,
            sharedListId: null,   // set ONLY when opened from a SHARED list → its members' reviews join the User Reviews tab
            tasteScore: null,     // set ONLY when opened from the "You Might Like" home strip → drives the "% match" tile
        };

        function spotlightTmdbImg(path, size) {
            const p = String(path || '').trim();
            return p ? `https://image.tmdb.org/t/p/${size}${p}` : '';
        }

        function spotlightFormatRuntime(m) {
            const n = Number(m);
            if (!Number.isFinite(n) || n <= 0) return '';
            const h = Math.floor(n / 60);
            const mm = n % 60;
            return h ? `${h}h ${mm}m` : `${mm}m`;
        }

        function spotlightFormatDate(raw) {
            const s = String(raw || '').trim();
            if (!s) return '';
            const d = new Date(s + (s.length === 10 ? 'T00:00:00' : ''));
            if (isNaN(d.getTime())) return s;
            // MM/DD/YY (zero-padded month/day, 2-digit year)
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            const yy = String(d.getFullYear()).slice(-2);
            return `${mm}/${dd}/${yy}`;
        }

        // Merge a lightweight base movie (search/trending/list prefill) with the fetched
        // details into one normalized object the renderer reads from. Pure — so other
        // surfaces (e.g. the in-list "Movie Details" popup) can reuse it. Base values are
        // used as fallbacks when details are missing/failed, so the cards still populate.
        function spotlightMergeMovie(movie, details) {
            const m = movie || {};
            const d = (details && !details._error) ? details : {};
            const genres = Array.isArray(d.genres) && d.genres.length
                ? d.genres
                : (Array.isArray(m.genres) ? m.genres : String(m.genre || '').split(',').map(s => s.trim()).filter(Boolean));
            return {
                tmdb_id: Number(m.tmdb_id ?? m.id ?? d.tmdb_id) || null,
                title: String(d.title || m.title || '').trim() || 'Untitled',
                year: d.year ?? m.year ?? null,
                tagline: String(d.tagline || '').trim(),
                overview: String(d.overview || m.overview || '').trim(),
                runtime: d.runtime ?? m.runtime ?? null,
                mpa: String(d.mpa || m.mpa || '').trim(),
                director: String(d.director || m.director || '').trim(),
                director_profile_path: d.director_profile_path || m.director_profile_path || null,
                cast: Array.isArray(d.cast) ? d.cast : [],
                cast_detailed: Array.isArray(d.cast_detailed) ? d.cast_detailed : [],
                genres,
                poster_path: d.poster_path || m.poster_path || null,
                backdrop_path: d.backdrop_path || m.backdrop_path || null,
                watch_providers: (Array.isArray(d.watch_providers) && d.watch_providers.length)
                    ? d.watch_providers
                    : (Array.isArray(m.watch_providers) ? m.watch_providers
                        : (Array.isArray(m.platforms) ? m.platforms : [])),
                release_date: d.release_date || m.release_date || null,
                imdb_rating_pct: (typeof d.imdb_rating_pct === 'number') ? d.imdb_rating_pct
                    : (typeof m.imdb_rating_pct === 'number' ? m.imdb_rating_pct : null),
                imdb_votes: (typeof d.imdb_votes === 'number') ? d.imdb_votes
                    : (typeof m.imdb_votes === 'number' ? m.imdb_votes : null),
                vote_average: (typeof d.vote_average === 'number') ? d.vote_average : null,
                is_series: d.isSeries ?? m.isSeries ?? null,
            };
        }

        function spotlightMerged() {
            return spotlightMergeMovie(movieSpotlightState.movie, movieSpotlightState.details);
        }

        // Builds the Details-tab card stack (Director + IMDb row, Genre tile, MPA/Runtime/
        // Released mini cards) from a merged movie. Reused by the in-list movie popup so
        // its "Movie Details" view matches the Home spotlight EXACTLY.
        function spotlightDetailsCardsHtml(mv) {
            const votes = formatVotes(mv.imdb_votes);
            const imdbPct = (typeof mv.imdb_rating_pct === 'number' && mv.imdb_rating_pct > 0)
                ? Math.round(mv.imdb_rating_pct) : null;

            // --- Row 1: Director (with headshot) + IMDb ---
            let directorHtml = '';
            if (mv.director) {
                const photo = spotlightTmdbImg(mv.director_profile_path, 'w185');
                const pic = photo
                    ? `<div class="ms-director-photo"><img src="${photo}" alt="" loading="lazy" onerror="this.style.display='none'; this.parentElement.classList.add('ms-noimg');">${icons.users}</div>`
                    : `<div class="ms-director-photo ms-noimg">${icons.users}</div>`;
                directorHtml = `
                    <div class="ms-director-card">
                        ${pic}
                        <div class="ms-director-text">
                            <div class="ms-stat-label">Director</div>
                            <div class="ms-director-name">${escapeHtml(mv.director)}</div>
                        </div>
                    </div>`;
            }
            const imdbHtml = imdbPct !== null
                ? `<div class="ms-imdb-card">
                        <div class="ms-stat-ico">${icons.star}</div>
                        <div class="ms-imdb-num">${imdbPct}<span>%</span></div>
                        <div class="ms-stat-label">IMDb${votes ? ` · ${escapeHtml(votes)}` : ''}</div>
                   </div>`
                : '';
            // "% match" tile — shown only when this spotlight was opened from the home
            // "You Might Like" strip (movieSpotlightState.tasteScore is set). Reuses
            // the AI Picks / Discover tier-colored match styling so it looks native.
            const matchScore = movieSpotlightState.tasteScore;
            const matchHtml = (typeof matchScore === 'number' && Number.isFinite(matchScore))
                ? `<div class="ms-match-row" data-tier="${(typeof aiMatchTier === 'function') ? aiMatchTier(matchScore) : 'mid'}">
                        <span class="ms-match-num">${matchScore}%</span>
                        <span class="ms-match-label">match for your taste</span>
                   </div>`
                : '';
            const topRow = (directorHtml || imdbHtml)
                ? `<div class="ms-top-row">${directorHtml}${imdbHtml}</div>` : '';

            // --- Row 2: Genre (full width) ---
            const genreHtml = mv.genres.length
                ? `<div class="ms-stats"><div class="ms-stat"><div class="ms-stat-ico">${icons.film}</div><div class="ms-stat-text"><div class="ms-stat-label">Genre</div><div class="ms-stat-val">${escapeHtml(mv.genres.join(', '))}</div></div></div></div>`
                : '';

            // --- Row 3: MPA / Runtime / Release Date (compact 3-up) ---
            const mini = (icon, val, label) => val
                ? `<div class="ms-stat"><div class="ms-stat-ico">${icon}</div><div class="ms-stat-text"><div class="ms-stat-val">${escapeHtml(String(val))}</div><div class="ms-stat-label">${escapeHtml(label)}</div></div></div>`
                : '';
            const cards = [
                mini(icons.info, mv.mpa, 'Rated'),
                mini(icons.clock, spotlightFormatRuntime(mv.runtime), 'Runtime'),
                mini(icons.calendar, spotlightFormatDate(mv.release_date) || (mv.year ? String(mv.year) : ''), 'Released'),
            ].filter(Boolean).join('');
            const cardsHtml = cards ? `<div class="ms-stats-mini">${cards}</div>` : '';

            const html = `${matchHtml}${topRow}${genreHtml}${cardsHtml}`;
            return html.trim() ? html : `<p class="ms-empty">No additional details available.</p>`;
        }

        // Builds the "Where to Watch" tab — the color-coded streaming/watch-option pills:
        // deduped to one pill per canonical service, ordered by popularity, brand-tinted via
        // platformBrandTheme. Reuses the platform helpers from 04-lists.js (loads first).
        function spotlightWatchOptionsHtml(mv) {
            const canonMap = new Map();
            (Array.isArray(mv.watch_providers) ? mv.watch_providers : []).forEach((p) => {
                const raw = String(p || '').trim();
                if (!raw) return;
                const canon = platformCanonicalLabel(raw);
                const key = canon.toLowerCase();
                if (key && !canonMap.has(key)) canonMap.set(key, canon);
            });
            const platforms = Array.from(canonMap.values()).sort(comparePlatformsByPopularity);
            if (!platforms.length) {
                return `<p class="ms-empty">No watch options found for this movie yet.</p>`;
            }
            const pills = platforms.map((p) => {
                const full = normalizePlatformName(p);
                const label = platformShortLabel(full) || full;
                const theme = platformBrandTheme(full);
                const pillStyle = `background: ${theme.bg}; border: 1px solid ${theme.border}; color: ${theme.text};`;
                return `
                    <div style="display:flex; align-items:center; justify-content:center; padding:0.7rem; border-radius:0.85rem; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.10);">
                        <span style="display:inline-flex; align-items:center; padding:0.28rem 0.6rem; border-radius:999px; font-weight:900; font-size:0.88rem; line-height:1; ${pillStyle}">${escapeHtml(label)}</span>
                    </div>`;
            }).join('');
            return `<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:10px;">${pills}</div>`;
        }

        // ---- "User Reviews" tab -------------------------------------------------------
        // Review cards for people the viewer FOLLOWS who have reviewed this movie — plus,
        // when the spotlight was opened from a SHARED list, that list's MEMBERS (a co-owner
        // isn't necessarily someone you follow, and their take is the whole point of a group
        // list). Mirrors the Feed card look/behavior (collapsed → tap to expand for
        // sub-ratings/quote/notes) but WITHOUT the react + bucket-list buttons. Works no
        // matter where the spotlight was opened from — it resolves the catalog movie id from
        // the spotlight's movie (uuid id, or via tmdb_id), then reads those users' Movie Ratings.
        async function loadSpotlightReviews(token) {
            movieSpotlightState.reviewsLoading = true;
            try {
                if (!supabaseClient) { finishSpotlightReviews(token, []); return; }
                const { data: sess } = await supabaseClient.auth.getSession();
                const meId = String(sess?.session?.user?.id || '').trim();
                if (!meId) { finishSpotlightReviews(token, []); return; }

                const movie_id = await resolveDbMovieIdFromSelectedMovie(movieSpotlightState.movie);
                if (token !== movieSpotlightState.token) return;
                if (!movie_id) { finishSpotlightReviews(token, []); return; }

                // Whose reviews to show: people I follow + (on a shared list) its members,
                // always excluding myself.
                let followed = [];
                try { await loadMyFollowingIds(); followed = Array.from(feedFollowingIds || []); } catch (_) {}

                let memberIds = [];
                const sharedListId = String(movieSpotlightState.sharedListId || '').trim();
                if (sharedListId && typeof getSharedListMemberIds === 'function') {
                    try { memberIds = await getSharedListMemberIds(sharedListId); } catch (_) {}
                    if (token !== movieSpotlightState.token) return;
                }
                memberIds = Array.from(new Set(memberIds.map(x => String(x || '').trim())))
                    .filter(x => x && x !== meId);

                const reviewerIds = Array.from(new Set(followed.map(x => String(x || '').trim()).concat(memberIds)))
                    .filter(x => x && x !== meId);
                if (!reviewerIds.length) { finishSpotlightReviews(token, []); return; }

                // Their reviews of this movie (only rows that actually carry a rating).
                const cols = 'id, user_id, movie_id, overall_rating, tier, watch_date, fav_quote, notes, sound_rating, pacing_rating, imagery_rating, acting_rating, plot_rating, dialogue_rating';
                const { data: rrows, error: rErr } = await supabaseClient
                    .from('Movie Ratings')
                    .select(cols)
                    .eq('movie_id', movie_id)
                    .in('user_id', reviewerIds);
                if (rErr) throw rErr;
                if (token !== movieSpotlightState.token) return;

                const hasRating = (r) => String(r?.overall_rating ?? '').trim() !== '' || dashNormalizeTierLabel(r?.tier);
                const reviews = (Array.isArray(rrows) ? rrows : []).filter(hasRating);

                // Shared-list members aren't necessarily people the viewer follows, and
                // "Movie Ratings" RLS only exposes own / followed / recommender rows — so
                // any member the query above couldn't see is read through the owner-rights
                // library view (the same source the old shared-list reviews popup used).
                const seenUsers = new Set(reviews.map(r => String(r?.user_id || '').trim()));
                const missingMembers = memberIds.filter(id => !seenUsers.has(id));
                if (missingMembers.length) {
                    try {
                        const { data: vrows } = await supabaseClient
                            .from(LIBRARY_ITEMS_VIEW)
                            .select('user_id, movie_id, overall_rating, tier, latest_watch_date, fav_quote, notes, sound_rating, pacing_rating, imagery_rating, acting_rating, plot_rating, dialogue_rating')
                            .eq('movie_id', movie_id)
                            .in('user_id', missingMembers);
                        if (token !== movieSpotlightState.token) return;
                        for (const v of (Array.isArray(vrows) ? vrows : [])) {
                            if (!hasRating(v)) continue;
                            reviews.push({ ...v, watch_date: v?.latest_watch_date ?? null });
                        }
                    } catch (_) {}
                }

                if (!reviews.length) { finishSpotlightReviews(token, []); return; }

                // Reviewer display info (username + icon).
                const ids = Array.from(new Set(reviews.map(r => String(r?.user_id || '').trim()).filter(Boolean)));
                const infoById = new Map();
                try {
                    let us = null;
                    try {
                        const r1 = await supabaseClient.from('Users').select('id, username, display_name, icon').in('id', ids);
                        if (r1.error) throw r1.error; us = r1.data;
                    } catch (e1) {
                        if (/column\s+"?icon"?\s+does\s+not\s+exist/i.test(String(e1?.message || e1))) {
                            const r2 = await supabaseClient.from('Users').select('id, username, display_name').in('id', ids);
                            if (!r2.error) us = r2.data;
                        }
                    }
                    for (const u of (Array.isArray(us) ? us : [])) {
                        const uid = String(u?.id || '').trim();
                        if (uid) infoById.set(uid, u);
                    }
                } catch (_) {}
                if (token !== movieSpotlightState.token) return;

                // Sort: highest overall first (nulls last).
                reviews.sort((a, b) => (Number(b?.overall_rating) || -1) - (Number(a?.overall_rating) || -1));
                for (const r of reviews) {
                    const info = infoById.get(String(r?.user_id || '').trim()) || {};
                    r._username = String(info?.username || '').trim();
                    r._icon = String(info?.icon || '').trim();
                }
                finishSpotlightReviews(token, reviews);
            } catch (e) {
                try { emitLog('warn', 'Spotlight reviews load failed: ' + String(e?.message || e)); } catch (_) {}
                finishSpotlightReviews(token, []);
            }
        }

        function finishSpotlightReviews(token, reviews) {
            if (token !== movieSpotlightState.token) return;
            movieSpotlightState.reviews = Array.isArray(reviews) ? reviews : [];
            movieSpotlightState.reviewsLoading = false;
            // Re-emit the tab bar so the "User Reviews" tab appears (≥1 follow review)
            // or stays hidden (none).
            const tabsEl = document.getElementById('ms-tabs');
            if (tabsEl) tabsEl.outerHTML = spotlightTabsHtml(movieSpotlightState.tab);
            // Repaint the panel only if the reviews tab is still showing.
            if (movieSpotlightState.tab === 'reviews') {
                const panel = document.getElementById('ms-panel');
                if (panel) panel.innerHTML = spotlightPanelHtml('reviews');
            }
        }

        // Standalone KPI at the top of the User Reviews tab: the combined AVERAGE overall
        // rating across everyone shown — the viewer's follows, plus the list members when
        // the spotlight was opened from a shared list (which is why the sub-label drops the
        // "you follow" qualifier in that case).
        function spotlightReviewsAvgHtml(reviews) {
            const nums = (Array.isArray(reviews) ? reviews : [])
                .map(r => Number(r?.overall_rating))
                .filter(n => Number.isFinite(n));
            if (!nums.length) return '';
            const avg = Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
            const n = nums.length;
            const who = movieSpotlightState.sharedListId ? '' : ' you follow';
            return `
                <div class="ms-reviews-kpi">
                    <div class="ms-reviews-kpi-num">${avg}<span>%</span></div>
                    <div class="ms-reviews-kpi-meta">
                        <div class="ms-reviews-kpi-label">Avg overall rating</div>
                        <div class="ms-reviews-kpi-sub">from ${n} ${n === 1 ? 'person' : 'people'}${who}</div>
                    </div>
                </div>`;
        }

        // One review card — Feed-style: collapsed head (poster-less; reviewer avatar +
        // name + score/tier + watch date) that expands to sub-ratings / quote / notes.
        function spotlightReviewCardHtml(r) {
            const username = r?._username ? `@${String(r._username).replace(/^@+/, '')}` : 'User';
            const overall = dashFormatScoreWhole(r?.overall_rating);
            const tierLabel = dashNormalizeTierLabel(r?.tier);
            const watched = String(r?.watch_date ?? '').trim();
            const quote = String(r?.fav_quote ?? '').trim();
            const notes = String(r?.notes ?? '').trim();

            const subRatingRows = [
                { k: 'Sound', v: dashFormatScoreWhole(r?.sound_rating) },
                { k: 'Pace', v: dashFormatScoreWhole(r?.pacing_rating) },
                { k: 'Imagery', v: dashFormatScoreWhole(r?.imagery_rating) },
                { k: 'Acting', v: dashFormatScoreWhole(r?.acting_rating) },
                { k: 'Plot', v: dashFormatScoreWhole(r?.plot_rating) },
                { k: 'Dialogue', v: dashFormatScoreWhole(r?.dialogue_rating) },
            ].filter(x => String(x.v || '').trim());

            const hasDetails = subRatingRows.length || quote || notes;
            return `
                <div class="glass-panel feed-item-card ms-review-card" data-ms-review-card="1" onclick="toggleSpotlightReviewCard(this)" style="padding: 0.9rem; border-radius: 1rem; cursor:${hasDetails ? 'pointer' : 'default'};">
                    <div class="feed-card-row">
                        <div class="feed-card-actor" style="margin-left:0;">
                            ${renderUserIconHtml(r?._icon, 52)}
                        </div>
                        <div class="feed-card-main">
                            <div class="text-white font-bold" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(username)}</div>
                            ${(overall || tierLabel)
                                ? `<div class="feed-metrics">${overall ? dashRenderHelpScore(overall) : ''}${tierLabel ? dashRenderHelpTier(tierLabel) : ''}</div>`
                                : `<div class="text-xs text-gray" style="margin-top: 0.25rem;">No rating yet</div>`}
                            ${watched ? `<div class="text-xs" style="margin-top: 0.25rem; color: rgba(255,255,255,0.55);">Watched: ${escapeHtml(watched)}</div>` : ''}
                        </div>
                        ${hasDetails ? `<div class="ms-review-chev" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></div>` : ''}
                    </div>
                    ${hasDetails ? `
                    <div class="feed-card-details">
                        ${subRatingRows.length
                            ? `<div class="library-chip-row" style="margin-top: 0.55rem;">${subRatingRows.map(d => `<span class="dash-quote-pill">${escapeHtml(d.k)}: ${escapeHtml(d.v)}</span>`).join('')}</div>`
                            : ''}
                        ${quote ? `<div style="margin-top: 0.75rem;"><div class="text-xs text-gray" style="margin-bottom: 0.25rem;">Favorite Quote</div><div class="text-white" style="line-height: 1.4;">${escapeHtml(quote)}</div></div>` : ''}
                        ${notes ? `<div style="margin-top: 0.75rem;"><div class="text-xs text-gray" style="margin-bottom: 0.25rem;">Notes</div><div class="text-white review-notes-scroll" style="line-height: 1.4; white-space: pre-wrap;">${escapeHtml(notes)}</div></div>` : ''}
                    </div>` : ''}
                </div>`;
        }

        // Expand/collapse a single review card (mirrors the Feed's is-open toggle). Uses its
        // own handler so it doesn't depend on the Feed page's document listener being bound.
        function toggleSpotlightReviewCard(cardEl) {
            if (cardEl && cardEl.classList) cardEl.classList.toggle('is-open');
        }

        async function openMovieSpotlight(movie) {
            if (!movie) return;
            const overlay = document.getElementById('movie-spotlight-overlay');
            if (!overlay) return;

            const token = ++movieSpotlightState.token;
            const tmdbId = Number(movie?.tmdb_id ?? movie?.id);
            // Use already-fetched details (from a hover/pointerdown prefetch or a prior
            // open) so the modal opens fully populated with ZERO spinner when possible.
            const cached = (Number.isFinite(tmdbId) && tmdbId > 0)
                ? movieSpotlightDetailsCache.get(tmdbId) : null;

            movieSpotlightState.movie = movie;
            movieSpotlightState.details = cached || null;
            movieSpotlightState.tab = 'details';
            movieSpotlightState.loading = !cached;
            movieSpotlightState.rated = false;
            movieSpotlightState.reviews = null;
            movieSpotlightState.reviewsLoading = false;
            // Set ONLY by a poster tap on a SHARED list (openListMovieSpotlight) — makes the
            // User Reviews tab include that list's members, not just the viewer's follows.
            movieSpotlightState.sharedListId = String(movie?._sharedListId || '').trim() || null;
            // Only present when opened from the "You Might Like" home strip. Every
            // other opener (Search / Trending / Lists / Feed) passes no taste_score, so
            // the "% match" tile stays hidden there.
            movieSpotlightState.tasteScore = (typeof movie?.taste_score === 'number' && Number.isFinite(movie.taste_score))
                ? Math.round(movie.taste_score) : null;

            // Reuse the home page's selection state so the action buttons (Log /
            // Update / Add to List / Recommend) work exactly as they do on Home.
            try { router.selectedMovie = movie; router.pendingTitle = movie?.title || ''; } catch (_) {}

            overlay.style.display = 'flex';
            overlay.classList.add('open');
            try { overlay.scrollTop = 0; } catch (_) {}
            renderMovieSpotlight();

            // Kick off the rated-state check immediately (in parallel with details).
            refreshSpotlightRatedState(token).catch(() => {});

            // Eagerly load followed users' reviews so the "User Reviews" tab only appears
            // when at least one follow has reviewed this movie (finishSpotlightReviews
            // re-emits the tab bar). Runs in parallel; the tab render depends on it.
            loadSpotlightReviews(token).catch(() => {});

            // Fetch full details (backdrop, cast, runtime, IMDb, etc.) if not cached.
            if (!cached && Number.isFinite(tmdbId) && tmdbId > 0) {
                const details = await prefetchMovieDetails(tmdbId);
                if (token !== movieSpotlightState.token) return; // a newer open superseded us
                movieSpotlightState.details = details || { _error: true };
                movieSpotlightState.loading = false;
                renderMovieSpotlight();
            } else if (!cached) {
                movieSpotlightState.details = { _error: true };
                movieSpotlightState.loading = false;
                renderMovieSpotlight();
            }
        }

        // Details cache + prefetch. Hover/pointerdown on a search result or trending
        // card warms this so the modal can open instantly; repeat opens are free.
        const movieSpotlightDetailsCache = new Map();    // tmdb_id -> details object
        const movieSpotlightDetailsInflight = new Map(); // tmdb_id -> Promise

        function prefetchMovieDetails(tmdbId) {
            const id = Number(tmdbId);
            if (!Number.isFinite(id) || id <= 0) return Promise.resolve(null);
            if (movieSpotlightDetailsCache.has(id)) return Promise.resolve(movieSpotlightDetailsCache.get(id));
            if (movieSpotlightDetailsInflight.has(id)) return movieSpotlightDetailsInflight.get(id);
            const p = callSwiftApiGetMovieDetails({ tmdb_id: id })
                .then((d) => {
                    const val = (d && typeof d === 'object') ? d : { _error: true };
                    movieSpotlightDetailsInflight.delete(id);
                    // Only cache successful results so a transient error can be retried.
                    if (!val._error) movieSpotlightDetailsCache.set(id, val);
                    return val;
                })
                .catch(() => {
                    movieSpotlightDetailsInflight.delete(id);
                    return { _error: true };
                });
            movieSpotlightDetailsInflight.set(id, p);
            return p;
        }

        function closeMovieSpotlight() {
            const overlay = document.getElementById('movie-spotlight-overlay');
            if (overlay) { overlay.style.display = 'none'; overlay.classList.remove('open'); }
            movieSpotlightState.token++; // cancel any in-flight render/fetch callbacks
            movieSpotlightState.tasteScore = null; // don't leak the match tile into the next opener
            movieSpotlightState.sharedListId = null; // nor the shared-list reviewer scope
        }

        async function refreshSpotlightRatedState(token) {
            if (!supabaseClient) return;
            const { data } = await supabaseClient.auth.getSession();
            const authedUser = data?.session?.user;
            if (!authedUser?.id) return;
            const movie_id = await resolveDbMovieIdFromSelectedMovie(movieSpotlightState.movie);
            if (!movie_id) return;
            const rated = await hasExistingMovieRating({ user_id: authedUser.id, movie_id });
            if (token !== movieSpotlightState.token) return;
            movieSpotlightState.rated = !!rated;
            // Only the action row depends on this — repaint it in place.
            const actions = document.getElementById('ms-actions');
            if (actions) actions.innerHTML = spotlightActionsHtml();
        }

        function setMovieSpotlightTab(tab) {
            movieSpotlightState.tab = tab;
            const panel = document.getElementById('ms-panel');
            if (panel) panel.innerHTML = spotlightPanelHtml(tab);
            document.querySelectorAll('#movie-spotlight-overlay [data-ms-tab]').forEach((b) => {
                b.classList.toggle('is-active', b.getAttribute('data-ms-tab') === tab);
            });
        }

        function spotlightActionsHtml() {
            const rated = movieSpotlightState.rated;
            const primary = rated
                ? `<button type="button" class="ms-action ms-action-secondary" onclick="movieSpotlightAction('quick', this)">${icons.refreshCw} Quick Watch +1</button>
                   <button type="button" class="ms-action ms-action-primary" onclick="movieSpotlightAction('update', this)">${icons.edit3} Update Ratings</button>`
                : `<button type="button" class="ms-action ms-action-secondary" onclick="movieSpotlightAction('later', this)">${icons.clock} Rate Later</button>
                   <button type="button" class="ms-action ms-action-primary" onclick="movieSpotlightAction('new', this)">${icons.plusCircle} Log as New Entry</button>`;
            return `
                <div class="ms-actions-row ms-actions-primary">${primary}</div>
                <div class="ms-actions-row">
                    <button type="button" class="ms-action ms-action-secondary" onclick="movieSpotlightAction('recommend')">${icons.users} Recommend</button>
                    <button type="button" class="ms-action ms-action-secondary" onclick="movieSpotlightAction('list')">${icons.plusCircle} Add to List</button>
                </div>`;
        }

        // The action buttons reuse the existing Home flow.
        //
        // `list`/`recommend` keep the spotlight OPEN underneath their modal, so closing
        // that modal (backdrop tap, swipe-dismiss, or a successful save) drops the user
        // straight back onto the spotlight instead of the page behind it. They stack
        // correctly because #movie-spotlight-overlay sits at a LOWER z-index than the
        // shared .auth-overlay modals — see the rule in styles.css.
        //
        // The two that navigate to the log form (`new`/`update`) also keep the spotlight
        // open, but only until the fetch resolves — they need a spinner on the clicked
        // button, since closing first left the user staring at the old page with no
        // feedback, which read as the app crashing.
        //
        // `later`/`quick` still close it outright: they finish the interaction.
        function movieSpotlightAction(kind, btnEl) {
            const movie = movieSpotlightState.movie;
            try { if (movie) { router.selectedMovie = movie; router.pendingTitle = movie?.title || ''; } } catch (_) {}

            if (kind === 'new' || kind === 'update') {
                const btn = btnEl || null;
                const originalHTML = btn ? btn.innerHTML : null;
                if (btn) {
                    btn.innerHTML = `${icons.loader} Loading…`;
                    btn.disabled = true;
                    btn.style.opacity = '0.85';
                }
                const finish = () => {
                    if (btn && originalHTML !== null) {
                        btn.innerHTML = originalHTML;
                        btn.disabled = false;
                        btn.style.opacity = '';
                    }
                    closeMovieSpotlight();
                };
                let p;
                try {
                    p = (kind === 'new') ? router.startNewEntry() : router.startUpdateRatings();
                } catch (e) {
                    try { emitLog('Spotlight action failed: ' + String(e?.message || e)); } catch (_) {}
                    finish();
                    return;
                }
                Promise.resolve(p).then(finish, (e) => {
                    try { emitLog('Spotlight action failed: ' + String(e?.message || e)); } catch (_) {}
                    finish();
                });
                return;
            }

            if (kind !== 'list' && kind !== 'recommend') closeMovieSpotlight();
            try {
                if (kind === 'later') saveMovieForLater(movie);
                else if (kind === 'quick') router.quickIncrement();
                else if (kind === 'list') openAddToListModal();
                else if (kind === 'recommend') openRecModalFromHome();
            } catch (e) {
                try { emitLog('Spotlight action failed: ' + String(e?.message || e)); } catch (_) {}
            }
        }

        function spotlightPanelHtml(tab) {
            const mv = spotlightMerged();
            const loading = movieSpotlightState.loading;

            if (tab === 'cast') {
                if (loading && !mv.cast_detailed.length) {
                    return `<div class="ms-loading"><div class="discover-spinner discover-spinner-sm"></div><span>Loading cast…</span></div>`;
                }
                if (!mv.cast_detailed.length) {
                    const names = mv.cast.length ? mv.cast.join(', ') : '';
                    return names
                        ? `<p class="ms-overview">${escapeHtml(names)}</p>`
                        : `<p class="ms-empty">No cast information available.</p>`;
                }
                const cards = mv.cast_detailed.map((c) => {
                    const photo = spotlightTmdbImg(c.profile_path, 'w185');
                    const headshot = photo
                        ? `<img src="${photo}" alt="" loading="lazy" onerror="this.style.display='none'; this.parentElement.classList.add('ms-cast-noimg');">`
                        : '';
                    return `
                        <div class="ms-cast-card">
                            <div class="ms-cast-photo${photo ? '' : ' ms-cast-noimg'}">${headshot}<span class="ms-cast-fallback">${icons.users}</span></div>
                            <div class="ms-cast-name">${escapeHtml(c.name)}</div>
                            ${c.character ? `<div class="ms-cast-char">${escapeHtml(c.character)}</div>` : ''}
                        </div>`;
                }).join('');
                return `<div class="ms-cast-grid">${cards}</div>`;
            }

            if (tab === 'watch') {
                if (loading && !mv.watch_providers.length) {
                    return `<div class="ms-loading"><div class="discover-spinner discover-spinner-sm"></div><span>Loading watch options…</span></div>`;
                }
                return spotlightWatchOptionsHtml(mv);
            }

            if (tab === 'reviews') {
                const reviews = movieSpotlightState.reviews;
                if (reviews === null) {
                    // Not loaded yet — kick off the fetch (once) and show a spinner.
                    if (!movieSpotlightState.reviewsLoading) loadSpotlightReviews(movieSpotlightState.token);
                    return `<div class="ms-loading"><div class="discover-spinner discover-spinner-sm"></div><span>Loading reviews…</span></div>`;
                }
                if (!reviews.length) {
                    return movieSpotlightState.sharedListId
                        ? `<p class="ms-empty">No reviews yet from this list's members or people you follow.</p>`
                        : `<p class="ms-empty">No reviews yet from people you follow.</p>`;
                }
                return `${spotlightReviewsAvgHtml(reviews)}<div class="ms-reviews-list">${reviews.map(spotlightReviewCardHtml).join('')}</div>`;
            }

            if (tab === 'details') {
                // Paint whatever the OPENER already gave us (Lists carry director/genre/
                // MPA/runtime/IMDb; search + feed carry year/genre) instead of blanking
                // the whole tab behind a spinner — the details fetch then fills the gaps.
                // Only a movie we know nothing about gets the bare spinner.
                const hasAny = Boolean(mv.director) || mv.genres.length > 0 || Boolean(mv.mpa)
                    || Boolean(mv.runtime) || Boolean(mv.year)
                    || typeof mv.imdb_rating_pct === 'number';
                if (loading && !hasAny) {
                    return `<div class="ms-loading"><div class="discover-spinner discover-spinner-sm"></div><span>Loading details…</span></div>`;
                }
                const cards = spotlightDetailsCardsHtml(mv);
                return loading
                    ? `${cards}<div class="ms-loading ms-loading-inline"><div class="discover-spinner discover-spinner-sm"></div><span>Loading more…</span></div>`
                    : cards;
            }

            // Overview (default)
            if (loading && !mv.overview) {
                return `<div class="ms-loading"><div class="discover-spinner discover-spinner-sm"></div><span>Loading…</span></div>`;
            }
            return mv.overview
                ? `<p class="ms-overview">${escapeHtml(mv.overview)}</p>`
                : `<p class="ms-empty">No synopsis available.</p>`;
        }

        // Builds the tab bar. The "User Reviews" tab is only included when at least one
        // relevant user — someone the viewer follows, or a member of the shared list the
        // spotlight was opened from — has reviewed this movie (reviews eagerly loaded on
        // open); until then / when none, the button is omitted. Re-emitted by
        // finishSpotlightReviews.
        function spotlightTabsHtml(tab) {
            const reviews = movieSpotlightState.reviews;
            const showReviews = Array.isArray(reviews) && reviews.length > 0;
            return `
                <div class="ms-tabs" id="ms-tabs">
                    <button type="button" data-ms-tab="details" class="${tab === 'details' ? 'is-active' : ''}" onclick="setMovieSpotlightTab('details')">Info</button>
                    <button type="button" data-ms-tab="overview" class="${tab === 'overview' ? 'is-active' : ''}" onclick="setMovieSpotlightTab('overview')">Brief</button>
                    <button type="button" data-ms-tab="cast" class="${tab === 'cast' ? 'is-active' : ''}" onclick="setMovieSpotlightTab('cast')">Cast</button>
                    <button type="button" data-ms-tab="watch" class="${tab === 'watch' ? 'is-active' : ''}" onclick="setMovieSpotlightTab('watch')">Where</button>
                    ${showReviews ? `<button type="button" data-ms-tab="reviews" class="${tab === 'reviews' ? 'is-active' : ''}" onclick="setMovieSpotlightTab('reviews')">User Reviews</button>` : ''}
                </div>`;
        }

        function renderMovieSpotlight() {
            const body = document.getElementById('movie-spotlight-body');
            if (!body) return;
            const mv = spotlightMerged();
            const tab = movieSpotlightState.tab;

            const backdrop = spotlightTmdbImg(mv.backdrop_path, 'w780');
            const poster = spotlightTmdbImg(mv.poster_path, 'w342');
            const yearStr = mv.year ? `<span class="ms-year">(${escapeHtml(String(mv.year))})</span>` : '';

            body.innerHTML = `
                <button type="button" class="ms-close" onclick="closeMovieSpotlight()" aria-label="Close">&times;</button>
                <div class="ms-hero${backdrop ? '' : ' ms-hero-noimg'}">
                    ${backdrop ? `<div class="ms-backdrop" style="background-image:url('${backdrop}')"></div>` : ''}
                    <div class="ms-hero-fade"></div>
                    <div class="ms-hero-content">
                        <div class="ms-poster${poster ? '' : ' ms-poster-noimg'}">
                            ${poster
                                ? `<img src="${poster}" alt="" onerror="this.style.display='none'; this.parentElement.classList.add('ms-poster-noimg');">`
                                : ''}
                            <span class="ms-poster-fallback">${icons.film}</span>
                        </div>
                        <div class="ms-hero-text">
                            <h2 class="ms-title" id="movie-spotlight-title">${escapeHtml(mv.title)} ${yearStr}</h2>
                            ${mv.tagline ? `<div class="ms-tagline">${escapeHtml(mv.tagline)}</div>` : ''}
                        </div>
                    </div>
                </div>
                ${spotlightTabsHtml(tab)}
                <div class="ms-panel" id="ms-panel">${spotlightPanelHtml(tab)}</div>
                <div class="ms-actions" id="ms-actions">${spotlightActionsHtml()}</div>
            `;
        }
