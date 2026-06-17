        function initDashboardGeneralKpiClicks() {
            const pane = document.getElementById('dash-pane-general');
            if (!pane) return;
            if (pane.dataset.boundKpiClicks) return;
            pane.dataset.boundKpiClicks = 'true';

            pane.addEventListener('click', (e) => {
                const watchEl = e?.target?.closest ? e.target.closest('[data-watch-method]') : null;
                const watchMethod = String(watchEl?.dataset?.watchMethod || '').trim();
                if (watchMethod) {
                    applyLibraryFiltersFromDashboard({ watchMethod });
                    return;
                }

                const el = e?.target?.closest ? e.target.closest('[data-general-kpi]') : null;
                const rawKey = String(el?.dataset?.generalKpi ?? '').trim();
                if (!rawKey) return;

                const useUnique = String(dashboardGeneralMode || '').trim().toLowerCase() === 'unique';
                const data = dashboardGeneralLastData || {};
                const tieSubtitle = useUnique ? 'Tied by unique movies' : 'Tied by watch events';
                const pluralizeLabel = (n, one, many) => {
                    const num = Number(n);
                    if (!Number.isFinite(num)) return '';
                    return `${num} ${num === 1 ? one : many}`;
                };

                const openTiesModal = (title, items, type) => {
                    const overlay = document.getElementById('dash-kpi-ties-overlay');
                    const titleEl = document.getElementById('dash-kpi-ties-title');
                    const subEl = document.getElementById('dash-kpi-ties-sub');
                    const bodyEl = document.getElementById('dash-kpi-ties-body');
                    if (!overlay || !titleEl || !bodyEl) return;

                    titleEl.textContent = title;
                    if (subEl) subEl.textContent = tieSubtitle;

                    const rows = Array.isArray(items) ? items : [];
                    if (!rows.length) {
                        bodyEl.innerHTML = `<div class="text-gray">No tied leaders found.</div>`;
                        overlay.style.display = 'flex';
                        return;
                    }

                    bodyEl.innerHTML = rows.map((item) => {
                        const label = String(item?.label || '').trim();
                        const meta = String(item?.meta || '').trim();
                        const value = String(item?.value || '').trim();
                        if (!label) return '';
                        return `
                            <button type="button" class="dash-kpi-tie-btn" data-kpi-type="${escapeHtml(type)}" data-kpi-value="${escapeHtml(value)}" data-kpi-label="${escapeHtml(label)}">
                                <div class="dash-kpi-tie-avatar" data-kpi-avatar="${escapeHtml(label)}">
                                    <span class="text-xs text-gray">—</span>
                                </div>
                                <div>
                                    <div class="dash-kpi-tie-title">${escapeHtml(label)}</div>
                                    ${meta ? `<div class="dash-kpi-tie-meta">${escapeHtml(meta)}</div>` : ''}
                                </div>
                            </button>
                        `;
                    }).join('');

                    overlay.style.display = 'flex';

                    if (type === 'director' || type === 'actor') {
                        const department = type === 'director' ? 'directing' : 'acting';
                        rows.forEach(async (item) => {
                            const name = String(item?.label || '').trim();
                            if (!name) return;
                            const avatarWrap = bodyEl.querySelector(`[data-kpi-avatar="${CSS.escape(name)}"]`);
                            if (!avatarWrap) return;
                            try {
                                const profilePath = await dashFetchPersonProfile({ name, department });
                                const url = dashBuildPersonUrl(profilePath);
                                if (!url) return;
                                avatarWrap.innerHTML = `<img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" loading="lazy">`;
                            } catch (_) {}
                        });
                    }
                };

                if (rawKey === 'most_watched_director') {
                    const tieRows = Array.isArray(useUnique ? data?.most_watched_directors_unique : data?.most_watched_directors)
                        ? (useUnique ? data.most_watched_directors_unique : data.most_watched_directors)
                        : [];
                    if (tieRows.length > 1) {
                        openTiesModal('Most Watched Director(s)', tieRows.map((row) => {
                            const name = String(row?.name || '').trim();
                            const movies = pluralizeLabel(row?.movies, 'movie', 'movies');
                            const watches = !useUnique ? pluralizeLabel(row?.watches, 'watch event', 'watch events') : '';
                            const meta = [movies, watches].filter(Boolean).join(' • ');
                            return { label: name, value: name, meta };
                        }).filter(Boolean), 'director');
                        return;
                    }
                    const name = String(useUnique ? data?.most_watched_director_unique?.name : data?.most_watched_director?.name || '').trim();
                    if (!name) {
                        showToast('No director data yet.', { level: 'warn' });
                        return;
                    }
                    applyLibraryFiltersFromDashboard({ director: name });
                    return;
                }

                if (rawKey === 'most_watched_actor') {
                    const tieRows = Array.isArray(useUnique ? data?.most_watched_actors_unique : data?.most_watched_actors)
                        ? (useUnique ? data.most_watched_actors_unique : data.most_watched_actors)
                        : [];
                    if (tieRows.length > 1) {
                        openTiesModal('Most Watched Actor(s)', tieRows.map((row) => {
                            const name = String(row?.name || '').trim();
                            const movies = pluralizeLabel(row?.movies, 'movie', 'movies');
                            const watches = !useUnique ? pluralizeLabel(row?.watches, 'watch event', 'watch events') : '';
                            const meta = [movies, watches].filter(Boolean).join(' • ');
                            return { label: name, value: name, meta };
                        }).filter(Boolean), 'actor');
                        return;
                    }
                    const name = String(useUnique ? data?.most_watched_actor_unique?.name : data?.most_watched_actor?.name || '').trim();
                    if (!name) {
                        showToast('No actor data yet.', { level: 'warn' });
                        return;
                    }
                    applyLibraryFiltersFromDashboard({ actor: name });
                    return;
                }

                if (rawKey === 'most_watched_movie') {
                    applyLibraryFiltersFromDashboard({ watchCountMaxOnly: true, sortKey: 'watch_count', sortDir: 'desc' });
                }
            });
        }

        function closeDashKpiTies() {
            const overlay = document.getElementById('dash-kpi-ties-overlay');
            if (!overlay) return;
            overlay.style.display = 'none';
            const bodyEl = document.getElementById('dash-kpi-ties-body');
            if (bodyEl) bodyEl.innerHTML = 'Loading…';
        }

        function initDashKpiTiesModal() {
            const overlay = document.getElementById('dash-kpi-ties-overlay');
            if (!overlay) return;
            if (overlay.dataset.boundClicks) return;
            overlay.dataset.boundClicks = 'true';

            overlay.addEventListener('click', (e) => {
                const btn = e?.target?.closest ? e.target.closest('[data-kpi-type]') : null;
                if (!btn) return;
                const type = String(btn.dataset.kpiType || '').trim();
                const value = String(btn.dataset.kpiValue || '').trim();
                const label = String(btn.dataset.kpiLabel || '').trim();
                if (!type || !value) return;

                if (type === 'director') {
                    closeDashKpiTies();
                    applyLibraryFiltersFromDashboard({ director: label || value });
                    return;
                }
                if (type === 'actor') {
                    closeDashKpiTies();
                    applyLibraryFiltersFromDashboard({ actor: label || value });
                    return;
                }
            });
        }

        function openDashGenreOther() {
            const overlay = document.getElementById('dash-genre-other-overlay');
            const subEl = document.getElementById('dash-genre-other-sub');
            const bodyEl = document.getElementById('dash-genre-other-body');
            if (!overlay || !bodyEl) return;

            const rows = Array.isArray(dashboardGeneralGenreOtherItems) ? dashboardGeneralGenreOtherItems : [];
            if (!rows.length) {
                showToast('No other genres to show.', { level: 'warn' });
                return;
            }

            const total = Number(dashboardGeneralGenreOtherTotal) || rows.reduce((sum, r) => sum + (Number(r?.value) || 0), 0);
            const modeLabel = String(dashboardGeneralMode || '').trim().toLowerCase() === 'unique'
                ? 'unique movies'
                : 'watch events';
            if (subEl) subEl.textContent = `Tap a genre to filter My Movies (${modeLabel}).`;

            bodyEl.innerHTML = rows
                .slice()
                .sort((a, b) => (Number(b?.value) || 0) - (Number(a?.value) || 0))
                .map((item) => {
                    const label = String(item?.label || '').trim();
                    const value = Number(item?.value) || 0;
                    if (!label) return '';
                    const pct = total > 0 ? ((value / total) * 100) : 0;
                    const pctText = pct.toFixed(1);
                    return `
                        <button type="button" class="dash-other-genre-btn" data-genre-label="${escapeHtml(label)}">
                            <div class="dash-other-genre-title">${escapeHtml(label)}</div>
                            <div class="dash-other-genre-meta tabular-nums">${escapeHtml(pctText)}% (${escapeHtml(String(value))})</div>
                        </button>
                    `;
                }).join('');

            overlay.style.display = 'flex';
        }

        function closeDashGenreOther() {
            const overlay = document.getElementById('dash-genre-other-overlay');
            if (!overlay) return;
            overlay.style.display = 'none';
            const bodyEl = document.getElementById('dash-genre-other-body');
            if (bodyEl) bodyEl.innerHTML = 'Loading…';
        }

        function initDashGenreOtherModal() {
            const overlay = document.getElementById('dash-genre-other-overlay');
            if (!overlay) return;
            if (overlay.dataset.boundClicks) return;
            overlay.dataset.boundClicks = 'true';

            overlay.addEventListener('click', (e) => {
                const btn = e?.target?.closest ? e.target.closest('[data-genre-label]') : null;
                if (!btn) return;
                const label = String(btn.dataset.genreLabel || '').trim();
                if (!label) return;
                closeDashGenreOther();
                applyLibraryFiltersFromDashboard({ genre: dashGenreFilterValue(label) });
            });
        }


        function initDashboardRatingsKpiClicks() {
            const pane = document.getElementById('dash-pane-ratings');
            if (!pane) return;
            if (pane.dataset.boundKpiClicks) return;
            pane.dataset.boundKpiClicks = 'true';

            pane.addEventListener('click', (e) => {
                const barEl = e?.target?.closest ? e.target.closest('[data-rating-bar="true"]') : null;
                if (barEl) {
                    const rawType = String(barEl.dataset.barType || '').trim().toLowerCase();
                    const rawLabel = String(barEl.dataset.barLabel || '').trim();
                    if (!rawLabel) return;
                    if (rawType === 'genre') {
                        applyLibraryFiltersFromDashboard({ genre: rawLabel });
                        return;
                    }
                    if (rawType === 'decade') {
                        applyLibraryFiltersFromDashboard({ decade: normalizeLibraryDecadeLabel(rawLabel) });
                        return;
                    }
                    if (rawType === 'mpa') {
                        applyLibraryFiltersFromDashboard({ mpa: rawLabel });
                        return;
                    }
                }

                const el = e?.target?.closest ? e.target.closest('[data-ratings-kpi]') : null;
                const key = String(el?.dataset?.ratingsKpi ?? '').trim();
                if (!key) return;

                const data = dashboardRatingsLastData || {};
                if (key === 'ratings_highest_director') {
                    const name = String(data?.highest_rated_director?.name ?? '').trim();
                    if (!name) {
                        showToast('No director data yet.', { level: 'warn' });
                        return;
                    }
                    applyLibraryFiltersFromDashboard({ director: name });
                    return;
                }
                if (key === 'ratings_lowest_director') {
                    const name = String(data?.lowest_rated_director?.name ?? '').trim();
                    if (!name) {
                        showToast('No director data yet.', { level: 'warn' });
                        return;
                    }
                    applyLibraryFiltersFromDashboard({ director: name });
                    return;
                }
            });
        }

        function initDashboardPosterUpdateRatingsClicks() {
            // Global delegation so it works for Favorites + KPI detail pages.
            // Bound once per session.
            if (document.documentElement.dataset.boundDashPosterClicks === 'true') return;
            document.documentElement.dataset.boundDashPosterClicks = 'true';

            const shouldHandleNow = () => {
                const p = String(router?.currentPage || '').trim().toLowerCase();
                return p === 'dashboard' || p === 'dashboard_kpi' || p === 'dashboard_pie_filter';
            };

            document.addEventListener('click', async (e) => {
                if (!shouldHandleNow()) return;
                const target = e?.target?.closest ? e.target.closest('[data-dash-movie-id]') : null;
                if (!target) return;

                const movieIdRaw = String(target.dataset.dashMovieId || '').trim();
                const tmdbIdRaw = String(target.dataset.dashTmdbId || '').trim();
                const titleRaw = String(target.dataset.dashMovieTitle || '').trim();
                const posterRaw = String(target.dataset.dashPosterPath || '').trim();
                const quoteRaw = String(target.dataset.dashMovieQuote || '').trim();

                if (!movieIdRaw && !tmdbIdRaw) return;

                e.preventDefault?.();
                e.stopPropagation?.();

                // Open the SAME diary-entry popup as My Movies (review + Edit/Delete/
                // Recommend), instead of jumping straight into the Update Ratings form.
                // Resolve the DB movie id (most dash items have it; fall back via TMDb).
                let mid = movieIdRaw;
                if (!mid && tmdbIdRaw) {
                    try { const r = await getDbMovieIdByTmdbId(Number(tmdbIdRaw)); if (r) mid = String(r); } catch (_) {}
                }
                if (!mid) return;

                // Ensure the modal's Edit/Delete/Recommend delegated handlers are bound
                // even if the user never visited My Movies this session (idempotent).
                try { initLibraryPage(); } catch (_) {}
                try { await openLibraryMovieModal(mid); } catch (_) {}
            }, { capture: true });

            // Cosmetic: move the Quote Wall glow with the mouse.
            document.addEventListener('mousemove', (e) => {
                if (!shouldHandleNow()) return;
                const card = e?.target?.closest ? e.target.closest('.dash-quote-card') : null;
                if (!card) return;
                const rect = card.getBoundingClientRect();
                const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / Math.max(1, rect.width)) * 100));
                const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / Math.max(1, rect.height)) * 100));
                card.style.setProperty('--mx', `${x}%`);
                card.style.setProperty('--my', `${y}%`);
                card.style.setProperty('--mx2', `${100 - x}%`);
                card.style.setProperty('--my2', `${100 - y}%`);
            }, { passive: true });
        }

        function initDashboardFavoritesMetric() {
            const wrap = document.getElementById('dash-fav-metric-wrap');
            if (!wrap) return;
            if (wrap.dataset.boundClicks) return;
            wrap.dataset.boundClicks = 'true';

            wrap.addEventListener('click', (e) => {
                const btn = e?.target?.closest ? e.target.closest('button[data-metric]') : null;
                const metric = btn?.dataset?.metric;
                if (!metric) return;
                setDashboardFavoritesMetric(metric);
            });
        }

        function initDashboardFavoritesLimitToggle() {
            const btnTop = document.getElementById('dash-fav-limit-toggle-top');
            const btnBottom = document.getElementById('dash-fav-limit-toggle-bottom');
            const bind = (btn) => {
                if (!btn) return;
                if (btn.dataset.boundClicks) return;
                btn.dataset.boundClicks = 'true';
                btn.addEventListener('click', () => {
                    const next = Number(dashboardFavoritesLimit) === 10 ? 5 : 10;
                    setDashboardFavoritesLimit(next);
                });
            };
            bind(btnTop);
            bind(btnBottom);
        }

        function initDashboardGeneralModeControls() {
            const wrap = document.getElementById('dash-general-mode-wrap');
            if (!wrap) return;
            if (wrap.dataset.boundClicks) return;
            wrap.dataset.boundClicks = 'true';

            wrap.addEventListener('click', (e) => {
                const btn = e?.target?.closest ? e.target.closest('button[data-mode]') : null;
                const mode = btn?.dataset?.mode;
                if (!mode) return;
                setDashboardGeneralMode(mode);
            });
        }

        function initDashboardGeneralPieControls() {
            const wrap = document.getElementById('dash-general-pie-toggle');
            if (!wrap) return;
            if (wrap.dataset.boundClicks) return;
            wrap.dataset.boundClicks = 'true';

            wrap.addEventListener('click', (e) => {
                const btn = e?.target?.closest ? e.target.closest('button[data-pie]') : null;
                const pie = btn?.dataset?.pie;
                if (!pie) return;
                setDashboardGeneralPieMode(pie);
            });
        }

        function normalizeLibraryDecadeLabel(raw) {
            const s = String(raw || '').trim();
            if (!s) return '';
            const m = s.match(/\d{4}/);
            return m ? m[0] : '';
        }

        function applyLibraryFiltersFromDashboard({ genre, decade, mpa, director, actor, movieId, movieTitle, watchMethod, watchCountMaxOnly = false, sortKey, sortDir } = {}) {
            const def = getDefaultLibrarySortFilterState();
            const timeframe = mapDashboardTimeframeToLibrary(dashboardTimeframe || 'all_time');
            librarySortFilterState = {
                ...def,
                sortKey: sortKey || (watchCountMaxOnly ? 'watch_count' : def.sortKey),
                sortDir: sortDir || (watchCountMaxOnly ? 'desc' : def.sortDir),
                timeframe,
                genre: String(genre || '').trim(),
                decade: String(decade || '').trim(),
                mpa: String(mpa || '').trim(),
                directorContains: String(director || '').trim(),
                actorContains: String(actor || '').trim(),
                movieId: String(movieId || '').trim(),
                movieTitle: String(movieTitle || '').trim(),
                watchMethod: String(watchMethod || '').trim(),
                watchCountMin: '',
                watchCountMax: '',
            };
            librarySortFilterDraft = null;
            libraryPendingWatchCountMaxOnly = Boolean(watchCountMaxOnly);
            router.navigate('library');
        }

        function initDashboardGeneralPieLegendClicks() {
            const legend = document.getElementById('dash-general-share-legend');
            if (!legend) return;
            if (legend.dataset.boundLegendClicks) return;
            legend.dataset.boundLegendClicks = 'true';

            const activate = (item) => {
                let label = '';
                const encoded = String(item?.dataset?.dashPieValue || '').trim();
                if (encoded) {
                    try {
                        label = decodeURIComponent(encoded);
                    } catch (_) {
                        label = encoded;
                    }
                }
                if (!label) label = String(item?.dataset?.dashPieLabel || '').trim();
                const type = String(legend.dataset.pieType || '').trim().toLowerCase();
                const isOther = String(item?.dataset?.dashPieOther || '') === 'true' || String(label || '').trim().toLowerCase() === 'other';
                dashNavigateToPieSegment(type, label, isOther);
            };

            legend.addEventListener('click', (e) => {
                const item = e?.target?.closest ? e.target.closest('.dash-pie-legend-item') : null;
                if (!item) return;
                activate(item);
            });

            legend.addEventListener('keydown', (e) => {
                const key = String(e?.key || '').toLowerCase();
                if (key !== 'enter' && key !== ' ') return;
                const item = e?.target?.closest ? e.target.closest('.dash-pie-legend-item') : null;
                if (!item) return;
                e.preventDefault?.();
                activate(item);
            });
        }

        function initDashboardGeneralPieHover() {
            const pie = document.getElementById('dash-general-share-pie');
            const legend = document.getElementById('dash-general-share-legend');
            if (!pie || !legend) return;
            if (pie.dataset.boundPieHover) return;
            pie.dataset.boundPieHover = 'true';

            legend.addEventListener('mouseover', (e) => {
                const item = e?.target?.closest ? e.target.closest('.dash-pie-legend-item') : null;
                if (!item) return;
                const idx = Number(item.dataset.dashPieIndex);
                if (!Number.isFinite(idx)) return;
                dashSetPieHighlight(pie, legend, idx);
                const label = String(item.dataset.dashPieLabel || '').trim();
                const type = String(legend.dataset.pieType || '').trim().toLowerCase();
                const breakdown = dashGetWatchMethodForPieLabel(type, label);
                if (breakdown) dashSetWatchMethodDisplay(breakdown.atHome, breakdown.inTheater);
            });

            legend.addEventListener('mouseleave', () => {
                dashSetPieHighlight(pie, legend, -1);
                dashResetWatchMethodDisplay();
            });

            pie.addEventListener('mousemove', (e) => {
                const angle = dashAngleFromEvent(pie, e);
                if (angle === null) {
                    dashSetPieHighlight(pie, legend, -1);
                    dashResetWatchMethodDisplay();
                    return;
                }
                const idx = dashFindPieIndex(pie, angle);
                if (!Number.isFinite(idx) || idx < 0) return;
                dashSetPieHighlight(pie, legend, idx);
                const label = String(pie?._pieItems?.[idx]?.label || '').trim();
                const type = String(legend.dataset.pieType || '').trim().toLowerCase();
                const breakdown = dashGetWatchMethodForPieLabel(type, label);
                if (breakdown) dashSetWatchMethodDisplay(breakdown.atHome, breakdown.inTheater);
            });

            pie.addEventListener('mouseleave', () => {
                dashSetPieHighlight(pie, legend, -1);
                dashResetWatchMethodDisplay();
            });
        }

        // Shared drill-in: from a pie segment (legend row OR a tapped slice / the
        // tapped-segment detail readout) jump to My Movies filtered by that slice.
        function dashNavigateToPieSegment(type, label, isOther) {
            const t = String(type || '').trim().toLowerCase();
            const l = String(label || '').trim();
            if (!l || !t) return;
            if (t === 'genre') {
                if (isOther || l.toLowerCase() === 'other') { openDashGenreOther(); return; }
                applyLibraryFiltersFromDashboard({ genre: dashGenreFilterValue(l) });
                return;
            }
            if (t === 'mpa') { applyLibraryFiltersFromDashboard({ mpa: l }); return; }
            if (t === 'decade') { applyLibraryFiltersFromDashboard({ decade: normalizeLibraryDecadeLabel(l) }); return; }
        }

        // Mobile: swap the share-wheel card between the WHEEL and the LEGEND/LIST so
        // they don't both crowd the card at once (desktop still shows both).
        function initDashboardGeneralPieViewToggle() {
            const btn = document.getElementById('dash-pie-view-toggle');
            const card = document.querySelector('.dash-general-pie-card');
            if (!btn || !card) return;
            if (btn.dataset.boundClicks) return;
            btn.dataset.boundClicks = 'true';
            const sync = () => {
                const isList = card.getAttribute('data-pie-view') === 'list';
                btn.textContent = isList ? 'Show chart' : 'Show list';
            };
            btn.addEventListener('click', () => {
                const isList = card.getAttribute('data-pie-view') === 'list';
                card.setAttribute('data-pie-view', isList ? 'chart' : 'list');
                sync();
            });
            sync();
        }

        // Mobile: tapping a pie slice highlights it + reveals that slice's data in
        // the detail readout (label / share% / count); tapping the readout drills
        // into My Movies filtered by the slice.
        function initDashboardGeneralPieTap() {
            const pie = document.getElementById('dash-general-share-pie');
            const legend = document.getElementById('dash-general-share-legend');
            const detail = document.getElementById('dash-pie-segment-detail');
            if (!pie || !legend) return;
            if (pie.dataset.boundPieTap) return;
            pie.dataset.boundPieTap = 'true';

            pie.addEventListener('click', (e) => {
                const angle = dashAngleFromEvent(pie, e);
                if (angle === null) return;
                const idx = dashFindPieIndex(pie, angle);
                if (!Number.isFinite(idx) || idx < 0) return;
                const item = pie?._pieItems?.[idx];
                if (!item) return;
                dashSetPieHighlight(pie, legend, idx);
                if (!detail) return;
                const label = String(item.label || '').trim();
                const type = String(legend.dataset.pieType || '').trim().toLowerCase();
                const total = Number(pie._pieTotal) || 0;
                const val = Number(item.value) || 0;
                const pct = total > 0 ? (val / total * 100) : 0;
                const isOther = String(label || '').trim().toLowerCase() === 'other';
                detail.dataset.segType = type;
                detail.dataset.segLabel = label;
                detail.dataset.segOther = isOther ? 'true' : 'false';
                detail.innerHTML = `
                    <span class="dash-pie-seg-name"><span class="dash-legend-dot" style="background:${(pie._pieColors && pie._pieColors[idx]) || 'var(--brand)'}"></span>${escapeHtml(label)}</span>
                    <span class="dash-pie-seg-stat tabular-nums">${pct.toFixed(1)}% · ${escapeHtml(String(val))}</span>
                    <span class="dash-pie-seg-go">View movies ›</span>`;
                detail.classList.add('is-shown');
            });

            if (detail && !detail.dataset.boundClicks) {
                detail.dataset.boundClicks = 'true';
                detail.addEventListener('click', () => {
                    dashNavigateToPieSegment(detail.dataset.segType, detail.dataset.segLabel, detail.dataset.segOther === 'true');
                });
            }
        }

        function initDashboardRatingsChartControls() {
            const wrap = document.getElementById('dash-ratings-chart-tab-wrap');
            if (!wrap) return;
            if (wrap.dataset.boundClicks) return;
            wrap.dataset.boundClicks = 'true';

            wrap.addEventListener('click', (e) => {
                const btn = e?.target?.closest ? e.target.closest('button[data-chart]') : null;
                const chart = btn?.dataset?.chart;
                if (!chart) return;
                setDashboardRatingsChartTab(chart);
            });
        }

        function syncDashboardFavoritesMetricUI() {
            const m = String(dashboardFavoritesMetric || '').trim().toLowerCase();
            const allowed = new Set(['overall', 'sound', 'plot', 'pace', 'acting', 'imagery', 'dialogue']);
            dashboardFavoritesMetric = allowed.has(m) ? m : 'overall';

            const wrap = document.getElementById('dash-fav-metric-wrap');
            if (!wrap) return;
            wrap.querySelectorAll('button[data-metric]').forEach((btn) => {
                const isOn = String(btn.dataset.metric || '').trim().toLowerCase() === dashboardFavoritesMetric;
                btn.classList.remove('btn-glass', 'btn-outline');
                btn.classList.add(isOn ? 'btn-glass' : 'btn-outline');
            });
        }

        function syncDashboardFavoritesLimitUI() {
            const limit = Number(dashboardFavoritesLimit) === 10 ? 10 : 5;
            dashboardFavoritesLimit = limit;

            const btnTop = document.getElementById('dash-fav-limit-toggle-top');
            const btnBottom = document.getElementById('dash-fav-limit-toggle-bottom');
            const update = (btn) => {
                if (!btn) return;
                btn.textContent = limit === 10 ? 'Show 5' : 'Show 10';
                btn.classList.remove('btn-glass', 'btn-outline');
                btn.classList.add(limit === 10 ? 'btn-glass' : 'btn-outline');
                btn.setAttribute('aria-pressed', limit === 10 ? 'true' : 'false');
            };
            update(btnTop);
            update(btnBottom);

            const topLabel = document.getElementById('dash-fav-top-label');
            if (topLabel) topLabel.textContent = `Top ${limit}`;
            const bottomLabel = document.getElementById('dash-fav-bottom-label');
            if (bottomLabel) bottomLabel.textContent = `Bottom ${limit}`;
        }

        function syncDashboardGeneralModeUI() {
            const m = String(dashboardGeneralMode || '').trim().toLowerCase();
            const allowed = new Set(['total', 'unique']);
            dashboardGeneralMode = allowed.has(m) ? m : 'total';

            const wrap = document.getElementById('dash-general-mode-wrap');
            if (wrap) {
                wrap.querySelectorAll('button[data-mode]').forEach((btn) => {
                    const isOn = String(btn.dataset.mode || '').trim().toLowerCase() === dashboardGeneralMode;
                    btn.classList.remove('btn-glass', 'btn-outline');
                    btn.classList.add(isOn ? 'btn-glass' : 'btn-outline');
                });
            }

            const pane = document.getElementById('dash-pane-general');
            if (pane) {
                pane.classList.remove('dash-mode-total', 'dash-mode-unique');
                pane.classList.add(dashboardGeneralMode === 'unique' ? 'dash-mode-unique' : 'dash-mode-total');
            }

            const watchLabel = document.getElementById('dash-general-watch-label');
            const hoursLabel = document.getElementById('dash-general-hours-label');
            if (watchLabel) watchLabel.textContent = dashboardGeneralMode === 'unique' ? 'Unique Movies' : 'Watches';
            if (hoursLabel) hoursLabel.textContent = dashboardGeneralMode === 'unique' ? 'Unique Hours' : 'Hours';

            const atHomeLabel = document.getElementById('dash-general-at-home-label');
            if (atHomeLabel) atHomeLabel.textContent = dashboardGeneralMode === 'unique' ? 'Unique movies' : 'Watch events';
            const inTheaterLabel = document.getElementById('dash-general-in-theater-label');
            if (inTheaterLabel) inTheaterLabel.textContent = dashboardGeneralMode === 'unique' ? 'Unique movies' : 'Watch events';
        }

        function syncDashboardGeneralPieUI() {
            const mode = String(dashboardGeneralPieMode || '').trim().toLowerCase();
            dashboardGeneralPieMode = (mode === 'decade' || mode === 'genre') ? mode : 'mpa';

            const wrap = document.getElementById('dash-general-pie-toggle');
            if (wrap) {
                wrap.querySelectorAll('button[data-pie]').forEach((btn) => {
                    const isOn = String(btn.dataset.pie || '').trim().toLowerCase() === dashboardGeneralPieMode;
                    btn.classList.remove('btn-glass', 'btn-outline');
                    btn.classList.add(isOn ? 'btn-glass' : 'btn-outline');
                });
            }

            const title = document.getElementById('dash-general-pie-title');
            if (title) {
                title.textContent = dashboardGeneralPieMode === 'decade'
                    ? 'Decade Share'
                    : (dashboardGeneralPieMode === 'genre' ? 'Genre Share' : 'MPA Share');
            }

            renderDashboardGeneralSharePie();
        }

        function syncDashboardTimeframeUI() {
            const btnAll = document.getElementById('dash-range-all-time');
            const btnYear = document.getElementById('dash-range-this-year');
            const btnMonth = document.getElementById('dash-range-this-month');
            const activate = (btn, on) => {
                if (!btn) return;
                btn.classList.remove('btn-glass', 'btn-outline');
                btn.classList.add(on ? 'btn-glass' : 'btn-outline');
            };

            const hideMonth = dashboardActiveTab === 'charts';
            if (btnMonth) {
                if (hideMonth) btnMonth.classList.add('hidden');
                else btnMonth.classList.remove('hidden');
            }
            if (hideMonth && dashboardTimeframe === 'this_month') {
                dashboardTimeframe = 'this_year';
            }

            activate(btnAll, dashboardTimeframe === 'all_time');
            activate(btnYear, dashboardTimeframe === 'this_year');
            activate(btnMonth, dashboardTimeframe === 'this_month');
        }

        function syncDashboardRatingsChartUI() {
            const t = String(dashboardRatingsChartTab || '').trim().toLowerCase();
            const allowed = new Set(['genre', 'decade', 'mpa']);
            dashboardRatingsChartTab = allowed.has(t) ? t : 'genre';

            const wrap = document.getElementById('dash-ratings-chart-tab-wrap');
            if (wrap) {
                wrap.querySelectorAll('button[data-chart]').forEach((btn) => {
                    const isOn = String(btn.dataset.chart || '').trim().toLowerCase() === dashboardRatingsChartTab;
                    btn.classList.remove('btn-glass', 'btn-outline');
                    btn.classList.add(isOn ? 'btn-glass' : 'btn-outline');
                });
            }

            const title = document.getElementById('dash-ratings-chart-title');
            if (title) title.textContent = dashRatingsChartTitleForTab(dashboardRatingsChartTab);
        }

        function setDashboardFavoritesMetric(metric) {
            const m = String(metric || '').trim().toLowerCase();
            const allowed = new Set(['overall', 'sound', 'plot', 'pace', 'acting', 'imagery', 'dialogue']);
            dashboardFavoritesMetric = allowed.has(m) ? m : 'overall';

            // The Favorites poster meta line shows the selected metric. Clear cached rating rows so we
            // always have the needed columns for the currently selected metric.
            try {
                dashRatingCacheByMovieId.clear();
            } catch (_) {}

            const wrap = document.getElementById('dash-fav-metric-wrap');
            if (wrap) {
                wrap.querySelectorAll('button[data-metric]').forEach((btn) => {
                    const isOn = String(btn.dataset.metric || '').trim().toLowerCase() === dashboardFavoritesMetric;
                    btn.classList.remove('btn-glass', 'btn-outline');
                    btn.classList.add(isOn ? 'btn-glass' : 'btn-outline');
                });
            }

            if (dashboardActiveTab === 'favorites') {
                setDashboardTab('favorites');
            }
        }

        function setDashboardFavoritesLimit(limit) {
            const n = Number(limit);
            dashboardFavoritesLimit = n === 10 ? 10 : 5;
            syncDashboardFavoritesLimitUI();

            if (dashboardActiveTab === 'favorites') {
                loadDashboardFavorites();
            }
        }

        function setDashboardGeneralMode(mode) {
            const m = String(mode || '').trim().toLowerCase();
            const allowed = new Set(['total', 'unique']);
            dashboardGeneralMode = allowed.has(m) ? m : 'total';
            syncDashboardGeneralModeUI();

            if (dashboardActiveTab === 'general') {
                loadDashboardGeneral();
            }
        }

        function setDashboardGeneralPieMode(mode) {
            const m = String(mode || '').trim().toLowerCase();
            dashboardGeneralPieMode = (m === 'decade' || m === 'genre') ? m : 'mpa';
            syncDashboardGeneralPieUI();
        }

        function setDashboardRatingsChartTab(chart) {
            const t = String(chart || '').trim().toLowerCase();
            const allowed = new Set(['genre', 'decade', 'mpa']);
            dashboardRatingsChartTab = allowed.has(t) ? t : 'genre';
            syncDashboardRatingsChartUI();

            if (dashboardActiveTab === 'ratings') {
                if (dashboardRatingsChartsLastData) {
                    renderDashboardRatingsChartsFromData(dashboardRatingsChartsLastData);
                } else {
                    loadDashboardRatings();
                }
            }
        }

        function initDashboardTimeframe() {
            const wrap = document.getElementById('dash-range-all-time')?.parentElement;
            if (!wrap) return;
            if (wrap.dataset.boundClicks) return;
            wrap.dataset.boundClicks = 'true';

            wrap.addEventListener('click', (e) => {
                const btn = e?.target?.closest ? e.target.closest('button[data-range]') : null;
                const range = btn?.dataset?.range;
                if (!range) return;
                setDashboardTimeframe(range);
            });
        }

        function setDashboardTimeframe(range) {
            const r = String(range || '').trim().toLowerCase();
            const allowed = new Set(['all_time', 'this_year', 'this_month']);
            dashboardTimeframe = allowed.has(r) ? r : 'all_time';
            syncDashboardTimeframeUI();

            // Reload the active tab under the new timeframe.
            setDashboardTab(dashboardActiveTab);
        }

        async function setDashboardTab(tab) {
            if (!cachedIsAuthed) {
                openDashboardAuthWarning();
                return;
            }
            const t = String(tab || '').trim().toLowerCase();
            dashboardActiveTab = t || 'general';
            const tabGeneral = document.getElementById('dash-tab-general');
            const tabRatings = document.getElementById('dash-tab-ratings');
            const tabTiers = document.getElementById('dash-tab-tiers');
            const tabFavorites = document.getElementById('dash-tab-favorites');
            const tabCharts = document.getElementById('dash-tab-charts');
            const tabQuotes = document.getElementById('dash-tab-quotes');
            const paneGeneral = document.getElementById('dash-pane-general');
            const paneRatings = document.getElementById('dash-pane-ratings');
            const paneTiers = document.getElementById('dash-pane-tiers');
            const paneFavorites = document.getElementById('dash-pane-favorites');
            const paneCharts = document.getElementById('dash-pane-charts');
            const paneQuotes = document.getElementById('dash-pane-quotes');
            const favMetricPanel = document.getElementById('dash-fav-metric-panel');
            const generalModePanel = document.getElementById('dash-general-mode-panel');
            if (!tabGeneral || !tabRatings || !tabTiers || !tabFavorites || !tabCharts || !tabQuotes || !paneGeneral || !paneRatings || !paneTiers || !paneFavorites || !paneCharts || !paneQuotes) return;

            const activate = (btn, on) => {
                if (!btn) return;
                btn.classList.remove('btn-glass', 'btn-outline');
                btn.classList.add(on ? 'btn-glass' : 'btn-outline');
            };

            const show = (pane, on) => {
                if (!pane) return;
                if (on) pane.classList.remove('hidden');
                else pane.classList.add('hidden');
            };

            activate(tabGeneral, t === 'general');
            activate(tabRatings, t === 'ratings');
            activate(tabTiers, t === 'tiers');
            activate(tabFavorites, t === 'favorites');
            activate(tabCharts, t === 'charts');
            activate(tabQuotes, t === 'quotes');

            show(paneGeneral, t === 'general');
            show(paneRatings, t === 'ratings');
            show(paneTiers, t === 'tiers');
            show(paneFavorites, t === 'favorites');
            show(paneCharts, t === 'charts');
            show(paneQuotes, t === 'quotes');

            // Favorites-only header controls
            if (favMetricPanel) {
                if (t === 'favorites') favMetricPanel.classList.remove('hidden');
                else favMetricPanel.classList.add('hidden');
            }
            if (generalModePanel) {
                if (t === 'general') generalModePanel.classList.remove('hidden');
                else generalModePanel.classList.add('hidden');
            }

            syncDashboardTimeframeUI();
            // Keep the active pill centered in the mobile sticky tab indicator.
            try { if (typeof dashCenterActivePill === 'function') dashCenterActivePill(); } catch (_) {}
            if (t === 'general') {
                syncDashboardGeneralModeUI();
                syncDashboardGeneralPieUI();
            }

            if (t === 'general') {
                await loadDashboardGeneral();
            } else if (t === 'ratings') {
                await loadDashboardRatings();
            } else if (t === 'tiers') {
                await loadDashboardTiers();
            } else if (t === 'favorites') {
                await loadDashboardFavorites();
            } else if (t === 'charts') {
                await loadDashboardCharts();
            } else if (t === 'quotes') {
                await loadDashboardQuoteWall();
            }
        }

        async function loadDashboardFavorites() {
            const elTop = document.getElementById('dash-fav-top');
            const elBottom = document.getElementById('dash-fav-bottom');
            if (!elTop || !elBottom) return;

            let authedUser = null;
            if (guestMode) {
                authedUser = cachedAuthUser;
            } else {
                try {
                    const { data } = await supabaseClient?.auth?.getUser?.();
                    authedUser = data?.user || null;
                } catch (_) {
                    authedUser = null;
                }
            }

            if (!supabaseClient || !authedUser?.id) {
                if (!dashboardAuthWarned) {
                    dashboardAuthWarned = true;
                    showToast('Log in to view your dashboard stats.', { level: 'warn' });
                }
                elTop.innerHTML = `<div class="text-gray">Log in to view favorites.</div>`;
                elBottom.innerHTML = `<div class="text-gray">Log in to view favorites.</div>`;
                return;
            }

            elTop.innerHTML = `<div class="text-gray">Loading…</div>`;
            elBottom.innerHTML = `<div class="text-gray">Loading…</div>`;

            const metricFieldForFavorites = (metric) => {
                const m = String(metric || '').trim().toLowerCase();
                if (m === 'sound') return { field: 'sound_rating', label: 'Sound' };
                if (m === 'plot') return { field: 'plot_rating', label: 'Plot' };
                if (m === 'pace') return { field: 'pacing_rating', label: 'Pace' };
                if (m === 'acting') return { field: 'acting_rating', label: 'Acting' };
                if (m === 'imagery') return { field: 'imagery_rating', label: 'Imagery' };
                if (m === 'dialogue') return { field: 'dialogue_rating', label: 'Dialogue' };
                return { field: 'overall_rating', label: 'Overall' };
            };

            const ensureRatingsForItems = async (items) => {
                const safe = Array.isArray(items) ? items : [];
                const ids = Array.from(new Set(
                    safe
                        .map((r) => r?.movie_id)
                        .filter(Boolean)
                ));
                const missing = ids.filter((id) => !dashRatingCacheByMovieId.has(id));
                if (missing.length === 0) return;

                const { data, error } = await supabaseClient
                    .from('Movie Ratings')
                    .select('movie_id, overall_rating, sound_rating, plot_rating, pacing_rating, acting_rating, imagery_rating, dialogue_rating, tier')
                    .eq('user_id', authedUser.id)
                    .in('movie_id', missing);

                if (error) throw error;

                const rows = Array.isArray(data) ? data : [];
                const byId = new Map(rows.map((r) => [r.movie_id, r]));
                for (const id of missing) {
                    dashRatingCacheByMovieId.set(id, byId.get(id) || null);
                }
            };

            const renderRow = async (items) => {
                const limit = Number(dashboardFavoritesLimit) === 10 ? 10 : 5;
                const safe = Array.isArray(items) ? items.slice(0, limit) : [];
                if (safe.length === 0) {
                    return `<div class="text-gray">No rated movies found for this timeframe.</div>`;
                }

                // Posters are lazy-loaded from stored DB poster_path.
                await ensureRatingsForItems(safe);

                // Ensure we have poster_path from Movies even if the RPC doesn't return it.
                const ensuredPosterPaths = await Promise.all(safe.map((r) => dashEnsurePosterPath(r)));

                const cards = safe.map((r, idx) => {
                    const title = String(r?.title ?? '').trim() || 'Untitled';
                    const year = (r?.release_year === null || r?.release_year === undefined) ? '' : String(r.release_year);
                    const ratingRow = dashRatingCacheByMovieId.get(r?.movie_id) || null;

                    const dashMovieId = String(r?.movie_id ?? '').trim();
                    const dashTmdbId = (r?.tmdb_id === null || r?.tmdb_id === undefined) ? '' : String(r.tmdb_id);

                    const { field: metricField, label: metricLabel } = metricFieldForFavorites(dashboardFavoritesMetric);
                    const metricValue = ratingRow ? ratingRow?.[metricField] : null;
                    const metricText = dashFormatScore(metricValue);
                    const tierLabel = dashNormalizeTierLabel(ratingRow ? ratingRow.tier : '');
                    const tmdb_id = Number(r?.tmdb_id);
                    const ensured = ensuredPosterPaths[idx] || '';
                    const poster_path = dashNormalizePosterPath(ensured || String(r?.poster_path ?? '').trim() || (Number.isFinite(tmdb_id) ? (dashPosterCacheByTmdbId.get(tmdb_id) || '') : ''));
                    const posterUrl = dashBuildPosterUrl(poster_path, 'w342');

                    const metaHtml = dashJoinHelpParts([
                        year ? escapeHtml(year) : '',
                        metricText ? `${dashRenderHelpScore(metricText)} ${escapeHtml(metricLabel)}` : '',
                        tierLabel ? dashRenderHelpTier(tierLabel) : '',
                    ]);

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
                                style="position: relative; width: 100%; aspect-ratio: 2/3; border-radius: 14px; overflow: hidden; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.06); cursor: pointer;"
                            >
                                <div class="dash-fav-rank">${idx + 1}</div>
                                ${posterUrl
                                    ? `<img src="${posterUrl}" loading="lazy" decoding="async" alt="${escapeHtml(title)}" style="width: 100%; height: 100%; object-fit: cover; display:block;" onerror="this.closest('div')?.remove?.()">`
                                    : `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; color: var(--text-muted); font-size: 12px;">No poster</div>`
                                }
                            </div>
                            <div class="text-sm text-white" style="font-weight: 700; line-height: 1.2;">${escapeHtml(title)}</div>
                            <div class="text-xs text-gray tabular-nums">${metaHtml}</div>
                        </div>
                    `;
                }).join('');

                return `
                    <div class="dash-fav-grid">
                        ${cards}
                    </div>
                `;
            };

            try {
                let res = await supabaseClient.rpc('get_dashboard_favorites', {
                    p_timeframe: dashboardTimeframe,
                    p_metric: dashboardFavoritesMetric,
                    p_limit: dashboardFavoritesLimit,
                });
                if (res?.error) {
                    const msg = String(res.error?.message || res.error);
                    const missingRpc = /get_dashboard_favorites/i.test(msg) && /(does not exist|not found|no function matches|function .* does not exist)/i.test(msg);
                    if (missingRpc) {
                        elTop.innerHTML = `<div class="text-gray">Favorites RPC missing. Run dashboard_rpc.sql to add get_dashboard_favorites.</div>`;
                        elBottom.innerHTML = `<div class="text-gray">Favorites RPC missing. Run dashboard_rpc.sql to add get_dashboard_favorites.</div>`;
                        return;
                    }
                    const looksLikeOldSignature = /get_dashboard_favorites/i.test(msg) && /no function matches|function .* does not exist/i.test(msg);
                    if (looksLikeOldSignature) {
                        res = await supabaseClient.rpc('get_dashboard_favorites', {
                            p_timeframe: dashboardTimeframe,
                            p_metric: dashboardFavoritesMetric,
                        });
                    }
                }
                if (res?.error) throw res.error;

                const data = res?.data;
                const top = Array.isArray(data?.top) ? data.top : [];
                const bottom = Array.isArray(data?.bottom) ? data.bottom : [];

                elTop.innerHTML = await renderRow(top);
                elBottom.innerHTML = await renderRow(bottom);
            } catch (err) {
                showToast(`Dashboard (Favorites) failed: ${String(err?.message || err)}`, { level: 'warn' });
                emitLog('error', 'Dashboard favorites load failed', err);
                elTop.innerHTML = `<div class="text-gray">Unable to load favorites right now.</div>`;
                elBottom.innerHTML = `<div class="text-gray">Unable to load favorites right now.</div>`;
            }
        }

        function dashBuildActivitySeries(items, timeframe) {
            const rows = Array.isArray(items) ? items : [];
            if (!rows.length) return null;

            const countsByDate = new Map();
            rows.forEach((r) => {
                const raw = String(r?.bucket ?? r?.date ?? '').slice(0, 10);
                if (!raw) return;
                const parsed = new Date(`${raw}T00:00:00`);
                if (Number.isNaN(parsed.getTime())) return;
                const count = Number(r?.count ?? 0);
                const safeCount = Number.isFinite(count) ? Math.max(0, count) : 0;
                countsByDate.set(raw, safeCount);
            });
            if (countsByDate.size === 0) return null;

            const tf = String(timeframe || '').trim().toLowerCase();
            const now = new Date();
            const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

            if (tf === 'this_year') {
                const year = now.getFullYear();
                const values = Array.from({ length: 12 }, () => 0);
                countsByDate.forEach((count, raw) => {
                    const d = new Date(`${raw}T00:00:00`);
                    if (d.getFullYear() !== year) return;
                    values[d.getMonth()] += count;
                });
                return { labels: monthNames, values };
            }

            if (tf === 'this_month') {
                const year = now.getFullYear();
                const month = now.getMonth();
                const daysInMonth = new Date(year, month + 1, 0).getDate();
                const values = Array.from({ length: daysInMonth }, () => 0);
                countsByDate.forEach((count, raw) => {
                    const d = new Date(`${raw}T00:00:00`);
                    if (d.getFullYear() !== year || d.getMonth() !== month) return;
                    values[d.getDate() - 1] += count;
                });
                const labels = Array.from({ length: daysInMonth }, (_, i) => String(i + 1));
                return { labels, values };
            }

            const yearMap = new Map();
            countsByDate.forEach((count, raw) => {
                const d = new Date(`${raw}T00:00:00`);
                const year = d.getFullYear();
                yearMap.set(year, (yearMap.get(year) || 0) + count);
            });
            const years = Array.from(yearMap.keys()).sort((a, b) => a - b);
            if (!years.length) return null;
            const minYear = years[0];
            const maxYear = years[years.length - 1];
            const labels = [];
            const values = [];
            for (let y = minYear; y <= maxYear; y += 1) {
                labels.push(String(y));
                values.push(yearMap.get(y) || 0);
            }
            return { labels, values };
        }

        function dashFormatCompactNumber(value) {
            const num = Number(value);
            if (!Number.isFinite(num)) return '0';
            if (Math.abs(num) >= 1000000) return `${(num / 1000000).toFixed(num % 1000000 === 0 ? 0 : 1)}M`;
            if (Math.abs(num) >= 1000) return `${(num / 1000).toFixed(num % 1000 === 0 ? 0 : 1)}k`;
            return Number.isInteger(num) ? String(num) : num.toFixed(1);
        }

        function dashColorToRgba(color, alpha = 1) {
            const raw = String(color || '').trim();
            const a = Math.max(0, Math.min(1, Number(alpha) || 0));

            const hex = raw.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
            if (hex) {
                const value = hex[1];
                const full = value.length === 3
                    ? value.split('').map((ch) => ch + ch).join('')
                    : value;
                const r = parseInt(full.slice(0, 2), 16);
                const g = parseInt(full.slice(2, 4), 16);
                const b = parseInt(full.slice(4, 6), 16);
                return `rgba(${r}, ${g}, ${b}, ${a})`;
            }

            const rgb = raw.match(/^rgba?\(([^)]+)\)$/i);
            if (rgb) {
                const parts = rgb[1].split(',').map((p) => Number.parseFloat(p.trim()));
                if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
                    const [r, g, b] = parts;
                    return `rgba(${Math.max(0, Math.min(255, r))}, ${Math.max(0, Math.min(255, g))}, ${Math.max(0, Math.min(255, b))}, ${a})`;
                }
            }

            return `rgba(20, 184, 166, ${a})`;
        }

        function dashDestroyActivityChart() {
            if (!dashboardActivityChart) return;
            try {
                dashboardActivityChart.destroy();
            } catch (_) {}
            dashboardActivityChart = null;
        }

        function dashInitActivityLineChart(series) {
            dashDestroyActivityChart();
            if (!series || !Array.isArray(series.labels) || !Array.isArray(series.values)) return;
            if (typeof Chart === 'undefined') return;

            const canvas = document.getElementById('dash-activity-linechart');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            const rootStyle = getComputedStyle(document.documentElement);
            const accentRaw = String(rootStyle.getPropertyValue('--accent-2') || rootStyle.getPropertyValue('--brand') || '').trim();
            const accent = accentRaw || '#14b8a6';
            const labels = series.labels.map((l) => String(l ?? ''));
            const values = series.values.map((v) => {
                const parsed = Number(v);
                return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
            });

            const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height || 340);
            gradient.addColorStop(0, dashColorToRgba(accent, 0.34));
            gradient.addColorStop(1, dashColorToRgba(accent, 0.04));

            dashboardActivityChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels,
                    datasets: [{
                        data: values,
                        borderColor: accent,
                        backgroundColor: gradient,
                        fill: true,
                        borderWidth: 3,
                        tension: 0.28,
                        cubicInterpolationMode: 'monotone',
                        pointRadius: 3.8,
                        pointHoverRadius: 5,
                        pointBackgroundColor: accent,
                        pointBorderColor: 'rgba(255,255,255,0.95)',
                        pointBorderWidth: 2,
                    }],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        mode: 'index',
                        intersect: false,
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            displayColors: false,
                            backgroundColor: 'rgba(10, 10, 14, 0.94)',
                            borderColor: 'rgba(255,255,255,0.16)',
                            borderWidth: 1,
                            titleColor: 'rgba(255,255,255,0.92)',
                            bodyColor: 'rgba(255,255,255,0.88)',
                            titleFont: { family: 'Inter, sans-serif', size: 12, weight: '600' },
                            bodyFont: { family: 'Inter, sans-serif', size: 12, weight: '400' },
                            callbacks: {
                                label: (ctx2) => ` ${dashFormatCompactNumber(ctx2.parsed?.y ?? 0)} watches`,
                            },
                        },
                    },
                    scales: {
                        x: {
                            offset: false,
                            border: { display: false },
                            grid: {
                                display: false,
                                drawBorder: false,
                            },
                            ticks: {
                                color: 'rgba(255,255,255,0.82)',
                                maxRotation: 0,
                                minRotation: 0,
                                autoSkip: false,
                                font: { family: 'Inter, sans-serif', size: 11, weight: '400' },
                            },
                        },
                        y: {
                            beginAtZero: true,
                            min: 0,
                            border: { display: false },
                            grid: {
                                color: 'rgba(255,255,255,0.15)',
                                drawBorder: false,
                            },
                            ticks: {
                                // Hidden on the canvas — drawn in the sticky overlay below
                                // so the values stay visible while the chart scrolls.
                                display: false,
                            },
                        },
                    },
                },
                plugins: [{
                    id: 'dashActivityStickyYAxis',
                    afterDraw(chart) {
                        const el = document.getElementById('dash-activity-yaxis');
                        const y = chart?.scales?.y;
                        if (!el || !y) return;
                        el.innerHTML = (y.ticks || [])
                            .map((t) => `<span class="dash-yt" style="top:${y.getPixelForValue(t.value)}px;">${dashFormatCompactNumber(t.value)}</span>`)
                            .join('');
                    },
                }],
            });
        }

        function dashRenderActivityLineChart(items, timeframe) {
            const series = dashBuildActivitySeries(items, timeframe);
            if (!series) {
                return {
                    html: `<div class="text-gray">No activity yet.</div>`,
                    series: null,
                };
            }

            const labels = Array.isArray(series.labels) ? series.labels : [];
            const values = (Array.isArray(series.values) ? series.values : []).map((v) => {
                const parsed = Number(v);
                return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
            });
            if (!labels.length || !values.length) {
                return {
                    html: `<div class="text-gray">No activity yet.</div>`,
                    series: null,
                };
            }

            const total = values.reduce((sum, value) => sum + value, 0);
            const peak = Math.max(0, ...values);
            const chartMinWidth = Math.max(760, labels.length * 52);
            const tf = String(timeframe || '').trim().toLowerCase();
            const periodsForAverage = (() => {
                if (!values.length) return 1;
                if (tf === 'this_year') {
                    const elapsedMonths = new Date().getMonth() + 1;
                    return Math.max(1, Math.min(values.length, elapsedMonths));
                }
                return values.length;
            })();
            const average = total / periodsForAverage;
            const avgSuffix = tf === 'this_year' ? 'per month' : tf === 'this_month' ? 'per day' : 'per year';

            return {
                html: `
                    <div class="dash-activity-chart">
                        <div class="dash-activity-stats">
                            <div class="dash-activity-stat dash-activity-stat--hero">
                                <span class="dash-activity-stat-glow" aria-hidden="true"></span>
                                <span class="dash-activity-stat-icon" aria-hidden="true">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.5"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 7h5M17 17h5"/></svg>
                                </span>
                                <div class="dash-activity-stat-main">
                                    <div class="dash-activity-stat-label">Total Watched</div>
                                    <div class="dash-activity-stat-value">${dashFormatCompactNumber(total)}<span class="dash-activity-stat-unit">movies</span></div>
                                </div>
                            </div>
                            <div class="dash-activity-stat">
                                <span class="dash-activity-stat-icon" aria-hidden="true">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 7-7"/><path d="M14 7h6v6"/></svg>
                                </span>
                                <div class="dash-activity-stat-main">
                                    <div class="dash-activity-stat-label">Peak</div>
                                    <div class="dash-activity-stat-value">${dashFormatCompactNumber(peak)}<span class="dash-activity-stat-unit">movies</span></div>
                                    <div class="dash-activity-stat-sub">best ${avgSuffix.replace(/^per /, '')}</div>
                                </div>
                            </div>
                            <div class="dash-activity-stat">
                                <span class="dash-activity-stat-icon" aria-hidden="true">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h3l2.5 7 5-14 2.5 7H21"/></svg>
                                </span>
                                <div class="dash-activity-stat-main">
                                    <div class="dash-activity-stat-label">Average</div>
                                    <div class="dash-activity-stat-value">${average.toFixed(1)}<span class="dash-activity-stat-unit">movies</span></div>
                                    <div class="dash-activity-stat-sub">${avgSuffix}</div>
                                </div>
                            </div>
                        </div>
                        <div class="dash-activity-scroll">
                            <div id="dash-activity-yaxis" class="dash-activity-yaxis"></div>
                            <div class="dash-activity-canvas-wrap" style="min-width:${chartMinWidth}px;">
                                <canvas id="dash-activity-linechart" class="dash-activity-canvas" aria-label="Watch activity line chart"></canvas>
                            </div>
                        </div>
                    </div>
                `,
                series: { labels, values },
            };
        }

        function dashChartTitleForTab(tab) {
            return 'Watch Activity';
        }

        function dashRatingsChartTitleForTab(tab) {
            const t = String(tab || '').trim().toLowerCase();
            return 'Avg Rating';
        }

        function renderDashboardChartsFromData(data) {
            const elTitle = document.getElementById('dash-chart-title');
            const elBody = document.getElementById('dash-chart-body');
            if (!elTitle || !elBody) return;

            const payload = data || {};
            const activity = Array.isArray(payload?.activity) ? payload.activity : [];

            elTitle.textContent = dashChartTitleForTab('activity');
            const chart = dashRenderActivityLineChart(activity, dashboardTimeframe);
            elBody.innerHTML = chart.html;
            dashInitActivityLineChart(chart.series);
        }

        function renderDashboardRatingsChartsFromData(data) {
            const elTitle = document.getElementById('dash-ratings-chart-title');
            const elBody = document.getElementById('dash-ratings-genre-bars');
            if (!elTitle || !elBody) return;

            const payload = data || {};
            const genres = Array.isArray(payload?.genres) ? payload.genres : [];
            const decades = Array.isArray(payload?.decades) ? payload.decades : [];
            const mpa = Array.isArray(payload?.mpa) ? payload.mpa : [];

            const tab = String(dashboardRatingsChartTab || '').trim().toLowerCase();
            elTitle.textContent = dashRatingsChartTitleForTab(tab);

            if (tab === 'decade') {
                const items = decades.map((r) => ({
                    label: r?.decade !== null && r?.decade !== undefined ? `${String(r.decade)}s` : '—',
                    avg: Number(r?.avg ?? 0),
                    n: Number(r?.n ?? 0),
                }));
                elBody.innerHTML = dashRenderVerticalBars({
                    items,
                    labelKey: 'label',
                    valueKey: 'avg',
                    countKey: 'n',
                    barType: 'decade',
                });
                return;
            }

            if (tab === 'mpa') {
                const items = mpa.map((r) => ({
                    label: r?.mpa ?? '—',
                    avg: Number(r?.avg ?? 0),
                    n: Number(r?.n ?? 0),
                }));
                elBody.innerHTML = dashRenderVerticalBars({
                    items,
                    labelKey: 'label',
                    valueKey: 'avg',
                    countKey: 'n',
                    barType: 'mpa',
                });
                return;
            }

            const allItems = genres.map((r) => ({
                label: r?.genre ?? '—',
                avg: Number(r?.avg ?? 0),
                n: Number(r?.n ?? 0),
            }));
            const limit = 10;
            const showAll = Boolean(dashboardRatingsShowAllGenres);
            const items = showAll ? allItems : allItems.slice(0, limit);
            const showToggle = allItems.length > limit;
            const toggleLabel = showAll ? 'Show Top 10' : 'Show All';
            const barsHtml = dashRenderVerticalBars({
                items,
                labelKey: 'label',
                valueKey: 'avg',
                countKey: 'n',
                barType: 'genre',
            });
            elBody.innerHTML = `
                <div>
                    ${showToggle ? `
                        <div class="dash-genre-bars-toggle">
                            <button type="button" class="btn btn-outline" id="dash-ratings-genre-toggle" style="padding: 0.35rem 0.65rem; border-radius: 0.7rem;">${toggleLabel}</button>
                        </div>
                    ` : ''}
                    ${barsHtml}
                </div>
            `;
            if (showToggle) {
                const btn = elBody.querySelector('#dash-ratings-genre-toggle');
                if (btn && !btn.dataset.bound) {
                    btn.dataset.bound = 'true';
                    btn.addEventListener('click', () => {
                        dashboardRatingsShowAllGenres = !dashboardRatingsShowAllGenres;
                        renderDashboardRatingsChartsFromData(dashboardRatingsChartsLastData || data);
                    });
                }
            }
        }

