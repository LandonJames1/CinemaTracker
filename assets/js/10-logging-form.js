        function initializeWatchMethodToggle() {
            const btn = document.getElementById('watchmethod-toggle');
            if (!btn) return;
            const hidden = document.getElementById('fld-watchmethod');
            const isTheater = btn.textContent.trim().toLowerCase().includes('theater');
            if (hidden) hidden.value = isTheater ? 'In Theater' : 'At Home';
            if (isTheater) {
                btn.style.backgroundColor = 'rgba(20, 184, 166, 0.35)';
                btn.style.borderColor = 'rgba(20, 184, 166, 0.5)';
            } else {
                btn.style.backgroundColor = 'rgba(168, 85, 247, 0.35)';
                btn.style.borderColor = 'rgba(168, 85, 247, 0.5)';
            }
        }

        function normalizeSeriesValue(seriesText) {
            const s = String(seriesText || '').trim().toLowerCase();
            if (!s) return '';
            if (s === 'yes' || s === 'true' || s === '1') return 'TRUE';
            if (s === 'no' || s === 'false' || s === '0') return 'FALSE';
            return seriesText;
        }

        function parseGenreString(value) {
            return String(value || '')
                .split(',')
                .map(s => s.trim())
                .filter(Boolean);
        }

        function setGenreSelection(selectedGenres) {
            const hidden = document.getElementById('fld-genre');
            if (!hidden) return;
            const unique = Array.from(new Set((selectedGenres || []).map(s => String(s).trim()).filter(Boolean)));
            hidden.value = unique.join(', ');

            const wrap = document.getElementById('genre-chip-wrap');
            if (!wrap) return;

            wrap.querySelectorAll('button[data-genre]').forEach((btn) => {
                const g = btn.getAttribute('data-genre');
                const isOn = unique.includes(g);
                btn.classList.toggle('selected', isOn);
                btn.setAttribute('aria-pressed', isOn ? 'true' : 'false');
            });
        }

        function toggleGenreChip(btnEl) {
            if (!btnEl) return;
            const hidden = document.getElementById('fld-genre');
            if (!hidden) return;

            const genre = btnEl.getAttribute('data-genre');
            if (!genre) return;

            const current = parseGenreString(hidden.value);
            const isSelected = current.includes(genre);

            if (isSelected) {
                setGenreSelection(current.filter(g => g !== genre));
                return;
            }

            setGenreSelection([...current, genre]);
        }

        function clearInlineValidationHints() {
            try {
                document.querySelectorAll('.field-error-msg[data-inline-validation="true"]').forEach((n) => n.remove());
                document.querySelectorAll('.field-error-outline').forEach((n) => n.classList.remove('field-error-outline'));
            } catch (_) {}
        }

        function addInlineValidationHint(targetEl, message) {
            if (!targetEl) return;
            const msg = String(message || '').trim() || 'Required';

            const anchor = (() => {
                // Prefer a visual container for certain composite controls.
                const id = String(targetEl?.id || '').trim();
                if (id === 'fld-genre') return document.getElementById('genre-chip-wrap') || targetEl;
                if (id === 'fld-tier') {
                    return document.querySelector('.tier-btn-group[data-target-input="fld-tier"]') || targetEl;
                }
                if (id === 'fld-watchmethod') return document.getElementById('watchmethod-toggle') || targetEl;
                return targetEl;
            })();

            try {
                anchor?.classList?.add('field-error-outline');
            } catch (_) {}

            const wrap = anchor?.parentElement;
            if (!wrap) return;

            // Avoid duplicate messages if multiple validations run.
            try {
                const existing = wrap.querySelector('.field-error-msg[data-inline-validation="true"]');
                if (existing) return;
            } catch (_) {}

            const div = document.createElement('div');
            div.className = 'field-error-msg';
            div.setAttribute('data-inline-validation', 'true');
            div.textContent = msg;
            wrap.insertBefore(div, anchor);
        }

        function ensureMissingMovieDetailsOverlay() {
            let overlay = document.getElementById('missing-movie-details-overlay');
            if (overlay) return overlay;

            overlay = document.createElement('div');
            overlay.id = 'missing-movie-details-overlay';
            overlay.style.cssText = [
                'display:none',
                'position:fixed',
                'inset:0',
                'z-index:9999',
                'background:rgba(0,0,0,0.60)',
                'backdrop-filter: blur(6px)',
                '-webkit-backdrop-filter: blur(6px)',
                'align-items:center',
                'justify-content:center',
                'padding: 1.25rem'
            ].join(';');

            overlay.innerHTML = `
                <div class="glass-panel" style="max-width: 680px; width: 100%; border-radius: 1rem; padding: 1.25rem; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.55);">
                    <div class="flex" style="justify-content: space-between; align-items: flex-start; gap: 0.75rem;">
                        <div>
                            <div class="text-white" style="font-size: 1.15rem; font-weight: 950; letter-spacing: 0.01em;">Missing Movie Details</div>
                            <div class="text-gray" style="margin-top: 0.35rem; line-height: 1.45;">
                                Unfortunately this our API calls were unable to populate the following movie details for you:
                            </div>
                        </div>
                        <button type="button" class="btn btn-outline" id="missing-movie-details-close" style="white-space: nowrap;">Close</button>
                    </div>
                    <div id="missing-movie-details-list" style="margin-top: 0.9rem; display:flex; flex-wrap: wrap; gap: 0.5rem;"></div>
                    <div class="text-gray" style="margin-top: 0.95rem; line-height: 1.45;">
                        Please search the web and update these fields accordingly.
                    </div>
                </div>
            `;

            overlay.addEventListener('click', (e) => {
                if (e?.target === overlay) {
                    overlay.style.display = 'none';
                }
            });

            // Close button
            setTimeout(() => {
                const btn = document.getElementById('missing-movie-details-close');
                if (btn) btn.onclick = () => { overlay.style.display = 'none'; };
            }, 0);

            document.body.appendChild(overlay);
            return overlay;
        }

        function openMissingMovieDetailsOverlay(missingLabels) {
            const labels = Array.from(new Set((missingLabels || []).map((s) => String(s || '').trim()).filter(Boolean)));
            if (labels.length === 0) return;

            const overlay = ensureMissingMovieDetailsOverlay();
            const list = overlay.querySelector('#missing-movie-details-list');
            if (list) {
                list.innerHTML = labels
                    .map((l) => `<span class="dash-quote-pill" style="background: rgba(239, 68, 68, 0.12); border-color: rgba(239, 68, 68, 0.28);">${escapeHtml(l)}</span>`)
                    .join('');
            }

            overlay.style.display = 'flex';
        }

        function openDatePickerFromInput(el) {
            try {
                if (!el || el.disabled || el.readOnly) return;
                // Modern browsers: open the picker programmatically.
                if (typeof el.showPicker === 'function') {
                    el.showPicker();
                    return;
                }

                // Fallback: at least focus the field.
                if (typeof el.focus === 'function') el.focus();
            } catch (_) {}
        }

        function getMissingRequiredFieldsForDiaryFormCore() {
            // Core fields required before we do any network/save work.
            // This excludes Movie Details fields that we can attempt to re-hydrate from the API.
            const missing = [];

            const getEl = (id) => document.getElementById(id);
            const getText = (id) => String(getEl(id)?.value ?? '').trim();
            const isBlank = (v) => String(v ?? '').trim() === '';

            const ensureText = (id, label, { kind = 'review', anchorEl = null } = {}) => {
                const el = anchorEl || getEl(id);
                const v = getText(id);
                if (!el || isBlank(v)) missing.push({ label, el, kind });
            };

            const ensureNumber = (id, label, { min = null, max = null, kind = 'review', anchorEl = null } = {}) => {
                const el = anchorEl || getEl(id);
                const raw = getText(id);
                if (!el || isBlank(raw)) {
                    missing.push({ label, el, kind });
                    return;
                }
                const n = Number(raw);
                if (!Number.isFinite(n)) {
                    missing.push({ label, el, kind });
                    return;
                }
                if (min !== null && n < min) {
                    missing.push({ label, el, kind });
                    return;
                }
                if (max !== null && n > max) {
                    missing.push({ label, el, kind });
                    return;
                }
            };

            // Tier uses a hidden input + button group.
            {
                const tierEl = document.getElementById('fld-tier');
                const tierRaw = getText('fld-tier');
                const anchor = document.querySelector('.tier-btn-group[data-target-input="fld-tier"]') || tierEl;
                if (!anchor || isBlank(tierRaw)) missing.push({ label: 'Tier List', el: anchor, kind: 'review' });
            }

            // Need these to resolve the movie (and they're required regardless).
            ensureText('fld-title', 'Title', { kind: 'movie_details' });
            ensureNumber('fld-year', 'Year', { kind: 'movie_details', min: 1 });

            // Ratings
            ensureNumber('num-overall', 'Overall', { min: 0, max: 100 });
            ensureNumber('num-sound', 'Score (Sound)', { min: 0, max: 100 });
            ensureNumber('num-pace', 'Pace', { min: 0, max: 100 });
            ensureNumber('num-imagery', 'Imagery', { min: 0, max: 100 });
            ensureNumber('num-acting', 'Acting', { min: 0, max: 100 });
            ensureNumber('num-plot', 'Plot', { min: 0, max: 100 });
            ensureNumber('num-dialogue', 'Dialogue', { min: 0, max: 100 });

            ensureText('fld-notes', 'Notes');

            // Watch Date, Times Watched, and Watch Method are NOT validated here:
            // for new entries they're collected in the post-save Watch Details modal;
            // for updates they use the locked inline fields + the update watch modals.

            return missing;
        }

        function getMissingRequiredFieldsForDiaryFormStrict() {
            const missing = [];

            const getEl = (id) => document.getElementById(id);
            const getText = (id) => String(getEl(id)?.value ?? '').trim();
            const isBlank = (v) => String(v ?? '').trim() === '';

            const ensureText = (id, label, { kind = 'review', anchorEl = null } = {}) => {
                const el = anchorEl || getEl(id);
                const v = getText(id);
                if (!el || isBlank(v)) missing.push({ label, el, kind });
            };

            const ensureNumber = (id, label, { min = null, max = null, kind = 'review', anchorEl = null } = {}) => {
                const el = anchorEl || getEl(id);
                const raw = getText(id);
                if (!el || isBlank(raw)) {
                    missing.push({ label, el, kind });
                    return;
                }
                const n = Number(raw);
                if (!Number.isFinite(n)) {
                    missing.push({ label, el, kind });
                    return;
                }
                if (min !== null && n < min) {
                    missing.push({ label, el, kind });
                    return;
                }
                if (max !== null && n > max) {
                    missing.push({ label, el, kind });
                    return;
                }
            };

            // Tier uses a hidden input + button group.
            {
                const tierEl = document.getElementById('fld-tier');
                const tierRaw = getText('fld-tier');
                const anchor = document.querySelector('.tier-btn-group[data-target-input="fld-tier"]') || tierEl;
                if (!anchor || isBlank(tierRaw)) missing.push({ label: 'Tier List', el: anchor, kind: 'review' });
            }

            // Movie details (must be present before submit)
            ensureText('fld-title', 'Title', { kind: 'movie_details' });
            ensureNumber('fld-year', 'Year', { kind: 'movie_details', min: 1 });
            ensureText('fld-mpa', 'MPA', { kind: 'movie_details' });
            ensureNumber('fld-runtime', 'Runtime (min)', { kind: 'movie_details', min: 1 });
            ensureText('fld-series', 'Series?', { kind: 'movie_details' });
            ensureText('fld-director', 'Director', { kind: 'movie_details' });

            // Genre is submitted via a hidden input when using chips.
            {
                const el = document.getElementById('genre-chip-wrap') || getEl('fld-genre');
                const raw = getText('fld-genre');
                const picked = Array.isArray(parseGenreString(raw)) ? parseGenreString(raw) : [];
                if (!el || picked.length === 0) missing.push({ label: 'Genre', el, kind: 'movie_details' });
            }

            // Ratings
            ensureNumber('num-overall', 'Overall', { min: 0, max: 100 });
            ensureNumber('num-sound', 'Score (Sound)', { min: 0, max: 100 });
            ensureNumber('num-pace', 'Pace', { min: 0, max: 100 });
            ensureNumber('num-imagery', 'Imagery', { min: 0, max: 100 });
            ensureNumber('num-acting', 'Acting', { min: 0, max: 100 });
            ensureNumber('num-plot', 'Plot', { min: 0, max: 100 });
            ensureNumber('num-dialogue', 'Dialogue', { min: 0, max: 100 });

            ensureText('fld-notes', 'Notes');

            // Watch Date, Times Watched, and Watch Method are collected outside this
            // form (post-save Watch Details modal for new entries; locked inline
            // fields + update modals for updates), so they're not validated here.

            // IMPORTANT: IMDb rating is required and 0 means "missing" in this UI.
            // Block save unless it's a real value.
            ensureNumber('fld-imdb', 'IMDb Rating', { kind: 'movie_details', min: 1, max: 100 });

            return missing;
        }

        function blockSubmitWithValidationUI(missing) {
            const items = Array.isArray(missing) ? missing : [];
            if (items.length === 0) return;

            clearInlineValidationHints();
            for (const m of items) {
                addInlineValidationHint(m?.el, `Missing: ${String(m?.label || '').trim() || 'Required field'}`);
            }

            const missingMovieDetails = items
                .filter((m) => String(m?.kind || '') === 'movie_details')
                .map((m) => m.label);
            if (missingMovieDetails.length > 0) {
                openMissingMovieDetailsOverlay(missingMovieDetails);
            }

            const labels = items.map(m => m.label);
            const list = labels.join(', ');
            showToast(`Please fill out: ${list}`, { level: 'warn', durationMs: 8000 });
            try {
                const firstEl = items.find(m => m?.el)?.el;
                if (firstEl && typeof firstEl.focus === 'function') firstEl.focus();
            } catch (_) {}
        }

        async function handleFormSubmit(e) {
            e.preventDefault();
            if (guardGuestWrite()) return;

            const entryType = String(e.target.querySelector('input[name="entryType"]')?.value || '').trim().toLowerCase();
            // Hard guarantee: no DB writes if anything (except Favorite Quote) is missing.
            // Phase 1: validate core fields required to proceed.
            const coreMissing = getMissingRequiredFieldsForDiaryFormCore();
            if (coreMissing.length > 0) {
                blockSubmitWithValidationUI(coreMissing);
                return;
            }

            const btn = e.target.querySelector('button[type="submit"]');
            const originalHTML = btn.innerHTML;
            btn.innerHTML = `${icons.loader} Saving...`;
            btn.disabled = true;
            btn.style.opacity = 0.7;

            let lastKnownMovieId = null;
            let lastKnownTmdbId = null;
            let lastKnownTitle = '';
            let lastKnownEntryType = entryType;

            try {
                if (!supabaseClient) {
                    throw new Error('Supabase SDK failed to load. Check the Supabase <script> include and your network.');
                }
                const { user: authedUser, accessToken } = await requireAuthOrThrow();
                lastKnownEntryType = entryType;

                const toNumberOrNull = (v) => {
                    const n = Number(v);
                    return Number.isFinite(n) ? n : null;
                };

                const uuidLike = isUuidLike;

                const parseRuntimeMinutes = (raw) => {
                    const s = String(raw || '').trim();
                    if (!s) return null;
                    // Preferred: minutes (e.g., 136)
                    if (!s.includes(':')) {
                        const minutes = Number(s.replace(/\D/g, ''));
                        return Number.isFinite(minutes) ? minutes : null;
                    }
                    // Back-compat: accept HH:MM if someone types it.
                    const [hRaw, mRaw] = s.split(':');
                    const h = Number(String(hRaw || '').replace(/\D/g, ''));
                    const m = Number(String(mRaw || '').replace(/\D/g, ''));
                    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
                    return h * 60 + m;
                };
                const selectedId = router?.selectedMovie?.id;
                const hiddenMovieId = String(document.getElementById('fld-movie-id')?.value || '').trim();
                const hiddenTmdbId = String(document.getElementById('fld-tmdb-id')?.value || '').trim();

                lastKnownTmdbId = hiddenTmdbId || String(router?.selectedMovie?.tmdb_id || '').trim();
                lastKnownTitle = String(document.getElementById('fld-title')?.value || router?.selectedMovie?.title || '').trim();

                // Best-effort: if any Movie Details fields are missing (including IMDb), try re-hydrating
                // from the public details endpoint BEFORE we decide whether to block saving.
                try {
                    const strictPre = getMissingRequiredFieldsForDiaryFormStrict();
                    const missingMovieLabels = strictPre
                        .filter((m) => String(m?.kind || '') === 'movie_details')
                        .map((m) => m.label);

                    const tmdbIdNum = Number(hiddenTmdbId || lastKnownTmdbId || 0);
                    if (missingMovieLabels.length > 0 && Number.isFinite(tmdbIdNum) && tmdbIdNum > 0) {
                        const details = await callSwiftApiGetMovieDetails({ tmdb_id: tmdbIdNum });
                        if (details) {
                            const title = String(details?.title ?? '').trim();
                            const year = Number(details?.year ?? 0);
                            const runtime = Number(details?.runtime ?? 0);
                            const mpa = String(details?.mpa ?? '').trim();
                            const isSeries = details?.isSeries;
                            const director = String(details?.director ?? '').trim();
                            const genres = Array.isArray(details?.genres) ? details.genres : [];
                            const imdbPct = Number(details?.imdb_rating_pct ?? 0);

                            if (title) {
                                const el = document.getElementById('fld-title');
                                if (el) el.value = title;
                            }
                            if (Number.isFinite(year) && year > 0) {
                                const el = document.getElementById('fld-year');
                                if (el && !String(el.value || '').trim()) el.value = String(year);
                            }
                            if (mpa) {
                                const el = document.getElementById('fld-mpa');
                                if (el && !String(el.value || '').trim()) el.value = mpa;
                            }
                            if (Number.isFinite(runtime) && runtime > 0) {
                                const el = document.getElementById('fld-runtime');
                                if (el && !String(el.value || '').trim()) el.value = String(runtime);
                            }
                            if (isSeries === true || isSeries === false) {
                                const el = document.getElementById('fld-series');
                                const val = isSeries ? 'TRUE' : 'FALSE';
                                if (el && !String(el.value || '').trim()) el.value = val;
                            }
                            if (director) {
                                const el = document.getElementById('fld-director');
                                if (el && !String(el.value || '').trim()) el.value = director;
                            }
                            if (genres.length > 0) {
                                try {
                                    const current = parseGenreString(String(document.getElementById('fld-genre')?.value || ''));
                                    if (!Array.isArray(current) || current.length === 0) {
                                        setGenreSelection(genres);
                                    }
                                } catch (_) {}
                            }
                            if (Number.isFinite(imdbPct) && imdbPct > 0) {
                                const el = document.getElementById('fld-imdb');
                                const range = document.getElementById('fld-imdb-range');
                                if (el && (!String(el.value || '').trim() || Number(el.value) === 0)) el.value = String(Math.round(imdbPct));
                                if (range) range.value = String(Math.round(imdbPct));
                            }
                        }
                    }
                } catch (_) {
                    // Ignore hydration failures; strict validation below will catch missing fields.
                }

                // Phase 2: strict validation (includes Movie Details + IMDb).
                // If anything is still missing, BLOCK before any DB writes.
                const strictMissing = getMissingRequiredFieldsForDiaryFormStrict();
                if (strictMissing.length > 0) {
                    blockSubmitWithValidationUI(strictMissing);
                    return;
                }

                // Clear any stale validation messages once the form is valid.
                clearInlineValidationHints();

                let movie_id = uuidLike(hiddenMovieId)
                    ? hiddenMovieId
                    : (uuidLike(selectedId) ? selectedId : null);

                const movieIdWasSelected = Boolean(movie_id);

                // Updates must target an existing (user,movie) rating row.
                // Do not attempt any title-based resolution/upsert for updates.
                if (entryType === 'update' && !movie_id) {
                    // Last chance: if we have a tmdb_id from the form, map it to a DB UUID.
                    if (hiddenTmdbId) {
                        try {
                            const mapped = await getDbMovieIdByTmdbId(Number(hiddenTmdbId));
                            if (uuidLike(mapped)) movie_id = mapped;
                        } catch (_) {}
                    }

                    if (!movie_id) {
                        throw new Error('To update ratings, open the form via “Update Ratings” for a movie already in your diary.');
                    }
                }

                const shouldSyncPeople = entryType === 'new';

                // Movie details the user may have entered that TMDb can lack (e.g. the MPA
                // rating for some foreign films). Sent to the Edge Function as an override —
                // it persists this into Movies ONLY when that field is blank, so it never
                // overwrites real TMDb data.
                const mpaFromForm = String(document.getElementById('fld-mpa')?.value || '').trim();

                if (!movie_id) {
                    const title = String(document.getElementById('fld-title')?.value || '').trim();
                    const release_year = toNumberOrNull(document.getElementById('fld-year')?.value);

                    if (!title) throw new Error('Title is required.');

                    // TMDb lookup + Movies upsert happens server-side in an Edge Function.
                    // This avoids exposing a TMDb key in the browser and allows Movies to remain read-only under RLS.
                    const tmdbData = await callSwiftApi(
                        { title, release_year: release_year ?? null, sync_people: shouldSyncPeople, mpa: mpaFromForm },
                        accessToken
                    );

                    movie_id = tmdbData?.movie_id || null;

                    // People sync should never block saving the rating.
                    if (tmdbData?.people_sync && tmdbData.people_sync.ok === false) {
                        const msg = tmdbData.people_sync.details
                            ? `${tmdbData.people_sync.message} (${tmdbData.people_sync.details})`
                            : `${tmdbData.people_sync.message}`;
                        showToast(`Cast sync warning: ${msg}`);
                    }
                }

                // If the movie already exists/was selected, still sync People when logging a New Entry.
                // Avoid calling twice when we just created/resolved the movie via title lookup.
                if (movieIdWasSelected && movie_id && shouldSyncPeople && uuidLike(movie_id)) {
                    try {
                        const peopleRes = await callSwiftApi({ movie_id, sync_people: true, mpa: mpaFromForm }, accessToken);
                        if (peopleRes?.people_sync && peopleRes.people_sync.ok === false) {
                            const msg = peopleRes.people_sync.details
                                ? `${peopleRes.people_sync.message} (${peopleRes.people_sync.details})`
                                : `${peopleRes.people_sync.message}`;
                            showToast(`Cast sync warning: ${msg}`);
                        }
                    } catch (e) {
                        showToast(`Cast sync warning: ${String(e?.message || e)}`);
                    }
                }

                if (!movie_id) throw new Error('Failed to determine movie_id.');

                lastKnownMovieId = movie_id;

                // NOTE: Only after strict validation passes do we run any server-side sync that writes to DB.
                // ("Movie External Ratings" has no user_id; it should be written from the Edge Function.)
                try {
                    const syncRes = await callSwiftApi({ movie_id, sync_people: false, mpa: mpaFromForm }, accessToken);
                    const imdbPct = syncRes?.imdb_rating_pct;
                    if (imdbPct !== null && imdbPct !== undefined) {
                        const imdbEl = document.getElementById('fld-imdb');
                        const imdbVal = String(imdbEl?.value || '').trim();
                        if (imdbEl && (!imdbVal || Number(imdbVal) === 0)) {
                            imdbEl.value = String(imdbPct);
                        }

                        const imdbPctNum = Number(imdbPct);
                        if (Number.isFinite(imdbPctNum) && imdbPctNum > 0) {
                            try {
                                imdbEl?.setAttribute('readonly', '');
                                imdbEl?.classList?.add('input-readonly');
                                document.getElementById('fld-imdb-range')?.setAttribute('disabled', '');
                            } catch (_) {}
                        }
                    }

                    const ext = syncRes?.external_ratings?.imdb;
                    if (ext && ext.ok === false && ext.error) {
                        showToast(`IMDb sync warning: ${String(ext.error)}`, { level: 'warn' });
                    }
                } catch (e) {
                    showToast(`IMDb sync warning: ${String(e?.message || e)}`, { level: 'warn' });
                }

                const tier = String(document.getElementById('fld-tier')?.value || '').trim() || null;
                const overall_rating = toNumberOrNull(document.getElementById('num-overall')?.value);
                const acting_rating = toNumberOrNull(document.getElementById('num-acting')?.value);
                const pacing_rating = toNumberOrNull(document.getElementById('num-pace')?.value);
                const sound_rating = toNumberOrNull(document.getElementById('num-sound')?.value);
                const imagery_rating = toNumberOrNull(document.getElementById('num-imagery')?.value);
                const plot_rating = toNumberOrNull(document.getElementById('num-plot')?.value);
                const dialogue_rating = toNumberOrNull(document.getElementById('num-dialogue')?.value);
                const notes = String(document.getElementById('fld-notes')?.value || '').trim() || null;
                const fav_quote = String(document.getElementById('fld-quote')?.value || '').trim() || null;
                // Watch details:
                //  • New entries → collected now via the post-save Watch Details modal
                //    (when / where / have you watched before?). If "before" = Yes, the
                //    Previous Watches modal gathers each historical viewing.
                //  • Updates → preserve existing behavior via the locked inline fields;
                //    adding a watch on update is handled later by its own modals.
                let watch_method = null;
                let watch_date_from_form = '';
                let historicalEntries = [];

                if (entryType === 'new') {
                    const details = await promptWatchDetails();
                    if (!details) {
                        showToast('Save canceled.', { level: 'warn' });
                        return;
                    }
                    watch_date_from_form = String(details.watch_date || '').trim();
                    watch_method = String(details.watch_method || '').trim() || null;

                    if (details.watched_before) {
                        const prior = await promptPriorWatches();
                        if (!prior) {
                            showToast('Save canceled.', { level: 'warn' });
                            return;
                        }
                        historicalEntries = Array.isArray(prior.entries) ? prior.entries : [];
                    }
                } else {
                    watch_method = String(document.getElementById('fld-watchmethod')?.value || '').trim() || null;
                    watch_date_from_form = String(document.getElementById('fld-datewatch')?.value || '').trim();
                }

                if (!watch_date_from_form) {
                    throw new Error('Date Watched is required.');
                }

                const insertRow = {
                    user_id: authedUser.id,
                    movie_id,
                    [COL_WATCH_DATE]: watch_date_from_form,
                    tier,
                    overall_rating,
                    acting_rating,
                    pacing_rating,
                    sound_rating,
                    imagery_rating,
                    plot_rating,
                    dialogue_rating,
                    notes,
                    fav_quote
                };

                if (entryType === 'update') {
                    const choice = await promptUpdateWatchChoice();
                    if (!choice) {
                        showToast('Update canceled.', { level: 'warn' });
                        return;
                    }
                    const shouldAddWatch = choice === 'update_and_watch';

                    let watchChoice = null;
                    if (shouldAddWatch) {
                        watchChoice = await promptWatchMethodChoice();
                        if (!watchChoice) {
                            showToast('Update canceled.', { level: 'warn' });
                            return;
                        }
                    }

                    const updateRow = {
                        tier,
                        overall_rating,
                        acting_rating,
                        pacing_rating,
                        sound_rating,
                        imagery_rating,
                        plot_rating,
                        dialogue_rating,
                        notes,
                        fav_quote,
                        updated_at: new Date().toISOString(),
                    };

                    // Final safety gate: absolutely no DB writes if anything is missing.
                    // (This should already be true, but we re-check right before writing.)
                    {
                        const finalMissing = getMissingRequiredFieldsForDiaryFormStrict();
                        if (finalMissing.length > 0) {
                            blockSubmitWithValidationUI(finalMissing);
                            return;
                        }
                    }

                    const { error: updateError } = await supabaseClient
                        .from('Movie Ratings')
                        .update(updateRow)
                        .eq('user_id', authedUser.id)
                        .eq('movie_id', movie_id);

                    if (updateError) throw updateError;

                    if (shouldAddWatch) {
                        await insertWatchLog({
                            user_id: authedUser.id,
                            movie_id,
                            watch_method: watchChoice.watch_method,
                            watch_date: watchChoice.watch_date,
                        });
                    }

                    // Best-effort: if this movie was in Bucket List, remove it now that it's rated.
                    try {
                        await removeMovieFromBucketList({ user_id: authedUser.id, movie_id });
                    } catch (_) {}

                    checkAndAwardRatingMilestones().catch(() => null);

                    openRatingsSuccessModal('updated');
                    return;
                }

                // Final safety gate: absolutely no DB writes if anything is missing.
                // (This should already be true, but we re-check right before writing.)
                {
                    const finalMissing = getMissingRequiredFieldsForDiaryFormStrict();
                    if (finalMissing.length > 0) {
                        blockSubmitWithValidationUI(finalMissing);
                        return;
                    }
                }

                const { error: insertError } = await supabaseClient
                    .from('Movie Ratings')
                    .insert(insertRow);

                if (insertError) throw insertError;

                // Only create a Watch Logs row for "Log as New Entry" once per (user,movie),
                // and only after the Movie Ratings insert succeeds.
                if (entryType === 'new') {
                    await insertWatchLogIfMissing({
                        user_id: authedUser.id,
                        movie_id,
                        watch_method,
                        watch_date: watch_date_from_form,
                    });
                }

                // Previous watches the user described in the Watch Details → Previous
                // Watches modal flow (each its own date + method) become extra Watch
                // Logs rows. The save above already logged the current viewing.
                if (entryType === 'new' && historicalEntries.length > 0) {
                    await insertWatchLogsBulk({
                        user_id: authedUser.id,
                        movie_id,
                        entries: historicalEntries,
                    });
                    showToast(`Added ${historicalEntries.length} previous watch${historicalEntries.length === 1 ? '' : 'es'}!`);
                }

                // Best-effort: if this movie was in Bucket List, remove it now that it's rated.
                try {
                    await removeMovieFromBucketList({ user_id: authedUser.id, movie_id });
                } catch (_) {}

                checkAndAwardRatingMilestones().catch(() => null);

                openRatingsSuccessModal('saved');
                return;
            } catch (err) {
                const msg = String(err?.message || err || 'Unknown error');
                const code = String(err?.code || '').trim();
                const isDuplicate =
                    code === '23505' ||
                    msg.toLowerCase().includes('duplicate key value') ||
                    msg.includes('movie_ratings_user_movie_unique');

                if (isDuplicate && String(lastKnownEntryType || '').toLowerCase() === 'new') {
                    openDuplicateRatingModal({
                        movie_id: lastKnownMovieId,
                        tmdb_id: lastKnownTmdbId,
                        title: lastKnownTitle,
                    });
                    return;
                }

                showToast(`Save failed: ${msg}`);
            } finally {
                btn.innerHTML = originalHTML;
                btn.disabled = false;
                btn.style.opacity = 1;
            }
        }

