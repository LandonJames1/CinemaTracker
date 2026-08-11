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
            } else {
                setGenreSelection([...current, genre]);
            }
            // Chips don't fire input/change, so clear the genre "missing" highlight here.
            try { refreshMovieDetailMissingHighlights(); } catch (_) {}
        }

        // Collapse/expand the "Movie Details" panel (mobile overhaul: keeps the busy
        // metadata fields tucked away behind a header + caret, poster stays visible).
        function toggleSubmitDetails(btn) {
            const panel = (btn && btn.closest) ? btn.closest('.submit-details-panel') : null;
            if (!panel) return;
            panel.classList.toggle('open');
            updateSubmitDetailsToggleLabel(panel);
        }

        // The caret label reads "Collapse" when open, "Expand" when closed.
        function updateSubmitDetailsToggleLabel(panel) {
            if (!panel) return;
            const label = panel.querySelector('.submit-details-toggle-label');
            if (label) label.textContent = panel.classList.contains('open') ? 'Collapse' : 'Expand';
        }

        // Initial state for the Movie Details panel: open on desktop (room to spare),
        // and on mobile open ONLY when a detail is missing (so it surfaces the red-
        // highlighted gaps); otherwise collapse it to de-clutter the mobile form.
        function initSubmitDetailsCollapse() {
            const panel = document.querySelector('.submit-details-panel');
            if (!panel) return;
            const hasMissing = panel.dataset.hasMissing === 'true';
            let isMobile = false;
            try { isMobile = window.matchMedia('(max-width: 900px)').matches; } catch (_) {}
            if (hasMissing || !isMobile) panel.classList.add('open');
            else panel.classList.remove('open');
            updateSubmitDetailsToggleLabel(panel);

            // Live-clear the red highlight as soon as a missing Movie Details field is
            // filled in (the panel is a fresh DOM node each render, so no dup listeners).
            panel.addEventListener('input', refreshMovieDetailMissingHighlights);
            panel.addEventListener('change', refreshMovieDetailMissingHighlights);
        }

        // Remove the "missing" highlight from any Movie Details field that now has a
        // valid value. Only Movie Details fields are flagged at render time; ratings
        // are only flagged AFTER a save attempt (via blockSubmitWithValidationUI).
        function refreshMovieDetailMissingHighlights() {
            const hasVal = (v) => String(v ?? '').trim() !== '';
            const posInt = (v) => { const n = Number(String(v ?? '').trim()); return Number.isFinite(n) && n > 0; };
            const checks = [
                ['fld-year', posInt],
                ['fld-mpa', hasVal],
                ['fld-runtime', posInt],
                ['fld-series', hasVal],
                ['fld-director', hasVal],
                ['fld-genre', (v) => parseGenreString(v).length > 0],
            ];
            for (const [id, ok] of checks) {
                const el = document.getElementById(id);
                if (!el) continue;
                const wrap = el.closest ? el.closest('.submit-field-missing') : null;
                if (wrap && ok(el.value)) wrap.classList.remove('submit-field-missing');
            }
            const panel = document.querySelector('.submit-details-panel');
            if (panel && !panel.querySelector('.submit-field-missing')) {
                const badge = panel.querySelector('.submit-details-missing-badge');
                if (badge) badge.style.display = 'none';
            }
        }

        // Hard-enforce 0–100 on a rating number box in REAL TIME: the moment a
        // keystroke would push it out of range (e.g. typing a 3rd digit → 555) the
        // value snaps back to the last valid value, so an invalid number can never
        // persist. Keeps the paired slider in sync.
        function enforceRatingScore(el) {
            if (!el) return;
            const digits = String(el.value ?? '').replace(/[^\d]/g, '');
            if (digits === '') { el.value = ''; el.dataset.lastValid = ''; }
            else {
                const n = parseInt(digits, 10);
                if (Number.isNaN(n)) {
                    el.value = el.dataset.lastValid || '';
                } else if (n > 100) {
                    // Reject the out-of-range keystroke (don't clamp to 100 — keep what was valid).
                    el.value = (el.dataset.lastValid !== undefined && el.dataset.lastValid !== '') ? el.dataset.lastValid : '100';
                } else {
                    el.value = String(n);
                }
                el.dataset.lastValid = el.value;
            }
            const range = el.parentElement && el.parentElement.previousElementSibling;
            if (range && range.tagName === 'INPUT' && range.type === 'range') range.value = el.value || '0';
        }

        // Slider moved → mirror into the number box (always valid) + remember it.
        function syncScoreFromSlider(rangeEl, numId) {
            const num = document.getElementById(numId);
            if (!num || !rangeEl) return;
            num.value = rangeEl.value;
            num.dataset.lastValid = String(rangeEl.value);
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
                // Make sure the (possibly collapsed) Movie Details panel is open so the
                // inline hints on those fields are actually visible.
                try { document.querySelector('.submit-details-panel')?.classList.add('open'); } catch (_) {}
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

        // ── Diary draft auto-save ────────────────────────────────────────────
        // Persist a NEW-entry log form to localStorage as the user types, so a
        // half-written review survives an accidental navigation / refresh / app
        // backgrounding. Keyed per movie (tmdb id, else title); on returning to
        // log the SAME movie we offer to restore. Cleared on a successful save.
        // Front-end only — no DB, no schema, scoped to "new" entries (updates
        // already carry their values from the DB).
        const DIARY_DRAFT_LS_KEY = 'ct_diary_drafts_v1';
        const DIARY_DRAFT_MAX = 8;                       // keep the newest N drafts
        const DIARY_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // expire after 7 days
        let diaryDraftSaveTimer = null;
        let diaryDraftGlobalsBound = false;
        // The server ("Review Drafts") mirror is written ONLY when the user leaves the
        // form or the app is backgrounded/closed — never while they're still typing.
        // That table feeds the To Rate tab + the red "still to rate" badge, and a badge
        // appearing mid-review (while the user is just thinking) reads as a bug.
        // localStorage still autosaves on every keystroke (device-local, no badge), so a
        // crash/refresh mid-typing is still recoverable.
        let diaryDraftDisabled = false;   // set once the draft is saved/discarded, so the
                                          // leave-the-page flush can't resurrect it
        // Watch info (date + method) carried in from a "Rate Later" / To Rate draft so
        // the post-save Watch Details prompt can SKIP re-asking those (it still asks
        // "have you watched this before?"). Set when a draft is surfaced on form open;
        // cleared on save/cancel/leaving the form.
        let activeDraftWatch = null;
        // When set, the To Rate "Rate now" flow wants the draft applied SILENTLY (no
        // "Restore draft?" prompt) — the user explicitly chose to resume it.
        let diaryDraftForceRestore = false;

        // ---- Server-side draft store ("Review Drafts") ---------------------------
        // The localStorage draft (below) is a per-device cache; these mirror the draft
        // to the DB so it's cross-device AND shows up in the Account → To Rate tab.
        // Feed/dashboard/achievements/etc. read ONLY "Movie Ratings", so a draft never
        // leaks. On a real save the draft row is deleted (see clearDiaryDraftForCurrentForm).
        async function upsertReviewDraft(payload) {
            try {
                if (!supabaseClient) return;
                const uid = getActiveUserId();
                if (!uid) return;
                const row = { user_id: uid, updated_at: new Date().toISOString(), ...payload };
                await supabaseClient.from('Review Drafts').upsert(row, { onConflict: 'user_id,tmdb_id' });
            } catch (_) {}
        }

        async function deleteReviewDraftFor({ tmdb_id, movie_id } = {}) {
            try {
                if (!supabaseClient) return;
                const uid = getActiveUserId();
                if (!uid) return;
                const n = Number(tmdb_id);
                if (Number.isFinite(n) && n > 0) {
                    await supabaseClient.from('Review Drafts').delete().eq('user_id', uid).eq('tmdb_id', n);
                } else if (movie_id) {
                    await supabaseClient.from('Review Drafts').delete().eq('user_id', uid).eq('movie_id', movie_id);
                }
            } catch (_) {}
        }

        async function fetchReviewDraftForMovie(tmdb_id) {
            try {
                if (!supabaseClient) return null;
                const uid = getActiveUserId();
                const n = Number(tmdb_id);
                if (!uid || !Number.isFinite(n) || n <= 0) return null;
                const { data } = await supabaseClient
                    .from('Review Drafts').select('*').eq('user_id', uid).eq('tmdb_id', n).limit(1);
                return Array.isArray(data) && data.length ? data[0] : null;
            } catch (_) { return null; }
        }

        async function fetchReviewDrafts() {
            try {
                if (!supabaseClient) return [];
                const uid = getActiveUserId();
                if (!uid) return [];
                const { data } = await supabaseClient
                    .from('Review Drafts').select('*').eq('user_id', uid)
                    .order('updated_at', { ascending: false });
                return Array.isArray(data) ? data : [];
            } catch (_) { return []; }
        }

        // The movie identity + display fields a server draft row needs. Server drafts
        // are keyed by tmdb_id, so a title-only movie (no tmdb) stays localStorage-only.
        function diaryDraftServerIdentity() {
            const tmdb = Number(document.getElementById('fld-tmdb-id')?.value || 0);
            if (!Number.isFinite(tmdb) || tmdb <= 0) return null;
            const movieIdRaw = String(document.getElementById('fld-movie-id')?.value || '').trim();
            const movie_id = (typeof isUuidLike === 'function' && isUuidLike(movieIdRaw)) ? movieIdRaw : null;
            const title = String(document.getElementById('fld-title')?.value || router?.selectedMovie?.title || '').trim() || null;
            const yr = Number(document.getElementById('fld-year')?.value || 0);
            const release_year = (Number.isFinite(yr) && yr > 0) ? yr : null;
            const poster_path = String(router?.selectedMovie?.poster_path || '').trim() || null;
            return { tmdb_id: tmdb, movie_id, title, release_year, poster_path };
        }

        // Map the localStorage draft's `fields` shape → the "Review Drafts" columns.
        function diaryDraftRatingColumns(fields) {
            const toNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
            const sc = (fields && fields.scores) || {};
            return {
                tier: String(fields?.tier || '').trim() || null,
                overall_rating: ('overall' in sc) ? toNum(sc.overall) : null,
                acting_rating: ('acting' in sc) ? toNum(sc.acting) : null,
                pacing_rating: ('pace' in sc) ? toNum(sc.pace) : null,
                sound_rating: ('sound' in sc) ? toNum(sc.sound) : null,
                imagery_rating: ('imagery' in sc) ? toNum(sc.imagery) : null,
                plot_rating: ('plot' in sc) ? toNum(sc.plot) : null,
                dialogue_rating: ('dialogue' in sc) ? toNum(sc.dialogue) : null,
                notes: String(fields?.notes || '').trim() || null,
                fav_quote: String(fields?.quote || '').trim() || null,
            };
        }

        // A server draft row → the `fields` shape applyDiaryDraft() expects.
        function serverDraftToFields(row) {
            if (!row) return null;
            const scores = {};
            const put = (key, val) => { if (val !== null && val !== undefined) scores[key] = String(val); };
            put('overall', row.overall_rating);
            put('acting', row.acting_rating);
            put('pace', row.pacing_rating);
            put('sound', row.sound_rating);
            put('imagery', row.imagery_rating);
            put('plot', row.plot_rating);
            put('dialogue', row.dialogue_rating);
            return {
                scores,
                tier: String(row.tier || ''),
                quote: String(row.fav_quote || ''),
                notes: String(row.notes || ''),
                genre: null,   // genre/details are re-prefilled from the details endpoint
                details: {},
            };
        }

        function serverDraftHasRatingContent(row) {
            if (!row) return false;
            if (String(row.notes || '').trim()) return true;
            if (String(row.fav_quote || '').trim()) return true;
            if (String(row.tier || '').trim()) return true;
            const keys = ['overall_rating','acting_rating','pacing_rating','sound_rating','imagery_rating','plot_rating','dialogue_rating'];
            return keys.some((k) => row[k] !== null && row[k] !== undefined && Number(row[k]) !== 50);
        }

        function readDiaryDraftStore() {
            try {
                const raw = localStorage.getItem(DIARY_DRAFT_LS_KEY);
                const obj = raw ? JSON.parse(raw) : {};
                if (!obj || typeof obj !== 'object') return {};
                const now = Date.now();
                let changed = false;
                for (const k of Object.keys(obj)) {
                    const ts = Number(obj[k]?.ts || 0);
                    if (!ts || (now - ts) > DIARY_DRAFT_TTL_MS) { delete obj[k]; changed = true; }
                }
                if (changed) { try { localStorage.setItem(DIARY_DRAFT_LS_KEY, JSON.stringify(obj)); } catch (_) {} }
                return obj;
            } catch (_) { return {}; }
        }

        function writeDiaryDraftStore(store) {
            try {
                const keys = Object.keys(store).sort((a, b) => Number(store[b]?.ts || 0) - Number(store[a]?.ts || 0));
                const trimmed = {};
                keys.slice(0, DIARY_DRAFT_MAX).forEach(k => { trimmed[k] = store[k]; });
                localStorage.setItem(DIARY_DRAFT_LS_KEY, JSON.stringify(trimmed));
            } catch (_) {}
        }

        // The current submit form's draft identity — null unless it's a NEW entry.
        function diaryDraftContext() {
            const entryType = String(document.querySelector('#app-root input[name="entryType"]')?.value || '').trim().toLowerCase();
            if (entryType !== 'new') return null;
            const tmdb = String(document.getElementById('fld-tmdb-id')?.value || '').trim();
            const title = String(document.getElementById('fld-title')?.value || '').trim().toLowerCase();
            const key = tmdb ? ('tmdb:' + tmdb) : (title ? ('title:' + title) : '');
            if (!key) return null;
            return { mode: 'new', key };
        }

        // A field we should round-trip in the draft (skip locked/auto-filled ones).
        function diaryFieldEditable(el) {
            if (!el) return false;
            if (el.disabled) return false;
            if (el.tagName === 'SELECT') return true;
            if (el.type === 'hidden') return false; // mirror of a locked detail value
            if (el.readOnly) return false;
            if (el.classList && el.classList.contains('input-readonly')) return false;
            return true;
        }

        function collectDiaryDraftFields() {
            const f = { scores: {}, tier: '', quote: '', notes: '', genre: null, details: {} };
            ['overall', 'sound', 'pace', 'imagery', 'acting', 'plot', 'dialogue'].forEach(k => {
                const el = document.getElementById('num-' + k);
                if (el) f.scores[k] = String(el.value);
            });
            f.tier = String(document.getElementById('fld-tier')?.value || '');
            f.quote = String(document.getElementById('fld-quote')?.value || '');
            f.notes = String(document.getElementById('fld-notes')?.value || '');
            // Genre is only editable when the chip picker is present (else it's locked).
            if (document.getElementById('genre-chip-wrap')) {
                f.genre = String(document.getElementById('fld-genre')?.value || '');
            }
            [['year', 'fld-year'], ['mpa', 'fld-mpa'], ['runtime', 'fld-runtime'],
             ['series', 'fld-series'], ['director', 'fld-director'], ['imdb', 'fld-imdb']].forEach(([k, id]) => {
                const el = document.getElementById(id);
                if (diaryFieldEditable(el)) f.details[k] = String(el.value);
            });
            return f;
        }

        // Only treat a draft as worth saving/restoring when the user has actually
        // entered review content (so a pristine form doesn't create a draft).
        function diaryDraftHasContent(f) {
            if (!f) return false;
            if (String(f.notes || '').trim()) return true;
            if (String(f.quote || '').trim()) return true;
            if (String(f.tier || '').trim()) return true;
            const sc = f.scores || {};
            if (Object.keys(sc).some(k => String(sc[k]) !== '50')) return true;
            return false;
        }

        // `server:true` also mirrors the draft to the "Review Drafts" table — only done
        // on the way OUT of the form (see flushDiaryDraft), never while typing.
        function saveDiaryDraftNow({ server = false } = {}) {
            try {
                if (diaryDraftDisabled) return;
                const ctx = diaryDraftContext();
                if (!ctx) return;
                const fields = collectDiaryDraftFields();
                const store = readDiaryDraftStore();
                const identity = server ? diaryDraftServerIdentity() : null;
                if (!diaryDraftHasContent(fields)) {
                    if (store[ctx.key]) { delete store[ctx.key]; writeDiaryDraftStore(store); }
                    // Drop an empty server draft too, but PRESERVE a watch-only draft
                    // (from "Rate Later"): only delete rows with no watch info.
                    if (identity) {
                        const uid = getActiveUserId();
                        if (uid && supabaseClient) {
                            supabaseClient.from('Review Drafts').delete()
                                .eq('user_id', uid).eq('tmdb_id', identity.tmdb_id)
                                .is('watch_date', null).is('watch_method', null)
                                .then(() => {}, () => {});
                        }
                    }
                    return;
                }
                store[ctx.key] = { ts: Date.now(), mode: ctx.mode, fields };
                writeDiaryDraftStore(store);
                // Mirror the review content to the server (cross-device + To Rate tab).
                // Watch columns are intentionally omitted so a "Rate Later" watch_date/
                // method already on the row is preserved (upsert only sets sent columns).
                if (identity) {
                    upsertReviewDraft({ ...identity, ...diaryDraftRatingColumns(fields) })
                        .then(() => { try { refreshNavBadges(); } catch (_) {} }, () => {});
                }
            } catch (_) {}
        }

        // Local-only autosave (no server write → no To Rate badge while still typing).
        function scheduleDiaryDraftSave() {
            try { clearTimeout(diaryDraftSaveTimer); } catch (_) {}
            diaryDraftSaveTimer = setTimeout(() => saveDiaryDraftNow({ server: false }), 600);
        }

        // Called when the user LEAVES the form (router.navigate away) or the app is
        // hidden/closed — this is the only path that writes the server draft row.
        function flushDiaryDraft() {
            try { clearTimeout(diaryDraftSaveTimer); } catch (_) {}
            saveDiaryDraftNow({ server: true });
        }

        function clearDiaryDraftForCurrentForm() {
            try {
                // The form is still on screen after a save/discard (success modal), so
                // stop any later flush (navigate-away / pagehide) from re-creating it.
                diaryDraftDisabled = true;
                try { clearTimeout(diaryDraftSaveTimer); } catch (_) {}
                const ctx = diaryDraftContext();
                if (ctx) {
                    const store = readDiaryDraftStore();
                    if (store[ctx.key]) { delete store[ctx.key]; writeDiaryDraftStore(store); }
                }
                // Drop the server draft unconditionally — it's been posted or discarded.
                const identity = diaryDraftServerIdentity();
                if (identity) deleteReviewDraftFor({ tmdb_id: identity.tmdb_id, movie_id: identity.movie_id });
                activeDraftWatch = null;
            } catch (_) {}
        }

        function applyDiaryDraft(fields) {
            if (!fields) return;
            try {
                const sc = fields.scores || {};
                Object.keys(sc).forEach(k => {
                    const el = document.getElementById('num-' + k);
                    if (!el) return;
                    const v = String(sc[k]);
                    el.value = v;
                    el.setAttribute('data-last-valid', v);
                    const cont = el.closest('.slider-container');
                    const range = cont ? cont.querySelector('input[type="range"]') : null;
                    if (range) range.value = v;
                });
                if (typeof fields.tier === 'string' && fields.tier.trim()) {
                    const btn = document.querySelector(`.tier-btn-group .tier-btn[data-tier="${fields.tier}"]`);
                    if (btn) setTierFromButton(btn);
                }
                const q = document.getElementById('fld-quote');
                if (q && typeof fields.quote === 'string') q.value = fields.quote;
                const n = document.getElementById('fld-notes');
                if (n && typeof fields.notes === 'string') n.value = fields.notes;
                if (typeof fields.genre === 'string' && document.getElementById('genre-chip-wrap')) {
                    setGenreSelection(parseGenreString(fields.genre));
                }
                const det = fields.details || {};
                [['year', 'fld-year'], ['mpa', 'fld-mpa'], ['runtime', 'fld-runtime'],
                 ['series', 'fld-series'], ['director', 'fld-director'], ['imdb', 'fld-imdb']].forEach(([k, id]) => {
                    if (!(k in det)) return;
                    const el = document.getElementById(id);
                    if (diaryFieldEditable(el)) {
                        el.value = String(det[k]);
                        if (id === 'fld-imdb') {
                            const r = document.getElementById('fld-imdb-range');
                            if (r) r.value = String(det[k]);
                        }
                    }
                });
                try { refreshMovieDetailMissingHighlights(); } catch (_) {}
            } catch (_) {}
        }

        function diaryDraftRelativeTime(ts) {
            const n = Number(ts || 0);
            if (!n) return '';
            const diff = Date.now() - n;
            const min = Math.round(diff / 60000);
            if (min < 1) return 'just now';
            if (min < 60) return `${min} min ago`;
            const hr = Math.round(min / 60);
            if (hr < 24) return `${hr} hr ago`;
            const d = Math.round(hr / 24);
            return `${d} day${d === 1 ? '' : 's'} ago`;
        }

        // The draft awaiting a Restore/Discard decision (set when the modal opens).
        let diaryDraftPending = null;

        function openDiaryDraftModal(draft) {
            try {
                const overlay = document.getElementById('diary-draft-overlay');
                if (!overlay) return;
                diaryDraftPending = draft || null;
                const when = diaryDraftRelativeTime(draft?.ts);
                const whenEl = document.getElementById('diary-draft-when');
                if (whenEl) whenEl.textContent = when ? ` from ${when}` : '';
                overlay.style.display = 'flex';
            } catch (_) {}
        }

        function closeDiaryDraftModal() {
            try {
                const overlay = document.getElementById('diary-draft-overlay');
                if (overlay) overlay.style.display = 'none';
            } catch (_) {}
            // Dismissing without choosing leaves the draft intact on purpose.
            diaryDraftPending = null;
        }

        function diaryDraftRestore() {
            const draft = diaryDraftPending;
            closeDiaryDraftModal();
            if (draft && draft.fields) {
                applyDiaryDraft(draft.fields);
                showToast('Draft restored.');
            }
        }

        function diaryDraftDiscard() {
            closeDiaryDraftModal();
            clearDiaryDraftForCurrentForm();
            showToast('Draft discarded.', { level: 'warn' });
        }

        function ensureDiaryDraftGlobalListeners() {
            if (diaryDraftGlobalsBound) return;
            diaryDraftGlobalsBound = true;
            // flushDiaryDraft no-ops off the submit page (no entryType input), so these
            // can stay bound for the app's lifetime. Leaving the app = a "leave", so this
            // is one of the two moments the server draft row (and its badge) is written.
            window.addEventListener('pagehide', flushDiaryDraft);
            document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushDiaryDraft(); });
        }

        // Wire up autosave + the restore banner. Called from the router's submit
        // dispatch after the form is rendered.
        function initDiaryDraftAutosave() {
            const form = document.querySelector('#app-root form');
            if (!form) return;
            diaryDraftDisabled = false;   // fresh form → drafting is live again
            const ctx = diaryDraftContext();
            if (!ctx) { diaryDraftForceRestore = false; return; } // new entries only
            ensureDiaryDraftGlobalListeners();
            // Typed fields fire 'input'; tier/genre are button clicks, so catch those too.
            form.addEventListener('input', scheduleDiaryDraftSave);
            form.addEventListener('click', (e) => {
                if (e.target.closest('.tier-btn') || e.target.closest('[data-genre]')) scheduleDiaryDraftSave();
            });

            activeDraftWatch = null;
            const forceRestore = diaryDraftForceRestore;
            diaryDraftForceRestore = false;

            // Prefer the server draft (cross-device + carries "Rate Later" watch info),
            // falling back to the per-device localStorage draft. Runs async so a slow
            // network never blocks the form from rendering.
            (async () => {
                try {
                    const localStore = readDiaryDraftStore();
                    const localDraft = localStore[ctx.key] || null;
                    const tmdb = Number(document.getElementById('fld-tmdb-id')?.value || 0);
                    const serverRow = (Number.isFinite(tmdb) && tmdb > 0) ? await fetchReviewDraftForMovie(tmdb) : null;

                    // Carry any stored watch date/method into the post-save prompt so it
                    // skips re-asking those (it still asks "watched before?").
                    if (serverRow && (serverRow.watch_date || serverRow.watch_method)) {
                        activeDraftWatch = {
                            watch_date: String(serverRow.watch_date || '').trim(),
                            watch_method: String(serverRow.watch_method || '').trim() || null,
                        };
                    }

                    let fields = null;
                    let ts = 0;
                    if (serverRow && serverDraftHasRatingContent(serverRow)) {
                        fields = serverDraftToFields(serverRow);
                        // Layer the localStorage draft's genre/detail fields on top —
                        // the server row doesn't store those.
                        if (localDraft && localDraft.fields) {
                            if (localDraft.fields.details) fields.details = localDraft.fields.details;
                            if (localDraft.fields.genre && !fields.genre) fields.genre = localDraft.fields.genre;
                        }
                        ts = Date.parse(serverRow.updated_at || '') || Date.now();
                    } else if (localDraft && localDraft.fields && diaryDraftHasContent(localDraft.fields)) {
                        fields = localDraft.fields;
                        ts = Number(localDraft.ts || 0);
                    }

                    if (fields && diaryDraftHasContent(fields)) {
                        if (forceRestore) {
                            applyDiaryDraft(fields);
                            showToast('Draft restored.');
                        } else {
                            openDiaryDraftModal({ ts, fields });
                        }
                    }
                } catch (_) {}
            })();
        }

        // After a successful save/update, don't leave the user sitting on the (now
        // stale) log form — take them to My Movies and pop that movie's diary entry
        // straight open, so the thing they just wrote is what they land on.
        // A toast carries the confirmation instead of the old success modal, which
        // would otherwise sit on top of the diary entry we just opened.
        async function goToDiaryEntryAfterSave(movieId, kind) {
            const mid = String(movieId || '').trim();
            showToast(String(kind || '').toLowerCase() === 'updated' ? 'Ratings updated!' : 'Ratings saved!');
            try { router.navigate('library'); } catch (_) {}
            if (!mid) return;
            // `fresh: true` — the My Movies cache may still hold the pre-save row while
            // this page's own reload is in flight.
            try { await openLibraryMovieModal(mid, { fresh: true }); } catch (_) {}
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

                // Snapshot which achievements they already had BEFORE this save, so
                // we only celebrate the ones THIS entry earns (DB triggers award
                // synchronously during the insert). Retroactive grants never pop.
                const earnedAchievementIdsBefore = await captureEarnedAchievementIds(authedUser.id);

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

                // Movie details the user may have entered that TMDb/OMDb can lack (e.g.
                // MPA for foreign films, the IMDb rating, runtime/year for obscure titles).
                // These are all sent to the Edge Function as OVERRIDES — the server only
                // uses each to fill a BLANK/missing value on the SHARED movie record, never
                // to overwrite real data. Because they're stored on the shared Movies row
                // (+ Movie External Ratings / Movie Genres), the FIRST person to log a
                // movie fills any gap once and every later user gets it pre-filled.
                const mpaFromForm = String(document.getElementById('fld-mpa')?.value || '').trim();
                const imdbFromForm = String(document.getElementById('fld-imdb')?.value || '').trim();
                const yearFromForm = String(document.getElementById('fld-year')?.value || '').trim();
                const runtimeFromForm = String(document.getElementById('fld-runtime')?.value || '').trim();
                const seriesFromForm = String(document.getElementById('fld-series')?.value || '').trim();
                const genreFromForm = String(document.getElementById('fld-genre')?.value || '').trim();
                const detailOverrides = {
                    mpa: mpaFromForm,
                    imdb: imdbFromForm,
                    year: yearFromForm,
                    runtime: runtimeFromForm,
                    is_series: seriesFromForm,
                    genre: genreFromForm,
                };

                if (!movie_id) {
                    const title = String(document.getElementById('fld-title')?.value || '').trim();
                    const release_year = toNumberOrNull(document.getElementById('fld-year')?.value);

                    if (!title) throw new Error('Title is required.');

                    // TMDb lookup + Movies upsert happens server-side in an Edge Function.
                    // This avoids exposing a TMDb key in the browser and allows Movies to remain read-only under RLS.
                    const tmdbData = await callSwiftApi(
                        { title, release_year: release_year ?? null, sync_people: shouldSyncPeople, ...detailOverrides },
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
                        const peopleRes = await callSwiftApi({ movie_id, sync_people: true, ...detailOverrides }, accessToken);
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
                    const syncRes = await callSwiftApi({ movie_id, sync_people: false, ...detailOverrides }, accessToken);
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
                    // If this movie came from a "Rate Later" draft that already captured
                    // the watch date + method, skip re-asking those — but STILL ask
                    // "have you watched this before?" so the rewatch flow runs.
                    const details = (activeDraftWatch && activeDraftWatch.watch_date)
                        ? await promptWatchDetails({
                            askDateMethod: false,
                            prefillDate: activeDraftWatch.watch_date,
                            prefillMethod: activeDraftWatch.watch_method,
                        })
                        : await promptWatchDetails();
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
                }
                // Updates only change the review fields. Date Watched / Times Watched /
                // Watch Method were removed from the update form (set once when the movie
                // is first logged), so there are no watch inputs to read here.

                if (entryType === 'new' && !watch_date_from_form) {
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

                    // Best-effort: if this movie was on the Bucket List or Recs list,
                    // remove it now that it's been logged/rated.
                    try {
                        await removeMovieFromAutoLists({ user_id: authedUser.id, movie_id });
                    } catch (_) {}

                    popNewlyEarnedAchievements(authedUser.id, earnedAchievementIdsBefore).catch(() => null);

                    // Ratings changed → refresh my taste profile in the background.
                    recomputeMyTasteProfile().catch(() => null);
                    // Drop the "You Might Like" cache so this now-watched movie can't linger.
                    try { invalidateHomeForYouCache(); } catch (_) {}
                    // No stored copy of these pages taken BEFORE this save may be
                    // restored (by Back OR by the forward page cache) — they'd show the
                    // library/feed/account without the rating just made.
                    try { invalidatePageSnapshots(['library', 'feed', 'home', 'lists', 'account', 'leaderboard']); } catch (_) {}

                    await goToDiaryEntryAfterSave(movie_id, 'updated');
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

                // Best-effort: if this movie was on the Bucket List or Recs list,
                // remove it now that it's been logged/rated.
                try {
                    await removeMovieFromAutoLists({ user_id: authedUser.id, movie_id });
                } catch (_) {}

                // Best-effort, fire-and-forget: push-notify everyone who follows me
                // that I posted a NEW review (never on updates — that path returns
                // above). Don't await — the success modal shouldn't wait on it.
                try {
                    if (entryType === 'new') {
                        callSwiftApi({ action: 'notify_new_review', movie_id }, accessToken).catch(() => null);
                    }
                } catch (_) {}

                // Best-effort, fire-and-forget: if anyone recommended THIS movie to me,
                // notify them that I've now reviewed it (deep-links to my review). Fire
                // on the new-entry path — a recommended movie is unwatched, so the first
                // rating is always a new entry.
                try {
                    if (entryType === 'new') {
                        callSwiftApi({ action: 'notify_rec_reviewed', movie_id }, accessToken).catch(() => null);
                    }
                } catch (_) {}

                popNewlyEarnedAchievements(authedUser.id, earnedAchievementIdsBefore).catch(() => null);

                // Ratings changed → refresh my taste profile in the background.
                recomputeMyTasteProfile().catch(() => null);
                // Drop the "You Might Like" cache so this now-watched movie can't linger.
                try { invalidateHomeForYouCache(); } catch (_) {}
                // No stored copy of these pages taken BEFORE this save may be restored
                // (by Back OR by the forward page cache) — they'd show the
                // library/feed/account without the rating just made.
                try { invalidatePageSnapshots(['library', 'feed', 'home', 'lists', 'account', 'leaderboard']); } catch (_) {}

                // Saved successfully → drop the autosaved draft for this movie.
                try { clearDiaryDraftForCurrentForm(); } catch (_) {}

                await goToDiaryEntryAfterSave(movie_id, 'saved');
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

