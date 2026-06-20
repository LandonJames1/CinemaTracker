        // SECURITY: A Supabase password-recovery link must ONLY ever open the isolated
        // reset-password.html page — never the main app. If such a link lands here (e.g.
        // because Supabase fell back to the project Site URL), immediately forward the
        // recovery token to the reset page and never render the app. Runs synchronously
        // before any app init so no app content is shown.
        (function forceRecoveryToResetPage() {
            try {
                if (/type=recovery/i.test(String(window.location.hash || ''))) {
                    const dir = window.location.pathname.replace(/[^/]*$/, '');
                    window.location.replace(dir + 'reset-password.html' + window.location.hash);
                }
            } catch (_) {}
        })();

        let toastTimer = null;

        const messageLog = [];
        const MAX_LOG_ITEMS = 300;

        function emitLog(level, message, extra = null) {
            const prefix = '[CinemaTracker]';
            const line = `${prefix} ${String(message || '')}`;

            if (level === 'error') console.error(line, extra ?? '');
            else if (level === 'warn') console.warn(line, extra ?? '');
            else console.log(line, extra ?? '');
        }

        function formatTime(ts) {
            try {
                const d = new Date(ts);
                return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            } catch (_) {
                return '';
            }
        }

        function renderMessageLog() {
            const badge = document.getElementById('log-badge');
            const body = document.getElementById('log-body');
            if (badge) badge.innerText = String(messageLog.length);
            if (!body) return;

            body.innerHTML = messageLog
                .map((item) => {
                    const levelClass = item.level === 'error'
                        ? 'log-level-error'
                        : (item.level === 'warn' ? 'log-level-warn' : 'log-level-info');
                    const safeMsg = String(item.message || '').replace(/[&<>"']/g, (c) => ({
                        '&': '&amp;',
                        '<': '&lt;',
                        '>': '&gt;',
                        '"': '&quot;',
                        "'": '&#39;'
                    }[c]));
                    const safeExtra = item.extra
                        ? String(item.extra).replace(/[&<>"']/g, (c) => ({
                            '&': '&amp;',
                            '<': '&lt;',
                            '>': '&gt;',
                            '"': '&quot;',
                            "'": '&#39;'
                        }[c]))
                        : '';
                    return `
<div class="log-item">
  <div class="log-meta"><span class="${levelClass}">${item.level.toUpperCase()}</span> • ${formatTime(item.ts)}</div>
  <div>${safeMsg}${safeExtra ? `<div class="log-meta">${safeExtra}</div>` : ''}</div>
</div>`;
                })
                .join('');

            // Auto-scroll to bottom
            body.scrollTop = body.scrollHeight;
        }

        function addMessageToLog(level, message, extra = null) {
            messageLog.push({ ts: Date.now(), level, message: String(message ?? ''), extra: extra ? String(extra) : null });
            while (messageLog.length > MAX_LOG_ITEMS) messageLog.shift();
            renderMessageLog();
        }

        function setLogPanelOpen(isOpen) {
            const panel = document.getElementById('log-panel');
            if (!panel) return;
            panel.classList.toggle('open', Boolean(isOpen));
        }

        function showToast(msg, opts = {}) {
            const toast = document.getElementById('toast');
            const msgEl = document.getElementById('toast-message');
            const iconEl = document.getElementById('toast-icon');

            const text = String(msg ?? '');
            const explicitLevel = String(opts.level || '').toLowerCase();
            const isError = explicitLevel === 'error' || /\b(failed|error)\b/i.test(text);
            const isWarning = explicitLevel === 'warn' || /\bwarning\b/i.test(text);
            const level = isError ? 'error' : (isWarning ? 'warn' : 'info');

            // Persist EVERYTHING (success/warn/error) to the on-page message log.
            addMessageToLog(level, text);

            // Also log errors/warnings to the console.
            if (level === 'error') emitLog('error', text);
            else if (level === 'warn') emitLog('warn', text);

            if (msgEl) msgEl.innerText = text;
            if (iconEl) iconEl.innerHTML = (level === 'info') ? icons.checkCircle : icons.info;

            toast.classList.add('show');

            // Make error toasts stick around longer.
            const durationMs = Number.isFinite(Number(opts.durationMs))
                ? Number(opts.durationMs)
                : (level === 'info' ? 3000 : 15000);

            if (toastTimer) clearTimeout(toastTimer);
            toastTimer = setTimeout(() => toast.classList.remove('show'), durationMs);

            // Allow manual dismiss (click the toast)
            toast.onclick = () => toast.classList.remove('show');
        }

        // Wire up message log UI
        (function initMessageLogUI() {
            const fab = document.getElementById('log-fab');
            const fabIcon = document.getElementById('log-fab-icon');
            const closeBtn = document.getElementById('log-close');
            const clearBtn = document.getElementById('log-clear');
            const copyBtn = document.getElementById('log-copy');

            if (fabIcon) fabIcon.innerHTML = icons.info;

            if (fab) {
                fab.addEventListener('click', () => {
                    const panel = document.getElementById('log-panel');
                    const isOpen = panel?.classList?.contains('open');
                    setLogPanelOpen(!isOpen);
                });
            }

            if (closeBtn) closeBtn.addEventListener('click', () => setLogPanelOpen(false));
            if (clearBtn) clearBtn.addEventListener('click', () => {
                messageLog.length = 0;
                renderMessageLog();
            });
            if (copyBtn) copyBtn.addEventListener('click', async () => {
                const text = messageLog
                    .map((i) => `[${i.level.toUpperCase()} ${formatTime(i.ts)}] ${i.message}${i.extra ? ` | ${i.extra}` : ''}`)
                    .join('\n');
                try {
                    await navigator.clipboard.writeText(text);
                    showToast('Log copied to clipboard');
                } catch (e) {
                    // Fallback
                    try {
                        const ta = document.createElement('textarea');
                        ta.value = text;
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand('copy');
                        ta.remove();
                        showToast('Log copied to clipboard');
                    } catch (err) {
                        showToast(`Copy failed: ${String(err?.message || err)}`, { level: 'warn' });
                    }
                }
            });

            // Initial render
            renderMessageLog();
        })();

        // Capture uncaught errors and promise rejections too.
        window.addEventListener('error', (e) => {
            try {
                emitLog('error', `Uncaught error: ${e?.message || 'Unknown error'}`);
            } catch (_) {}
        });

        window.addEventListener('unhandledrejection', (e) => {
            try {
                const reason = e?.reason?.message || String(e?.reason || 'Unknown rejection');
                emitLog('error', `Unhandled rejection: ${reason}`);
            } catch (_) {}
        });

        // Shows a persistent "New version available" prompt; tapping it reloads onto
        // the freshly deployed files (the network-first SW serves the latest).
        function showUpdatePrompt() {
            if (document.getElementById('ct-update-banner')) return; // already showing
            const bar = document.createElement('div');
            bar.id = 'ct-update-banner';
            bar.setAttribute('role', 'status');
            bar.style.cssText = 'position:fixed; left:50%; bottom:calc(16px + env(safe-area-inset-bottom)); transform:translateX(-50%); z-index:3000; display:flex; align-items:center; gap:12px; max-width:calc(100vw - 24px); padding:12px 16px; border-radius:999px; background:rgba(20,20,24,0.98); border:1px solid rgba(255,255,255,0.14); box-shadow:0 12px 40px rgba(0,0,0,0.5); color:#fff; font-weight:700;';
            bar.innerHTML = '<span style="font-size:0.9rem;">✨ New version available</span>'
                + '<button type="button" id="ct-update-btn" style="border:none; cursor:pointer; border-radius:999px; padding:8px 16px; font-weight:800; color:#fff; background:var(--brand, #14b8a6);">Update</button>';
            document.body.appendChild(bar);
            const btn = document.getElementById('ct-update-btn');
            if (btn) btn.addEventListener('click', () => {
                try { btn.textContent = 'Updating…'; btn.disabled = true; } catch (_) {}
                window.location.reload();
            });
        }

        // Route the app to the page a push notification points at (…/#feed or
        // …/#recs). Used both on cold start (from the URL hash) and while already
        // running (from the SW's NOTIFICATION_NAV message). Navigating here is what
        // triggers markFeedSeen()/markRecsSeen(), which clears the badges.
        // Returns true if it recognized + handled a route.
        function handleNotificationRoute(raw) {
            try {
                if (!cachedIsAuthed) return false;
                const s = String(raw || '');
                const hash = s.includes('#') ? s.slice(s.indexOf('#')) : s;
                if (/^#?feed$/i.test(hash)) { router.navigate('feed'); return true; }
                if (/^#?recs$/i.test(hash)) { listsPendingSelectName = 'Recs'; router.navigate('lists'); return true; }
                // A specific list by id (#list=<listId>), e.g. the shared-list "movie
                // added" push → open that list directly.
                const listLink = hash.match(/^#?list=([0-9a-f-]{36})$/i);
                if (listLink) { listsPendingSelectId = listLink[1]; router.navigate('lists'); return true; }
                // A specific user's review of a movie (#review=<userId>:<movieId>),
                // e.g. from the "your rec got watched" push → open their diary entry.
                const review = hash.match(/^#?review=([0-9a-f-]{36}):([0-9a-f-]{36})$/i);
                if (review && typeof openProfileMovieReview === 'function') {
                    router.navigate('feed');
                    const uid = review[1], mid = review[2];
                    setTimeout(() => { try { openProfileMovieReview(uid, mid); } catch (_) {} }, 0);
                    return true;
                }
                // A user's profile (#user=<userId>), e.g. from the new-follower push.
                const prof = hash.match(/^#?user=([0-9a-f-]{36})$/i);
                if (prof && typeof openUserProfile === 'function') {
                    router.navigate('feed');
                    const uid = prof[1];
                    setTimeout(() => { try { openUserProfile(uid); } catch (_) {} }, 0);
                    return true;
                }
            } catch (_) {}
            return false;
        }

        // Register the service worker so the app is installable, receives push
        // notifications, and auto-updates (network-first). When a newly deployed
        // worker activates it messages us; we show the "New version" prompt (the
        // sessionStorage guard stops the first install from prompting on a clean tab).
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.addEventListener('message', (e) => {
                if (!e?.data) return;
                // Tapped a push while the app was already running → go to its page.
                if (e.data.type === 'NOTIFICATION_NAV') {
                    try { handleNotificationRoute(e.data.url); } catch (_) {}
                    return;
                }
                if (e.data.type !== 'SW_ACTIVATED') return;
                try {
                    const v = String(e.data.version || '');
                    const last = sessionStorage.getItem('ct_sw_version');
                    sessionStorage.setItem('ct_sw_version', v);
                    if (last && last !== v) showUpdatePrompt();
                } catch (_) {}
            });
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('service-worker.js').then((reg) => {
                    // Proactively check for a new deploy each launch.
                    try { reg.update(); } catch (_) {}
                }).catch((err) => {
                    try { emitLog('warn', `Service worker registration failed: ${String(err?.message || err)}`); } catch (_) {}
                });
            });
        }

        // Keep auth UI synced with session changes.
        if (supabaseClient?.auth?.onAuthStateChange) {
            supabaseClient.auth.onAuthStateChange(() => {
                refreshAuthStateAndUI();
                loadThemeOptions().catch(() => null);
            });
        }

        // Warn if the user tries to save before logging in.
        document.addEventListener('click', (e) => {
            const btn = e?.target?.closest ? e.target.closest('#btn-save-diary') : null;
            if (!btn) return;

            // If the button isn't in the DOM yet, nothing to do.
            if (!supabaseClient) {
                e.preventDefault();
                e.stopPropagation();
                showToast('Supabase SDK failed to load.', { level: 'error' });
                return;
            }

            const ariaDisabled = btn.getAttribute('aria-disabled') === 'true';
            if (ariaDisabled || !cachedIsAuthed) {
                e.preventDefault();
                e.stopPropagation();
                showToast('Please log in first to save to diary.', { level: 'warn' });
                openAuthModal();
            }
        }, true);

        document.addEventListener('click', (e) => {
            const input = document.getElementById('movie-search-input');
            const res = document.getElementById('search-results');
            if(input && res && !input.contains(e.target) && !res.contains(e.target)) {
                res.classList.add('hidden');
            }
        });

        document.addEventListener('DOMContentLoaded', async () => {
            // Defensive: if a recovery link is still being redirected to the reset page
            // (see forceRecoveryToResetPage above), do not initialize the app at all.
            try {
                if (/type=recovery/i.test(String(window.location.hash || ''))) return;
            } catch (_) {}

            await loadThemeOptions();
            await loadThemeBackgroundImages();
            applyTheme(getStoredTheme());
            await loadSiteSignupSetting();

            // Restore guest mode if it was active before a page refresh
            const wasGuest = (() => { try { return sessionStorage.getItem('ct_guest_mode') === '1'; } catch (_) { return false; } })();
            if (wasGuest) {
                initListsPage();
                router.init();
                enterGuestMode();
                return; // skip normal auth refresh — guest mode handles everything
            }

            await refreshAuthStateAndUI();
            initListsPage();
            router.init();

            // Gate: if not authenticated after init, force the auth modal open
            if (!cachedIsAuthed) {
                openAuthModal();
            }

            // Populate unread-notification badges (Feed / Lists) on load.
            try { refreshNavBadges(); } catch (_) {}

            // Re-check badges whenever a left-open tab/app regains focus, so a feed/recs
            // view on another device clears the icons here without a full reload.
            try {
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') { try { refreshNavBadges(); } catch (_) {} }
                });
                window.addEventListener('focus', () => { try { refreshNavBadges(); } catch (_) {} });
            } catch (_) {}

            // New users: prompt to enable push notifications right away (one-shot).
            try { maybePromptPushAfterSignup(); } catch (_) {}

            // Deep-link from a push notification (…/#feed or …/#recs).
            try {
                if (handleNotificationRoute(window.location.hash)) {
                    history.replaceState(null, '', window.location.pathname + window.location.search);
                }
            } catch (_) {}
        });

        document.addEventListener('keydown', (e) => {
            const overlay = document.getElementById('auth-overlay');
            const isOpen = overlay?.classList?.contains('open');
            if (!isOpen) return;

            if (e.key === 'Escape') {
                closeAuthModal(); // will be blocked if not authed (gate mode)
                return;
            }

            if (e.key === 'Enter') {
                if (authMode === 'signup') {
                    const signupBtn = document.getElementById('auth-signup-btn');
                    if (signupBtn && signupBtn.style.display !== 'none') {
                        e.preventDefault();
                        signupBtn.click();
                    }
                } else {
                    const loginBtn = document.getElementById('auth-login-btn');
                    if (loginBtn && loginBtn.style.display !== 'none') {
                        e.preventDefault();
                        loginBtn.click();
                    }
                }
            }
        });
