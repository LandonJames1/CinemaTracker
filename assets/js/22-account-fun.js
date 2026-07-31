        // ===== Fun Account page (route `account`) =================================
        // The personal "about you" page: big avatar + photo change, username, tier,
        // an AI-written taste blurb, follower/following counts, an editable bio, and a
        // compact taste-profile card. The old settings cards moved to the `settings`
        // route (router.renderSettings), reached via the gear button here.
        // Data: Users (username/icon/bio/points/tier), User Tiers, Follows counts,
        // Taste Profiles (incl. the cached taste_blurb written by swift-responder).

        let accountHomeBound = false;
        let accountHomeBioValue = '';
        let accountHomeViewUserId = ''; // the user whose Account page is currently shown (self or other)
        let accountHomeActiveTab = 'profile'; // 'profile' | 'achievements'
        let accountHomePendingTab = '';       // set before navigate() to land on a specific tab

        function initAccountHome() {
            if (accountHomeBound) return;
            accountHomeBound = true;

            document.addEventListener('click', (e) => {
                const tabBtn = e?.target?.closest ? e.target.closest('[data-account-home-tab]') : null;
                if (tabBtn) { setAccountHomeTab(tabBtn.dataset.accountHomeTab); return; }
                const btn = e?.target?.closest ? e.target.closest('[data-account-home-action]') : null;
                if (!btn) return;
                const action = String(btn.dataset.accountHomeAction || '').trim();
                const viewingSelf = accountHomeViewUserId === getActiveUserId();
                if (action === 'back') { router.goBack(); return; }
                if (action === 'open_settings') { router.navigate('settings'); return; }
                if (action === 'pick_icon') { if (viewingSelf) document.getElementById('account-home-icon-file')?.click(); return; }
                if (action === 'edit_bio') { if (viewingSelf) openBioModal(); return; }
                if (action === 'follow') { handleAccountFollowClick(btn); return; }
                if (action === 'open_following') { openFollowsModal('following'); return; }
                if (action === 'open_followers') { openFollowsModal('followers'); return; }
                if (action === 'open_dashboard') { router.navigate('dashboard'); return; }
                if (action === 'unfollow') {
                    const id = String(btn.dataset.userId || '').trim();
                    if (id) handleUnfollowFromModal(id, btn);
                    return;
                }
                if (action === 'open_user') {
                    const id = String(btn.dataset.userId || '').trim();
                    closeFollowsModal();
                    if (id) openUserProfile(id);
                    return;
                }
                if (action === 'rate_draft') {
                    const tmdb = String(btn.dataset.tmdb || '').trim();
                    if (tmdb) rateReviewDraft(tmdb);
                    return;
                }
                if (action === 'remove_draft') {
                    const tmdb = String(btn.dataset.tmdb || '').trim();
                    if (tmdb) promptRemoveReviewDraft(tmdb, btn);
                    return;
                }
                if (action === 'confirm_remove_draft') {
                    const tmdb = String(btn.dataset.tmdb || '').trim();
                    if (tmdb) removeReviewDraft(tmdb, btn);
                    return;
                }
                if (action === 'cancel_remove_draft') {
                    loadReviewDraftsPanel();
                    return;
                }
            });

            document.addEventListener('change', (e) => {
                const el = e?.target;
                if (!el || el.id !== 'account-home-icon-file' || !(el instanceof HTMLInputElement)) return;
                const file = el.files && el.files[0];
                if (file) handleAccountHomeIconPick(file);
                el.value = '';
            });

            document.addEventListener('input', (e) => {
                if (e?.target?.id === 'account-bio-input') updateBioCounter();
            });
        }

        async function loadAccountHome(viewUserId) {
            const usernameEl = document.getElementById('account-home-username');
            const tierEl = document.getElementById('account-home-tier');
            const blurbEl = document.getElementById('account-home-blurb');
            const tasteEl = document.getElementById('account-home-taste');
            const overviewEl = document.getElementById('account-home-overview');

            const activeUid = getActiveUserId();
            const uid = String(viewUserId || '').trim() || activeUid;
            accountHomeViewUserId = uid;
            const isSelf = !!uid && uid === activeUid;
            setAccountHomeViewMode(isSelf);
            // Achievements is a self-only tab; honor a pending tab request on your own page.
            setAccountHomeTab(isSelf ? (accountHomePendingTab || 'profile') : 'profile');
            accountHomePendingTab = '';

            if (!supabaseClient || !uid) {
                if (usernameEl) usernameEl.textContent = 'Not signed in';
                if (tierEl) tierEl.textContent = '';
                if (blurbEl) blurbEl.textContent = 'Log in to view your account.';
                if (tasteEl) tasteEl.innerHTML = '';
                if (overviewEl) overviewEl.innerHTML = '';
                setAccountHomeAvatar('');
                setAccountHomeFollows(null, null);
                setAccountHomeBio('');
                return;
            }

            // --- Profile row (username / icon / bio / points / tier) ---
            try {
                const { data } = await supabaseClient
                    .from('Users')
                    .select('username, icon, bio, achievement_points, tier_id')
                    .eq('id', uid)
                    .limit(1);
                const row = Array.isArray(data) && data.length ? data[0] : null;
                const username = String(row?.username || '').trim();
                if (usernameEl) usernameEl.textContent = username ? `@${username}` : (isSelf ? 'Your profile' : 'Profile');
                setAccountHomeAvatar(String(row?.icon || '').trim());
                setAccountHomeBio(String(row?.bio || '').trim());

                const points = Number(row?.achievement_points) || 0;
                let tierName = '';
                const tierId = String(row?.tier_id || '').trim();
                if (tierId) {
                    try {
                        const { data: t } = await supabaseClient
                            .from('User Tiers').select('name').eq('id', tierId).limit(1);
                        tierName = String((Array.isArray(t) && t[0]?.name) || '').trim();
                    } catch (_) {}
                }
                if (tierEl) {
                    tierEl.innerHTML = `${tierName ? `<span class="account-home-tier-badge">${escapeHtml(tierName)}</span>` : ''}<span class="account-home-points">${points.toLocaleString()} pts</span>`;
                }
            } catch (_) {
                if (usernameEl) usernameEl.textContent = 'Your profile';
            }

            // --- Follow counts ---
            try {
                const [following, followers] = await Promise.all([
                    supabaseClient.from('Follows').select('*', { count: 'exact', head: true }).eq('follower_id', uid),
                    supabaseClient.from('Follows').select('*', { count: 'exact', head: true }).eq('followed_id', uid),
                ]);
                setAccountHomeFollows(following?.count ?? 0, followers?.count ?? 0);
            } catch (_) { setAccountHomeFollows(0, 0); }

            // --- Taste profile (blurb + compact card) ---
            try {
                const { data } = await supabaseClient
                    .from('Taste Profiles')
                    .select('mean_overall, median_overall, std_overall, like_threshold, imdb_delta, genre_affinity_json, decade_bins_json, people_affinity_json, taste_blurb')
                    .eq('user_id', uid)
                    .limit(1);
                const profile = Array.isArray(data) && data.length ? data[0] : null;
                const blurbCard = document.getElementById('account-home-blurb-card');
                if (blurbEl) {
                    const blurb = String(profile?.taste_blurb || '').trim() || deriveTasteBlurb(profile);
                    blurbEl.textContent = blurb || '';
                    if (blurbCard) blurbCard.style.display = blurb ? '' : 'none';
                }
                if (tasteEl) tasteEl.innerHTML = renderAccountHomeTaste(profile);
            } catch (_) {
                if (tasteEl) tasteEl.innerHTML = '<div class="account-home-taste-empty">Rate a few movies to build your taste profile.</div>';
            }

            // --- Follow button state (only when viewing someone else) ---
            if (!isSelf && activeUid) {
                try {
                    const { count } = await supabaseClient
                        .from('Follows').select('*', { count: 'exact', head: true })
                        .eq('follower_id', activeUid).eq('followed_id', uid);
                    setAccountFollowButton((count || 0) > 0);
                } catch (_) { setAccountFollowButton(false); }
            }

            // --- To Rate queue (self-only) — refresh the tab count + list ---
            if (isSelf) { loadReviewDraftsPanel().catch(() => {}); }

            // --- Profile overview (KPIs + Taste Match + grid) lives in 05-feed-library.js ---
            if (overviewEl) {
                try { await loadAccountProfileOverview(uid, overviewEl); }
                catch (_) { overviewEl.innerHTML = ''; }
            }
        }

        // Toggles the self-only chrome (gear / avatar camera / bio editability) and
        // the other-only chrome (Back + Follow buttons) for the current view.
        function setAccountHomeViewMode(isSelf) {
            const container = document.querySelector('.account-home-container');
            if (container) container.classList.toggle('account-viewing-other', !isSelf);
            // (Bio edit is gated in the click handler; don't disable the button — a
            //  disabled <button> can render greyed in some browsers, hiding their bio.)
            const followBtn = document.getElementById('account-home-follow-btn');
            if (followBtn) followBtn.style.display = isSelf ? 'none' : '';
            const backBtn = document.getElementById('account-home-back-btn');
            if (backBtn) backBtn.style.display = isSelf ? 'none' : '';
            // Self-oriented copy → neutral when viewing someone else.
            const blurbLabel = document.querySelector('#account-home-blurb-card .account-home-blurb-label');
            if (blurbLabel) blurbLabel.textContent = isSelf ? 'Your taste, in a sentence' : 'Their taste, in a sentence';
            const tasteTitle = document.querySelector('.account-home-card .account-home-card-title');
            if (tasteTitle) tasteTitle.textContent = isSelf ? 'Your Taste' : 'Their Taste';
            // "Data Dash →" only shows YOUR own data, so hide it on others' pages.
            const dashLink = document.querySelector('.account-home-card [data-account-home-action="open_dashboard"]');
            if (dashLink) dashLink.style.display = isSelf ? '' : 'none';
        }

        // Switch between the Profile and Achievements tabs (self-only; viewing
        // someone else is forced to the Profile panel — see setAccountHomeViewMode).
        function setAccountHomeTab(tab, opts) {
            const valid = ['profile', 'torate', 'achievements'];
            const t = valid.includes(tab) ? tab : 'profile';
            const prev = accountHomeActiveTab;
            // Leaving the default (Profile) tab is a Back step, so a swipe returns to
            // the tab you came from before it leaves the Account page.
            if (!opts?.fromBack && t !== prev) {
                try {
                    if (t !== 'profile') pushBackState('acct-tab:' + prev, () => setAccountHomeTab(prev, { fromBack: true }));
                    else dropBackState('acct-tab:');
                } catch (_) {}
            }
            accountHomeActiveTab = t;
            const profilePanel = document.getElementById('account-panel-profile');
            const toratePanel = document.getElementById('account-panel-torate');
            const achPanel = document.getElementById('account-panel-achievements');
            if (profilePanel) profilePanel.style.display = (t === 'profile') ? '' : 'none';
            if (toratePanel) toratePanel.style.display = (t === 'torate') ? '' : 'none';
            if (achPanel) achPanel.style.display = (t === 'achievements') ? '' : 'none';
            document.querySelectorAll('.account-home-tab').forEach((b) => {
                b.classList.toggle('is-active', b.dataset.accountHomeTab === t);
            });
            if (t === 'torate') loadReviewDraftsPanel();
        }

        // Jump straight to YOUR Account page's Achievements tab (used by the
        // achievement-earned popup's "View Achievements" button).
        function openAchievementsTab() {
            accountHomePendingTab = 'achievements';
            router.navigate('account');
        }

        // ---- To Rate tab (Review Drafts queue; self-only) -----------------------
        // Lists the movies the user saved to finish rating later (server "Review
        // Drafts" rows). "Rate now" opens the log form prefilled from the draft;
        // "Remove" deletes it. Both DB helpers (fetchReviewDrafts / deleteReviewDraftFor /
        // fetchReviewDraftForMovie) live in 10-logging-form.js.
        function formatReviewDraftDate(d) {
            const s = String(d || '').trim();
            const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (!m) return s;
            return `${m[2]}/${m[3]}/${m[1].slice(2)}`;
        }

        function renderReviewDraftCard(row) {
            const tmdb = Number(row?.tmdb_id || 0);
            const title = escapeHtml(String(row?.title || 'Untitled').trim() || 'Untitled');
            const year = row?.release_year ? ` (${escapeHtml(String(row.release_year))})` : '';
            const poster = row?.poster_path ? dashBuildPosterUrl(row.poster_path, 'w185') : '';
            const posterHtml = poster
                ? `<img class="torate-poster" src="${poster}" alt="" loading="lazy">`
                : `<div class="torate-poster torate-poster-fallback">${icons.film || ''}</div>`;
            let meta;
            if (row?.watch_date) {
                const method = String(row?.watch_method || '').trim();
                meta = `Watched ${escapeHtml(formatReviewDraftDate(row.watch_date))}${method ? ` · ${escapeHtml(method)}` : ''}`;
            } else {
                meta = 'Not watched yet';
            }
            const hasRatings = (typeof serverDraftHasRatingContent === 'function') && serverDraftHasRatingContent(row);
            const status = hasRatings ? 'Review started' : 'No rating yet';
            return `
                <div class="torate-card" data-torate-tmdb="${tmdb}">
                    ${posterHtml}
                    <div class="torate-main">
                        <div class="torate-title">${title}${year}</div>
                        <div class="torate-meta">${meta}</div>
                        <div class="torate-status">${escapeHtml(status)}</div>
                    </div>
                    <div class="torate-actions">
                        <button type="button" class="btn btn-primary" data-account-home-action="rate_draft" data-tmdb="${tmdb}">Rate now</button>
                        <button type="button" class="btn btn-outline" data-account-home-action="remove_draft" data-tmdb="${tmdb}">Remove</button>
                    </div>
                </div>`;
        }

        async function loadReviewDraftsPanel() {
            const listEl = document.getElementById('account-torate-list');
            const countEl = document.getElementById('account-torate-count');
            if (!listEl) return;
            // Self-only — never show another user's drafts.
            if (accountHomeViewUserId !== getActiveUserId()) {
                listEl.innerHTML = '';
                if (countEl) countEl.style.display = 'none';
                return;
            }
            let drafts = [];
            try { drafts = await fetchReviewDrafts(); } catch (_) { drafts = []; }

            if (countEl) {
                if (drafts.length) { countEl.textContent = String(drafts.length); countEl.style.display = ''; }
                else countEl.style.display = 'none';
            }
            // Keep the "More" tab / Account-row "to rate" reminder badge in sync when
            // a draft is added/rated/deleted here (these are MY drafts — self-only path).
            try { setToRateBadge(drafts.length); } catch (_) {}
            if (!drafts.length) {
                listEl.innerHTML = '<div class="account-torate-empty">No drafts right now. Tap “Rate Later” on a movie — or start a review and leave — to save one here.</div>';
                return;
            }
            listEl.innerHTML = drafts.map(renderReviewDraftCard).join('');
        }

        async function rateReviewDraft(tmdb) {
            const n = Number(tmdb);
            if (!Number.isFinite(n) || n <= 0) return;
            let row = null;
            try { row = await fetchReviewDraftForMovie(n); } catch (_) {}
            // Auto-apply the draft on the form (no "Restore draft?" prompt — the user
            // explicitly chose to resume it here).
            try { diaryDraftForceRestore = true; } catch (_) {}
            const hasUuidMovie = (typeof isUuidLike === 'function') && isUuidLike(row?.movie_id);
            router.selectedMovie = {
                tmdb_id: n,
                id: hasUuidMovie ? row.movie_id : n,
                movie_id: hasUuidMovie ? row.movie_id : null,
                title: String(row?.title || '').trim(),
                release_year: row?.release_year || null,
                poster_path: row?.poster_path || null,
            };
            router.pendingTitle = String(row?.title || '').trim();
            try { await router.startNewEntry(); }
            catch (e) { showToast(`Couldn’t open the form: ${String(e?.message || e)}`, { level: 'warn' }); }
        }

        // First click swaps the card's actions to an inline "Delete this draft?"
        // confirm so a draft is never removed on a single accidental tap.
        function promptRemoveReviewDraft(tmdb, btn) {
            const card = btn?.closest?.('.torate-card');
            const actions = card?.querySelector?.('.torate-actions');
            if (!actions) return;
            const t = escapeHtml(String(tmdb));
            actions.innerHTML = `
                <button type="button" class="btn torate-confirm-del" data-account-home-action="confirm_remove_draft" data-tmdb="${t}">Delete</button>
                <button type="button" class="btn btn-glass" data-account-home-action="cancel_remove_draft" data-tmdb="${t}">Cancel</button>`;
        }

        async function removeReviewDraft(tmdb, btn) {
            const n = Number(tmdb);
            if (!Number.isFinite(n) || n <= 0) return;
            if (guardGuestWrite()) return;
            try {
                await deleteReviewDraftFor({ tmdb_id: n });
                const card = btn?.closest?.('.torate-card');
                if (card) card.remove();
                showToast('Draft deleted.');
                loadReviewDraftsPanel();
            } catch (e) {
                showToast(`Delete failed: ${String(e?.message || e)}`, { level: 'warn' });
            }
        }

        function setAccountFollowButton(isFollowing) {
            const btn = document.getElementById('account-home-follow-btn');
            if (!btn) return;
            btn.disabled = false;
            btn.dataset.following = isFollowing ? '1' : '0';
            btn.textContent = isFollowing ? 'Following' : 'Follow';
            btn.classList.toggle('is-following', !!isFollowing);
        }

        async function handleAccountFollowClick(btn) {
            const targetId = accountHomeViewUserId;
            if (!targetId || targetId === getActiveUserId()) return;
            const isFollowing = btn?.dataset?.following === '1';
            const result = await toggleAccountFollow(targetId, isFollowing, btn);
            if (result === null) return; // failed; toggleAccountFollow restored the label
            setAccountFollowButton(result);
            // Reflect the change in this profile's Followers count.
            const followersEl = document.getElementById('account-home-followers');
            if (followersEl) {
                const cur = parseInt(String(followersEl.textContent).replace(/[^0-9]/g, ''), 10) || 0;
                followersEl.textContent = Math.max(0, cur + (result ? 1 : -1)).toLocaleString();
            }
        }

        function setAccountHomeAvatar(iconVal) {
            const el = document.getElementById('account-home-avatar');
            if (!el) return;
            const raw = String(iconVal || '').trim();
            el.innerHTML = isUserIconUrl(raw)
                ? `<img src="${escapeHtml(raw)}" alt="Profile photo" loading="lazy" decoding="async" />`
                : icons.user;
        }

        function setAccountHomeFollows(following, followers) {
            const f1 = document.getElementById('account-home-following');
            const f2 = document.getElementById('account-home-followers');
            if (f1) f1.textContent = following == null ? '–' : Number(following).toLocaleString();
            if (f2) f2.textContent = followers == null ? '–' : Number(followers).toLocaleString();
        }

        function setAccountHomeBio(bio) {
            accountHomeBioValue = String(bio || '').trim();
            const el = document.getElementById('account-home-bio');
            if (!el) return;
            const isSelf = !accountHomeViewUserId || accountHomeViewUserId === getActiveUserId();
            if (accountHomeBioValue) {
                el.textContent = accountHomeBioValue;
                el.classList.remove('account-home-bio-empty');
                el.style.display = '';
            } else if (isSelf) {
                el.textContent = 'Add a bio to tell people about your taste in film.';
                el.classList.add('account-home-bio-empty');
                el.style.display = '';
            } else {
                // Viewing someone with no bio — hide the prompt entirely.
                el.textContent = '';
                el.classList.add('account-home-bio-empty');
                el.style.display = 'none';
            }
        }

        // ---- Following / Followers modal ----
        function openFollowsModal(kind) {
            const overlay = document.getElementById('account-follows-overlay');
            const titleEl = document.getElementById('account-follows-title');
            const listEl = document.getElementById('account-follows-list');
            if (!overlay) return;
            if (titleEl) titleEl.textContent = kind === 'followers' ? 'Followers' : 'Following';
            if (listEl) listEl.innerHTML = '<div class="account-follows-empty">Loading…</div>';
            overlay.style.display = 'flex';
            overlay.classList.add('open');
            loadFollowsList(kind);
        }

        function closeFollowsModal() {
            const overlay = document.getElementById('account-follows-overlay');
            if (!overlay) return;
            overlay.classList.remove('open');
            overlay.style.display = 'none';
        }

        async function loadFollowsList(kind) {
            const listEl = document.getElementById('account-follows-list');
            if (!listEl) return;
            const uid = accountHomeViewUserId || getActiveUserId();
            const isSelfList = uid === getActiveUserId();
            if (!supabaseClient || !uid) { listEl.innerHTML = '<div class="account-follows-empty">Log in to view this.</div>'; return; }
            try {
                // `following` = people I follow (I'm the follower); `followers` = people who follow me.
                const selfCol = kind === 'followers' ? 'followed_id' : 'follower_id';
                const otherCol = kind === 'followers' ? 'follower_id' : 'followed_id';
                const { data: links, error } = await supabaseClient
                    .from('Follows').select(otherCol).eq(selfCol, uid);
                if (error) throw error;
                const ids = Array.from(new Set((Array.isArray(links) ? links : []).map((r) => String(r?.[otherCol] || '').trim()).filter(Boolean)));
                if (!ids.length) {
                    listEl.innerHTML = `<div class="account-follows-empty">${kind === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}</div>`;
                    return;
                }
                const { data: users } = await supabaseClient
                    .from('Users').select('id, username, icon').in('id', ids);
                const rows = Array.isArray(users) ? users : [];
                // Keep the Follows order; sort by username for a stable list.
                rows.sort((a, b) => String(a?.username || '').localeCompare(String(b?.username || '')));
                const canUnfollow = (kind !== 'followers') && isSelfList;
                listEl.innerHTML = rows.map((u) => {
                    const id = String(u?.id || '').trim();
                    const name = String(u?.username || '').trim() || 'user';
                    return `
                        <div class="account-follows-row" data-account-home-action="open_user" data-user-id="${escapeHtml(id)}" role="button" tabindex="0">
                            ${renderUserIconHtml(String(u?.icon || '').trim(), 38)}
                            <span class="account-follows-name">@${escapeHtml(name)}</span>
                            ${canUnfollow ? `<button type="button" class="account-follows-unfollow" data-account-home-action="unfollow" data-user-id="${escapeHtml(id)}">Unfollow</button>` : ''}
                        </div>
                    `;
                }).join('');
            } catch (err) {
                listEl.innerHTML = `<div class="account-follows-empty">Could not load: ${escapeHtml(String(err?.message || err))}</div>`;
            }
        }

        async function handleUnfollowFromModal(targetId, btn) {
            if (guardGuestWrite()) return;
            const uid = String(cachedAuthUser?.id || '').trim();
            if (!supabaseClient || !cachedIsAuthed || !uid) {
                showToast('Please log in first.', { level: 'warn' });
                return;
            }
            const row = btn?.closest ? btn.closest('.account-follows-row') : null;
            const prev = btn?.textContent;
            if (btn) { btn.disabled = true; btn.textContent = '…'; }
            try {
                const { error } = await supabaseClient
                    .from('Follows').delete().eq('follower_id', uid).eq('followed_id', targetId);
                if (error) throw error;
                // Drop the row + decrement the page's Following count.
                if (row) row.remove();
                const followingEl = document.getElementById('account-home-following');
                if (followingEl) {
                    const next = Math.max(0, (parseInt(String(followingEl.textContent).replace(/[^0-9]/g, ''), 10) || 0) - 1);
                    followingEl.textContent = next.toLocaleString();
                }
                const listEl = document.getElementById('account-follows-list');
                if (listEl && !listEl.querySelector('.account-follows-row')) {
                    listEl.innerHTML = '<div class="account-follows-empty">Not following anyone yet.</div>';
                }
                showToast('Unfollowed.');
            } catch (err) {
                if (btn) { btn.disabled = false; btn.textContent = prev || 'Unfollow'; }
                showToast(`Could not unfollow: ${String(err?.message || err)}`, { level: 'warn' });
            }
        }

        // ---- Profile photo (reuses the shared cropper from 18-account-page.js) ----
        async function handleAccountHomeIconPick(file) {
            if (guardGuestWrite()) return;
            const uid = String(cachedAuthUser?.id || '').trim();
            if (!supabaseClient || !cachedIsAuthed || !uid) {
                showToast('Please log in first.', { level: 'warn' });
                return;
            }
            try {
                const dataUrl = await processAccountIconFile(file);
                const { error } = await supabaseClient.from('Users').update({ icon: dataUrl }).eq('id', uid);
                if (error) throw error;
                setAccountHomeAvatar(dataUrl);
                cachedUserIconId = uid;
                cachedUserIcon = dataUrl;
                cachedUserIconLoaded = true;
                await refreshAuthStateAndUI();
                showToast('Profile photo updated.');
            } catch (err) {
                showToast(`Photo update failed: ${String(err?.message || err)}`, { level: 'warn' });
            }
        }

        // ---- Bio editing (small modal) ----
        function openBioModal() {
            if (guardGuestWrite()) return;
            const overlay = document.getElementById('account-bio-overlay');
            const input = document.getElementById('account-bio-input');
            const status = document.getElementById('account-bio-status');
            if (!overlay) return;
            if (input) input.value = accountHomeBioValue || '';
            if (status) status.textContent = '';
            updateBioCounter();
            overlay.style.display = 'flex';
            overlay.classList.add('open');
            try { input?.focus(); } catch (_) {}
        }

        function closeBioModal() {
            const overlay = document.getElementById('account-bio-overlay');
            if (!overlay) return;
            overlay.classList.remove('open');
            overlay.style.display = 'none';
        }

        function updateBioCounter() {
            const input = document.getElementById('account-bio-input');
            const remEl = document.getElementById('account-bio-remaining');
            if (!input || !remEl) return;
            const remaining = Math.max(0, 280 - String(input.value || '').length);
            remEl.textContent = `${remaining} characters remaining`;
        }

        async function saveBio() {
            if (guardGuestWrite()) return;
            const input = document.getElementById('account-bio-input');
            const status = document.getElementById('account-bio-status');
            const btn = document.getElementById('account-bio-save');
            const uid = String(cachedAuthUser?.id || '').trim();
            if (!supabaseClient || !cachedIsAuthed || !uid) {
                showToast('Please log in first.', { level: 'warn' });
                return;
            }
            const bio = String(input?.value || '').trim().slice(0, 280);
            const prev = btn?.textContent;
            if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
            if (status) status.textContent = 'Saving…';
            try {
                const { error } = await supabaseClient.from('Users').update({ bio }).eq('id', uid);
                if (error) throw error;
                setAccountHomeBio(bio);
                showToast('Bio updated.');
                closeBioModal();
            } catch (err) {
                const msg = String(err?.message || err);
                if (status) status.textContent = `Save failed: ${msg}`;
                showToast(`Save failed: ${msg}`, { level: 'warn' });
            } finally {
                if (btn) { btn.disabled = false; btn.textContent = prev || 'Save bio'; }
            }
        }

        // ---- Taste helpers (shared by the card + the derived-blurb fallback) ----
        function accountHomeTopGenres(profile, n = 3) {
            return Object.entries(profile?.genre_affinity_json || {})
                .filter(([, v]) => Number(v?.count) >= 2 && Number(v?.aff) > 0)
                .sort((a, b) => (Number(b[1]?.aff) || 0) - (Number(a[1]?.aff) || 0))
                .slice(0, n)
                .map(([name]) => name);
        }

        function accountHomeFavoriteDecade(profile) {
            let best = null, bestAff = 0;
            Object.entries(profile?.decade_bins_json || {}).forEach(([decade, v]) => {
                const aff = Number(v?.aff);
                if (Number(v?.count) >= 2 && Number.isFinite(aff) && aff > bestAff) { bestAff = aff; best = `${decade}s`; }
            });
            return best;
        }

        function accountHomeTopPerson(profile, role) {
            return Object.values(profile?.people_affinity_json || {})
                .filter((p) => Array.isArray(p?.roles) && p.roles.includes(role) && Number(p?.aff) > 0)
                .sort((a, b) => (Number(b?.aff) || 0) - (Number(a?.aff) || 0))[0]?.name || null;
        }

        function accountHomeRaterStyle(mean) {
            const m = Number(mean);
            if (!Number.isFinite(m)) return null;
            if (m <= 55) return 'Harsh grader';
            if (m <= 68) return 'Tough but fair';
            if (m >= 85) return 'Very generous';
            if (m >= 78) return 'Generous grader';
            return 'Balanced grader';
        }

        // Client-side fallback blurb when the cached AI one isn't ready yet.
        function deriveTasteBlurb(profile) {
            if (!profile) return '';
            const style = accountHomeRaterStyle(profile.mean_overall);
            const genres = accountHomeTopGenres(profile, 1);
            if (style && genres.length) return `${style} with a soft spot for ${genres[0].toLowerCase()}`;
            if (genres.length) return `${genres[0]} lover`;
            if (style) return style;
            return '';
        }

        function renderAccountHomeTaste(profile) {
            if (!profile) {
                return '<div class="account-home-taste-empty">Rate a few movies to build your taste profile.</div>';
            }
            // Each tile: { label, valueHtml, full } — `full` spans the whole row.
            const tiles = [];
            const tile = (label, valueHtml, full) => tiles.push({ label, valueHtml, full: !!full });

            const style = accountHomeRaterStyle(profile.mean_overall);
            const mean = Number(profile.mean_overall);
            if (style && Number.isFinite(mean)) {
                tile('Rater style', `${escapeHtml(style)} <span class="account-home-taste-sub">· avg ${Math.round(mean)}%</span>`, true);
            }
            const genres = accountHomeTopGenres(profile, 3);
            if (genres.length) {
                const chips = genres.map((g) => `<span class="account-home-genre-chip">${escapeHtml(g)}</span>`).join('');
                tile('Top genres', `<span class="account-home-chip-row">${chips}</span>`, true);
            }
            const decade = accountHomeFavoriteDecade(profile);
            if (decade) tile('Favorite era', `The ${escapeHtml(decade)}`);
            const delta = Number(profile.imdb_delta);
            if (Number.isFinite(delta) && Math.abs(delta) >= 4) {
                tile('Vs. the crowd', delta > 0 ? `+${Math.round(delta)} pts` : `−${Math.round(-delta)} pts`);
            }
            const director = accountHomeTopPerson(profile, 'director');
            if (director) tile('Favorite director', escapeHtml(director));
            const actor = accountHomeTopPerson(profile, 'actor');
            if (actor) tile('Rates highest', escapeHtml(actor));

            if (!tiles.length) {
                return '<div class="account-home-taste-empty">Rate a few movies to build your taste profile.</div>';
            }
            // Avoid an orphaned half-tile (awkward bottom-right gap): if the number of
            // half-width tiles is odd, let the last one span the full row.
            const halfTiles = tiles.filter((t) => !t.full);
            if (halfTiles.length % 2 === 1) halfTiles[halfTiles.length - 1].full = true;
            return tiles.map((t) => `
                <div class="account-home-taste-tile${t.full ? ' account-home-taste-tile-full' : ''}">
                    <span class="account-home-taste-label">${escapeHtml(t.label)}</span>
                    <span class="account-home-taste-value">${t.valueHtml}</span>
                </div>
            `).join('');
        }
