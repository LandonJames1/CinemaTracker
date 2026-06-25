        // ============================================================
        // Leaderboard page (route `leaderboard`).
        //
        // A friends leaderboard scoped to YOU + the people you FOLLOW via the
        // get_follow_leaderboard() SECURITY DEFINER RPC (leaderboard.sql), so no
        // global stats are exposed and privacy_level never has to be consulted.
        // Controls: metric (Movies Rated / Points) × timeframe (This Month /
        // All-Time) — BOTH metrics support BOTH timeframes (for Points, month =
        // points earned this calendar month). Rows reuse renderUserIconHtml +
        // openUserProfile. (Achievements moved to its own tab on the Account page.)
        // ============================================================

        let leaderboardMetric = 'movies_rated';     // 'movies_rated' | 'achievement_points'
        let leaderboardTimeframe = 'month';         // 'month' | 'all_time'
        let _leaderboardBound = false;
        let _leaderboardReqToken = 0;               // guards against out-of-order responses

        function initLeaderboardPage() {
            if (_leaderboardBound) return;
            _leaderboardBound = true;

            // One delegated listener (the controls are re-rendered on each navigate,
            // but this document-level binding persists).
            document.addEventListener('click', (e) => {
                const t = e.target;
                if (!t || !t.closest) return;

                const metricBtn = t.closest('[data-lb-metric]');
                if (metricBtn) {
                    e.preventDefault();
                    setLeaderboardMetric(metricBtn.dataset.lbMetric);
                    return;
                }

                const tfBtn = t.closest('[data-lb-timeframe]');
                if (tfBtn) {
                    e.preventDefault();
                    setLeaderboardTimeframe(tfBtn.dataset.lbTimeframe);
                    return;
                }

                const rowEl = t.closest('.lb-row, .lb-podium-item');
                if (rowEl && rowEl.dataset.userId) {
                    e.preventDefault();
                    openUserProfile(rowEl.dataset.userId);
                    return;
                }
            });
        }

        // Re-sync the metric/timeframe pills to the persisted state (the markup
        // resets its active classes to defaults on each navigate).
        function syncLeaderboardControls() {
            document.querySelectorAll('[data-lb-metric]').forEach(b => {
                b.classList.toggle('is-active', b.dataset.lbMetric === leaderboardMetric);
            });
            document.querySelectorAll('[data-lb-timeframe]').forEach(b => {
                b.classList.toggle('is-active', b.dataset.lbTimeframe === leaderboardTimeframe);
            });
        }

        function setLeaderboardMetric(metric) {
            leaderboardMetric = (metric === 'achievement_points') ? 'achievement_points' : 'movies_rated';
            document.querySelectorAll('[data-lb-metric]').forEach(b => {
                b.classList.toggle('is-active', b.dataset.lbMetric === leaderboardMetric);
            });
            loadLeaderboard();
        }

        function setLeaderboardTimeframe(tf) {
            leaderboardTimeframe = (tf === 'all_time') ? 'all_time' : 'month';
            document.querySelectorAll('[data-lb-timeframe]').forEach(b => {
                b.classList.toggle('is-active', b.dataset.lbTimeframe === leaderboardTimeframe);
            });
            loadLeaderboard();
        }

        async function loadLeaderboard() {
            const content = document.getElementById('lb-content');
            if (!content) return;
            if (!supabaseClient || !cachedIsAuthed) {
                content.innerHTML = `<div class="lb-empty">Log in to see your leaderboard.</div>`;
                return;
            }

            // Both metrics honor the timeframe (Points month = points earned this
            // calendar month, computed in the get_follow_leaderboard RPC).
            const metric = leaderboardMetric;
            const timeframe = leaderboardTimeframe;
            const token = ++_leaderboardReqToken;

            content.innerHTML = `<div class="text-xs text-gray" style="padding:0.5rem;">Loading leaderboard…</div>`;

            try {
                const { data, error } = await supabaseClient.rpc('get_follow_leaderboard', {
                    p_metric: metric,
                    p_timeframe: timeframe,
                });
                if (token !== _leaderboardReqToken) return; // a newer request superseded this one
                if (error) throw error;
                content.innerHTML = renderLeaderboardContent(Array.isArray(data) ? data : []);
            } catch (e) {
                if (token !== _leaderboardReqToken) return;
                emitLog?.('Leaderboard load failed: ' + (e?.message || e), 'error');
                content.innerHTML = `<div class="lb-empty">Couldn't load the leaderboard. Pull to refresh or try again.</div>`;
            }
        }

        function lbScoreLabel(score, metric) {
            const n = Math.round(Number(score) || 0);
            if (metric === 'achievement_points') return `${n.toLocaleString()} pts`;
            if (metric === 'watches') return `${n} ${n === 1 ? 'watch' : 'watches'}`;
            return `${n} ${n === 1 ? 'film' : 'films'}`;
        }

        function lbAvatar(row, sizePx) {
            return `<span class="lb-avatar">${renderUserIconHtml(row.icon, sizePx)}</span>`;
        }

        function lbNameHtml(row) {
            const name = escapeHtml(row.username || 'User');
            return `<span class="lb-name">@${name}${row.is_self ? ' <span class="lb-you">You</span>' : ''}</span>`;
        }

        function lbPodiumItem(row, metric) {
            const rank = row._rank;
            return `
                <div class="lb-podium-item lb-rank-${rank}${row.is_self ? ' is-self' : ''}" role="button" tabindex="0" data-user-id="${escapeHtml(String(row.user_id || ''))}">
                    <div class="lb-medal" data-rank="${rank}">${rank}</div>
                    ${lbAvatar(row, rank === 1 ? 64 : 52)}
                    ${lbNameHtml(row)}
                    <div class="lb-score">${lbScoreLabel(row.score, metric)}</div>
                </div>
            `;
        }

        function lbRow(row, metric) {
            return `
                <button type="button" class="lb-row${row.is_self ? ' is-self' : ''}" data-user-id="${escapeHtml(String(row.user_id || ''))}">
                    <span class="lb-rank">${row._rank}</span>
                    ${lbAvatar(row, 40)}
                    ${lbNameHtml(row)}
                    <span class="lb-score">${lbScoreLabel(row.score, metric)}</span>
                </button>
            `;
        }

        function renderLeaderboardContent(rows) {
            const metric = leaderboardMetric;
            const list = (Array.isArray(rows) ? rows : []).slice();
            if (!list.length) {
                return `<div class="lb-empty">Follow people in the Feed to build your leaderboard.</div>`;
            }

            // The RPC already orders by score desc; assign sequential ranks.
            list.forEach((r, i) => { r._rank = i + 1; });

            const top = list.slice(0, 3);
            const rest = list.slice(3);
            const podium = `<div class="lb-podium">${top.map(r => lbPodiumItem(r, metric)).join('')}</div>`;
            const rowsHtml = rest.length ? `<div class="lb-rows">${rest.map(r => lbRow(r, metric)).join('')}</div>` : '';
            const hint = (list.length < 2)
                ? `<div class="lb-hint">Follow more people to see how you stack up against them.</div>`
                : '';
            return podium + rowsHtml + hint;
        }
