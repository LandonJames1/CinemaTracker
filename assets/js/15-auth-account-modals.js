        let authMode = 'login'; // 'login' | 'signup'

        function setAuthMode(mode) {
            // If sign-ups are disabled, force login mode
            if (mode === 'signup' && !siteSignupEnabled) mode = 'login';
            authMode = mode === 'signup' ? 'signup' : 'login';
            const tabLogin = document.getElementById('auth-tab-login');
            const tabSignup = document.getElementById('auth-tab-signup');
            const tabBar = document.getElementById('auth-tab-bar');
            const signupFields = document.getElementById('auth-signup-fields');
            const loginBtn = document.getElementById('auth-login-btn');
            const signupBtn = document.getElementById('auth-signup-btn');
            const titleEl = document.getElementById('auth-modal-title');
            const subtitleEl = document.getElementById('auth-modal-subtitle');
            const statusEl = document.getElementById('auth-modal-status');
            const pwdEl = document.getElementById('auth-password');

            // Only show tab bar when sign-ups are enabled and user is not logged in
            if (tabBar) tabBar.style.display = (siteSignupEnabled && !cachedIsAuthed) ? 'flex' : 'none';

            if (authMode === 'signup') {
                if (tabLogin) { tabLogin.style.background = 'transparent'; tabLogin.style.color = 'var(--text-muted)'; }
                if (tabSignup) { tabSignup.style.background = 'var(--brand)'; tabSignup.style.color = '#fff'; }
                if (signupFields) signupFields.style.display = 'block';
                if (loginBtn) loginBtn.style.display = 'none';
                if (signupBtn) signupBtn.style.display = 'inline-flex';
                if (titleEl) titleEl.textContent = 'Create Account';
                if (subtitleEl) subtitleEl.textContent = 'Set up your new profile';
                if (pwdEl) pwdEl.autocomplete = 'new-password';
            } else {
                if (tabLogin) { tabLogin.style.background = 'var(--brand)'; tabLogin.style.color = '#fff'; }
                if (tabSignup) { tabSignup.style.background = 'transparent'; tabSignup.style.color = 'var(--text-muted)'; }
                if (signupFields) signupFields.style.display = 'none';
                if (loginBtn) loginBtn.style.display = 'inline-flex';
                if (signupBtn) signupBtn.style.display = 'none';
                if (titleEl) titleEl.textContent = 'Welcome Back';
                if (subtitleEl) subtitleEl.textContent = 'Sign in to your account';
                if (pwdEl) pwdEl.autocomplete = 'current-password';
            }
            if (statusEl) { statusEl.textContent = ''; statusEl.style.color = 'var(--text-muted)'; }
        }

        async function handleSignUpClick(e) {
            e?.preventDefault?.();
            if (guestMode) exitGuestMode();
            const statusEl = document.getElementById('auth-modal-status');
            const signupBtn = document.getElementById('auth-signup-btn');
            const prevText = signupBtn?.textContent;

            try {
                if (!supabaseClient) throw new Error('Supabase client not initialized.');

                const email = String(document.getElementById('auth-email')?.value || '').trim();
                const password = String(document.getElementById('auth-password')?.value || '').trim();
                const passwordConfirm = String(document.getElementById('auth-password-confirm')?.value || '').trim();
                const usernameRaw = String(document.getElementById('auth-signup-username')?.value || '').trim();
                const displayName = String(document.getElementById('auth-signup-display-name')?.value || '').trim();

                if (!email) throw new Error('Email is required.');
                if (!password) throw new Error('Password is required.');
                if (password.length < 6) throw new Error('Password must be at least 6 characters.');
                if (password !== passwordConfirm) throw new Error('Passwords do not match.');

                const username = normalizeUsername(usernameRaw);
                const usernameErr = validateUsername(username);
                if (usernameErr) throw new Error(usernameErr);

                if (displayName.length > 50) throw new Error('Display name must be 50 characters or less.');

                if (signupBtn) { signupBtn.disabled = true; signupBtn.textContent = 'Creating…'; }
                if (statusEl) { statusEl.textContent = 'Creating account…'; statusEl.style.color = 'var(--text-muted)'; }

                // 1) Re-check the admin sign-up gate against the live DB value (not a
                //    possibly-stale page-load cache). The DB trigger enforces this too,
                //    but checking here gives a clear message instead of a generic error.
                await loadSiteSignupSetting();
                if (!siteSignupEnabled) {
                    throw new Error('Sign-ups are currently disabled. Please check back later.');
                }

                // 2) Check username availability.
                const { data: existingUser, error: checkErr } = await supabaseClient
                    .from('Users')
                    .select('id')
                    .ilike('username', username)
                    .limit(1);
                if (!checkErr && Array.isArray(existingUser) && existingUser.length > 0) {
                    throw new Error('That username is already taken.');
                }

                // 3) Create the auth account. The username/display_name + a self_signup
                //    flag ride along as auth metadata so the server-side trigger
                //    handle_new_auth_user() (signup_system.sql) can fully provision the
                //    account: it creates the public."Users" row, the "Bucket List", and
                //    the "Recs" list — all server-side, so it works regardless of RLS,
                //    client auth timing, or the email-confirmation setting. No client-side
                //    table writes are needed here.
                const { data: signUpData, error: signUpError } = await supabaseClient.auth.signUp({
                    email,
                    password,
                    options: { data: { username, display_name: displayName || null, self_signup: 'true' } },
                });
                if (signUpError) throw signUpError;

                const newUser = signUpData?.user;
                if (!newUser?.id) throw new Error('Sign-up succeeded but no user ID returned.');

                // Clear password fields.
                const pwdEl = document.getElementById('auth-password');
                const pwdConfEl = document.getElementById('auth-password-confirm');
                if (pwdEl) pwdEl.value = '';
                if (pwdConfEl) pwdConfEl.value = '';

                // If email confirmation is ON, there's no session yet — the account is
                // already fully provisioned server-side, so just send them to log in.
                const needsConfirmation = signUpData?.user?.identities?.length === 0
                    || signUpData?.session === null;
                if (needsConfirmation) {
                    if (statusEl) {
                        statusEl.textContent = 'Check your email to confirm your account, then log in.';
                        statusEl.style.color = 'rgba(74, 222, 128, 0.95)';
                    }
                    showToast('Account created! Check your email to confirm, then log in.');
                    setAuthMode('login');
                    return;
                }

                // Confirmation OFF: the user has a session now. Hard reload so the app
                // initializes fresh with the fully provisioned profile + lists.
                window.location.href = window.location.pathname;
            } catch (err) {
                const msg = String(err?.message || err);
                if (statusEl) {
                    // The DB gate raises a generic "Database error saving new user";
                    // translate that to the real cause for the user.
                    statusEl.textContent = /database error saving new user/i.test(msg)
                        ? 'Sign-ups are currently disabled. Please check back later.'
                        : msg;
                    statusEl.style.color = 'rgba(239,68,68,0.95)';
                }
            } finally {
                if (signupBtn) { signupBtn.disabled = false; signupBtn.textContent = prevText || 'Create Account'; }
            }
        }

        async function handleLoginClick(e) {
            e?.preventDefault?.();
            if (guestMode) exitGuestMode();
            try {
                if (!supabaseClient) throw new Error('Supabase client not initialized.');
                const email = String(document.getElementById('auth-email')?.value || '').trim();
                const password = String(document.getElementById('auth-password')?.value || '').trim();
                if (!email || !password) throw new Error('Enter email + password, then click Log in.');

                const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
                if (error) throw error;

                // Validate immediately (catches Invalid JWT situations early).
                const { data: userData, error: userErr } = await supabaseClient.auth.getUser();
                if (userErr || !userData?.user?.id) {
                    await supabaseClient.auth.signOut();
                    throw new Error('Login succeeded, but session token is invalid for this project. Verify SUPABASE_URL/keys.');
                }

                const pwdEl = document.getElementById('auth-password');
                if (pwdEl) pwdEl.value = '';

                // Hard reload to initialize all user data fresh
                window.location.href = window.location.pathname;
            } catch (err) {
                // Refresh UI first (so button visibility/disabled states are correct),
                // then set the error text last so it doesn't get overwritten.
                await refreshAuthStateAndUI();

                const statusEl = document.getElementById('auth-modal-status');
                if (statusEl) {
                    statusEl.textContent = `Login failed: ${String(err?.message || err)}`;
                    statusEl.style.color = 'rgba(239,68,68,0.95)';
                }
            }
        }

        async function handleLogoutClick(e) {
            e?.preventDefault?.();
            try {
                if (!supabaseClient) return;
                await supabaseClient.auth.signOut();
                // Hard reload to clear all cached user data and navigate to home
                window.location.href = window.location.pathname;
            } catch (err) {
                showToast(`Logout failed: ${String(err.message || err)}`);
            }
        }

        function openAuthModal(mode) {
            const overlay = document.getElementById('auth-overlay');
            if (!overlay) return;
            overlay.classList.add('open');

            // Hide close button when user MUST authenticate (gate mode)
            const closeBtn = document.getElementById('auth-modal-close-btn');
            if (closeBtn) closeBtn.style.display = (cachedIsAuthed || guestMode) ? '' : 'none';

            // setAuthMode handles tab bar visibility based on siteSignupEnabled + cachedIsAuthed
            if (cachedIsAuthed || !siteSignupEnabled) {
                setAuthMode('login');
            } else {
                setAuthMode(mode || 'login');
            }

            // Show "Try Demo" button only when user is NOT logged in
            const demoBtn = document.getElementById('auth-demo-btn');
            if (demoBtn) demoBtn.style.display = cachedIsAuthed ? 'none' : '';

            refreshAuthStateAndUI();

            // Focus the first enabled field.
            const emailEl = document.getElementById('auth-email');
            const pwdEl = document.getElementById('auth-password');
            if (emailEl && !emailEl.disabled) emailEl.focus();
            else if (pwdEl && !pwdEl.disabled) pwdEl.focus();
        }

        function openDashboardAuthWarning() {
            const overlay = document.getElementById('dashboard-auth-warning');
            if (!overlay) return;
            overlay.classList.add('open');
        }

        function openAccountAuthWarning() {
            const overlay = document.getElementById('account-auth-warning');
            if (!overlay) return;
            overlay.classList.add('open');
        }

        function closeDashboardAuthWarning() {
            const overlay = document.getElementById('dashboard-auth-warning');
            if (!overlay) return;
            overlay.classList.remove('open');
        }

        function closeAccountAuthWarning() {
            const overlay = document.getElementById('account-auth-warning');
            if (!overlay) return;
            overlay.classList.remove('open');
        }

        function closeAuthModal() {
            // Block closing if user hasn't authenticated or entered guest mode (gate mode)
            if (!cachedIsAuthed && !guestMode) return;
            const overlay = document.getElementById('auth-overlay');
            if (!overlay) return;
            overlay.classList.remove('open');
            _pendingGuestPage = null; // clear stale pending page
        }

        // ---- Forgot Password ----------------------------------------------------
        function openForgotModal() {
            const overlay = document.getElementById('forgot-overlay');
            if (!overlay) return;
            // Pre-fill with whatever was typed in the login form for convenience.
            const loginEmail = String(document.getElementById('auth-email')?.value || '').trim();
            const forgotEmail = document.getElementById('forgot-email');
            if (forgotEmail && loginEmail) forgotEmail.value = loginEmail;
            const statusEl = document.getElementById('forgot-modal-status');
            if (statusEl) { statusEl.textContent = ''; statusEl.style.color = 'var(--text-muted)'; }
            overlay.classList.add('open');
            if (forgotEmail) forgotEmail.focus();
        }

        function closeForgotModal() {
            const overlay = document.getElementById('forgot-overlay');
            if (overlay) overlay.classList.remove('open');
        }

        async function handleForgotPassword(e) {
            e?.preventDefault?.();
            const statusEl = document.getElementById('forgot-modal-status');
            const sendBtn = document.getElementById('forgot-send-btn');
            const prevText = sendBtn?.textContent;
            try {
                if (!supabaseClient) throw new Error('Supabase client not initialized.');
                const email = String(document.getElementById('forgot-email')?.value || '').trim();
                if (!email) throw new Error('Email is required.');

                // Build the absolute URL of the dedicated reset page (same folder as this page).
                const base = window.location.href.split('?')[0].split('#')[0];
                const dir = base.substring(0, base.lastIndexOf('/') + 1);
                const redirectTo = dir + 'reset-password.html';

                if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Sending…'; }
                if (statusEl) { statusEl.textContent = 'Sending reset link…'; statusEl.style.color = 'var(--text-muted)'; }

                const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });
                if (error) throw error;

                if (statusEl) {
                    statusEl.textContent = 'If an account exists for that email, a reset link is on its way. Check your inbox.';
                    statusEl.style.color = 'rgba(74, 222, 128, 0.95)';
                }
                try { showToast('Password reset link sent. Check your email.'); } catch (_) {}
            } catch (err) {
                if (statusEl) {
                    statusEl.textContent = `Could not send reset link: ${String(err?.message || err)}`;
                    statusEl.style.color = 'rgba(239,68,68,0.95)';
                }
            } finally {
                if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = prevText || 'Send Reset Link'; }
            }
        }

        function handleNavAccountButtonClick(e) {
            e?.preventDefault?.();
            try {
                if (guestMode) {
                    exitGuestMode();
                    openAuthModal();
                    return;
                }
                if (cachedIsAuthed) {
                    router.navigate('account');
                    return;
                }
                openAuthModal();
            } catch (_) {
                openAuthModal();
            }
        }

        let accountBound = false;

        function isUserIconUrl(iconId) {
            const raw = String(iconId || '').trim();
            if (!raw) return false;
            if (/^https?:\/\//i.test(raw)) return true;
            if (/^data:image\//i.test(raw)) return true;
            return false;
        }

        function renderUserIconHtml(iconId, sizePx = 28) {
            const raw = String(iconId || '').trim();
            if (isUserIconUrl(raw)) {
                return `
                    <span class="user-icon" style="width:${Number(sizePx)}px; height:${Number(sizePx)}px;">
                        <img src="${escapeHtml(raw)}" alt="User icon" loading="lazy" decoding="async" />
                    </span>
                `;
            }

            return `
                <span class="user-icon" style="width:${Number(sizePx)}px; height:${Number(sizePx)}px;">
                    ${icons.user}
                </span>
            `;
        }

        function normalizeUsername(raw) {
            const s = String(raw || '').trim().replace(/^@+/, '').toLowerCase();
            return s;
        }

        function validateUsername(username) {
            const u = normalizeUsername(username);
            if (!u) return 'Username is required.';
            if (u.length < 3 || u.length > 20) return 'Username must be 3–20 characters.';
            if (!/^[a-z0-9_]+$/.test(u)) return 'Username can only include letters, numbers, and underscore.';
            return '';
        }

        function getAccountSectionOverlay(kind) {
            const k = String(kind || '').trim();
            if (!k) return null;
            return document.getElementById(`account-${k}-overlay`);
        }

        function openAccountSectionModal(kind) {
            const overlay = getAccountSectionOverlay(kind);
            if (!overlay) return;
            overlay.classList.add('open');
            if (kind === 'profile') {
                const input = document.getElementById('account-username');
                if (input) input.focus();
            }
            if (kind === 'security') {
                const input = document.getElementById('account-new-password');
                if (input) input.focus();
            }
            if (kind === 'feature') {
                updateFeatureRequestCounter();
                const input = document.getElementById('feature-request-text');
                if (input) input.focus();
            }
        }

        function closeAccountSectionModal(kind) {
            const overlay = getAccountSectionOverlay(kind);
            if (!overlay) return;
            overlay.classList.remove('open');
        }

