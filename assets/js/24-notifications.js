        // ============================================================
        // Activity notifications inbox (the navbar bell → dropdown/sheet).
        //
        // A single in-app home for every social event that also fires a Web
        // Push (new review from a follow, new follower, recommendation, review
        // reaction, shared-list add, "your rec got watched"). The swift-api
        // Edge Function writes a `Notifications` row alongside each push (see
        // recordNotifications() in EdgeFunc + notifications.sql), so this works
        // even when push is disabled and keeps a browsable history with
        // per-item read state.
        //
        // UI: a bell button in the navbar (#nav-notif-btn) with an unread count
        // badge (#nav-badge-notif). Tapping opens #notif-overlay — a dropdown on
        // desktop, a bottom sheet on mobile (styles.css "Activity inbox" block).
        // The overlay id ends in "-overlay" so pull-to-refresh's anyModalOpen()
        // already treats it as a modal. Loaded before 19-logging-boot.js.
        // ============================================================

        let notifItems = [];           // most-recent-first rows currently loaded
        let notifActorsById = {};      // actor_id -> { username, icon }
        let notifLoading = false;
        let notifOpen = false;
        let notifListenerBound = false;
        let notifLastUnread = 0;       // last known unread count (for live-poll diffing)
        let notifPollTimer = null;     // in-app polling interval id
        const NOTIF_PAGE = 50;
        const NOTIF_POLL_MS = 45000;   // refresh badges/sheet while the app is open

        function notifSetBadge(count) {
            const n = Math.max(0, Number(count) || 0);
            const el = document.getElementById('nav-badge-notif');
            if (el) {
                if (n > 0) { el.textContent = n > 99 ? '99+' : String(n); el.classList.add('show'); }
                else { el.textContent = ''; el.classList.remove('show'); }
            }
            // Show the bell only when signed in.
            const btn = document.getElementById('nav-notif-btn');
            if (btn) btn.style.display = (typeof cachedIsAuthed !== 'undefined' && cachedIsAuthed) ? '' : 'none';
        }

        // Count unread rows + reflect it on the bell. Called from
        // refreshNavBadges() (boot / tab focus / navigation) and after any
        // read-state change here.
        async function refreshNotifBadge() {
            try {
                if (!supabaseClient || typeof cachedIsAuthed === 'undefined' || !cachedIsAuthed) {
                    notifSetBadge(0);
                    return;
                }
                const meId = String(cachedAuthUser?.id || '').trim();
                if (!meId) { notifSetBadge(0); return; }
                const { count } = await supabaseClient
                    .from('Notifications')
                    .select('id', { count: 'exact', head: true })
                    .eq('user_id', meId)
                    .is('read_at', null);
                notifLastUnread = count || 0;
                notifSetBadge(notifLastUnread);
            } catch (_) { /* table may not exist pre-migration */ }
            // Once we've resolved a count at least once, keep the in-app badges +
            // sheet live (covers events received WITHOUT a push — e.g. push
            // disabled, or a follow/rec/reaction while sitting on one page).
            ensureNotifPolling();
        }

        // Poll while the tab is visible + signed in, so a notification that
        // arrives while the user is inside the app still lights up the bell/nav
        // badges and, if the sheet is open, appears in it — no push required.
        function ensureNotifPolling() {
            if (notifPollTimer) return;
            notifPollTimer = setInterval(notifPollTick, NOTIF_POLL_MS);
        }
        async function notifPollTick() {
            try {
                if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
                if (typeof cachedIsAuthed === 'undefined' || !cachedIsAuthed) return;
                const prev = notifLastUnread;
                // Refresh the feed/lists/To-Rate badges too (all "relevant badges").
                try { if (typeof refreshNavBadges === 'function') refreshNavBadges(); } catch (_) {}
                await refreshNotifBadge();
                // If something changed and the sheet is open, repaint it in place.
                if (notifOpen && notifLastUnread !== prev) loadNotifications();
            } catch (_) {}
        }

        function toggleNotifications(event) {
            if (event) { try { event.stopPropagation(); } catch (_) {} }
            if (notifOpen) closeNotifications();
            else openNotifications();
        }

        function openNotifications() {
            const ov = document.getElementById('notif-overlay');
            if (!ov) return;
            notifOpen = true;
            ov.style.display = 'flex';
            // Bind the delegated row-click handler once.
            if (!notifListenerBound) {
                const list = document.getElementById('notif-list');
                if (list) {
                    list.addEventListener('click', (e) => {
                        const row = e.target.closest('[data-notif-id]');
                        if (!row) return;
                        handleNotificationItemClick(row.getAttribute('data-notif-id'), row.getAttribute('data-notif-url'));
                    });
                    notifListenerBound = true;
                }
            }
            loadNotifications();
        }

        function closeNotifications() {
            const ov = document.getElementById('notif-overlay');
            if (ov) ov.style.display = 'none';
            notifOpen = false;
        }

        async function loadNotifications() {
            const list = document.getElementById('notif-list');
            if (!list) return;
            if (!supabaseClient || typeof cachedIsAuthed === 'undefined' || !cachedIsAuthed) {
                list.innerHTML = '<div class="notif-empty">Sign in to see your activity.</div>';
                return;
            }
            const meId = String(cachedAuthUser?.id || '').trim();
            if (!meId) { list.innerHTML = '<div class="notif-empty">Sign in to see your activity.</div>'; return; }

            notifLoading = true;
            list.innerHTML = '<div class="notif-empty">Loading…</div>';
            try {
                const { data, error } = await supabaseClient
                    .from('Notifications')
                    .select('id, created_at, actor_id, type, title, body, url, read_at')
                    .eq('user_id', meId)
                    .order('created_at', { ascending: false })
                    .limit(NOTIF_PAGE);
                if (error) throw error;
                notifItems = Array.isArray(data) ? data : [];

                // Batch-fetch actor avatars/usernames for the leading icon.
                const actorIds = Array.from(new Set(notifItems.map(n => n.actor_id).filter(Boolean)));
                notifActorsById = {};
                if (actorIds.length) {
                    const { data: actors } = await supabaseClient
                        .from('Users').select('id, username, icon').in('id', actorIds);
                    for (const a of (Array.isArray(actors) ? actors : [])) {
                        notifActorsById[a.id] = { username: a.username, icon: a.icon };
                    }
                }
                renderNotificationList();
            } catch (_) {
                list.innerHTML = '<div class="notif-empty">Couldn\'t load activity.</div>';
            } finally {
                notifLoading = false;
            }
        }

        function renderNotificationList() {
            const list = document.getElementById('notif-list');
            if (!list) return;
            if (!notifItems.length) {
                list.innerHTML = '<div class="notif-empty">No activity yet.<br><span class="notif-empty-sub">Follows, recs, and reactions will show up here.</span></div>';
                syncNotifMarkAllBtn();
                return;
            }
            list.innerHTML = notifItems.map(n => {
                const unread = !n.read_at;
                const actor = n.actor_id ? notifActorsById[n.actor_id] : null;
                const avatar = actor
                    ? renderUserIconHtml(actor.icon, 38)
                    : `<span class="notif-glyph notif-glyph-${escapeHtml(n.type || 'system')}">${notifTypeGlyph(n.type)}</span>`;
                const body = escapeHtml(n.body || n.title || 'New activity');
                const time = notifRelativeTime(n.created_at);
                const url = escapeHtml(n.url || '');
                return `
                    <button type="button" class="notif-row${unread ? ' is-unread' : ''}" data-notif-id="${escapeHtml(n.id)}" data-notif-url="${url}">
                        <span class="notif-row-avatar">${avatar}</span>
                        <span class="notif-row-main">
                            <span class="notif-row-body">${body}</span>
                            <span class="notif-row-time">${escapeHtml(time)}</span>
                        </span>
                        ${unread ? '<span class="notif-row-dot" aria-label="Unread"></span>' : ''}
                    </button>
                `;
            }).join('');
            syncNotifMarkAllBtn();
        }

        function syncNotifMarkAllBtn() {
            const btn = document.getElementById('notif-mark-all');
            if (!btn) return;
            const anyUnread = notifItems.some(n => !n.read_at);
            btn.style.display = anyUnread ? '' : 'none';
        }

        // Small type-specific fallback glyph when there's no actor avatar
        // (currently only system-ish rows; every social event has an actor).
        function notifTypeGlyph(type) {
            switch (type) {
                case 'new_follower': return (icons && icons.users) ? icons.users : '👤';
                case 'recommendation':
                case 'rec_reviewed': return '🎬';
                case 'review_reaction': return '💬';
                case 'list_add': return '🎬';
                case 'game_nudge':
                case 'game_reminder': return '🎮';
                default: return '🔔';
            }
        }

        function notifRelativeTime(iso) {
            try {
                const then = new Date(iso).getTime();
                if (!then) return '';
                const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
                if (s < 60) return 'just now';
                const m = Math.floor(s / 60);
                if (m < 60) return `${m}m ago`;
                const h = Math.floor(m / 60);
                if (h < 24) return `${h}h ago`;
                const d = Math.floor(h / 24);
                if (d < 7) return `${d}d ago`;
                const w = Math.floor(d / 7);
                if (w < 5) return `${w}w ago`;
                return new Date(iso).toLocaleDateString();
            } catch (_) { return ''; }
        }

        async function handleNotificationItemClick(id, url) {
            // Mark this one read locally + in the DB, then deep-link.
            const it = notifItems.find(n => String(n.id) === String(id));
            if (it && !it.read_at) {
                it.read_at = new Date().toISOString();
                renderNotificationList();
                refreshNotifBadge();
                try {
                    await supabaseClient.from('Notifications')
                        .update({ read_at: it.read_at })
                        .eq('id', id)
                        .eq('user_id', String(cachedAuthUser?.id || '').trim());
                } catch (_) {}
            }
            closeNotifications();
            // handleNotificationRoute (19-logging-boot.js) is global by runtime.
            if (url && typeof handleNotificationRoute === 'function') {
                try { handleNotificationRoute(url); } catch (_) {}
            }
        }

        async function markAllNotificationsRead() {
            const meId = String(cachedAuthUser?.id || '').trim();
            if (!meId) return;
            const nowIso = new Date().toISOString();
            let changed = false;
            for (const n of notifItems) { if (!n.read_at) { n.read_at = nowIso; changed = true; } }
            if (changed) { renderNotificationList(); refreshNotifBadge(); }
            try {
                await supabaseClient.from('Notifications')
                    .update({ read_at: nowIso })
                    .eq('user_id', meId)
                    .is('read_at', null);
            } catch (_) {}
            refreshNotifBadge();
            // Acknowledging everything in the inbox also acknowledges the in-page
            // counters those events feed — the Feed / Lists nav + tab-bar badges,
            // the burger dot and the PWA app-icon badge (05-feed-library.js).
            try { if (typeof markAllNavBadgesSeen === 'function') markAllNavBadgesSeen(); } catch (_) {}
        }

        // Mark every unread Notifications row of the given type(s) read — the
        // bridge that keeps the Activity bell in sync with the in-page "seen"
        // surfaces. e.g. viewing the Feed "sees" the reviews, so their
        // `new_review` rows should stop counting on the bell too (no need to
        // ALSO open the Activity sheet + "Mark all read"). Called by markFeedSeen
        // (`new_review`) / markRecsSeen (`recommendation`) in 05-feed-library.js.
        // Optimistically clears any loaded rows + repaints, then persists + re-badges.
        async function markNotificationsReadByType(types) {
            try {
                const list = Array.isArray(types) ? types.filter(Boolean) : [types].filter(Boolean);
                if (!list.length) return;
                if (!supabaseClient || typeof cachedIsAuthed === 'undefined' || !cachedIsAuthed) return;
                const meId = String(cachedAuthUser?.id || '').trim();
                if (!meId) return;
                const nowIso = new Date().toISOString();
                // Optimistic: clear locally-loaded rows of these types so an open
                // sheet updates immediately (badge is reconciled by refreshNotifBadge).
                let changed = false;
                for (const n of notifItems) {
                    if (!n.read_at && list.includes(n.type)) { n.read_at = nowIso; changed = true; }
                }
                if (changed) renderNotificationList();
                await supabaseClient.from('Notifications')
                    .update({ read_at: nowIso })
                    .eq('user_id', meId)
                    .is('read_at', null)
                    .in('type', list);
                refreshNotifBadge();
            } catch (_) { /* table may not exist pre-migration */ }
        }
