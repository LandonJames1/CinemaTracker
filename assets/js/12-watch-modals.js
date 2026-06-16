        function openUpdateWatchModal() {
            const overlay = document.getElementById('update-watch-overlay');
            if (!overlay) return;
            overlay.style.display = 'flex';
            overlay.classList.add('open');
        }

        let deleteConfirmState = {
            action: null,
            token: null,
            ts: 0,
        };

        let deleteRatingState = {
            user_id: null,
            movie_id: null,
            title: '',
            logs: [],
            source: 'submit',
        };

        function armDeleteConfirmation({ action, token, message, statusElId }) {
            const now = Date.now();
            const statusEl = statusElId ? document.getElementById(statusElId) : null;

            // If the user clicks the same action twice within 8 seconds, treat as confirmed.
            const isSame = (
                deleteConfirmState.action === action &&
                deleteConfirmState.token === token &&
                (now - Number(deleteConfirmState.ts || 0)) < 8000
            );

            if (isSame) {
                deleteConfirmState = { action: null, token: null, ts: 0 };
                if (statusEl) statusEl.textContent = '';
                return true;
            }

            deleteConfirmState = { action, token, ts: now };
            if (statusEl) {
                statusEl.textContent = String(message || 'Click again to confirm.');
                statusEl.style.color = 'rgba(239,68,68,0.95)';
            }
            return false;
        }

        async function openDeleteRatingModalForMovie({ movie_id, title = '', source = 'submit' } = {}) {
            const mid = String(movie_id || '').trim();
            if (!mid) throw new Error('Missing movie_id for delete modal.');

            const { user: authedUser } = await requireAuthOrThrow();

            deleteRatingState = {
                user_id: authedUser.id,
                movie_id: mid,
                title: String(title || '').trim(),
                logs: [],
                source: String(source || 'submit'),
            };

            const overlay = document.getElementById('delete-rating-overlay');
            if (!overlay) return;
            const movieEl = document.getElementById('delete-rating-movie');
            if (movieEl) movieEl.textContent = deleteRatingState.title || 'this movie';

            const statusA = document.getElementById('delete-rating-status');
            const statusB = document.getElementById('delete-logs-status');
            if (statusA) {
                statusA.textContent = '';
                statusA.style.color = 'rgba(255,255,255,0.60)';
            }
            if (statusB) {
                statusB.textContent = '';
                statusB.style.color = 'rgba(255,255,255,0.60)';
            }

            overlay.style.display = 'flex';
            overlay.classList.add('open');

            await loadDeleteRatingWatchLogs();
        }

        function openDeleteRatingModal() {
            (async () => {
                try {
                    let movie_id = String(document.getElementById('fld-movie-id')?.value || '').trim();
                    if (!movie_id) {
                        movie_id = await resolveDbMovieIdFromSelectedMovie(router?.selectedMovie);
                    }
                    if (!movie_id) throw new Error('Missing movie_id for this entry.');

                    const title = String(router?.selectedMovie?.title || '').trim();
                    await openDeleteRatingModalForMovie({ movie_id, title, source: 'submit' });
                } catch (err) {
                    showToast(String(err?.message || err || 'Delete failed.'), { level: 'warn' });
                }
            })();
        }

        function closeDeleteRatingModal() {
            const overlay = document.getElementById('delete-rating-overlay');
            if (!overlay) return;
            overlay.classList.remove('open');
            overlay.style.display = 'none';
        }

        async function loadDeleteRatingWatchLogs() {
            const list = document.getElementById('delete-logs-list');
            const countEl = document.getElementById('delete-logs-count');
            const btn = document.getElementById('btn-delete-selected-logs');
            if (list) {
                list.innerHTML = `<div class="text-sm" style="color: rgba(255,255,255,0.65);">Loading watch logs…</div>`;
            }

            deleteRatingState.logs = [];

            const { user_id, movie_id } = deleteRatingState;
            if (!supabaseClient) throw new Error('Supabase client not initialized.');
            if (!user_id || !movie_id) throw new Error('Missing delete context. Close and re-open Delete.');

            const { data, error } = await supabaseClient
                .from('Watch Logs')
                .select(`id, watch_method, ${COL_WATCH_DATE}`)
                .eq('user_id', user_id)
                .eq('movie_id', movie_id)
                .order(COL_WATCH_DATE, { ascending: false })
                .order('id', { ascending: false });

            if (error) throw error;

            const logs = Array.isArray(data) ? data : [];
            deleteRatingState.logs = logs;

            if (countEl) {
                countEl.textContent = `${logs.length} watch log${logs.length === 1 ? '' : 's'}`;
            }

            if (!list) return;

            if (logs.length === 0) {
                list.innerHTML = `<div class="text-sm" style="color: rgba(255,255,255,0.65);">No watch logs found for this movie.</div>`;
                if (btn) {
                    btn.disabled = true;
                    btn.setAttribute('aria-disabled', 'true');
                    btn.title = 'No watch logs to delete.';
                }
                return;
            }

            const fmt = (raw) => {
                const s = String(raw ?? '').trim();
                return s || '(unknown date)';
            };

            list.innerHTML = logs.map((r) => {
                const id = String(r?.id || '').trim();
                const method = String(r?.watch_method || '');
                const wd = fmt(r?.[COL_WATCH_DATE]);
                const label = method ? `${wd} — ${escapeHtml(method)}` : `${wd}`;
                return `
                    <label style="display:flex; gap: 0.65rem; align-items: flex-start; padding: 0.65rem; border: 1px solid rgba(255,255,255,0.08); border-radius: 0.85rem; background: rgba(255,255,255,0.03);">
                        <input type="checkbox" class="delete-log-checkbox" data-log-id="${escapeHtml(id)}" onchange="handleDeleteLogCheckboxChange()" style="margin-top: 0.25rem;">
                        <div style="display:flex; flex-direction: column; gap: 0.2rem;">
                            <div class="text-white font-semibold" style="font-size: 0.9rem;">${label}</div>
                            <div class="text-xs" style="color: rgba(255,255,255,0.60);">id: ${escapeHtml(id)}</div>
                        </div>
                    </label>
                `;
            }).join('');

            handleDeleteLogCheckboxChange();
        }

        function getDeleteSelectedLogIds() {
            try {
                const checked = Array.from(document.querySelectorAll('#delete-logs-list .delete-log-checkbox:checked'));
                return checked
                    .map((el) => String(el?.getAttribute('data-log-id') || '').trim())
                    .filter(Boolean);
            } catch (_) {
                return [];
            }
        }

        function handleDeleteLogCheckboxChange() {
            const btn = document.getElementById('btn-delete-selected-logs');
            const status = document.getElementById('delete-logs-status');
            const total = Array.isArray(deleteRatingState.logs) ? deleteRatingState.logs.length : 0;
            const selectedIds = getDeleteSelectedLogIds();
            const selectedCount = selectedIds.length;

            if (status) status.textContent = '';

            if (!btn) return;
            if (total === 0 || selectedCount === 0) {
                btn.disabled = true;
                btn.setAttribute('aria-disabled', 'true');
                btn.title = total === 0 ? 'No watch logs to delete.' : 'Select at least one watch log.';
                btn.textContent = 'Delete selected';
                return;
            }

            if (selectedCount >= total) {
                btn.disabled = true;
                btn.setAttribute('aria-disabled', 'true');
                btn.title = 'You must keep at least 1 watch log.';
                btn.textContent = `Delete selected (${selectedCount})`;
                if (status) status.textContent = 'You cannot delete all watch logs. Leave at least 1 unchecked.';
                return;
            }

            btn.disabled = false;
            btn.setAttribute('aria-disabled', 'false');
            btn.title = `Delete ${selectedCount} watch log${selectedCount === 1 ? '' : 's'}.`;
            btn.textContent = `Delete selected (${selectedCount})`;
        }

        function clearDeleteLogsSelection() {
            try {
                document.querySelectorAll('#delete-logs-list .delete-log-checkbox').forEach((el) => {
                    el.checked = false;
                });
            } catch (_) {}
            handleDeleteLogCheckboxChange();
        }

        function toggleSelectAllDeleteLogs() {
            const boxes = Array.from(document.querySelectorAll('#delete-logs-list .delete-log-checkbox'));
            if (boxes.length === 0) return;
            const allChecked = boxes.every(b => b.checked);
            boxes.forEach((b) => { b.checked = !allChecked; });
            handleDeleteLogCheckboxChange();
        }

        async function confirmDeleteSelectedWatchLogs() {
            if (guardGuestWrite()) return;
            try {
                const { user_id, movie_id } = deleteRatingState;
                if (!user_id || !movie_id) throw new Error('Missing delete context. Close and re-open Delete.');
                const total = Array.isArray(deleteRatingState.logs) ? deleteRatingState.logs.length : 0;
                const ids = getDeleteSelectedLogIds();
                if (ids.length === 0) {
                    showToast('Select at least one watch log to delete.', { level: 'warn' });
                    return;
                }
                if (total > 0 && ids.length >= total) {
                    showToast('You must keep at least 1 watch log.', { level: 'warn' });
                    return;
                }
                const status = document.getElementById('delete-logs-status');
                if (status) {
                    status.textContent = '';
                    status.style.color = 'rgba(255,255,255,0.60)';
                }

                const token = `${user_id}:${movie_id}:${ids.slice().sort().join(',')}`;
                const confirmed = armDeleteConfirmation({
                    action: 'delete_selected_logs',
                    token,
                    statusElId: 'delete-logs-status',
                    message: `Click “Delete selected” again to confirm deleting ${ids.length} watch log${ids.length === 1 ? '' : 's'} (you must keep at least 1).`,
                });
                if (!confirmed) return;

                if (status) {
                    status.textContent = 'Deleting selected watch logs…';
                    status.style.color = 'rgba(255,255,255,0.60)';
                }

                const { error: delErr } = await supabaseClient
                    .from('Watch Logs')
                    .delete()
                    .in('id', ids)
                    .eq('user_id', user_id)
                    .eq('movie_id', movie_id);

                if (delErr) throw delErr;

                // Keep Movie Ratings watch_date aligned to the latest remaining Watch Logs entry.
                const latest = await getLatestWatchLog({ user_id, movie_id });
                const latestDate = String(latest?.[COL_WATCH_DATE] || '').trim();
                if (latestDate) {
                    const { error: updErr } = await supabaseClient
                        .from('Movie Ratings')
                        .update({
                            [COL_WATCH_DATE]: latestDate,
                            updated_at: new Date().toISOString(),
                        })
                        .eq('user_id', user_id)
                        .eq('movie_id', movie_id);
                    if (updErr) throw updErr;
                }

                const remaining = await getWatchLogCount({ user_id, movie_id });
                const timesEl = document.getElementById('fld-timeswatch');
                if (timesEl && Number.isFinite(Number(remaining)) && Number(remaining) >= 1) {
                    timesEl.value = String(Number(remaining));
                }

                showToast(`Deleted ${ids.length} watch log${ids.length === 1 ? '' : 's'}.`);
                await loadDeleteRatingWatchLogs();

                // If launched from My Movies, refresh the cards behind the modal.
                if (String(deleteRatingState?.source || '') === 'library' && String(router?.currentPage || '') === 'library') {
                    await loadLibraryPage({ reset: true });
                }
            } catch (err) {
                const msg = String(err?.message || err);
                const status = document.getElementById('delete-logs-status');
                if (status) {
                    status.textContent = `Delete failed: ${msg}`;
                    status.style.color = 'rgba(239,68,68,0.95)';
                }
                showToast(`Delete failed: ${msg}`);
            }
        }

        async function confirmDeleteRatingAndAllLogs() {
            if (guardGuestWrite()) return;
            try {
                const { user_id, movie_id, title } = deleteRatingState;
                if (!user_id || !movie_id) throw new Error('Missing delete context. Close and re-open Delete.');
                const status = document.getElementById('delete-rating-status');
                if (status) {
                    status.textContent = '';
                    status.style.color = 'rgba(255,255,255,0.60)';
                }

                const token = `${user_id}:${movie_id}`;
                const confirmed = armDeleteConfirmation({
                    action: 'delete_rating_and_all_logs',
                    token,
                    statusElId: 'delete-rating-status',
                    message: `Click again to confirm deleting your rating and all watch logs for ${title || 'this movie'}. This cannot be undone.`,
                });
                if (!confirmed) return;

                if (status) {
                    status.textContent = 'Deleting rating and watch logs…';
                    status.style.color = 'rgba(255,255,255,0.60)';
                }

                // Delete logs first (works with or without DB cascades).
                const { error: logsErr } = await supabaseClient
                    .from('Watch Logs')
                    .delete()
                    .eq('user_id', user_id)
                    .eq('movie_id', movie_id);
                if (logsErr) throw logsErr;

                const { error: ratingErr } = await supabaseClient
                    .from('Movie Ratings')
                    .delete()
                    .eq('user_id', user_id)
                    .eq('movie_id', movie_id);
                if (ratingErr) throw ratingErr;

                closeDeleteRatingModal();
                showToast('Deleted rating and watch logs.');
                if (String(deleteRatingState?.source || '') === 'library' && String(router?.currentPage || '') === 'library') {
                    await loadLibraryPage({ reset: true });
                } else {
                    try { router.navigate('library'); } catch (_) { router.navigate('home'); }
                }
            } catch (err) {
                const msg = String(err?.message || err);
                const status = document.getElementById('delete-rating-status');
                if (status) {
                    status.textContent = `Delete failed: ${msg}`;
                    status.style.color = 'rgba(239,68,68,0.95)';
                }
                showToast(`Delete failed: ${msg}`);
            }
        }

        function closeUpdateWatchModal(choice) {
            const overlay = document.getElementById('update-watch-overlay');
            if (overlay) {
                overlay.classList.remove('open');
                overlay.style.display = 'none';
            }

            try {
                if (typeof updateWatchChoiceResolver === 'function') {
                    const resolve = updateWatchChoiceResolver;
                    updateWatchChoiceResolver = null;
                    resolve(choice);
                }
            } catch (_) {
                updateWatchChoiceResolver = null;
            }
        }

        function promptUpdateWatchChoice() {
            // Returns: 'update_only' | 'update_and_watch' | null
            return new Promise((resolve) => {
                updateWatchChoiceResolver = resolve;
                openUpdateWatchModal();
            });
        }

        function openWatchMethodModal() {
            const overlay = document.getElementById('watch-method-overlay');
            if (!overlay) return;
            const dateEl = document.getElementById('watch-method-date');
            if (dateEl) {
                dateEl.value = getLocalISODate();
            }

            // Reset selection every time to prevent accidental saves.
            watchMethodPendingSelection = null;
            try {
                overlay.setAttribute('data-has-selection', 'false');
                const saveBtn = document.getElementById('watch-method-save');
                if (saveBtn) {
                    saveBtn.disabled = true;
                    saveBtn.setAttribute('aria-disabled', 'true');
                }
                overlay.querySelectorAll('[data-watch-method-option="true"]').forEach((btn) => {
                    btn.classList.remove('selected');
                    btn.setAttribute('aria-pressed', 'false');
                });
            } catch (_) {}

            overlay.style.display = 'flex';
            overlay.classList.add('open');
        }

        function selectWatchMethodModal(method) {
            watchMethodPendingSelection = String(method || '').trim() || null;
            const overlay = document.getElementById('watch-method-overlay');
            if (!overlay) return;

            try {
                overlay.setAttribute('data-has-selection', watchMethodPendingSelection ? 'true' : 'false');
                overlay.querySelectorAll('[data-watch-method-option="true"]').forEach((btn) => {
                    const isSelected = String(btn.textContent || '').trim() === watchMethodPendingSelection;
                    btn.classList.toggle('selected', isSelected);
                    btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
                });
                const saveBtn = document.getElementById('watch-method-save');
                if (saveBtn) {
                    saveBtn.disabled = !watchMethodPendingSelection;
                    saveBtn.setAttribute('aria-disabled', (!watchMethodPendingSelection).toString());
                }
            } catch (_) {}
        }

        function submitWatchMethodModal() {
            if (!watchMethodPendingSelection) {
                showToast('Select At Home or In Theater, then tap Save.', { level: 'warn' });
                return;
            }

            const dateEl = document.getElementById('watch-method-date');
            const watch_date = String(dateEl?.value || '').trim();
            if (!watch_date) {
                showToast('Please select a watch date.', { level: 'warn' });
                try { dateEl?.focus?.(); } catch (_) {}
                return;
            }

            closeWatchMethodModal({
                watch_method: watchMethodPendingSelection,
                watch_date,
            });
        }

        function closeWatchMethodModal(choice) {
            const overlay = document.getElementById('watch-method-overlay');
            if (overlay) {
                overlay.classList.remove('open');
                overlay.style.display = 'none';
            }

            try {
                if (typeof watchMethodChoiceResolver === 'function') {
                    const resolve = watchMethodChoiceResolver;
                    watchMethodChoiceResolver = null;
                    resolve(choice);
                }
            } catch (_) {
                watchMethodChoiceResolver = null;
            }
        }

        function promptWatchMethodChoice() {
            // Returns: { watch_method: 'At Home' | 'In Theater', watch_date: 'YYYY-MM-DD' } | null
            return new Promise((resolve) => {
                watchMethodChoiceResolver = resolve;
                openWatchMethodModal();
            });
        }

        // ---- Watch Details (Modal 1 of the new-entry save flow) -----------------
        // Asks: When did you watch? / Where did you watch? / Was this your first time?
        function openWatchDetailsModal() {
            const overlay = document.getElementById('watch-details-overlay');
            if (!overlay) return;

            // Reset state every open so nothing carries over between saves.
            watchDetailsPendingMethod = null;
            watchDetailsPendingBefore = null;

            const dateEl = document.getElementById('watch-details-date');
            if (dateEl) dateEl.value = getLocalISODate();

            overlay.querySelectorAll('[data-wd-method-option]').forEach((b) => setModalOptionSelected(b, false));
            overlay.querySelectorAll('[data-wd-before]').forEach((b) => setModalOptionSelected(b, false));

            overlay.style.display = 'flex';
            overlay.classList.add('open');
        }

        function setModalOptionSelected(btn, isSelected) {
            if (!btn) return;
            btn.classList.toggle('selected', !!isSelected);
            btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
        }

        function selectWatchDetailsMethod(method) {
            watchDetailsPendingMethod = String(method || '').trim() || null;
            const overlay = document.getElementById('watch-details-overlay');
            if (!overlay) return;
            overlay.querySelectorAll('[data-wd-method-option]').forEach((b) => {
                setModalOptionSelected(b, b.getAttribute('data-wd-method-option') === watchDetailsPendingMethod);
            });
        }

        function selectWatchDetailsBefore(before) {
            // `before` = "have they watched it before?" — i.e. NOT their first time.
            // UI asks "Was this your first time?": Yes → before=false, No → before=true.
            watchDetailsPendingBefore = !!before;
            const overlay = document.getElementById('watch-details-overlay');
            if (!overlay) return;
            const want = String(!!before);
            overlay.querySelectorAll('[data-wd-before]').forEach((b) => {
                setModalOptionSelected(b, b.getAttribute('data-wd-before') === want);
            });
        }

        function submitWatchDetailsModal() {
            const dateEl = document.getElementById('watch-details-date');
            const watch_date = String(dateEl?.value || '').trim();
            if (!watch_date) {
                showToast('Please pick when you watched it.', { level: 'warn' });
                try { dateEl?.focus?.(); } catch (_) {}
                return;
            }
            if (!watchDetailsPendingMethod) {
                showToast('Please choose where you watched it.', { level: 'warn' });
                return;
            }
            if (watchDetailsPendingBefore === null) {
                showToast('Please answer whether this was your first time watching it.', { level: 'warn' });
                return;
            }
            closeWatchDetailsModal({
                watch_date,
                watch_method: watchDetailsPendingMethod,
                watched_before: watchDetailsPendingBefore,
            });
        }

        function closeWatchDetailsModal(result) {
            const overlay = document.getElementById('watch-details-overlay');
            if (overlay) {
                overlay.classList.remove('open');
                overlay.style.display = 'none';
            }
            try {
                if (typeof watchDetailsResolver === 'function') {
                    const resolve = watchDetailsResolver;
                    watchDetailsResolver = null;
                    resolve(result);
                }
            } catch (_) {
                watchDetailsResolver = null;
            }
        }

        function promptWatchDetails() {
            // Returns: { watch_date, watch_method, watched_before: boolean } | null (canceled)
            return new Promise((resolve) => {
                watchDetailsResolver = resolve;
                openWatchDetailsModal();
            });
        }

        function openPriorWatchesModal() {
            const overlay = document.getElementById('prior-watches-overlay');
            const countEl = document.getElementById('prior-watches-count');
            if (!overlay) return;

            // Reset the count input to 1 and render its rows.
            if (countEl) countEl.value = '1';
            renderPriorWatchesRows(1);

            overlay.style.display = 'flex';
            overlay.classList.add('open');
        }

        // Renders `n` date+method rows, preserving any values already entered so
        // changing the count doesn't wipe what the user typed.
        function renderPriorWatchesRows(count) {
            const fields = document.getElementById('prior-watches-fields');
            if (!fields) return;

            const n = Math.max(1, Math.min(100, Math.floor(Number(count) || 1)));
            priorWatchesPendingCount = n;

            // Snapshot existing values before re-rendering.
            const prev = [];
            for (let i = 1; i <= 100; i++) {
                const d = document.getElementById(`prior-watch-date-${i}`);
                const m = document.getElementById(`prior-watch-method-${i}`);
                if (!d && !m) break;
                prev[i] = { date: d?.value || '', method: m?.value || '' };
            }

            const today = getLocalISODate();
            fields.innerHTML = Array.from({ length: n }).map((_, i) => {
                const num = i + 1;
                const pd = prev[num]?.date || '';
                const pm = prev[num]?.method || '';
                return `
                    <div style="border: 1px solid rgba(255,255,255,0.08); border-radius: 0.75rem; padding: 0.85rem; background: rgba(255,255,255,0.03);">
                        <div class="text-sm text-white font-semibold" style="margin-bottom: 0.5rem;">Previous viewing #${num}</div>
                        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
                            <div>
                                <label class="text-xs text-gray" style="display:block; margin-bottom: 0.35rem;">Date</label>
                                <input id="prior-watch-date-${num}" type="date" class="input-field" max="${today}" value="${pd}" onclick="openDatePickerFromInput(this)" onfocus="openDatePickerFromInput(this)" required>
                            </div>
                            <div>
                                <label class="text-xs text-gray" style="display:block; margin-bottom: 0.35rem;">Watch Method</label>
                                <select id="prior-watch-method-${num}" class="input-field" required>
                                    <option value="" disabled ${pm ? '' : 'selected'}>Select...</option>
                                    <option value="At Home" ${pm === 'At Home' ? 'selected' : ''}>At Home</option>
                                    <option value="In Theater" ${pm === 'In Theater' ? 'selected' : ''}>In Theater</option>
                                </select>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        function closePriorWatchesModal(result) {
            const overlay = document.getElementById('prior-watches-overlay');
            if (overlay) {
                overlay.classList.remove('open');
                overlay.style.display = 'none';
            }

            try {
                if (typeof priorWatchesChoiceResolver === 'function') {
                    const resolve = priorWatchesChoiceResolver;
                    priorWatchesChoiceResolver = null;
                    resolve(result);
                }
            } catch (_) {
                priorWatchesChoiceResolver = null;
            }
        }

        function submitPriorWatchesModal() {
            // Use the live count from the input (defensive: re-sync the rendered rows).
            const countEl = document.getElementById('prior-watches-count');
            const wanted = Math.max(1, Math.min(100, Math.floor(Number(countEl?.value) || priorWatchesPendingCount || 1)));
            if (wanted !== priorWatchesPendingCount) renderPriorWatchesRows(wanted);

            const entries = [];
            for (let i = 1; i <= priorWatchesPendingCount; i++) {
                const dateEl = document.getElementById(`prior-watch-date-${i}`);
                const methodEl = document.getElementById(`prior-watch-method-${i}`);
                const watch_date = String(dateEl?.value || '').trim();
                const watch_method = String(methodEl?.value || '').trim() || null;
                if (!watch_date) {
                    showToast(`Please select a date for previous viewing #${i}.`, { level: 'warn' });
                    try { dateEl?.focus?.(); } catch (_) {}
                    return;
                }
                if (!watch_method) {
                    showToast(`Please select a watch method for previous viewing #${i}.`, { level: 'warn' });
                    try { methodEl?.focus?.(); } catch (_) {}
                    return;
                }
                entries.push({ watch_date, watch_method });
            }

            closePriorWatchesModal({ entries });
        }

        function promptPriorWatches() {
            // The user sets how many previous watches inside the modal itself.
            // Returns: { entries: Array<{watch_date, watch_method}> } | null (canceled)
            return new Promise((resolve) => {
                priorWatchesChoiceResolver = resolve;
                openPriorWatchesModal();
            });
        }

        function getTierHelpText(tier) {
            const t = String(tier || '').trim();
            if (t === 'S-Tier') return 'The Pantheon. Best of the Best.';
            if (t === 'A-Tier') return 'Great! Highly recommended films!';
            if (t === 'B-Tier') return 'Worth a Watch. Solidly good and Entertaining';
            if (t === 'C-Tier') return "Totally Average. Fine if it's on, but don't go out of your way.";
            if (t === 'D-Tier') return 'Skip it. Seriously Flawed and not worth the time.';
            if (t === 'F-Tier') return 'Avoid at all costs! A genuinely bad experience.';
            return 'Choose exactly one tier';
        }

        function setTierFromButton(btn) {
            try {
                const group = btn?.closest?.('.tier-btn-group');
                if (!group) return;
                const tier = String(btn.getAttribute('data-tier') || '').trim();
                const targetInputId = String(group.getAttribute('data-target-input') || '').trim();
                const input = targetInputId ? document.getElementById(targetInputId) : null;
                if (input) input.value = tier;

                group.querySelectorAll('.tier-btn').forEach((b) => {
                    const isSelected = b === btn;
                    b.classList.toggle('selected', isSelected);
                    b.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
                });

                group.setAttribute('data-has-selection', tier ? 'true' : 'false');

                const help = document.getElementById('tier-help-text');
                if (help) help.textContent = getTierHelpText(tier);
            } catch (_) {}
        }

        function showLoadingOverlay(message) {
            const overlay = document.getElementById('loading-overlay');
            if (!overlay) return;
            if (message) {
                try {
                    const msgEl = overlay.querySelector('.text-sm span:last-child');
                    if (msgEl) msgEl.textContent = String(message);
                } catch (_) {}
            }
            overlay.style.display = 'flex';
            overlay.classList.add('open');
        }

        function hideLoadingOverlay() {
            const overlay = document.getElementById('loading-overlay');
            if (!overlay) return;
            overlay.classList.remove('open');
            overlay.style.display = 'none';
        }

        function toggleWatchMethod(btn) {
            try {
                if (btn?.disabled) return;
            } catch (_) {}
            const isTheater = btn.textContent.trim().toLowerCase().includes('theater');
            const hidden = document.getElementById('fld-watchmethod');
            if (isTheater) {
                btn.textContent = 'At Home';
                if (hidden) hidden.value = 'At Home';
                btn.style.backgroundColor = 'rgba(168, 85, 247, 0.35)';
                btn.style.borderColor = 'rgba(168, 85, 247, 0.5)';
            } else {
                btn.textContent = 'In Theater';
                if (hidden) hidden.value = 'In Theater';
                btn.style.backgroundColor = 'rgba(20, 184, 166, 0.35)';
                btn.style.borderColor = 'rgba(20, 184, 166, 0.5)';
            }
        }

        async function requireAuthOrThrow() {
            if (!supabaseClient) throw new Error('Supabase client not initialized.');

            // In guest mode, return a fake user/token so read-only flows work.
            if (guestMode) {
                return {
                    user: { id: DEMO_USER_ID, email: 'demo@cinematracker.app' },
                    accessToken: '__guest_demo_token__'
                };
            }

            const { data, error } = await supabaseClient.auth.getSession();
            if (error) throw error;
            let session = data?.session || null;
            let user = session?.user || null;
            let accessToken = session?.access_token || null;
            if (!user?.id || !accessToken) throw new Error('Please log in first.');

            // Validate the token with Supabase Auth. If invalid/expired, try a refresh.
            const { data: userData, error: userErr } = await supabaseClient.auth.getUser();
            if (userErr || !userData?.user?.id) {
                const { data: refreshed, error: refreshErr } = await supabaseClient.auth.refreshSession();
                if (refreshErr) {
                    throw new Error('Session invalid. Click Log out, then Log in again.');
                }
                session = refreshed?.session || null;
                user = session?.user || null;
                accessToken = session?.access_token || null;
                if (!user?.id || !accessToken) {
                    throw new Error('Session invalid. Click Log out, then Log in again.');
                }

                const { data: userData2, error: userErr2 } = await supabaseClient.auth.getUser();
                if (userErr2 || !userData2?.user?.id) {
                    throw new Error('Invalid JWT. Click Log out, then Log in again.');
                }
            }

            return { user, accessToken };
        }

        async function insertWatchLog({ user_id, movie_id, watch_method = null, watch_date }) {
            if (!supabaseClient) throw new Error('Supabase client not initialized.');
            if (!user_id) throw new Error('Missing user_id.');
            if (!movie_id) throw new Error('Missing movie_id.');
            const wd = String(watch_date || '').trim();
            if (!wd) throw new Error('Missing watch_date.');

            const row = {
                user_id,
                movie_id,
                watch_method,
                [COL_WATCH_DATE]: wd,
            };

            const { error } = await supabaseClient
                .from('Watch Logs')
                .insert(row);

            if (error) throw error;
        }

        async function insertWatchLogIfMissing({ user_id, movie_id, watch_method = null, watch_date }) {
            if (!supabaseClient) throw new Error('Supabase client not initialized.');
            if (!user_id) throw new Error('Missing user_id.');
            if (!movie_id) throw new Error('Missing movie_id.');
            const wd = String(watch_date || '').trim();
            if (!wd) throw new Error('Missing watch_date.');

            const { data: existing, error: existsErr } = await supabaseClient
                .from('Watch Logs')
                .select('id')
                .eq('user_id', user_id)
                .eq('movie_id', movie_id)
                .limit(1);

            if (existsErr) throw existsErr;
            if (Array.isArray(existing) && existing.length > 0) return;

            await insertWatchLog({ user_id, movie_id, watch_method, watch_date: wd });
        }

        async function insertWatchLogsBulk({ user_id, movie_id, entries }) {
            if (!supabaseClient) throw new Error('Supabase client not initialized.');
            if (!user_id) throw new Error('Missing user_id.');
            if (!movie_id) throw new Error('Missing movie_id.');
            if (!Array.isArray(entries) || entries.length === 0) return;

            const rows = entries.map((e) => {
                const wd = String(e?.watch_date || '').trim();
                if (!wd) throw new Error('Missing watch_date.');
                return {
                    user_id,
                    movie_id,
                    watch_method: (e?.watch_method ?? null),
                    [COL_WATCH_DATE]: wd,
                };
            });

            const { error } = await supabaseClient
                .from('Watch Logs')
                .insert(rows);

            if (error) throw error;
        }

        function isUuidLike(v) {
            return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || '').trim());
        }

        function getTmdbIdFromSelectedMovie(movie) {
            if (!movie) return null;
            // Common shapes:
            // - movie.tmdb_id (number)
            // - movie.id (TMDb numeric id)
            // - movie.id (uuid) -> ignore
            if (movie?.tmdb_id !== undefined && movie?.tmdb_id !== null) {
                const n = Number(movie.tmdb_id);
                return Number.isFinite(n) && n > 0 ? n : null;
            }

            const rawId = movie?.id;
            if (isUuidLike(rawId)) return null;
            const n = Number(rawId);
            return Number.isFinite(n) && n > 0 ? n : null;
        }

        async function getDbMovieIdByTmdbId(tmdb_id) {
            if (!supabaseClient) throw new Error('Supabase client not initialized.');
            const n = Number(tmdb_id);
            if (!Number.isFinite(n) || n <= 0) throw new Error('Missing tmdb_id.');

            const { data, error } = await supabaseClient
                .from('Movies')
                .select('id')
                .eq('tmdb_id', n)
                .limit(1);

            if (error) throw error;
            if (!Array.isArray(data) || data.length === 0) return null;
            return data[0]?.id || null;
        }

        async function getDbMovieRowById(movie_id) {
            if (!supabaseClient) throw new Error('Supabase client not initialized.');
            if (!movie_id) throw new Error('Missing movie_id.');

            const { data, error } = await supabaseClient
                .from('Movies')
                .select('*')
                .eq('id', movie_id)
                .limit(1);

            if (error) throw error;
            if (!Array.isArray(data) || data.length === 0) return null;
            return data[0] || null;
        }

        async function resolveDbMovieIdFromSelectedMovie(movie) {
            if (!movie) return null;
            // Allow callers (like Data Dash poster clicks) to pass the DB id explicitly.
            if (movie?.db_movie_id !== undefined && movie?.db_movie_id !== null && String(movie.db_movie_id).trim() !== '') {
                return movie.db_movie_id;
            }
            if (isUuidLike(movie?.id)) return movie.id;
            const tmdb_id = getTmdbIdFromSelectedMovie(movie);
            if (!tmdb_id) return null;
            return await getDbMovieIdByTmdbId(tmdb_id);
        }

        async function hasExistingMovieRating({ user_id, movie_id }) {
            if (!supabaseClient) throw new Error('Supabase client not initialized.');
            if (!user_id) throw new Error('Missing user_id.');
            if (!movie_id) throw new Error('Missing movie_id.');

            const { data, error } = await supabaseClient
                .from('Movie Ratings')
                .select('id')
                .eq('user_id', user_id)
                .eq('movie_id', movie_id)
                .limit(1);

            if (error) throw error;
            return Array.isArray(data) && data.length > 0;
        }

        async function getExistingMovieRatingRow({ user_id, movie_id }) {
            if (!supabaseClient) throw new Error('Supabase client not initialized.');
            if (!user_id) throw new Error('Missing user_id.');
            if (!movie_id) throw new Error('Missing movie_id.');

            const { data, error } = await supabaseClient
                .from('Movie Ratings')
                .select('*')
                .eq('user_id', user_id)
                .eq('movie_id', movie_id)
                .limit(1);

            if (error) throw error;
            if (!Array.isArray(data) || data.length === 0) return null;
            return data[0] || null;
        }

        async function getLatestWatchLog({ user_id, movie_id }) {
            if (!supabaseClient) throw new Error('Supabase client not initialized.');
            if (!user_id) throw new Error('Missing user_id.');
            if (!movie_id) throw new Error('Missing movie_id.');

            const { data, error } = await supabaseClient
                .from('Watch Logs')
                .select(`id, watch_method, ${COL_WATCH_DATE}`)
                .eq('user_id', user_id)
                .eq('movie_id', movie_id)
                .order(COL_WATCH_DATE, { ascending: false })
                .order('id', { ascending: false })
                .limit(1);

            if (error) throw error;
            if (!Array.isArray(data) || data.length === 0) return null;
            return data[0] || null;
        }

        async function getEarliestWatchLog({ user_id, movie_id }) {
            if (!supabaseClient) throw new Error('Supabase client not initialized.');
            if (!user_id) throw new Error('Missing user_id.');
            if (!movie_id) throw new Error('Missing movie_id.');

            const { data, error } = await supabaseClient
                .from('Watch Logs')
                .select(`id, watch_method, ${COL_WATCH_DATE}`)
                .eq('user_id', user_id)
                .eq('movie_id', movie_id)
                .order(COL_WATCH_DATE, { ascending: true })
                .order('id', { ascending: true })
                .limit(1);

            if (error) throw error;
            if (!Array.isArray(data) || data.length === 0) return null;
            return data[0] || null;
        }

        async function getWatchLogCount({ user_id, movie_id }) {
            if (!supabaseClient) throw new Error('Supabase client not initialized.');
            if (!user_id) throw new Error('Missing user_id.');
            if (!movie_id) throw new Error('Missing movie_id.');

            // Use an efficient count-only query.
            const { count, error } = await supabaseClient
                .from('Watch Logs')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', user_id)
                .eq('movie_id', movie_id);

            if (error) throw error;
            return Number.isFinite(Number(count)) ? Number(count) : 0;
        }

        function getLocalISODate(d = new Date()) {
            const dt = (d instanceof Date) ? d : new Date(d);
            const year = dt.getFullYear();
            const month = String(dt.getMonth() + 1).padStart(2, '0');
            const day = String(dt.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }

        function decodeJwtPayload(token) {
            try {
                const parts = String(token || '').split('.');
                if (parts.length < 2) return null;
                const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
                const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
                const json = atob(padded);
                return JSON.parse(json);
            } catch (_) {
                return null;
            }
        }

        async function callSwiftApi(body, accessToken) {
            const iss = decodeJwtPayload(accessToken)?.iss;
            if (iss && typeof iss === 'string' && !iss.includes(SUPABASE_URL)) {
                throw new Error(
                    `Auth token is for a different Supabase project (iss=${iss}). Check SUPABASE_URL.`
                );
            }

            const url = `${SUPABASE_URL}/functions/v1/swift-api`;
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${accessToken}`
                },
                body: JSON.stringify(body)
            });

            const text = await res.text();
            let data = null;
            try {
                data = text ? JSON.parse(text) : null;
            } catch (_) {
                data = text;
            }

            if (!res.ok) {
                const serverMsg =
                    data && typeof data === 'object'
                        ? (data.message || data.error || JSON.stringify(data))
                        : String(data || '');
                const serverDetails =
                    data && typeof data === 'object' && data.details
                        ? ` (${String(data.details)})`
                        : '';
                throw new Error(`swift-api failed (HTTP ${res.status}) - ${serverMsg}${serverDetails}`);
            }

            return data;
        }

        async function callColorThemeEdge(body, accessToken) {
            const iss = decodeJwtPayload(accessToken)?.iss;
            if (iss && typeof iss === 'string' && !iss.includes(SUPABASE_URL)) {
                throw new Error(
                    `Auth token is for a different Supabase project (iss=${iss}). Check SUPABASE_URL.`
                );
            }

            const url = `${SUPABASE_URL}/functions/v1/color-theme`;
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${accessToken}`
                },
                body: JSON.stringify(body)
            });

            const text = await res.text();
            let data = null;
            try {
                data = text ? JSON.parse(text) : null;
            } catch (_) {
                data = text;
            }

            if (!res.ok) {
                const serverMsg =
                    data && typeof data === 'object'
                        ? (data.message || data.error || JSON.stringify(data))
                        : String(data || '');
                throw new Error(`color-theme failed (HTTP ${res.status}) - ${serverMsg}`);
            }

            return data;
        }

