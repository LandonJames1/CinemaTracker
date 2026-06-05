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

