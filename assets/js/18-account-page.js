        function initAccountPage() {
            if (accountBound) return;
            accountBound = true;

            document.addEventListener('click', async (e) => {
                const btn = e?.target?.closest ? e.target.closest('[data-account-action]') : null;
                if (!btn) return;
                const action = String(btn.dataset.accountAction || '').trim();

                if (action === 'reload') {
                    await loadAccountPage();
                    return;
                }

                if (action === 'open_profile') {
                    openAccountSectionModal('profile');
                    return;
                }

                if (action === 'open_notifications') {
                    openAccountSectionModal('notifications');
                    return;
                }

                if (action === 'open_security') {
                    openAccountSectionModal('security');
                    return;
                }

                if (action === 'open_feature') {
                    openAccountSectionModal('feature');
                    return;
                }

                if (action === 'theme_creator') {
                    router.navigate('theme_creator');
                    return;
                }

                if (action === 'open_achievements') {
                    router.navigate('leaderboard');
                    return;
                }

                if (action === 'pick_icon') {
                    document.getElementById('account-icon-file')?.click();
                    return;
                }

                if (action === 'remove_icon') {
                    await handleAccountIconRemove();
                    return;
                }

                if (action === 'close_modal') {
                    const kind = String(btn.dataset.modal || '').trim();
                    if (kind) closeAccountSectionModal(kind);
                    return;
                }

                if (action === 'logout') {
                    await handleLogoutClick(e);
                    return;
                }
            });

            document.addEventListener('click', (e) => {
                const sortBtn = e?.target?.closest ? e.target.closest('#account-achievement-sort-btn') : null;
                const filterBtn = e?.target?.closest ? e.target.closest('#account-achievement-filter-btn') : null;
                const pop = document.getElementById('account-achievement-filters-pop');
                if (sortBtn || filterBtn) {
                    e.preventDefault();
                    const mode = sortBtn ? 'sort' : 'filter';
                    // Same button again closes; otherwise (re)open showing that section.
                    if (achievementFiltersOpen && achievementFiltersMode === mode) {
                        setAchievementFiltersOpen(false);
                    } else {
                        setAchievementFiltersOpen(true, mode);
                    }
                    return;
                }
                if (pop && achievementFiltersOpen) {
                    const insidePop = e?.target?.closest ? e.target.closest('#account-achievement-filters-pop') : null;
                    if (!insidePop) setAchievementFiltersOpen(false);
                }
            });

            document.addEventListener('click', (e) => {
                const card = e?.target?.closest ? e.target.closest('.achievement-card[data-achievement-id]') : null;
                if (!card) return;
                const achievementId = String(card.dataset.achievementId || '').trim();
                if (!achievementId) return;
                openAchievementDetail(achievementId).catch(() => null);
            });

            document.addEventListener('submit', async (e) => {
                const form = e?.target;
                if (!form || !(form instanceof HTMLFormElement)) return;

                if (form.id === 'account-profile-form') {
                    e.preventDefault();
                    await saveAccountProfile();
                    return;
                }

                if (form.id === 'account-password-form') {
                    e.preventDefault();
                    await changeAccountPassword();
                    return;
                }

                if (form.id === 'feature-request-form') {
                    e.preventDefault();
                    await submitFeatureRequest();
                    return;
                }
            });

            document.addEventListener('input', (e) => {
                const el = e?.target;
                if (!el || !(el instanceof HTMLElement)) return;
                if (el.id === 'feature-request-text') {
                    updateFeatureRequestCounter();
                }
            });

            document.addEventListener('change', (e) => {
                const el = e?.target;
                if (!el || !(el instanceof HTMLElement)) return;
                if (el.id === 'account-icon-file' && el instanceof HTMLInputElement) {
                    const file = el.files && el.files[0];
                    if (file) handleAccountIconPick(file);
                    el.value = ''; // allow re-picking the same file
                    return;
                }
                if (el.id === 'account-achievement-sort' && el instanceof HTMLSelectElement) {
                    achievementSortMode = String(el.value || 'points_desc').trim();
                    renderAccountAchievements();
                    return;
                }
                if (el.id === 'account-achievement-filter' && el instanceof HTMLSelectElement) {
                    achievementTypeFilter = String(el.value || 'all').trim();
                    renderAccountAchievements();
                    return;
                }
                if (el.id === 'account-theme-select' && el instanceof HTMLSelectElement) {
                    const value = String(el.value || '').trim();
                    applyTheme(value);
                    saveAccountThemeSelection(value).catch(() => null);
                }
            });

            applyTheme(getStoredTheme());
            refreshAchievementsUI().catch(() => null);
        }

        async function loadAccountPage() {
            const profileStatus = document.getElementById('account-profile-status');
            const passwordStatus = document.getElementById('account-password-status');
            const emailEl = document.getElementById('account-email');
            const usernameEl = document.getElementById('account-username');
            updateFeatureRequestCounter();

            if (profileStatus) profileStatus.textContent = '';
            if (passwordStatus) passwordStatus.textContent = '';

            if (!supabaseClient || !cachedIsAuthed) {
                if (profileStatus) profileStatus.textContent = 'Log in to manage your account.';
                if (emailEl) emailEl.textContent = '';
                updateTestAchievementVisibility('');
                updateAdminPanelVisibility('');
                return;
            }

            let user = cachedAuthUser;
            try {
                const { data: udata } = await supabaseClient.auth.getUser();
                user = udata?.user || user;
            } catch (_) {}

            const uid = String(user?.id || '').trim();
            const email = String(user?.email || '').trim();
            if (emailEl) emailEl.textContent = email || '(no email)';
            updateThemeCreatorVisibility(email);
            updateTestAchievementVisibility(email);
            updateAdminPanelVisibility(email);
            refreshAchievementsUI().catch(() => null);

            if (!uid) {
                if (profileStatus) profileStatus.textContent = 'Auth session missing user id.';
                return;
            }

            if (profileStatus) profileStatus.textContent = 'Loading profile…';

            try {
                let data = null;
                try {
                    const r1 = await supabaseClient
                        .from('Users')
                        .select('username, display_name, icon, theme_id')
                        .eq('id', uid)
                        .limit(1);
                    if (r1.error) throw r1.error;
                    data = r1.data;
                } catch (err1) {
                    const msg1 = String(err1?.message || err1);
                    if (/column\s+"?icon"?\s+does\s+not\s+exist/i.test(msg1)) {
                        const r2 = await supabaseClient
                            .from('Users')
                            .select('username, display_name, theme_id')
                            .eq('id', uid)
                            .limit(1);
                        if (r2.error) throw r2.error;
                        data = r2.data;
                    } else if (/column\s+"?theme_id"?\s+does\s+not\s+exist/i.test(msg1)) {
                        const r2 = await supabaseClient
                            .from('Users')
                            .select('username, display_name, icon')
                            .eq('id', uid)
                            .limit(1);
                        if (r2.error) throw r2.error;
                        data = r2.data;
                    } else {
                        throw err1;
                    }
                }

                const row = Array.isArray(data) && data.length ? data[0] : null;
                const username = String(row?.username || '').trim();
                const themeId = String(row?.theme_id || '').trim();
                if (usernameEl) usernameEl.value = username;
                setAccountIconPreview(String(row?.icon || '').trim());
                const themeSelect = document.getElementById('account-theme-select');
                if (themeSelect) {
                    const value = resolveThemeId(themeId || getStoredTheme());
                    if (value) {
                        themeSelect.value = value;
                        applyTheme(value);
                    }
                }

                if (profileStatus) profileStatus.textContent = 'Profile loaded.';
            } catch (err) {
                if (profileStatus) profileStatus.textContent = `Could not load profile: ${String(err?.message || err)}`;
            }
        }

        // Loader for the dedicated Achievements page (its own route, reached from the
        // Account page's "Achievements" card). Uses the same DOM ids + shared handlers
        // as the old inline panel, so renderAccountAchievements/refreshAchievementsUI
        // target it unchanged.
        async function loadAchievementsPage() {
            if (!supabaseClient || !cachedIsAuthed) {
                refreshAchievementsUI().catch(() => null);
                return;
            }
            let email = '';
            try {
                const { data: udata } = await supabaseClient.auth.getUser();
                email = String(udata?.user?.email || '').trim();
            } catch (_) {}
            updateTestAchievementVisibility(email); // admin-only "Achievement Testing" panel
            await refreshAchievementsUI();
        }

        // ===== Profile photo (camera roll → square avatar) =====
        // The avatar lives directly in Users.icon as a small JPEG data URL, which
        // renderUserIconHtml()/isUserIconUrl() (15-auth-account-modals.js) already
        // understand — so no Storage bucket/RLS is needed and it works the same on
        // mobile and desktop.

        function setAccountIconPreview(iconVal) {
            const el = document.getElementById('account-icon-preview');
            if (!el) return;
            const raw = String(iconVal || '').trim();
            // The preview box already carries the `.user-icon` class, so inject just
            // its inner content (matching renderUserIconHtml's structure).
            el.innerHTML = isUserIconUrl(raw)
                ? `<img src="${escapeHtml(raw)}" alt="User icon" loading="lazy" decoding="async" />`
                : icons.user;
        }

        // Downscale + center-crop ("cover") a chosen image to a square JPEG data URL
        // small enough to store inline (≈256px). Resolves to the data URL string.
        function processAccountIconFile(file, size = 256) {
            return new Promise((resolve, reject) => {
                if (!file || !/^image\//i.test(String(file.type || ''))) {
                    reject(new Error('Please choose an image file.'));
                    return;
                }
                const url = URL.createObjectURL(file);
                const img = new Image();
                img.onload = () => {
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = size;
                        canvas.height = size;
                        const ctx = canvas.getContext('2d');
                        ctx.fillStyle = '#000';
                        ctx.fillRect(0, 0, size, size);
                        const scale = Math.max(size / img.width, size / img.height);
                        const dw = img.width * scale;
                        const dh = img.height * scale;
                        ctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh);
                        resolve(canvas.toDataURL('image/jpeg', 0.85));
                    } catch (e) {
                        reject(e);
                    } finally {
                        URL.revokeObjectURL(url);
                    }
                };
                img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
                img.src = url;
            });
        }

        async function handleAccountIconPick(file) {
            if (guardGuestWrite()) return;
            const profileStatus = document.getElementById('account-profile-status');
            const uid = String(cachedAuthUser?.id || '').trim();
            if (!supabaseClient || !cachedIsAuthed || !uid) {
                showToast('Please log in first.', { level: 'warn' });
                return;
            }
            try {
                if (profileStatus) profileStatus.textContent = 'Updating photo…';
                const dataUrl = await processAccountIconFile(file);
                const { error } = await supabaseClient.from('Users').update({ icon: dataUrl }).eq('id', uid);
                if (error) throw error;
                setAccountIconPreview(dataUrl);
                // Sync the nav avatar + any cached renders immediately.
                cachedUserIconId = uid;
                cachedUserIcon = dataUrl;
                cachedUserIconLoaded = true;
                await refreshAuthStateAndUI();
                if (profileStatus) profileStatus.textContent = 'Photo updated.';
                showToast('Profile photo updated.');
            } catch (err) {
                const msg = String(err?.message || err);
                if (profileStatus) profileStatus.textContent = `Photo update failed: ${msg}`;
                showToast(`Photo update failed: ${msg}`, { level: 'warn' });
            }
        }

        async function handleAccountIconRemove() {
            if (guardGuestWrite()) return;
            const profileStatus = document.getElementById('account-profile-status');
            const uid = String(cachedAuthUser?.id || '').trim();
            if (!supabaseClient || !cachedIsAuthed || !uid) {
                showToast('Please log in first.', { level: 'warn' });
                return;
            }
            try {
                const { error } = await supabaseClient.from('Users').update({ icon: null }).eq('id', uid);
                if (error) throw error;
                setAccountIconPreview('');
                cachedUserIconId = uid;
                cachedUserIcon = '';
                cachedUserIconLoaded = true;
                await refreshAuthStateAndUI();
                if (profileStatus) profileStatus.textContent = 'Photo removed.';
                showToast('Profile photo removed.');
            } catch (err) {
                showToast(`Could not remove photo: ${String(err?.message || err)}`, { level: 'warn' });
            }
        }

        // Push test: request notification permission and fire a LOCAL notification
        // via the service worker. Proves the iOS gates work — installed-to-Home-Screen
        // + permission + the SW can display.
        async function enableNotificationsTest() {
            const statusEl = document.getElementById('push-test-status');
            const setStatus = (m, ok) => {
                if (!statusEl) return;
                statusEl.textContent = String(m || '');
                statusEl.style.color = ok ? 'rgba(74,222,128,0.95)' : 'rgba(239,68,68,0.95)';
            };
            try {
                if (!('Notification' in window) || !('serviceWorker' in navigator)) {
                    setStatus('Notifications aren’t available here. On iPhone, add the app to your Home Screen and open it from there first.', false);
                    return;
                }
                const perm = await Notification.requestPermission();
                if (perm !== 'granted') {
                    setStatus('Permission was not granted, so notifications can’t be shown.', false);
                    return;
                }

                // First try a REAL end-to-end Web Push through the server (`test_push`).
                // This is the only check that actually verifies the full pipeline:
                // VAPID secrets are set + this device's subscription was saved + the
                // server can deliver. A local notification (below) only proves display.
                setStatus('Sending real push…', true);
                let realSent = 0, reason = '';
                try {
                    const { data: s } = await supabaseClient.auth.getSession();
                    const token = s?.session?.access_token;
                    if (token) {
                        const res = await callSwiftApi({ action: 'test_push' }, token);
                        realSent = Number(res?.sent || 0);
                        reason = String(res?.reason || '');
                    } else {
                        reason = 'Not logged in.';
                    }
                } catch (e) {
                    reason = String(e?.message || e);
                }
                if (realSent > 0) {
                    setStatus(`Real push delivered to ${realSent} device${realSent === 1 ? '' : 's'}. 🎉`, true);
                    return;
                }

                // Fall back to a LOCAL notification so the user still sees something,
                // and explain why the real push didn't go out (usually: push not
                // enabled on this device, or VAPID secrets missing on the server).
                const reg = await navigator.serviceWorker.ready;
                await reg.showNotification('CinemaTracker', {
                    body: 'Local test notification 🍿',
                    icon: 'assets/icons/icon-192.png',
                    badge: 'assets/icons/icon-192.png',
                });
                setStatus(reason
                    ? `Showed a local test, but no real push was sent: ${reason}`
                    : 'Showed a local test. Turn on “Push notifications” above to test real (server) pushes.', false);
            } catch (err) {
                setStatus(`Could not enable notifications: ${String(err?.message || err)}`, false);
            }
        }

        // ---- Real Web Push (push-or-text routing) ------------------------------
        function urlBase64ToUint8Array(base64String) {
            const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
            const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
            const raw = atob(base64);
            const arr = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
            return arr;
        }

        function isStandalonePwa() {
            try {
                return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
            } catch (_) { return false; }
        }

        // Ask for permission, subscribe via the Push API, and save the subscription
        // so the server can push to this device (instead of texting).
        async function enablePushOnThisDevice() {
            if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
                throw new Error('This device/browser doesn’t support push notifications.');
            }
            const perm = await Notification.requestPermission();
            if (perm !== 'granted') throw new Error('Notification permission was not granted.');

            const reg = await navigator.serviceWorker.ready;
            let sub = await reg.pushManager.getSubscription();
            if (!sub) {
                sub = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
                });
            }
            const json = sub.toJSON();
            const uid = getActiveUserId();
            if (!uid) throw new Error('Please log in first.');
            const { error } = await supabaseClient.from('push_subscriptions').upsert({
                user_id: uid,
                endpoint: json.endpoint,
                p256dh: json.keys?.p256dh,
                auth: json.keys?.auth,
            }, { onConflict: 'endpoint' });
            if (error) throw error;
        }

        async function disablePushOnThisDevice() {
            try {
                const reg = await navigator.serviceWorker.ready;
                const sub = await reg.pushManager.getSubscription();
                if (sub) {
                    const endpoint = sub.endpoint;
                    try { await sub.unsubscribe(); } catch (_) {}
                    try { await supabaseClient.from('push_subscriptions').delete().eq('endpoint', endpoint); } catch (_) {}
                }
            } catch (_) {}
        }

        // Called when the user taps "Save push setting". Toggling on triggers the
        // OS (iOS) permission prompt; toggling off unsubscribes this device.
        async function savePushSetting() {
            const toggle = document.getElementById('push-enable-toggle');
            const statusEl = document.getElementById('push-setting-status');
            const setStatus = (m, ok) => {
                if (!statusEl) return;
                statusEl.textContent = String(m || '');
                statusEl.style.color = ok ? 'rgba(74,222,128,0.95)' : 'rgba(239,68,68,0.95)';
            };
            if (!toggle) return;
            try {
                if (toggle.checked) {
                    if (!isStandalonePwa() && /iphone|ipad|ipod/i.test(navigator.userAgent)) {
                        toggle.checked = false;
                        setStatus('On iPhone, first add the app to your Home Screen and open it from there — then enable push.', false);
                        return;
                    }
                    await enablePushOnThisDevice();
                    setStatus('Push enabled on this device. You’ll get notifications here.', true);
                } else {
                    await disablePushOnThisDevice();
                    setStatus('Push turned off on this device. You won’t get notifications here.', true);
                }
            } catch (err) {
                toggle.checked = false;
                setStatus(String(err?.message || err), false);
            }
        }

        // Sync the toggle to the real subscription state when the modal opens.
        async function refreshPushToggleState() {
            const toggle = document.getElementById('push-enable-toggle');
            if (!toggle) return;
            try {
                if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
                    toggle.checked = false; toggle.disabled = true; return;
                }
                const reg = await navigator.serviceWorker.ready;
                const sub = await reg.pushManager.getSubscription();
                toggle.checked = !!sub && Notification.permission === 'granted';
            } catch (_) { toggle.checked = false; }
        }

        // ---- New-user push opt-in prompt -------------------------------------
        // Shown on the first authenticated boot after signup (flag set in the
        // signup handler). One-shot, and skipped if push is unsupported or already on.
        async function maybePromptPushAfterSignup() {
            let flagged = false;
            try { flagged = localStorage.getItem('ct_prompt_push_signup') === '1'; } catch (_) {}
            if (!flagged || !cachedIsAuthed) return;
            // Clear immediately so it only ever prompts once (even if dismissed).
            try { localStorage.removeItem('ct_prompt_push_signup'); } catch (_) {}

            if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;

            // Skip if already enabled — but never block the prompt on a slow/absent
            // service worker (race `.ready` against a short timeout).
            let alreadyOn = false;
            try {
                const reg = await Promise.race([
                    navigator.serviceWorker.ready,
                    new Promise((res) => setTimeout(() => res(null), 1500)),
                ]);
                if (reg) {
                    const sub = await reg.pushManager.getSubscription();
                    alreadyOn = !!sub && Notification.permission === 'granted';
                }
            } catch (_) {}
            if (alreadyOn) return;

            openPushPromptModal();
        }

        function openPushPromptModal() {
            const overlay = document.getElementById('push-prompt-overlay');
            if (!overlay) return;
            const status = document.getElementById('push-prompt-status');
            if (status) status.textContent = '';
            overlay.style.display = 'flex';
            overlay.classList.add('open');
        }

        function closePushPromptModal() {
            const overlay = document.getElementById('push-prompt-overlay');
            if (!overlay) return;
            overlay.classList.remove('open');
            overlay.style.display = 'none';
        }

        // "Enable Notifications" in the welcome prompt → trigger the OS permission
        // prompt + subscribe this device (same flow as the settings toggle).
        async function confirmPushPromptEnable() {
            const status = document.getElementById('push-prompt-status');
            const setStatus = (m, ok) => {
                if (!status) return;
                status.textContent = String(m || '');
                status.style.color = ok ? 'rgba(74,222,128,0.95)' : 'rgba(239,68,68,0.95)';
            };
            try {
                if (!isStandalonePwa() && /iphone|ipad|ipod/i.test(navigator.userAgent)) {
                    setStatus('On iPhone, add the app to your Home Screen and open it from there, then enable push in Account → Notifications.', false);
                    return;
                }
                setStatus('Requesting permission…', true);
                await enablePushOnThisDevice();
                setStatus('Notifications enabled! 🎉', true);
                setTimeout(closePushPromptModal, 900);
            } catch (err) {
                setStatus(String(err?.message || err), false);
            }
        }

        async function saveAccountProfile() {
            if (guardGuestWrite()) return;
            const profileStatus = document.getElementById('account-profile-status');
            const saveBtn = document.getElementById('account-save-profile');
            const usernameEl = document.getElementById('account-username');

            if (!supabaseClient || !cachedIsAuthed) {
                showToast('Please log in first.', { level: 'warn' });
                openAuthModal();
                return;
            }

            const uid = String(cachedAuthUser?.id || '').trim();
            if (!uid) {
                showToast('Missing user session.', { level: 'error' });
                return;
            }

            const desiredUsernameRaw = String(usernameEl?.value || '');
            const desiredUsername = normalizeUsername(desiredUsernameRaw);
            const userErr = validateUsername(desiredUsername);
            if (userErr) {
                if (profileStatus) profileStatus.textContent = userErr;
                showToast(userErr, { level: 'warn' });
                return;
            }

            const prev = saveBtn?.textContent;
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.textContent = 'Saving…';
            }
            if (profileStatus) profileStatus.textContent = 'Saving…';

            try {
                // Display name is no longer editable in the UI; leave the existing
                // column value untouched (don't send it, so a blank field can't wipe it).
                const payload = {
                    id: uid,
                    username: desiredUsername,
                };

                let data = null;
                try {
                    const r1 = await supabaseClient
                        .from('Users')
                        .upsert(payload, { onConflict: 'id' })
                        .select('username, display_name, icon')
                        .limit(1);
                    if (r1.error) throw r1.error;
                    data = r1.data;
                } catch (err1) {
                    const msg1 = String(err1?.message || err1);
                    if (/column\s+"?icon"?\s+does\s+not\s+exist/i.test(msg1)) {
                        const payload2 = { id: uid, username: desiredUsername };
                        const r2 = await supabaseClient
                            .from('Users')
                            .upsert(payload2, { onConflict: 'id' })
                            .select('username, display_name')
                            .limit(1);
                        if (r2.error) throw r2.error;
                        data = r2.data;
                    } else {
                        throw err1;
                    }
                }

                const row = Array.isArray(data) && data.length ? data[0] : null;
                const savedDisplayName = String(row?.display_name || '').trim();
                // Update cached display name so navbar updates immediately.
                cachedUserDisplayNameId = uid;
                cachedUserDisplayName = savedDisplayName;
                cachedUserDisplayNameLoaded = true;
                await refreshAuthStateAndUI();

                if (profileStatus) profileStatus.textContent = 'Saved.';
                showToast('Profile updated.');
            } catch (err) {
                const code = String(err?.code || '').trim();
                const msg = String(err?.message || err);
                if (code === '23505' || /duplicate key/i.test(msg)) {
                    if (profileStatus) profileStatus.textContent = 'That username is already taken.';
                    showToast('Username already taken.', { level: 'warn' });
                } else {
                    if (profileStatus) profileStatus.textContent = `Save failed: ${msg}`;
                    showToast(`Save failed: ${msg}`, { level: 'warn' });
                }
            } finally {
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.textContent = prev || 'Save profile';
                }
            }
        }

        async function changeAccountPassword() {
            const statusEl = document.getElementById('account-password-status');
            const btn = document.getElementById('account-change-password');
            const newEl = document.getElementById('account-new-password');
            const confirmEl = document.getElementById('account-confirm-password');

            if (!supabaseClient || !cachedIsAuthed) {
                showToast('Please log in first.', { level: 'warn' });
                openAuthModal();
                return;
            }

            const newPassword = String(newEl?.value || '').trim();
            const confirmPassword = String(confirmEl?.value || '').trim();

            if (!newPassword || !confirmPassword) {
                const msg = 'Enter and confirm your new password.';
                if (statusEl) statusEl.textContent = msg;
                showToast(msg, { level: 'warn' });
                return;
            }
            if (newPassword.length < 8) {
                const msg = 'Password must be at least 8 characters.';
                if (statusEl) statusEl.textContent = msg;
                showToast(msg, { level: 'warn' });
                return;
            }
            if (newPassword !== confirmPassword) {
                const msg = 'Passwords do not match.';
                if (statusEl) statusEl.textContent = msg;
                showToast(msg, { level: 'warn' });
                return;
            }

            const prev = btn?.textContent;
            if (btn) {
                btn.disabled = true;
                btn.textContent = 'Updating…';
            }
            if (statusEl) statusEl.textContent = 'Updating password…';

            try {
                const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
                if (error) throw error;

                if (newEl) newEl.value = '';
                if (confirmEl) confirmEl.value = '';
                if (statusEl) statusEl.textContent = 'Password updated.';
                showToast('Password updated.');
            } catch (err) {
                const msg = String(err?.message || err);
                if (statusEl) statusEl.textContent = `Password update failed: ${msg}`;
                showToast(`Password update failed: ${msg}`, { level: 'warn' });
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = prev || 'Change password';
                }
            }
        }

        function updateFeatureRequestCounter() {
            const textEl = document.getElementById('feature-request-text');
            const remainingEl = document.getElementById('feature-request-remaining');
            if (!textEl || !remainingEl) return;
            const max = 2000;
            const used = String(textEl.value || '').length;
            const remaining = Math.max(0, max - used);
            remainingEl.textContent = `${remaining} characters remaining`;
        }

        async function submitFeatureRequest() {
            if (guardGuestWrite()) return;
            const statusEl = document.getElementById('feature-request-status');
            const textEl = document.getElementById('feature-request-text');
            const btn = document.getElementById('feature-request-submit');

            if (!supabaseClient || !cachedIsAuthed) {
                showToast('Please log in to submit feature requests.', { level: 'warn' });
                openAuthModal();
                return;
            }

            const uid = String(cachedAuthUser?.id || '').trim();
            if (!uid) {
                showToast('Missing user session.', { level: 'error' });
                return;
            }

            const feature = String(textEl?.value || '').trim();
            if (!feature) {
                const msg = 'Please describe your request.';
                if (statusEl) statusEl.textContent = msg;
                showToast(msg, { level: 'warn' });
                return;
            }
            if (feature.length > 2000) {
                const msg = 'Please keep requests under 2000 characters.';
                if (statusEl) statusEl.textContent = msg;
                showToast(msg, { level: 'warn' });
                return;
            }

            const prev = btn?.textContent;
            if (btn) {
                btn.disabled = true;
                btn.textContent = 'Sending…';
            }
            if (statusEl) statusEl.textContent = 'Sending…';

            try {
                const payload = {
                    user_id: uid,
                    feature,
                    created_at: new Date().toISOString(),
                };
                const { error } = await supabaseClient
                    .from('Feature Requests')
                    .insert(payload);
                if (error) throw error;

                if (textEl) textEl.value = '';
                updateFeatureRequestCounter();
                if (statusEl) statusEl.textContent = 'Thanks! Your request has been submitted.';
                showToast('Feature request submitted.');
            } catch (err) {
                const msg = String(err?.message || err);
                if (statusEl) statusEl.textContent = `Submit failed: ${msg}`;
                showToast(`Submit failed: ${msg}`, { level: 'warn' });
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = prev || 'Send request';
                }
            }
        }

