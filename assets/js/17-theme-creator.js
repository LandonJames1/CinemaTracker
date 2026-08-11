        let themeCreatorBackdropSearchItems = [];
        let themeCreatorBackdropSearchDebounceTimer = null;
        let themeCreatorBackdropSearchAbortController = null;
        let themeCreatorBackdropAbortController = null;
        let themeCreatorAiSearchItems = [];
        let themeCreatorAiSearchDebounceTimer = null;
        let themeCreatorAiSearchAbortController = null;
        let themeCreatorBackdrops = [];
        let themeCreatorExisting = [];
        let themeCreatorSelected = [];
        let themeCreatorBackdropMovie = null;
        let themeCreatorAiMovie = null;
        let themeCreatorStep = 1;
        let themeCreatorMode = 'create';
        let themeCreatorActiveThemeId = null;
        let themeCreatorActiveThemeName = '';
        let themeCreatorBound = false;
        let themeCreatorBackdropDropdownDocked = false;
        let themeCreatorBackdropDropdownParent = null;
        let themeCreatorAiDropdownDocked = false;
        let themeCreatorAiDropdownParent = null;

        function buildThemeCreatorOptions(options, selected) {
            const selectedVal = String(selected || '').trim();
            return options
                .map((opt) => {
                    const val = String(opt.value || '').trim();
                    const label = String(opt.label || '').trim() || val;
                    const isSelected = val && val === selectedVal;
                    return `<option value="${escapeHtml(val)}"${isSelected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
                })
                .join('');
        }

        function buildThemeCreatorBackdropUrl(filePath, size = 'w780') {
            const path = String(filePath || '').trim();
            if (!path) return '';
            return `https://image.tmdb.org/t/p/${size}${path.startsWith('/') ? path : `/${path}`}`;
        }

        function setThemeCreatorStatus(message) {
            const el = document.getElementById('theme-creator-status');
            if (el) el.textContent = String(message || '').trim();
        }

        function setThemeCreatorCount() {
            const el = document.getElementById('theme-creator-count');
            if (!el) return;
            el.textContent = `${themeCreatorSelected.length} / 6 selected`;
        }

        function renderThemeCreatorExistingBackdrops() {
            if (!themeCreatorExisting.length) return '';
            const cards = themeCreatorExisting.map((item, idx) => {
                const imgUrl = String(item?.url || '').trim();
                const pageVal = String(item?.page || '').trim();
                const name = String(item?.name || '').trim();
                return `
                    <div class="glass-panel" style="padding: 0.6rem; border-radius: 0.8rem; display:grid; gap: 8px;">
                        <div style="width: 100%; aspect-ratio: 16 / 9; border-radius: 0.7rem; overflow: hidden; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08);">
                            ${imgUrl
                                ? `<img src="${imgUrl}" alt="Theme backdrop" loading="lazy" decoding="async" style="width:100%; height:100%; object-fit: cover; display:block;">`
                                : `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; color: var(--text-muted); font-size: 12px;">No image</div>`
                            }
                        </div>
                        <div class="text-xs text-gray" style="word-break: break-all;">${escapeHtml(name || '')}</div>
                        <div style="display:grid; gap: 6px;">
                            <label class="text-xs text-gray">Page</label>
                            <select class="input-field" data-theme-existing-select="page" data-theme-existing-index="${idx}">
                                ${buildThemeCreatorOptions(THEME_CREATOR_PAGES, pageVal)}
                            </select>
                        </div>
                        <button type="button" class="btn btn-outline" data-theme-existing-remove="${idx}" style="padding: 0.35rem 0.6rem; border-radius: 0.7rem;">Remove</button>
                    </div>
                `;
            }).join('');

            return `
                <div style="display:grid; gap: 10px;">
                    <div class="text-xs text-gray">Current theme backdrops</div>
                    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px;">${cards}</div>
                </div>
            `;
        }

        function renderThemeCreatorBackdropSearchResults(items) {
            const results = document.getElementById('theme-creator-search-results');
            if (!results) return;

            themeCreatorBackdropSearchItems = Array.isArray(items) ? items.slice(0, 6) : [];
            if (themeCreatorBackdropSearchItems.length === 0) {
                results.innerHTML = `<div class="search-item text-gray justify-center">No movies found</div>`;
                results.classList.remove('hidden');
                return;
            }

            results.innerHTML = themeCreatorBackdropSearchItems.map((m, idx) => {
                const title = String(m?.title || '').trim();
                const year = m?.year ? String(m.year) : '';
                const posterPath = String(m?.poster_path || '').trim();
                const posterUrl = posterPath ? `https://image.tmdb.org/t/p/w154${posterPath}` : '';
                const metaParts = [year].filter(Boolean);

                return `
                    <div class="search-item" data-theme-creator-idx="${idx}">
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
            dockThemeCreatorBackdropDropdown();

            if (!results.dataset.boundClicks) {
                results.dataset.boundClicks = 'true';
                results.addEventListener('click', (e) => {
                    const row = e?.target?.closest ? e.target.closest('.search-item[data-theme-creator-idx]') : null;
                    if (!row) return;
                    const idx = Number(row.getAttribute('data-theme-creator-idx'));
                    const picked = Number.isFinite(idx) ? themeCreatorBackdropSearchItems[idx] : null;
                    if (!picked) return;

                    const tmdb_id = Number(picked?.tmdb_id ?? picked?.tmdbId ?? picked?.id ?? null);
                    const title = String(picked?.title || '').trim();
                    const year = picked?.year ? String(picked.year) : '';
                    if (!Number.isFinite(tmdb_id) || tmdb_id <= 0) return;

                    themeCreatorBackdropMovie = { tmdb_id, title, year };
                    const label = `${title}${year ? ` (${year})` : ''}`;
                    const movieEl = document.getElementById('theme-creator-selected-movie');
                    if (movieEl) movieEl.textContent = `Last backdrop movie: ${label}`;

                    const input = document.getElementById('theme-creator-search-input');
                    if (input) input.value = '';
                    results.classList.add('hidden');
                    results.innerHTML = '';
                    undockThemeCreatorBackdropDropdown();

                    loadThemeCreatorBackdrops(tmdb_id).catch(() => null);
                });
            }
        }

        function renderThemeCreatorAiSearchResults(items) {
            const results = document.getElementById('theme-creator-ai-search-results');
            if (!results) return;

            themeCreatorAiSearchItems = Array.isArray(items) ? items.slice(0, 6) : [];
            if (themeCreatorAiSearchItems.length === 0) {
                results.innerHTML = `<div class="search-item text-gray justify-center">No movies found</div>`;
                results.classList.remove('hidden');
                return;
            }

            results.innerHTML = themeCreatorAiSearchItems.map((m, idx) => {
                const title = String(m?.title || '').trim();
                const year = m?.year ? String(m.year) : '';
                const posterPath = String(m?.poster_path || '').trim();
                const posterUrl = posterPath ? `https://image.tmdb.org/t/p/w154${posterPath}` : '';
                const metaParts = [year].filter(Boolean);

                return `
                    <div class="search-item" data-theme-creator-ai-idx="${idx}">
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
            dockThemeCreatorAiDropdown();

            if (!results.dataset.boundClicks) {
                results.dataset.boundClicks = 'true';
                results.addEventListener('click', (e) => {
                    const row = e?.target?.closest ? e.target.closest('.search-item[data-theme-creator-ai-idx]') : null;
                    if (!row) return;
                    const idx = Number(row.getAttribute('data-theme-creator-ai-idx'));
                    const picked = Number.isFinite(idx) ? themeCreatorAiSearchItems[idx] : null;
                    if (!picked) return;

                    const tmdb_id = Number(picked?.tmdb_id ?? picked?.tmdbId ?? picked?.id ?? null);
                    const title = String(picked?.title || '').trim();
                    const year = picked?.year ? String(picked.year) : '';
                    if (!Number.isFinite(tmdb_id) || tmdb_id <= 0) return;

                    themeCreatorAiMovie = { tmdb_id, title, year };
                    const label = `${title}${year ? ` (${year})` : ''}`;
                    const movieEl = document.getElementById('theme-creator-ai-selected-movie');
                    if (movieEl) movieEl.textContent = label;

                    const input = document.getElementById('theme-creator-ai-search-input');
                    if (input) input.value = '';
                    results.classList.add('hidden');
                    results.innerHTML = '';
                    undockThemeCreatorAiDropdown();
                });
            }
        }

        function clearThemeCreatorBackdropSearchUI() {
            const results = document.getElementById('theme-creator-search-results');
            if (results) results.classList.add('hidden');
            undockThemeCreatorBackdropDropdown();
            themeCreatorBackdropSearchItems = [];
        }

        function clearThemeCreatorAiSearchUI() {
            const results = document.getElementById('theme-creator-ai-search-results');
            if (results) results.classList.add('hidden');
            undockThemeCreatorAiDropdown();
            themeCreatorAiSearchItems = [];
        }

        function dockThemeCreatorBackdropDropdown() {
            const input = document.getElementById('theme-creator-search-input');
            const results = document.getElementById('theme-creator-search-results');
            if (!input || !results) return;

            if (!themeCreatorBackdropDropdownDocked) {
                themeCreatorBackdropDropdownParent = results.parentElement;
                document.body.appendChild(results);
                themeCreatorBackdropDropdownDocked = true;
            }

            const rect = input.getBoundingClientRect();
            results.style.position = 'fixed';
            results.style.top = `${Math.round(rect.bottom + 8)}px`;
            results.style.left = `${Math.round(rect.left)}px`;
            results.style.width = `${Math.round(rect.width)}px`;
            results.style.zIndex = '20000';
        }

        function undockThemeCreatorBackdropDropdown() {
            const results = document.getElementById('theme-creator-search-results');
            if (!results) return;
            if (themeCreatorBackdropDropdownDocked && themeCreatorBackdropDropdownParent) {
                themeCreatorBackdropDropdownParent.appendChild(results);
            }
            themeCreatorBackdropDropdownDocked = false;
            themeCreatorBackdropDropdownParent = null;
            results.style.position = '';
            results.style.top = '';
            results.style.left = '';
            results.style.width = '';
            results.style.zIndex = '';
        }

        function dockThemeCreatorAiDropdown() {
            const input = document.getElementById('theme-creator-ai-search-input');
            const results = document.getElementById('theme-creator-ai-search-results');
            if (!input || !results) return;

            if (!themeCreatorAiDropdownDocked) {
                themeCreatorAiDropdownParent = results.parentElement;
                document.body.appendChild(results);
                themeCreatorAiDropdownDocked = true;
            }

            const rect = input.getBoundingClientRect();
            results.style.position = 'fixed';
            results.style.top = `${Math.round(rect.bottom + 8)}px`;
            results.style.left = `${Math.round(rect.left)}px`;
            results.style.width = `${Math.round(rect.width)}px`;
            results.style.zIndex = '20000';
        }

        function undockThemeCreatorAiDropdown() {
            const results = document.getElementById('theme-creator-ai-search-results');
            if (!results) return;
            if (themeCreatorAiDropdownDocked && themeCreatorAiDropdownParent) {
                themeCreatorAiDropdownParent.appendChild(results);
            }
            themeCreatorAiDropdownDocked = false;
            themeCreatorAiDropdownParent = null;
            results.style.position = '';
            results.style.top = '';
            results.style.left = '';
            results.style.width = '';
            results.style.zIndex = '';
        }

        function renderThemeCreatorBackdrops(items) {
            const wrap = document.getElementById('theme-creator-backdrops');
            if (!wrap) return;

            const safe = Array.isArray(items) ? items : [];
            const existingHtml = themeCreatorMode === 'edit' ? renderThemeCreatorExistingBackdrops() : '';
            const searchHtml = safe.length
                ? safe.map((b, idx) => {
                const filePath = String(b?.file_path || '').trim();
                const vote = Number(b?.vote_average ?? 0);
                const voteText = Number.isFinite(vote) ? vote.toFixed(1) : '';
                const imgUrl = buildThemeCreatorBackdropUrl(filePath, 'w780');
                const isSelected = themeCreatorSelected.some((s) => String(s.file_path) === filePath);
                return `
                    <div class="glass-panel" style="padding: 0.6rem; border-radius: 0.8rem; display:grid; gap: 8px;">
                        <div style="width: 100%; aspect-ratio: 16 / 9; border-radius: 0.7rem; overflow: hidden; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08);">
                            ${imgUrl
                                ? `<img src="${imgUrl}" alt="Backdrop" loading="lazy" decoding="async" style="width:100%; height:100%; object-fit: cover; display:block;">`
                                : `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; color: var(--text-muted); font-size: 12px;">No image</div>`
                            }
                        </div>
                        <div style="display:flex; justify-content: space-between; align-items: center; gap: 8px;">
                            <div class="text-xs text-gray">${voteText ? `Rating ${escapeHtml(voteText)}` : 'Unrated'}</div>
                            <button type="button" class="btn ${isSelected ? 'btn-glass' : 'btn-outline'}" data-theme-creator-backdrop="${idx}" style="padding: 0.35rem 0.6rem; border-radius: 0.7rem;">${isSelected ? 'Selected' : 'Select'}</button>
                        </div>
                    </div>
                `;
            }).join('')
                : '';

            if (!existingHtml && !searchHtml) {
                wrap.innerHTML = `<div class="text-gray">No backdrops found.</div>`;
                return;
            }

            const searchSection = searchHtml
                ? `
                    <div style="display:grid; gap: 10px; margin-top: ${existingHtml ? '12px' : '0'};">
                        <div class="text-xs text-gray">Search results</div>
                        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px;">${searchHtml}</div>
                    </div>
                `
                : '';

            wrap.innerHTML = `${existingHtml}${searchSection}`;
        }

        async function loadThemeCreatorExistingBackdrops(themeId) {
            if (!supabaseClient || !themeId) {
                themeCreatorExisting = [];
                renderThemeCreatorBackdrops(themeCreatorBackdrops);
                return;
            }

            try {
                const { data, error } = await supabaseClient
                    .from('Background Images')
                    .select('id, name, url, page, theme_id')
                    .eq('theme_id', themeId)
                    .order('created_at', { ascending: false });
                if (error) throw error;
                themeCreatorExisting = Array.isArray(data) ? data : [];
            } catch (err) {
                themeCreatorExisting = [];
                showToast(`Theme backdrops failed: ${String(err?.message || err)}`, { level: 'warn' });
            }

            renderThemeCreatorBackdrops(themeCreatorBackdrops);
        }

        async function updateThemeCreatorExistingPage(idx, pageVal) {
            const row = themeCreatorExisting[idx] || null;
            if (!row || !supabaseClient) return;
            const page = String(pageVal || '').trim();
            if (!page) return;

            try {
                const { error } = await supabaseClient
                    .from('Background Images')
                    .update({ page })
                    .eq('id', row.id);
                if (error) throw error;
                themeCreatorExisting = themeCreatorExisting.map((item, i) => (i === idx ? { ...item, page } : item));
                showToast('Page updated.', { level: 'success' });
            } catch (err) {
                showToast(`Page update failed: ${String(err?.message || err)}`, { level: 'warn' });
            }
        }

        async function deleteThemeCreatorExistingBackdrop(idx) {
            const row = themeCreatorExisting[idx] || null;
            if (!row || !supabaseClient) return;
            const name = String(row?.name || '').trim();

            try {
                if (name) {
                    const { error: storageErr } = await supabaseClient
                        .storage
                        .from('Background Images')
                        .remove([name]);
                    if (storageErr) throw storageErr;
                }

                const { error } = await supabaseClient
                    .from('Background Images')
                    .delete()
                    .eq('id', row.id);
                if (error) throw error;

                themeCreatorExisting = themeCreatorExisting.filter((_, i) => i !== idx);
                renderThemeCreatorBackdrops(themeCreatorBackdrops);
                showToast('Backdrop removed.', { level: 'success' });
            } catch (err) {
                showToast(`Remove failed: ${String(err?.message || err)}`, { level: 'warn' });
            }
        }

        async function deleteThemeCreatorTheme() {
            if (guardGuestWrite()) return;
            if (!supabaseClient || !themeCreatorActiveThemeId) return;
            const name = themeCreatorActiveThemeName || 'this theme';
            const ok = window.confirm(`Delete ${name} and all its backdrops? This cannot be undone.`);
            if (!ok) return;

            try {
                const { data, error } = await supabaseClient
                    .from('Background Images')
                    .select('id, name')
                    .eq('theme_id', themeCreatorActiveThemeId);
                if (error) throw error;

                const rows = Array.isArray(data) ? data : [];
                const names = rows.map((r) => String(r?.name || '').trim()).filter(Boolean);

                if (names.length) {
                    const { error: storageErr } = await supabaseClient
                        .storage
                        .from('Background Images')
                        .remove(names);
                    if (storageErr) throw storageErr;
                }

                if (rows.length) {
                    const ids = rows.map((r) => r.id).filter(Boolean);
                    const { error: delErr } = await supabaseClient
                        .from('Background Images')
                        .delete()
                        .in('id', ids);
                    if (delErr) throw delErr;
                }

                const { error: themeErr } = await supabaseClient
                    .from('Themes')
                    .delete()
                    .eq('id', themeCreatorActiveThemeId);
                if (themeErr) throw themeErr;

                themeCreatorActiveThemeId = null;
                themeCreatorActiveThemeName = '';
                themeCreatorExisting = [];
                themeCreatorSelected = [];
                loadThemeOptions().catch(() => null);
                renderThemeCreatorSelected();
                renderThemeCreatorBackdrops(themeCreatorBackdrops);
                setThemeCreatorMode('create');
                setThemeCreatorThemeStatus('Theme deleted.', 'success');
                showToast('Theme deleted.', { level: 'success' });
            } catch (err) {
                showToast(`Theme delete failed: ${String(err?.message || err)}`, { level: 'warn' });
            }
        }

        function renderThemeCreatorSelected() {
            const wrap = document.getElementById('theme-creator-selected');
            if (!wrap) return;

            setThemeCreatorCount();

            if (themeCreatorSelected.length === 0) {
                wrap.innerHTML = `<div class="text-gray">No images selected yet.</div>`;
                return;
            }

            wrap.innerHTML = themeCreatorSelected.map((item, idx) => {
                const filePath = String(item?.file_path || '').trim();
                const imgUrl = buildThemeCreatorBackdropUrl(filePath, 'w780');
                const pageVal = String(item?.page || '').trim();
                const themeName = String(themeCreatorActiveThemeName || '').trim();
                return `
                    <div class="glass-panel" style="padding: 0.6rem; border-radius: 0.8rem; display:grid; gap: 8px;">
                        <div style="width: 100%; aspect-ratio: 16 / 9; border-radius: 0.7rem; overflow: hidden; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08);">
                            ${imgUrl
                                ? `<img src="${imgUrl}" alt="Selected backdrop" loading="lazy" decoding="async" style="width:100%; height:100%; object-fit: cover; display:block;">`
                                : `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; color: var(--text-muted); font-size: 12px;">No image</div>`
                            }
                        </div>
                        <div class="text-xs text-gray">Theme: ${escapeHtml(themeName || 'None')}</div>
                        <div style="display:grid; gap: 6px;">
                            <label class="text-xs text-gray">Page</label>
                            <select class="input-field" data-theme-creator-select="page" data-theme-creator-index="${idx}">
                                ${buildThemeCreatorOptions(THEME_CREATOR_PAGES, pageVal)}
                            </select>
                        </div>
                        <button type="button" class="btn btn-outline" data-theme-creator-remove="${idx}" style="padding: 0.35rem 0.6rem; border-radius: 0.7rem;">Remove</button>
                    </div>
                `;
            }).join('');
        }

        function addThemeCreatorSelection(backdrop) {
            if (themeCreatorSelected.length >= 6) {
                showToast('You can select up to 6 images.', { level: 'warn' });
                return;
            }
            const filePath = String(backdrop?.file_path || '').trim();
            if (!filePath) return;
            const exists = themeCreatorSelected.some((s) => String(s.file_path) === filePath);
            if (exists) return;

            const defaultPage = THEME_CREATOR_PAGES[0]?.value || '';
            const tmdbId = Number(themeCreatorBackdropMovie?.tmdb_id ?? null);

            themeCreatorSelected = [
                ...themeCreatorSelected,
                {
                    file_path: filePath,
                    vote_average: Number(backdrop?.vote_average ?? 0) || 0,
                    page: defaultPage,
                    tmdb_id: Number.isFinite(tmdbId) ? tmdbId : null,
                },
            ];
            renderThemeCreatorSelected();
            renderThemeCreatorBackdrops(themeCreatorBackdrops);
        }

        function removeThemeCreatorSelection(idx) {
            themeCreatorSelected = themeCreatorSelected.filter((_, i) => i !== idx);
            renderThemeCreatorSelected();
            renderThemeCreatorBackdrops(themeCreatorBackdrops);
        }

        async function loadThemeCreatorBackdrops(tmdbId) {
            const wrap = document.getElementById('theme-creator-backdrops');
            if (wrap) {
                wrap.innerHTML = `<div class="text-gray">Loading backdrops…</div>`;
            }
            setThemeCreatorStatus('');

            if (themeCreatorBackdropAbortController) themeCreatorBackdropAbortController.abort();
            themeCreatorBackdropAbortController = new AbortController();

            try {
                const data = await callSwiftApiPublic(
                    { action: 'backdrops', tmdb_id: tmdbId },
                    { signal: themeCreatorBackdropAbortController.signal }
                );
                const items = Array.isArray(data?.backdrops) ? data.backdrops : [];
                themeCreatorBackdrops = items;
                renderThemeCreatorBackdrops(items);
            } catch (err) {
                if (String(err?.name || '').toLowerCase() === 'aborterror') return;
                if (wrap) wrap.innerHTML = `<div class="text-gray">Backdrops unavailable.</div>`;
                showToast(`Backdrops failed: ${String(err?.message || err)}`, { level: 'warn' });
            }
        }

        function handleThemeCreatorBackdropSearch(query, opts = {}) {
            const inputEl = document.getElementById('theme-creator-search-input');
            const results = document.getElementById('theme-creator-search-results');
            if (!inputEl || !results) return;

            const q = String(query || '').trim();
            if (!q || q.length < 1) {
                if (themeCreatorBackdropSearchDebounceTimer) clearTimeout(themeCreatorBackdropSearchDebounceTimer);
                if (themeCreatorBackdropSearchAbortController) themeCreatorBackdropSearchAbortController.abort();
                clearThemeCreatorBackdropSearchUI();
                return;
            }

            if (themeCreatorBackdropSearchDebounceTimer) clearTimeout(themeCreatorBackdropSearchDebounceTimer);
            if (themeCreatorBackdropSearchAbortController) themeCreatorBackdropSearchAbortController.abort();
            themeCreatorBackdropSearchAbortController = new AbortController();

            if (q.length < 2) {
                results.classList.add('hidden');
                themeCreatorBackdropSearchItems = [];
                return;
            }

            const debounceMs = opts?.force ? 0 : 320;
            themeCreatorBackdropSearchDebounceTimer = setTimeout(async () => {
                try {
                    results.innerHTML = `
                        <div class="search-item text-gray justify-center" style="gap:0.5rem;">
                            <span class="icon-sm">${icons.loader}</span>
                            Searching…
                        </div>
                    `;
                    results.classList.remove('hidden');

                    const data = await callSwiftApiPublic(
                        { action: 'search', query: q, page: 1, limit: 8 },
                        { signal: themeCreatorBackdropSearchAbortController.signal }
                    );
                    const items = Array.isArray(data?.results) ? data.results : [];
                    renderThemeCreatorBackdropSearchResults(items);
                } catch (err) {
                    if (String(err?.name || '').toLowerCase() === 'aborterror') return;
                    results.innerHTML = `<div class="search-item text-gray justify-center">Search unavailable — please try again</div>`;
                    results.classList.remove('hidden');
                }
            }, debounceMs);
        }

        function handleThemeCreatorAiSearch(query, opts = {}) {
            const inputEl = document.getElementById('theme-creator-ai-search-input');
            const results = document.getElementById('theme-creator-ai-search-results');
            if (!inputEl || !results) return;

            const q = String(query || '').trim();
            if (!q || q.length < 1) {
                if (themeCreatorAiSearchDebounceTimer) clearTimeout(themeCreatorAiSearchDebounceTimer);
                if (themeCreatorAiSearchAbortController) themeCreatorAiSearchAbortController.abort();
                clearThemeCreatorAiSearchUI();
                return;
            }

            if (themeCreatorAiSearchDebounceTimer) clearTimeout(themeCreatorAiSearchDebounceTimer);
            if (themeCreatorAiSearchAbortController) themeCreatorAiSearchAbortController.abort();
            themeCreatorAiSearchAbortController = new AbortController();

            if (q.length < 2) {
                results.classList.add('hidden');
                themeCreatorAiSearchItems = [];
                return;
            }

            const debounceMs = opts?.force ? 0 : 320;
            themeCreatorAiSearchDebounceTimer = setTimeout(async () => {
                try {
                    results.innerHTML = `
                        <div class="search-item text-gray justify-center" style="gap:0.5rem;">
                            <span class="icon-sm">${icons.loader}</span>
                            Searching…
                        </div>
                    `;
                    results.classList.remove('hidden');

                    const data = await callSwiftApiPublic(
                        { action: 'search', query: q, page: 1, limit: 8 },
                        { signal: themeCreatorAiSearchAbortController.signal }
                    );
                    const items = Array.isArray(data?.results) ? data.results : [];
                    renderThemeCreatorAiSearchResults(items);
                } catch (err) {
                    if (String(err?.name || '').toLowerCase() === 'aborterror') return;
                    results.innerHTML = `<div class="search-item text-gray justify-center">Search unavailable — please try again</div>`;
                    results.classList.remove('hidden');
                }
            }, debounceMs);
        }

        function slugifyThemeCreatorValue(raw) {
            return String(raw || '')
                .trim()
                .toLowerCase()
                .replace(/\s+/g, '')
                .replace(/[^a-z0-9_-]/g, '');
        }

        function getThemeCreatorFileExtension(filePath) {
            const raw = String(filePath || '').trim();
            const dot = raw.lastIndexOf('.');
            if (dot === -1) return '.jpg';
            const ext = raw.slice(dot).toLowerCase();
            return ext.match(/\.jpe?g|\.png|\.webp/) ? ext : '.jpg';
        }

        async function saveThemeCreatorSelections() {
            if (!supabaseClient) {
                showToast('Supabase SDK failed to load.', { level: 'warn' });
                return;
            }

            const selections = Array.isArray(themeCreatorSelected) ? themeCreatorSelected : [];
            if (selections.length === 0) {
                showToast('Select at least one image.', { level: 'warn' });
                return;
            }

            if (!themeCreatorActiveThemeId) {
                showToast('Select or create a theme first.', { level: 'warn' });
                return;
            }

            if (!themeCreatorAiMovie?.tmdb_id) {
                showToast('Pick the AI movie first.', { level: 'warn' });
                return;
            }

            const bad = selections.find((s) => !String(s?.page || '').trim());
            if (bad) {
                showToast('Assign a page for each selection.', { level: 'warn' });
                return;
            }

            const missingTmdb = selections.find((s) => !Number.isFinite(Number(s?.tmdb_id)));
            if (missingTmdb) {
                showToast('Each backdrop needs a source movie. Search and select backdrops again.', { level: 'warn' });
                return;
            }

            const btn = document.getElementById('theme-creator-save');
            if (btn) {
                btn.disabled = true;
                btn.style.opacity = 0.7;
            }

            setThemeCreatorStatus('Uploading images…');

            try {
                let uploaded = 0;

                for (let i = 0; i < selections.length; i += 1) {
                    const s = selections[i];
                    const filePath = String(s?.file_path || '').trim();
                    if (!filePath) continue;
                    const tmdbId = Number(s?.tmdb_id ?? null);
                    if (!Number.isFinite(tmdbId) || tmdbId <= 0) continue;
                    const pageSlug = slugifyThemeCreatorValue(s.page);
                    const ext = getThemeCreatorFileExtension(filePath);
                    const objectName = `${themeCreatorActiveThemeId}__${pageSlug}__${tmdbId}__${i + 1}${ext}`;
                    const srcUrl = buildThemeCreatorBackdropUrl(filePath, 'w1280');

                    const imgRes = await fetch(srcUrl);
                    if (!imgRes.ok) throw new Error(`Failed to download backdrop (${imgRes.status}).`);
                    const blob = await imgRes.blob();

                    const { error } = await supabaseClient
                        .storage
                        .from('Background Images')
                        .upload(objectName, blob, {
                            upsert: true,
                            contentType: blob.type || 'image/jpeg',
                        });
                    if (error) throw error;

                    uploaded += 1;
                    setThemeCreatorStatus(`Uploaded ${uploaded} of ${selections.length}…`);
                }

                setThemeCreatorStatus(`Uploaded ${uploaded} image${uploaded === 1 ? '' : 's'}. Generating colors…`);
                showToast('Theme images uploaded!', { level: 'success' });

                const stylePrompt = getThemeCreatorStylePrompt();
                const colorOk = await generateThemeCreatorColors({
                    themeId: themeCreatorActiveThemeId,
                    themeName: themeCreatorActiveThemeName,
                    stylePrompt,
                });

                themeCreatorSelected = [];
                renderThemeCreatorSelected();
                loadThemeBackgroundImages().catch(() => null);
                if (colorOk) {
                    setThemeCreatorStatus('All done.');
                }
            } catch (err) {
                setThemeCreatorStatus('Upload failed.');
                showToast(`Upload failed: ${String(err?.message || err)}`, { level: 'warn' });
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.style.opacity = 1;
                }
            }
        }

        function initThemeCreatorPage() {
            const email = String(cachedAuthUser?.email || '').trim();
            if (!canAccessThemeCreator(email)) {
                showToast('Theme Creator is restricted to this account.', { level: 'warn' });
                router.navigate('account');
                return;
            }

            renderThemeCreatorSelected();
            setThemeCreatorStatus('');
            setThemeCreatorThemeStatus('');
            setThemeCreatorMode('create');
            setThemeCreatorActiveTheme(null);
            themeCreatorBackdropMovie = null;
            themeCreatorAiMovie = null;
            themeCreatorSelected = [];
            themeCreatorBackdrops = [];
            themeCreatorExisting = [];
            setThemeCreatorStep(1);
            loadThemeOptions().catch(() => null);

            const backdropLabel = document.getElementById('theme-creator-selected-movie');
            if (backdropLabel) backdropLabel.textContent = 'No backdrop movie selected yet.';
            const aiLabel = document.getElementById('theme-creator-ai-selected-movie');
            if (aiLabel) aiLabel.textContent = 'No AI movie selected yet.';

            if (themeCreatorBound) return;
            themeCreatorBound = true;

            document.addEventListener('input', (e) => {
                const el = e?.target;
                if (!el || !(el instanceof HTMLElement)) return;
                if (el.id === 'theme-creator-search-input') {
                    handleThemeCreatorBackdropSearch(el.value || '');
                    dockThemeCreatorBackdropDropdown();
                }
                if (el.id === 'theme-creator-ai-search-input') {
                    handleThemeCreatorAiSearch(el.value || '');
                    dockThemeCreatorAiDropdown();
                }
            });

            window.addEventListener('scroll', () => {
                const results = document.getElementById('theme-creator-search-results');
                if (results && !results.classList.contains('hidden')) {
                    dockThemeCreatorBackdropDropdown();
                }
                const aiResults = document.getElementById('theme-creator-ai-search-results');
                if (aiResults && !aiResults.classList.contains('hidden')) {
                    dockThemeCreatorAiDropdown();
                }
            }, true);

            window.addEventListener('resize', () => {
                const results = document.getElementById('theme-creator-search-results');
                if (results && !results.classList.contains('hidden')) {
                    dockThemeCreatorBackdropDropdown();
                }
                const aiResults = document.getElementById('theme-creator-ai-search-results');
                if (aiResults && !aiResults.classList.contains('hidden')) {
                    dockThemeCreatorAiDropdown();
                }
            });

            document.addEventListener('click', (e) => {
                const modeCreateBtn = e?.target?.closest ? e.target.closest('#theme-creator-mode-create') : null;
                if (modeCreateBtn) {
                    setThemeCreatorMode('create');
                    return;
                }

                const modeEditBtn = e?.target?.closest ? e.target.closest('#theme-creator-mode-edit') : null;
                if (modeEditBtn) {
                    setThemeCreatorMode('edit');
                    return;
                }

                const modeContinueBtn = e?.target?.closest ? e.target.closest('#theme-creator-mode-continue') : null;
                if (modeContinueBtn) {
                    setThemeCreatorStep(2);
                    return;
                }

                const themeCreateBtn = e?.target?.closest ? e.target.closest('#theme-creator-create-btn') : null;
                if (themeCreateBtn) {
                    createThemeCreatorTheme({ advance: true }).catch(() => null);
                    return;
                }

                const editContinueBtn = e?.target?.closest ? e.target.closest('#theme-creator-edit-continue') : null;
                if (editContinueBtn) {
                    const select = document.getElementById('theme-creator-edit-select');
                    const themeId = String(select?.value || '').trim();
                    if (!themeId) {
                        setThemeCreatorThemeStatus('Select a theme first.', 'error');
                        return;
                    }
                    setThemeCreatorActiveTheme(themeId);
                    setThemeCreatorStep(3);
                    return;
                }

                const themeUpdateBtn = e?.target?.closest ? e.target.closest('#theme-creator-update-btn') : null;
                if (themeUpdateBtn) {
                    updateThemeCreatorThemeName().catch(() => null);
                    return;
                }

                const themeDeleteBtn = e?.target?.closest ? e.target.closest('#theme-creator-delete-theme') : null;
                if (themeDeleteBtn) {
                    deleteThemeCreatorTheme().catch(() => null);
                    return;
                }

                const selectBtn = e?.target?.closest ? e.target.closest('[data-theme-creator-backdrop]') : null;
                if (selectBtn) {
                    const idx = Number(selectBtn.getAttribute('data-theme-creator-backdrop'));
                    const picked = Number.isFinite(idx) ? themeCreatorBackdrops[idx] : null;
                    if (picked) addThemeCreatorSelection(picked);
                    return;
                }

                const removeBtn = e?.target?.closest ? e.target.closest('[data-theme-creator-remove]') : null;
                if (removeBtn) {
                    const idx = Number(removeBtn.getAttribute('data-theme-creator-remove'));
                    if (Number.isFinite(idx)) removeThemeCreatorSelection(idx);
                    return;
                }

                const existingRemoveBtn = e?.target?.closest ? e.target.closest('[data-theme-existing-remove]') : null;
                if (existingRemoveBtn) {
                    const idx = Number(existingRemoveBtn.getAttribute('data-theme-existing-remove'));
                    if (!Number.isFinite(idx)) return;
                    // Deletes the file from Storage as well as the row — not undoable,
                    // and it was one tap. (Deleting a whole THEME already confirms.)
                    if (!confirmDestructiveTap(existingRemoveBtn, { toast: 'Tap again to delete this backdrop', armedTitle: 'Tap again to delete' })) return;
                    deleteThemeCreatorExistingBackdrop(idx).catch(() => null);
                    return;
                }

                const clearBtn = e?.target?.closest ? e.target.closest('#theme-creator-clear') : null;
                if (clearBtn) {
                    themeCreatorSelected = [];
                    renderThemeCreatorSelected();
                    renderThemeCreatorBackdrops(themeCreatorBackdrops);
                    setThemeCreatorStatus('');
                    return;
                }

                const backdropsContinueBtn = e?.target?.closest ? e.target.closest('#theme-creator-backdrops-continue') : null;
                if (backdropsContinueBtn) {
                    if (themeCreatorSelected.length === 0) {
                        showToast('Select at least one backdrop.', { level: 'warn' });
                        return;
                    }
                    setThemeCreatorStep(4);
                    return;
                }

                const aiContinueBtn = e?.target?.closest ? e.target.closest('#theme-creator-ai-continue') : null;
                if (aiContinueBtn) {
                    if (!themeCreatorAiMovie?.tmdb_id) {
                        showToast('Select the AI movie first.', { level: 'warn' });
                        return;
                    }
                    setThemeCreatorStep(5);
                    return;
                }

                const saveBtn = e?.target?.closest ? e.target.closest('#theme-creator-save') : null;
                if (saveBtn) {
                    saveThemeCreatorSelections().catch(() => null);
                }

                const regenBtn = e?.target?.closest ? e.target.closest('#theme-creator-regenerate') : null;
                if (regenBtn) {
                    if (!themeCreatorActiveThemeId) {
                        showToast('Select or create a theme first.', { level: 'warn' });
                        return;
                    }
                    if (!themeCreatorAiMovie?.tmdb_id) {
                        showToast('Select the AI movie first.', { level: 'warn' });
                        return;
                    }
                    const stylePrompt = getThemeCreatorStylePrompt();
                    generateThemeCreatorColors({
                        themeId: themeCreatorActiveThemeId,
                        themeName: themeCreatorActiveThemeName,
                        stylePrompt,
                    }).catch(() => null);
                }
            });

            document.addEventListener('keydown', (e) => {
                const target = e?.target;
                if (e.key !== 'Enter' || !target || !(target instanceof HTMLElement)) return;
                if (target.id === 'theme-creator-new-name') {
                    e.preventDefault();
                    createThemeCreatorTheme().catch(() => null);
                }
                if (target.id === 'theme-creator-edit-name') {
                    e.preventDefault();
                    updateThemeCreatorThemeName().catch(() => null);
                }
            });

            document.addEventListener('change', (e) => {
                const el = e?.target;
                if (!el || !(el instanceof HTMLSelectElement)) return;
                if (el.id === 'theme-creator-edit-select') {
                    const themeId = String(el.value || '').trim();
                    setThemeCreatorActiveTheme(themeId || null);
                    return;
                }
                if (el.hasAttribute('data-theme-existing-select')) {
                    const idx = Number(el.getAttribute('data-theme-existing-index'));
                    const value = String(el.value || '').trim();
                    if (Number.isFinite(idx)) updateThemeCreatorExistingPage(idx, value).catch(() => null);
                    return;
                }
                const kind = el.getAttribute('data-theme-creator-select');
                const idx = Number(el.getAttribute('data-theme-creator-index'));
                if (!kind || !Number.isFinite(idx)) return;
                const value = String(el.value || '').trim();
                themeCreatorSelected = themeCreatorSelected.map((item, i) => {
                    if (i !== idx) return item;
                    return { ...item, [kind]: value };
                });
            });
        }

