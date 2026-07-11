        let homeSearchDebounceTimer = null;
        let homeSearchAbortController = null;
        let homeSearchItems = [];

        let homeTrendingItems = [];
        let homeTrendingAbortController = null;

        // "You Might Like" home strip — taste-based picks from the swift-api
        // `swipe_deck` action (scored off the user's Taste Profile). NOTE: this is
        // NOT the "Recs" list — swipe_deck explicitly EXCLUDES Recs/Bucket-List movies.
        let homeForYouItems = [];
        let homeForYouCache = null;      // { userId, items, ts } — in-memory cache (mirrors sessionStorage)
        let homeForYouInflight = null;   // shared in-flight fetch promise (dedupes boot-prefetch vs Home render)

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

        // ─── Data Dash response cache (per visit) ───
        // The six dashboard tabs each hit their own RPC. Without this, switching
        // tabs (or switching back to one you already viewed) re-runs the RPC every
        // time — a network round-trip per click. We memoize each RPC result keyed
        // by function name + params (params include the timeframe / metric / limit,
        // so a different selection is a different key). Cleared on every fresh entry
        // to the Data Dash page (see router `dashboard` dispatch), so stats are never
        // stale — the cache only spans a single visit.
        const dashRpcCache = new Map();

        function dashCacheKey(fnName, params) {
            return `${fnName}|${JSON.stringify(params || {})}`;
        }

        function invalidateDashboardCache() {
            dashRpcCache.clear();
        }

        /**
         * Cached wrapper around a dashboard RPC. `runner` is an async fn that
         * performs the actual `supabaseClient.rpc(...)` (incl. any old-signature
         * retry) and returns the Supabase `{ data, error }` result. Only successful
         * (error-free) results are cached.
         */
        async function dashCachedRpc(fnName, params, runner) {
            const key = dashCacheKey(fnName, params);
            if (dashRpcCache.has(key)) {
                return { data: dashRpcCache.get(key), error: null };
            }
            const res = await runner();
            if (res && !res.error) dashRpcCache.set(key, res.data);
            return res;
        }

        /**
         * Resolve the current dashboard user WITHOUT a network `auth.getUser()`
         * round-trip on every tab switch. `cachedAuthUser` is kept current by
         * `refreshAuthStateAndUI`; we only fall back to the network call if it's
         * somehow empty.
         */
        async function dashResolveAuthUser() {
            if (guestMode) return cachedAuthUser || null;
            if (cachedAuthUser?.id) return cachedAuthUser;
            try {
                const { data } = await supabaseClient?.auth?.getUser?.();
                return data?.user || null;
            } catch (_) {
                return null;
            }
        }

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


