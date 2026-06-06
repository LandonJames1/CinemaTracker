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
                const filterBtn = e?.target?.closest ? e.target.closest('#account-achievement-filters-btn') : null;
                const pop = document.getElementById('account-achievement-filters-pop');
                if (filterBtn) {
                    e.preventDefault();
                    toggleAchievementFiltersOpen();
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
            const dnEl = document.getElementById('account-display-name');
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
                const displayName = String(row?.display_name || '').trim();
                const themeId = String(row?.theme_id || '').trim();
                if (usernameEl) usernameEl.value = username;
                if (dnEl) dnEl.value = displayName;
                const themeSelect = document.getElementById('account-theme-select');
                if (themeSelect) {
                    const value = resolveThemeId(themeId || getStoredTheme());
                    if (value) {
                        themeSelect.value = value;
                        applyTheme(value);
                    }
                }

                // Phone + carrier (best-effort; columns may not exist pre-migration).
                try {
                    const rp = await supabaseClient.from('Users').select('phone, carrier').eq('id', uid).limit(1);
                    if (!rp.error) {
                        const prow = Array.isArray(rp.data) && rp.data.length ? rp.data[0] : null;
                        const phoneEl = document.getElementById('account-phone');
                        const carrierEl = document.getElementById('account-carrier');
                        if (phoneEl) phoneEl.value = String(prow?.phone || '').trim();
                        if (carrierEl) carrierEl.value = String(prow?.carrier || '').trim();
                    }
                } catch (_) {}

                if (profileStatus) profileStatus.textContent = 'Profile loaded.';
            } catch (err) {
                if (profileStatus) profileStatus.textContent = `Could not load profile: ${String(err?.message || err)}`;
            }
        }

        // Admin test: fire the real email-to-SMS pipeline to your own phone.
        async function sendTestText() {
            const statusEl = document.getElementById('admin-test-sms-status');
            const setStatus = (s, color) => {
                if (!statusEl) return;
                statusEl.textContent = String(s || '');
                if (color) statusEl.style.color = color;
            };

            if (!supabaseClient || !cachedIsAuthed) {
                showToast('Log in first.', { level: 'warn' });
                return;
            }
            let accessToken = null;
            try {
                const res = await requireAuthOrThrow();
                accessToken = res.accessToken;
            } catch (_) {
                openAuthModal();
                return;
            }

            setStatus('Sending test text…', 'var(--text-muted)');
            try {
                const res = await callSwiftApi({ action: 'test_sms' }, accessToken);
                if (res?.sent) {
                    setStatus('✅ Sent! Check your phone — carrier texts can take a minute.', 'rgba(74,222,128,0.95)');
                    showToast('Test text sent.', { level: 'success' });
                } else {
                    const reason = String(res?.reason || res?.error || 'Unknown reason');
                    setStatus(`⚠️ Not sent: ${reason}`, 'rgba(239,68,68,0.95)');
                    showToast(`Test text not sent: ${reason}`, { level: 'warn' });
                }
            } catch (err) {
                const msg = String(err?.message || err);
                setStatus(`Failed: ${msg}`, 'rgba(239,68,68,0.95)');
                showToast(`Test failed: ${msg}`, { level: 'warn' });
            }
        }

        async function saveAccountProfile() {
            if (guardGuestWrite()) return;
            const profileStatus = document.getElementById('account-profile-status');
            const saveBtn = document.getElementById('account-save-profile');
            const usernameEl = document.getElementById('account-username');
            const dnEl = document.getElementById('account-display-name');

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
            const desiredDisplayName = String(dnEl?.value || '').trim();
            const userErr = validateUsername(desiredUsername);
            if (userErr) {
                if (profileStatus) profileStatus.textContent = userErr;
                showToast(userErr, { level: 'warn' });
                return;
            }

            if (desiredDisplayName.length > 50) {
                const msg = 'Display name must be 50 characters or less.';
                if (profileStatus) profileStatus.textContent = msg;
                showToast(msg, { level: 'warn' });
                return;
            }

            const prev = saveBtn?.textContent;
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.textContent = 'Saving…';
            }
            if (profileStatus) profileStatus.textContent = 'Saving…';

            try {
                const payload = {
                    id: uid,
                    username: desiredUsername,
                    display_name: desiredDisplayName || null,
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
                        const payload2 = { id: uid, username: desiredUsername, display_name: desiredDisplayName || null };
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

                // Phone + carrier (best-effort, separate update so a missing column
                // pre-migration can't fail the whole profile save).
                try {
                    const phoneVal = String(document.getElementById('account-phone')?.value || '').replace(/\D/g, '').slice(0, 15);
                    const carrierVal = String(document.getElementById('account-carrier')?.value || '').trim();
                    await supabaseClient.from('Users').update({ phone: phoneVal || null, carrier: carrierVal || null }).eq('id', uid);
                } catch (_) {}

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

