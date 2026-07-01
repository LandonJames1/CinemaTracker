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

            const html = `${topRow}${genreHtml}${cardsHtml}`;
            return html.trim() ? html : `<p class="ms-empty">No additional details available.</p>`;
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

            // Reuse the home page's selection state so the action buttons (Log /
            // Update / Add to List / Recommend) work exactly as they do on Home.
            try { router.selectedMovie = movie; router.pendingTitle = movie?.title || ''; } catch (_) {}

            overlay.style.display = 'flex';
            overlay.classList.add('open');
            try { overlay.scrollTop = 0; } catch (_) {}
            renderMovieSpotlight();

            // Kick off the rated-state check immediately (in parallel with details).
            refreshSpotlightRatedState(token).catch(() => {});

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
                ? `<button type="button" class="ms-action ms-action-secondary" onclick="movieSpotlightAction('quick')">${icons.refreshCw} Quick Watch +1</button>
                   <button type="button" class="ms-action ms-action-primary" onclick="movieSpotlightAction('update')">${icons.edit3} Update Ratings</button>`
                : `<button type="button" class="ms-action ms-action-secondary" onclick="movieSpotlightAction('later')">${icons.clock} Rate Later</button>
                   <button type="button" class="ms-action ms-action-primary" onclick="movieSpotlightAction('new')">${icons.plusCircle} Log as New Entry</button>`;
            return `
                <div class="ms-actions-row ms-actions-primary">${primary}</div>
                <div class="ms-actions-row">
                    <button type="button" class="ms-action ms-action-secondary" onclick="movieSpotlightAction('recommend')">${icons.users} Recommend</button>
                    <button type="button" class="ms-action ms-action-secondary" onclick="movieSpotlightAction('list')">${icons.plusCircle} Add to List</button>
                </div>`;
        }

        // The action buttons reuse the existing Home flow. Navigation actions close
        // the spotlight first; modal-opening actions also close it so they don't stack.
        function movieSpotlightAction(kind) {
            const movie = movieSpotlightState.movie;
            try { if (movie) { router.selectedMovie = movie; router.pendingTitle = movie?.title || ''; } } catch (_) {}
            closeMovieSpotlight();
            try {
                if (kind === 'new') router.startNewEntry();
                else if (kind === 'later') saveMovieForLater(movie);
                else if (kind === 'update') router.startUpdateRatings();
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

            if (tab === 'details') {
                if (loading) {
                    return `<div class="ms-loading"><div class="discover-spinner discover-spinner-sm"></div><span>Loading details…</span></div>`;
                }
                return spotlightDetailsCardsHtml(mv);
            }

            // Overview (default)
            if (loading && !mv.overview) {
                return `<div class="ms-loading"><div class="discover-spinner discover-spinner-sm"></div><span>Loading…</span></div>`;
            }
            return mv.overview
                ? `<p class="ms-overview">${escapeHtml(mv.overview)}</p>`
                : `<p class="ms-empty">No synopsis available.</p>`;
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
                <div class="ms-tabs">
                    <button type="button" data-ms-tab="details" class="${tab === 'details' ? 'is-active' : ''}" onclick="setMovieSpotlightTab('details')">Details</button>
                    <button type="button" data-ms-tab="overview" class="${tab === 'overview' ? 'is-active' : ''}" onclick="setMovieSpotlightTab('overview')">Synopsis</button>
                    <button type="button" data-ms-tab="cast" class="${tab === 'cast' ? 'is-active' : ''}" onclick="setMovieSpotlightTab('cast')">Cast</button>
                </div>
                <div class="ms-panel" id="ms-panel">${spotlightPanelHtml(tab)}</div>
                <div class="ms-actions" id="ms-actions">${spotlightActionsHtml()}</div>
            `;
        }
