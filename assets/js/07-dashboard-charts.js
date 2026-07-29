        async function loadDashboardCharts() {
            const elTitle = document.getElementById('dash-chart-title');
            const elBody = document.getElementById('dash-chart-body');
            if (!elTitle || !elBody) return;

            elTitle.textContent = dashChartTitleForTab('activity');

            const authedUser = await dashResolveAuthUser();

            if (!supabaseClient || !authedUser?.id) {
                if (!dashboardAuthWarned) {
                    dashboardAuthWarned = true;
                    showToast('Log in to view your dashboard stats.', { level: 'warn' });
                }
                elBody.innerHTML = `<div class="text-gray">Log in to view charts.</div>`;
                return;
            }

            elBody.innerHTML = `<div class="text-gray">Loading…</div>`;

            try {
                const res = await dashCachedRpc('get_dashboard_charts', { p_timeframe: dashboardTimeframe }, () =>
                    supabaseClient.rpc('get_dashboard_charts', { p_timeframe: dashboardTimeframe }));
                if (res?.error) {
                    const msg = String(res.error?.message || res.error);
                    const missingRpc = /get_dashboard_charts/i.test(msg) && /(does not exist|not found|no function matches|function .* does not exist)/i.test(msg);
                    if (missingRpc) {
                        const text = 'Charts RPC missing. Run dashboard_rpc.sql to add get_dashboard_charts.';
                        elBody.innerHTML = `<div class="text-gray">${text}</div>`;
                        return;
                    }
                }
                if (res?.error) throw res.error;

                const data = res?.data || {};
                dashboardChartsLastData = data;
                renderDashboardChartsFromData(data);
            } catch (err) {
                showToast(`Dashboard (Charts) failed: ${String(err?.message || err)}`, { level: 'warn' });
                emitLog('error', 'Dashboard charts load failed', err);
                elBody.innerHTML = `<div class="text-gray">Unable to load charts right now.</div>`;
            }
        }

        async function loadDashboardQuoteWall() {
            const elWall = document.getElementById('dash-quote-wall');
            const elMeta = document.getElementById('dash-quote-wall-meta');
            if (!elWall) return;

            const authedUser = await dashResolveAuthUser();

            if (!supabaseClient || !authedUser?.id) {
                if (!dashboardAuthWarned) {
                    dashboardAuthWarned = true;
                    showToast('Log in to view your Quote Wall.', { level: 'warn' });
                }
                elWall.innerHTML = `<div class="text-gray">Log in to view your Quote Wall.</div>`;
                if (elMeta) elMeta.textContent = '';
                return;
            }

            elWall.innerHTML = `<div class="text-gray">Loading…</div>`;
            if (elMeta) elMeta.textContent = '';

            const computeRange = () => {
                const tf = String(dashboardTimeframe || 'all_time').trim().toLowerCase();
                if (tf === 'this_year') {
                    const now = new Date();
                    const start = new Date(now.getFullYear(), 0, 1);
                    const end = new Date(now.getFullYear() + 1, 0, 1);
                    return { start_date: getLocalISODate(start), end_date: getLocalISODate(end) };
                }
                if (tf === 'this_month') {
                    const now = new Date();
                    const start = new Date(now.getFullYear(), now.getMonth(), 1);
                    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
                    return { start_date: getLocalISODate(start), end_date: getLocalISODate(end) };
                }
                return { start_date: null, end_date: null };
            };

            const isNonBlank = (v) => {
                const s = String(v ?? '').trim();
                return s.length > 0;
            };

            try {
                const { start_date, end_date } = computeRange();

                let q = supabaseClient
                    .from('Movie Ratings')
                    .select('movie_id, overall_rating, tier, fav_quote, updated_at, watch_date')
                    .eq('user_id', authedUser.id)
                    .not('overall_rating', 'is', null)
                    .not('fav_quote', 'is', null)
                    .neq('fav_quote', '');

                if (start_date && end_date) {
                    q = q.gte('watch_date', start_date).lt('watch_date', end_date);
                }

                // Pull more than 50 to account for whitespace-only quotes.
                q = q
                    .order('overall_rating', { ascending: false })
                    .order('updated_at', { ascending: false })
                    .order('watch_date', { ascending: false })
                    .limit(140);

                const { data, error } = await q;
                if (error) throw error;

                const rows = Array.isArray(data) ? data : [];
                const filtered = rows
                    .filter((r) => isNonBlank(r?.fav_quote))
                    .slice(0, 50);

                if (filtered.length === 0) {
                    elWall.innerHTML = `<div class="text-gray">No quotes found. Add a Favorite Quote on a movie and it will appear here.</div>`;
                    if (elMeta) elMeta.textContent = '';
                    return;
                }

                const movieIds = Array.from(new Set(filtered.map((r) => r?.movie_id).filter(Boolean)));
                const moviesById = new Map();
                if (movieIds.length) {
                    const { data: moviesData, error: moviesErr } = await supabaseClient
                        .from('Movies')
                        .select('id, title, release_year, tmdb_id')
                        .in('id', movieIds);
                    if (moviesErr) throw moviesErr;
                    const mrows = Array.isArray(moviesData) ? moviesData : [];
                    for (const m of mrows) moviesById.set(m.id, m);
                }

                if (elMeta) {
                    const tfLabel = (() => {
                        const tf = String(dashboardTimeframe || 'all_time').trim().toLowerCase();
                        if (tf === 'this_year') return 'This Year';
                        if (tf === 'this_month') return 'This Month';
                        return 'All Time';
                    })();
                    elMeta.textContent = `${filtered.length} quote${filtered.length === 1 ? '' : 's'} • ${tfLabel}`;
                }

                const cardsHtml = filtered.map((r, i) => {
                    const quote = String(r?.fav_quote ?? '').trim();
                    const movie_id = String(r?.movie_id ?? '').trim();
                    // One movie's own score — whole number. Decimals are for averages.
                    const overall = dashFormatScoreWhole(r?.overall_rating);
                    const tierLabel = dashNormalizeTierLabel(r?.tier);

                    const movie = moviesById.get(r?.movie_id) || null;
                    const title = String(movie?.title ?? '').trim() || 'Untitled';
                    const year = (movie?.release_year === null || movie?.release_year === undefined) ? '' : String(movie.release_year);
                    const tmdb_id = (movie?.tmdb_id === null || movie?.tmdb_id === undefined) ? '' : String(movie.tmdb_id);
                    const poster_path = '';

                    const floatDelay = `${(i % 11) * 0.22}s`;
                    const tilt = `${(((i * 37) % 7) - 3) * 0.35}deg`;
                    const mx = `${35 + ((i * 19) % 45)}%`;
                    const my = `${18 + ((i * 29) % 55)}%`;
                    const mx2 = `${20 + ((i * 13) % 60)}%`;
                    const my2 = `${35 + ((i * 23) % 55)}%`;

                    const metaParts = [
                        overall ? { kind: 'score', value: overall } : null,
                        tierLabel ? { kind: 'tier', value: tierLabel } : null,
                    ].filter(Boolean);

                    return `
                        <div
                            class="dash-quote-card"
                            data-dash-movie-id="${escapeHtml(movie_id)}"
                            data-dash-tmdb-id="${escapeHtml(tmdb_id)}"
                            data-dash-movie-title="${escapeHtml(title)}"
                            data-dash-poster-path="${escapeHtml(poster_path)}"
                            data-dash-movie-quote="${escapeHtml(quote)}"
                            role="button"
                            tabindex="0"
                            aria-label="Update Ratings for ${escapeHtml(title)}"
                            style="--floatDelay:${escapeHtml(floatDelay)}; --tilt:${escapeHtml(tilt)}; --mx:${escapeHtml(mx)}; --my:${escapeHtml(my)}; --mx2:${escapeHtml(mx2)}; --my2:${escapeHtml(my2)};"
                        >
                            <div class="dash-quote-card-inner">
                                <div class="dash-quote-text">${escapeHtml(quote)}</div>
                                <div class="dash-quote-title">${escapeHtml(title)}${year ? ` <span style="color: rgba(255,255,255,0.65); font-weight: 800;">(${escapeHtml(year)})</span>` : ''}</div>
                                <div class="dash-quote-meta">
                                    ${metaParts.map((p) => {
                                        if (p.kind === 'score') {
                                            return `<span class=\"dash-quote-pill\">${dashRenderHelpScore(p.value)} Overall</span>`;
                                        }
                                        if (p.kind === 'tier') {
                                            const letter = dashTierLetterFromLabel(p.value);
                                            const attr = letter ? ` data-tier-letter=\"${escapeHtml(letter)}\"` : '';
                                            return `<span class=\"dash-quote-pill dash-help-tier\"${attr}>${escapeHtml(p.value)}</span>`;
                                        }
                                        return '';
                                    }).join('')}
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');

                elWall.innerHTML = `<div class="dash-quote-wall-grid">${cardsHtml}</div>`;
            } catch (err) {
                showToast(`Dashboard (Quote Wall) failed: ${String(err?.message || err)}`, { level: 'warn' });
                emitLog('error', 'Dashboard quote wall load failed', err);
                elWall.innerHTML = `<div class="text-gray">Unable to load Quote Wall right now.</div>`;
                if (elMeta) elMeta.textContent = '';
            }
        }

        async function loadDashboardTiers() {
            const elBars = document.getElementById('dash-tiers-bars');
            const elLists = document.getElementById('dash-tiers-lists');
            if (!elBars || !elLists) return;

            const authedUser = await dashResolveAuthUser();

            if (!supabaseClient || !authedUser?.id) {
                if (!dashboardAuthWarned) {
                    dashboardAuthWarned = true;
                    showToast('Log in to view your dashboard stats.', { level: 'warn' });
                }
                elBars.innerHTML = '';
                elLists.innerHTML = `<div class="text-gray">Log in to view your tier stats.</div>`;
                return;
            }

            elBars.innerHTML = `<div class="text-gray">Loading…</div>`;
            elLists.innerHTML = `<div class="text-gray">Loading…</div>`;

            try {
                const res = await dashCachedRpc('get_dashboard_tiers', { p_timeframe: dashboardTimeframe }, async () => {
                    let r = await supabaseClient.rpc('get_dashboard_tiers', { p_timeframe: dashboardTimeframe });
                    if (r?.error) {
                        const msg = String(r.error?.message || r.error);
                        const looksLikeOldSignature = /get_dashboard_tiers/i.test(msg) && /(does not exist|not found|no function matches|function .* does not exist)/i.test(msg);
                        if (looksLikeOldSignature) r = await supabaseClient.rpc('get_dashboard_tiers');
                    }
                    return r;
                });
                if (res?.error) throw res.error;
                const data = res?.data;

                const ratedTotal = Number(data?.rated_total ?? 0);
                const tierDist = Array.isArray(data?.tier_distribution) ? data.tier_distribution : [];
                const tierMovies = Array.isArray(data?.tier_movies) ? data.tier_movies : [];
                const ensuredTierPosters = await Promise.all(tierMovies.map((r) => dashEnsurePosterPath(r)));
                const tierPosterById = new Map();
                tierMovies.forEach((r, idx) => {
                    const id = String(r?.movie_id ?? '').trim();
                    if (!id) return;
                    const fromEnsure = ensuredTierPosters[idx] || '';
                    const fromRow = String(r?.poster_path ?? '').trim();
                    tierPosterById.set(id, fromEnsure || fromRow || '');
                });

                const tierOrder = ['S', 'A', 'B', 'C', 'D', 'F'];
                // Tier colors (requested palette)
                const tierColorSolid = {
                    'S': '#ef4444', // red
                    'A': '#f97316', // orange
                    'B': '#facc15', // yellow
                    'C': '#22c55e', // green
                    'D': '#3b82f6', // blue
                    'F': '#a855f7', // purple
                    'UNRANKED': '#6b7280',
                };
                const tierColorBg = {
                    'S': 'rgba(239, 68, 68, 0.22)',
                    'A': 'rgba(249, 115, 22, 0.22)',
                    'B': 'rgba(250, 204, 21, 0.20)',
                    'C': 'rgba(34, 197, 94, 0.22)',
                    'D': 'rgba(59, 130, 246, 0.22)',
                    'F': 'rgba(168, 85, 247, 0.22)',
                    'UNRANKED': 'rgba(107, 114, 128, 0.22)',
                };

                const tierHelp = {
                    'S': 'The Pantheon. Best of the Best.',
                    'A': 'Great! Highly Recommended Films!',
                    'B': 'Worth a Watch. Solidly Good and Entertaining.',
                    'C': "Totally Average. Fine if it's on, but don't go out of your way.",
                    'D': 'Skip it. Seriously Flawed and Not Worth the Time.',
                    'F': 'Avoid at All Costs. A Genuinely Bad Experience.',
                };

                const distByTier = new Map();
                for (const t of tierDist) {
                    const tier = String(t?.tier ?? '').trim().toUpperCase();
                    if (!tier) continue;
                    distByTier.set(tier, {
                        tier,
                        count: Number(t?.count ?? 0),
                        pct: Number(t?.pct ?? 0),
                    });
                }

                // Render distribution bars (S/A/B/C/D/F first, then anything else like Unranked)
                const extraTiers = [...distByTier.keys()]
                    .filter(t => !tierOrder.includes(t))
                    .sort((a, b) => {
                        if (a === 'UNRANKED') return 1;
                        if (b === 'UNRANKED') return -1;
                        return a.localeCompare(b);
                    });
                const tiersForBars = [...tierOrder.filter(t => distByTier.has(t)), ...extraTiers];

                const formatTierLabel = (tier) => {
                    const t = String(tier ?? '').trim().toUpperCase();
                    if (!t) return '';
                    if (t === 'UNRANKED') return 'Unranked';
                    if (tierOrder.includes(t)) return `${t}-Tier`;
                    return String(tier ?? '').trim();
                };

                // Vertical bar chart distribution (much larger)
                const tiersForChart = [...tierOrder, ...extraTiers.filter(t => t !== 'UNRANKED'), ...(distByTier.has('UNRANKED') ? ['UNRANKED'] : [])];
                const totalCount = Number.isFinite(ratedTotal) && ratedTotal > 0
                    ? ratedTotal
                    : tiersForChart.reduce((sum, t) => sum + (Number(distByTier.get(t)?.count ?? 0) || 0), 0);

                if (!totalCount) {
                    elBars.innerHTML = `<div class="text-gray">No tier data yet. Rate a movie to get started.</div>`;
                } else {
                    const barsHTML = tiersForChart
                        .filter(t => distByTier.has(t))
                        .map((t) => {
                            const label = formatTierLabel(t) || 'Tier';
                            const count = Number(distByTier.get(t)?.count ?? 0) || 0;
                            const pctFromRpc = Number(distByTier.get(t)?.pct ?? 0);
                            const pct = Number.isFinite(pctFromRpc) && pctFromRpc > 0
                                ? pctFromRpc
                                : (count / totalCount) * 100;
                            const h = Math.max(0, Math.min(100, pct));
                            const fill = tierColorSolid[t] || '#6b7280';
                            const bg = tierColorBg[t] || 'rgba(255,255,255,0.10)';
                            return `
                                <div class="dash-hbar-row">
                                    <div class="dash-hbar-label">${escapeHtml(label)}</div>
                                    <div class="dash-hbar-track"><div class="dash-hbar-fill" style="width:${h}%; background:${fill};"></div></div>
                                    <div class="dash-hbar-val tabular-nums">${pct.toFixed(1)}% · ${count}</div>
                                </div>
                            `;
                        })
                        .join('');

                    elBars.innerHTML = `<div class="dash-hbar-list">${barsHTML}</div>`;
                }

                // Group movies by tier
                const byTier = new Map();
                for (const row of tierMovies) {
                    const tier = String(row?.tier ?? '').trim().toUpperCase() || '—';
                    if (!byTier.has(tier)) byTier.set(tier, []);
                    byTier.get(tier).push(row);
                }

                const renderTierPosterCard = (r) => {
                    const title = String(r?.title ?? '').trim() || 'Untitled';
                    const year = (r?.release_year === null || r?.release_year === undefined) ? '' : String(r.release_year);
                    // One movie's own score — whole number. Decimals are for averages.
                    const overall = dashFormatScoreWhole(r?.overall_rating);

                    const dashMovieId = String(r?.movie_id ?? '').trim();
                    const dashTmdbId = (r?.tmdb_id === null || r?.tmdb_id === undefined) ? '' : String(r.tmdb_id);

                    const ensured = tierPosterById.get(dashMovieId) || '';
                    const poster_path = dashNormalizePosterPath(ensured || String(r?.poster_path ?? '').trim());
                    const posterUrl = dashBuildPosterUrl(poster_path, 'w342');

                    const titleWithYear = year ? `${escapeHtml(title)} (${escapeHtml(year)})` : escapeHtml(title);
                    const tierLabelForScore = dashNormalizeTierLabel(r?.tier);
                    const overallHtml = overall
                        ? `<span class="dash-tier-score tabular-nums" data-tier="${escapeHtml(tierLabelForScore)}">${escapeHtml(overall)}</span> Overall`
                        : '';

                    return `
                        <div style="display:flex; flex-direction: column; gap: 8px;">
                            <div
                                data-dash-movie-id="${escapeHtml(dashMovieId)}"
                                data-dash-tmdb-id="${escapeHtml(dashTmdbId)}"
                                data-dash-movie-title="${escapeHtml(title)}"
                                data-dash-poster-path="${escapeHtml(poster_path)}"
                                role="button"
                                tabindex="0"
                                aria-label="Update Ratings for ${escapeHtml(title)}"
                                style="width: 100%; aspect-ratio: 2/3; border-radius: 14px; overflow: hidden; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.06); cursor: pointer;"
                            >
                                ${posterUrl
                                    ? `<img src="${posterUrl}" loading="lazy" decoding="async" alt="${escapeHtml(title)}" style="width: 100%; height: 100%; object-fit: cover; display:block;" onerror="this.closest('div')?.remove?.()">`
                                    : `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; color: var(--text-muted); font-size: 12px;">No poster</div>`
                                }
                            </div>
                            <div class="text-sm text-white" style="font-weight: 700; line-height: 1.2;">${titleWithYear}</div>
                            <div class="text-xs text-white tabular-nums">${overallHtml}</div>
                        </div>
                    `;
                };

                const tiersToRender = [...tierOrder, ...[...byTier.keys()].filter(t => !tierOrder.includes(t) && t !== '—'), ...(byTier.has('—') ? ['—'] : [])];

                const listsHTML = tiersToRender
                    .filter(tier => byTier.has(tier))
                    .map((tier) => {
                        const items = byTier.get(tier) || [];
                        const ratingNums = items
                            .map((r) => Number(r?.overall_rating))
                            .filter((n) => Number.isFinite(n));
                        const avgOverall = ratingNums.length
                            ? (ratingNums.reduce((sum, n) => sum + n, 0) / ratingNums.length)
                            : null;
                        const avgOverallText = avgOverall === null ? '—' : `${Math.round(avgOverall)}%`;
                        const headerBg = tierColorBg[tier] || 'rgba(255,255,255,0.06)';
                        const headerLabel = formatTierLabel(tier) || 'Tier';
                        const help = tierHelp[String(tier ?? '').trim().toUpperCase()] || '';
                        return `
                            <details style="margin-bottom: 10px;">
                                <summary style="list-style: none; cursor: pointer; user-select: none; padding: 0.85rem 1rem; border-radius: 0.75rem; background: ${headerBg}; border: 1px solid rgba(255,255,255,0.08); display:flex; justify-content: space-between; align-items: center;">
                                    <div style="display:flex; flex-direction: column; gap: 2px;">
                                        <span class="text-white" style="font-weight: 800;">${escapeHtml(headerLabel)}</span>
                                        ${help ? `<span class=\"text-xs text-gray\">${escapeHtml(help)}</span>` : ''}
                                    </div>
                                    <div style="display:flex; flex-direction: column; align-items: flex-end; gap: 2px;">
                                        <span class="text-xs text-gray">${items.length} movie${items.length === 1 ? '' : 's'}</span>
                                        <span class="text-xs text-gray" style="white-space: nowrap;">Average Overall Rating: ${escapeHtml(avgOverallText)}</span>
                                    </div>
                                </summary>
                                <div style="padding: 0.85rem 0.5rem 0.25rem 0.5rem;">
                                    <div class="dash-fav-grid dash-tier-grid">
                                        ${items.map(renderTierPosterCard).join('')}
                                    </div>
                                </div>
                            </details>
                        `;
                    })
                    .join('');

                elLists.innerHTML = listsHTML || `<div class="text-gray">No tiered movies yet. Rate a movie to populate tiers.</div>`;

                // Small footnote if there are zero ratings
                if (!ratedTotal) {
                    elBars.innerHTML = `<div class="text-gray">No tier data yet. Rate a movie to get started.</div>`;
                }
            } catch (err) {
                showToast(`Dashboard (Tiers) failed: ${String(err?.message || err)}`, { level: 'warn' });
                emitLog('error', 'Dashboard tiers load failed', err);
                elBars.innerHTML = '';
                elLists.innerHTML = `<div class="text-gray">Unable to load tiers right now.</div>`;
            }
        }

        async function loadDashboardRatings() {
            const elGenreBars = document.getElementById('dash-ratings-genre-bars');
            const elGenreMeta = document.getElementById('dash-ratings-genre-meta');
            const elAvgGrid = document.getElementById('dash-ratings-avg-grid');

            const elTopDirector = document.getElementById('dash-ratings-top-director');
            const elTopDirectorMeta = document.getElementById('dash-ratings-top-director-meta');
            const elTopDirectorAvatar = document.getElementById('dash-ratings-top-director-avatar');

            const elBottomDirector = document.getElementById('dash-ratings-bottom-director');
            const elBottomDirectorMeta = document.getElementById('dash-ratings-bottom-director-meta');
            const elBottomDirectorAvatar = document.getElementById('dash-ratings-bottom-director-avatar');

            const required = [
                elGenreBars,
                elGenreMeta,
                elAvgGrid,
                elTopDirector,
                elTopDirectorMeta,
                elTopDirectorAvatar,
                elBottomDirector,
                elBottomDirectorMeta,
                elBottomDirectorAvatar,
            ];
            if (required.some(x => !x)) return;

            const authedUser = await dashResolveAuthUser();

            const setAvatar = (imgEl, url) => {
                if (!imgEl) return;
                const wrap = imgEl.closest('.dash-person-poster');
                if (!url) {
                    imgEl.removeAttribute('src');
                    if (wrap) wrap.classList.add('is-empty');
                    return;
                }
                imgEl.src = url;
                if (wrap) wrap.classList.remove('is-empty');
            };

            const formatPct = (value) => {
                const raw = Number(value);
                if (!Number.isFinite(raw)) return '—';
                const fixed = raw.toFixed(1);
                const trimmed = fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
                return `${trimmed}%`;
            };
            const formatPctFixed = (value, decimals = 1) => {
                const raw = Number(value);
                if (!Number.isFinite(raw)) return '—';
                return `${raw.toFixed(decimals)}%`;
            };

            const renderAvgGrid = (items) => {
                const rows = Array.isArray(items) ? items : [];
                if (!rows.length) {
                    elAvgGrid.innerHTML = `<div class="text-gray">No ratings yet.</div>`;
                    return;
                }
                const [overall, ...rest] = rows;
                const renderTile = (r) => `
                    <div class="dash-ratings-avg-tile">
                        <div class="dash-ratings-avg-label">${escapeHtml(String(r.label || ''))}</div>
                        <div class="dash-ratings-avg-row">
                            <div class="dash-ratings-avg-value tabular-nums">${escapeHtml(r.value || '—')}</div>
                            <div class="dash-ratings-avg-sub">${escapeHtml(String(r.sub || ''))}</div>
                        </div>
                        ${r.note ? `<div class="dash-ratings-avg-sub">${escapeHtml(String(r.note || ''))}</div>` : ''}
                    </div>
                `;

                const mainTile = overall ? renderTile(overall) : '';
                const subTiles = rest.map(renderTile).join('');

                elAvgGrid.innerHTML = `
                    <div class="dash-ratings-avg-layout">
                        <div class="dash-ratings-avg-main">
                            ${mainTile}
                        </div>
                        <div class="dash-ratings-avg-subgrid">
                            ${subTiles}
                        </div>
                    </div>
                `;
            };

            if (!supabaseClient || !authedUser?.id) {
                if (!dashboardAuthWarned) {
                    dashboardAuthWarned = true;
                    showToast('Log in to view your dashboard stats.', { level: 'warn' });
                }
                elGenreBars.innerHTML = `<div class="text-gray">Log in to view ratings.</div>`;
                elAvgGrid.innerHTML = `<div class="text-gray">Log in to view ratings.</div>`;
                elTopDirector.textContent = '—';
                elTopDirectorMeta.innerHTML = '&nbsp;';
                elBottomDirector.textContent = '—';
                elBottomDirectorMeta.innerHTML = '&nbsp;';
                setAvatar(elTopDirectorAvatar, null);
                setAvatar(elBottomDirectorAvatar, null);
                return;
            }

            syncDashboardRatingsChartUI();

            elGenreBars.innerHTML = `<div class="text-gray">Loading…</div>`;
            elAvgGrid.innerHTML = `<div class="text-gray">Loading…</div>`;
            elTopDirector.textContent = '…';
            elTopDirectorMeta.textContent = '…';
            elBottomDirector.textContent = '…';
            elBottomDirectorMeta.textContent = '…';
            setAvatar(elTopDirectorAvatar, null);
            setAvatar(elBottomDirectorAvatar, null);

            try {
                const res = await dashCachedRpc('get_dashboard_ratings', { p_timeframe: dashboardTimeframe }, async () => {
                    let r = await supabaseClient.rpc('get_dashboard_ratings', { p_timeframe: dashboardTimeframe });
                    if (r?.error) {
                        const msg = String(r.error?.message || r.error);
                        const looksLikeOldSignature = /get_dashboard_ratings/i.test(msg) && /(does not exist|not found|no function matches|function .* does not exist)/i.test(msg);
                        if (looksLikeOldSignature) r = await supabaseClient.rpc('get_dashboard_ratings');
                    }
                    return r;
                });
                if (res?.error) throw res.error;
                const data = res?.data || {};
                dashboardRatingsLastData = data;

                const ratedCount = Number(data?.rated_movies_count ?? 0);
                const avgOverall = formatPct(data?.avg_overall_rating);
                const avgSound = formatPct(data?.avg_sound_rating);
                const avgPlot = formatPct(data?.avg_plot_rating);
                const avgPace = formatPct(data?.avg_pacing_rating);
                const avgActing = formatPct(data?.avg_acting_rating);
                const avgImagery = formatPct(data?.avg_imagery_rating);
                const avgDialogue = formatPct(data?.avg_dialogue_rating);
                const avgImdbDiff = formatPctFixed(data?.avg_imdb_diff ?? data?.avg_imdb_diff_rating ?? data?.avg_abs_imdb_diff, 1);

                const avgItems = [
                    { label: 'Overall', value: avgOverall, sub: 'Avg', note: avgImdbDiff !== '—' ? `${avgImdbDiff} Avg ABS Diff to IMDb` : '' },
                    { label: 'Sound', value: avgSound, sub: 'Avg' },
                    { label: 'Plot', value: avgPlot, sub: 'Avg' },
                    { label: 'Pace', value: avgPace, sub: 'Avg' },
                    { label: 'Acting', value: avgActing, sub: 'Avg' },
                    { label: 'Imagery', value: avgImagery, sub: 'Avg' },
                    { label: 'Dialogue', value: avgDialogue, sub: 'Avg' },
                ];
                renderAvgGrid(avgItems);

                let chartsData = null;
                if (dashboardRatingsChartsLastData && String(dashboardRatingsChartsLastData?.timeframe || '') === String(dashboardTimeframe || '')) {
                    chartsData = dashboardRatingsChartsLastData;
                } else if (dashboardChartsLastData && String(dashboardChartsLastData?.timeframe || '') === String(dashboardTimeframe || '')) {
                    chartsData = dashboardChartsLastData;
                } else {
                    const chartsRes = await dashCachedRpc('get_dashboard_charts', { p_timeframe: dashboardTimeframe }, () =>
                        supabaseClient.rpc('get_dashboard_charts', { p_timeframe: dashboardTimeframe }));
                    if (!chartsRes?.error) {
                        chartsData = chartsRes?.data || null;
                        dashboardChartsLastData = chartsData;
                        dashboardRatingsChartsLastData = chartsData;
                    }
                }

                if (chartsData) {
                    dashboardRatingsChartsLastData = chartsData;
                    renderDashboardRatingsChartsFromData(chartsData);
                } else {
                    elGenreBars.innerHTML = `<div class="text-gray">No rated genres yet.</div>`;
                }
                const tfLabel = (() => {
                    const tf = String(dashboardTimeframe || '').trim().toLowerCase();
                    if (tf === 'this_year') return 'This Year';
                    if (tf === 'this_month') return 'This Month';
                    return 'All Time';
                })();
                elGenreMeta.textContent = `${ratedCount} rated movie${ratedCount === 1 ? '' : 's'} • ${tfLabel}`;

                const topDirector = data?.highest_rated_director || {};
                const bottomDirector = data?.lowest_rated_director || {};

                const topDirectorName = String(topDirector?.name ?? '').trim();
                const topDirectorAvg = formatPct(topDirector?.avg_overall);
                const topDirectorN = Number(topDirector?.n ?? 0);
                elTopDirector.textContent = topDirectorName || '—';
                elTopDirectorMeta.textContent = topDirectorName
                    ? `${topDirectorAvg} Overall • ${topDirectorN} movie${topDirectorN === 1 ? '' : 's'}`
                    : '—';

                const bottomDirectorName = String(bottomDirector?.name ?? '').trim();
                const bottomDirectorAvg = formatPct(bottomDirector?.avg_overall);
                const bottomDirectorN = Number(bottomDirector?.n ?? 0);
                elBottomDirector.textContent = bottomDirectorName || '—';
                elBottomDirectorMeta.textContent = bottomDirectorName
                    ? `${bottomDirectorAvg} Overall • ${bottomDirectorN} movie${bottomDirectorN === 1 ? '' : 's'}`
                    : '—';

                try {
                    if (topDirectorName) {
                        const profile = await dashFetchPersonProfile({
                            name: topDirectorName,
                            department: 'directing',
                        });
                        setAvatar(elTopDirectorAvatar, dashBuildPersonUrl(profile));
                    }
                    if (bottomDirectorName) {
                        const profile = await dashFetchPersonProfile({
                            name: bottomDirectorName,
                            department: 'directing',
                        });
                        setAvatar(elBottomDirectorAvatar, dashBuildPersonUrl(profile));
                    }
                } catch (_) {
                    setAvatar(elTopDirectorAvatar, null);
                    setAvatar(elBottomDirectorAvatar, null);
                }
            } catch (err) {
                showToast(`Dashboard (Ratings) failed: ${String(err?.message || err)}`, { level: 'warn' });
                emitLog('error', 'Dashboard ratings load failed', err);
                elGenreBars.innerHTML = `<div class="text-gray">Unable to load ratings right now.</div>`;
                elAvgGrid.innerHTML = `<div class="text-gray">Unable to load ratings right now.</div>`;
                elTopDirector.textContent = '—';
                elTopDirectorMeta.innerHTML = '&nbsp;';
                elBottomDirector.textContent = '—';
                elBottomDirectorMeta.innerHTML = '&nbsp;';
                setAvatar(elTopDirectorAvatar, null);
                setAvatar(elBottomDirectorAvatar, null);
            }
        }

        function dashSetStackBar(elA, elB, aValue, bValue) {
            if (!elA || !elB) return;
            const a = Number(aValue);
            const b = Number(bValue);
            const total = (Number.isFinite(a) ? a : 0) + (Number.isFinite(b) ? b : 0);
            const aStrong = (Number.isFinite(a) ? a : 0) >= (Number.isFinite(b) ? b : 0);
            elA.classList.toggle('is-strong', aStrong && total > 0);
            elB.classList.toggle('is-strong', !aStrong && total > 0);
            if (!Number.isFinite(total) || total <= 0) {
                elA.style.height = '0%';
                elB.style.height = '0%';
                return;
            }
            const aPct = Math.max(0, Math.min(100, (a / total) * 100));
            const bPct = Math.max(0, Math.min(100, (b / total) * 100));
            const minPct = 4;
            elA.style.height = `${Math.max(aPct > 0 ? minPct : 0, aPct)}%`;
            elB.style.height = `${Math.max(bPct > 0 ? minPct : 0, bPct)}%`;
        }

        // Watch method is now a simple KPI ("X% — Y of Z watched in theaters")
        // instead of the old stacked bar chart.
        function dashSetWatchMethodDisplay(atHome, inTheater) {
            const home = Number(atHome) || 0;
            const theater = Number(inTheater) || 0;
            const total = home + theater;
            const theaterPct = total > 0 ? ((theater / total) * 100) : 0;

            const elPct = document.getElementById('dash-general-theater-pct');
            const elTheaterCount = document.getElementById('dash-general-theater-count');
            const elTotal = document.getElementById('dash-general-watch-total');
            const elHomeCount = document.getElementById('dash-general-home-count');

            if (elPct) elPct.textContent = `${theaterPct.toFixed(0)}%`;
            if (elTheaterCount) elTheaterCount.textContent = String(theater);
            if (elTotal) elTotal.textContent = String(total);
            if (elHomeCount) elHomeCount.textContent = String(home);
        }

        function dashResetWatchMethodDisplay() {
            dashSetWatchMethodDisplay(dashboardGeneralMethodBase.atHome, dashboardGeneralMethodBase.inTheater);
        }

        function dashGetWatchMethodForPieLabel(type, label) {
            const data = dashboardGeneralPieData || {};
            const rows = type === 'genre'
                ? (data.genreMethodItems || [])
                : (type === 'decade' ? (data.decadeMethodItems || []) : (data.mpaMethodItems || []));
            if (!Array.isArray(rows) || rows.length === 0) return null;

            const normalizedLabel = type === 'genre' ? dashNormalizeGenreLabel(label) : String(label || '').trim();
            if (!normalizedLabel) return null;

            let atHome = 0;
            let inTheater = 0;

            if (type === 'genre' && normalizedLabel.toLowerCase() === 'other') {
                const otherLabels = new Set((dashboardGeneralGenreOtherItems || []).map((item) => dashNormalizeGenreLabel(item?.label)));
                if (otherLabels.size === 0) return null;
                rows.forEach((row) => {
                    const rowLabel = dashNormalizeGenreLabel(row?.label);
                    if (!otherLabels.has(rowLabel)) return;
                    const method = dashNormalizeWatchMethod(row?.method || row?.watch_method);
                    const value = Number(row?.value ?? row?.count ?? 0) || 0;
                    if (method === 'At Home') atHome += value;
                    if (method === 'In Theater') inTheater += value;
                });
                return { atHome, inTheater };
            }

            rows.forEach((row) => {
                const rowLabel = type === 'genre' ? dashNormalizeGenreLabel(row?.label) : String(row?.label || '').trim();
                if (rowLabel !== normalizedLabel) return;
                const method = dashNormalizeWatchMethod(row?.method || row?.watch_method);
                const value = Number(row?.value ?? row?.count ?? 0) || 0;
                if (method === 'At Home') atHome += value;
                if (method === 'In Theater') inTheater += value;
            });

            return { atHome, inTheater };
        }

        function dashBuildPalette(count) {
            const total = Math.max(1, Number(count) || 1);
            const style = getComputedStyle(document.documentElement);
            const baseColors = [
                String(style.getPropertyValue('--brand') || '').trim() || '#4e79a7',
                String(style.getPropertyValue('--accent-2') || '').trim() || '#f28e2b',
                String(style.getPropertyValue('--brand-2') || '').trim() || '#76b7b2',
            ];
            const shadeSteps = [85, 70, 55, 40];
            return Array.from({ length: total }, (_, i) => {
                const base = baseColors[i % baseColors.length];
                const shade = shadeSteps[Math.floor(i / baseColors.length) % shadeSteps.length];
                return `color-mix(in srgb, ${base} ${shade}%, white)`;
            });
        }

        function dashNormalizeWatchMethod(raw) {
            const s = String(raw || '').trim().toLowerCase();
            if (!s) return '';
            if (s.includes('home')) return 'At Home';
            if (s.includes('theater') || s.includes('theatre')) return 'In Theater';
            return '';
        }

        function dashNormalizeGenreLabel(raw) {
            const label = String(raw ?? '').trim();
            if (!label) return '';
            const key = label.toLowerCase().replace(/\s+/g, '');
            if (key === 'sciencefiction' || key === 'scifi' || key === 'sci-fi') return 'Sci-Fi';
            return label;
        }

        function dashGenreFilterValue(label) {
            const normalized = dashNormalizeGenreLabel(label);
            if (normalized === 'Sci-Fi') return 'Science Fiction';
            return normalized;
        }

        function dashBuildGenrePieItems(items, limit = 8) {
            const rows = Array.isArray(items) ? items : [];
            const map = new Map();
            rows.forEach((r) => {
                const label = dashNormalizeGenreLabel(r?.label);
                const value = Number(r?.value ?? 0);
                if (!label || !Number.isFinite(value) || value <= 0) return;
                const prev = map.get(label) || 0;
                map.set(label, prev + value);
            });
            const merged = Array.from(map.entries()).map(([label, value]) => ({ label, value }));
            merged.sort((a, b) => b.value - a.value);
            const total = merged.reduce((sum, r) => sum + r.value, 0);
            const top = merged.slice(0, Math.max(1, limit));
            const otherItems = merged.slice(top.length);
            const otherValue = otherItems.reduce((sum, r) => sum + r.value, 0);
            const itemsWithOther = otherValue > 0
                ? [...top, { label: 'Other', value: otherValue, isOther: true }]
                : top;
            return { items: itemsWithOther, otherItems, total };
        }

        function dashRenderPieChart({ el, legendEl, items, labelKey, valueKey, maxSlices = 999, legendCols = null }) {
            if (!el || !legendEl) return;
            if (legendEl.classList) {
                const wantsCompact = legendEl.id === 'dash-general-genre-legend' || legendEl.dataset.compact === 'true';
                legendEl.classList.toggle('compact', wantsCompact);
            }
            const rows = Array.isArray(items) ? items : [];
            const clean = rows
                .map((r) => ({
                    label: String(r?.[labelKey] ?? '').trim(),
                    value: Number(r?.[valueKey] ?? 0),
                }))
                .filter((r) => r.label && Number.isFinite(r.value) && r.value > 0)
                .sort((a, b) => b.value - a.value);

            if (!clean.length) {
                el.style.background = 'conic-gradient(rgba(255,255,255,0.08) 0deg 360deg)';
                el._pieStops = null;
                el._pieColors = null;
                el._pieItems = [];
                el._pieTotal = 0;
                legendEl.innerHTML = `<div class="text-gray">No data yet.</div>`;
                return;
            }

            const sliceCount = Math.max(1, Math.min(maxSlices, clean.length));
            const top = clean.slice(0, sliceCount);
            const colCount = Number.isFinite(legendCols) && legendCols > 0
                ? legendCols
                : Math.max(1, Math.ceil(top.length / 5));
            legendEl.style.setProperty('--legend-cols', String(colCount));

            const total = top.reduce((sum, r) => sum + r.value, 0);
            const colors = dashBuildPalette(top.length);
            let current = 0;
            const stops = top.map((r, idx) => {
                const portion = total > 0 ? (r.value / total) : 0;
                const start = current;
                const end = current + (portion * 360);
                current = end;
                return { start, end, color: colors[idx] };
            });

            const gradient = stops.map((s) => `${s.color} ${s.start.toFixed(1)}deg ${s.end.toFixed(1)}deg`).join(', ');
            el.style.background = `conic-gradient(${gradient})`;
            el._pieStops = stops;
            el._pieColors = colors;
            el._pieItems = top;
            el._pieTotal = total;

            legendEl.innerHTML = top.map((r, idx) => {
                const pct = total > 0 ? ((r.value / total) * 100) : 0;
                const pctText = pct.toFixed(1);
                const isOther = String(r.label || '').trim().toLowerCase() === 'other' || r.isOther === true;
                return `
                    <div class="dash-pie-legend-item" role="button" tabindex="0" data-dash-pie-index="${idx}" data-dash-pie-value="${escapeHtml(encodeURIComponent(String(r.label)))}" data-dash-pie-label="${escapeHtml(r.label)}" data-dash-pie-other="${isOther ? 'true' : 'false'}">
                        <span class="dash-pie-legend-label" title="${escapeHtml(r.label)}"><span class="dash-legend-dot" style="background:${colors[idx]}"></span>${escapeHtml(r.label)}</span>
                        <span class="tabular-nums">${escapeHtml(pctText)}% (${escapeHtml(String(r.value))})</span>
                    </div>
                `;
            }).join('');
            legendEl.classList.remove('is-dim');
        }

        function dashSetPieLegendHighlight(legendEl, index) {
            if (!legendEl) return;
            const items = Array.from(legendEl.querySelectorAll('.dash-pie-legend-item'));
            const isActive = Number.isFinite(index) && index >= 0;
            legendEl.classList.toggle('is-dim', isActive);
            items.forEach((item) => {
                const idx = Number(item.dataset.dashPieIndex);
                item.classList.toggle('is-active', isActive && idx === index);
            });
        }

        function dashSetPieHighlight(pieEl, legendEl, index) {
            if (!pieEl || !pieEl._pieStops || !Array.isArray(pieEl._pieStops)) return;
            const stops = pieEl._pieStops;
            const colors = Array.isArray(pieEl._pieColors) ? pieEl._pieColors : stops.map((s) => s.color);
            const hasActive = Number.isFinite(index) && index >= 0;
            const gradient = stops.map((s, i) => {
                const base = colors[i] || s.color;
                const color = hasActive && i !== index
                    ? `color-mix(in srgb, ${base} 18%, rgba(10,10,10,0.9))`
                    : base;
                return `${color} ${s.start.toFixed(1)}deg ${s.end.toFixed(1)}deg`;
            }).join(', ');
            pieEl.style.background = `conic-gradient(${gradient})`;
            dashSetPieLegendHighlight(legendEl, hasActive ? index : -1);
        }

        function dashFindPieIndex(pieEl, angle) {
            const stops = pieEl?._pieStops;
            if (!Array.isArray(stops)) return -1;
            const a = Number(angle);
            if (!Number.isFinite(a)) return -1;
            return stops.findIndex((s) => a >= s.start && a < s.end);
        }

        function dashAngleFromEvent(pieEl, event) {
            if (!pieEl || !event) return null;
            const rect = pieEl.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const dx = event.clientX - cx;
            const dy = event.clientY - cy;
            if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const outerRadius = rect.width / 2;
            const innerRadius = rect.width * 0.31;
            if (!Number.isFinite(dist) || dist <= innerRadius || dist > outerRadius) return null;
            const deg = (Math.atan2(dy, dx) * 180 / Math.PI + 90 + 360) % 360;
            return deg;
        }

        function renderDashboardGeneralSharePie() {
            const elPie = document.getElementById('dash-general-share-pie');
            const elLegend = document.getElementById('dash-general-share-legend');
            if (!elPie || !elLegend) return;

            const rawMode = String(dashboardGeneralPieMode || '').trim().toLowerCase();
            const mode = rawMode === 'decade' ? 'decade' : (rawMode === 'genre' ? 'genre' : 'mpa');
            const data = dashboardGeneralPieData || {};
            let items = mode === 'decade'
                ? (data.decadeItems || [])
                : (mode === 'genre' ? (data.genreItems || []) : (data.mpaItems || []));
            if (mode === 'genre') {
                const prep = dashBuildGenrePieItems(items, 8);
                items = prep.items;
                dashboardGeneralGenreOtherItems = prep.otherItems;
                dashboardGeneralGenreOtherTotal = prep.total;
            } else {
                dashboardGeneralGenreOtherItems = [];
                dashboardGeneralGenreOtherTotal = 0;
            }
            elLegend.dataset.compact = mode === 'genre' ? 'true' : 'false';
            elLegend.dataset.pieType = mode;
            // Reset the mobile tap-to-reveal segment detail when the slice set changes.
            const elPieDetail = document.getElementById('dash-pie-segment-detail');
            if (elPieDetail) { elPieDetail.classList.remove('is-shown'); elPieDetail.innerHTML = ''; }
            dashRenderPieChart({
                el: elPie,
                legendEl: elLegend,
                items,
                labelKey: 'label',
                valueKey: 'value',
                legendCols: null,
            });
        }

        function dashRenderVerticalBars({ items, labelKey, valueKey, countKey, barType }) {
            const rows = Array.isArray(items) ? items : [];
            if (!rows.length) return `<div class="text-gray">No data yet.</div>`;
            const max = rows.reduce((m, r) => Math.max(m, Number(r?.[valueKey]) || 0), 0) || 0;
            const colors = dashBuildPalette(rows.length);
            const scale = 0.8;
            return `
                <div class="dash-hbar-list">
                    ${rows.map((r, idx) => {
                        const label = String(r?.[labelKey] ?? '').trim();
                        const val = Number(r?.[valueKey]) || 0;
                        const pct = max > 0 ? ((val / max) * 100 * scale) : 0;
                        const count = (countKey && r?.[countKey] !== undefined) ? Number(r[countKey]) : null;
                        const valueText = `${Number(val).toFixed(1)}%`;
                        const countText = Number.isFinite(count) ? ` · ${count}` : '';
                        return `
                            <div class="dash-hbar-row" title="${escapeHtml(label)}" role="button" tabindex="0" data-rating-bar="true" data-bar-type="${escapeHtml(String(barType || 'genre'))}" data-bar-label="${escapeHtml(label)}">
                                <div class="dash-hbar-label">${escapeHtml(label || '—')}</div>
                                <div class="dash-hbar-track"><div class="dash-hbar-fill" style="width:${pct.toFixed(2)}%; background:${colors[idx]};"></div></div>
                                <div class="dash-hbar-val tabular-nums">${escapeHtml(valueText + countText)}</div>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        }

        async function loadDashboardGeneral() {
            const elEventsTotal = document.getElementById('dash-general-watch-events-total');
            const elHours = document.getElementById('dash-general-hours-watched');
            const elAtHomeWatches = document.getElementById('dash-general-at-home-watches');
            const elInTheaterWatches = document.getElementById('dash-general-in-theater-watches');

            const elStackHome = document.getElementById('dash-general-stack-home');
            const elStackTheater = document.getElementById('dash-general-stack-theater');

            const elTopGenreEvents = document.getElementById('dash-general-top-genre-events');
            const elTopGenreEventsCount = document.getElementById('dash-general-top-genre-events-count');

            const elTopDirectorEvents = document.getElementById('dash-general-top-director-events');
            const elTopDirectorEventsCount = document.getElementById('dash-general-top-director-events-count');
            const elTopDirectorAvatar = document.getElementById('dash-general-top-director-avatar');
            const elTopDirectorMore = document.getElementById('dash-general-top-director-more');
            const elTopDirectorAvg = document.getElementById('dash-general-top-director-avg');

            const elTopActorEvents = document.getElementById('dash-general-top-actor-events');
            const elTopActorEventsCount = document.getElementById('dash-general-top-actor-events-count');
            const elTopActorAvatar = document.getElementById('dash-general-top-actor-avatar');
            const elTopActorMore = document.getElementById('dash-general-top-actor-more');
            const elTopActorAvg = document.getElementById('dash-general-top-actor-avg');

            const elTopDecadeEvents = document.getElementById('dash-general-top-decade-events');
            const elTopDecadeEventsCount = document.getElementById('dash-general-top-decade-events-count');
            const elTopMovieGrid = document.getElementById('dash-general-top-movie-grid');

            const elTopMpaEvents = document.getElementById('dash-general-top-mpa-events');
            const elTopMpaEventsCount = document.getElementById('dash-general-top-mpa-events-count');

            const safeText = (el, v) => { if (el) el.textContent = v; };
            const safeHtml = (el, v) => { if (el) el.innerHTML = v; };
            const setAvatar = (imgEl, url) => {
                if (!imgEl) return;
                const wrap = imgEl.closest('.dash-person-poster');
                if (!url) {
                    imgEl.removeAttribute('src');
                    if (wrap) wrap.classList.add('is-empty');
                    return;
                }
                imgEl.src = url;
                if (wrap) wrap.classList.remove('is-empty');
            };

            // Require auth for dashboard.
            const authedUser = await dashResolveAuthUser();

            const setAll = (v) => {
                safeText(elEventsTotal, v);
                safeText(elHours, v);
                safeText(elAtHomeWatches, v);
                safeText(elInTheaterWatches, v);
                safeText(elTopGenreEvents, v);
                safeHtml(elTopGenreEventsCount, '&nbsp;');
                safeText(elTopDirectorEvents, v);
                safeHtml(elTopDirectorEventsCount, '&nbsp;');
                safeHtml(elTopDirectorAvg, '&nbsp;');
                safeHtml(elTopDirectorMore, '');
                safeText(elTopActorEvents, v);
                safeHtml(elTopActorEventsCount, '&nbsp;');
                safeHtml(elTopActorAvg, '&nbsp;');
                safeHtml(elTopActorMore, '');
                setAvatar(elTopDirectorAvatar, null);
                setAvatar(elTopActorAvatar, null);
                safeText(elTopDecadeEvents, v);
                safeHtml(elTopDecadeEventsCount, '&nbsp;');
                safeHtml(elTopMovieGrid, '<div class="text-gray">—</div>');
                safeText(elTopMpaEvents, v);
                safeHtml(elTopMpaEventsCount, '&nbsp;');
                dashSetStackBar(elStackHome, elStackTheater, 0, 0);
                dashboardGeneralPieData = {
                    mpaItems: [],
                    decadeItems: [],
                    genreItems: [],
                    mpaMethodItems: [],
                    decadeMethodItems: [],
                    genreMethodItems: [],
                };
                renderDashboardGeneralSharePie();
            };

            const pluralize = (n, one, many) => {
                const x = Number(n);
                const v = Number.isFinite(x) ? x : 0;
                return `${v} ${v === 1 ? one : many}`;
            };
            const formatHoursClock = (value) => {
                const raw = Number(value);
                if (!Number.isFinite(raw) || raw <= 0) return '0:00';
                const totalMinutes = Math.round(raw * 60);
                const hours = Math.floor(totalMinutes / 60);
                const minutes = totalMinutes % 60;
                return `${hours}:${String(minutes).padStart(2, '0')}`;
            };
            const formatPct = (value) => {
                const raw = Number(value);
                if (!Number.isFinite(raw)) return '—';
                const fixed = raw.toFixed(1);
                const trimmed = fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
                return `${trimmed}%`;
            };
            const useUnique = String(dashboardGeneralMode || '').trim().toLowerCase() === 'unique';
            const renderMostWatchedMovies = async (movies, fallbackMovie) => {
                if (!elTopMovieGrid) return;
                const list = Array.isArray(movies) ? movies : [];
                const items = list.length ? list : (fallbackMovie?.title ? [fallbackMovie] : []);
                if (!items.length) {
                    safeHtml(elTopMovieGrid, '<div class="text-gray">No data yet.</div>');
                    return;
                }

                const first = items[0];
                const extra = Math.max(0, items.length - 1);
                elTopMovieGrid.style.setProperty('--mw-poster-min', '160px');

                const title = String(first?.title ?? '').trim();
                const year = first?.release_year;
                const label = title
                    ? `${title}${(year === null || year === undefined || String(year).trim() === '') ? '' : ` (${String(year)})`}`
                    : '—';

                let posterPath = String(first?.poster_path ?? '').trim();
                if (!posterPath) {
                    const resolved = await dashEnsurePosterPath({
                        movie_id: first?.movie_id ?? first?.movieId ?? first?.id ?? null,
                        tmdb_id: first?.tmdb_id ?? null,
                        poster_path: posterPath || null,
                    });
                    if (resolved) posterPath = String(resolved).trim();
                }
                const posterUrl = posterPath ? dashBuildPosterUrl(posterPath, 'w342') : '';

                const ratingRaw = Number(first?.overall_rating ?? NaN);
                const ratingText = formatPct(ratingRaw);
                const ratingLabel = ratingText === '—' ? '— Overall' : `${ratingText} Overall`;
                const tierRaw = String(first?.tier ?? '').trim();
                const tierLabel = tierRaw || '—';
                const tierHtml = tierRaw
                    ? `<span class="dash-tier-pill" data-tier="${escapeHtml(tierRaw)}">${escapeHtml(tierLabel)}</span>`
                    : `<span class="text-gray">Tier —</span>`;
                const watchCount = Number(first?.watches ?? fallbackMovie?.watches ?? NaN);
                const watchCountText = (!useUnique && Number.isFinite(watchCount))
                    ? pluralize(watchCount, 'watch event', 'watch events')
                    : '';

                const moreHtml = extra > 0
                    ? `<div class="dash-kpi-more">+ ${extra} more <span>view all</span></div>`
                    : '';

                safeHtml(elTopMovieGrid, `
                    <div class="dash-most-movie-card">
                        <div class="dash-most-movie-poster">
                            ${posterUrl
                                ? `<img src="${escapeHtml(posterUrl)}" alt="${escapeHtml(title)}" loading="lazy">`
                                : `<div class="dash-most-movie-placeholder text-gray">No poster</div>`}
                        </div>
                        <div class="dash-most-movie-text">
                            <div class="dash-most-movie-title">${escapeHtml(label)}</div>
                            <div class="dash-most-movie-meta">
                                <span class="dash-most-movie-rating">${escapeHtml(ratingLabel)}</span>
                                ${tierHtml}
                            </div>
                            ${watchCountText ? `<div class="dash-kpi-top-count tabular-nums">${escapeHtml(watchCountText)}</div>` : ''}
                            ${moreHtml}
                        </div>
                    </div>
                `);
            };

            if (!supabaseClient || !authedUser?.id) {
                if (!dashboardAuthWarned) {
                    dashboardAuthWarned = true;
                    showToast('Log in to view your dashboard stats.', { level: 'warn' });
                }
                setAll('—');
                return;
            }

            setAll('…');

            try {
                const res = await dashCachedRpc('get_dashboard_general', { p_timeframe: dashboardTimeframe }, async () => {
                    let r = await supabaseClient.rpc('get_dashboard_general', { p_timeframe: dashboardTimeframe });
                    if (r?.error) {
                        const msg = String(r.error?.message || r.error);
                        const looksLikeOldSignature = /get_dashboard_general/i.test(msg) && /(does not exist|not found|no function matches|function .* does not exist)/i.test(msg);
                        if (looksLikeOldSignature) r = await supabaseClient.rpc('get_dashboard_general');
                    }
                    return r;
                });
                if (res?.error) throw res.error;
                const data = res?.data;
                dashboardGeneralLastData = data;

                const watchEvents = data?.watch_events || {};
                const totalWatches = Number(watchEvents?.watches ?? 0);
                const uniqueMovies = Number(watchEvents?.movies ?? 0);

                const totalHours = Number(data?.hours_watched ?? 0);
                const uniqueHours = Number(data?.hours_watched_unique ?? 0);

                const method = data?.watch_method_breakdown || {};
                const atHomeObj = method?.at_home || {};
                const inTheaterObj = method?.in_theater || {};

                const atHome = Number(atHomeObj?.watches ?? 0);
                const atHomeUnique = Number(atHomeObj?.movies ?? 0);
                const inTheater = Number(inTheaterObj?.watches ?? 0);
                const inTheaterUnique = Number(inTheaterObj?.movies ?? 0);

                const useUnique = String(dashboardGeneralMode || '').trim().toLowerCase() === 'unique';
                const displayWatches = useUnique ? uniqueMovies : totalWatches;
                const displayHours = useUnique ? uniqueHours : totalHours;
                const displayAtHome = useUnique ? atHomeUnique : atHome;
                const displayTheater = useUnique ? (Number.isFinite(inTheaterUnique) && inTheaterUnique > 0 ? inTheaterUnique : inTheater) : inTheater;

                const topGenre = data?.most_watched_genre || {};
                const topGenreUnique = data?.most_watched_genre_unique || {};
                const topDirector = data?.most_watched_director || {};
                const topDirectorUnique = data?.most_watched_director_unique || {};
                const topDirectors = Array.isArray(useUnique ? data?.most_watched_directors_unique : data?.most_watched_directors)
                    ? (useUnique ? data.most_watched_directors_unique : data.most_watched_directors)
                    : [];
                const topActor = data?.most_watched_actor || {};
                const topActorUnique = data?.most_watched_actor_unique || {};
                const topActors = Array.isArray(useUnique ? data?.most_watched_actors_unique : data?.most_watched_actors)
                    ? (useUnique ? data.most_watched_actors_unique : data.most_watched_actors)
                    : [];
                const topDecade = data?.most_watched_decade || {};
                const topDecadeUnique = data?.most_watched_decade_unique || {};

                safeText(elEventsTotal, Number.isFinite(displayWatches) ? String(displayWatches) : '0');
                safeText(elHours, formatHoursClock(displayHours));

                dashboardGeneralMethodBase = {
                    atHome: Number.isFinite(displayAtHome) ? displayAtHome : 0,
                    inTheater: Number.isFinite(displayTheater) ? displayTheater : 0,
                };
                dashSetWatchMethodDisplay(dashboardGeneralMethodBase.atHome, dashboardGeneralMethodBase.inTheater);

                const genreEventsName = String(topGenre?.name ?? '').trim();
                const genreUniqueName = String(topGenreUnique?.name ?? '').trim();
                safeText(elTopGenreEvents, (useUnique ? genreUniqueName : genreEventsName) || '—');
                safeText(elTopGenreEventsCount, useUnique
                    ? pluralize(topGenreUnique?.movies, 'unique movie', 'unique movies')
                    : pluralize(topGenre?.watches, 'watch event', 'watch events'));

                const directorEventsName = String(topDirector?.name ?? '').trim();
                const directorUniqueName = String(topDirectorUnique?.name ?? '').trim();
                const directorDisplayName = (useUnique ? directorUniqueName : directorEventsName) || '';
                safeText(elTopDirectorEvents, directorDisplayName || '—');
                const directorMovies = useUnique ? topDirectorUnique?.movies : topDirector?.movies;
                const directorWatches = useUnique ? null : topDirector?.watches;
                const directorAvg = useUnique ? topDirectorUnique?.avg_overall : topDirector?.avg_overall;
                const directorExtra = Math.max(0, topDirectors.length - 1);
                const directorAvgText = formatPct(directorAvg);
                const directorCountText = (directorMovies !== undefined && directorMovies !== null)
                    ? pluralize(directorMovies, 'movie', 'movies')
                    : '';
                const directorWatchText = (!useUnique && directorWatches !== undefined && directorWatches !== null)
                    ? pluralize(directorWatches, 'watch event', 'watch events')
                    : '';
                const directorTopParts = [directorCountText, directorWatchText].filter(Boolean);
                safeText(elTopDirectorEventsCount, directorTopParts.length ? directorTopParts.join(' • ') : '—');
                safeText(elTopDirectorAvg, directorAvgText === '—' ? '— Overall' : `${directorAvgText} Overall`);
                safeHtml(elTopDirectorMore, directorExtra > 0
                    ? `+ ${directorExtra} more <span>view all</span>`
                    : '');

                const actorEventsName = String(topActor?.name ?? '').trim();
                const actorUniqueName = String(topActorUnique?.name ?? '').trim();
                const actorDisplayName = (useUnique ? actorUniqueName : actorEventsName) || '';
                safeText(elTopActorEvents, actorDisplayName || '—');
                const actorMovies = useUnique ? topActorUnique?.movies : topActor?.movies;
                const actorWatches = useUnique ? null : topActor?.watches;
                const actorAvg = useUnique ? topActorUnique?.avg_acting : topActor?.avg_acting;
                const actorExtra = Math.max(0, topActors.length - 1);
                const actorAvgText = formatPct(actorAvg);
                const actorCountText = (actorMovies !== undefined && actorMovies !== null)
                    ? pluralize(actorMovies, 'movie', 'movies')
                    : '';
                const actorWatchText = (!useUnique && actorWatches !== undefined && actorWatches !== null)
                    ? pluralize(actorWatches, 'watch event', 'watch events')
                    : '';
                const actorTopParts = [actorCountText, actorWatchText].filter(Boolean);
                safeText(elTopActorEventsCount, actorTopParts.length ? actorTopParts.join(' • ') : '—');
                safeText(elTopActorAvg, actorAvgText === '—' ? '— Acting' : `${actorAvgText} Acting`);
                safeHtml(elTopActorMore, actorExtra > 0
                    ? `+ ${actorExtra} more <span>view all</span>`
                    : '');

                try {
                    if (directorDisplayName) {
                        const directorProfile = await dashFetchPersonProfile({
                            name: directorDisplayName,
                            department: 'directing',
                        });
                        setAvatar(elTopDirectorAvatar, dashBuildPersonUrl(directorProfile));
                    } else {
                        setAvatar(elTopDirectorAvatar, null);
                    }

                    if (actorDisplayName) {
                        const actorProfile = await dashFetchPersonProfile({
                            name: actorDisplayName,
                            department: 'acting',
                        });
                        setAvatar(elTopActorAvatar, dashBuildPersonUrl(actorProfile));
                    } else {
                        setAvatar(elTopActorAvatar, null);
                    }
                } catch (_) {
                    setAvatar(elTopDirectorAvatar, null);
                    setAvatar(elTopActorAvatar, null);
                }

                const decadeEvents = topDecade?.decade;
                const decadeEventsLabel = (decadeEvents === null || decadeEvents === undefined) ? '' : `${String(decadeEvents)}s`;
                const decadeUnique = topDecadeUnique?.decade;
                const decadeUniqueLabel = (decadeUnique === null || decadeUnique === undefined) ? '' : `${String(decadeUnique)}s`;
                safeText(elTopDecadeEvents, (useUnique ? decadeUniqueLabel : decadeEventsLabel) || '—');
                safeText(elTopDecadeEventsCount, useUnique
                    ? pluralize(topDecadeUnique?.movies, 'unique movie', 'unique movies')
                    : pluralize(topDecade?.watches, 'watch event', 'watch events'));

                const topMovie = data?.most_watched_movie || {};
                const topMovies = Array.isArray(data?.most_watched_movies) ? data.most_watched_movies : [];
                await renderMostWatchedMovies(topMovies, topMovie);

                const topMpa = data?.most_watched_mpa || {};
                const topMpaUnique = data?.most_watched_mpa_unique || {};
                const topMpaRating = String(topMpa?.rating ?? '').trim();
                const topMpaRatingUnique = String(topMpaUnique?.rating ?? '').trim();
                safeText(elTopMpaEvents, (useUnique ? topMpaRatingUnique : topMpaRating) || '—');
                safeText(elTopMpaEventsCount, useUnique
                    ? pluralize(topMpaUnique?.movies, 'unique movie', 'unique movies')
                    : pluralize(topMpa?.watches, 'watch event', 'watch events'));

                try {
                    let chartsData = null;
                    if (dashboardChartsLastData && String(dashboardChartsLastData?.timeframe || '') === String(dashboardTimeframe || '')) {
                        chartsData = dashboardChartsLastData;
                    } else {
                        const chartsRes = await dashCachedRpc('get_dashboard_charts', { p_timeframe: dashboardTimeframe }, () =>
                            supabaseClient.rpc('get_dashboard_charts', { p_timeframe: dashboardTimeframe }));
                        if (!chartsRes?.error) chartsData = chartsRes?.data || null;
                    }

                    const genreSource = useUnique ? chartsData?.genre_counts_unique : chartsData?.genre_counts_total;
                    const pickCount = (row, unique) => {
                        const direct = Number(row?.count ?? NaN);
                        if (Number.isFinite(direct)) return direct;
                        const fallback = Number(unique ? row?.movies : row?.watches);
                        return Number.isFinite(fallback) ? fallback : 0;
                    };
                    const genreItems = Array.isArray(genreSource)
                        ? genreSource.map((r) => ({ label: dashNormalizeGenreLabel(r?.genre), value: pickCount(r, useUnique) }))
                        : (Array.isArray(chartsData?.genres)
                            ? chartsData.genres.map((r) => ({ label: dashNormalizeGenreLabel(r?.genre), value: Number(r?.n ?? 0) }))
                            : []);
                    const mpaSource = useUnique ? chartsData?.mpa_counts_unique : chartsData?.mpa_counts_total;
                    const mpaItems = Array.isArray(mpaSource)
                        ? mpaSource.map((r) => ({ label: r?.mpa, value: pickCount(r, useUnique) }))
                        : (Array.isArray(chartsData?.mpa)
                            ? chartsData.mpa.map((r) => ({ label: r?.mpa, value: Number(r?.n ?? 0) }))
                            : []);

                    const decadeSource = useUnique ? chartsData?.decade_counts_unique : chartsData?.decade_counts_total;
                    const decadeItems = Array.isArray(decadeSource)
                        ? decadeSource.map((r) => ({ label: r?.decade !== null && r?.decade !== undefined ? `${String(r.decade)}s` : '', value: pickCount(r, useUnique) }))
                        : (Array.isArray(chartsData?.decades)
                            ? chartsData.decades.map((r) => ({ label: r?.decade !== null && r?.decade !== undefined ? `${String(r.decade)}s` : '', value: Number(r?.n ?? 0) }))
                            : []);
                    const genreMethodSource = useUnique ? chartsData?.genre_method_counts_unique : chartsData?.genre_method_counts_total;
                    const genreMethodItems = Array.isArray(genreMethodSource)
                        ? genreMethodSource.map((r) => ({
                            label: dashNormalizeGenreLabel(r?.genre),
                            method: r?.watch_method,
                            value: Number(r?.count ?? 0),
                        }))
                        : [];

                    const decadeMethodSource = useUnique ? chartsData?.decade_method_counts_unique : chartsData?.decade_method_counts_total;
                    const decadeMethodItems = Array.isArray(decadeMethodSource)
                        ? decadeMethodSource.map((r) => ({
                            label: r?.decade !== null && r?.decade !== undefined ? `${String(r.decade)}s` : '',
                            method: r?.watch_method,
                            value: Number(r?.count ?? 0),
                        }))
                        : [];

                    const mpaMethodSource = useUnique ? chartsData?.mpa_method_counts_unique : chartsData?.mpa_method_counts_total;
                    const mpaMethodItems = Array.isArray(mpaMethodSource)
                        ? mpaMethodSource.map((r) => ({
                            label: r?.mpa,
                            method: r?.watch_method,
                            value: Number(r?.count ?? 0),
                        }))
                        : [];

                    dashboardGeneralPieData = {
                        mpaItems,
                        decadeItems,
                        genreItems,
                        mpaMethodItems,
                        decadeMethodItems,
                        genreMethodItems,
                    };
                    renderDashboardGeneralSharePie();
                } catch (_) {
                    dashboardGeneralPieData = {
                        mpaItems: [],
                        decadeItems: [],
                        genreItems: [],
                        mpaMethodItems: [],
                        decadeMethodItems: [],
                        genreMethodItems: [],
                    };
                    renderDashboardGeneralSharePie();
                }
            } catch (err) {
                showToast(`Dashboard (General) failed: ${String(err?.message || err)}`, { level: 'warn' });
                emitLog('error', 'Dashboard general load failed', err);
                try {
                    const details = {
                        message: err?.message,
                        code: err?.code,
                        details: err?.details,
                        hint: err?.hint,
                    };
                    addMessageToLog('error', 'Dashboard (General) error details', JSON.stringify(details));
                } catch (_) {}
                setAll('—');
            }
        }

