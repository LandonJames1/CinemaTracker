        const router = {
            currentPage: 'home',
            selectedMovie: null,
            pendingTitle: '',
            formMode: 'new',
            navStack: [],
            
            init() {
                window.addEventListener('popstate', (e) => {
                    const state = e?.state || {};
                    const page = String(state.page || 'home').trim() || 'home';
                    const mode = String(state.mode || 'new').trim() || 'new';
                    this.navigate(page, mode, 'pop');
                });

                const state = history.state || {};
                if (state.page) {
                    this.navigate(String(state.page), String(state.mode || 'new'), 'pop');
                } else {
                    history.replaceState({ page: 'home', mode: 'new' }, '', location.pathname);
                    this.navigate('home', 'new', 'pop');
                }
            },

            goBack() {
                const prev = this.navStack.pop();
                if (prev?.page) {
                    if (prev.page === 'dashboard') {
                        if (prev.dashboardActiveTab) dashboardActiveTab = prev.dashboardActiveTab;
                        if (prev.dashboardTimeframe) dashboardTimeframe = prev.dashboardTimeframe;
                        if (prev.dashboardRatingsChartTab) dashboardRatingsChartTab = prev.dashboardRatingsChartTab;
                        if (prev.dashboardFavoritesMetric) dashboardFavoritesMetric = prev.dashboardFavoritesMetric;
                        if (Number.isFinite(prev.dashboardFavoritesLimit)) dashboardFavoritesLimit = prev.dashboardFavoritesLimit;
                        if (prev.dashboardGeneralMode) dashboardGeneralMode = prev.dashboardGeneralMode;
                        if (prev.dashboardGeneralPieMode) dashboardGeneralPieMode = prev.dashboardGeneralPieMode;
                    }
                    this.navigate(prev.page, prev.mode || 'new', 'replace');
                    return;
                }
                try {
                    if (history.length > 1) {
                        history.back();
                        return;
                    }
                } catch (_) {}
                this.navigate('home', 'new', 'replace');
            },

            navigate(page, mode = 'new', navMode = 'push') {
                // If the user is not logged in, open the auth modal with demo option.
                const authGatedPages = ['dashboard','dashboard_kpi','dashboard_pie_filter','feed','library','lists','account','theme_creator'];
                if (authGatedPages.includes(page) && !cachedIsAuthed) {
                    _pendingGuestPage = page;
                    openAuthModal();
                    return;
                }

                // Disallow opening the submit form without selecting a movie from the dropdown.
                if (page === 'submit' && String(mode || 'new') === 'new') {
                    const hasPicked = Boolean(this.selectedMovie);
                    const hasDetails = Boolean(this.selectedMovie?.detailsReadonly);
                    if (!hasPicked || !hasDetails) {
                        showToast('Please search and select a movie from the dropdown first.', { level: 'warn' });
                        page = 'home';
                        mode = 'new';
                    }
                }

                if (page === 'dashboard_kpi' || page === 'dashboard_pie_filter') {
                    page = 'library';
                }

                const prevPage = this.currentPage;
                const prevMode = this.formMode;
                if (navMode === 'push' && page !== prevPage) {
                    this.navStack.push({
                        page: prevPage,
                        mode: prevMode,
                        dashboardActiveTab,
                        dashboardTimeframe,
                        dashboardRatingsChartTab,
                        dashboardFavoritesMetric,
                        dashboardFavoritesLimit,
                        dashboardGeneralMode,
                        dashboardGeneralPieMode,
                    });
                }

                this.currentPage = page;
                this.formMode = mode;
                if (navMode !== 'pop') {
                    const state = { page, mode };
                    if (navMode === 'replace') history.replaceState(state, '', location.pathname);
                    else history.pushState(state, '', location.pathname);
                }
                document.body.dataset.page = page;
                const root = document.getElementById('app-root');
                
                // Active Nav
                document.querySelectorAll('.nav-link').forEach(el => {
                    let label = '';
                    if (page === 'home') label = 'home';
                    else if (page === 'submit') label = 'log';
                    else if (page === 'library') label = 'movies';
                    else if (page === 'lists') label = 'lists';
                    else if (page === 'feed') label = 'feed';
                    else if (page === 'account') label = 'account';
                    else if (page === 'ai_picks') label = 'ai picks';
                    else if (page === 'dashboard' || page === 'dashboard_kpi' || page === 'dashboard_pie_filter') label = 'data';
                    if (label && el.innerText.toLowerCase().includes(label)) {
                        el.classList.add('active');
                    } else {
                        el.classList.remove('active');
                    }
                });

                document.getElementById('mobile-menu').classList.remove('open');

                // Refresh unread-notification badges on every navigation.
                try { refreshNavBadges(); } catch (_) {}

                if (page === 'home') {
                    root.innerHTML = this.renderHome();
                    this.selectedMovie = null;
                    this.pendingTitle = '';
                    resetHomeSearchAndFilters();
                    loadTrendingNow();
                } else if (page === 'feed') {
                    root.innerHTML = this.renderFeed();
                    refreshAuthStateAndUI();
                    initFeedPage();
                    loadFeedPage();
                } else if (page === 'library') {
                    root.innerHTML = this.renderLibrary();
                    refreshAuthStateAndUI();
                    initLibraryPage();
                    loadLibraryPage({ reset: true });
                } else if (page === 'lists') {
                    root.innerHTML = this.renderLists();
                    refreshAuthStateAndUI();
                    initListsPage();
                    loadListsPage({ reset: true });
                } else if (page === 'ai_picks') {
                    root.innerHTML = this.renderAiPicks();
                    refreshAuthStateAndUI();
                    initAiPicksPage();
                    showAiHelpPopupIfNeeded().catch(() => null);
                } else if (page === 'account') {
                    root.innerHTML = this.renderAccount();
                    refreshAuthStateAndUI();
                    initAccountPage();
                    loadAccountPage();
                } else if (page === 'theme_creator') {
                    root.innerHTML = this.renderThemeCreator();
                    refreshAuthStateAndUI();
                    initThemeCreatorPage();
                } else if (page === 'submit') {
                    root.innerHTML = this.renderSubmit();
                    initializeWatchMethodToggle();
                    refreshAuthStateAndUI();
                } else if (page === 'dashboard') {
                    root.innerHTML = this.renderDashboard();
                    refreshAuthStateAndUI();
                    initDashboardTabs();
                    initDashboardTimeframe();
                    initDashboardFavoritesMetric();
                    initDashboardFavoritesLimitToggle();
                    initDashboardGeneralModeControls();
                    initDashboardGeneralPieControls();
                    initDashboardGeneralPieLegendClicks();
                    initDashboardGeneralPieHover();
                    initDashboardGeneralKpiClicks();
                    initDashKpiTiesModal();
                    initDashGenreOtherModal();
                    initDashboardRatingsKpiClicks();
                    initDashboardRatingsChartControls();
                    initDashboardPosterUpdateRatingsClicks();
                    setDashboardTimeframe(dashboardTimeframe || 'all_time');
                    syncDashboardFavoritesMetricUI();
                    syncDashboardFavoritesLimitUI();
                    syncDashboardGeneralModeUI();
                    syncDashboardGeneralPieUI();
                    syncDashboardRatingsChartUI();
                }
                
                window.scrollTo(0, 0);
            },

            async selectMovie(movie) {
                this.selectedMovie = movie;
                this.pendingTitle = movie?.title || '';
                const input = document.getElementById('movie-search-input');
                const results = document.getElementById('search-results');
                const updateBtn = document.getElementById('update-existing-btn');
                const updateOpts = document.getElementById('update-options');
                const logNewBtn = document.getElementById('btn-log-new-entry');

                if (input) input.value = movie.title;
                if (results) results.classList.add('hidden');

                // Prevent UI flash: hide both buttons immediately.
                if (logNewBtn) logNewBtn.style.display = 'none';
                if (updateBtn) updateBtn.style.display = 'none';
                if (updateOpts) {
                    updateOpts.classList.add('hidden');
                    updateOpts.classList.remove('grid');
                }

                // Show the action area and hide the placeholder text.
                setHomeActionsVisible(true);

                // Default behavior when we can't confirm diary status: allow Log as New Entry.
                const showLogNewOnly = () => {
                    if (logNewBtn) logNewBtn.style.display = '';
                    if (updateBtn) updateBtn.style.display = 'none';
                    if (updateOpts) {
                        updateOpts.classList.add('hidden');
                        updateOpts.classList.remove('grid');
                    }
                };

                const showUpdateOnly = () => {
                    if (logNewBtn) logNewBtn.style.display = 'none';
                    if (updateBtn) {
                        updateBtn.style.display = '';
                        updateBtn.disabled = false;
                        updateBtn.style.opacity = '1';
                        updateBtn.style.pointerEvents = 'auto';
                    }
                };

                try {
                    if (!supabaseClient) {
                        showLogNewOnly();
                        return;
                    }

                    const { data } = await supabaseClient.auth.getSession();
                    const authedUser = data?.session?.user;
                    if (!authedUser?.id) {
                        showLogNewOnly();
                        return;
                    }

                    const movie_id = await resolveDbMovieIdFromSelectedMovie(movie);
                    if (!movie_id) {
                        // If it isn't in Movies yet, it can't be in Movie Ratings.
                        showLogNewOnly();
                        return;
                    }

                    const alreadyRated = await hasExistingMovieRating({ user_id: authedUser.id, movie_id });
                    if (alreadyRated) showUpdateOnly();
                    else showLogNewOnly();
                } catch (_) {
                    // Safe fallback: allow Log as New Entry.
                    showLogNewOnly();
                }
            },

            async startNewEntry() {
                const btn = document.getElementById('btn-log-new-entry');
                const originalHTML = btn ? btn.innerHTML : null;

                try {
                    // Users must pick a movie from the dropdown first.
                    if (!this.selectedMovie) {
                        showToast('Please select a movie from the search dropdown first.', { level: 'warn' });
                        return;
                    }

                    // If the user is logged in and already has a rating for this movie, prevent duplicates.
                    try {
                        if (supabaseClient) {
                            const { data } = await supabaseClient.auth.getSession();
                            const authedUser = data?.session?.user;
                            if (authedUser?.id) {
                                const movie_id = await resolveDbMovieIdFromSelectedMovie(this.selectedMovie);
                                if (movie_id) {
                                    const alreadyRated = await hasExistingMovieRating({ user_id: authedUser.id, movie_id });
                                    if (alreadyRated) {
                                        showToast('This movie is already in your diary. Use “Update Existing” instead.', { level: 'warn' });
                                        return;
                                    }
                                }
                            }
                        }
                    } catch (_) {}

                    // If we already have full details, just navigate.
                    if (this.selectedMovie?.detailsReadonly) {
                        this.navigate('submit', 'new');
                        return;
                    }

                    const tmdb_id = Number(this.selectedMovie?.tmdb_id ?? this.selectedMovie?.id);
                    if (!Number.isFinite(tmdb_id) || tmdb_id <= 0) {
                        showToast('Please select a movie from the search dropdown first.', { level: 'warn' });
                        return;
                    }

                    if (btn) {
                        btn.innerHTML = `${icons.loader} Loading…`;
                        btn.disabled = true;
                        btn.style.opacity = 0.85;
                    }

                    const details = await callSwiftApiGetMovieDetails({ tmdb_id });

                    // Shape the prefill object to match the submit page expectations.
                    const genres = Array.isArray(details?.genres)
                        ? details.genres.map(s => String(s).trim()).filter(Boolean)
                        : [];

                    const joinedGenres = genres.length
                        ? genres.join(', ')
                        : String(details?.genre || this.selectedMovie?.genre || '').trim();

                    this.selectedMovie = {
                        ...this.selectedMovie,
                        tmdb_id: Number(details?.tmdb_id ?? tmdb_id),
                        title: String(details?.title || this.selectedMovie?.title || '').trim(),
                        year: details?.year ?? this.selectedMovie?.year ?? null,
                        mpa: String(details?.mpa || '').trim(),
                        runtime: details?.runtime ?? null,
                        isSeries: Boolean(details?.isSeries),
                        director: String(details?.director || '').trim(),
                        imdb: (details?.imdb_rating_pct === null || details?.imdb_rating_pct === undefined)
                            ? ''
                            : String(details.imdb_rating_pct),
                        genres,
                        genre: joinedGenres,
                        poster_path: details?.poster_path ?? this.selectedMovie?.poster_path ?? null,
                        detailsReadonly: true,
                    };

                    this.navigate('submit', 'new');
                } catch (err) {
                    showToast(`Failed to load movie details: ${String(err?.message || err)}`, { level: 'warn' });
                    // Do not allow manual entry.
                    return;
                } finally {
                    if (btn && originalHTML !== null) {
                        btn.innerHTML = originalHTML;
                        btn.disabled = false;
                        btn.style.opacity = 1;
                    }
                }
            },

            async quickIncrement() {
                const m = this.selectedMovie;
                if (!m) return;

                try {
                    if (!supabaseClient) {
                        throw new Error('Supabase SDK failed to load.');
                    }
                    const { user: authedUser } = await requireAuthOrThrow();

                    // Resolve the DB UUID from the selected movie (prefer UUID, else map tmdb_id -> Movies.id).
                    const movie_id = await resolveDbMovieIdFromSelectedMovie(m);
                    if (!movie_id) {
                        showToast('Quick Watch is only available for movies already in your diary. Use “Log as New Entry” first.');
                        return;
                    }

                    // Only allow Quick Watch for movies already logged (rated) by this user.
                    const alreadyRated = await hasExistingMovieRating({ user_id: authedUser.id, movie_id });
                    if (!alreadyRated) {
                        showToast('Quick Watch is only for movies you\'ve already logged. Use “Log as New Entry” first.');
                        return;
                    }

                    const watchChoice = await promptWatchMethodChoice();
                    if (!watchChoice) {
                        showToast('Quick Watch canceled.', { level: 'warn' });
                        return;
                    }

                    await insertWatchLog({
                        user_id: authedUser.id,
                        movie_id,
                        watch_method: watchChoice.watch_method,
                        watch_date: watchChoice.watch_date,
                    });
                    showToast(`Added another watch for ${m.title}!`);

                    // Reset
                    const input = document.getElementById('movie-search-input');
                    if (input) input.value = '';
                    const results = document.getElementById('search-results');
                    if (results) {
                        results.classList.add('hidden');
                        results.innerHTML = '';
                    }
                    this.selectedMovie = null;
                    setHomeActionsVisible(false);
                    setUpdateOptionsHidden();
                    const updateBtn = document.getElementById('update-existing-btn');
                    if (updateBtn) updateBtn.style.display = '';
                } catch (err) {
                    showToast(`Quick Watch failed: ${String(err.message || err)}`);
                }
            },

            async startUpdateRatings() {
                const m = this.selectedMovie;
                if (!m) return;

                try {
                    showLoadingOverlay('Hang tight — fetching your existing entry…');
                    if (!supabaseClient) throw new Error('Supabase SDK failed to load.');
                    const { user: authedUser } = await requireAuthOrThrow();

                    // Resolve DB movie UUID using tmdb_id -> Movies.id mapping (read-only).
                    const movie_id = await resolveDbMovieIdFromSelectedMovie(m);
                    if (!movie_id) {
                        showToast('No matching movie found in your database for this selection. Use “Log as New Entry” first.');
                        return;
                    }

                    const existing = await getExistingMovieRatingRow({ user_id: authedUser.id, movie_id });
                    if (!existing) {
                        showToast('No existing rating found for this movie. Use “Log as New Entry” instead.');
                        return;
                    }

                    // Pull movie details from the DB so the update form is fully populated.
                    let movieRow = null;
                    try {
                        movieRow = await getDbMovieRowById(movie_id);
                    } catch (_) {
                        movieRow = null;
                    }

                    const latestWatch = await getLatestWatchLog({ user_id: authedUser.id, movie_id });
                    const earliestWatch = await getEarliestWatchLog({ user_id: authedUser.id, movie_id });
                    let watchCount = null;
                    try {
                        watchCount = await getWatchLogCount({ user_id: authedUser.id, movie_id });
                    } catch (_) {
                        watchCount = null;
                    }
                    const watchedTimes = (() => {
                        const n = Number(watchCount);
                        if (Number.isFinite(n) && n > 0) return n;
                        // Back-compat: older data may be missing Watch Logs rows.
                        return 1;
                    })();
                    const defaultDate = getLocalISODate();
                    const date = existing?.[COL_WATCH_DATE]
                        ? String(existing[COL_WATCH_DATE])
                        : (latestWatch?.[COL_WATCH_DATE] ? String(latestWatch[COL_WATCH_DATE]) : defaultDate);

                    const review = {
                        date,
                        tier: existing?.tier ?? '',
                        scores: {
                            overall: Number(existing?.overall_rating ?? 50),
                            sound: Number(existing?.sound_rating ?? 50),
                            pace: Number(existing?.pacing_rating ?? 50),
                            imagery: Number(existing?.imagery_rating ?? 50),
                            acting: Number(existing?.acting_rating ?? 50),
                            plot: Number(existing?.plot_rating ?? 50),
                            dialogue: Number(existing?.dialogue_rating ?? 50),
                        },
                        quote: (() => {
                            const fromDb = String(existing?.fav_quote ?? '').trim();
                            if (fromDb) return fromDb;
                            const fromSelection = String(m?.prefill_quote ?? m?.prefillQuote ?? m?.quote ?? '').trim();
                            return fromSelection;
                        })(),
                        notes: String(existing?.notes ?? ''),
                        watched: watchedTimes,
                        // When updating, show the original (oldest) watch method as the locked form value.
                        watch_method: String(earliestWatch?.watch_method || latestWatch?.watch_method || 'At Home')
                    };

                    const coalesceYear = (row) => {
                        const y = row?.release_year ?? row?.year;
                        const n = Number(y);
                        return Number.isFinite(n) && n > 0 ? n : (m?.year ?? '');
                    };

                    const coalesceRuntime = (row) => {
                        const v = row?.runtime_minutes ?? row?.runtime;
                        const n = Number(v);
                        return Number.isFinite(n) ? n : (m?.runtime ?? '');
                    };

                    const coalesceGenre = (row) => {
                        if (!row) return m?.genre || '';
                        if (typeof row?.genre === 'string') return row.genre;
                        if (Array.isArray(row?.genres)) return row.genres.map(s => String(s).trim()).filter(Boolean).join(', ');
                        if (typeof row?.genres === 'string') return row.genres;
                        return m?.genre || '';
                    };

                    const isGenrePlaceholder = (raw) => {
                        const s = String(raw ?? '').trim();
                        if (!s) return true;
                        const lower = s.toLowerCase();
                        return lower === 'movie' || lower === '0';
                    };

                    // Director/genre can be missing or placeholder in the Movies table.
                    // Prefer DB values, but fall back to TMDb details so the update form matches the Search-bar flow.
                    let resolvedDirector = String(
                        movieRow?.director ??
                        movieRow?.director_name ??
                        movieRow?.directorName ??
                        m?.director ??
                        ''
                    ).trim();

                    let resolvedGenre = String(coalesceGenre(movieRow) ?? '').trim();

                    let resolvedPosterPath = String(
                        movieRow?.poster_path ??
                        m?.poster_path ??
                        m?.posterPath ??
                        m?.poster_url ??
                        m?.posterUrl ??
                        ''
                    ).trim();

                    const tmdb_id = Number(movieRow?.tmdb_id ?? m?.tmdb_id ?? getTmdbIdFromSelectedMovie(m) ?? null);
                    const needsTmdbDetails = (
                        (!resolvedDirector) ||
                        isGenrePlaceholder(resolvedGenre) ||
                        (!resolvedPosterPath)
                    ) && (Number.isFinite(tmdb_id) && tmdb_id > 0);

                    if (needsTmdbDetails) {
                        try {
                            const details = await callSwiftApiGetMovieDetails({ tmdb_id });

                            if (!resolvedDirector) {
                                resolvedDirector = String(details?.director || '').trim();
                            }

                            if (isGenrePlaceholder(resolvedGenre)) {
                                const genres = Array.isArray(details?.genres)
                                    ? details.genres.map(s => String(s).trim()).filter(Boolean)
                                    : [];
                                const joined = genres.length
                                    ? genres.join(', ')
                                    : String(details?.genre || '').trim();
                                if (joined) resolvedGenre = joined;
                            }

                            if (!resolvedPosterPath) {
                                const p = String(details?.poster_path ?? '').trim();
                                if (p) resolvedPosterPath = p;
                            }

                            const imdbPct = details?.imdb_rating_pct;
                            if (imdbPct !== null && imdbPct !== undefined) {
                                m.imdb = String(imdbPct);
                            }
                        } catch (_) {}
                    }

                    this.selectedMovie = {
                        ...m,
                        id: movie_id,
                        tmdb_id: Number(movieRow?.tmdb_id ?? m?.tmdb_id ?? getTmdbIdFromSelectedMovie(m) ?? null) || undefined,
                        title: String(movieRow?.title ?? m?.title ?? '').trim(),
                        year: coalesceYear(movieRow),
                        director: resolvedDirector,
                        mpa: String(movieRow?.mpa_rating ?? movieRow?.mpa ?? m?.mpa ?? '').trim(),
                        runtime: coalesceRuntime(movieRow),
                        isSeries: (movieRow?.is_series ?? movieRow?.isSeries ?? m?.isSeries) === true,
                        genre: resolvedGenre,
                        poster_path: resolvedPosterPath,
                        detailsReadonly: true,
                        mockUserReview: review
                    };

                    // Close the home dropdown UI if it's open.
                    try {
                        document.getElementById('update-options')?.classList?.add('hidden');
                        document.getElementById('update-options')?.classList?.remove('grid');
                    } catch (_) {}

                    this.navigate('submit', 'update');
                } catch (err) {
                    showToast(`Update Ratings failed: ${String(err?.message || err)}`);
                } finally {
                    hideLoadingOverlay();
                }
            },

            toggleUpdateOptions() {
                const opts = document.getElementById('update-options');
                const updateBtn = document.getElementById('update-existing-btn');
                const secondaryRow = document.getElementById('home-secondary-actions');
                if (!opts) return;

                if (opts.classList.contains('hidden')) {
                    opts.classList.remove('hidden');
                    opts.classList.add('grid');
                    // Once expanded, hide the "Update Existing" button so only the two options remain.
                    if (updateBtn) updateBtn.style.display = 'none';
                    if (secondaryRow) secondaryRow.style.display = 'none';
                    return;
                }

                // If we ever collapse programmatically, restore the button.
                opts.classList.add('hidden');
                opts.classList.remove('grid');
                if (updateBtn) updateBtn.style.display = '';
                if (secondaryRow) secondaryRow.style.display = '';
            },

            renderHome() {
                return `
                    <div>
                        <div class="fade-in">
                        <!-- Hero (Full Width) -->
                        <div class="relative w-full" style="height: 62vh; margin-bottom: 1.5rem; z-index: 6000; overflow: visible;">
                            <!-- Content (Containerized) -->
                            <div class="container" style="height: 100%; display: flex; flex-direction: column; justify-content: flex-end; padding-bottom: 2.25rem;">
                                <div class="glass-panel" style="max-width: 600px; padding: 1rem 1.1rem; border-radius: 1rem; margin-bottom: 1rem;">
                                    <span class="text-xs font-semibold text-brand uppercase" style="background: var(--brand-light); padding: 0.25rem 0.75rem; border-radius: 99px; border: 1px solid color-mix(in srgb, var(--brand) 35%, transparent); width: fit-content; margin-bottom: 1rem; display: inline-flex;">Start Logging</span>
                                    <h1 class="text-5xl font-bold text-white mb-6" style="line-height: 1.1; color: var(--text-main);">Cinema <br/> <span style="background: linear-gradient(to right, var(--brand), var(--accent-2)); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Tracker</span></h1>
                                    <p class="text-xl text-gray mb-0">Search for a movie to add it to your diary.</p>
                                </div>

                                <div class="glass-panel" style="max-width: 600px; position: relative; padding: 0.55rem; border-radius: 1rem;">
                                    
                                    <!-- Search -->
                                    <div style="position: relative;">
                                        <div class="input-group mb-4">
                                            <div class="input-icon">${icons.search}</div>
                                            <input type="text" id="movie-search-input" oninput="handleSearch(this.value)" autocomplete="off" placeholder="Type a movie title..." class="input-field glass-input" style="border-radius: 0.85rem; padding-right: 128px;">
                                            <div id="search-results" class="search-dropdown hidden"></div>
                                        </div>
                                        <button type="button" id="movie-search-filters-toggle" class="btn btn-glass" onclick="toggleSearchFiltersPanel()" style="position:absolute; right: 8px; top: 8px; height: 30px; padding: 0 0.75rem; border-radius: 0.85rem; font-size: 0.75rem; font-weight: 800; letter-spacing: 0.02em;">Use Filters</button>
                                    </div>

                                    <!-- Optional Filters -->
                                    <div id="movie-search-filters" class="hidden" style="margin-top: -0.25rem; margin-bottom: 1rem; width: 100%; display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 0.75rem; align-items: stretch;">
                                        <input
                                            type="text"
                                            id="movie-search-year"
                                            inputmode="numeric"
                                            placeholder="Year"
                                            class="input-field glass-input"
                                            style="width: 100%; padding-left: 0.9rem; height: 38px; border-radius: 0.85rem;"
                                            oninput="markSearchFiltersDirty()"
                                        />
                                        <select
                                            id="movie-search-mpa"
                                            class="select-field"
                                            style="width: 100%; height: 38px; border-radius: 0.85rem; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); color: white; padding: 0 0.75rem;"
                                            onchange="markSearchFiltersDirty()"
                                        >
                                            <option value="">MPA</option>
                                            <option value="G">G</option>
                                            <option value="PG">PG</option>
                                            <option value="PG-13">PG-13</option>
                                            <option value="R">R</option>
                                            <option value="NC-17">NC-17</option>
                                            <option value="NR">NR / Unrated</option>
                                        </select>
                                        <button type="button" class="btn btn-glass" style="width: 100%; height:38px; padding: 0 0.8rem; border-radius: 0.85rem; font-size: 0.85rem;" onclick="applySearchFilters()">Apply Filters</button>
                                        <button type="button" class="btn btn-glass" style="width: 100%; height:38px; padding: 0 0.8rem; border-radius: 0.85rem; font-size: 0.85rem;" onclick="clearSearchFilters()">Clear</button>
                                    </div>

                                    <!-- Action Slot (fixed space so the search UI doesn't jump) -->
                                    <div id="home-action-slot" style="margin-top: 0.6rem; min-height: 56px;">
                                        <div id="home-action-card" class="glass-panel" style="padding: 1rem; border-radius: 0.75rem;">
                                            <div id="home-action-placeholder" class="text-sm text-gray" style="text-align:center; max-width: 520px; margin: 0 auto;">
                                                Select a movie from the dropdown to log it or update an existing entry.
                                            </div>

                                            <!-- Dynamic Actions (replaces placeholder in the same spot) -->
                                            <div id="movie-actions" class="hidden flex-col gap-4 fade-in">
                                                <div class="flex gap-3">
                                                    <button id="btn-log-new-entry" onclick="router.startNewEntry()" class="btn btn-primary" style="flex:1;">
                                                        ${icons.plusCircle} Log as New Entry
                                                    </button>
                                                    <button id="update-existing-btn" onclick="router.toggleUpdateOptions()" class="btn btn-outline" style="flex:1; border-color: color-mix(in srgb, var(--brand-2) 60%, transparent); background: color-mix(in srgb, var(--brand-2) 30%, transparent);">
                                                        <span style="color: var(--accent-2); width:20px;">${icons.refreshCw}</span> Update Existing
                                                    </button>
                                                </div>

                                                <div id="home-secondary-actions" class="flex gap-3">
                                                    <button id="btn-add-to-list" type="button" onclick="openAddToListModal()" class="btn btn-glass" style="flex:1; border-radius: 0.85rem; min-height: 36px; padding: 0.4rem 0.65rem; font-size: 0.85rem;">
                                                        ${icons.plusCircle} Add to List
                                                    </button>
                                                    <button type="button" onclick="router.navigate('lists')" class="btn btn-outline" style="flex:1; border-radius: 0.85rem; min-height: 36px; padding: 0.4rem 0.65rem; font-size: 0.85rem;">
                                                        ${icons.arrowRight} View Lists
                                                    </button>
                                                    <button id="btn-recommend" type="button" onclick="openRecModalFromHome()" class="btn btn-glass" style="flex:1; border-radius: 0.85rem; min-height: 36px; padding: 0.4rem 0.65rem; font-size: 0.85rem;">
                                                        ${icons.arrowRightCircle} Recommend
                                                    </button>
                                                </div>

                                                <div id="update-options" class="hidden grid-2 gap-3" style="padding: 0; border: 0; background: transparent;">
                                                    <button onclick="router.startUpdateRatings()" class="text-left" style="padding:0.45rem 0.55rem; border-radius:0.5rem; min-height: 36px; transition: background 0.2s; border: 1px solid rgba(168, 85, 247, 0.45); background: rgba(168, 85, 247, 0.10);">
                                                        <span class="text-brand font-semibold mb-2" style="display:block;">Update Ratings &rarr;</span>
                                                        <span class="text-xs text-gray">Edit your review, scores, and tier.</span>
                                                    </button>
                                                    <button onclick="router.quickIncrement()" class="text-left" style="padding:0.45rem 0.55rem; border-radius:0.5rem; min-height: 36px; transition: background 0.2s; border: 1px solid rgba(20, 184, 166, 0.45); background: rgba(20, 184, 166, 0.10);">
                                                        <span class="text-brand font-semibold mb-2" style="display:block;">Quick Watch (+1) &rarr;</span>
                                                        <span class="text-xs text-gray">Simply add a view to your count.</span>
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Marquee (Full Width) -->
                        <div style="background: var(--surface); padding: 1rem 0 2.15rem; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); margin-top: 2.5rem; position: relative; z-index: 1;">
                            <div class="container mb-6">
                                <h2 class="text-white" style="font-size: 2rem; font-weight: 900; letter-spacing: 0.04em; line-height: 1.1; display: inline-flex; align-items: center; gap: 0.55rem; text-shadow: 0 10px 24px rgba(0,0,0,0.45);">
                                    <span style="display:inline-block; width: 0.45rem; height: 1.55rem; border-radius: 999px; background: linear-gradient(180deg, var(--brand), var(--accent-2));"></span>
                                    <span style="background: linear-gradient(to right, #ffffff, color-mix(in srgb, var(--brand) 55%, #ffffff)); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Trending Now</span>
                                </h2>
                            </div>
                            <div class="w-full" style="overflow: hidden; position: relative;">
                                <div class="animate-marquee">
                                    <div class="flex" id="trending-track-1"></div>
                                    <div class="flex" id="trending-track-2"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            },

            renderLists() {
                return `
                    <div class="fade-in">
                        <div class="container" style="padding-top: 2rem; padding-bottom: 3rem; position: relative;">
                            <div class="flex justify-between items-center mb-6" style="gap: 14px; flex-wrap: wrap;">
                                <div class="glass-panel page-title-card">
                                    <h1 class="text-3xl font-bold text-white">Lists</h1>
                                    <p class="text-gray mt-2">Organize your movies into custom lists.</p>
                                </div>
                                <div class="flex" style="gap: 10px; flex-wrap: wrap; align-items: center; justify-content: flex-end;">
                                    <button type="button" class="btn btn-primary" onclick="openListsCreateModal()" style="border-radius: 0.85rem; height: 42px; display:inline-flex; align-items:center;">New List</button>
                                    <div class="glass-panel" style="padding: 0 0.5rem; border-radius: 0.8rem; display:flex; align-items:center; gap: 0.55rem; min-width: 220px; max-width: 260px; height: 42px;">
                                        <div class="text-xs" style="color: rgba(255,255,255,0.78); font-weight: 800; letter-spacing: 0.02em; white-space: nowrap;">Your Lists</div>
                                        <div id="lists-list" class="text-gray" style="flex: 1; min-width: 130px;">
                                            <select id="lists-select" class="input-field" style="width:100%; border-radius: 0.7rem; height: 34px; font-size: 0.84rem; padding: 0 0.65rem;">
                                                <option value="">Loading…</option>
                                            </select>
                                        </div>
                                    </div>
                                    <button type="button" class="btn btn-outline" data-lists-action="refresh" style="border-radius: 0.85rem;">Refresh</button>
                                </div>
                            </div>

                            <div class="glass-panel" style="padding: 1rem; border-radius: 1rem;">
                                    <div class="flex justify-between items-center" style="gap: 10px; flex-wrap: wrap;">
                                        <div>
                                            <div id="lists-active-title" class="text-white font-bold">Select a list</div>
                                            <div id="lists-active-subtitle" class="text-xs text-gray" style="margin-top: 0.25rem;"></div>
                                        </div>

                                        <div class="flex items-center" style="gap: 10px; flex-wrap: wrap; justify-content: flex-end;">
                                            <button
                                                id="lists-filter-btn"
                                                type="button"
                                                class="btn btn-outline"
                                                data-lists-action="open_sort_filter"
                                                style="border-radius: 0.75rem; height: 34px; padding: 0.45rem 0.65rem; font-size: 0.85rem;"
                                                disabled
                                            >Filters/Sort</button>
                                            <button
                                                id="lists-rename-btn"
                                                type="button"
                                                class="btn btn-outline"
                                                data-lists-action="rename_list"
                                                style="border-radius: 0.75rem; height: 34px; padding: 0.45rem 0.65rem; font-size: 0.85rem;"
                                                disabled
                                            >Rename</button>
                                            <button
                                                id="lists-delete-btn"
                                                type="button"
                                                class="btn btn-outline"
                                                data-lists-action="delete_list"
                                                style="border-radius: 0.75rem; height: 34px; padding: 0.45rem 0.65rem; font-size: 0.85rem; border-color: rgba(239,68,68,0.55); background: rgba(239,68,68,0.10);"
                                                disabled
                                            >Delete</button>

                                            <!-- Lists-only Search (adds directly to the active list) -->
                                            <div style="position: relative; width: 260px; max-width: 100%;">
                                                <div class="input-group" style="margin: 0;">
                                                    <div class="input-icon" style="height: 34px; display:flex; align-items:center;">${icons.search}</div>
                                                    <input
                                                        type="text"
                                                        id="lists-movie-search-input"
                                                        oninput="handleListsAddMovieSearch(this.value)"
                                                        autocomplete="off"
                                                        placeholder="Select a list to add movies…"
                                                        class="input-field glass-input"
                                                        style="border-radius: 0.75rem; height: 34px; font-size: 0.85rem; padding-left: 2.35rem;"
                                                        disabled
                                                    >
                                                    <div id="lists-movie-search-results" class="search-dropdown hidden"></div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div id="lists-items" class="text-gray" style="margin-top: 0.85rem;">Choose a list above.</div>
                            </div>
                        </div>
                    </div>
                `;
            },

            renderSubmit() {
                const prefill = this.selectedMovie || {};
                const isUpdate = this.formMode === 'update';
                const uuidLike = isUuidLike;
                const hasDbMovie = uuidLike(prefill?.id);
                const detailsReadonly = hasDbMovie || Boolean(prefill?.detailsReadonly);
                const defaultDate = getLocalISODate();
                const allowEditMissingDetails = detailsReadonly && !hasDbMovie;

                const formAccent = isUpdate
                    ? { color: 'var(--brand-2)', name: 'Update Ratings' }
                    : { color: 'var(--brand)', name: 'Log New Entry' };

                const u = (isUpdate && prefill.mockUserReview) ? prefill.mockUserReview : {
                    date: defaultDate, tier: "", scores: { overall: 50, sound: 50, pace: 50, imagery: 50, acting: 50, plot: 50, dialogue: 50 },
                    quote: "", notes: "", watched: 1,
                    watch_method: 'At Home'
                };

                const scoreDefaults = { overall: 50, sound: 50, pace: 50, imagery: 50, acting: 50, plot: 50, dialogue: 50 };
                const scores = { ...scoreDefaults, ...(u?.scores || {}) };
                const scoreOrder = ['overall', 'sound', 'pace', 'imagery', 'acting', 'plot', 'dialogue'];

                const tierLetter = String(u.tier || '').trim().charAt(0).toUpperCase();

                const tierHelpText = (() => {
                    const t = (['S','A','B','C','D','F'].includes(tierLetter)) ? `${tierLetter}-Tier` : String(u.tier || '').trim();
                    if (t === 'S-Tier') return 'The Pantheon. Best of the Best.';
                    if (t === 'A-Tier') return 'Great! Highly recommended films!';
                    if (t === 'B-Tier') return 'Worth a Watch. Solidly good and Entertaining';
                    if (t === 'C-Tier') return "Totally Average. Fine if it's on, but don't go out of your way.";
                    if (t === 'D-Tier') return 'Skip it. Seriously Flawed and not worth the time.';
                    if (t === 'F-Tier') return 'Avoid at all costs! A genuinely bad experience.';
                    return 'Choose exactly one tier';
                })();
                
                const m = {
                    title: prefill.title || '', genre: prefill.genre || '', year: prefill.year || '', mpa: prefill.mpa || '',
                    runtime: (prefill.runtime === null || prefill.runtime === undefined) ? '' : String(prefill.runtime),
                    // For DB movies, we can display Yes/No but still submit TRUE/FALSE.
                    isSeriesDisplay: (prefill.isSeries === true) ? 'Yes' : ((prefill.isSeries === false) ? 'No' : ''),
                    isSeriesValue: (prefill.isSeries === true) ? 'TRUE' : ((prefill.isSeries === false) ? 'FALSE' : ''),
                    director: prefill.director || '', imdb: prefill.imdb || '',
                    poster_path: prefill.poster_path || prefill.posterPath || prefill.poster_url || prefill.posterUrl || ''
                };

                const posterUrl = (() => {
                    const raw = String(m.poster_path || '').trim();
                    if (!raw) return '';
                    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
                    // TMDb poster_path comes like "/abc.jpg"
                    return `https://image.tmdb.org/t/p/w342${raw}`;
                })();

                const hasText = (v) => {
                    const s = String(v ?? '').trim();
                    if (!s) return false;
                    if (s === '0') return false;
                    return true;
                };
                const hasPositiveInt = (v) => {
                    const n = Number(String(v ?? '').trim());
                    return Number.isFinite(n) && n > 0;
                };

                // Lock only fields that already have meaningful values.
                // This prevents users getting stuck with blank read-only fields while we enforce required inputs.
                const titleLocked = detailsReadonly && hasText(m.title);
                const yearLocked = detailsReadonly && hasPositiveInt(m.year);
                const mpaLocked = detailsReadonly && hasText(m.mpa);
                const runtimeLocked = detailsReadonly && hasPositiveInt(m.runtime);
                const seriesLocked = detailsReadonly && hasText(m.isSeriesValue);
                const directorLocked = detailsReadonly && hasText(m.director);

                // When updating an existing rating, Times Watched should reflect Watch Logs history,
                // and it should not be editable on the form.
                const timesWatchedLocked = isUpdate;

                // When updating an existing rating, Watch Method should not be editable on the form.
                // New watches are recorded via Watch Logs with a separate watch-method prompt.
                const watchMethodLocked = isUpdate;

                const genreLower = String(m.genre || '').trim().toLowerCase();
                const genrePlaceholder = allowEditMissingDetails && (genreLower === 'movie' || genreLower === '0');
                const genreLocked = detailsReadonly && (hasText(m.genre) && !genrePlaceholder);

                const clampPct = (n) => {
                    const v = Number(n);
                    if (!Number.isFinite(v)) return 0;
                    return Math.max(0, Math.min(100, v));
                };

                const parseExternalPercent = (raw, { imdb = false } = {}) => {
                    const s = String(raw ?? '').trim();
                    if (!s) return 0;
                    const num = parseFloat(s.replace('%', ''));
                    if (!Number.isFinite(num)) return 0;
                    let out = num;
                    // Accept a few common forms:
                    // - 83%  -> 83
                    // - 0.83 -> 83
                    // - IMDb 8.7 (/10) -> 87
                    if (num <= 1) out = num * 100;
                    else if (imdb && num <= 10) out = num * 10;
                    return clampPct(Math.round(out));
                };

                const imdbPct = parseExternalPercent(m.imdb, { imdb: true });
                // Only lock IMDb when we actually have a real (non-zero) value.
                // DB movies can legitimately be missing IMDb; do not lock the user out at 0.
                const imdbLocked = detailsReadonly && (imdbPct > 0);

                const selectedGenres = String(m.genre || '')
                    .split(',')
                    .map(s => s.trim())
                    .filter(Boolean);

                const genreOptions = [
                    'Action','Adventure','Animation','Comedy','Crime','Documentary','Drama','Family','Fantasy','History',
                    'Horror','Music','Mystery','Romance','Sci-Fi','TV Movie','Thriller','War','Western'
                ];

                return `
                    <div class="fade-in">
                        <div class="container" style="padding-top: 2rem; padding-bottom: 3rem; position: relative;">
                        <div class="flex items-center gap-4 mb-8">
                            <button onclick="router.goBack()" style="color: var(--text-muted); padding: 0.5rem; border-radius: 50%;">
                                ${icons.arrowLeft}
                            </button>
                            <div class="glass-panel page-title-card">
                                <div class="flex items-center gap-2" style="flex-wrap: wrap;">
                                    <h1 class="text-3xl font-bold text-white">${isUpdate ? 'Update Ratings' : 'Log New Entry'}</h1>
                                    <span style="display:inline-flex; align-items:center; height: 28px; padding: 0 0.75rem; border-radius: 999px; font-size: 0.75rem; font-weight: 900; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(255,255,255,0.95); background: color-mix(in srgb, ${formAccent.color} 16%, transparent); border: 1px solid color-mix(in srgb, ${formAccent.color} 35%, transparent);">
                                        ${formAccent.name}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <form onsubmit="handleFormSubmit(event)" class="grid grid-3 gap-6" style="border: 1px solid color-mix(in srgb, ${formAccent.color} 18%, transparent); border-radius: 1.2rem; padding: 0.75rem; background: rgba(0,0,0,0.12);">
                            <input type="hidden" name="entryType" value="${isUpdate ? 'update' : 'new'}">
                            <input type="hidden" id="fld-movie-id" value="${hasDbMovie ? String(prefill.id) : ''}">
                            <input type="hidden" id="fld-tmdb-id" value="${Number.isFinite(Number(prefill?.tmdb_id)) ? String(Number(prefill.tmdb_id)) : ''}">
                            <!-- Read Only Section -->
                            <div class="glass-panel" style="padding: 1.5rem; border-radius: 1rem; background: color-mix(in srgb, ${formAccent.color} 10%, transparent); border: 1px solid color-mix(in srgb, ${formAccent.color} 22%, transparent);">
                                <div class="flex items-center gap-3 mb-4">
                                    <span style="color: ${formAccent.color};">${icons.database}</span>
                                    <h2 class="text-xl font-semibold text-white">Movie Details</h2>
                                </div>
                                <div style="background: color-mix(in srgb, var(--brand) 12%, transparent); border: 1px solid color-mix(in srgb, var(--brand) 22%, transparent); padding: 0.75rem; border-radius: 0.5rem; margin-bottom: 1.5rem;" class="text-sm flex items-center gap-2">
                                    <span style="width:16px;">${icons.info}</span>
                                    <span style="color: var(--text-main);">${hasDbMovie ? 'Auto-filled from DB' : (allowEditMissingDetails ? 'Auto-filled from TMDb (edit any missing fields)' : 'Auto-filled from TMDb')}</span>
                                </div>

                                ${posterUrl ? `
                                    <div style="display:flex; justify-content:center; margin-bottom: 1.25rem;">
                                        <img
                                            src="${posterUrl}"
                                            alt="${escapeHtml(m.title || 'Movie poster')}"
                                            style="width: 180px; aspect-ratio: 2 / 3; object-fit: cover; border-radius: 0.9rem; border: 1px solid rgba(255,255,255,0.12); box-shadow: 0 16px 40px rgba(0,0,0,0.35);"
                                            loading="lazy"
                                            onerror="this.onerror=null; this.parentElement.remove();"
                                        >
                                    </div>
                                ` : ''}

                                <div class="flex flex-col gap-4">
                                    <div><label class="text-sm text-white font-bold mb-2 label-gap submit-label block capitalize">Title</label><input id="fld-title" name="Title" class="input-field ${titleLocked ? 'input-readonly' : ''}" value="${m.title}" ${titleLocked ? 'readonly' : ''} ${(titleLocked && hasText(m.title)) ? '' : 'required'} placeholder="Type a movie title"></div>
                                    <div class="grid grid-2 gap-4">
                                        <div>
                                            <label class="text-sm text-white font-bold mb-2 label-gap submit-label block capitalize">Year</label>
                                            <input
                                                id="fld-year"
                                                name="Year"
                                                type="number"
                                                inputmode="numeric"
                                                step="1"
                                                class="input-field ${yearLocked ? 'input-readonly' : ''}"
                                                value="${m.year}"
                                                ${yearLocked ? 'readonly' : ''}
                                                placeholder="e.g. 2024"
                                            >
                                        </div>
                                        <div>
                                            <label class="text-sm text-white font-bold mb-2 label-gap submit-label block capitalize">MPA</label>
                                            ${mpaLocked ? `
                                                <input id="fld-mpa" name="MPA" class="input-field input-readonly" value="${m.mpa}" readonly>
                                            ` : `
                                                <select id="fld-mpa" name="MPA" class="select-field" required>
                                                    <option value="" disabled ${!String(m.mpa || '').trim() ? 'selected' : ''}>Select...</option>
                                                    <option value="G" ${String(m.mpa).trim() === 'G' ? 'selected' : ''}>G</option>
                                                    <option value="PG" ${String(m.mpa).trim() === 'PG' ? 'selected' : ''}>PG</option>
                                                    <option value="PG-13" ${String(m.mpa).trim() === 'PG-13' ? 'selected' : ''}>PG-13</option>
                                                    <option value="R" ${String(m.mpa).trim() === 'R' ? 'selected' : ''}>R</option>
                                                    <option value="NC-17" ${String(m.mpa).trim() === 'NC-17' ? 'selected' : ''}>NC-17</option>
                                                </select>
                                            `}
                                        </div>
                                    </div>
                                    <div class="grid grid-2 gap-4">
                                        <div>
                                            <label class="text-sm text-white font-bold mb-2 label-gap submit-label block capitalize">Runtime (min)</label>
                                            ${runtimeLocked ? `
                                                <input id="fld-runtime" name="Run Time" type="number" inputmode="numeric" step="1" class="input-field input-readonly" value="${m.runtime}" readonly>
                                            ` : `
                                                <input
                                                    id="fld-runtime"
                                                    name="Run Time"
                                                    type="number"
                                                    inputmode="numeric"
                                                    step="1"
                                                    min="0"
                                                    autocomplete="off"
                                                    class="input-field"
                                                    value="${m.runtime}"
                                                    placeholder="Minutes"
                                                >
                                            `}
                                        </div>
                                        <div>
                                            <label class="text-sm text-white font-bold mb-2 label-gap submit-label block capitalize">Series?</label>
                                            ${seriesLocked ? `
                                                <input id="fld-series-display" class="input-field input-readonly" value="${m.isSeriesDisplay}" readonly>
                                                <input type="hidden" id="fld-series" name="Series" value="${m.isSeriesValue}">
                                            ` : `
                                                <select id="fld-series" name="Series" class="select-field">
                                                    <option value="" disabled ${!String(m.isSeriesValue || '').trim() ? 'selected' : ''}>Select...</option>
                                                    <option value="TRUE" ${String(m.isSeriesValue).trim() === 'TRUE' ? 'selected' : ''}>Yes</option>
                                                    <option value="FALSE" ${String(m.isSeriesValue).trim() === 'FALSE' ? 'selected' : ''}>No</option>
                                                </select>
                                            `}
                                        </div>
                                    </div>
                                    <div><label class="text-sm text-white font-bold mb-2 label-gap submit-label block capitalize">Director</label><input id="fld-director" name="Director" class="input-field ${directorLocked ? 'input-readonly' : ''}" value="${m.director}" ${directorLocked ? 'readonly' : ''}></div>
                                    <div>
                                        <label class="text-sm text-white font-bold mb-2 label-gap submit-label block capitalize">Genre</label>
                                        ${genreLocked ? `
                                            <input id="fld-genre" name="Genre" class="input-field input-readonly" value="${m.genre}" readonly>
                                        ` : `
                                            <input type="hidden" id="fld-genre" name="Genre" value="${selectedGenres.join(', ')}">
                                            <div id="genre-chip-wrap" class="genre-chip-wrap">
                                                ${genreOptions.map(g => `
                                                    <button
                                                        type="button"
                                                        class="genre-chip ${selectedGenres.includes(g) ? 'selected' : ''}"
                                                        data-genre="${g}"
                                                        aria-pressed="${selectedGenres.includes(g) ? 'true' : 'false'}"
                                                        onclick="toggleGenreChip(this)"
                                                    >${g}</button>
                                                `).join('')}
                                            </div>
                                            <div class="text-xs text-gray" style="margin-top:0.5rem;">Select any genres that apply</div>
                                        `}
                                    </div>

                                    <div style="border-top: 1px solid rgba(255,255,255,0.05); padding-top: 1rem; margin-top: 0.5rem;">
                                        <label class="text-sm text-white font-bold mb-2 label-gap submit-label block capitalize">External Ratings</label>
                                        <div class="flex flex-col gap-4">
                                            <div>
                                                <label class="text-xs text-gray submit-label block" style="margin-bottom: 0.25rem;">IMDb Rating</label>
                                                <div class="slider-container">
                                                    <input
                                                        id="fld-imdb-range"
                                                        type="range"
                                                        min="0"
                                                        max="100"
                                                        value="${imdbPct}"
                                                        ${imdbLocked ? 'disabled' : ''}
                                                        ${imdbLocked ? '' : "oninput=\"document.getElementById('fld-imdb').value = this.value\""}
                                                    >
                                                    <div class="relative" style="width: 140px;">
                                                        <input
                                                            type="number"
                                                            id="fld-imdb"
                                                            name="IMDb"
                                                            value="${imdbPct}"
                                                            min="0"
                                                            max="100"
                                                            class="input-field text-center ${imdbLocked ? 'input-readonly' : ''}"
                                                            ${imdbLocked ? 'readonly' : ''}
                                                            ${imdbLocked ? '' : "oninput=\"document.getElementById('fld-imdb-range').value = this.value\""}
                                                        >
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- User Input Section -->
                            <div class="glass-panel col-span-2" style="padding: 2rem; padding-bottom: calc(2rem - 10px); border-radius: 1rem; border: 1px solid rgba(${formAccent.rgb}, 0.14);">
                                <div class="flex justify-between items-center mb-6" style="border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 5px; margin-bottom: 10px;">
                                    <div class="flex items-center gap-3">
                                        <span style="color: ${formAccent.hex};">${icons.edit3}</span>
                                        <h2 class="text-xl font-semibold text-white">Your Review</h2>
                                    </div>
                                </div>

                                <div class="grid md-row gap-6 mb-6" style="margin-top: 0px;">
                                    ${isUpdate ? `<div style="flex:1;">
                                        <label class="text-sm text-white font-bold mb-2 label-gap submit-label block capitalize">Date Watched</label>
                                        <input id="fld-datewatch" name="Date Watch" type="date" class="input-field input-readonly" value="${u.date}" readonly title="Locked while updating" onclick="openDatePickerFromInput(this)" onfocus="openDatePickerFromInput(this)" required>
                                    </div>` : ''}
                                    <div style="flex:1;">
                                        <label class="text-sm text-white font-bold mb-2 label-gap submit-label block capitalize">Tier List</label>
                                        <input type="hidden" id="fld-tier" name="Tier List" value="${(['S','A','B','C','D','F'].includes(tierLetter) ? `${tierLetter}-Tier` : String(u.tier || ''))}">
                                        <div class="tier-btn-group" style="margin-top: 0.35rem;" data-target-input="fld-tier" data-has-selection="${String(u.tier || '').trim() ? 'true' : 'false'}">
                                            <button type="button" class="tier-btn ${tierLetter === 'S' ? 'selected' : ''}" data-tier="S-Tier" aria-pressed="${tierLetter === 'S' ? 'true' : 'false'}" onclick="setTierFromButton(this)">S</button>
                                            <button type="button" class="tier-btn ${tierLetter === 'A' ? 'selected' : ''}" data-tier="A-Tier" aria-pressed="${tierLetter === 'A' ? 'true' : 'false'}" onclick="setTierFromButton(this)">A</button>
                                            <button type="button" class="tier-btn ${tierLetter === 'B' ? 'selected' : ''}" data-tier="B-Tier" aria-pressed="${tierLetter === 'B' ? 'true' : 'false'}" onclick="setTierFromButton(this)">B</button>
                                            <button type="button" class="tier-btn ${tierLetter === 'C' ? 'selected' : ''}" data-tier="C-Tier" aria-pressed="${tierLetter === 'C' ? 'true' : 'false'}" onclick="setTierFromButton(this)">C</button>
                                            <button type="button" class="tier-btn ${tierLetter === 'D' ? 'selected' : ''}" data-tier="D-Tier" aria-pressed="${tierLetter === 'D' ? 'true' : 'false'}" onclick="setTierFromButton(this)">D</button>
                                            <button type="button" class="tier-btn ${tierLetter === 'F' ? 'selected' : ''}" data-tier="F-Tier" aria-pressed="${tierLetter === 'F' ? 'true' : 'false'}" onclick="setTierFromButton(this)">F</button>
                                        </div>
                                        <div class="text-xs text-gray" id="tier-help-text" style="margin-top: 0.4rem;">${tierHelpText}</div>
                                    </div>
                                </div>

                                <div class="mb-8">
                                    <h3 class="text-sm font-bold text-white uppercase mb-4 label-gap">Detailed Scoring (%)</h3>
                                    <div class="grid grid-2 gap-6">
                                        ${scoreOrder.map(key => `
                                            <div style="${key === 'overall' ? 'grid-column: span 2; padding: 1rem; border-radius: 0.75rem; background: var(--brand-light); border: 1px solid rgba(20,184,166,0.22);' : ''}">
                                                <label class="text-sm ${key === 'overall' ? 'text-white' : 'text-white'} font-bold mb-2 label-gap submit-label block capitalize" style="${key === 'overall' ? 'display:flex; align-items:center; gap:0.5rem;' : ''}">${key === 'overall' ? `<span class=\"text-brand\">${icons.star}</span><span>Overall</span>` : key === 'sound' ? 'Score - Sound Design' : key === 'imagery' ? 'Imagery - CGI - Animation' : key === 'acting' ? 'Acting - Character Animation' : key}</label>
                                                <div class="slider-container">
                                                    <input type="range" min="0" max="100" value="${scores[key]}" oninput="document.getElementById('num-${key}').value = this.value">
                                                    <div class="relative" style="width: 140px;">
                                                        <input
                                                            type="number"
                                                            id="num-${key}"
                                                            name="${key === 'overall' ? 'Overall' : key === 'sound' ? 'Score - Sound Design' : key === 'pace' ? 'Pace' : key === 'imagery' ? 'Imagery - CGI - Animation' : key === 'plot' ? 'Plot - Writting' : key === 'acting' ? 'Acting - Character Animation' : key === 'dialogue' ? 'Dialogue' : key}"
                                                            value="${scores[key]}"
                                                            min="0"
                                                            max="100"
                                                            class="input-field text-center ${key === 'overall' ? 'font-bold' : ''}"
                                                            oninput="this.parentElement.previousElementSibling.value = this.value"
                                                        >
                                                    </div>
                                                </div>
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>

                                <div class="flex flex-col gap-6" style="margin-bottom: 0px;">
                                    <div>
                                        <label class="text-sm text-white font-bold mb-2 label-gap submit-label block capitalize">Favorite Quote</label>
                                        <div class="relative">
                                            <div class="input-icon">${icons.quote}</div>
                                            <input id="fld-quote" name="Fav Quote" type="text" class="input-field" style="padding-left: 2.5rem;" value="${escapeHtml(u.quote)}" placeholder="One liner...">
                                        </div>
                                    </div>
                                    <div>
                                        <label class="text-sm text-white font-bold mb-2 label-gap submit-label block capitalize">Notes / Review</label>
                                        <textarea id="fld-notes" name="Notes" class="textarea-field" rows="4" placeholder="Review...">${u.notes}</textarea>
                                    </div>
                                        ${isUpdate ? `<div class="grid grid-2 gap-6">
                                            <div class="flex items-center justify-start" style="gap: 25px;">
                                                <span class="text-sm text-white font-bold label-gap capitalize">Times Watched</span>
                                                <input id="fld-timeswatch" name="Times Watch" type="number" min="1" value="${u.watched}" class="input-field text-center ${timesWatchedLocked ? 'input-readonly' : ''}" style="width: 100px; height: 42px;" ${timesWatchedLocked ? 'readonly' : ''}>
                                            </div>
                                            <div class="flex items-center justify-start" style="gap: 25px;">
                                                <span class="text-sm text-white font-bold label-gap capitalize">Watch Method</span>
                                                <button
                                                    type="button"
                                                    id="watchmethod-toggle"
                                                    class="input-field ${watchMethodLocked ? 'input-readonly' : ''}"
                                                    style="width: 110px; height: 42px; display:flex; align-items:center; justify-content:center; padding:0; background-color: ${String(u.watch_method || 'At Home').toLowerCase().includes('theater') ? 'rgba(20, 184, 166, 0.35)' : 'rgba(168, 85, 247, 0.35)'}; color: white; border-color: ${String(u.watch_method || 'At Home').toLowerCase().includes('theater') ? 'rgba(20, 184, 166, 0.5)' : 'rgba(168, 85, 247, 0.5)'};"
                                                    ${watchMethodLocked ? 'disabled title="Locked while updating"' : 'onclick="toggleWatchMethod(this)"'}
                                                >
                                                    ${String(u.watch_method || 'At Home').toLowerCase().includes('theater') ? 'In Theater' : 'At Home'}
                                                </button>
                                                <input type="hidden" id="fld-watchmethod" name="Watch Method" value="${String(u.watch_method || 'At Home').toLowerCase().includes('theater') ? 'In Theater' : 'At Home'}">
                                            </div>
                                        </div>` : ''}
                                </div>

                                <div class="flex" style="border-top: 1px solid rgba(255,255,255,0.05); margin-top: 15px; padding-top: 15px; justify-content: ${isUpdate ? 'space-between' : 'center'}; gap: 10px; flex-wrap: wrap;">
                                    ${isUpdate ? `
                                        <button id="btn-delete-rating" type="button" class="btn btn-outline" style="margin-top: 0px; border-radius: 0.85rem; border-color: rgba(239,68,68,0.55); color: rgba(239,68,68,0.95); background: rgba(239,68,68,0.10);" onclick="openDeleteRatingModal()">
                                            Delete
                                        </button>
                                    ` : ''}
                                    <button id="btn-save-diary" type="submit" class="btn btn-primary" style="margin-top: 0px; opacity: 0.6;" aria-disabled="true" title="Please log in first.">
                                        ${icons.save} Save to Diary
                                    </button>
                                </div>
                            </div>
                        </form>
                        </div>
                    </div>
                `;
            },

            renderDashboard() {
                return `
                    <div class="fade-in">
                        <div class="container" style="padding-top: 2rem; position: relative;">
                        <div class="dash-dashboard-head flex justify-between items-center" style="gap: 10px; flex-wrap: wrap;">
                            <div class="glass-panel page-title-card">
                                <h1 class="text-3xl font-bold text-white">Data Dashboard</h1>
                                <p class="text-gray mt-2">Insights into your viewing habits.</p>
                            </div>

                            <!-- Tabs (moved up) -->
                            <div class="glass-panel" style="padding: 0.55rem; border-radius: 0.9rem;">
                                <div class="flex" style="gap: 10px; flex-wrap: wrap; justify-content: flex-end;">
                                    <button type="button" class="btn dash-pill-btn btn-glass" id="dash-tab-general" data-tab="general" style="padding: 0.6rem 0.9rem;">General</button>
                                    <button type="button" class="btn dash-pill-btn btn-outline" id="dash-tab-ratings" data-tab="ratings" style="padding: 0.6rem 0.9rem;">Ratings</button>
                                    <button type="button" class="btn dash-pill-btn btn-outline" id="dash-tab-tiers" data-tab="tiers" style="padding: 0.6rem 0.9rem;">Tiers</button>
                                    <button type="button" class="btn dash-pill-btn btn-outline" id="dash-tab-favorites" data-tab="favorites" style="padding: 0.6rem 0.9rem;">Favorites</button>
                                    <button type="button" class="btn dash-pill-btn btn-outline" id="dash-tab-charts" data-tab="charts" style="padding: 0.6rem 0.9rem;">Activity</button>
                                    <button type="button" class="btn dash-pill-btn btn-outline" id="dash-tab-quotes" data-tab="quotes" style="padding: 0.6rem 0.9rem;">Quote Wall</button>
                                </div>
                            </div>
                        </div>

                        <!-- Timeframe (shown for all tabs) -->
                        <div class="dash-dashboard-row" style="display:flex; gap: 16px; align-items: flex-start; justify-content: space-between; flex-wrap: nowrap; margin-bottom: 1.25rem;">
                            <div style="display:flex; gap: 12px; align-items: flex-start; flex-wrap: nowrap;">
                                <div class="glass-panel" style="padding: 0.55rem 0.75rem; border-radius: 0.9rem; flex: 0 0 auto;">
                                    <div class="text-xs text-gray" style="margin-bottom: 0.4rem;">Timeframe</div>
                                    <div class="flex" style="gap: 10px; flex-wrap: wrap;">
                                        <button type="button" class="btn dash-pill-btn btn-glass" id="dash-range-all-time" data-range="all_time" style="padding: 0.55rem 0.85rem;">All Time</button>
                                        <button type="button" class="btn dash-pill-btn btn-outline" id="dash-range-this-year" data-range="this_year" style="padding: 0.55rem 0.85rem;">This Year</button>
                                        <button type="button" class="btn dash-pill-btn btn-outline" id="dash-range-this-month" data-range="this_month" style="padding: 0.55rem 0.85rem;">This Month</button>
                                    </div>
                                </div>

                                <div id="dash-general-mode-panel" class="glass-panel hidden" style="padding: 0.55rem 0.75rem; border-radius: 0.9rem; flex: 0 0 auto;">
                                    <div class="text-xs text-gray" style="margin-bottom: 0.4rem;">Counts</div>
                                    <div id="dash-general-mode-wrap" class="flex" style="gap: 10px; flex-wrap: wrap;">
                                        <button type="button" class="btn dash-pill-btn btn-glass" data-mode="total" id="dash-general-mode-total" style="padding: 0.55rem 0.85rem;">Total Watches</button>
                                        <button type="button" class="btn dash-pill-btn btn-outline" data-mode="unique" id="dash-general-mode-unique" style="padding: 0.55rem 0.85rem;">Unique Movies</button>
                                    </div>
                                </div>

                            </div>

                            <div style="display:flex; gap: 12px; align-items: flex-start; flex-wrap: nowrap;">
                                <!-- Favorites-only: Rank By controls (shown only when Favorites tab active) -->
                                <div id="dash-fav-metric-panel" class="glass-panel hidden" style="padding: 0.55rem 0.75rem; border-radius: 0.9rem; flex: 0 0 auto;">
                                    <div class="text-xs text-gray" style="margin-bottom: 0.4rem;">Rank by</div>
                                    <div id="dash-fav-metric-wrap" class="flex" style="gap: 10px; flex-wrap: wrap;">
                                        <button type="button" class="btn dash-pill-btn btn-glass" data-metric="overall" id="dash-fav-metric-overall" style="padding: 0.55rem 0.85rem;">Overall</button>
                                        <button type="button" class="btn dash-pill-btn btn-outline" data-metric="sound" id="dash-fav-metric-sound" style="padding: 0.55rem 0.85rem;">Sound</button>
                                        <button type="button" class="btn dash-pill-btn btn-outline" data-metric="plot" id="dash-fav-metric-plot" style="padding: 0.55rem 0.85rem;">Plot</button>
                                        <button type="button" class="btn dash-pill-btn btn-outline" data-metric="pace" id="dash-fav-metric-pace" style="padding: 0.55rem 0.85rem;">Pace</button>
                                        <button type="button" class="btn dash-pill-btn btn-outline" data-metric="acting" id="dash-fav-metric-acting" style="padding: 0.55rem 0.85rem;">Acting</button>
                                        <button type="button" class="btn dash-pill-btn btn-outline" data-metric="imagery" id="dash-fav-metric-imagery" style="padding: 0.55rem 0.85rem;">Imagery</button>
                                        <button type="button" class="btn dash-pill-btn btn-outline" data-metric="dialogue" id="dash-fav-metric-dialogue" style="padding: 0.55rem 0.85rem;">Dialogue</button>
                                    </div>
                                </div>

                            </div>
                        </div>

                        <!-- Tab: General -->
                        <div id="dash-pane-general" class="dash-pane-wrap">
                            <div class="dash-gen-top">
                                <div class="glass-panel dash-kpi-chart dash-general-pie-card">
                                    <div class="dash-kpi-header-row">
                                        <div class="dash-kpi-chart-title" id="dash-general-pie-title">MPA Share</div>
                                        <div class="dash-general-pie-toggle" id="dash-general-pie-toggle">
                                            <button type="button" class="btn dash-pill-btn btn-glass" data-pie="mpa" style="padding: 0.45rem 0.7rem;">MPA</button>
                                            <button type="button" class="btn dash-pill-btn btn-outline" data-pie="decade" style="padding: 0.45rem 0.7rem;">Decade</button>
                                            <button type="button" class="btn dash-pill-btn btn-outline" data-pie="genre" style="padding: 0.45rem 0.7rem;">Genre</button>
                                        </div>
                                    </div>
                                    <div class="dash-pie-row">
                                        <div class="dash-pie" id="dash-general-share-pie">
                                            <div class="dash-pie-center">
                                                <div class="dash-pie-value tabular-nums" id="dash-general-watch-events-total">—</div>
                                                <div class="dash-pie-label" id="dash-general-watch-label">Watches</div>
                                                <div class="dash-pie-value-sm tabular-nums" id="dash-general-hours-watched">—</div>
                                                <div class="dash-pie-label" id="dash-general-hours-label">Hours</div>
                                            </div>
                                        </div>
                                        <div class="dash-pie-legend" id="dash-general-share-legend"></div>
                                    </div>
                                </div>
                                <div class="glass-panel dash-kpi-chart dash-watch-method-card">
                                    <div class="dash-kpi-chart-title">Watch Method</div>
                                    <div class="dash-stack-bar" aria-hidden="true">
                                        <div class="dash-stack-fill is-home" id="dash-general-stack-home"></div>
                                        <div class="dash-stack-fill is-theater" id="dash-general-stack-theater"></div>
                                    </div>
                                    <div class="dash-vertical-labels">
                                        <div class="dash-kpi-clickable" data-watch-method="At Home" role="button" tabindex="0">
                                            <div class="dash-highlight-label dash-watch-label dash-watch-home">At home</div>
                                            <div class="dash-highlight-name tabular-nums dash-watch-value" id="dash-general-at-home-watches">—</div>
                                            <div class="dash-highlight-count dash-watch-count" id="dash-general-at-home-label">Watch events</div>
                                        </div>
                                        <div class="dash-kpi-clickable" data-watch-method="In Theater" role="button" tabindex="0">
                                            <div class="dash-highlight-label dash-watch-label dash-watch-theater">In theater</div>
                                            <div class="dash-highlight-name tabular-nums dash-watch-value" id="dash-general-in-theater-watches">—</div>
                                            <div class="dash-highlight-count dash-watch-count" id="dash-general-in-theater-label">Watch events</div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div class="dash-gen-bottom">
                                <div class="glass-panel dash-kpi-chart dash-highlight-combined">
                                    <div class="dash-kpi-chart-title">Most Watched</div>
                                    <div class="dash-highlight-combined-grid">
                                        <div class="dash-highlight-card dash-kpi-clickable" data-general-kpi="most_watched_director">
                                            <div class="dash-highlight-card-title">Director(s)</div>
                                            <div class="dash-person-card">
                                                <div class="dash-kpi-top-count tabular-nums" id="dash-general-top-director-events-count">&nbsp;</div>
                                                <div class="dash-person-poster is-empty">
                                                    <img id="dash-general-top-director-avatar" alt="Top director" loading="lazy" onerror="this.removeAttribute('src'); this.closest('.dash-person-poster')?.classList.add('is-empty');">
                                                </div>
                                                <div class="dash-person-name" id="dash-general-top-director-events">—</div>
                                                <div class="dash-person-count tabular-nums" id="dash-general-top-director-avg">&nbsp;</div>
                                            </div>
                                            <div class="dash-kpi-more" id="dash-general-top-director-more"></div>
                                        </div>
                                        <div class="dash-highlight-card dash-kpi-clickable" data-general-kpi="most_watched_movie">
                                            <div class="dash-highlight-card-title">Movie(s)</div>
                                            <div class="dash-most-movie-grid" id="dash-general-top-movie-grid">
                                                <div class="text-gray">Loading…</div>
                                            </div>
                                        </div>
                                        <div class="dash-highlight-card dash-kpi-clickable" data-general-kpi="most_watched_actor">
                                            <div class="dash-highlight-card-title">Actor(s)</div>
                                            <div class="dash-person-card">
                                                <div class="dash-kpi-top-count tabular-nums" id="dash-general-top-actor-events-count">&nbsp;</div>
                                                <div class="dash-person-poster is-empty">
                                                    <img id="dash-general-top-actor-avatar" alt="Top actor" loading="lazy" onerror="this.removeAttribute('src'); this.closest('.dash-person-poster')?.classList.add('is-empty');">
                                                </div>
                                                <div class="dash-person-name" id="dash-general-top-actor-events">—</div>
                                                <div class="dash-person-count tabular-nums" id="dash-general-top-actor-avg">&nbsp;</div>
                                            </div>
                                            <div class="dash-kpi-more" id="dash-general-top-actor-more"></div>
                                        </div>
                                    </div>
                                </div>

                            </div>
                        </div>

                        <!-- Tab: Ratings -->
                        <div id="dash-pane-ratings" class="dash-pane-wrap hidden">
                            <div class="glass-panel dash-kpi-chart dash-genre-full" style="margin-bottom: 1rem;">
                                <div class="dash-kpi-header-row" style="align-items: flex-start;">
                                    <div>
                                        <div class="dash-kpi-chart-title" id="dash-ratings-chart-title">Average Rating by Genre</div>
                                        <div class="text-xs text-gray" id="dash-ratings-genre-meta"></div>
                                    </div>
                                    <div id="dash-ratings-chart-tab-wrap" class="flex" style="gap: 10px; flex-wrap: wrap; justify-content: flex-end;">
                                        <button type="button" class="btn dash-pill-btn btn-glass" data-chart="genre" id="dash-ratings-tab-genre" style="padding: 0.45rem 0.7rem;">Genre</button>
                                        <button type="button" class="btn dash-pill-btn btn-outline" data-chart="decade" id="dash-ratings-tab-decade" style="padding: 0.45rem 0.7rem;">Decade</button>
                                        <button type="button" class="btn dash-pill-btn btn-outline" data-chart="mpa" id="dash-ratings-tab-mpa" style="padding: 0.45rem 0.7rem;">MPA</button>
                                    </div>
                                </div>
                                <div id="dash-ratings-genre-bars" class="dash-chart-scroll text-gray">Loading…</div>
                            </div>

                            <div class="glass-panel dash-kpi-chart" style="margin-bottom: 1rem;">
                                <div class="dash-kpi-chart-title">Average Ratings</div>
                                <div class="dash-ratings-avg-grid" id="dash-ratings-avg-grid">
                                    <div class="text-gray">Loading…</div>
                                </div>
                            </div>

                            <div class="glass-panel dash-kpi-chart">
                                <div class="dash-kpi-chart-title">Director Ratings</div>
                                <div class="dash-ratings-directors-grid">
                                    <div class="dash-highlight-card dash-kpi-clickable" data-ratings-kpi="ratings_highest_director">
                                        <div class="dash-highlight-card-title">Highest Rated</div>
                                        <div class="dash-person-card">
                                            <div class="dash-person-poster is-empty">
                                                <img id="dash-ratings-top-director-avatar" alt="Highest rated director" loading="lazy" onerror="this.removeAttribute('src'); this.closest('.dash-person-poster')?.classList.add('is-empty');">
                                            </div>
                                            <div class="dash-person-name" id="dash-ratings-top-director">—</div>
                                            <div class="dash-person-count tabular-nums" id="dash-ratings-top-director-meta">&nbsp;</div>
                                        </div>
                                    </div>
                                    <div class="dash-highlight-card dash-kpi-clickable" data-ratings-kpi="ratings_lowest_director">
                                        <div class="dash-highlight-card-title">Lowest Rated</div>
                                        <div class="dash-person-card">
                                            <div class="dash-person-poster is-empty">
                                                <img id="dash-ratings-bottom-director-avatar" alt="Lowest rated director" loading="lazy" onerror="this.removeAttribute('src'); this.closest('.dash-person-poster')?.classList.add('is-empty');">
                                            </div>
                                            <div class="dash-person-name" id="dash-ratings-bottom-director">—</div>
                                            <div class="dash-person-count tabular-nums" id="dash-ratings-bottom-director-meta">&nbsp;</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Tab: Tiers (placeholder for now) -->
                        <div id="dash-pane-tiers" class="dash-pane-wrap hidden">
                            <div class="glass-panel" style="padding:1.5rem; border-radius:0.75rem; margin-bottom: 1.25rem;">
                                <div class="flex justify-between mb-4">
                                    <span class="text-gray text-sm">Tier Distribution</span>
                                    <span class="text-brand">${icons.pieChart}</span>
                                </div>
                                <div id="dash-tiers-bars"></div>
                            </div>

                            <div class="glass-panel" style="padding:1.5rem; border-radius:0.75rem;">
                                <div class="flex justify-between mb-4">
                                    <span class="text-gray text-sm">Movies By Tier</span>
                                    <span class="text-brand">${icons.film}</span>
                                </div>
                                <div id="dash-tiers-lists"></div>
                            </div>
                        </div>

                        <!-- Tab: Favorites -->
                        <div id="dash-pane-favorites" class="dash-pane-wrap hidden">
                            <div class="glass-panel" style="padding:1.5rem; border-radius:0.75rem; margin-bottom: 1.25rem;">
                                <div class="flex justify-between mb-4">
                                    <span id="dash-fav-top-label" style="font-size: 1.05rem; font-weight: 700; color: #34d399;">Top 5</span>
                                    <div style="display:flex; align-items:center; gap: 8px;">
                                        <button type="button" class="btn btn-outline" id="dash-fav-limit-toggle-top" style="padding: 0.35rem 0.6rem; border-radius: 0.75rem;">Show 10</button>
                                        <span style="color: #34d399;">${icons.trendingUp}</span>
                                    </div>
                                </div>
                                <div id="dash-fav-top"></div>
                            </div>

                            <div class="glass-panel" style="padding:1.5rem; border-radius:0.75rem;">
                                <div class="flex justify-between mb-4">
                                    <span id="dash-fav-bottom-label" style="font-size: 1.05rem; font-weight: 700; color: #fb7185;">Bottom 5</span>
                                    <div style="display:flex; align-items:center; gap: 8px;">
                                        <button type="button" class="btn btn-outline" id="dash-fav-limit-toggle-bottom" style="padding: 0.35rem 0.6rem; border-radius: 0.75rem;">Show 10</button>
                                        <span style="color: #fb7185;">${icons.trendingDown}</span>
                                    </div>
                                </div>
                                <div id="dash-fav-bottom"></div>
                            </div>
                        </div>

                        <!-- Tab: Activity -->
                        <div id="dash-pane-charts" class="dash-pane-wrap hidden">
                            <div class="glass-panel dash-chart-card dash-chart-stage">
                                <div class="dash-chart-header">
                                    <div id="dash-chart-title" class="dash-chart-title">Watch Activity</div>
                                </div>
                                <div id="dash-chart-body" class="dash-chart-body text-gray">Loading…</div>
                            </div>
                        </div>

                        <!-- Tab: Quote Wall -->
                        <div id="dash-pane-quotes" class="dash-pane-wrap hidden">
                            <div class="glass-panel" style="padding:1.5rem; border-radius:0.95rem;">
                                <div class="flex justify-between mb-4" style="gap: 14px; align-items: flex-start; flex-wrap: wrap;">
                                    <div>
                                        <div class="text-white" style="font-size: 1.1rem; font-weight: 800;">Quote Wall</div>
                                        <div class="text-xs text-gray" style="margin-top: 0.35rem;">Top quotes (max 50), ranked by Overall rating. Click a card to jump to Update Ratings.</div>
                                    </div>
                                    <div class="text-xs text-gray" id="dash-quote-wall-meta" style="text-align:right;"></div>
                                </div>
                                <div id="dash-quote-wall" class="text-gray">Loading…</div>
                            </div>
                        </div>

                        </div>
                    </div>
                `;
            },

            renderFeed() {
                return `
                    <div class="fade-in">
                        <div class="container" style="padding-top: 2rem; padding-bottom: 3rem; position: relative;">
                            <div class="flex justify-between items-center mb-6" style="gap: 14px; flex-wrap: wrap;">
                                <div class="glass-panel page-title-card">
                                    <h1 class="text-3xl font-bold text-white">Feed</h1>
                                    <p class="text-gray mt-2">New and updated ratings from people you follow.</p>
                                </div>
                            </div>

                            <div class="grid" style="grid-template-columns: 1.2fr 0.8fr; gap: 16px; align-items: start;">
                                <div class="glass-panel" style="padding: 1rem; border-radius: 1rem;">
                                    <div class="flex justify-between items-center" style="gap: 12px; flex-wrap: wrap;">
                                        <div>
                                            <div class="text-white font-bold">Following Activity</div>
                                            <div id="feed-meta" class="text-xs text-gray" style="margin-top: 0.25rem;"></div>
                                        </div>
                                        <div style="display:flex; gap: 8px; flex-wrap: wrap; align-items: center; justify-content: flex-end;">
                                            <button id="feed-filter-btn" type="button" class="btn btn-outline feed-sort-btn" data-feed-action="open_filter" style="padding: 0.55rem 0.8rem; border-radius: 0.85rem;">Filter</button>
                                            <button id="feed-refresh" type="button" class="btn btn-outline" data-feed-action="refresh" style="padding: 0.55rem 0.8rem; border-radius: 0.85rem;">Refresh</button>
                                        </div>
                                    </div>

                                    <div id="feed-list" style="margin-top: 0.9rem; display: grid; gap: 12px;"></div>
                                </div>

                                <button id="feed-jump-new-btn" type="button" class="feed-jump-new-btn" onclick="jumpToNewFeed()" aria-label="Jump to new entries">
                                    <span>↓ Jump to New</span>
                                </button>

                                <div class="glass-panel" style="padding: 1rem; border-radius: 1rem;">
                                    <div class="text-white font-bold">Follow People</div>
                                    <div class="text-xs text-gray" style="margin-top: 0.25rem;">Search by username.</div>

                                    <form id="feed-search-form" style="margin-top: 0.85rem;">
                                        <div class="relative">
                                            <input id="feed-search-input" type="text" class="input-field" placeholder="username" autocomplete="off" style="padding-right: 130px;">
                                            <div style="position:absolute; right: 8px; top: 50%; transform: translateY(-50%); display:flex; gap: 8px;">
                                                <button id="feed-search-btn" type="submit" class="btn btn-primary" style="padding: 0.5rem 0.75rem; border-radius: 0.75rem;">Search</button>
                                                <button id="feed-clear-btn" type="button" class="btn btn-outline" style="padding: 0.5rem 0.75rem; border-radius: 0.75rem;">Clear</button>
                                            </div>
                                        </div>
                                    </form>

                                    <div id="feed-search-results" style="margin-top: 0.9rem; display: grid; gap: 10px;"></div>

                                    <div style="height: 1px; background: rgba(255,255,255,0.06); margin: 1rem 0;"></div>

                                    <div class="text-white font-bold">Following</div>
                                    <div id="feed-following" style="margin-top: 0.75rem; display: grid; gap: 10px;"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            },

            renderAiPicks() {
                return `
                    <div class="fade-in">
                        <div class="container" style="padding-top: 1.25rem; padding-bottom: 2.6rem; position: relative;">
                            <div class="glass-panel" style="padding: 1.1rem 1.2rem; border-radius: 1.1rem; margin-bottom: 1rem;">
                                <div>
                                    <div class="text-xs text-gray" style="letter-spacing: 0.08em; text-transform: uppercase;">AI Picks</div>
                                    <h1 class="text-3xl font-bold text-white" style="margin-top: 0.2rem;">Find your next movie</h1>
                                    <p class="text-gray" style="margin-top: 0.35rem;">Tell us the vibe, then pick a few similar movies or use Filters.</p>
                                </div>
                            </div>

                            <div id="ai-inputs-wrap" class="ai-grid-2 ai-grid-single" style="display:grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 16px; align-items:start;">
                                <div style="display:flex; flex-direction: column; gap: 12px;">
                                    <div class="ai-card" style="padding: 1rem; border-radius: 1rem;">
                                        <div class="text-white font-bold">Describe what you want</div>
                                        <div id="ai-prompt-panel" class="ai-section" style="margin-top: 0.5rem;">
                                            <div class="text-xs text-gray" style="margin-bottom: 0.35rem;">Example: “Light‑hearted, character‑driven, post‑2000, strong performances.”</div>
                                            <textarea id="ai-prompt-input" class="textarea-field" rows="6" maxlength="2000" placeholder="Describe the movie you want..."></textarea>
                                            <div id="ai-prompt-remaining" class="text-xs text-gray" style="margin-top: 0.25rem; text-align: right;">2000 characters remaining</div>
                                        </div>
                                    </div>

                                    <div id="ai-similar-search-card" class="ai-card" style="padding: 1rem; border-radius: 1rem; overflow: visible; position: relative; z-index: 100;">
                                        <div class="text-white font-bold">Pick similar movies</div>
                                        <div class="text-xs text-gray" style="margin-top: 0.2rem;">Optional, up to 5.</div>
                                        <div style="margin-top: 0.6rem; display:flex; gap: 10px; align-items:flex-start; flex-wrap: wrap;">
                                            <div style="max-width: 340px; position: relative; flex: 1 1 260px; z-index: 100;">
                                                <div class="input-group" style="position: relative; z-index: 100;">
                                                    <div class="input-icon">${icons.search}</div>
                                                    <input id="ai-similar-input" type="text" class="input-field glass-input" placeholder="Search for a similar movie…" autocomplete="off" style="padding-right: 90px; width: 100%; border-radius: 0.85rem;">
                                                    <div id="ai-similar-results" class="search-dropdown hidden"></div>
                                                </div>
                                                <div style="position:absolute; right: 8px; top: 50%; transform: translateY(-50%); display:flex; gap: 8px;">
                                                    <button id="ai-similar-clear" type="button" class="btn btn-outline" style="padding: 0.35rem 0.55rem; border-radius: 0.7rem;">Clear</button>
                                                </div>
                                            </div>
                                            <div id="ai-similar-selected" style="display:flex; flex-wrap: wrap; gap: 6px; align-content:flex-start; min-height: 28px; flex: 1 1 240px; padding: 0.25rem 0;">
                                            </div>
                                        </div>
                                        <input id="ai-similar-tmdb-id" type="hidden" value="">
                                    </div>

                                    <div class="ai-card" style="padding: 0.9rem 1rem; border-radius: 1rem; display:flex; gap: 10px; flex-wrap: wrap; align-items:center; justify-content: space-between;">
                                        <div style="display:flex; gap: 8px; flex-wrap: wrap;">
                                            <button id="ai-generate-btn" type="button" class="btn btn-primary" style="border-radius: 0.85rem;">Generate Suggestions</button>
                                            <button id="ai-clear-btn" type="button" class="btn btn-outline" style="border-radius: 0.85rem;">Clear</button>
                                        </div>
                                        <label class="text-xs text-gray" style="display:inline-flex; gap: 6px; align-items:center;">
                                            <input id="ai-debug-toggle" type="checkbox" /> Debug
                                        </label>
                                    </div>

                                </div>

                                <div style="display:flex; flex-direction: column; gap: 12px;">
                                    <div class="ai-card" style="padding: 1rem; border-radius: 1rem;">
                                        <div class="text-white font-bold">Refine with Filters</div>
                                        <div class="text-xs text-gray" style="margin-top: 0.35rem; line-height: 1.5;">Filters are required unless you pick at least one similar movie.</div>
                                        <button type="button" class="btn btn-outline" style="border-radius: 0.85rem; margin-top: 0.6rem; width: 100%;" onclick="openAiFiltersModal()">Open Filters</button>
                                    </div>

                                    <div class="ai-card" style="padding: 0.85rem 1rem; border-radius: 1rem; display:flex; align-items:center; justify-content: space-between; gap: 12px;">
                                        <div>
                                            <div class="text-white font-bold" style="font-size: 0.95rem;">Exclude already watched</div>
                                            <div class="text-xs text-gray" style="margin-top: 0.2rem;">Hide movies you’ve already rated or logged.</div>
                                        </div>
                                        <label style="display:inline-flex; align-items:center; gap: 10px; padding: 0.35rem 0.6rem; border-radius: 0.8rem; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);">
                                            <input id="ai-filter-exclude-watched" type="checkbox" style="transform: scale(1.2); accent-color: #38bdf8;" />
                                            <span class="text-xs" style="color: #e2e8f0; font-weight: 700; letter-spacing: 0.02em;">Exclude</span>
                                        </label>
                                    </div>

                                    <div class="ai-card" style="padding: 1rem; border-radius: 1rem;">
                                        <div class="text-white font-bold">How it works</div>
                                        <div class="text-xs text-gray" style="margin-top: 0.4rem; line-height: 1.5;">
                                            1) Describe the vibe you want. <br>
                                            2) Add similar movies or use movie detail filters. <br>
                                            3) Generate suggestions and explore.
                                        </div>
                                    </div>

                                    <div class="ai-card" style="padding: 1rem; border-radius: 1rem;">
                                        <div class="text-white font-bold">Tips</div>
                                        <ul class="text-xs text-gray" style="margin-top: 0.4rem; padding-left: 1rem; line-height: 1.5;">
                                            <li>Use mood + era + pacing.</li>
                                            <li>Combine genres for better results.</li>
                                            <li>Add 1–3 similar movies for accuracy.</li>
                                        </ul>
                                    </div>
                                </div>
                            </div>

                            <div id="ai-loading" class="glass-panel hidden" style="margin-top: 1.25rem; padding: 1rem; border-radius: 1rem;">
                                <div class="text-white font-bold">Loading…</div>
                                <div class="text-xs text-gray" style="margin-top: 0.25rem;">We’re generating your suggestions.</div>
                                <div class="ai-loading-visual">
                                    <img
                                        id="ai-loading-image"
                                        alt="Loading animation"
                                        loading="lazy"
                                        decoding="async"
                                    />
                                </div>
                            </div>

                            <div id="ai-results-panel" class="glass-panel hidden" style="margin-top: 1.25rem; padding: 1rem; border-radius: 1rem;">
                                <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">
                                    <div>
                                        <div class="text-white font-bold">Top Suggestions</div>
                                        <div class="text-xs text-gray" style="margin-top: 0.25rem;">Results will appear here after generation.</div>
                                    </div>
                                    <button id="ai-rerun-btn" type="button" class="btn btn-primary" style="border-radius: 0.85rem; padding: 0.5rem 1rem; font-size: 0.85rem;">Edit &amp; Re‑run</button>
                                </div>
                                <div id="ai-results" class="ai-results" style="margin-top: 0.85rem;">
                                    <div class="text-gray">No results yet.</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div id="ai-filters-overlay" class="auth-overlay" onclick="if(event.target === this) closeAiFiltersModal();">
                        <div class="auth-modal" role="dialog" aria-modal="true" aria-labelledby="ai-filters-title" style="max-width: 560px;">
                            <div class="auth-modal-header">
                                <div class="auth-modal-title" id="ai-filters-title">Filters</div>
                                <button class="auth-modal-close" type="button" onclick="closeAiFiltersModal()">Close</button>
                            </div>
                            <div class="text-xs text-gray" style="margin-top: 0.25rem;">Required unless you pick a similar movie. If you choose filters, fill out all fields.</div>

                            <div class="ai-section" style="margin-top: 0.85rem;">
                                <div>
                                    <label class="text-sm text-white font-bold mb-2 label-gap submit-label block">Minimum TMDb rating (0–100)</label>
                                    <div class="ai-slider-row">
                                        <input id="ai-filter-tmdb" type="range" min="0" max="100" step="1" value="0" class="w-full" />
                                        <input id="ai-filter-tmdb-num" type="number" min="0" max="100" step="1" value="0" class="input-field ai-slider-input" />
                                    </div>
                                </div>
                                <div>
                                    <label class="text-sm text-white font-bold mb-2 label-gap submit-label block">Release year range</label>
                                    <div class="grid" style="grid-template-columns: 1fr 1fr; gap: 10px;">
                                        <input id="ai-filter-year-from" type="number" class="input-field" placeholder="From (e.g. 1990)">
                                        <input id="ai-filter-year-to" type="number" class="input-field" placeholder="To (e.g. 2024)">
                                    </div>
                                </div>
                                <div>
                                    <label class="text-sm text-white font-bold mb-2 label-gap submit-label block">Genres (include)</label>
                                    <div id="ai-filter-genres-include" class="ai-genre-grid" style="display:flex; flex-wrap: wrap; gap: 8px;">
                                        <button type="button" class="btn btn-outline ai-genre-btn" data-ai-genre-role="include" data-genre="Action" aria-pressed="false">Action</button>
                                        <button type="button" class="btn btn-outline ai-genre-btn" data-ai-genre-role="include" data-genre="Adventure" aria-pressed="false">Adventure</button>
                                        <button type="button" class="btn btn-outline ai-genre-btn" data-ai-genre-role="include" data-genre="Animation" aria-pressed="false">Animation</button>
                                        <button type="button" class="btn btn-outline ai-genre-btn" data-ai-genre-role="include" data-genre="Comedy" aria-pressed="false">Comedy</button>
                                        <button type="button" class="btn btn-outline ai-genre-btn" data-ai-genre-role="include" data-genre="Crime" aria-pressed="false">Crime</button>
                                        <button type="button" class="btn btn-outline ai-genre-btn" data-ai-genre-role="include" data-genre="Documentary" aria-pressed="false">Documentary</button>
                                        <button type="button" class="btn btn-outline ai-genre-btn" data-ai-genre-role="include" data-genre="Drama" aria-pressed="false">Drama</button>
                                        <button type="button" class="btn btn-outline ai-genre-btn" data-ai-genre-role="include" data-genre="Family" aria-pressed="false">Family</button>
                                        <button type="button" class="btn btn-outline ai-genre-btn" data-ai-genre-role="include" data-genre="Fantasy" aria-pressed="false">Fantasy</button>
                                        <button type="button" class="btn btn-outline ai-genre-btn" data-ai-genre-role="include" data-genre="History" aria-pressed="false">History</button>
                                        <button type="button" class="btn btn-outline ai-genre-btn" data-ai-genre-role="include" data-genre="Horror" aria-pressed="false">Horror</button>
                                        <button type="button" class="btn btn-outline ai-genre-btn" data-ai-genre-role="include" data-genre="Music" aria-pressed="false">Music</button>
                                        <button type="button" class="btn btn-outline ai-genre-btn" data-ai-genre-role="include" data-genre="Mystery" aria-pressed="false">Mystery</button>
                                        <button type="button" class="btn btn-outline ai-genre-btn" data-ai-genre-role="include" data-genre="Romance" aria-pressed="false">Romance</button>
                                        <button type="button" class="btn btn-outline ai-genre-btn" data-ai-genre-role="include" data-genre="Sci-Fi" aria-pressed="false">Sci‑Fi</button>
                                        <button type="button" class="btn btn-outline ai-genre-btn" data-ai-genre-role="include" data-genre="TV Movie" aria-pressed="false">TV Movie</button>
                                        <button type="button" class="btn btn-outline ai-genre-btn" data-ai-genre-role="include" data-genre="Thriller" aria-pressed="false">Thriller</button>
                                        <button type="button" class="btn btn-outline ai-genre-btn" data-ai-genre-role="include" data-genre="War" aria-pressed="false">War</button>
                                        <button type="button" class="btn btn-outline ai-genre-btn" data-ai-genre-role="include" data-genre="Western" aria-pressed="false">Western</button>
                                    </div>
                                </div>
                                <div>
                                    <label class="text-sm text-white font-bold mb-2 label-gap submit-label block">Watch options (US)</label>
                                    <div style="margin-bottom: 0.4rem;">
                                        <button type="button" class="btn btn-outline" style="border-radius: 0.75rem; padding: 0.35rem 0.7rem;" onclick="selectAllAiProviders()">Select all</button>
                                    </div>
                                    <div id="ai-filter-providers" class="ai-genre-grid" style="display:flex; flex-wrap: wrap; gap: 8px;">
                                        <button type="button" class="btn btn-outline ai-provider-btn" data-ai-provider="Netflix" aria-pressed="false">Netflix</button>
                                        <button type="button" class="btn btn-outline ai-provider-btn" data-ai-provider="Prime Video" aria-pressed="false">Prime Video</button>
                                        <button type="button" class="btn btn-outline ai-provider-btn" data-ai-provider="Hulu" aria-pressed="false">Hulu</button>
                                        <button type="button" class="btn btn-outline ai-provider-btn" data-ai-provider="Disney+" aria-pressed="false">Disney+</button>
                                        <button type="button" class="btn btn-outline ai-provider-btn" data-ai-provider="Max" aria-pressed="false">HBO Max</button>
                                        <button type="button" class="btn btn-outline ai-provider-btn" data-ai-provider="Apple TV+" aria-pressed="false">Apple TV+</button>
                                        <button type="button" class="btn btn-outline ai-provider-btn" data-ai-provider="Paramount+" aria-pressed="false">Paramount+</button>
                                        <button type="button" class="btn btn-outline ai-provider-btn" data-ai-provider="Peacock" aria-pressed="false">Peacock</button>
                                    </div>
                                </div>
                            </div>

                            <div class="auth-modal-actions" style="margin-top: 1rem;">
                                <button type="button" class="btn btn-primary" style="flex:1; border-radius: 0.85rem;" onclick="closeAiFiltersModal()">Save</button>
                                <button type="button" class="btn btn-outline" style="flex:1; border-radius: 0.85rem;" onclick="closeAiFiltersModal()">Cancel</button>
                            </div>
                        </div>
                    </div>
                `;
            },

            renderLibrary() {
                return `
                    <div class="fade-in">
                        <div class="container" style="padding-top: 2rem; padding-bottom: 3rem; position: relative;">
                            <div class="flex justify-between items-center mb-6" style="gap: 14px; flex-wrap: wrap;">
                                <div class="glass-panel page-title-card">
                                    <h1 class="text-3xl font-bold text-white">My Movies</h1>
                                    <p class="text-gray mt-2">All your watches, with details and ratings.</p>
                                </div>
                            </div>

                            <div class="glass-panel" id="theme-creator-search-panel" style="padding: 1rem; border-radius: 1rem;">
                                <div class="flex justify-between items-center" style="gap: 12px; flex-wrap: wrap;">
                                    <div>
                                        <div class="text-white font-bold">Recent Watches</div>
                                        <div id="library-meta" class="text-xs text-gray" style="margin-top: 0.25rem;"></div>
                                    </div>
                                    <div style="display:flex; gap: 8px; flex-wrap: wrap; align-items: center; justify-content: flex-end;">
                                        <div id="library-view-toggle" class="flex" style="gap: 8px; flex-wrap: wrap;">
                                            <button type="button" class="btn dash-pill-btn btn-glass" data-library-action="set_view" data-library-view="list" style="padding: 0.55rem 0.8rem; border-radius: 0.85rem;">List View</button>
                                            <button type="button" class="btn dash-pill-btn btn-outline" data-library-action="set_view" data-library-view="grid" style="padding: 0.55rem 0.8rem; border-radius: 0.85rem;">Grid View</button>
                                        </div>
                                        <button id="library-open-sortfilter" type="button" class="btn btn-outline" data-library-action="open_sort_filter" style="padding: 0.55rem 0.8rem; border-radius: 0.85rem;">Filters/Sort</button>
                                        <button id="library-refresh" type="button" class="btn btn-outline" data-library-action="refresh" style="padding: 0.55rem 0.8rem; border-radius: 0.85rem;">Refresh</button>
                                    </div>
                                </div>
                                <div id="library-list" style="margin-top: 0.9rem; display: grid; gap: 12px;"></div>

                                <div id="library-load-more-wrap" style="margin-top: 1rem; display:none; justify-content: center;">
                                    <button id="library-load-more" type="button" class="btn btn-glass" data-library-action="load_more" style="padding: 0.75rem 1.25rem; border-radius: 0.95rem;">Load More</button>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            },

            renderAccount() {
                return `
                    <div class="fade-in">
                        <div class="container" style="padding-top: 2rem; padding-bottom: 3rem; position: relative;">
                            <div class="flex justify-between items-center mb-6" style="gap: 14px; flex-wrap: wrap;">
                                <div class="glass-panel page-title-card">
                                    <h1 class="text-3xl font-bold text-white">Account</h1>
                                    <p class="text-gray mt-2">Update your profile and password.</p>
                                </div>
                                <div style="display:flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end;">
                                    <button type="button" class="btn btn-outline" data-account-action="logout" style="padding: 0.55rem 0.8rem; border-radius: 0.85rem;">Log out</button>
                                    <button type="button" class="btn btn-outline" onclick="router.navigate('home')" style="padding: 0.55rem 0.8rem; border-radius: 0.85rem;">Back</button>
                                </div>
                            </div>

                            <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; align-items: stretch;">
                                <button type="button" class="glass-panel" data-account-action="open_profile" style="padding: 1rem; border-radius: 1rem; text-align: left;">
                                    <div class="text-white font-bold">Profile</div>
                                    <div class="text-xs text-gray" style="margin-top: 0.35rem;">Username, display name, and icon.</div>
                                </button>
                                <button type="button" class="glass-panel hidden" id="theme-creator-card" data-account-action="theme_creator" style="padding: 1rem; border-radius: 1rem; text-align: left;">
                                    <div class="text-white font-bold">Theme Creator</div>
                                    <div class="text-xs text-gray" style="margin-top: 0.35rem;">Build themed backdrops from TMDb.</div>
                                </button>
                                <button type="button" class="glass-panel" data-account-action="open_security" style="padding: 1rem; border-radius: 1rem; text-align: left;">
                                    <div class="text-white font-bold">Security</div>
                                    <div class="text-xs text-gray" style="margin-top: 0.35rem;">Update your password and view email.</div>
                                </button>
                                <button type="button" class="glass-panel" data-account-action="open_feature" style="padding: 1rem; border-radius: 1rem; text-align: left;">
                                    <div class="text-white font-bold">Feature Requests</div>
                                    <div class="text-xs text-gray" style="margin-top: 0.35rem;">Send ideas and suggestions.</div>
                                </button>
                                <button type="button" class="glass-panel" data-account-action="logout" style="padding: 1rem; border-radius: 1rem; text-align: left;">
                                    <div class="text-white font-bold">Log out</div>
                                    <div class="text-xs text-gray" style="margin-top: 0.35rem;">Sign out of your account.</div>
                                </button>
                                <div class="glass-panel" id="account-theme-panel" style="padding: 1rem; border-radius: 1rem; display:flex; align-items:center; justify-content: space-between; gap: 10px; flex-wrap: wrap;">
                                    <div>
                                        <div class="text-white font-bold">Theme</div>
                                        <div class="text-xs text-gray" style="margin-top: 0.35rem;">Choose a visual style.</div>
                                    </div>
                                    <select id="account-theme-select" class="input-field" style="min-width: 120px; width: 150px;">
                                        ${buildThemeCreatorOptions(themeOptions, getStoredTheme())}
                                    </select>
                                </div>
                            </div>
                            <div class="glass-panel" id="account-achievements-panel" style="margin-top: 1rem; padding: 1rem; border-radius: 1rem;">
                                <div style="display:flex; align-items:center; justify-content: space-between; gap: 0.6rem; flex-wrap: wrap;">
                                    <div class="text-white font-bold">Achievements</div>
                                    <div style="display:flex; gap: 0.4rem; align-items:center; flex-wrap: wrap;">
                                        <div class="achievement-filter-wrap">
                                            <button id="account-achievement-filters-btn" type="button" class="btn btn-outline" style="padding: 0.35rem 0.6rem; border-radius: 0.75rem;">Sort/Filter</button>
                                            <div id="account-achievement-filters-pop" class="achievement-filters-pop" aria-hidden="true">
                                                <div class="achievement-filters-row">
                                                    <div class="achievement-filters-label">Sort</div>
                                                    <select id="account-achievement-sort" class="input-field">
                                                        <option value="points_asc" selected>Points: Low to High</option>
                                                        <option value="points_desc">Points: High to Low</option>
                                                    </select>
                                                </div>
                                                <div class="achievement-filters-row">
                                                    <div class="achievement-filters-label">Type</div>
                                                    <select id="account-achievement-filter" class="input-field">
                                                        <option value="all">All types</option>
                                                    </select>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div class="account-achievements-layout">
                                    <div id="account-tier-summary" class="tier-summary-card" aria-live="polite" data-tier="Extra">
                                        <div class="tier-summary-header">
                                            <div class="tier-summary-title">Current Tier</div>
                                            <div class="tier-summary-name" id="account-tier-name">—</div>
                                        </div>
                                        <div class="tier-summary-body">
                                            <div class="tier-summary-icon" id="account-tier-icon">?</div>
                                            <div class="tier-summary-stats">
                                                <div class="tier-summary-points" id="account-tier-points">0 pts</div>
                                                <div class="tier-summary-next" id="account-tier-next">Earn more points to level up.</div>
                                            </div>
                                        </div>
                                        <div class="tier-summary-bar">
                                            <div class="tier-summary-progress" id="account-tier-progress"></div>
                                        </div>
                                    </div>
                                    <div id="account-achievements-list" class="achievement-grid">
                                        <div class="text-xs text-gray">Loading achievements…</div>
                                    </div>
                                </div>
                            </div>
                            <div class="glass-panel" id="account-achievement-test-panel" style="margin-top: 1rem; padding: 1rem; border-radius: 1rem; display:none;">
                                <div style="display:flex; align-items:center; justify-content: space-between; gap: 0.6rem; flex-wrap: wrap;">
                                    <div>
                                        <div class="text-white font-bold">Achievement Testing</div>
                                        <div class="text-xs text-gray" style="margin-top: 0.35rem;">Trigger a test popup on demand.</div>
                                    </div>
                                    <div style="display:flex; gap: 0.4rem; align-items:center; flex-wrap: wrap;">
                                        <select id="account-test-achievement-select" class="input-field" style="min-width: 180px;"></select>
                                        <button id="account-test-achievement-btn" type="button" class="btn btn-outline" style="padding: 0.35rem 0.6rem; border-radius: 0.75rem;" onclick="triggerTestAchievementPopup()">Test Achievement</button>
                                    </div>
                                </div>
                            </div>
                            <div class="glass-panel" id="account-admin-panel" style="margin-top: 1rem; padding: 1rem; border-radius: 1rem; display:none;">
                                <div style="display:flex; align-items:center; justify-content: space-between; gap: 0.6rem; flex-wrap: wrap;">
                                    <div>
                                        <div class="text-white font-bold">Admin Controls</div>
                                        <div class="text-xs text-gray" style="margin-top: 0.35rem;">Site-wide settings visible only to you.</div>
                                    </div>
                                </div>
                                <div style="margin-top: 0.75rem; display:flex; align-items:center; justify-content:space-between; gap:0.75rem; padding:0.65rem 0.75rem; border-radius:0.75rem; border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.04);">
                                    <div>
                                        <div class="text-sm text-white font-bold">Allow New Sign-Ups</div>
                                        <div class="text-xs text-gray" style="margin-top:0.2rem;">When off, the Sign Up tab is hidden for all visitors.</div>
                                    </div>
                                    <label style="position:relative; display:inline-block; width:48px; height:26px; flex-shrink:0; cursor:pointer;">
                                        <input type="checkbox" id="admin-allow-signups-toggle" onchange="handleAdminSignupToggle(this.checked)" style="opacity:0; width:0; height:0;">
                                        <span id="admin-signup-slider" style="position:absolute; inset:0; border-radius:999px; background:rgba(255,255,255,0.15); transition:background 0.25s;"></span>
                                        <span id="admin-signup-knob" style="position:absolute; top:3px; left:3px; width:20px; height:20px; border-radius:50%; background:#fff; transition:transform 0.25s; box-shadow:0 2px 6px rgba(0,0,0,0.3);"></span>
                                    </label>
                                </div>
                                <div id="admin-signup-status" class="text-xs" style="margin-top:0.4rem; color:var(--text-muted);"></div>

                                <div style="margin-top: 0.75rem; padding:0.65rem 0.75rem; border-radius:0.75rem; border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.04);">
                                    <div class="text-sm text-white font-bold">Test SMS Notification</div>
                                    <div class="text-xs text-gray" style="margin-top:0.2rem;">Sends a sample text to your saved phone + carrier to verify the email-to-SMS pipeline.</div>
                                    <button type="button" onclick="sendTestText()" class="btn btn-outline" style="margin-top:0.6rem; border-radius:0.8rem; padding:0.5rem 0.9rem;">Send Test Text</button>
                                    <div id="admin-test-sms-status" class="text-xs" style="margin-top:0.45rem; color:var(--text-muted);"></div>
                                </div>
                            </div>
                            </div>
                        </div>
                    </div>

                    <div id="account-profile-overlay" class="auth-overlay" onclick="if(event.target === this) closeAccountSectionModal('profile');">
                        <div class="auth-modal" role="dialog" aria-modal="true" aria-labelledby="account-profile-title" style="max-width: 640px;">
                            <div class="auth-modal-header">
                                <div class="auth-modal-title" id="account-profile-title">Profile</div>
                                <button class="auth-modal-close" type="button" data-account-action="close_modal" data-modal="profile">Close</button>
                            </div>
                            <div class="text-xs text-gray" style="margin-top: 0.25rem;">Your username is used for search + following.</div>

                            <div id="account-profile-status" class="text-xs" style="margin-top: 0.6rem; color: rgba(255,255,255,0.60);"></div>

                            <form id="account-profile-form" style="margin-top: 0.85rem; display:grid; gap: 0.75rem;">
                                <div>
                                    <label class="text-sm text-white font-bold mb-2 label-gap submit-label block">Username</label>
                                    <input id="account-username" type="text" class="input-field" placeholder="e.g. landon" autocomplete="username" spellcheck="false">
                                    <div class="text-xs text-gray" style="margin-top: 0.35rem;">3–20 chars • letters/numbers/underscore • stored without “@”.</div>
                                </div>
                                <div>
                                    <label class="text-sm text-white font-bold mb-2 label-gap submit-label block">Display name</label>
                                    <input id="account-display-name" type="text" class="input-field" placeholder="e.g. Landon James" autocomplete="name">
                                </div>
                                <div>
                                    <label class="text-sm text-white font-bold mb-2 label-gap submit-label block">Phone number</label>
                                    <input id="account-phone" type="tel" class="input-field" placeholder="e.g. 5551234567" autocomplete="tel">
                                    <div class="text-xs text-gray" style="margin-top: 0.35rem;">Used to text you when someone recommends you a movie.</div>
                                </div>
                                <div>
                                    <label class="text-sm text-white font-bold mb-2 label-gap submit-label block">Service provider</label>
                                    <select id="account-carrier" class="select-field">
                                        <option value="">Select…</option>
                                        <option value="Verizon">Verizon</option>
                                        <option value="AT&T">AT&T</option>
                                    </select>
                                </div>
                                <div style="display:flex; gap: 10px; flex-wrap: wrap;">
                                    <button id="account-save-profile" type="submit" class="btn btn-primary" style="border-radius: 0.85rem;">Save profile</button>
                                    <button type="button" class="btn btn-outline" style="border-radius: 0.85rem;" data-account-action="reload">Reload</button>
                                </div>
                            </form>
                        </div>
                    </div>

                    <div id="account-security-overlay" class="auth-overlay" onclick="if(event.target === this) closeAccountSectionModal('security');">
                        <div class="auth-modal" role="dialog" aria-modal="true" aria-labelledby="account-security-title" style="max-width: 560px;">
                            <div class="auth-modal-header">
                                <div class="auth-modal-title" id="account-security-title">Security</div>
                                <button class="auth-modal-close" type="button" data-account-action="close_modal" data-modal="security">Close</button>
                            </div>
                            <div class="text-xs text-gray" style="margin-top: 0.25rem;">Password changes update Supabase Auth (not your Users table).</div>

                            <div style="margin-top: 0.85rem; display:grid; gap: 0.75rem;">
                                <div>
                                    <div class="text-sm text-white font-bold">Email</div>
                                    <div id="account-email" class="text-xs" style="margin-top: 0.25rem; color: rgba(255,255,255,0.70);"></div>
                                </div>

                                <form id="account-password-form" style="display:grid; gap: 0.75rem;">
                                    <div>
                                        <label class="text-sm text-white font-bold mb-2 label-gap submit-label block">New password</label>
                                        <input id="account-new-password" type="password" class="input-field" placeholder="••••••••" autocomplete="new-password">
                                    </div>
                                    <div>
                                        <label class="text-sm text-white font-bold mb-2 label-gap submit-label block">Confirm new password</label>
                                        <input id="account-confirm-password" type="password" class="input-field" placeholder="••••••••" autocomplete="new-password">
                                    </div>
                                    <div id="account-password-status" class="text-xs" style="color: rgba(255,255,255,0.60);"></div>
                                    <div style="display:flex; gap: 10px; flex-wrap: wrap;">
                                        <button id="account-change-password" type="submit" class="btn btn-primary" style="border-radius: 0.85rem;">Change password</button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>

                    <div id="account-feature-overlay" class="auth-overlay" onclick="if(event.target === this) closeAccountSectionModal('feature');">
                        <div class="auth-modal" role="dialog" aria-modal="true" aria-labelledby="account-feature-title" style="max-width: 640px;">
                            <div class="auth-modal-header">
                                <div class="auth-modal-title" id="account-feature-title">Feature Requests</div>
                                <button class="auth-modal-close" type="button" data-account-action="close_modal" data-modal="feature">Close</button>
                            </div>
                            <div class="text-xs text-gray" style="margin-top: 0.25rem;">Have an idea? Send it here.</div>

                            <form id="feature-request-form" style="margin-top: 0.85rem; display:grid; gap: 0.75rem;">
                                <div>
                                    <label class="text-sm text-white font-bold mb-2 label-gap submit-label block">Request</label>
                                    <textarea id="feature-request-text" class="textarea-field" rows="4" maxlength="2000" placeholder="Describe your feature idea…"></textarea>
                                    <div class="text-xs text-gray" style="margin-top: 0.35rem;">
                                        <span id="feature-request-remaining">2000 characters remaining</span>
                                    </div>
                                </div>
                                <div id="feature-request-status" class="text-xs" style="color: rgba(255,255,255,0.60);"></div>
                                <div style="display:flex; gap: 10px; flex-wrap: wrap;">
                                    <button id="feature-request-submit" type="submit" class="btn btn-primary" style="border-radius: 0.85rem;">Send request</button>
                                </div>
                            </form>
                        </div>
                    </div>
                    </div>
                `;
            },

            renderThemeCreator() {
                return `
                    <div class="fade-in">
                        <div class="container" style="padding-top: 2rem; padding-bottom: 3rem; position: relative;">
                            <div class="flex justify-between items-center mb-6" style="gap: 14px; flex-wrap: wrap;">
                                <div class="glass-panel page-title-card">
                                    <h1 class="text-3xl font-bold text-white">Theme Creator</h1>
                                    <p class="text-gray mt-2">Build a theme step by step: pick mode, name it, choose backdrops, pick the AI movie, then save.</p>
                                </div>
                                <div style="display:flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end;">
                                    <button type="button" class="btn btn-outline" onclick="router.navigate('account')" style="padding: 0.55rem 0.8rem; border-radius: 0.85rem;">Back</button>
                                </div>
                            </div>

                            <div class="glass-panel" id="theme-creator-step-mode" style="padding: 1rem; border-radius: 1rem;">
                                <div class="text-white font-bold">Step 1 — Mode</div>
                                <div class="text-xs text-gray" style="margin-top: 0.25rem;">Choose whether you are creating a new theme or editing an existing one.</div>
                                <div style="margin-top: 0.75rem; display:flex; gap: 10px; flex-wrap: wrap; align-items: center;">
                                    <button type="button" class="btn btn-primary" id="theme-creator-mode-create" style="padding: 0.55rem 0.9rem; border-radius: 0.85rem;">Create New</button>
                                    <button type="button" class="btn btn-outline" id="theme-creator-mode-edit" style="padding: 0.55rem 0.9rem; border-radius: 0.85rem;">Edit Existing</button>
                                    <button type="button" class="btn btn-outline" id="theme-creator-mode-continue" style="padding: 0.55rem 0.9rem; border-radius: 0.85rem;">Continue</button>
                                </div>
                            </div>

                            <div class="glass-panel hidden" id="theme-creator-step-name" style="margin-top: 1rem; padding: 1rem; border-radius: 1rem;">
                                <div class="text-white font-bold">Step 2 — Name</div>
                                <div class="text-xs text-gray" style="margin-top: 0.25rem;">Set or select your theme name before adding assets.</div>

                                <div id="theme-creator-create-panel" style="margin-top: 0.75rem; display:grid; gap: 8px;">
                                    <label class="text-xs text-gray">New theme name</label>
                                    <div style="display:flex; gap: 10px; flex-wrap: wrap; align-items: center;">
                                        <input id="theme-creator-new-name" type="text" class="input-field" placeholder="e.g. Neon Noir" style="min-width: 220px;">
                                        <button type="button" class="btn btn-outline" id="theme-creator-create-btn" style="padding: 0.55rem 0.9rem; border-radius: 0.85rem;">Create Theme & Continue</button>
                                    </div>
                                </div>

                                <div id="theme-creator-edit-panel" class="hidden" style="margin-top: 0.75rem; display:grid; gap: 8px;">
                                    <label class="text-xs text-gray">Select theme</label>
                                    <select id="theme-creator-edit-select" class="input-field" style="min-width: 220px;">
                                        ${buildThemeCreatorOptions(getThemeCreatorThemeOptions(), '')}
                                    </select>
                                    <div style="display:flex; gap: 10px; flex-wrap: wrap; align-items: center;">
                                        <button type="button" class="btn btn-outline" id="theme-creator-edit-continue" style="padding: 0.55rem 0.9rem; border-radius: 0.85rem;">Continue to Backdrops</button>
                                    </div>
                                    <label class="text-xs text-gray">Rename theme</label>
                                    <div style="display:flex; gap: 10px; flex-wrap: wrap; align-items: center;">
                                        <input id="theme-creator-edit-name" type="text" class="input-field" placeholder="New theme name" style="min-width: 220px;">
                                        <button type="button" class="btn btn-outline" id="theme-creator-update-btn" style="padding: 0.55rem 0.9rem; border-radius: 0.85rem;">Update Name</button>
                                    </div>
                                    <div style="margin-top: 0.5rem; display:flex; gap: 10px; flex-wrap: wrap; align-items: center;">
                                        <button type="button" class="btn btn-outline" id="theme-creator-delete-theme" style="padding: 0.55rem 0.9rem; border-radius: 0.85rem;">Delete Theme</button>
                                    </div>
                                </div>

                                <div id="theme-creator-theme-status" class="text-xs" style="margin-top: 0.6rem; color: rgba(255,255,255,0.60);"></div>
                            </div>

                            <div class="glass-panel hidden" id="theme-creator-step-backdrops" style="margin-top: 1rem; padding: 1rem; border-radius: 1rem;">
                                <div class="text-white font-bold">Step 3 — Backdrops</div>
                                <div class="text-xs text-gray" style="margin-top: 0.25rem;">Search multiple movies and pick up to 6 backdrops total.</div>
                                <div style="margin-top: 0.75rem; position: relative;">
                                    <div class="input-group">
                                        <div class="input-icon">${icons.search}</div>
                                        <input
                                            type="text"
                                            id="theme-creator-search-input"
                                            autocomplete="off"
                                            placeholder="Search a movie for backdrops..."
                                            class="input-field glass-input"
                                            style="border-radius: 0.85rem;"
                                        >
                                        <div id="theme-creator-search-results" class="search-dropdown hidden"></div>
                                    </div>
                                </div>

                                <div class="glass-panel" id="theme-creator-selected-panel" style="margin-top: 1rem; padding: 1rem; border-radius: 1rem;">
                                    <div class="flex" style="justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
                                        <div>
                                            <div class="text-white font-bold">Backdrops</div>
                                            <div id="theme-creator-selected-movie" class="text-xs text-gray" style="margin-top: 0.25rem;">No backdrop movie selected yet.</div>
                                        </div>
                                        <div class="text-xs text-gray">Click up to 6 images.</div>
                                    </div>
                                    <div id="theme-creator-backdrops" style="margin-top: 0.9rem; display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px;"></div>
                                </div>

                                <div class="glass-panel" style="margin-top: 1rem; padding: 1rem; border-radius: 1rem;">
                                    <div class="flex" style="justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
                                        <div>
                                            <div class="text-white font-bold">Selected Images</div>
                                            <div class="text-xs text-gray" style="margin-top: 0.25rem;">Assign a page for each selection.</div>
                                            <div class="text-xs text-gray" style="margin-top: 0.25rem;">Active theme: <span id="theme-creator-active-name">None</span></div>
                                        </div>
                                        <div class="text-xs text-gray" id="theme-creator-count">0 / 6 selected</div>
                                    </div>

                                    <div id="theme-creator-selected" style="margin-top: 0.9rem; display:grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px;"></div>

                                    <div style="margin-top: 1rem; display:flex; gap: 10px; flex-wrap: wrap;">
                                        <button type="button" class="btn btn-outline" id="theme-creator-clear" style="border-radius: 0.85rem;">Clear Selection</button>
                                        <button type="button" class="btn btn-outline" id="theme-creator-backdrops-continue" style="border-radius: 0.85rem;">Continue to AI Movie</button>
                                    </div>
                                </div>
                            </div>

                            <div class="glass-panel hidden" id="theme-creator-step-ai" style="margin-top: 1rem; padding: 1rem; border-radius: 1rem;">
                                <div class="text-white font-bold">Step 4 — AI Movie</div>
                                <div class="text-xs text-gray" style="margin-top: 0.25rem;">Pick the single movie that will drive the AI color palette.</div>
                                <div style="margin-top: 0.75rem; position: relative;">
                                    <div class="input-group">
                                        <div class="input-icon">${icons.search}</div>
                                        <input
                                            type="text"
                                            id="theme-creator-ai-search-input"
                                            autocomplete="off"
                                            placeholder="Search the AI palette movie..."
                                            class="input-field glass-input"
                                            style="border-radius: 0.85rem;"
                                        >
                                        <div id="theme-creator-ai-search-results" class="search-dropdown hidden"></div>
                                    </div>
                                </div>
                                <div id="theme-creator-ai-selected-movie" class="text-xs text-gray" style="margin-top: 0.6rem;">No AI movie selected yet.</div>
                                <div style="margin-top: 1rem; display:flex; gap: 10px; flex-wrap: wrap;">
                                    <button type="button" class="btn btn-outline" id="theme-creator-ai-continue" style="border-radius: 0.85rem;">Continue to Prompt</button>
                                </div>
                            </div>

                            <div class="glass-panel hidden" id="theme-creator-step-prompt" style="margin-top: 1rem; padding: 1rem; border-radius: 1rem;">
                                <div class="text-white font-bold">Step 5 — Style Prompt & Save</div>
                                <div class="text-xs text-gray" style="margin-top: 0.25rem;">Add any extra color direction, then save to trigger uploads + AI.</div>
                                <label class="text-xs text-gray" style="margin-top: 0.75rem;">Color style prompt (optional)</label>
                                <textarea id="theme-creator-style-prompt" class="input-field textarea-field" rows="3" placeholder="e.g. Moody noir with teal highlights, warm skin tones, subtle gold accents."></textarea>
                                <div class="text-xs text-gray" style="margin-top: 0.4rem;">This helps the AI pick cohesive colors for the new theme.</div>
                                <div style="margin-top: 1rem; display:flex; gap: 10px; flex-wrap: wrap;">
                                    <button type="button" class="btn btn-primary" id="theme-creator-save" style="border-radius: 0.85rem;">Save Theme Assets + Colors</button>
                                    <button type="button" class="btn btn-outline" id="theme-creator-regenerate" style="border-radius: 0.85rem;">Re-generate Colors</button>
                                </div>
                                <div id="theme-creator-status" class="text-xs" style="margin-top: 0.6rem; color: rgba(255,255,255,0.60);"></div>
                            </div>
                        </div>
                    </div>
                `;
            },

        };

