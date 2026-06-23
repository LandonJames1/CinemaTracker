        const NEW_FEATURES_POPUP_PATH = 'new-features-popup.txt';
        const AI_HELP_POPUP_PATH = 'ai-help-popup.txt';
        const popupTextCache = new Map();
        const THEME_STORAGE_KEY = 'ct_theme';
        const DEFAULT_THEME_OPTIONS = [];
        let themeOptions = DEFAULT_THEME_OPTIONS.slice();
        let themeOptionsById = new Map();
        let themeOptionsByName = new Map();
        let themeColorsById = new Map();
        let themeCreatorThemes = [];

        const THEME_CREATOR_OWNER_EMAIL = 'landon.talus@gmail.com';
        const THEME_CREATOR_PAGES = [
            { value: 'home', label: 'Home' },
            { value: 'ai', label: 'AI' },
            { value: 'lists', label: 'Lists' },
            { value: 'feed', label: 'Feed' },
            { value: 'mymovies', label: 'MyMovies' },
            { value: 'dashboard', label: 'Data Dash' },
        ];

        function formatThemeLabel(raw) {
            const name = String(raw || '').trim();
            if (!name) return '';
            if (/\s/.test(name)) return name;
            return name
                .split(/[-_]/g)
                .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ''))
                .join(' ');
        }

        function normalizeThemeName(raw) {
            return String(raw || '').trim().toLowerCase();
        }

        function buildThemeOptionsFromRows(rows) {
            const items = Array.isArray(rows) ? rows : [];
            return items
                .map((row) => {
                    const id = String(row?.id || '').trim();
                    const name = String(row?.name || '').trim();
                    if (!id || !name) return null;
                    const slug = slugifyThemeCreatorValue(name) || 'theme';
                    return {
                        id,
                        name,
                        value: id,
                        label: name,
                        slug,
                    };
                })
                .filter(Boolean);
        }

        function mergeThemeOptions(baseOptions, extraOptions) {
            const merged = new Map();
            (Array.isArray(baseOptions) ? baseOptions : []).forEach((opt) => {
                if (opt?.value) merged.set(opt.value, opt);
            });
            (Array.isArray(extraOptions) ? extraOptions : []).forEach((opt) => {
                if (opt?.value && !merged.has(opt.value)) merged.set(opt.value, opt);
            });
            return Array.from(merged.values());
        }

        function setThemeOptions(nextOptions) {
            themeOptions = Array.isArray(nextOptions) ? nextOptions : DEFAULT_THEME_OPTIONS.slice();
            themeOptionsById = new Map();
            themeOptionsByName = new Map();
            themeOptions.forEach((opt) => {
                if (opt?.id) themeOptionsById.set(String(opt.id), opt);
                if (opt?.name) themeOptionsByName.set(normalizeThemeName(opt.name), opt);
            });
            themeCreatorThemes = themeOptions.slice();
            updateThemeOptionUIs();
            if (themeCreatorActiveThemeId) {
                setThemeCreatorActiveTheme(themeCreatorActiveThemeId);
            }
        }

        function setThemeColorsMap(rows) {
            const next = new Map();
            const items = Array.isArray(rows) ? rows : [];
            items.forEach((row) => {
                const id = String(row?.id || '').trim();
                if (!id) return;
                const colors = row?.colors && typeof row.colors === 'object' ? row.colors : null;
                if (colors) next.set(id, colors);
            });
            themeColorsById = next;
        }

        function updateThemeOptionUIs() {
            const accountSelect = document.getElementById('account-theme-select');
            if (accountSelect) {
                const current = String(accountSelect.value || getStoredTheme()).trim();
                accountSelect.innerHTML = buildThemeCreatorOptions(themeOptions, current);
                if (current) accountSelect.value = current;
            }

            document.querySelectorAll('select[data-theme-creator-select="theme"]').forEach((select) => {
                if (!(select instanceof HTMLSelectElement)) return;
                const current = String(select.value || '').trim();
                select.innerHTML = buildThemeCreatorOptions(themeCreatorThemes, current);
                if (current) select.value = current;
            });

            const editSelect = document.getElementById('theme-creator-edit-select');
            if (editSelect && editSelect instanceof HTMLSelectElement) {
                const current = String(editSelect.value || '').trim();
                editSelect.innerHTML = buildThemeCreatorOptions(themeCreatorThemes, current);
                if (current) editSelect.value = current;
            }
        }

        async function loadThemeOptions() {
            const defaults = DEFAULT_THEME_OPTIONS.slice();
            if (!supabaseClient) {
                setThemeOptions(defaults);
                return;
            }

            let rows = null;
            try {
                const { data, error } = await supabaseClient
                    .from('Themes')
                    .select('id, name, colors');
                if (error) throw error;
                rows = data;
            } catch (_) {
                setThemeOptions(defaults);
                return;
            }

            const extras = buildThemeOptionsFromRows(rows);
            setThemeColorsMap(rows);
            setThemeOptions(mergeThemeOptions(defaults, extras));
        }

        function getThemeCreatorThemeOptions() {
            return themeCreatorThemes;
        }

        function getThemeOptionById(themeId) {
            if (!themeId) return null;
            return themeOptionsById.get(String(themeId)) || null;
        }

        function getThemeOptionByName(name) {
            const key = normalizeThemeName(name);
            return themeOptionsByName.get(key) || null;
        }

        function addThemeOptionLocal(option) {
            if (!option?.id || !option?.name) return;
            const next = Array.isArray(themeOptions) ? themeOptions.slice() : [];
            const idx = next.findIndex((opt) => String(opt?.value || '') === String(option.value));
            if (idx >= 0) {
                next[idx] = { ...next[idx], ...option };
            } else {
                next.push(option);
            }
            setThemeOptions(next);
        }

        function setThemeCreatorThemeStatus(message, level = 'info') {
            const el = document.getElementById('theme-creator-theme-status');
            if (!el) return;
            el.textContent = String(message || '').trim();
            if (level === 'error') el.style.color = 'rgba(239,68,68,0.95)';
            else if (level === 'success') el.style.color = 'rgba(16,185,129,0.9)';
            else el.style.color = 'rgba(255,255,255,0.60)';
        }

        function setThemeCreatorStep(step) {
            const next = Number(step) || 1;
            themeCreatorStep = next;
            const steps = [
                { id: 'theme-creator-step-mode', step: 1 },
                { id: 'theme-creator-step-name', step: 2 },
                { id: 'theme-creator-step-backdrops', step: 3 },
                { id: 'theme-creator-step-ai', step: 4 },
                { id: 'theme-creator-step-prompt', step: 5 },
            ];
            steps.forEach((item) => {
                const el = document.getElementById(item.id);
                if (!el) return;
                el.classList.toggle('hidden', item.step !== next);
            });
        }

        function setThemeCreatorMode(mode) {
            const createPanel = document.getElementById('theme-creator-create-panel');
            const editPanel = document.getElementById('theme-creator-edit-panel');
            const createBtn = document.getElementById('theme-creator-mode-create');
            const editBtn = document.getElementById('theme-creator-mode-edit');
            const next = mode === 'edit' ? 'edit' : 'create';
            if (createPanel) createPanel.classList.toggle('hidden', next !== 'create');
            if (editPanel) editPanel.classList.toggle('hidden', next !== 'edit');
            if (createBtn) createBtn.classList.toggle('btn-primary', next === 'create');
            if (createBtn) createBtn.classList.toggle('btn-outline', next !== 'create');
            if (editBtn) editBtn.classList.toggle('btn-primary', next === 'edit');
            if (editBtn) editBtn.classList.toggle('btn-outline', next !== 'edit');
            themeCreatorMode = next;
            if (next === 'create') {
                themeCreatorExisting = [];
                renderThemeCreatorBackdrops(themeCreatorBackdrops);
            }
        }

        function setThemeCreatorActiveTheme(themeId) {
            themeCreatorActiveThemeId = themeId || null;
            const opt = getThemeOptionById(themeCreatorActiveThemeId);
            themeCreatorActiveThemeName = String(opt?.name || '').trim();
            const editSelect = document.getElementById('theme-creator-edit-select');
            const editName = document.getElementById('theme-creator-edit-name');
            const activeLabel = document.getElementById('theme-creator-active-name');
            if (editSelect && themeCreatorActiveThemeId) {
                editSelect.value = String(themeCreatorActiveThemeId);
            }
            if (editName) editName.value = themeCreatorActiveThemeName;
            if (activeLabel) activeLabel.textContent = themeCreatorActiveThemeName || 'None';
            renderThemeCreatorSelected();
            if (themeCreatorMode === 'edit' && themeCreatorActiveThemeId) {
                loadThemeCreatorExistingBackdrops(themeCreatorActiveThemeId).catch(() => null);
            }
        }

        function getThemeCreatorStylePrompt() {
            const input = document.getElementById('theme-creator-style-prompt');
            return String(input?.value || '').trim();
        }

        async function generateThemeCreatorColors({ themeId, themeName, stylePrompt }) {
            if (!supabaseClient || !themeCreatorAiMovie?.tmdb_id) return false;

            try {
                const { data } = await supabaseClient.auth.getSession();
                const token = data?.session?.access_token;
                if (!token) throw new Error('Missing session token.');

                let details = null;
                try {
                    details = await callSwiftApiGetMovieDetails({ tmdb_id: Number(themeCreatorAiMovie.tmdb_id) });
                } catch (_) {
                    details = null;
                }

                const genres = Array.isArray(details?.genres)
                    ? details.genres.map((g) => String(g).trim()).filter(Boolean)
                    : [];
                const overview = String(details?.overview || '').trim();
                const year = Number(details?.year ?? themeCreatorAiMovie?.year ?? null);
                const movieYear = Number.isFinite(year) ? year : null;

                const payload = {
                    theme_id: themeId,
                    theme_name: themeName,
                    movie_title: String(details?.title || themeCreatorAiMovie?.title || '').trim(),
                    movie_year: movieYear,
                    movie_genres: genres,
                    movie_overview: overview,
                    style_prompt: String(stylePrompt || '').trim(),
                };

                setThemeCreatorThemeStatus('Generating theme colors…');
                const result = await callColorThemeEdge(payload, token);
                if (result?.colors && typeof result.colors === 'object') {
                    themeColorsById.set(String(themeId), result.colors);
                    if (String(getStoredTheme()) === String(themeId)) {
                        applyTheme(themeId);
                    }
                }
                setThemeCreatorThemeStatus('Theme colors generated.', 'success');
                showToast('Theme colors generated.', { level: 'success' });
                return true;
            } catch (err) {
                setThemeCreatorThemeStatus(`Color generation failed: ${String(err?.message || err)}`, 'error');
                showToast(`Color generation failed: ${String(err?.message || err)}`, { level: 'warn' });
                return false;
            }
        }

        async function createThemeCreatorTheme({ advance = true } = {}) {
            if (guardGuestWrite()) return;
            const input = document.getElementById('theme-creator-new-name');
            const btn = document.getElementById('theme-creator-create-btn');
            const name = String(input?.value || '').trim();

            if (!name) {
                setThemeCreatorThemeStatus('Enter a theme name first.', 'error');
                return;
            }


            if (getThemeOptionByName(name)) {
                setThemeCreatorThemeStatus('That theme already exists.', 'error');
                return;
            }

            if (!supabaseClient) {
                setThemeCreatorThemeStatus('Supabase SDK failed to load.', 'error');
                return;
            }

            if (btn) {
                btn.disabled = true;
                btn.style.opacity = 0.7;
            }
            setThemeCreatorThemeStatus('Creating theme…');

            try {
                const { data, error } = await supabaseClient
                    .from('Themes')
                    .insert({ name })
                    .select('id, name')
                    .single();
                if (error) throw error;

                const themeId = String(data?.id || '').trim();
                const themeName = String(data?.name || '').trim() || name;
                if (!themeId) throw new Error('Theme id missing.');

                addThemeOptionLocal({
                    id: themeId,
                    name: themeName,
                    value: themeId,
                    label: themeName,
                    slug: slugifyThemeCreatorValue(themeName) || 'theme',
                });

                if (input) input.value = '';
                setThemeCreatorActiveTheme(themeId);
                setThemeCreatorMode('edit');
                setThemeCreatorThemeStatus('Theme created.', 'success');
                showToast('Theme created.', { level: 'success' });
                if (advance) setThemeCreatorStep(3);
            } catch (err) {
                const msg = String(err?.message || err);
                if (/duplicate key|already exists|unique/i.test(msg)) {
                    setThemeCreatorThemeStatus('That theme already exists.', 'error');
                } else {
                    setThemeCreatorThemeStatus(`Create failed: ${msg}`, 'error');
                }
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.style.opacity = 1;
                }
            }
        }

        async function updateThemeCreatorThemeName() {
            const select = document.getElementById('theme-creator-edit-select');
            const input = document.getElementById('theme-creator-edit-name');
            const btn = document.getElementById('theme-creator-update-btn');
            const themeId = String(select?.value || '').trim();
            const name = String(input?.value || '').trim();

            if (!themeId) {
                setThemeCreatorThemeStatus('Select a theme first.', 'error');
                return;
            }

            if (!name) {
                setThemeCreatorThemeStatus('Enter a new name.', 'error');
                return;
            }


            const existing = getThemeOptionByName(name);
            if (existing && String(existing.id) !== themeId) {
                setThemeCreatorThemeStatus('That theme name already exists.', 'error');
                return;
            }

            if (!supabaseClient) {
                setThemeCreatorThemeStatus('Supabase SDK failed to load.', 'error');
                return;
            }

            if (btn) {
                btn.disabled = true;
                btn.style.opacity = 0.7;
            }
            setThemeCreatorThemeStatus('Updating theme…');

            try {
                const { error } = await supabaseClient
                    .from('Themes')
                    .update({ name })
                    .eq('id', themeId);
                if (error) throw error;

                addThemeOptionLocal({
                    id: themeId,
                    name,
                    value: themeId,
                    label: name,
                    slug: slugifyThemeCreatorValue(name) || 'theme',
                });
                setThemeCreatorActiveTheme(themeId);
                setThemeCreatorThemeStatus('Theme updated.', 'success');
                showToast('Theme updated.', { level: 'success' });
            } catch (err) {
                const msg = String(err?.message || err);
                setThemeCreatorThemeStatus(`Update failed: ${msg}`, 'error');
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.style.opacity = 1;
                }
            }
        }

        async function loadThemeBackgroundImages() {
            if (!supabaseClient) return;
            try {
                let data = null;
                try {
                    const res = await supabaseClient
                        .from('Background Images')
                        .select('theme_id, url, page');
                    if (res.error) throw res.error;
                    data = res.data;
                } catch (err) {
                    const msg = String(err?.message || err);
                    if (/column\s+"?theme_id"?\s+does\s+not\s+exist/i.test(msg)) {
                        const res2 = await supabaseClient
                            .from('Background Images')
                            .select('theme_id, url, page');
                        if (res2.error) throw res2.error;
                        data = res2.data;
                    } else {
                        throw err;
                    }
                }

                const rows = Array.isArray(data) ? data : [];
                const rules = [];

                const normalizePage = (raw) => {
                    const s = String(raw || '').trim().toLowerCase();
                    const compact = s.replace(/\s+/g, '');
                    if (!s) return '';
                    if (s === 'home') return 'home';
                    if (s === 'ai') return 'ai_picks';
                    if (s === 'lists') return 'lists';
                    if (s === 'feed') return 'feed';
                    if (s === 'mymovies') return 'library';
                    if (s === 'dashboard' || s === 'dashboard_kpi' || s === 'dashboard_pie_filter' || s === 'data' || compact === 'datadash' || compact === 'dashboardkpi' || compact === 'dashboardpiefilter') return 'dashboard';
                    return '';
                };

                const buildPageSelectors = (pageKey) => {
                    if (!pageKey) return [];
                    if (pageKey === 'dashboard') return ['dashboard', 'dashboard_kpi', 'dashboard_pie_filter'];
                    return [pageKey];
                };

                rows.forEach((row) => {
                    const themeIdRaw = row?.theme_id ?? null;
                    const themeId = String(themeIdRaw || '').trim();
                    const urlRaw = String(row?.url || '').trim();
                    const pageRaw = normalizePage(row?.page);
                    if (!urlRaw) return;

                    const urlEscaped = urlRaw.replace(/"/g, '\\"');
                    const pages = buildPageSelectors(pageRaw);
                    if (!pages.length) return;

                    if (!themeId) {
                        pages.forEach((pageKey) => {
                            rules.push(`body[data-page="${pageKey}"]{--bg-image:url("${urlEscaped}");}`);
                        });
                        return;
                    }

                    pages.forEach((pageKey) => {
                        rules.push(`body[data-theme-id="${themeId}"][data-page="${pageKey}"]{--bg-image:url("${urlEscaped}");}`);
                    });
                });

                const styleId = 'theme-background-images';
                let styleEl = document.getElementById(styleId);
                if (!styleEl) {
                    styleEl = document.createElement('style');
                    styleEl.id = styleId;
                    document.head.appendChild(styleEl);
                }
                styleEl.textContent = rules.join('\n');
            } catch (_) {
                // No fallback if load fails.
            }
        }

        function getStoredTheme() {
            try {
                const raw = String(localStorage.getItem(THEME_STORAGE_KEY) || '').trim();
                return raw || '';
            } catch (_) {
                return '';
            }
        }

        function resolveThemeId(input) {
            const candidate = String(input || '').trim();
            if (candidate && themeOptionsById.has(candidate)) return candidate;
            const first = themeOptions[0];
            return String(first?.value || first?.id || '').trim();
        }

        function parseColorToRgb(input) {
            const raw = String(input || '').trim();
            if (!raw) return null;
            if (raw.startsWith('#')) {
                let hex = raw.slice(1);
                if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
                if (hex.length === 6) {
                    const num = parseInt(hex, 16);
                    if (!Number.isFinite(num)) return null;
                    return {
                        r: (num >> 16) & 255,
                        g: (num >> 8) & 255,
                        b: num & 255,
                    };
                }
                return null;
            }
            const rgbMatch = raw.match(/rgba?\s*\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/i);
            if (rgbMatch) {
                return {
                    r: Number(rgbMatch[1]),
                    g: Number(rgbMatch[2]),
                    b: Number(rgbMatch[3]),
                };
            }
            return null;
        }

        function rgbToHsl(rgb) {
            const r = Math.max(0, Math.min(255, Number(rgb?.r))) / 255;
            const g = Math.max(0, Math.min(255, Number(rgb?.g))) / 255;
            const b = Math.max(0, Math.min(255, Number(rgb?.b))) / 255;
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const delta = max - min;

            let h = 0;
            if (delta > 0) {
                if (max === r) h = ((g - b) / delta) % 6;
                else if (max === g) h = (b - r) / delta + 2;
                else h = (r - g) / delta + 4;
                h = Math.round(h * 60);
                if (h < 0) h += 360;
            }
            const l = (max + min) / 2;
            const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
            return {
                h,
                s: Math.round(s * 100),
            };
        }

        function applyThemeColors(colors) {
            const c = colors && typeof colors === 'object' ? colors : null;
            if (!c) {
                showToast('Theme colors are missing. Add colors in Supabase.', { level: 'warn' });
                return;
            }
            const root = document.documentElement;

            const makeGlassSlightlyLessTransparent = (value, alphaBoost = 0.06) => {
                const raw = String(value || '').trim();
                if (!raw) return raw;
                const boost = Math.max(0, Number(alphaBoost) || 0);

                const clampAlpha = (a) => Math.max(0, Math.min(0.96, a));

                const rgbaMatch = raw.match(/^rgba\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d*\.?\d+)\s*\)$/i);
                if (rgbaMatch) {
                    const r = Math.max(0, Math.min(255, Number(rgbaMatch[1])));
                    const g = Math.max(0, Math.min(255, Number(rgbaMatch[2])));
                    const b = Math.max(0, Math.min(255, Number(rgbaMatch[3])));
                    const a = clampAlpha(Number(rgbaMatch[4]) + boost);
                    return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
                }

                const hslaMatch = raw.match(/^hsla\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)%\s*,\s*(\d+(?:\.\d+)?)%\s*,\s*(\d*\.?\d+)\s*\)$/i);
                if (hslaMatch) {
                    const h = Number(hslaMatch[1]);
                    const s = Number(hslaMatch[2]);
                    const l = Number(hslaMatch[3]);
                    const a = clampAlpha(Number(hslaMatch[4]) + boost);
                    return `hsla(${h}, ${s}%, ${l}%, ${a.toFixed(3)})`;
                }

                return raw;
            };

            const base = {
                bg_dark: String(c.bg_dark || '').trim(),
                surface: String(c.surface || '').trim(),
                border: String(c.border || '').trim(),
                text_main: String(c.text_main || '').trim(),
                text_muted: String(c.text_muted || '').trim(),
                brand: String(c.brand || '').trim(),
                brand_hover: String(c.brand_hover || '').trim(),
                brand_2: String(c.brand_2 || '').trim(),
                brand_3: String(c.brand_3 || '').trim(),
                accent_1: String(c.accent_1 || '').trim(),
                accent_2: String(c.accent_2 || '').trim(),
                nav_accent: String(c.nav_accent || '').trim(),
                nav_title: String(c.nav_title || '').trim(),
            };

            if (base.bg_dark) root.style.setProperty('--bg-dark', base.bg_dark);
            if (base.surface) root.style.setProperty('--surface', base.surface);
            if (base.border) root.style.setProperty('--border', base.border);
            if (base.text_main) root.style.setProperty('--text-main', base.text_main);
            if (base.text_muted) root.style.setProperty('--text-muted', base.text_muted);
            if (base.brand) root.style.setProperty('--brand', base.brand);
            if (base.brand_hover) root.style.setProperty('--brand-hover', base.brand_hover);
            if (base.brand_2) root.style.setProperty('--brand-2', base.brand_2);
            if (base.brand_3) root.style.setProperty('--brand-3', base.brand_3);
            if (base.accent_1) root.style.setProperty('--accent-1', base.accent_1);
            if (base.accent_2) root.style.setProperty('--accent-2', base.accent_2);
            if (base.nav_accent) root.style.setProperty('--nav-accent', base.nav_accent);
            if (base.nav_title) root.style.setProperty('--nav-title', base.nav_title);

            const derived = {
                brand_light: String(c.brand_light || '').trim(),
                brand_shadow: String(c.brand_shadow || '').trim(),
                nav_active_a: String(c.nav_active_a || '').trim(),
                nav_active_b: String(c.nav_active_b || '').trim(),
                glass_bg: String(c.glass_bg || '').trim(),
                glass_border: String(c.glass_border || '').trim(),
                glass_shadow: String(c.glass_shadow || '').trim(),
                btn_outline_bg: String(c.btn_outline_bg || '').trim(),
                focus_ring: String(c.focus_ring || '').trim(),
                bg_overlay: String(c.bg_overlay || '').trim(),
            };

            if (derived.brand_light) root.style.setProperty('--brand-light', derived.brand_light);
            if (derived.brand_shadow) root.style.setProperty('--brand-shadow', derived.brand_shadow);
            if (derived.nav_active_a) root.style.setProperty('--nav-active-a', derived.nav_active_a);
            if (derived.nav_active_b) root.style.setProperty('--nav-active-b', derived.nav_active_b);
            if (derived.glass_bg) root.style.setProperty('--glass-bg', makeGlassSlightlyLessTransparent(derived.glass_bg, 0.2));
            if (derived.glass_border) root.style.setProperty('--glass-border', derived.glass_border);
            if (derived.glass_shadow) root.style.setProperty('--glass-shadow', derived.glass_shadow);
            if (derived.btn_outline_bg) root.style.setProperty('--btn-outline-bg', derived.btn_outline_bg);
            if (derived.focus_ring) root.style.setProperty('--focus-ring', derived.focus_ring);
            if (derived.bg_overlay) root.style.setProperty('--bg-overlay', derived.bg_overlay);

            const heatmapSeed = base.accent_1 || base.accent_2 || base.brand || '';
            const rgb = parseColorToRgb(heatmapSeed);
            if (rgb) {
                const hsl = rgbToHsl(rgb);
                if (Number.isFinite(hsl?.h)) root.style.setProperty('--heatmap-h', String(hsl.h));
                if (Number.isFinite(hsl?.s)) root.style.setProperty('--heatmap-s', `${hsl.s}%`);
            }
        }

        function applyTheme(theme) {
            const t = resolveThemeId(theme);
            if (!t) return;
            document.body.setAttribute('data-theme-id', t);
            const colors = themeColorsById.get(String(t)) || null;
            applyThemeColors(colors);
            loadNavLogoForTheme(t);
            try { localStorage.setItem(THEME_STORAGE_KEY, t); } catch (_) {}
            const select = document.getElementById('account-theme-select');
            if (select) {
                const hasOption = Array.from(select.options || []).some((opt) => opt.value === t);
                if (!hasOption) {
                    const label = getThemeOptionById(t)?.name || formatThemeLabel(t);
                    const opt = document.createElement('option');
                    opt.value = t;
                    opt.textContent = label;
                    select.appendChild(opt);
                }
                select.value = t;
            }
        }

        async function saveAccountThemeSelection(themeId) {
            if (!supabaseClient || !cachedIsAuthed) return;
            const uid = String(cachedAuthUser?.id || '').trim();
            if (!uid) return;
            const value = themeId || null;
            try {
                const { error } = await supabaseClient
                    .from('Users')
                    .update({ theme_id: value })
                    .eq('id', uid);
                if (error) throw error;
            } catch (err) {
                const msg = String(err?.message || err);
                if (!/column\s+"?theme_id"?\s+does\s+not\s+exist/i.test(msg)) {
                    showToast(`Theme update failed: ${msg}`, { level: 'warn' });
                }
            }
        }

        function canAccessThemeCreator(email) {
            const e = String(email || cachedAuthUser?.email || '').trim().toLowerCase();
            const allowed = String(THEME_CREATOR_OWNER_EMAIL || '').trim().toLowerCase();
            return Boolean(e && allowed && e === allowed);
        }

        function updateThemeCreatorVisibility(email) {
            const card = document.getElementById('theme-creator-card');
            if (!card) return;
            const canView = canAccessThemeCreator(email);
            card.classList.toggle('hidden', !canView);
        }

        function fallbackAccountName(user) {
            const email = String(user?.email || '').trim();
            if (email) return email.split('@')[0] || email;

            const id = String(user?.id || '').trim();
            if (!id) return '';
            return id.length > 8 ? `${id.slice(0, 8)}…` : id;
        }

        async function refreshAuthStateAndUI() {
            if (!supabaseClient) return;
            // Don't override state while in guest/demo mode
            if (guestMode) return;

            const navLoginBtn = document.getElementById('nav-login-btn');
            const statusEl = document.getElementById('auth-modal-status');
            const loginBtn = document.getElementById('auth-login-btn');
            const logoutBtn = document.getElementById('auth-logout-btn');
            const emailEl = document.getElementById('auth-email');
            const pwdEl = document.getElementById('auth-password');
            const saveBtn = document.getElementById('btn-save-diary');

            const { data, error } = await supabaseClient.auth.getSession();
            if (error) {
                cachedAuthUser = null;
                cachedIsAuthed = false;
                if (statusEl) statusEl.textContent = 'Auth error.';
                if (statusEl) statusEl.style.color = 'rgba(239,68,68,0.95)';
                if (navLoginBtn) {
                    navLoginBtn.textContent = 'Login';
                    navLoginBtn.classList.remove('icon-only');
                    navLoginBtn.removeAttribute('aria-label');
                }
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.style.opacity = 0.6;
                    saveBtn.setAttribute('aria-disabled', 'true');
                    saveBtn.title = 'Please log in first.';
                }
                return;
            }

            const user = data?.session?.user || null;
            const isAuthed = Boolean(user?.id);

            cachedAuthUser = user;
            cachedIsAuthed = isAuthed;

            // The message-log FAB (bottom-left) is an admin-only debug tool; the
            // admin can also hide it via the Account → Admin toggle (per-device).
            applyLogFabVisibility();

            if (isAuthed) {
                const uid = String(user.id);
                // Best-effort; don't block UI.
                ensureBucketListForUser({ user_id: uid }).catch(() => null);
            } else {
                cachedLists = [];
                cachedListsUserId = null;
                listsActiveListId = null;
                listsActiveListName = '';
                cachedBucketListId = null;
                bucketListEnsuredForUserId = null;
                cachedUserDisplayNameId = null;
                cachedUserDisplayName = '';
                cachedUserDisplayNameLoaded = false;
                cachedUserIconId = null;
                cachedUserIcon = '';
                cachedUserIconLoaded = false;
            }

            let displayName = '';
            if (isAuthed) {
                const uid = String(user.id);
                if (cachedUserDisplayNameId !== uid) {
                    cachedUserDisplayNameId = uid;
                    cachedUserDisplayName = '';
                    cachedUserDisplayNameLoaded = false;
                    cachedUserIconId = uid;
                    cachedUserIcon = '';
                    cachedUserIconLoaded = false;
                }

                if (!cachedUserDisplayNameLoaded || !cachedUserIconLoaded) {
                    cachedUserDisplayNameLoaded = true;
                    cachedUserIconLoaded = true;
                    try {
                        let usersRows = null;
                        try {
                            const res = await supabaseClient
                                .from('Users')
                                .select('display_name, icon, theme_id')
                                .eq('id', uid)
                                .limit(1);
                            if (res.error) throw res.error;
                            usersRows = res.data;
                        } catch (err) {
                            const msg = String(err?.message || err);
                            if (/column\s+"?theme_id"?\s+does\s+not\s+exist/i.test(msg)) {
                                const res2 = await supabaseClient
                                    .from('Users')
                                    .select('display_name, icon')
                                    .eq('id', uid)
                                    .limit(1);
                                if (!res2.error) usersRows = res2.data;
                            }
                        }

                        if (Array.isArray(usersRows) && usersRows.length > 0) {
                            cachedUserDisplayName = String(usersRows[0]?.display_name || '').trim();
                            cachedUserIcon = String(usersRows[0]?.icon || '').trim();
                            const themeId = String(usersRows[0]?.theme_id || '').trim();
                            if (themeId) applyTheme(themeId);
                        }
                    } catch (_) {
                        try {
                            const { data: usersRows, error: usersErr } = await supabaseClient
                                .from('Users')
                                .select('display_name')
                                .eq('id', uid)
                                .limit(1);
                            if (!usersErr && Array.isArray(usersRows) && usersRows.length > 0) {
                                cachedUserDisplayName = String(usersRows[0]?.display_name || '').trim();
                            }
                        } catch (_) {
                            // RLS or missing table: fall back silently.
                        }
                    }
                }

                displayName = String(cachedUserDisplayName || '').trim();
            }

            if (navLoginBtn) {
                if (isAuthed) {
                    const dn = displayName || fallbackAccountName(user);
                    const iconId = String(cachedUserIcon || '').trim();
                    if (iconId) {
                        // Only rebuild the avatar <img> when the icon actually changes —
                        // re-setting innerHTML on every navigation re-decodes the (data-URL)
                        // image and visibly flashes/shifts the header. Idempotent now.
                        if (navLoginBtn.dataset.avatarIcon !== iconId) {
                            navLoginBtn.innerHTML = renderUserIconHtml(iconId, 60);
                            navLoginBtn.dataset.avatarIcon = iconId;
                        }
                        navLoginBtn.classList.add('icon-only');
                        navLoginBtn.setAttribute('aria-label', dn ? `Account: ${dn}` : 'Account');
                    } else {
                        navLoginBtn.textContent = dn ? `${dn} - Account` : 'Account';
                        navLoginBtn.classList.remove('icon-only');
                        navLoginBtn.removeAttribute('aria-label');
                        delete navLoginBtn.dataset.avatarIcon;
                    }
                } else {
                    navLoginBtn.textContent = 'Login';
                    navLoginBtn.classList.remove('icon-only');
                    navLoginBtn.removeAttribute('aria-label');
                    delete navLoginBtn.dataset.avatarIcon;
                }
            }

            const mobileAuthBtn = document.getElementById('mobile-auth-btn');
            if (mobileAuthBtn) {
                mobileAuthBtn.textContent = isAuthed
                    ? (displayName ? `${displayName} - Account` : 'Account')
                    : 'Login';
            }
            // Mobile tab bar "More" sheet auth row mirrors the same label.
            const moreAuthBtn = document.getElementById('more-auth-btn');
            if (moreAuthBtn) {
                const moreAuthLabel = moreAuthBtn.querySelector('.more-sheet-label') || moreAuthBtn;
                moreAuthLabel.textContent = isAuthed
                    ? (displayName ? `${displayName} - Account` : 'Account')
                    : 'Login';
            }
            if (statusEl) {
                if (isAuthed) {
                    const dn = displayName || fallbackAccountName(user);
                    statusEl.textContent = dn ? `Logged in as ${dn}` : `Logged in as ${user.email || user.id}`;
                } else {
                    statusEl.textContent = 'Not logged in.';
                }
                statusEl.style.color = 'var(--text-muted)';
            }
            if (loginBtn) loginBtn.style.display = isAuthed ? 'none' : (authMode === 'login' ? 'inline-flex' : 'none');
            if (logoutBtn) logoutBtn.style.display = isAuthed ? 'inline-flex' : 'none';

            // Hide sign-up UI when logged in or sign-ups disabled
            const tabBar = document.getElementById('auth-tab-bar');
            const signupFields = document.getElementById('auth-signup-fields');
            const signupBtnEl = document.getElementById('auth-signup-btn');
            const demoBtn = document.getElementById('auth-demo-btn');
            if (isAuthed || !siteSignupEnabled) {
                if (tabBar) tabBar.style.display = 'none';
                if (signupFields) signupFields.style.display = 'none';
                if (signupBtnEl) signupBtnEl.style.display = 'none';
            } else {
                if (tabBar) tabBar.style.display = 'flex';
            }
            // Demo button: visible only when NOT logged in
            if (demoBtn) demoBtn.style.display = isAuthed ? 'none' : '';

            if (emailEl) {
                emailEl.disabled = isAuthed;
                emailEl.classList.toggle('input-readonly', isAuthed);
            }
            if (pwdEl) {
                pwdEl.disabled = isAuthed;
                pwdEl.classList.toggle('input-readonly', isAuthed);
            }

            if (saveBtn) {
                const locked = !isAuthed;
                saveBtn.disabled = false;
                saveBtn.style.opacity = locked ? 0.6 : 1;
                saveBtn.setAttribute('aria-disabled', locked ? 'true' : 'false');
                saveBtn.title = locked ? 'Please log in first.' : '';
            }

            if (isAuthed) {
                showNewFeaturesPopupIfNeeded().catch(() => null);
                if (String(router?.currentPage || '') === 'ai_picks') {
                    showAiHelpPopupIfNeeded().catch(() => null);
                }
            }
        }

        async function fetchHelpPopupsRow(userId) {
            const uid = String(userId || '').trim();
            if (!uid || !supabaseClient) return null;
            try {
                const { data, error } = await supabaseClient
                    .from('Help Pop-ups')
                    .select('user_id, "AI Picks Help", "New Feature News"')
                    .eq('user_id', uid)
                    .limit(1);
                if (error) throw error;
                return Array.isArray(data) && data.length > 0 ? data[0] : null;
            } catch (_) {
                return null;
            }
        }

        async function ensureHelpPopupsRow(userId) {
            const uid = String(userId || '').trim();
            if (!uid || !supabaseClient) return;
            try {
                await supabaseClient
                    .from('Help Pop-ups')
                    .upsert({ user_id: uid }, { onConflict: 'user_id' });
            } catch (_) {
                // Best-effort only.
            }
        }

        async function getHelpPopupFlags(userId) {
            const uid = String(userId || '').trim();
            if (!uid) return { known: false, aiPicksHelp: false, newFeaturesNews: false };
            let row = await fetchHelpPopupsRow(uid);
            if (!row) {
                await ensureHelpPopupsRow(uid);
                row = await fetchHelpPopupsRow(uid);
            }
            if (!row) return { known: false, aiPicksHelp: false, newFeaturesNews: false };
            return {
                known: true,
                aiPicksHelp: row?.['AI Picks Help'] === true,
                newFeaturesNews: row?.['New Feature News'] === true,
            };
        }

        async function setHelpPopupFlag(userId, updates = {}) {
            const uid = String(userId || '').trim();
            if (!uid || !supabaseClient) return;
            const payload = { user_id: uid };
            if (updates.aiPicksHelp !== undefined) payload['AI Picks Help'] = Boolean(updates.aiPicksHelp);
            if (updates.newFeaturesNews !== undefined) payload['New Feature News'] = Boolean(updates.newFeaturesNews);
            try {
                await supabaseClient
                    .from('Help Pop-ups')
                    .upsert(payload, { onConflict: 'user_id' });
            } catch (_) {
                // Best-effort only.
            }
        }

        async function loadPopupTextFile(path) {
            const p = String(path || '').trim();
            if (!p) return '';
            if (popupTextCache.has(p)) return popupTextCache.get(p) || '';
            try {
                const res = await fetch(p, { cache: 'no-cache' });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const text = await res.text();
                popupTextCache.set(p, text);
                return text;
            } catch (_) {
                return '';
            }
        }

        async function setPopupText(elId, path) {
            const el = document.getElementById(elId);
            if (!el) return;
            const text = await loadPopupTextFile(path);
            if (text) {
                el.innerHTML = text;
            } else {
                el.textContent = 'Unable to load content.';
            }
        }

        function openNewFeaturesPopup() {
            const overlay = document.getElementById('new-features-overlay');
            if (!overlay) return;
            setPopupText('new-features-popup-text', NEW_FEATURES_POPUP_PATH).catch(() => null);
            overlay.style.display = 'flex';
            overlay.classList.add('open');
            try {
                const box = document.getElementById('new-features-dismiss');
                if (box) box.checked = true;
            } catch (_) {}
        }

        function closeNewFeaturesPopup() {
            const overlay = document.getElementById('new-features-overlay');
            if (!overlay) return;
            overlay.classList.remove('open');
            overlay.style.display = 'none';
            try {
                const uid = String(cachedAuthUser?.id || '').trim();
                if (uid) {
                    setHelpPopupFlag(uid, { newFeaturesNews: true }).catch(() => null);
                }
            } catch (_) {
                // Best-effort only.
            }
        }

        function openAiHelpPopup() {
            const overlay = document.getElementById('ai-help-overlay');
            if (!overlay) return;
            setPopupText('ai-help-popup-text', AI_HELP_POPUP_PATH).catch(() => null);
            overlay.style.display = 'flex';
            overlay.classList.add('open');
        }

        function closeAiHelpPopup() {
            const overlay = document.getElementById('ai-help-overlay');
            if (!overlay) return;
            overlay.classList.remove('open');
            overlay.style.display = 'none';

            try {
                const box = document.getElementById('ai-help-dismiss');
                const checked = Boolean(box?.checked);
                const uid = String(cachedAuthUser?.id || '').trim();
                if (checked && uid) {
                    setHelpPopupFlag(uid, { aiPicksHelp: true }).catch(() => null);
                }
            } catch (_) {
                // Best-effort only.
            }
        }

        async function showNewFeaturesPopupIfNeeded() {
            if (!cachedIsAuthed) return;
            const uid = String(cachedAuthUser?.id || '').trim();
            if (!uid) return;
            const state = await getHelpPopupFlags(uid);
            if (!state.known || state.newFeaturesNews !== false) return;
            openNewFeaturesPopup();
            setHelpPopupFlag(uid, { newFeaturesNews: true }).catch(() => null);
        }

        async function showAiHelpPopupIfNeeded() {
            if (!cachedIsAuthed) return;
            const uid = String(cachedAuthUser?.id || '').trim();
            if (!uid) return;
            const state = await getHelpPopupFlags(uid);
            if (!state.known || state.aiPicksHelp !== false) return;
            const box = document.getElementById('ai-help-dismiss');
            if (box) box.checked = false;
            openAiHelpPopup();
        }

