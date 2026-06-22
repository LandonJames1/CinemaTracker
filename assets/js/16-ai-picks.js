        function openAiFiltersModal() {
            const overlay = document.getElementById('ai-filters-overlay');
            if (!overlay) return;
            overlay.classList.add('open');
            syncAiTmdbRatingFilter();
        }

        function closeAiFiltersModal() {
            const overlay = document.getElementById('ai-filters-overlay');
            if (!overlay) return;
            overlay.classList.remove('open');
        }

        function syncAiTmdbRatingFilter() {
            const input = document.getElementById('ai-filter-tmdb');
            const num = document.getElementById('ai-filter-tmdb-num');
            if (!input || !num) return;
            const v = Number(input.value);
            const n = Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
            input.value = String(n);
            num.value = String(n);
        }

        function setAiInputsHidden(isHidden) {
            const inputs = document.getElementById('ai-inputs-wrap');
            if (inputs) inputs.classList.toggle('hidden', Boolean(isHidden));
        }

        async function getNextLoadingImage() {
            if (!supabaseClient) return { url: '', id: null };
            try {
                const { data, error } = await supabaseClient
                    .from('Loading Images')
                    .select('id, image_url, last_used')
                    .order('last_used', { ascending: true, nullsFirst: true })
                    .limit(1);
                if (error) throw error;
                const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
                const url = String(row?.image_url || '').trim();
                const id = row?.id ? String(row.id).trim() : null;
                return { url, id };
            } catch (_) {
                return { url: '', id: null };
            }
        }

        async function markLoadingImageUsed(id) {
            const imageId = String(id || '').trim();
            if (!imageId || !supabaseClient) return;
            try {
                await supabaseClient
                    .from('Loading Images')
                    .update({ last_used: new Date().toISOString() })
                    .eq('id', imageId);
            } catch (_) {
                // Best-effort only.
            }
        }

        let aiLoadingImageRetryTimer = null;

        async function setNextAiLoadingImage({ retry = true } = {}) {
            const img = document.getElementById('ai-loading-image');
            if (!img) return;
            const { url, id } = await getNextLoadingImage();
            if (!url) {
                img.removeAttribute('src');
                img.style.display = 'none';
                if (retry) {
                    if (aiLoadingImageRetryTimer) clearTimeout(aiLoadingImageRetryTimer);
                    aiLoadingImageRetryTimer = setTimeout(() => {
                        setNextAiLoadingImage({ retry: false }).catch(() => null);
                    }, 600);
                }
                return;
            }
            img.style.display = 'block';
            img.src = url;
            if (id) markLoadingImageUsed(id).catch(() => null);
        }

        function setAiLoading(isLoading) {
            const loading = document.getElementById('ai-loading');
            if (loading) loading.classList.toggle('hidden', !isLoading);
            if (isLoading) {
                setNextAiLoadingImage().catch(() => null);
            }
        }

        function showAiResults(items = []) {
            const panel = document.getElementById('ai-results-panel');
            const list = document.getElementById('ai-results');
            if (!panel || !list) return;
            panel.classList.toggle('hidden', !items.length);
            list.innerHTML = items.length
                ? items.map((it, idx) => {
                    const title = String(it?.title || '').trim() || 'Untitled';
                    const yearVal = it?.year ? String(it.year) : '';
                    const reason = String(it?.reason || '').trim();
                    const num = String(idx + 1).padStart(2, '0');
                    const posterPath = String(it?.poster_path || '').trim();
                    const posterUrl = posterPath ? `https://image.tmdb.org/t/p/w342${posterPath.startsWith('/') ? posterPath : `/${posterPath}`}` : '';
                    const ratingRaw = it?.tmdb_rating ?? it?.vote_average ?? null;
                    const ratingPct = (typeof ratingRaw === 'number' && Number.isFinite(ratingRaw)) ? ratingRaw * 10 : null;
                    const ratingText = ratingPct !== null ? formatPctForDisplay(ratingPct) : '';
                    const mpa = String(it?.mpa_rating || '').trim();
                    return `
                        <div class="glass-panel" style="padding: 0.85rem; border-radius: 0.85rem; display:grid; gap: 10px;">
                            <div style="display:flex; gap: 12px; align-items: center;">
                                <div style="width: 54px; height: 78px; border-radius: 0.75rem; overflow:hidden; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08); flex: 0 0 auto;">
                                    ${posterUrl
                                        ? `<img src="${posterUrl}" loading="lazy" decoding="async" alt="${escapeHtml(title)}" style="width:100%; height:100%; object-fit: cover; display:block;" onerror="this.style.display='none';">`
                                        : `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; color: var(--text-muted); font-size: 12px;">No poster</div>`}
                                </div>
                                <div style="min-width:0;">
                                    <div class="text-white font-bold" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${num}. ${escapeHtml(title)}${yearVal ? ` <span style=\"color: rgba(255,255,255,0.65); font-weight: 800;\">(${escapeHtml(yearVal)})</span>` : ''}</div>
                                    <div class="text-xs text-gray" style="margin-top: 0.2rem; display:flex; gap: 10px; flex-wrap: wrap;">
                                        ${ratingText ? `<span>TMDb: <span class=\"text-white\">${escapeHtml(ratingText)}</span></span>` : ''}
                                        ${mpa ? `<span>MPA: <span class=\"text-white\">${escapeHtml(mpa)}</span></span>` : ''}
                                    </div>
                                </div>
                            </div>
                            ${reason ? `<div class="text-xs text-gray">${escapeHtml(reason)}</div>` : ''}
                        </div>
                    `;
                }).join('')
                : '<div class="text-gray">No results yet.</div>';
        }

        function parseCommaList(value) {
            return String(value || '')
                .split(',')
                .map((s) => String(s || '').trim())
                .filter(Boolean);
        }

        function updateAiPromptCounter() {
            const input = document.getElementById('ai-prompt-input');
            const remainingEl = document.getElementById('ai-prompt-remaining');
            if (!input || !remainingEl) return;
            const max = 2000;
            const used = String(input.value || '').length;
            const remaining = Math.max(0, max - used);
            remainingEl.textContent = `${remaining} characters remaining`;
        }

        function setAiGenreButtonState(btn, isOn) {
            if (!btn) return;
            btn.classList.toggle('is-selected', isOn);
            btn.classList.toggle('btn-glass', isOn);
            btn.classList.toggle('btn-outline', !isOn);
            btn.setAttribute('aria-pressed', isOn ? 'true' : 'false');
            if (isOn) {
                btn.style.backgroundColor = 'color-mix(in srgb, var(--brand-2) 20%, rgba(255,255,255,0.12))';
                btn.style.borderColor = 'color-mix(in srgb, var(--brand) 40%, rgba(255,255,255,0.35))';
                btn.style.boxShadow = '0 0 0 2px color-mix(in srgb, var(--brand) 45%, rgba(255,255,255,0.55)), 0 10px 20px var(--brand-shadow)';
                btn.style.fontWeight = '700';
                btn.style.color = '#ffffff';
            } else {
                btn.style.backgroundColor = '';
                btn.style.borderColor = '';
                btn.style.boxShadow = '';
                btn.style.fontWeight = '';
                btn.style.color = '';
            }
        }

        function setAiProviderButtonState(btn, isOn) {
            if (!btn) return;
            btn.classList.toggle('is-selected', isOn);
            btn.classList.toggle('btn-glass', isOn);
            btn.classList.toggle('btn-outline', !isOn);
            btn.setAttribute('aria-pressed', isOn ? 'true' : 'false');
            if (isOn) {
                btn.style.backgroundColor = 'color-mix(in srgb, var(--brand-2) 20%, rgba(255,255,255,0.12))';
                btn.style.borderColor = 'color-mix(in srgb, var(--brand) 40%, rgba(255,255,255,0.35))';
                btn.style.boxShadow = '0 0 0 2px color-mix(in srgb, var(--brand) 45%, rgba(255,255,255,0.55)), 0 10px 20px var(--brand-shadow)';
                btn.style.fontWeight = '700';
                btn.style.color = '#ffffff';
            } else {
                btn.style.backgroundColor = '';
                btn.style.borderColor = '';
                btn.style.boxShadow = '';
                btn.style.fontWeight = '';
                btn.style.color = '';
            }
        }

        function selectAllAiProviders() {
            document.querySelectorAll('.ai-provider-btn').forEach((btn) => {
                setAiProviderButtonState(btn, true);
            });
        }

        function getAiSelectedGenres(role) {
            const list = [];
            document.querySelectorAll(`[data-ai-genre-role="${role}"][data-genre]`).forEach((btn) => {
                if (btn.classList.contains('is-selected')) {
                    const g = String(btn.getAttribute('data-genre') || '').trim();
                    if (g) list.push(g);
                }
            });
            return list;
        }

        function toggleAiGenreSelection(btn) {
            const genre = String(btn?.getAttribute('data-genre') || '').trim();
            if (!genre) return;
            const isOn = btn.classList.contains('is-selected');
            setAiGenreButtonState(btn, !isOn);
        }

        function getAiSelectedProviders() {
            const list = [];
            document.querySelectorAll('[data-ai-provider]').forEach((btn) => {
                if (btn.classList.contains('is-selected')) {
                    const name = String(btn.getAttribute('data-ai-provider') || '').trim();
                    if (name) list.push(name);
                }
            });
            return list;
        }

        function toggleAiProviderSelection(btn) {
            const name = String(btn?.getAttribute('data-ai-provider') || '').trim();
            if (!name) return;
            const isOn = btn.classList.contains('is-selected');
            setAiProviderButtonState(btn, !isOn);
        }

        let aiSimilarSearchItems = [];
        let aiSimilarAbortController = null;
        let aiSimilarDebounceTimer = null;
        let aiSimilarSelected = [];
        const MAX_SIMILAR_MOVIES = 5;

        function setAiSimilarSelected(list) {
            aiSimilarSelected = Array.isArray(list) ? list : [];
            const hidden = document.getElementById('ai-similar-tmdb-id');
            if (hidden) hidden.value = aiSimilarSelected.map((m) => String(m.tmdb_id)).join(',');

            const wrap = document.getElementById('ai-similar-selected');
            if (!wrap) return;
            if (aiSimilarSelected.length === 0) {
                wrap.innerHTML = '';
                return;
            }

            wrap.innerHTML = aiSimilarSelected.map((m) => {
                const title = String(m?.title || '').trim() || 'Untitled';
                const year = m?.year ? String(m.year) : '';
                const label = year ? `${title} (${year})` : title;
                return `
                    <button type="button" class="btn btn-outline" data-ai-similar-remove="${m.tmdb_id}" style="padding: 0.32rem 0.7rem; border-radius: 0.75rem; font-size: 13px; display:inline-flex; gap: 8px; align-items:center;">
                        <span>${escapeHtml(label)}</span>
                        <span style="opacity:0.7;">×</span>
                    </button>
                `;
            }).join('');
        }

        function addAiSimilarMovie(movie) {
            if (!movie?.tmdb_id) return;
            const exists = aiSimilarSelected.some((m) => Number(m.tmdb_id) === Number(movie.tmdb_id));
            if (exists) return;
            if (aiSimilarSelected.length >= MAX_SIMILAR_MOVIES) {
                showToast(`You can add up to ${MAX_SIMILAR_MOVIES} similar movies.`, { level: 'warn' });
                return;
            }
            setAiSimilarSelected([...aiSimilarSelected, movie]);
        }

        function removeAiSimilarMovie(tmdbId) {
            const list = aiSimilarSelected.filter((m) => Number(m.tmdb_id) !== Number(tmdbId));
            setAiSimilarSelected(list);
        }

        function clearAiSimilarSelection() {
            setAiSimilarSelected([]);
            const input = document.getElementById('ai-similar-input');
            if (input) input.value = '';
            clearAiSimilarResults();
        }

        function renderAiSimilarResults(items) {
            const results = document.getElementById('ai-similar-results');
            if (!results) return;

            aiSimilarSearchItems = Array.isArray(items) ? items.slice(0, 6) : [];
            if (aiSimilarSearchItems.length === 0) {
                results.innerHTML = `<div class="search-item text-gray justify-center">No movies found</div>`;
                results.classList.remove('hidden');
                return;
            }

            results.innerHTML = aiSimilarSearchItems.map((m, idx) => {
                const title = String(m?.title || '').trim();
                const year = m?.year ? String(m.year) : '';
                const genres = Array.isArray(m?.genres)
                    ? m.genres.map((s) => String(s).trim()).filter(Boolean)
                    : String(m?.genre || '').split(',').map((s) => s.trim()).filter(Boolean);
                const posterPath = String(m?.poster_path || '').trim();
                const posterUrl = posterPath ? `https://image.tmdb.org/t/p/w154${posterPath}` : '';
                const metaParts = [year, (genres.length ? genres.join(', ') : '')].filter(Boolean);

                return `
                    <div class="search-item" data-ai-similar-index="${idx}">
                        <div style="display:flex; align-items:center; gap: 0.75rem;">
                            <div style="width: 34px; height: 51px; flex: 0 0 34px; border-radius: 7px; overflow:hidden; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08); display:flex; align-items:center; justify-content:center;">
                                ${posterUrl
                                    ? `<img src="${posterUrl}" alt="" style="width: 100%; height: 100%; object-fit: cover; display:block;" onerror="this.style.display='none'; this.parentElement.style.opacity='0.6';">`
                                    : `<div style="opacity:0.65; color: var(--text-muted); width: 16px; height: 16px; display:flex; align-items:center; justify-content:center;">${icons.film}</div>`
                                }
                            </div>
                            <div>
                                <div class="text-white font-semibold">${escapeHtml(title)}</div>
                                <div class="text-xs text-gray">${escapeHtml(metaParts.join(' • '))}</div>
                            </div>
                        </div>
                        <div style="color:var(--text-muted);">${icons.arrowRightCircle}</div>
                    </div>
                `;
            }).join('');
            results.classList.remove('hidden');

            if (!results.dataset.boundClicks) {
                results.dataset.boundClicks = 'true';
                results.addEventListener('click', async (e) => {
                    const btn = e?.target?.closest ? e.target.closest('.search-item[data-ai-similar-index]') : null;
                    if (!btn) return;
                    const idx = Number(btn.getAttribute('data-ai-similar-index'));
                    const picked = aiSimilarSearchItems[idx];
                    if (!picked) return;
                    const tmdb_id = Number(picked?.tmdb_id ?? picked?.tmdbId ?? picked?.id ?? null);
                    let details = null;
                    if (Number.isFinite(tmdb_id) && tmdb_id > 0) {
                        try {
                            details = await callSwiftApiGetMovieDetails({ tmdb_id });
                        } catch (_) {
                            details = null;
                        }
                    }

                    const overview = String(details?.overview || '').trim();
                    const runtimeRaw = Number(details?.runtime ?? 0);
                    const runtime = Number.isFinite(runtimeRaw) ? Math.round(runtimeRaw) : 0;
                    const mpaRating = String(details?.mpa ?? details?.mpa_rating ?? '').trim();

                    const yearRaw = Number(picked?.year ?? picked?.release_year ?? 0);
                    const year = Number.isFinite(yearRaw) ? Math.max(0, Math.floor(yearRaw)) : 0;

                    addAiSimilarMovie({
                        tmdb_id: Number.isFinite(tmdb_id) ? tmdb_id : 0,
                        title: String(picked?.title || '').trim(),
                        year,
                        genres: Array.isArray(picked?.genres)
                            ? picked.genres
                            : String(picked?.genre || '').split(',').map((s) => s.trim()).filter(Boolean),
                        mpa_rating: mpaRating,
                        runtime,
                        overview,
                    });
                    const input = document.getElementById('ai-similar-input');
                    if (input) input.value = '';
                    results.classList.add('hidden');
                    results.innerHTML = '';
                });
            }
        }

        function clearAiSimilarResults() {
            const results = document.getElementById('ai-similar-results');
            if (results) {
                results.classList.add('hidden');
                results.innerHTML = '';
            }
            aiSimilarSearchItems = [];
        }

        function handleAiSimilarSearch(query, opts = {}) {
            const inputEl = document.getElementById('ai-similar-input');
            const results = document.getElementById('ai-similar-results');
            if (!inputEl || !results) return;

            const q = String(query || '').trim();
            if (!q || q.length < 1) {
                if (aiSimilarDebounceTimer) clearTimeout(aiSimilarDebounceTimer);
                if (aiSimilarAbortController) aiSimilarAbortController.abort();
                clearAiSimilarResults();
                return;
            }

            if (aiSimilarDebounceTimer) clearTimeout(aiSimilarDebounceTimer);
            if (aiSimilarAbortController) aiSimilarAbortController.abort();
            aiSimilarAbortController = new AbortController();

            if (q.length < 3) {
                results.classList.add('hidden');
                aiSimilarSearchItems = [];
                return;
            }

            const debounceMs = opts?.force ? 0 : 320;
            aiSimilarDebounceTimer = setTimeout(async () => {
                try {
                    const data = await callSwiftApiPublic({ action: 'search', query: q, page: 1, limit: 6 }, { signal: aiSimilarAbortController.signal });
                    const items = Array.isArray(data?.results) ? data.results : [];
                    renderAiSimilarResults(items);
                } catch (err) {
                    if (String(err?.name || '').toLowerCase() === 'aborterror') return;
                    results.innerHTML = `<div class="search-item text-gray justify-center">Search failed</div>`;
                    results.classList.remove('hidden');
                }
            }, debounceMs);
        }

        function getAiSimilarMovie() {
            return Array.isArray(aiSimilarSelected) ? aiSimilarSelected.filter((m) => m?.tmdb_id) : [];
        }

        function hasAiFiltersSet(filters) {
            const f = filters || {};
            const rating = Number(f.tmdb_rating_min ?? 0);
            const yrFrom = Number(f.release_year_from ?? 0);
            const yrTo = Number(f.release_year_to ?? 0);
            const hasRating = Number.isFinite(rating) && rating > 0;
            const hasYear = (Number.isFinite(yrFrom) && yrFrom > 1800) || (Number.isFinite(yrTo) && yrTo > 1800);
            const hasGenres = Array.isArray(f.genres_include) && f.genres_include.length > 0;
            const hasProviders = Array.isArray(f.watch_providers) && f.watch_providers.length > 0;
            return hasRating || hasYear || hasGenres || hasProviders;
        }

        function areAiFiltersComplete(filters) {
            const f = filters || {};
            const rating = Number(f.tmdb_rating_min ?? 0);
            const yrFrom = Number(f.release_year_from ?? 0);
            const yrTo = Number(f.release_year_to ?? 0);
            const hasRating = Number.isFinite(rating) && rating > 0;
            const hasYearFrom = Number.isFinite(yrFrom) && yrFrom > 1800;
            const hasYearTo = Number.isFinite(yrTo) && yrTo > 1800;
            const hasGenres = Array.isArray(f.genres_include) && f.genres_include.length > 0;
            const hasProviders = Array.isArray(f.watch_providers) && f.watch_providers.length > 0;
            return hasRating && hasYearFrom && hasYearTo && hasGenres && hasProviders;
        }

        function getAiFilters() {
            const tmdbNum = document.getElementById('ai-filter-tmdb-num');
            const yearFrom = document.getElementById('ai-filter-year-from');
            const yearTo = document.getElementById('ai-filter-year-to');
            const excludeWatched = document.getElementById('ai-filter-exclude-watched');

            const rating = Number(tmdbNum?.value ?? 0);
            const yrFrom = Number(yearFrom?.value ?? 0);
            const yrTo = Number(yearTo?.value ?? 0);

            return {
                tmdb_rating_min: Number.isFinite(rating) ? Math.max(0, Math.min(100, Math.round(rating))) : 0,
                release_year_from: Number.isFinite(yrFrom) && yrFrom > 1800 ? Math.floor(yrFrom) : 0,
                release_year_to: Number.isFinite(yrTo) && yrTo > 1800 ? Math.floor(yrTo) : 0,
                genres_include: getAiSelectedGenres('include'),
                watch_region: 'US',
                watch_providers: getAiSelectedProviders(),
                exclude_watched: Boolean(excludeWatched?.checked),
            };
        }

        let _aiPicksListenersBound = false;

        function initAiPicksPage() {
            syncAiTmdbRatingFilter();
            showAiResults([]);
            setAiInputsHidden(false);
            setAiLoading(false);
            updateAiPromptCounter();
            clearAiSimilarSelection();

            // Only bind document-level listeners once to prevent duplicate toggle firings
            if (_aiPicksListenersBound) return;
            _aiPicksListenersBound = true;

            document.addEventListener('input', (e) => {
                const el = e?.target;
                if (!el || !(el instanceof HTMLElement)) return;
                if (el.id === 'ai-filter-tmdb') {
                    syncAiTmdbRatingFilter();
                }
                if (el.id === 'ai-filter-tmdb-num' && el instanceof HTMLInputElement) {
                    const v = Number(el.value);
                    const n = Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
                    const range = document.getElementById('ai-filter-tmdb');
                    if (range) range.value = String(n);
                    el.value = String(n);
                }
                if (el.id === 'ai-prompt-input') {
                    updateAiPromptCounter();
                }
                if (el.id === 'ai-similar-input') {
                    handleAiSimilarSearch(el.value || '');
                }
            });

            document.addEventListener('click', (e) => {
                const genreBtn = e?.target?.closest ? e.target.closest('.ai-genre-btn') : null;
                if (genreBtn) {
                    toggleAiGenreSelection(genreBtn);
                    return;
                }
                const providerBtn = e?.target?.closest ? e.target.closest('.ai-provider-btn') : null;
                if (providerBtn) {
                    toggleAiProviderSelection(providerBtn);
                    return;
                }
                const clearSimilar = e?.target?.closest ? e.target.closest('#ai-similar-clear') : null;
                if (clearSimilar) {
                    clearAiSimilarSelection();
                    return;
                }
                const removeSimilar = e?.target?.closest ? e.target.closest('[data-ai-similar-remove]') : null;
                if (removeSimilar) {
                    const id = removeSimilar.getAttribute('data-ai-similar-remove');
                    if (id) removeAiSimilarMovie(id);
                    return;
                }
            });

            document.addEventListener('click', (e) => {
                const gen = e?.target?.closest ? e.target.closest('#ai-generate-btn') : null;
                if (gen) {
                    const promptEl = document.getElementById('ai-prompt-input');
                    const prompt = String(promptEl?.value || '').trim();
                    if (!prompt) {
                        showToast('Please enter a prompt first.', { level: 'warn' });
                        return;
                    }

                    const filters = getAiFilters();
                    const similarMovies = getAiSimilarMovie();
                    const hasCompleteFilters = areAiFiltersComplete(filters);
                    if (!similarMovies.length && !hasCompleteFilters) {
                        showToast('Please either fill out all filters or select a similar movie.', { level: 'warn' });
                        return;
                    }

                    const debugToggle = document.getElementById('ai-debug-toggle');
                    const debug = Boolean(debugToggle?.checked);

                    showAiResults([]);
                    setAiInputsHidden(true);
                    setAiLoading(true);

                    (async () => {
                        try {
                            // Make sure the taste profile reflects the latest ratings
                            // before picking (shared helper, best-effort).
                            await recomputeMyTasteProfile();

                            const payload = {
                                action: 'ai_picks',
                                mode: similarMovies.length ? 'similar_movie' : 'filters',
                                prompt,
                                filters,
                                similar_movie: similarMovies,
                                // Taste is loaded server-side from the Taste Profiles row
                                // (keyed on the authed user) — nothing to send from here.
                                debug,
                            };
                            const data = await callSwiftApiPublic(payload);
                            const items = Array.isArray(data?.top5) ? data.top5 : (Array.isArray(data?.top10) ? data.top10 : []);
                            if (debug && data?.debug) {
                                try {
                                    addMessageToLog('info', 'AI Picks Debug', JSON.stringify(data.debug, null, 2));
                                    setLogPanelOpen(true);
                                } catch (_) {}
                            }
                            setAiLoading(false);
                            showAiResults(items);
                        } catch (err) {
                            const msg = String(err?.message || err);
                            setAiLoading(false);
                            setAiInputsHidden(false);
                            showAiResults([]);
                            showToast(`AI picks failed: ${msg}`, { level: 'warn' });
                        }
                    })();
                    return;
                }

                const clear = e?.target?.closest ? e.target.closest('#ai-clear-btn') : null;
                if (clear) {
                    setAiLoading(false);
                    setAiInputsHidden(false);
                    showAiResults([]);
                    clearAiSimilarSelection();
                    return;
                }

                const rerun = e?.target?.closest ? e.target.closest('#ai-rerun-btn') : null;
                if (rerun) {
                    // Show the inputs again so the user can edit, keep results visible for reference
                    setAiInputsHidden(false);
                    // Scroll to the top of the inputs
                    const inputsWrap = document.getElementById('ai-inputs-wrap');
                    if (inputsWrap) inputsWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    return;
                }
            });
        }

