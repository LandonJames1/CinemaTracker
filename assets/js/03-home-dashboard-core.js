        let homeSearchDebounceTimer = null;
        let homeSearchAbortController = null;
        let homeSearchItems = [];

        let homeTrendingItems = [];
        let homeTrendingAbortController = null;

        async function callSwiftApiPublic(body, { signal } = {}) {
            const url = `${SUPABASE_URL}/functions/v1/swift-api`;

            // If the user is logged in, include Authorization. If not, allow a public call.
            let authHeader = null;
            try {
                const { data } = await supabaseClient?.auth?.getSession?.();
                const token = data?.session?.access_token || null;
                if (token) authHeader = `Bearer ${token}`;
            } catch (_) {}

            const headers = {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_KEY,
            };
            if (authHeader) headers['Authorization'] = authHeader;

            const res = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(body || {}),
                signal,
            });

            const text = await res.text();
            let data = null;
            try {
                data = text ? JSON.parse(text) : null;
            } catch (_) {
                data = text;
            }

            if (!res.ok) {
                const serverMsg =
                    data && typeof data === 'object'
                        ? (data.message || data.error || JSON.stringify(data))
                        : String(data || '');
                throw new Error(`${serverMsg || 'Request failed'}`);
            }

            return data;
        }

        async function loadDashboard() {
            // Called on router.navigate('dashboard') after the DOM is rendered.
            const elUnique = document.getElementById('dash-unique-movies-year');
            const elHours = document.getElementById('dash-total-hours');
            const elAvg = document.getElementById('dash-avg-rating');
            const elGenre = document.getElementById('dash-top-genre');
            const elGenreCount = document.getElementById('dash-top-genre-count');
            const elGenreAvg = document.getElementById('dash-top-genre-avg');

            const elTopMovieTitle = document.getElementById('dash-top-movie-title');
            const elTopMovieRating = document.getElementById('dash-top-movie-rating');
            const elWatchEventsYear = document.getElementById('dash-watch-events-year');
            const elWatchEventsAll = document.getElementById('dash-watch-events-all');

            const elDecade = document.getElementById('dash-most-watched-decade');
            const elDecadeCount = document.getElementById('dash-most-watched-decade-count');
            const elActor = document.getElementById('dash-most-watched-actor');
            const elActorCount = document.getElementById('dash-most-watched-actor-count');
            const elDirector = document.getElementById('dash-most-watched-director');
            const elDirectorCount = document.getElementById('dash-most-watched-director-count');

            const elHighDirector = document.getElementById('dash-highest-rated-director');
            const elHighDirectorAvg = document.getElementById('dash-highest-rated-director-avg');
            const elHighDirectorN = document.getElementById('dash-highest-rated-director-n');

            const elAtHome = document.getElementById('dash-at-home');
            const elInTheater = document.getElementById('dash-in-theater');

            const elTierBars = document.getElementById('dash-tier-bars');

            const required = [
                elUnique, elHours, elAvg, elGenre, elGenreCount, elGenreAvg,
                elTopMovieTitle, elTopMovieRating,
                elWatchEventsYear, elWatchEventsAll,
                elDecade, elDecadeCount,
                elActor, elActorCount,
                elDirector, elDirectorCount,
                elHighDirector, elHighDirectorAvg, elHighDirectorN,
                elAtHome, elInTheater,
                elTierBars,
            ];
            if (required.some(x => !x)) return;

            if (!supabaseClient) {
                elUnique.textContent = '—';
                elHours.textContent = '—';
                elAvg.textContent = '—';
                elGenre.textContent = '—';
                elGenreCount.textContent = '—';
                elGenreAvg.textContent = '—';

                elTopMovieTitle.textContent = '—';
                elTopMovieRating.textContent = '—';
                elWatchEventsYear.textContent = '—';
                elWatchEventsAll.textContent = '—';

                elDecade.textContent = '—';
                elDecadeCount.textContent = '—';
                elActor.textContent = '—';
                elActorCount.textContent = '—';
                elDirector.textContent = '—';
                elDirectorCount.textContent = '—';

                elHighDirector.textContent = '—';
                elHighDirectorAvg.textContent = '—';
                elHighDirectorN.textContent = '—';

                elAtHome.textContent = '—';
                elInTheater.textContent = '—';

                elTierBars.innerHTML = '';
                return;
            }

            // Require auth for dashboard metrics.
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

            if (!authedUser?.id) {
                elUnique.textContent = '—';
                elHours.textContent = '—';
                elAvg.textContent = '—';
                elGenre.textContent = '—';
                elGenreCount.textContent = '—';
                elGenreAvg.textContent = '—';

                elTopMovieTitle.textContent = '—';
                elTopMovieRating.textContent = '—';
                elWatchEventsYear.textContent = '—';
                elWatchEventsAll.textContent = '—';

                elDecade.textContent = '—';
                elDecadeCount.textContent = '—';
                elActor.textContent = '—';
                elActorCount.textContent = '—';
                elDirector.textContent = '—';
                elDirectorCount.textContent = '—';

                elHighDirector.textContent = '—';
                elHighDirectorAvg.textContent = '—';
                elHighDirectorN.textContent = '—';

                elAtHome.textContent = '—';
                elInTheater.textContent = '—';

                elTierBars.innerHTML = '';
                return;
            }

            // Loading state.
            elUnique.textContent = '…';
            elHours.textContent = '…';
            elAvg.textContent = '…';
            elGenre.textContent = '…';
            elGenreCount.textContent = '…';
            elGenreAvg.textContent = '…';

            elTopMovieTitle.textContent = '…';
            elTopMovieRating.textContent = '…';
            elWatchEventsYear.textContent = '…';
            elWatchEventsAll.textContent = '…';

            elDecade.textContent = '…';
            elDecadeCount.textContent = '…';
            elActor.textContent = '…';
            elActorCount.textContent = '…';
            elDirector.textContent = '…';
            elDirectorCount.textContent = '…';

            elHighDirector.textContent = '…';
            elHighDirectorAvg.textContent = '…';
            elHighDirectorN.textContent = '…';

            elAtHome.textContent = '…';
            elInTheater.textContent = '…';

            elTierBars.innerHTML = '';

            try {
                const { data, error } = await supabaseClient.rpc('get_dashboard_summary');
                if (error) throw error;

                const uniqueMovies = Number(data?.unique_movies_this_year ?? 0);
                const totalHours = Number(data?.total_watch_hours_all_time ?? 0);
                const avgRating = Number(data?.avg_overall_rating ?? 0);
                const topGenre = String(data?.top_genre ?? '').trim();
                const topGenreCount = Number(data?.top_genre_count ?? 0);
                const topGenreAvg = Number(data?.top_genre_avg_overall ?? 0);

                const topMovieTitle = String(data?.highest_rated_movie?.title ?? '').trim();
                const topMovieRating = Number(data?.highest_rated_movie?.overall_rating ?? 0);

                const watchEventsYear = Number(data?.total_watch_events_this_year ?? 0);
                const watchEventsAll = Number(data?.total_watch_events_all_time ?? 0);

                const decade = data?.most_watched_decade?.decade;
                const decadeWatches = Number(data?.most_watched_decade?.watches ?? 0);

                const actorName = String(data?.most_watched_actor?.name ?? '').trim();
                const actorWatches = Number(data?.most_watched_actor?.watches ?? 0);

                const directorName = String(data?.most_watched_director?.name ?? '').trim();
                const directorWatches = Number(data?.most_watched_director?.watches ?? 0);

                const highDirectorName = String(data?.highest_rated_director?.name ?? '').trim();
                const highDirectorAvg = Number(data?.highest_rated_director?.avg_overall ?? 0);
                const highDirectorN = Number(data?.highest_rated_director?.n ?? 0);

                const atHome = Number(data?.watch_method_breakdown?.at_home ?? 0);
                const inTheater = Number(data?.watch_method_breakdown?.in_theater ?? 0);

                const tierDist = Array.isArray(data?.tier_distribution) ? data.tier_distribution : [];

                elUnique.textContent = Number.isFinite(uniqueMovies) ? String(uniqueMovies) : '0';
                elHours.textContent = Number.isFinite(totalHours) ? String(totalHours) : '0';
                elAvg.textContent = Number.isFinite(avgRating) ? String(avgRating) : '0';
                elGenre.textContent = topGenre || '—';
                elGenreCount.textContent = Number.isFinite(topGenreCount) ? String(topGenreCount) : '0';
                elGenreAvg.textContent = Number.isFinite(topGenreAvg) ? String(topGenreAvg) : '0';

                elTopMovieTitle.textContent = topMovieTitle || '—';
                elTopMovieRating.textContent = Number.isFinite(topMovieRating) ? String(topMovieRating) : '0';

                elWatchEventsYear.textContent = Number.isFinite(watchEventsYear) ? String(watchEventsYear) : '0';
                elWatchEventsAll.textContent = Number.isFinite(watchEventsAll) ? String(watchEventsAll) : '0';

                elDecade.textContent = (decade === null || decade === undefined) ? '—' : `${String(decade)}s`;
                elDecadeCount.textContent = Number.isFinite(decadeWatches) ? String(decadeWatches) : '0';

                elActor.textContent = actorName || '—';
                elActorCount.textContent = Number.isFinite(actorWatches) ? String(actorWatches) : '0';

                elDirector.textContent = directorName || '—';
                elDirectorCount.textContent = Number.isFinite(directorWatches) ? String(directorWatches) : '0';

                elHighDirector.textContent = highDirectorName || '—';
                elHighDirectorAvg.textContent = Number.isFinite(highDirectorAvg) ? String(highDirectorAvg) : '0';
                elHighDirectorN.textContent = Number.isFinite(highDirectorN) ? String(highDirectorN) : '0';

                elAtHome.textContent = Number.isFinite(atHome) ? String(atHome) : '0';
                elInTheater.textContent = Number.isFinite(inTheater) ? String(inTheater) : '0';

                const tierColors = {
                    'S': 'rgba(var(--tier-s-rgb), 0.35)',
                    'A': 'rgba(var(--tier-a-rgb), 0.35)',
                    'B': 'rgba(var(--tier-b-rgb), 0.35)',
                    'C': 'rgba(var(--tier-c-rgb), 0.35)',
                    'D': 'rgba(var(--tier-d-rgb), 0.35)',
                    'F': 'rgba(var(--tier-f-rgb), 0.35)',
                };

                elTierBars.innerHTML = tierDist.map((t) => {
                    const tier = String(t?.tier ?? '').trim() || '—';
                    const pct = Number(t?.pct ?? 0);
                    const count = Number(t?.count ?? 0);
                    const width = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
                    const bg = tierColors[tier.toUpperCase()] || 'rgba(255,255,255,0.10)';
                    const tierLetter = String(tier || '').trim().toUpperCase();
                    const tierText = /^[SABCDF]$/.test(tierLetter)
                        ? `Tier <span class=\"dash-help-tier\" data-tier-letter=\"${escapeHtml(tierLetter)}\">${escapeHtml(tierLetter)}</span>`
                        : `Tier ${escapeHtml(tier)}`;
                    return `
                        <div style="min-width: 140px; flex: 1;">
                            <div class="flex justify-between" style="margin-bottom: 6px;">
                                <span class="text-xs text-gray">${tierText}</span>
                                <span class="text-xs text-gray">${Number.isFinite(pct) ? pct.toFixed(1) : '0.0'}% (${Number.isFinite(count) ? count : 0})</span>
                            </div>
                            <div style="height: 10px; background: rgba(255,255,255,0.06); border-radius: 999px; overflow: hidden; border: 1px solid rgba(255,255,255,0.06);">
                                <div style="height: 100%; width: ${width}%; background: ${bg};"></div>
                            </div>
                        </div>
                    `;
                }).join('');
            } catch (err) {
                // Quiet failure; keep placeholders.
                elUnique.textContent = '—';
                elHours.textContent = '—';
                elAvg.textContent = '—';
                elGenre.textContent = '—';
                elGenreCount.textContent = '—';
                elGenreAvg.textContent = '—';

                elTopMovieTitle.textContent = '—';
                elTopMovieRating.textContent = '—';
                elWatchEventsYear.textContent = '—';
                elWatchEventsAll.textContent = '—';

                elDecade.textContent = '—';
                elDecadeCount.textContent = '—';
                elActor.textContent = '—';
                elActorCount.textContent = '—';
                elDirector.textContent = '—';
                elDirectorCount.textContent = '—';

                elHighDirector.textContent = '—';
                elHighDirectorAvg.textContent = '—';
                elHighDirectorN.textContent = '—';

                elAtHome.textContent = '—';
                elInTheater.textContent = '—';

                elTierBars.innerHTML = '';
            }
        }

        function initDashboardTabs() {
            const wrap = document.getElementById('dash-tab-general')?.parentElement;
            if (!wrap) return;
            if (wrap.dataset.boundClicks) return;
            wrap.dataset.boundClicks = 'true';

            wrap.addEventListener('click', (e) => {
                const btn = e?.target?.closest ? e.target.closest('button[data-tab]') : null;
                const tab = btn?.dataset?.tab;
                if (!tab) return;
                setDashboardTab(tab);
            });
        }

        let dashboardTimeframe = 'all_time';
        let dashboardActiveTab = 'general';
        let dashboardAuthWarned = false;
        let dashboardFavoritesMetric = 'overall';
        let dashboardFavoritesLimit = 5;
        let dashboardChartsLastData = null;
        let dashboardActivityChart = null;
        let dashboardRatingsChartTab = 'genre';
        let dashboardRatingsChartsLastData = null;
        let dashboardRatingsShowAllGenres = false;
        let dashboardGeneralPieMode = 'mpa';
        let dashboardGeneralPieData = null;
        let dashboardGeneralGenreOtherItems = [];
        let dashboardGeneralGenreOtherTotal = 0;
        let dashboardGeneralMode = 'total';
        let dashboardGeneralMethodBase = { atHome: 0, inTheater: 0 };

        let dashboardGeneralLastData = null;
        let dashboardRatingsLastData = null;

        const dashPosterCacheByTmdbId = new Map();
        const dashRatingCacheByMovieId = new Map();
        const dashPersonAvatarCache = new Map();

        function dashNormalizePosterPath(p) {
            const raw = String(p ?? '').trim();
            if (!raw) return '';
            // Allow full URLs (future-proof).
            if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
            // TMDb poster_path should be "/abc.jpg" but some sources may provide "abc.jpg".
            return raw.startsWith('/') ? raw : `/${raw}`;
        }

        function dashBuildPosterUrl(posterPath, size = 'w342') {
            const normalized = dashNormalizePosterPath(posterPath);
            if (!normalized) return '';
            if (normalized.startsWith('http://') || normalized.startsWith('https://')) return normalized;
            return `https://image.tmdb.org/t/p/${String(size || 'w342')}${normalized}`;
        }

        function dashBuildPersonUrl(profilePath, size = 'w185') {
            const raw = String(profilePath ?? '').trim();
            if (!raw) return '';
            if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
            const normalized = raw.startsWith('/') ? raw : `/${raw}`;
            return `https://image.tmdb.org/t/p/${String(size || 'w185')}${normalized}`;
        }

        async function dashFetchPersonProfile({ name, department }) {
            const key = `${String(name || '').trim().toLowerCase()}|${String(department || '').trim().toLowerCase()}`;
            if (!key || key === '|') return null;
            if (dashPersonAvatarCache.has(key)) return dashPersonAvatarCache.get(key);

            let profilePath = null;
            try {
                const data = await callSwiftApiPublic({ action: 'person', query: name, department });
                const results = Array.isArray(data?.results) ? data.results : [];
                const pick = results.find((r) => String(r?.profile_path || '').trim()) || results[0] || null;
                profilePath = pick?.profile_path ? String(pick.profile_path).trim() : null;
            } catch (_) {
                profilePath = null;
            }

            dashPersonAvatarCache.set(key, profilePath);
            return profilePath;
        }

        async function dashEnsurePosterPath(item) {
            // 1) If the item already has a poster path, use it (no DB needed).
            const direct = dashNormalizePosterPath(item?.poster_path ?? item?.posterPath ?? item?.poster_url ?? item?.posterUrl ?? '');
            if (direct) return direct;

            const tmdb_id = Number(item?.tmdb_id);
            if (Number.isFinite(tmdb_id) && tmdb_id > 0) {
                if (dashPosterCacheByTmdbId.has(tmdb_id)) return dashPosterCacheByTmdbId.get(tmdb_id);
            }

            // Prefer DB if the movie exists there; never call TMDb here.
            if (!supabaseClient) {
                if (Number.isFinite(tmdb_id) && tmdb_id > 0) dashPosterCacheByTmdbId.set(tmdb_id, null);
                return null;
            }

            const movie_id = String(item?.movie_id ?? item?.movieId ?? item?.id ?? '').trim();

            // 2) DB lookup by movie_id (most reliable in this app)
            if (isUuidLike(movie_id)) {
                try {
                    const { data, error } = await supabaseClient
                        .from('Movies')
                        .select('tmdb_id, poster_path')
                        .eq('id', movie_id)
                        .maybeSingle();
                    if (error) throw error;

                    const pRaw = String(data?.poster_path || '').trim();
                    const p = pRaw ? (dashNormalizePosterPath(pRaw) || null) : null;
                    const tmdbFromDb = Number(data?.tmdb_id);
                    if (Number.isFinite(tmdbFromDb) && tmdbFromDb > 0) dashPosterCacheByTmdbId.set(tmdbFromDb, p);
                    if (Number.isFinite(tmdb_id) && tmdb_id > 0) dashPosterCacheByTmdbId.set(tmdb_id, p);
                    return p;
                } catch (_) {
                    if (Number.isFinite(tmdb_id) && tmdb_id > 0) dashPosterCacheByTmdbId.set(tmdb_id, null);
                    return null;
                }
            }

            // 3) DB lookup by tmdb_id fallback
            if (!Number.isFinite(tmdb_id) || tmdb_id <= 0) return null;
            try {
                const { data, error } = await supabaseClient
                    .from('Movies')
                    .select('poster_path')
                    .eq('tmdb_id', tmdb_id)
                    .maybeSingle();
                if (error) throw error;
                const pRaw = String(data?.poster_path || '').trim();
                const p = pRaw ? (dashNormalizePosterPath(pRaw) || null) : null;
                dashPosterCacheByTmdbId.set(tmdb_id, p);
                return p;
            } catch (_) {
                dashPosterCacheByTmdbId.set(tmdb_id, null);
                return null;
            }
        }

        function dashFormatScore(n) {
            const num = Number(n);
            if (!Number.isFinite(num)) return '';
            const rounded = Math.round(num * 10) / 10;
            return `${rounded.toFixed(1)}%`;
        }

        function dashFormatScoreWhole(n) {
            const num = Number(n);
            if (!Number.isFinite(num)) return '';
            return `${Math.round(num)}%`;
        }

        function dashNormalizeTierLabel(tierRaw) {
            const t = String(tierRaw ?? '').trim();
            if (!t) return '';
            const u = t.toUpperCase();
            if (u === 'UNRANKED') return 'Unranked';
            if (/^[SABCDF]$/i.test(t)) return `${u}-Tier`;
            if (/^[SABCDF]\s*-?\s*TIER$/i.test(t)) return `${u[0]}-Tier`;
            return t;
        }

        function dashTierLetterFromLabel(label) {
            const raw = String(label ?? '').trim();
            if (!raw) return '';
            const upper = raw.toUpperCase();
            if (upper === 'UNRANKED') return '';
            const m = upper.match(/^([SABCDF])/);
            return m ? m[1] : '';
        }

        function dashRenderHelpScore(scoreText) {
            const s = String(scoreText ?? '').trim();
            if (!s) return '';
            return `<span class="dash-help-score tabular-nums">${escapeHtml(s)}</span>`;
        }

        function dashRenderHelpTier(tierLabel) {
            const t = String(tierLabel ?? '').trim();
            if (!t) return '';
            const letter = dashTierLetterFromLabel(t);
            const attr = letter ? ` data-tier-letter="${escapeHtml(letter)}"` : '';
            return `<span class="dash-help-tier"${attr}>${escapeHtml(t)}</span>`;
        }

        function dashJoinHelpParts(parts) {
            return (Array.isArray(parts) ? parts : []).filter(Boolean).join(' • ');
        }

        function openFeedAuthWarning() {
            const el = document.getElementById('feed-auth-warning');
            if (!el) return;
            el.style.display = 'flex';
        }

        function closeFeedAuthWarning() {
            const el = document.getElementById('feed-auth-warning');
            if (!el) return;
            el.style.display = 'none';
        }

        function openLibraryAuthWarning() {
            const el = document.getElementById('library-auth-warning');
            if (!el) return;
            el.style.display = 'flex';
        }

        function closeLibraryAuthWarning() {
            const el = document.getElementById('library-auth-warning');
            if (!el) return;
            el.style.display = 'none';
        }

        function openListsAuthWarning() {
            const el = document.getElementById('lists-auth-warning');
            if (!el) return;
            el.style.display = 'flex';
        }

        function closeListsAuthWarning() {
            const el = document.getElementById('lists-auth-warning');
            if (!el) return;
            el.style.display = 'none';
        }

