        // ============================================================
        // Games page (route `games`).
        //
        // Three DAILY movie games, the same for everyone each day, seeded
        // server-side into "Game Daily" from the cached "Game Pool" (see
        // games_schema.sql + the swift-api game_* actions):
        //   - spottle : guess the hidden daily movie; each guess returns
        //               Wordle-style attribute-closeness tiles (year / genre /
        //               director / IMDb / runtime / MPA).
        //   - rank    : sort 4 movies high→low by IMDb rating.
        //   - poster  : a blurred poster that sharpens with each wrong guess.
        //
        // EVERY game has a two-tap Give Up (giving up still records a finished/"Done"
        // result). The three GUESS games (spottle/poster/cast) also share a ladder of
        // progressive hint tiers that unlock as guesses are spent — era+genre → studio
        // + box office → director → lead actor, the last omitted for `cast` so the
        // headshot finale isn't spoiled (see spottleHints in EdgeFunc). Opening any
        // hint costs 1 point. RANK HAS NO HINT — ordering the films is the whole puzzle.
        //
        // Cheat-resistance: the daily answers are NEVER client-readable. Progress +
        // guess-checking go through the authenticated edge actions (game_today /
        // game_guess / game_submit / game_giveup), which strip
        // ratings/answers for unfinished games. The guess autocomplete searches ALL of TMDB via the same
        // public `search` action the Home page uses (movie titles aren't secret; the
        // server checks the guess and reveals nothing early). Route is auth-gated.
        //
        // Loaded BEFORE 19-logging-boot.js despite the higher number (19 must be
        // last). Styles live in the "Games page" block in styles.css.
        // ============================================================

        let gamesTodayData = null;      // last game_today response ({ date, games:{...} })
        let gamesActiveGame = null;     // 'spottle' | 'rank' | 'poster' | null
        let _gamesBound = false;
        let gameSearchTimer = null;     // debounce for the autocomplete
        let rankOrderIds = [];          // current rank ordering (tmdb_id[])
        let posterPrevBlur = null;      // last-rendered blur px, so a new guess ANIMATES the sharpen
        let posterPendingBlur = null;   // blur px to transition TO once the board is in the DOM

        const GAME_META = {
            spottle: { title: 'Filmle', tag: 'Guess the movie', icon: 'search',
                       desc: 'Guess the daily film — each clue reveals how close you are.' },
            rank:    { title: 'Rank It', tag: 'Sort by IMDb', icon: 'sort',
                       desc: 'Put 6 movies in order by their IMDb rating.' },
            poster:  { title: 'Poster Blur', tag: 'Name the poster', icon: 'film',
                       desc: 'A blurred poster sharpens with every wrong guess.' },
            cast:    { title: 'Starring', tag: 'Guess by cast', icon: 'users',
                       desc: 'Name the film from its cast — a new face each guess.' },
        };
        const GAME_ORDER = ['spottle', 'rank', 'poster', 'cast'];

        // Crisp per-game icons for the hub tiles + results hero (nicer than the
        // generic shared `icons` map). White strokes on each game's gradient badge.
        const GAME_ICON_SVG = {
            // Clapperboard (guess the movie).
            spottle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="8" width="19" height="12.5" rx="1.6"/><path d="M2.9 8 5 3.9l3.4 1.7L11.7 3.9l3.4 1.7L18.4 3.9 21.4 8"/><path d="M2.6 8h19"/></svg>',
            // Ranked bars (sort high→low).
            rank: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 21V9"/><path d="M12 21V4"/><path d="M18 21v-8"/></svg>',
            // Framed image (name the poster).
            poster: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><circle cx="9" cy="9" r="1.6"/><path d="m20.5 15-4.5-4.5L4.5 21"/></svg>',
            // Ensemble of people (guess by cast).
            cast: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
        };
        function gameIconHtml(game) {
            return GAME_ICON_SVG[game]
                || ((typeof icons === 'object' && icons[(GAME_META[game] || {}).icon]) || (icons && icons.gamepad) || '');
        }

        // The daily puzzle NUMBER (LinkedIn-style "Filmle #6"). Computed purely from
        // the calendar puzzle date so it's deterministic + identical for every user
        // and increments by one each day — no backend/table needed. Epoch = the first
        // daily seed (2026-07-03 = puzzle #1).
        const GAME_EPOCH_UTC = Date.UTC(2026, 6, 3);   // 2026-07-03 (month is 0-based)
        function gamePuzzleNumber() {
            const date = gamesTodayData?.date;
            if (!date) return null;
            const t = new Date(String(date) + 'T00:00:00Z').getTime();
            if (!Number.isFinite(t)) return null;
            const n = Math.round((t - GAME_EPOCH_UTC) / 86400000) + 1;
            return n > 0 ? n : null;
        }

        // "YYYY-MM-DD" one day earlier (UTC), for streak scanning.
        function gamePrevDate(dateStr) {
            const t = new Date(String(dateStr) + 'T00:00:00Z').getTime();
            if (!Number.isFinite(t)) return null;
            return new Date(t - 86400000).toISOString().slice(0, 10);
        }
        // Whole-day gap between two "YYYY-MM-DD" strings.
        function gameDayGap(a, b) {
            const ta = new Date(String(a) + 'T00:00:00Z').getTime();
            const tb = new Date(String(b) + 'T00:00:00Z').getTime();
            if (!Number.isFinite(ta) || !Number.isFinite(tb)) return NaN;
            return Math.round((tb - ta) / 86400000);
        }

        // Which view a FINISHED game shows: the LinkedIn-style results page
        // ('results') or the playable board so the user can review their guesses
        // ('board'). Reset per open; a fresh finish flashes 'board' (answer reveal)
        // then auto-flips to 'results'.
        const gamesFinishedView = { spottle: 'results', rank: 'results', poster: 'results', cast: 'results' };
        let gamesResultTimer = null;

        // ALL FOUR games end on ONE unified closing frame (Back + compact hero row,
        // the answer-movie card where there is one, then two tabs). This map holds
        // which tab that frame is showing, per game — and doubles as the "is this a
        // real game key" guard. Defaults to 'leaderboard': the board reveal has just
        // shown the guesses, so the circle results are the more interesting landing.
        // Reset per openGame.
        const gamesResultsTab = { spottle: 'leaderboard', rank: 'leaderboard', poster: 'leaderboard', cast: 'leaderboard' };

        // ---- API helpers ---------------------------------------------------------
        async function gamesAuthToken() {
            try {
                const { data } = await supabaseClient.auth.getSession();
                return data?.session?.access_token || null;
            } catch (_) { return null; }
        }

        async function gamesApi(body) {
            const token = await gamesAuthToken();
            if (!token) throw new Error('Please log in to play.');
            return await callSwiftApi(body, token);
        }

        function gamesPosterUrl(path, size = 'w500') {
            const p = String(path || '').trim();
            if (!p) return '';
            if (p.startsWith('http')) return p;
            return `https://image.tmdb.org/t/p/${size}${p.startsWith('/') ? '' : '/'}${p}`;
        }

        // ---- Init + load ---------------------------------------------------------
        function initGamesPage() {
            if (_gamesBound) return;
            _gamesBound = true;
            // One delegated click listener; the games UI is re-rendered each visit but
            // this document-level binding persists. Handlers no-op off the games page
            // (their target elements don't exist elsewhere).
            document.addEventListener('click', gamesDelegatedClick);
            document.addEventListener('input', gamesDelegatedInput);
            document.addEventListener('pointerover', rankComparePointerOver);
            // Hide the bottom tab bar while the guess box is focused. On iOS the fixed
            // bottom bar floats UP over the keyboard, on top of the guess dropdown — and a
            // z-index bump can't fix it because the dropdown is trapped in the .fade-in
            // wrapper's transform stacking context (which paints under the tab bar). A
            // fixed bar over the keyboard is useless anyway, so just hide it while typing.
            document.addEventListener('focusin', (e) => {
                if (e.target && e.target.id === 'game-guess-input') document.body.classList.add('games-guessing');
            });
            document.addEventListener('focusout', (e) => {
                if (e.target && e.target.id === 'game-guess-input') document.body.classList.remove('games-guessing');
            });
        }

        async function loadGamesHub() {
            gamesActiveGame = null;
            const hub = document.getElementById('games-hub');
            const play = document.getElementById('games-play');
            if (play) { play.hidden = true; play.innerHTML = ''; }
            if (hub) hub.hidden = false;
            try {
                const res = await gamesApi({ action: 'game_today' });
                gamesTodayData = res && res.games ? res : { games: {} };
                renderGamesHub();
            } catch (e) {
                if (hub) hub.innerHTML = `<div class="games-error">${escapeHtml(String(e?.message || e))}</div>`;
            }
        }

        // ---- Hub -----------------------------------------------------------------
        function gameStatusFor(game, d) {
            if (!d) return 'unavailable';
            if (game === 'rank') return d.done ? (d.solved ? 'solved' : 'done') : 'play';
            if (d.done) return d.solved ? 'solved' : 'done';
            return (d.attempts > 0) ? 'progress' : 'play';
        }

        function gameStatusLabel(status) {
            // Any finished game (solved, out of guesses, or gave up) reads "Completed".
            return { play: 'Play', progress: 'In progress', solved: 'Completed', done: 'Completed',
                     unavailable: 'Not ready' }[status] || 'Play';
        }

        function renderGamesHub() {
            const hub = document.getElementById('games-hub');
            if (!hub) return;
            const games = gamesTodayData?.games || {};
            const pillLabel = { play: '▶ Play', progress: '▶ Resume', solved: '✓ Completed',
                                done: '✓ Completed', unavailable: 'Not ready' };
            const cards = GAME_ORDER.map((g) => {
                const d = games[g];
                const meta = GAME_META[g] || {};
                const status = gameStatusFor(g, d);
                const disabled = status === 'unavailable';
                return `
                    <button class="games-card games-card--${g} status-${status}" type="button"
                            ${disabled ? 'disabled' : `data-game-open="${g}"`}>
                        <span class="games-card-ico">${gameIconHtml(g)}</span>
                        <span class="games-card-body">
                            <span class="games-card-tag">${escapeHtml(meta.tag || '')}</span>
                            <span class="games-card-title">${escapeHtml(meta.title || '')}</span>
                            <span class="games-card-desc">${escapeHtml(meta.desc || '')}</span>
                        </span>
                        <span class="games-card-foot">
                            <span class="games-status-pill">${pillLabel[status] || 'Play'}</span>
                        </span>
                    </button>`;
            }).join('');
            hub.innerHTML = `<div class="games-grid">${cards}</div>`;
        }

        // ---- Play surface shell --------------------------------------------------
        function openGame(game) {
            if (!GAME_META[game]) return;
            gamesActiveGame = game;
            const hub = document.getElementById('games-hub');
            const play = document.getElementById('games-play');
            if (!hub || !play) return;
            hub.hidden = true;
            play.hidden = false;
            setGamesMobileHeader((GAME_META[game] || {}).title || 'Games');
            // Hints you already revealed stay revealed (they cost a point) — restore
            // them rather than resetting. Give-up arming is transient, so it resets.
            restoreGameHintCounts();
            gameGiveUpArmed.spottle = false; gameGiveUpArmed.poster = false; gameGiveUpArmed.rank = false; gameGiveUpArmed.cast = false;
            if (gameGiveUpTimer) { clearTimeout(gameGiveUpTimer); gameGiveUpTimer = null; }
            // Opening a game (incl. an already-finished one from the hub) lands on the
            // results page; a fresh finish overrides this to flash the board first.
            gamesFinishedView[game] = 'results';
            if (game in gamesResultsTab) gamesResultsTab[game] = 'leaderboard';
            if (gamesResultTimer) { clearTimeout(gamesResultTimer); gamesResultTimer = null; }
            if (game === 'spottle') renderSpottle();
            else if (game === 'rank') { rankOrderIds = []; renderRank(); }
            else if (game === 'poster') { posterPrevBlur = null; renderPoster(); }
            else if (game === 'cast') renderCast();
            try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch (_) {}
        }

        function closeGame() {
            gamesActiveGame = null;
            if (gamesResultTimer) { clearTimeout(gamesResultTimer); gamesResultTimer = null; }
            const hub = document.getElementById('games-hub');
            const play = document.getElementById('games-play');
            if (play) { play.hidden = true; play.innerHTML = ''; }
            if (hub) hub.hidden = false;
            setGamesMobileHeader('Games');   // restore the hub header
            renderGamesHub();   // reflect any freshly-finished game on the cards
        }

        // Icon-only Back control. No in-page game title — the top header bar shows the
        // game name (set in openGame/closeGame via setGamesMobileHeader) — and no
        // "All games" label, so the button stays small and the results hero can sit
        // beside it instead of below it.
        function gameBackBtnHtml() {
            return `
                <button class="games-back games-back-ico" type="button" data-game-back
                        aria-label="All games" title="All games">
                    <span class="games-back-caret">‹</span>
                </button>`;
        }

        function gamePlayHeadHtml(game) {
            return `<div class="games-play-head">${gameBackBtnHtml()}</div>`;
        }

        // Point the shared top header bar at the current game (or back to "Games" on
        // the hub). This replaces the old duplicate in-page title.
        function setGamesMobileHeader(text) {
            try {
                const el = document.getElementById('mobile-page-title');
                if (el) el.textContent = text;
            } catch (_) {}
        }

        function gameGuessInputHtml(context, left) {
            const searchIco = (typeof icons === 'object' && icons.search) ? icons.search : '';
            return `
                <div class="games-guess">
                    <input id="game-guess-input" class="games-guess-input" type="text"
                           placeholder="Search for a movie…"
                           autocomplete="off" spellcheck="false" data-game-context="${context}">
                    <span class="games-guess-ico" aria-hidden="true">${searchIco}</span>
                    <div id="game-guess-results" class="games-guess-results"></div>
                </div>`;
        }

        // Add freshly-earned points to the cached user total so the hub reflects it
        // immediately (the server already banked them onto Users.game_points).
        function gamesBankLocalPoints(score) {
            if (!gamesTodayData) return;
            gamesTodayData.game_points = (Number(gamesTodayData.game_points) || 0) + (Number(score) || 0);
        }

        // ---- Post-game network comparison (LinkedIn-style) -----------------------
        // After a game finishes, show how YOU stacked up against your circle (people
        // you follow + people who follow you) on TODAY's puzzle. Data comes from the
        // get_game_day_leaderboard RPC (safe, follow-graph-scoped; see
        // games_day_leaderboard.sql). Ranked by the RPC (best result first).
        let _gamesCompareToken = 0;
        // Full day-leaderboard rows per game, cached so the "See full leaderboard"
        // modal can reuse them without a refetch.
        const gamesDayRows = { spottle: [], rank: [], poster: [], cast: [] };

        function gamesSeeFullBtnHtml(game) {
            return `<button class="games-seefull-btn" type="button" data-game-fulllb="${game}">See full leaderboard ›</button>`;
        }

        function gamesCompareSlotHtml(game) {
            return `
                <div id="games-compare" class="games-compare" data-compare-game="${game}">
                    <div class="games-compare-head">
                        <span class="games-compare-title">How your circle did today</span>
                    </div>
                    <div class="games-compare-loading">Loading results…</div>
                </div>`;
        }

        // Short relative time from an ISO timestamp ("just now" / "5m" / "2h" / "3d").
        function gamesRelativeTime(iso) {
            if (!iso) return '';
            const t = new Date(iso).getTime();
            if (!Number.isFinite(t)) return '';
            const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
            if (s < 45) return 'just now';
            if (s < 3600) return `${Math.floor(s / 60)}m ago`;
            if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
            return `${Math.floor(s / 86400)}d ago`;
        }

        // The primary stat shown for one player's result, per game.
        function gamesCompareStat(row, game) {
            const solved = !!row.solved;
            const attempts = Number(row.attempts) || 0;
            if (game === 'rank') {
                const total = (gamesTodayData?.games?.rank?.result || []).length || 6;
                const correct = Math.max(0, Math.min(total, Math.round((Number(row.score) || 0) / 2)));
                return { text: `${correct}/${total} correct`, ok: solved };
            }
            // spottle + poster: a solve is measured in guesses; a miss is a miss.
            if (!solved) return { text: 'Did not solve', ok: false };
            return { text: `${attempts} ${attempts === 1 ? 'guess' : 'guesses'}`, ok: true };
        }

        function gamesCompareRowHtml(row, rank, game) {
            const stat = gamesCompareStat(row, game);
            const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
            const rankBadge = medal
                ? `<span class="games-compare-medal">${medal}</span>`
                : `<span class="games-compare-rank">${rank}</span>`;
            const avatar = renderUserIconHtml(row.icon, 34);
            const name = escapeHtml(row.username || 'User');
            const when = gamesRelativeTime(row.completed_at);
            const pts = Math.max(0, Number(row.score) || 0);
            return `
                <div class="games-compare-row ${row.is_self ? 'is-self' : ''}">
                    ${rankBadge}
                    <span class="games-compare-avatar">${avatar}</span>
                    <span class="games-compare-who">
                        <span class="games-compare-name">${row.is_self ? 'You' : '@' + name}</span>
                        ${when ? `<span class="games-compare-when">${when}</span>` : ''}
                    </span>
                    <span class="games-compare-result">
                        <span class="games-compare-stat ${stat.ok ? 'is-ok' : 'is-miss'}">${escapeHtml(stat.text)}</span>
                        <span class="games-compare-pts">+${pts}</span>
                    </span>
                </div>`;
        }

        async function loadGameDayLeaderboard(game) {
            const token = ++_gamesCompareToken;
            const date = gamesTodayData?.date;
            const fill = (html) => {
                const box = document.getElementById('games-compare');
                if (box && box.getAttribute('data-compare-game') === game) box.innerHTML = html;
            };
            const headHtml = '<div class="games-compare-head"><span class="games-compare-title">How your circle did today</span></div>';
            if (!date || !supabaseClient) { fill(headHtml + '<div class="games-compare-empty">Results unavailable.</div>'); return; }
            try {
                const { data, error } = await supabaseClient.rpc('get_game_day_leaderboard', {
                    p_game: game, p_date: date,
                });
                if (token !== _gamesCompareToken) return;  // a newer open superseded this
                if (error) throw error;
                const rows = Array.isArray(data) ? data : [];
                gamesDayRows[game] = rows;
                if (!rows.length) { fill(headHtml + '<div class="games-compare-empty">No results yet.</div>' + gamesSeeFullBtnHtml(game)); return; }
                // Preview: just the top 3 — the full board opens in the modal.
                const list = rows.slice(0, 3).map((r, i) => gamesCompareRowHtml(r, i + 1, game)).join('');
                const soloNote = rows.length === 1
                    ? '<div class="games-compare-solo">You\'re the first in your circle to play — nudge friends to compare!</div>'
                    : '';
                fill(`${headHtml}<div class="games-compare-list">${list}</div>${soloNote}${gamesSeeFullBtnHtml(game)}`);
            } catch (e) {
                if (token !== _gamesCompareToken) return;
                fill(headHtml + '<div class="games-compare-empty">Couldn\'t load your circle\'s results.</div>');
            }
        }

        // ---- Full leaderboard modal + nudge --------------------------------------
        // The "See full leaderboard" button opens a pop-up with the WHOLE day board
        // plus a section to "nudge" people you follow who haven't played today's
        // puzzle (sends them a push + Activity-inbox reminder to play).
        let gamesNudgeCandidates = [];   // cached candidate rows for the open modal
        let gamesNudgeGame = null;       // which game the modal is showing
        let _gamesNudgeToken = 0;

        function openGameFullLeaderboard(game) {
            const ov = document.getElementById('games-lb-overlay');
            const body = document.getElementById('games-lb-body');
            const titleEl = document.getElementById('games-lb-title');
            if (!ov || !body) return;
            gamesNudgeGame = game;
            const meta = GAME_META[game] || {};
            const num = gamePuzzleNumber();
            if (titleEl) titleEl.textContent = num ? `${meta.title || 'Game'} #${num}` : `${meta.title || 'Game'} leaderboard`;
            body.innerHTML = renderGameFullLeaderboardBody(game);
            ov.style.display = 'flex';
            loadGameNudgeCandidates(game);
        }

        function closeGameFullLeaderboard() {
            const ov = document.getElementById('games-lb-overlay');
            if (ov) ov.style.display = 'none';
            gamesNudgeGame = null;
            gamesNudgeCandidates = [];
        }

        function renderGameFullLeaderboardBody(game) {
            const rows = gamesDayRows[game] || [];
            const list = rows.length
                ? rows.map((r, i) => gamesCompareRowHtml(r, i + 1, game)).join('')
                : '<div class="games-compare-empty">No results yet today.</div>';
            const searchIco = (typeof icons === 'object' && icons.search) ? icons.search : '';
            return `
                <div class="games-lb-full">
                    <div class="games-compare-list">${list}</div>
                </div>
                <div class="games-nudge">
                    <div class="games-nudge-divider"><span>Nudge people who haven't played yet 👉</span></div>
                    <div class="games-nudge-search">
                        <span class="games-nudge-search-ico" aria-hidden="true">${searchIco}</span>
                        <input id="games-nudge-search" class="games-nudge-search-input" type="text"
                               placeholder="Find connections to nudge" autocomplete="off" spellcheck="false">
                    </div>
                    <div id="games-nudge-list" class="games-nudge-list">
                        <div class="games-compare-loading">Loading connections…</div>
                    </div>
                </div>`;
        }

        // People the caller FOLLOWS who have NOT finished today's puzzle (server RPC
        // — safe, follow-scoped). Degrades gracefully if the RPC isn't deployed yet.
        async function loadGameNudgeCandidates(game) {
            const token = ++_gamesNudgeToken;
            const date = gamesTodayData?.date;
            const setList = (html) => { const el = document.getElementById('games-nudge-list'); if (el) el.innerHTML = html; };
            if (!supabaseClient || !date) { setList('<div class="games-compare-empty">Unavailable.</div>'); return; }
            let rows = [];
            try {
                const { data, error } = await supabaseClient.rpc('get_game_nudge_candidates', { p_game: game, p_date: date });
                if (error) throw error;
                rows = Array.isArray(data) ? data : [];
            } catch (_) {
                if (token !== _gamesNudgeToken) return;
                setList('<div class="games-compare-empty">Couldn\'t load connections.</div>');
                return;
            }
            if (token !== _gamesNudgeToken) return;
            gamesNudgeCandidates = rows;
            paintGameNudgeList('');
        }

        function paintGameNudgeList(query) {
            const el = document.getElementById('games-nudge-list');
            if (!el) return;
            const q = (typeof normalizeSearchText === 'function') ? normalizeSearchText(query || '') : String(query || '').toLowerCase();
            const rows = (gamesNudgeCandidates || []).filter((r) => {
                if (!q) return true;
                const n = (typeof normalizeSearchText === 'function') ? normalizeSearchText(r.username || '') : String(r.username || '').toLowerCase();
                return n.includes(q);
            });
            if (!rows.length) {
                el.innerHTML = `<div class="games-compare-empty">${(gamesNudgeCandidates || []).length ? 'No matches.' : 'Everyone you follow has played today! 🎉'}</div>`;
                return;
            }
            el.innerHTML = rows.map(gameNudgeRowHtml).join('');
        }

        function gameNudgeRowHtml(r) {
            const avatar = renderUserIconHtml(r.icon, 40);
            const name = escapeHtml(r.username || 'User');
            return `
                <div class="games-nudge-row">
                    <span class="games-nudge-avatar">${avatar}</span>
                    <span class="games-nudge-name">${name}</span>
                    <button class="games-nudge-btn" type="button" data-nudge-user="${r.user_id}">👉 Nudge</button>
                </div>`;
        }

        async function nudgeGamePlayer(userId, btn) {
            if (!userId || !gamesNudgeGame) return;
            if (btn && (btn.disabled || btn.classList.contains('is-done'))) return;
            if (btn) { btn.disabled = true; btn.classList.add('is-loading'); btn.textContent = 'Nudging…'; }
            try {
                const res = await gamesApi({ action: 'nudge_game', game: gamesNudgeGame, to_user_id: userId });
                if (!res?.ok) throw new Error(res?.message || 'Could not send nudge.');
                if (btn) { btn.classList.remove('is-loading'); btn.classList.add('is-done'); btn.textContent = '✓ Nudged'; }
                try { showToast('Nudge sent 👉', { durationMs: 1400 }); } catch (_) {}
            } catch (e) {
                if (btn) { btn.disabled = false; btn.classList.remove('is-loading'); btn.textContent = '👉 Nudge'; }
                showToast(String(e?.message || e), { level: 'warn' });
            }
        }

        function gameResultBanner(game, d) {
            const a = d.answer || {};
            const win = !!d.solved;
            const title = a.title
                ? `${escapeHtml(a.title)}${a.release_year ? ` (${a.release_year})` : ''}`
                : 'the movie';
            const msg = win
                ? `Solved in ${d.attempts} ${d.attempts === 1 ? 'guess' : 'guesses'}! It was <strong>${title}</strong>.`
                : (d.gave_up
                    ? `You gave up — it was <strong>${title}</strong>.`
                    : `Out of guesses — it was <strong>${title}</strong>.`);
            return `
                <div class="games-result-banner ${win ? 'is-win' : ''}">
                    <div>${msg}</div>
                </div>`;
        }

        // ---- Results page (LinkedIn-style) ---------------------------------------
        // After a finished game briefly shows the answer on the board, it auto-flips
        // to this dedicated results screen: the day's puzzle number + score, the
        // circle leaderboard, and the player's lifetime stats for that game. A
        // "Review your guesses" button flips back to the board.

        // Re-render whichever game is active (respects its finished-view state).
        function rerenderGame(game) {
            if (game === 'spottle') renderSpottle();
            else if (game === 'poster') renderPoster();
            else if (game === 'cast') renderCast();
            else if (game === 'rank') renderRank();
        }

        // Fresh-finish flow: the caller has already rendered the board (view='board')
        // so the user sees the revealed answer; after a beat, flip to the results page.
        function scheduleResultsTransition(game, delay) {
            if (gamesResultTimer) clearTimeout(gamesResultTimer);
            gamesResultTimer = setTimeout(() => {
                gamesResultTimer = null;
                if (gamesActiveGame !== game) return;             // navigated away
                const d = gamesTodayData?.games?.[game];
                if (!d || !d.done) return;
                gamesFinishedView[game] = 'results';
                rerenderGame(game);
                try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) {}
            }, delay || 1700);
        }

        function gameSeeResultsBtnHtml(game) {
            return `<button class="games-seeresults-btn" type="button" data-game-results="${game}">See results ›</button>`;
        }

        // # correct movies in the rank result (computed directly from the submitted
        // order vs the true order, so the hint penalty doesn't skew it like score/2).
        function rankCorrectCount(d) {
            const truth = Array.isArray(d?.result) ? d.result : [];
            const sub = Array.isArray(d?.submitted_order) ? d.submitted_order.map(Number) : [];
            let c = 0;
            truth.forEach((m, i) => { if (sub[i] != null && Number(sub[i]) === Number(m.tmdb_id)) c++; });
            return c;
        }

        // The headline describing how the player did, per game.
        function gameResultHeadline(game, d) {
            if (game === 'rank') {
                const total = (d.result || []).length || 6;
                if (d.gave_up) return `You gave up — ${rankCorrectCount(d)}/${total} in place.`;
                return d.solved
                    ? `Perfect order — ${total}/${total} correct!`
                    : `${rankCorrectCount(d)} of ${total} in the right spot.`;
            }
            const n = d.attempts || 0;
            if (d.solved) return `Solved in ${n} ${n === 1 ? 'guess' : 'guesses'}!`;
            if (d.gave_up) return 'You gave up on today\'s puzzle.';
            return 'Out of guesses today.';
        }

        function gameStatTileHtml(value, label) {
            return `
                <div class="games-stat">
                    <span class="games-stat-num">${value}</span>
                    <span class="games-stat-lbl">${escapeHtml(label)}</span>
                </div>`;
        }

        function gamesStatsLoadingHtml() {
            return Array.from({ length: 5 }, () =>
                '<div class="games-stat is-loading"><span class="games-stat-num">—</span><span class="games-stat-lbl">&nbsp;</span></div>').join('');
        }

        // Compute + fill the lifetime stats for a game from the caller's OWN
        // Game Results rows (RLS restricts the read to own rows). Streaks count
        // consecutive days PLAYED (finished), not just solved.
        let _gamesStatsToken = 0;
        async function loadGameLifetimeStats(game) {
            const token = ++_gamesStatsToken;
            const fill = (html) => {
                const box = document.getElementById('games-stats');
                if (box && box.getAttribute('data-stats-game') === game) box.innerHTML = html;
            };
            if (!supabaseClient) { fill(gameStatTileHtml('—', 'Played')); return; }
            let rows = [];
            try {
                const { data, error } = await supabaseClient
                    .from('Game Results')
                    .select('puzzle_date,solved,score,completed_at')
                    .eq('game', game);
                if (error) throw error;
                rows = (Array.isArray(data) ? data : []).filter((r) => r && r.completed_at);
            } catch (_) {
                if (token !== _gamesStatsToken) return;
                fill(`<div class="games-compare-empty">Couldn't load your stats.</div>`);
                return;
            }
            if (token !== _gamesStatsToken) return;

            const played = rows.length;
            const wins = rows.filter((r) => r.solved).length;
            const winPct = played ? Math.round((wins / played) * 100) : 0;
            const best = rows.reduce((m, r) => Math.max(m, Number(r.score) || 0), 0);

            // Distinct played days, ascending.
            const days = [...new Set(rows.map((r) => r.puzzle_date).filter(Boolean))].sort();
            const daySet = new Set(days);
            // Longest run of consecutive days.
            let longest = 0, run = 0, prev = null;
            for (const dstr of days) {
                if (prev && gameDayGap(prev, dstr) === 1) run++; else run = 1;
                if (run > longest) longest = run;
                prev = dstr;
            }
            // Current streak: consecutive days back from today's puzzle date.
            let current = 0, cursor = gamesTodayData?.date;
            while (cursor && daySet.has(cursor)) { current++; cursor = gamePrevDate(cursor); }

            fill([
                gameStatTileHtml(played.toLocaleString(), 'Played'),
                gameStatTileHtml(`${winPct}%`, 'Win rate'),
                gameStatTileHtml(best.toLocaleString(), 'Best score'),
                gameStatTileHtml(`${current}${current ? ' 🔥' : ''}`, 'Current streak'),
                gameStatTileHtml(longest.toLocaleString(), 'Longest streak'),
            ].join(''));
        }

        // ---- Unified closing frame (spottle / poster / cast) ---------------------
        // All three guess games end on ONE layout, so finishing any of them feels the
        // same: a COMPACT hero, the answer-movie card, then two tabs — Leaderboard
        // (circle results + lifetime stats) and Guesses (that game's own board). The
        // only thing that differs per game is the Guesses panel's contents, which is
        // inherent. Rank keeps its own single-column results page.

        // The answer movie, above the tabs. Tapping it opens the full Movie Spotlight
        // (details / cast / where to watch / log / add-to-list / recommend), so a
        // puzzle ends on something explorable rather than just a score. Every field
        // here already ships in the finished payload (gameAnswerLite in EdgeFunc), so
        // rendering the card costs no fetch.
        function gameAnswerCardHtml(game, d) {
            const a = d?.answer || null;
            const tmdb = Number(a?.tmdb_id);
            if (!a || !Number.isFinite(tmdb) || tmdb <= 0) return '';
            const url = gamesPosterUrl(a.poster_path, 'w185');
            const poster = url
                ? `<img class="games-answer-poster" src="${url}" alt="" draggable="false">`
                : '<span class="games-answer-poster is-missing"></span>';
            const year = a.release_year ? ` <span class="games-dim">(${a.release_year})</span>` : '';
            const dir = a.director ? `<span class="games-answer-dir">${escapeHtml(a.director)}</span>` : '';
            const imdb = Number(a.imdb_rating) > 0
                ? `<span class="games-answer-meta"><span class="games-answer-imdb">IMDb ${Math.round(Number(a.imdb_rating))}%</span></span>`
                : '';
            return `
                <div class="games-answer">
                    <div class="games-answer-head">Today's answer</div>
                    <button class="games-answer-card" type="button" data-game-answer="${game}">
                        ${poster}
                        <span class="games-answer-info">
                            <span class="games-answer-title">${escapeHtml(a.title || 'Unknown')}${year}</span>
                            ${dir}
                            ${imdb}
                        </span>
                        <span class="games-answer-caret" aria-hidden="true">›</span>
                    </button>
                </div>`;
        }

        // Warm the spotlight's details cache so tapping the answer card opens with no
        // spinner (same trick Home/Feed/Lists use on their posters).
        function prefetchGameAnswerDetails(d) {
            const tmdb = Number(d?.answer?.tmdb_id);
            if (!Number.isFinite(tmdb) || tmdb <= 0) return;
            try { if (typeof prefetchMovieDetails === 'function') prefetchMovieDetails(tmdb); } catch (_) {}
        }

        function openGameAnswerSpotlight(game) {
            const a = gamesTodayData?.games?.[game]?.answer;
            const tmdb = Number(a?.tmdb_id);
            if (!Number.isFinite(tmdb) || tmdb <= 0) return;
            if (typeof openMovieSpotlight !== 'function') return;
            openMovieSpotlight({
                tmdb_id: tmdb,
                title: a.title || '',
                year: a.release_year || null,
                release_year: a.release_year || null,
                poster_path: a.poster_path || null,
                genres: Array.isArray(a.genres) ? a.genres : [],
            });
        }

        // Rank's "Guesses" tab: two poster columns — the user's submitted order on the
        // left, the correct order on the right — with a line joining each movie's two
        // positions, so you can see at a glance which films moved and how far.
        // POSTERS ONLY (no titles); correctness reads off the poster ring + line color.
        //
        // The connectors are pure percentage geometry inside one `preserveAspectRatio
        // ="none"` SVG, so nothing has to be measured in JS and it stays correct at any
        // width. That only works while every row is exactly 100/n of the column height,
        // which is why the columns use per-cell padding instead of `gap` — a gap would
        // make row centers (i*(h+g) + h/2) / (n*h + (n-1)*g), not (i + 0.5)/n.
        function rankCompareHtml(d) {
            const truth = Array.isArray(d?.result) ? d.result : [];
            const n = truth.length;
            if (!n) return '<div class="games-empty">No ranking to compare.</div>';

            const byId = new Map(truth.map((m) => [Number(m.tmdb_id), m]));
            const truthIndex = new Map(truth.map((m, i) => [Number(m.tmdb_id), i]));
            const submitted = Array.isArray(d.submitted_order) ? d.submitted_order.map(Number) : [];
            // A give-up records no submitted order — fall back to the true order so the
            // panel still renders (every line then reads as "in place").
            const mine = submitted.length
                ? submitted.map((id) => byId.get(Number(id))).filter(Boolean)
                : truth.slice();

            // `rk` = the movie's LEFT row index, stamped on BOTH its posters and its
            // connector. It's the key that lets hovering/tapping either poster isolate
            // that one film's line (see setRankCompareFocus).
            const rkOf = new Map(mine.map((m, i) => [Number(m.tmdb_id), i]));
            const cell = (m, correct) => `
                <div class="rank-compare-cell" data-rk="${rkOf.get(Number(m.tmdb_id))}">
                    <img class="rank-compare-poster ${correct ? 'is-correct' : ''}"
                         src="${gamesPosterUrl(m.poster_path, 'w185')}" alt="" draggable="false">
                </div>`;

            const leftCol = mine.map((m, i) => cell(m, truthIndex.get(Number(m.tmdb_id)) === i)).join('');
            const rightCol = truth.map((m, i) => cell(m, Number(submitted[i]) === Number(m.tmdb_id))).join('');
            // Position numbers, in their own outer columns so the posters stay flush
            // against the connector gutter (see the CSS note).
            const numsCol = Array.from({ length: n }, (_, i) => `<span>${i + 1}</span>`).join('');

            const y = (i) => ((i + 0.5) * 100) / n;
            const paths = mine.map((m, i) => {
                const j = truthIndex.get(Number(m.tmdb_id));
                if (j == null) return '';
                const y1 = y(i).toFixed(3), y2 = y(j).toFixed(3);
                // Each connector runs HORIZONTALLY out of its left poster, then eases
                // through one S-curve into the right poster's row (down if the film
                // belongs lower, up if it belongs higher) and runs flat again. Both
                // control points sit at `mid`, so the curve leaves and arrives level
                // with each poster and the bend is centred on `mid`.
                //
                // ⚠️ `mid` is STAGGERED by the left row index. If every connector bent
                // at the same x, each swapped pair would cross at exactly x=50 and the
                // whole fan would pile through one mid-gutter point — the thing that
                // made them impossible to follow. Staggering moves those crossings
                // apart and lets each curve be traced back to its own poster.
                //
                // ⚠️ The bands (mid ∓ half) must OVERLAP between adjacent rows. Fully
                // separated bands make a swapped pair finish its descent before the
                // other starts climbing, so the two run COLLINEAR along the shared row
                // for a stretch instead of crossing — they'd look like one line.
                const t = n > 1 ? i / (n - 1) : 0.5;
                const mid = 24 + t * 52;                        // bend centre: 24 → 76
                const half = 16;
                const s = Math.max(3, mid - half).toFixed(2);   // leave the left poster
                const e = Math.min(97, mid + half).toFixed(2);  // settle into the right row
                const mx = mid.toFixed(2);   // NOT `m` — that's the movie in the outer map()
                const d3 = (y1 === y2)
                    ? `M 0,${y1} L 100,${y2}`                   // already in place: one straight run
                    : `M 0,${y1} L ${s},${y1} C ${mx},${y1} ${mx},${y2} ${e},${y2} L 100,${y2}`;
                // How far off the slot was: exact = green, one spot out = yellow,
                // further = red.
                const off = Math.abs(j - i);
                const cls = off === 0 ? 'is-exact' : (off === 1 ? 'is-near' : 'is-far');
                // Each connector is drawn TWICE: a wide page-colored "casing" first,
                // then the colored stroke. Because they're emitted per line and painted
                // in order, a later line's casing punches a clean gap through every
                // earlier line it crosses — so a crossing reads as one line passing OVER
                // the other instead of two identical strokes merging into an X. Without
                // this there is nothing at a crossing to tell the two lines apart.
                // vector-effect keeps both strokes even despite the non-uniform scale.
                return `<path class="rank-link-casing" data-rk="${i}" fill="none"
                              vector-effect="non-scaling-stroke" d="${d3}"></path>
                        <path class="rank-link ${cls}" data-rk="${i}" fill="none"
                              vector-effect="non-scaling-stroke" d="${d3}"></path>`;
            }).join('');

            return `
                <div class="rank-compare">
                    <div class="rank-compare-heads">
                        <span class="rank-compare-head rank-compare-head-l">Yours</span>
                        <span></span>
                        <span class="rank-compare-head rank-compare-head-r">Answer</span>
                    </div>
                    <div class="rank-compare-body">
                        <div class="rank-compare-nums">${numsCol}</div>
                        <div class="rank-compare-col">${leftCol}</div>
                        <div class="rank-compare-links">
                            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${paths}</svg>
                        </div>
                        <div class="rank-compare-col">${rightCol}</div>
                        <div class="rank-compare-nums">${numsCol}</div>
                    </div>
                </div>`;
        }

        // Isolate ONE film's connector: hover a poster on desktop, tap one on mobile.
        // Crossings are unavoidable (they're a permutation), and a casing only tells you
        // which line is on top — this is what actually lets you follow a single film
        // across a busy board. Pass null to clear.
        function setRankCompareFocus(rk) {
            const wrap = document.querySelector('#games-play .rank-compare');
            if (!wrap) return;
            const key = (rk === null || rk === undefined) ? null : String(rk);
            if (wrap.dataset.rkActive === (key || '')) return;   // no-op: same target
            wrap.dataset.rkActive = key || '';
            wrap.classList.toggle('is-focusing', !!key);
            wrap.querySelectorAll('[data-rk]').forEach((el) => {
                el.classList.toggle('is-active', !!key && el.getAttribute('data-rk') === key);
            });
        }

        // Bound once from initGamesPage. Mouse only — on touch, `pointerover` fires just
        // before `click`, so letting it through would focus the row and then the click
        // handler would immediately toggle it back off.
        function rankComparePointerOver(e) {
            if (e.pointerType === 'touch') return;
            const t = e.target;
            if (!t || !t.closest) return;
            if (!t.closest('#games-play .rank-compare')) { setRankCompareFocus(null); return; }
            const hit = t.closest('[data-rk]');
            setRankCompareFocus(hit ? hit.getAttribute('data-rk') : null);
        }

        // The board body for a finished game's "Guesses" tab.
        function gameGuessesBoardHtml(game, d) {
            if (game === 'spottle') return spottleBoardHtml(d, true);
            if (game === 'poster') return posterBoardHtml(d, true);
            if (game === 'cast') return castBoardHtml(d, true);
            if (game === 'rank') return rankCompareHtml(d);
            return '';
        }

        function gameResultsPanelHtml(game, d) {
            if (gamesResultsTab[game] === 'guesses') return gameGuessesBoardHtml(game, d);
            const meta = GAME_META[game] || {};
            return `
                ${gamesCompareSlotHtml(game)}
                <div class="games-stats-card">
                    <div class="games-stats-head">Your ${escapeHtml(meta.title || 'game')} stats</div>
                    <div id="games-stats" class="games-stats-grid" data-stats-game="${game}">${gamesStatsLoadingHtml()}</div>
                </div>`;
        }

        // Kick whatever the freshly-painted panel needs (async loads / animations).
        function afterGameResultsPanel(game) {
            if (gamesResultsTab[game] === 'guesses') {
                if (game === 'poster') applyPosterBlurTransition();
                return;
            }
            loadGameDayLeaderboard(game);
            loadGameLifetimeStats(game);
        }

        function setGameResultsTab(game, tab) {
            if (!(game in gamesResultsTab)) return;
            const d = gamesTodayData?.games?.[game];
            if (!d || !d.done) return;
            gamesResultsTab[game] = (tab === 'guesses') ? 'guesses' : 'leaderboard';
            const panel = document.getElementById('games-rpanel');
            if (!panel) { renderGameResults(game); return; }
            // Repaint ONLY the panel + the tab active states, so switching tabs doesn't
            // replay the frame's entrance animation or jump the scroll position.
            panel.innerHTML = gameResultsPanelHtml(game, d);
            document.querySelectorAll('#games-play [data-game-rtab]').forEach((b) => {
                b.classList.toggle('is-active', b.getAttribute('data-game-rtab') === gamesResultsTab[game]);
            });
            afterGameResultsPanel(game);
        }

        function renderGameResults(game) {
            const play = document.getElementById('games-play');
            const d = gamesTodayData?.games?.[game];
            if (!play) return;
            if (!d || !d.done) { rerenderGame(game); return; }   // shouldn't happen
            const meta = GAME_META[game] || {};
            const num = gamePuzzleNumber();
            const numLabel = num ? `${escapeHtml(meta.title || 'Game')} #${num}` : escapeHtml(meta.title || 'Game');
            const win = !!d.solved;
            const score = Math.max(0, Number(d.score) || 0);

            const tab = gamesResultsTab[game] === 'guesses' ? 'guesses' : 'leaderboard';
            // The Back control sits INSIDE the hero row (not on its own line above it),
            // so the whole screen shifts up by one row.
            play.innerHTML = `
                <div class="games-results games-results--${game}">
                    <div class="games-results-top">
                        ${gameBackBtnHtml()}
                        <div class="games-results-hero is-compact ${win ? 'is-win' : ''}">
                            <span class="games-results-ico">${gameIconHtml(game)}</span>
                            <span class="games-results-heroline">
                                <span class="games-results-num">${numLabel}</span>
                                <span class="games-results-headline">${escapeHtml(gameResultHeadline(game, d))}</span>
                            </span>
                            <span class="games-results-score">
                                <span class="games-results-score-num">+${score}</span>
                                <span class="games-results-score-lbl">pts</span>
                            </span>
                        </div>
                    </div>
                    ${gameAnswerCardHtml(game, d)}
                    <div class="games-rtabs" role="tablist">
                        <button class="games-rtab ${tab === 'leaderboard' ? 'is-active' : ''}" type="button" role="tab"
                                data-game-rtab="leaderboard" data-rtab-game="${game}">Leaderboard</button>
                        <button class="games-rtab ${tab === 'guesses' ? 'is-active' : ''}" type="button" role="tab"
                                data-game-rtab="guesses" data-rtab-game="${game}">${game === 'rank' ? 'Guess' : 'Guesses'}</button>
                    </div>
                    <div id="games-rpanel" class="games-rpanel">${gameResultsPanelHtml(game, d)}</div>
                </div>`;
            afterGameResultsPanel(game);
            prefetchGameAnswerDetails(d);
        }

        // ---- Spottle -------------------------------------------------------------
        // Small inline icons (not in the shared `icons` map).
        const SPOTTLE_LOCK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>';
        const SPOTTLE_FLAG_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>';
        // Per-play hint/give-up state, keyed by game. spottle + poster share the
        // guess-game hint (decade + genre, unlocks after N guesses); rank's hint
        // reveals the #1 film. Give Up is a two-tap confirm on all three.
        // How many progressive hint tiers the player has chosen to reveal, per game.
        // (Hints unlock by guess count server-side; this counts the ones they've opened.)
        const gameHintShown = { spottle: 0, poster: 0, cast: 0 };

        // Revealed hints PERSIST across leaving and reopening a game — you already paid
        // a point for them, so re-clicking to get them back is pure friction. Stored per
        // puzzle DAY, and a stored day that isn't today is ignored (and overwritten on
        // the next reveal), so the counts reset themselves when the puzzle rolls over.
        const GAME_HINTS_KEY = 'ct_game_hints_v1';

        function readGameHintCounts() {
            try {
                const day = gamesTodayData?.date || '';
                if (!day) return null;
                const obj = JSON.parse(localStorage.getItem(GAME_HINTS_KEY) || 'null');
                if (!obj || obj.date !== day || !obj.shown || typeof obj.shown !== 'object') return null;
                return obj.shown;
            } catch (_) { return null; }
        }

        function writeGameHintCounts() {
            try {
                const day = gamesTodayData?.date || '';
                if (!day) return;
                localStorage.setItem(GAME_HINTS_KEY, JSON.stringify({
                    date: day,
                    shown: {
                        spottle: Number(gameHintShown.spottle) || 0,
                        poster: Number(gameHintShown.poster) || 0,
                        cast: Number(gameHintShown.cast) || 0,
                    },
                }));
            } catch (_) {}
        }

        // Seed the in-memory counts for a fresh play surface. `gameHintsHtml` clamps to
        // the number of currently-unlocked tiers, so a stale/high stored count is safe.
        function restoreGameHintCounts() {
            const saved = readGameHintCounts() || {};
            gameHintShown.spottle = Number(saved.spottle) || 0;
            gameHintShown.poster = Number(saved.poster) || 0;
            gameHintShown.cast = Number(saved.cast) || 0;
        }
        const gameGiveUpArmed = { spottle: false, poster: false, rank: false, cast: false };  // two-tap arm
        let gameGiveUpTimer = null;
        // (Rank has no hint — ordering the films IS the puzzle — so it has no hint state.)

        // "Christopher Nolan" -> "C. Nolan"; single-word names pass through.
        function spottleAbbrevName(name) {
            const n = String(name || '').trim();
            if (!n || n === '—') return '—';
            const parts = n.split(/\s+/);
            if (parts.length === 1) return parts[0];
            return `${parts[0][0].toUpperCase()}. ${parts.slice(1).join(' ')}`;
        }

        function spottleTileHtml(label, fb) {
            const st = (fb && fb.status) || 'gray';
            const dir = fb && fb.dir === 'up' ? '↑' : (fb && fb.dir === 'down' ? '↓' : '');
            const val = (fb && fb.value != null) ? String(fb.value) : '—';
            return `
                <div class="spottle-tile is-${st}">
                    <span class="spottle-tile-label">${escapeHtml(label)}</span>
                    <span class="spottle-tile-val">${escapeHtml(val)}${dir ? `<span class="spottle-dir">${dir}</span>` : ''}</span>
                </div>`;
        }

        // The tall STUDIO tile — shows the production company's LOGO if we have one,
        // else its name. Green when the studio matches the answer.
        function spottleStudioTileHtml(fb) {
            const st = (fb && fb.status) || 'gray';
            const logo = fb && fb.logo_path ? gamesPosterUrl(fb.logo_path, 'w185') : '';
            const val = (fb && fb.value != null) ? String(fb.value) : '—';
            const inner = logo
                ? `<img class="spottle-studio-logo" src="${logo}" alt="${escapeHtml(val)}">`
                : `<span class="spottle-tile-val spottle-studio-name">${escapeHtml(val)}</span>`;
            return `
                <div class="spottle-tile spottle-tile-studio is-${st}">
                    <span class="spottle-tile-label">Studio</span>
                    ${inner}
                </div>`;
        }

        // One person avatar (abbreviated name below), green when shared with answer.
        function spottlePersonTileHtml(p) {
            const person = p || {};
            const name = person.name || '—';
            const url = person.profile_path ? gamesPosterUrl(person.profile_path, 'w185') : '';
            const initials = String(name || '?').trim().split(/\s+/).map((w) => w[0] || '').slice(0, 2).join('').toUpperCase() || '?';
            const face = url
                ? `<img class="spottle-person-img" src="${url}" alt="">`
                : `<div class="spottle-person-img spottle-person-noimg">${escapeHtml(initials)}</div>`;
            return `
                <div class="spottle-person is-${person.status || 'gray'}">
                    ${face}
                    <span class="spottle-person-name">${escapeHtml(spottleAbbrevName(name))}</span>
                </div>`;
        }

        // A labeled people group (label above one or more avatars).
        function spottlePersonGroupHtml(label, tilesHtml, extraClass) {
            return `
                <div class="spottle-person-group ${extraClass || ''}">
                    <div class="spottle-person-label">${escapeHtml(label)}</div>
                    <div class="spottle-person-row">${tilesHtml}</div>
                </div>`;
        }

        function spottleRowHtml(g) {
            if (!g || g.gave_up) return '';   // skip the give-up sentinel
            const fb = g.feedback || {};
            const genres = Array.isArray(fb.genres) ? fb.genres : [];
            const genrePills = genres.map((gp) =>
                `<span class="spottle-genre-pill ${gp && gp.match ? 'is-match' : ''}">${escapeHtml(gp.name || '')}</span>`).join('');
            const tiles = [
                spottleTileHtml('Year', fb.year),
                spottleTileHtml('Gross', fb.box_office),
                spottleStudioTileHtml(fb.studio),
                spottleTileHtml('Rated', fb.mpa),
                spottleTileHtml('Score', fb.score),
            ].join('');
            const director = spottlePersonGroupHtml('Director', spottlePersonTileHtml(fb.director));
            const lead = fb.lead ? spottlePersonGroupHtml('Lead Actor', spottlePersonTileHtml(fb.lead)) : '';
            const support = (Array.isArray(fb.supporting) && fb.supporting.length)
                ? spottlePersonGroupHtml('Supporting Cast', fb.supporting.map(spottlePersonTileHtml).join(''), 'spottle-person-group-support')
                : '';
            const poster = g.poster_path
                ? `<img class="spottle-guess-poster" src="${gamesPosterUrl(g.poster_path, 'w185')}" alt="">`
                : '<div class="spottle-guess-poster spottle-guess-poster-empty"></div>';
            const answerTag = g.revealed
                ? '<span class="spottle-answer-tag">Answer</span>' : '';
            return `
                <div class="spottle-guess-card ${g.correct ? 'is-correct' : ''} ${g.revealed ? 'is-revealed' : ''}">
                    <div class="spottle-guess-title">${escapeHtml(g.title || '')}${answerTag}</div>
                    ${genrePills ? `<div class="spottle-genres">${genrePills}</div>` : ''}
                    <div class="spottle-guess-top">
                        ${poster}
                        <div class="spottle-tiles">${tiles}</div>
                    </div>
                    <div class="spottle-people">${director}${lead}${support}</div>
                </div>`;
        }

        // The Hint button for a guess game, reflecting the PROGRESSIVE hint state:
        //  - more unlocked tiers left to open  → active "Hint" / "Next hint"
        //  - next tier still locked            → disabled "Hint in N"
        //  - every tier already revealed       → disabled "No more hints"
        function gameHintButtonHtml(game, d) {
            const hints = Array.isArray(d.hints) ? d.hints : [];
            const attempts = d.attempts || 0;
            const unlocked = hints.filter((h) => h && !h.locked && h.text);
            const shown = Math.min(gameHintShown[game] || 0, unlocked.length);
            if (shown < unlocked.length) {
                const label = shown === 0 ? 'Hint' : 'Next hint';
                return `<button class="spottle-topbtn spottle-hint-btn" type="button" data-game-hint="${game}">${SPOTTLE_LOCK_ICON} ${label}</button>`;
            }
            const nextLocked = hints.find((h) => h && h.locked);
            if (nextLocked) {
                const remaining = Math.max(1, Number(nextLocked.after) - attempts);
                return `<button class="spottle-topbtn spottle-hint-btn is-locked" type="button" disabled>${SPOTTLE_LOCK_ICON} Hint in ${remaining}</button>`;
            }
            return `<button class="spottle-topbtn spottle-hint-btn is-locked" type="button" disabled>${SPOTTLE_LOCK_ICON} No more hints</button>`;
        }

        // The stack of hints the player has revealed so far (progressive tiers, each
        // more revealing than the last). Empty until they open the first one.
        function gameHintsHtml(game, d) {
            const hints = Array.isArray(d.hints) ? d.hints : [];
            const unlocked = hints.filter((h) => h && !h.locked && h.text);
            const shown = Math.min(gameHintShown[game] || 0, unlocked.length);
            if (!shown) return '';
            const items = unlocked.slice(0, shown).map((h, i) =>
                `<div class="spottle-hint-reveal">💡 <span class="spottle-hint-tier">Hint ${i + 1}${h.label ? ` · ${escapeHtml(h.label)}` : ''}</span> <strong>${escapeHtml(h.text)}</strong></div>`).join('');
            return `<div class="spottle-hints">${items}</div>`;
        }

        // Top control bar for a guess game (spottle + poster):
        // Hint (lock) · Guess N of M · Give Up (flag). Shared markup + CSS.
        function guessTopbarHtml(game, d) {
            const max = d.max_guesses || (game === 'spottle' ? 10 : 6);   // poster + cast = 6
            const attempts = d.attempts || 0;
            const cur = Math.min(max, attempts + 1);
            const armed = !!gameGiveUpArmed[game];
            return `
                <div class="spottle-topbar">
                    ${gameHintButtonHtml(game, d)}
                    <div class="spottle-counter">Guess <span class="spottle-counter-num">${cur}</span> of ${max}</div>
                    <button class="spottle-topbtn spottle-giveup-btn ${armed ? 'is-armed' : ''}" type="button" data-game-giveup="${game}">${SPOTTLE_FLAG_ICON} ${armed ? 'Confirm' : 'Give Up'}</button>
                </div>`;
        }

        // Re-render whichever guess game is active.
        function rerenderGuessGame(game) {
            if (game === 'spottle') renderSpottle();
            else if (game === 'poster') renderPoster();
            else if (game === 'cast') renderCast();
        }

        // The guess-board body, WITHOUT the page head. Shared by three callers: the
        // live play surface, the post-finish reveal flash, and the "Guesses" tab of
        // the unified closing frame. `inResults` drops the reveal banner + the
        // "See results" button — those belong to the flash, not the tab.
        function spottleBoardHtml(d, inResults) {
            const realGuesses = (d.guesses || []).filter((g) => g && !g.gave_up);
            // Newest guess on top, right under the search bar.
            const rows = realGuesses.slice().reverse().map(spottleRowHtml).join('');
            const board = rows || '<div class="games-empty">Make your first guess to see how close you are.</div>';
            const head = d.done
                ? (inResults ? '' : `${gameResultBanner('spottle', d)}${gameSeeResultsBtnHtml('spottle')}`)
                : `${guessTopbarHtml('spottle', d)}${gameHintsHtml('spottle', d)}${gameGuessInputHtml('spottle')}`;
            return `${head}<div class="spottle-board">${board}</div>`;
        }

        function renderSpottle() {
            const play = document.getElementById('games-play');
            const d = gamesTodayData?.games?.spottle;
            if (!play) return;
            if (!d) { play.innerHTML = gamePlayHeadHtml('spottle') + '<div class="games-error">No puzzle available today.</div>'; return; }
            if (d.done && gamesFinishedView.spottle === 'results') { renderGameResults('spottle'); return; }
            play.innerHTML = `
                ${gamePlayHeadHtml('spottle')}
                ${spottleBoardHtml(d, false)}`;
        }

        // Reveal the NEXT progressive hint tier for a guess game (spottle/poster).
        // Each tap opens one more (already-unlocked) hint; no-op once all are shown.
        function gameToggleHint(game) {
            const d = gamesTodayData?.games?.[game];
            if (!d) return;
            const hints = Array.isArray(d.hints) ? d.hints : [];
            const unlocked = hints.filter((h) => h && !h.locked && h.text);
            const cur = gameHintShown[game] || 0;
            if (cur >= unlocked.length) return;   // nothing new to reveal
            gameHintShown[game] = cur + 1;
            writeGameHintCounts();   // survive leaving + reopening the game
            rerenderGuessGame(game);
        }

        // Two-tap Give Up for a guess game: first tap arms + relabels "Confirm",
        // second gives up (server marks it done/unsolved + reveals the answer).
        async function gameGiveUp(game) {
            const d = gamesTodayData?.games?.[game];
            if (!d || d.done) return;
            if (!gameGiveUpArmed[game]) {
                gameGiveUpArmed[game] = true;
                rerenderGuessGame(game);
                if (gameGiveUpTimer) clearTimeout(gameGiveUpTimer);
                gameGiveUpTimer = setTimeout(() => { gameGiveUpArmed[game] = false; rerenderGuessGame(game); }, 3500);
                return;
            }
            if (gameGiveUpTimer) clearTimeout(gameGiveUpTimer);
            gameGiveUpArmed[game] = false;
            try {
                const res = await gamesApi({ action: 'game_giveup', game });
                if (!res?.ok) { showToast(res?.message || 'Could not give up.', { level: 'warn' }); return; }
                d.attempts = res.attempts;
                d.solved = false;
                d.done = true;
                d.gave_up = true;
                d.score = 0;
                if (Array.isArray(res.guesses)) d.guesses = res.guesses;
                if (res.answer) d.answer = res.answer;
                if (game === 'poster' && res.blur != null) d.blur = res.blur;
                if (game === 'cast' && Array.isArray(res.cast_revealed)) d.cast_revealed = res.cast_revealed;
                gamesFinishedView[game] = 'board';   // flash the revealed answer first
                rerenderGuessGame(game);
                scheduleResultsTransition(game, 1700);
            } catch (e) {
                showToast(String(e?.message || e), { level: 'error' });
            }
        }

        // ---- Poster --------------------------------------------------------------
        // ⚠️ MUST MIRROR `GAME_POSTER_BLUR_STEPS` in EdgeFunc — the server indexes this
        // same list by `attempts` to decide how blurred the live poster is. It's only
        // duplicated here to reconstruct the blur level a FINISHED game was solved at,
        // which the server has no reason to send back (`d.blur` is 0 once done).
        const GAME_POSTER_BLUR_STEPS = [50, 33, 24, 17, 12, 7];

        // The results thumbnail's width as a fraction of the full board poster
        // (.poster-frame.is-thumb 92px / .poster-frame 216px in styles.css). Blur radius
        // is an absolute px length, so it does NOT shrink with the image — replaying a
        // 50px blur on a 92px thumb is uniform grey mush. Scaling by the same factor
        // reproduces how blurred the poster LOOKED, which is the point of showing it.
        // Keep in sync if either width changes.
        const POSTER_THUMB_BLUR_SCALE = 92 / 216;

        // How blurred the poster still was at the moment the player named it: they made
        // guess N with `attempts` sitting at N-1, so that guess saw steps[N-1].
        function gamePosterSolveBlur(d) {
            const steps = GAME_POSTER_BLUR_STEPS;
            if (!steps.length) return 0;
            const i = Math.max(0, Math.min((Number(d?.attempts) || 1) - 1, steps.length - 1));
            return Math.round(steps[i] * POSTER_THUMB_BLUR_SCALE * 10) / 10;
        }

        // Board body only (no page head) — see spottleBoardHtml for why this is split
        // out. The blur→sharp transition can't run until the markup is in the DOM, so
        // the target is stashed here and applied by applyPosterBlurTransition().
        function posterBoardHtml(d, inResults) {
            const url = gamesPosterUrl(d.poster_path, 'w500');
            const max = d.max_guesses || 6;
            const attempts = d.attempts || 0;
            const left = Math.max(0, max - attempts);
            const guesses = Array.isArray(d.guesses) ? d.guesses : [];

            // In the results Guesses tab the poster is a small thumbnail. If the player
            // SOLVED it, freeze it at the blur it still had when they named it — that's
            // the record of how well they did, where a clean poster says nothing. If
            // they did NOT solve it, blur records nothing worth keeping, so just reveal
            // the poster fully. Everywhere else it's the live board: render at the
            // previously-shown blur, then transition to the new (lower) one a frame
            // later so the CSS `filter` transition runs.
            const targetBlur = inResults
                ? (d.solved ? gamePosterSolveBlur(d) : 0)
                : (d.done ? 0 : Number(d.blur) || 0);
            let startBlur = targetBlur;
            if (!inResults) {
                // Only the live board drives the sharpen animation — the results tab
                // must not touch this state or it would desync the board's next render.
                startBlur = (posterPrevBlur == null) ? targetBlur : posterPrevBlur;
                posterPrevBlur = targetBlur;
                posterPendingBlur = (url && startBlur !== targetBlur) ? targetBlur : null;
            }

            // One pip per guess slot — filled red as guesses are spent (green if solved).
            const pips = Array.from({ length: max }, (_, i) => {
                const g = guesses[i];
                const cls = g ? (g.correct ? 'is-correct' : 'is-used') : (i < attempts ? 'is-used' : '');
                return `<span class="poster-pip ${cls}"></span>`;
            }).join('');

            // Wrong/right guess feed, newest on top. On the LIVE board the newest row
            // animates in (+ shakes if wrong) — but in the results Guesses tab nothing
            // is "new", so re-opening a finished game doesn't replay the shake on every
            // single view.
            const rows = guesses.slice().reverse().map((g, ri) => {
                const correct = !!g.correct;
                const isNew = !inResults && ri === 0;
                return `
                    <div class="poster-guess-row ${correct ? 'is-correct' : 'is-wrong'} ${isNew ? 'is-new' : ''}">
                        <span class="poster-guess-mark">${correct ? '✓' : '✕'}</span>
                        <span class="poster-guess-name">${escapeHtml(g.title || '')}</span>
                        <span class="poster-guess-tag">${correct ? 'Correct' : 'Not it'}</span>
                    </div>`;
            }).join('');

            const topbar = d.done ? '' : `${guessTopbarHtml('poster', d)}${gameHintsHtml('poster', d)}`;
            const footer = d.done
                ? (inResults ? '' : `${gameResultBanner('poster', d)}${gameSeeResultsBtnHtml('poster')}`)
                : gameGuessInputHtml('poster', left);
            return `
                ${topbar}
                <div class="poster-play">
                    <div class="poster-progress">
                        <div class="poster-pips">${pips}</div>
                        ${d.done ? '' : `<div class="poster-left-label">${left} ${left === 1 ? 'guess' : 'guesses'} left</div>`}
                    </div>
                    <div class="poster-stage">
                        <div class="poster-frame ${(d.done && !inResults) ? 'is-revealed' : ''} ${inResults ? 'is-thumb' : ''}">
                            ${url
                                ? `<img class="poster-img" style="filter: blur(${startBlur}px);" src="${url}" alt="Mystery movie poster">`
                                : '<div class="poster-missing">No image</div>'}
                        </div>
                    </div>
                    ${footer}
                    ${rows ? `<div class="poster-guesses">${rows}</div>` : ''}
                </div>`;
        }

        // Kick the blur→sharp CSS transition one frame after the poster board lands in
        // the DOM. No-op unless posterBoardHtml staged a change.
        function applyPosterBlurTransition() {
            if (posterPendingBlur == null) return;
            const target = posterPendingBlur;
            posterPendingBlur = null;
            requestAnimationFrame(() => {
                const img = document.querySelector('#games-play .poster-img');
                if (img) img.style.filter = `blur(${target}px)`;
            });
        }

        function renderPoster() {
            const play = document.getElementById('games-play');
            const d = gamesTodayData?.games?.poster;
            if (!play) return;
            if (!d) { play.innerHTML = gamePlayHeadHtml('poster') + '<div class="games-error">No puzzle available today.</div>'; return; }
            if (d.done && gamesFinishedView.poster === 'results') { renderGameResults('poster'); return; }
            play.innerHTML = `
                ${gamePlayHeadHtml('poster')}
                ${posterBoardHtml(d, false)}`;
            applyPosterBlurTransition();
        }

        // ---- Cast ("Starring") ---------------------------------------------------
        // Guess the daily film from its cast. The puzzle always uses EXACTLY the film's
        // top 6 billed actors; the server reveals them progressively by billing role
        // (least-billed first, the LEAD always 6th/last — so the final guess knows the
        // lead), one more per wrong guess. Only the revealed slice is client-readable
        // (all six once done).
        const CAST_SILHOUETTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';

        function castFaceHtml(c, isNew, isUnseen) {
            const url = gamesPosterUrl(c && c.profile_path, 'w185');
            const name = escapeHtml((c && c.name) || '');
            const img = url
                ? `<img class="cast-face-img" src="${url}" alt="" draggable="false">`
                : `<div class="cast-face-img cast-face-missing">${CAST_SILHOUETTE}</div>`;
            return `
                <div class="cast-face ${isNew ? 'is-new' : ''} ${isUnseen ? 'is-unseen' : ''}">
                    <div class="cast-face-photo">${img}</div>
                    <div class="cast-face-name">${name}</div>
                </div>`;
        }

        // How many of the six faces the player had actually SEEN when they made their
        // last guess. The server reveals `attempts + 1` faces (gameCastReveal), so
        // before guess N they were looking at N — i.e. `attempts` faces at the moment
        // of the guess that ended the game. Used to dim the ones they never needed.
        function castSeenCount(d, total) {
            const n = Math.max(1, Number(d?.attempts) || 1);
            return Math.max(1, Math.min(total, n));
        }

        // Board body only (no page head) — see spottleBoardHtml.
        function castBoardHtml(d, inResults) {
            const max = d.max_guesses || 6;
            const attempts = d.attempts || 0;
            const left = Math.max(0, max - attempts);
            const guesses = Array.isArray(d.guesses) ? d.guesses : [];
            const revealed = Array.isArray(d.cast_revealed) ? d.cast_revealed : [];

            // One pip per guess slot — filled red as guesses are spent (green if solved).
            const pips = Array.from({ length: max }, (_, i) => {
                const g = guesses[i];
                const cls = g ? (g.correct ? 'is-correct' : 'is-used') : (i < attempts ? 'is-used' : '');
                return `<span class="poster-pip ${cls}"></span>`;
            }).join('');

            // The server prepends each newly-revealed face at index 0, so it glows in
            // on a fresh guess. Once done the whole cast shows (no glow).
            //
            // In the results Guesses tab, DIM the faces the player never needed. The
            // reveal walks UP the billing order (least-billed first, lead last), and
            // the done payload is the full list in billing order — so the ones they
            // actually saw are the LAST `castSeenCount` entries, and anything before
            // that index was never on screen while they were guessing.
            const unseenBefore = (inResults && d.done)
                ? revealed.length - castSeenCount(d, revealed.length)
                : 0;
            const faces = revealed.length
                ? revealed.map((c, i) => castFaceHtml(
                    c,
                    !d.done && attempts > 0 && i === 0,
                    i < unseenBefore,
                  )).join('')
                : '<div class="games-empty">No cast available for this film.</div>';

            // Wrong/right guess feed, newest on top. On the LIVE board the newest row
            // animates in (+ shakes if wrong) — but in the results Guesses tab nothing
            // is "new", so re-opening a finished game doesn't replay the shake on every
            // single view.
            const rows = guesses.slice().reverse().map((g, ri) => {
                const correct = !!g.correct;
                const isNew = !inResults && ri === 0;
                return `
                    <div class="poster-guess-row ${correct ? 'is-correct' : 'is-wrong'} ${isNew ? 'is-new' : ''}">
                        <span class="poster-guess-mark">${correct ? '✓' : '✕'}</span>
                        <span class="poster-guess-name">${escapeHtml(g.title || '')}</span>
                        <span class="poster-guess-tag">${correct ? 'Correct' : 'Not it'}</span>
                    </div>`;
            }).join('');

            const topbar = d.done ? '' : `${guessTopbarHtml('cast', d)}${gameHintsHtml('cast', d)}`;
            // When done, the answer reveal (banner + "See results") takes the search bar's
            // spot at the TOP of the column; when still playing, the guess box lives there
            // (floated to the top on mobile via .cast-play > .games-guess { order:-1 }).
            const doneReveal = (d.done && !inResults) ? `${gameResultBanner('cast', d)}${gameSeeResultsBtnHtml('cast')}` : '';
            const guessBox = d.done ? '' : gameGuessInputHtml('cast', left);
            return `
                ${topbar}
                <div class="cast-play">
                    ${doneReveal}
                    <div class="poster-progress">
                        <div class="poster-pips">${pips}</div>
                        ${d.done ? '' : `<div class="poster-left-label">${left} ${left === 1 ? 'guess' : 'guesses'} left</div>`}
                    </div>
                    <div class="cast-reveal-head">${d.done ? 'The cast' : 'Who stars in this film?'}</div>
                    <div class="cast-grid">${faces}</div>
                    ${guessBox}
                    ${rows ? `<div class="poster-guesses">${rows}</div>` : ''}
                </div>`;
        }

        function renderCast() {
            const play = document.getElementById('games-play');
            const d = gamesTodayData?.games?.cast;
            if (!play) return;
            if (!d) { play.innerHTML = gamePlayHeadHtml('cast') + '<div class="games-error">No puzzle available today.</div>'; return; }
            if (d.done && gamesFinishedView.cast === 'results') { renderGameResults('cast'); return; }
            play.innerHTML = `
                ${gamePlayHeadHtml('cast')}
                ${castBoardHtml(d, false)}`;
        }

        // ---- Rank ----------------------------------------------------------------
        function rankRowsHtml(movies) {
            const byId = new Map(movies.map((m) => [Number(m.tmdb_id), m]));
            return rankOrderIds.map((id, idx) => {
                const m = byId.get(Number(id));
                if (!m) return '';
                return `
                    <div class="rank-row" data-rank-id="${id}">
                        <span class="rank-moves">
                            <button class="rank-move" type="button" data-rank-move="up" data-rank-id="${id}" ${idx === 0 ? 'disabled' : ''} aria-label="Move up">▲</button>
                            <button class="rank-move" type="button" data-rank-move="down" data-rank-id="${id}" ${idx === rankOrderIds.length - 1 ? 'disabled' : ''} aria-label="Move down">▼</button>
                        </span>
                        <span class="rank-num">${idx + 1}</span>
                        <img class="rank-poster" src="${gamesPosterUrl(m.poster_path, 'w185')}" alt="" draggable="false">
                        <span class="rank-title">${escapeHtml(m.title || '')}${m.release_year ? ` <span class="games-dim">(${m.release_year})</span>` : ''}</span>
                        <span class="rank-grip" aria-hidden="true">⠿</span>
                    </div>`;
            }).join('');
        }

        // Repaint the rank list from rankOrderIds + (re)bind drag handlers.
        function paintRankList() {
            const d = gamesTodayData?.games?.rank;
            const list = document.getElementById('rank-list');
            if (!list || !d) return;
            list.innerHTML = rankRowsHtml(d.movies || []);
            list.querySelectorAll('.rank-row').forEach((row) => {
                row.addEventListener('pointerdown', onRankPointerDown);
            });
        }

        function renderRank() {
            const play = document.getElementById('games-play');
            const d = gamesTodayData?.games?.rank;
            if (!play) return;
            if (!d) { play.innerHTML = gamePlayHeadHtml('rank') + '<div class="games-error">No puzzle available today.</div>'; return; }
            if (d.done) { renderRankResult(d); return; }
            // Initialize the order ONCE per play (openGame clears it) so a re-render
            // triggered by the give-up control preserves the user's arrangement.
            if (!rankOrderIds.length) rankOrderIds = (d.movies || []).map((m) => Number(m.tmdb_id));
            const armed = !!gameGiveUpArmed.rank;
            // Rank has NO hint — ordering the films IS the puzzle — so the top bar is
            // just the counter + Give Up.
            play.innerHTML = `
                ${gamePlayHeadHtml('rank')}
                <div class="spottle-topbar">
                    <div class="spottle-counter">Order ${(d.movies || []).length || 6} films</div>
                    <button class="spottle-topbtn spottle-giveup-btn ${armed ? 'is-armed' : ''}" type="button" data-rank-giveup>${SPOTTLE_FLAG_ICON} ${armed ? 'Confirm' : 'Give Up'}</button>
                </div>
                <div class="rank-hint">Drag the cards (or use ▲▼) to order them from <strong>highest</strong> to <strong>lowest</strong> IMDb rating.</div>
                <div id="rank-list" class="rank-list"></div>
                <button class="rank-submit" type="button" data-rank-submit>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    Submit ranking
                </button>`;
            paintRankList();
        }

        function rankMove(id, dir) {
            const i = rankOrderIds.indexOf(Number(id));
            if (i < 0) return;
            const j = dir === 'up' ? i - 1 : i + 1;
            if (j < 0 || j >= rankOrderIds.length) return;
            const tmp = rankOrderIds[i];
            rankOrderIds[i] = rankOrderIds[j];
            rankOrderIds[j] = tmp;
            paintRankList();
        }

        // Rank give-up: two-tap confirm, then end the game unsolved and reveal the
        // correct order (still counts as Done on the hub).
        async function rankGiveUp() {
            const d = gamesTodayData?.games?.rank;
            if (!d || d.done) return;
            if (!gameGiveUpArmed.rank) {
                gameGiveUpArmed.rank = true;
                renderRank();
                if (gameGiveUpTimer) clearTimeout(gameGiveUpTimer);
                gameGiveUpTimer = setTimeout(() => { gameGiveUpArmed.rank = false; renderRank(); }, 3500);
                return;
            }
            if (gameGiveUpTimer) clearTimeout(gameGiveUpTimer);
            gameGiveUpArmed.rank = false;
            try {
                const res = await gamesApi({ action: 'game_giveup', game: 'rank' });
                if (!res?.ok) { showToast(res?.message || 'Could not give up.', { level: 'warn' }); return; }
                d.done = true; d.solved = false; d.gave_up = true; d.score = 0;
                d.result = res.true_order || d.result || [];
                d.submitted_order = null;
                gamesFinishedView.rank = 'board';   // flash the revealed order first
                renderRankResult(d);
                scheduleResultsTransition('rank', 1600);
            } catch (e) {
                showToast(String(e?.message || e), { level: 'error' });
            }
        }

        // Pointer-based drag reorder (works for touch + mouse). Instead of physically
        // re-inserting the row in the DOM mid-drag (which thrashes layout + made the
        // desktop mouse jumpy), we DON'T touch the DOM until release: the dragged row
        // follows the pointer 1:1 via transform, and the OTHER rows slide up/down (with
        // a short CSS transition) to open the destination gap. On release we commit the
        // new index into rankOrderIds and repaint once.
        function onRankPointerDown(e) {
            if (e.target && e.target.closest && e.target.closest('.rank-move')) return; // let ▲▼ work
            if (e.button != null && e.button !== 0) return; // primary button / touch only
            // On TOUCH, only the grip handle starts a drag — a touch anywhere else on the
            // row must be allowed to scroll the page (6 cards can overflow the viewport).
            // Desktop mouse can still grab anywhere (no page-scroll conflict).
            if (e.pointerType === 'touch' && !(e.target && e.target.closest && e.target.closest('.rank-grip'))) return;
            const list = document.getElementById('rank-list');
            if (!list) return;
            const row = e.currentTarget;
            const rows = Array.from(list.querySelectorAll('.rank-row'));
            const n = rows.length;
            const fromIndex = rows.indexOf(row);
            if (n < 2 || fromIndex < 0) return;
            e.preventDefault();

            // Snapshot geometry ONCE up front (rows don't move in the DOM during the
            // drag, so these rects stay valid). `step` = top-to-top distance between
            // adjacent rows = row height + gap.
            const rects = rows.map((r) => r.getBoundingClientRect());
            const dragH = rects[fromIndex].height;
            const step = (fromIndex < n - 1)
                ? (rects[fromIndex + 1].top - rects[fromIndex].top)
                : (rects[fromIndex].top - rects[fromIndex - 1].top);
            const startY = e.clientY;
            let toIndex = fromIndex;

            row.classList.add('rank-dragging');
            row.style.zIndex = '10';
            rows.forEach((r) => { if (r !== row) r.style.transition = 'transform 0.16s ease'; });

            const layout = (dy) => {
                // How many slots has the dragged row's centre crossed?
                const moved = step > 0 ? Math.round(dy / step) : 0;
                toIndex = Math.max(0, Math.min(n - 1, fromIndex + moved));
                // Slide the passed-over rows to open the gap at `toIndex`.
                rows.forEach((r, i) => {
                    if (r === row) return;
                    let shift = 0;
                    if (toIndex > fromIndex && i > fromIndex && i <= toIndex) shift = -step;
                    else if (toIndex < fromIndex && i >= toIndex && i < fromIndex) shift = step;
                    r.style.transform = shift ? `translateY(${shift}px)` : '';
                });
                // Live 1..N numbering preview matching the pending order.
                const order = rows.map((_, i) => i).filter((i) => i !== fromIndex);
                order.splice(toIndex, 0, fromIndex);
                order.forEach((origIdx, pos) => {
                    const num = rows[origIdx].querySelector('.rank-num');
                    if (num) num.textContent = String(pos + 1);
                });
            };

            // Listen on DOCUMENT so the drag keeps tracking even when the pointer
            // moves off the row (a desktop mouse easily outruns the element).
            const onMove = (ev) => {
                ev.preventDefault();
                row.style.transform = `translateY(${ev.clientY - startY}px)`;
                layout(ev.clientY - startY);
            };
            const onUp = () => {
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                document.removeEventListener('pointercancel', onUp);
                if (toIndex !== fromIndex) {
                    const movedId = rankOrderIds.splice(fromIndex, 1)[0];
                    rankOrderIds.splice(toIndex, 0, movedId);
                }
                rows.forEach((r) => { r.style.transition = ''; r.style.transform = ''; r.style.zIndex = ''; });
                row.classList.remove('rank-dragging');
                paintRankList(); // clean re-render (resets transforms + ▲▼ disabled states)
            };
            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
            document.addEventListener('pointercancel', onUp);
        }

        function renderRankResult(d) {
            const play = document.getElementById('games-play');
            if (!play) return;
            if (gamesFinishedView.rank === 'results') { renderGameResults('rank'); return; }
            const truth = d.result || [];
            const submitted = Array.isArray(d.submitted_order) ? d.submitted_order.map(Number) : [];
            const rows = truth.map((m, i) => {
                const correct = submitted[i] != null && Number(submitted[i]) === Number(m.tmdb_id);
                return `
                    <div class="rank-result-row ${correct ? 'is-correct' : 'is-wrong'}">
                        <span class="rank-num">${i + 1}</span>
                        <img class="rank-poster" src="${gamesPosterUrl(m.poster_path, 'w185')}" alt="">
                        <span class="rank-title">${escapeHtml(m.title || '')}${m.release_year ? ` <span class="games-dim">(${m.release_year})</span>` : ''}</span>
                        <span class="rank-imdb">${Number(m.imdb_rating) > 0 ? (Number(m.imdb_rating) / 10).toFixed(1) : '—'}</span>
                    </div>`;
            }).join('');
            const banner = d.solved
                ? 'Perfect — you nailed the exact order!'
                : (d.gave_up ? 'You gave up.' : 'Nice try!');
            play.innerHTML = `
                ${gamePlayHeadHtml('rank')}
                <div class="games-result-banner ${d.solved ? 'is-win' : ''}">
                    <div>${banner}</div>
                </div>
                ${gameSeeResultsBtnHtml('rank')}
                <div class="rank-result-list">${rows}</div>`;
        }

        async function submitRank() {
            const btn = document.querySelector('[data-rank-submit]');
            const btnHtml = btn ? btn.innerHTML : '';
            if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }
            try {
                const res = await gamesApi({ action: 'game_submit', order: rankOrderIds });
                if (!res?.ok) { showToast(res?.message || 'Could not submit ranking.', { level: 'warn' }); if (btn) { btn.disabled = false; btn.innerHTML = btnHtml; } return; }
                const d = gamesTodayData.games.rank;
                d.done = true; d.solved = !!res.solved; d.score = res.score || 0;
                d.result = res.true_order || [];
                d.submitted_order = res.submitted_order || rankOrderIds.slice();
                gamesBankLocalPoints(res.score);
                // Animate the user's cards sliding from THEIR order into the correct
                // order (so they can compare their guess to the answer) before the
                // final result view snaps in.
                gamesFinishedView.rank = 'board';   // show the scored board first
                await animateRankToTrueOrder(d);
                renderRankResult(d);
                scheduleResultsTransition('rank', 1400);
            } catch (e) {
                showToast(String(e?.message || e), { level: 'error' });
                if (btn) { btn.disabled = false; btn.innerHTML = btnHtml; }
            }
        }

        // FLIP-animate the live rank cards (currently in the user's submitted order)
        // into the correct high→low order. Resolves once the slide settles, after
        // which submitRank renders the scored result view. No-ops (resolves at once)
        // if the list isn't on screen. Only used on a fresh submit — a re-opened
        // finished game or a give-up renders the result directly.
        function animateRankToTrueOrder(d) {
            return new Promise((resolve) => {
                const list = document.getElementById('rank-list');
                const truth = Array.isArray(d.result) ? d.result : [];
                const rows = list ? Array.from(list.querySelectorAll('.rank-row')) : [];
                if (!list || truth.length < 2 || rows.length < 2) { resolve(); return; }
                const byId = new Map(rows.map((r) => [Number(r.getAttribute('data-rank-id')), r]));
                // FIRST — record each row's current top before reordering.
                const firstTop = new Map(rows.map((r) => [r, r.getBoundingClientRect().top]));
                // Lock the list height so appending rows can't reflow the page.
                list.style.height = `${list.getBoundingClientRect().height}px`;
                list.classList.add('rank-revealing');   // dims grips/▲▼, blocks pointer
                // Reorder the DOM into the true order + relabel the rank numbers.
                const ordered = [];
                truth.forEach((m) => {
                    const r = byId.get(Number(m.tmdb_id));
                    if (r) { list.appendChild(r); ordered.push(r); }
                });
                ordered.forEach((r, i) => {
                    const num = r.querySelector('.rank-num');
                    if (num) num.textContent = String(i + 1);
                });
                // INVERT — jump each row back to its old position with no transition.
                ordered.forEach((r) => {
                    const dy = (firstTop.get(r) || 0) - r.getBoundingClientRect().top;
                    r.style.transition = 'none';
                    r.style.transform = `translateY(${dy}px)`;
                });
                // PLAY — release to identity with a staggered ease.
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    ordered.forEach((r, i) => {
                        r.style.transition = `transform 0.6s cubic-bezier(0.22,1,0.36,1) ${i * 0.06}s`;
                        r.style.transform = '';
                    });
                }));
                const total = 600 + (ordered.length - 1) * 60 + 160;
                setTimeout(() => { try { list.style.height = ''; } catch (_) {} resolve(); }, total);
            });
        }

        // ---- Guessing (spottle + poster) -----------------------------------------
        // The guess box searches ALL of TMDB — exactly like the Home page search —
        // so you can guess ANY movie, not just a cached set. It hits the same public
        // `search` action (callSwiftApiPublic) and the server-side game_guess builds
        // the guessed movie's attributes live for movies it doesn't already cache.
        let _gameSearchToken = 0;

        function gamesDelegatedInput(e) {
            // Nudge-search box inside the full-leaderboard modal (filters locally).
            const nudgeInp = e.target && e.target.closest ? e.target.closest('#games-nudge-search') : null;
            if (nudgeInp) { paintGameNudgeList(nudgeInp.value || ''); return; }
            const inp = e.target && e.target.closest ? e.target.closest('#game-guess-input') : null;
            if (!inp) return;
            initSearchClearButton('game-guess-input', () => {
                const b = document.getElementById('game-guess-results');
                if (b) b.innerHTML = '';
            });
            const q = inp.value.trim();
            if (gameSearchTimer) clearTimeout(gameSearchTimer);
            const box = document.getElementById('game-guess-results');
            if (q.length < 1) { if (box) box.innerHTML = ''; return; }
            // Network search — debounce like the Home search box.
            gameSearchTimer = setTimeout(() => gameSearchRun(q), 300);
        }

        async function gameSearchRun(q) {
            const box = document.getElementById('game-guess-results');
            if (!box) return;
            const token = ++_gameSearchToken;
            box.innerHTML = '<div class="games-guess-empty">Searching…</div>';
            let results = [];
            try {
                const data = await callSwiftApiPublic({ action: 'search', query: q, page: 1, limit: 25 });
                results = Array.isArray(data?.results) ? data.results : [];
            } catch (_) { results = []; }
            if (token !== _gameSearchToken) return;   // superseded by a newer keystroke
            const inp = document.getElementById('game-guess-input');
            if (!inp || !inp.value.trim()) { box.innerHTML = ''; return; }  // box cleared while awaiting
            if (!results.length) { box.innerHTML = '<div class="games-guess-empty">No matches</div>'; return; }
            // The POSTER game must NOT show poster thumbnails in the guess list — that
            // would reveal the poster you're trying to name — so hide them there.
            const showPoster = gamesActiveGame !== 'poster';
            // Filmle (spottle) hides the release year in the guess list — the year is one
            // of the clues you're meant to deduce.
            const showYear = gamesActiveGame !== 'spottle';
            box.innerHTML = results.slice(0, 25).map((m) => {
                const year = m.year || m.release_year || '';
                return `
                <button class="games-guess-item ${showPoster ? '' : 'no-poster'}" type="button" data-game-guess-pick data-tmdb-id="${m.tmdb_id}">
                    ${showPoster ? `<img src="${gamesPosterUrl(m.poster_path, 'w92')}" alt="">` : ''}
                    <span>${escapeHtml(m.title || '')}${(showYear && year) ? ` <span class="games-dim">(${year})</span>` : ''}</span>
                </button>`;
            }).join('');
        }

        async function submitGuess(tmdbId) {
            const game = gamesActiveGame;
            if (game !== 'spottle' && game !== 'poster' && game !== 'cast') return;
            const box = document.getElementById('game-guess-results');
            const inp = document.getElementById('game-guess-input');
            if (box) box.innerHTML = '';
            if (inp) inp.value = '';
            try {
                const res = await gamesApi({
                    action: 'game_guess', game, tmdb_id: Number(tmdbId),
                    hint_used: (gameHintShown[game] || 0) > 0,
                });
                if (!res?.ok) { showToast(res?.message || 'Could not submit guess.', { level: 'warn' }); return; }
                const d = gamesTodayData.games[game];
                const wasDone = d.done;
                d.guesses = Array.isArray(res.guesses) ? res.guesses : (d.guesses || []);
                d.attempts = res.attempts;
                d.solved = !!res.solved;
                d.done = !!res.done;
                d.score = res.score || 0;
                if (d.done && !wasDone) gamesBankLocalPoints(res.score);
                if (res.answer) d.answer = res.answer;
                if (game === 'poster' && res.blur != null) d.blur = res.blur;
                if (game === 'cast' && Array.isArray(res.cast_revealed)) d.cast_revealed = res.cast_revealed;
                if (Array.isArray(res.hints)) d.hints = res.hints;
                gameGiveUpArmed[game] = false;   // a new guess disarms Give Up
                if (gameGiveUpTimer) { clearTimeout(gameGiveUpTimer); gameGiveUpTimer = null; }
                // On a fresh finish, flash the revealed-answer board then auto-flip to
                // the results page (LinkedIn-style).
                if (d.done && !wasDone) gamesFinishedView[game] = 'board';
                rerenderGuessGame(game);
                if (d.done && !wasDone) {
                    if (d.solved) { try { showToast('Solved! 🎉', { durationMs: 1400 }); } catch (_) {} }
                    scheduleResultsTransition(game, 1700);
                }
            } catch (e) {
                showToast(String(e?.message || e), { level: 'error' });
            }
        }

        // ---- Delegated clicks ----------------------------------------------------
        function gamesDelegatedClick(e) {
            const t = e.target;
            if (!t || !t.closest) return;
            const openBtn = t.closest('[data-game-open]');
            if (openBtn) { e.preventDefault(); openGame(openBtn.getAttribute('data-game-open')); return; }
            if (t.closest('[data-game-back]')) { e.preventDefault(); closeGame(); return; }
            // (The old "‹ Review your guesses" button is gone — every game now reaches
            // its board through the results frame's Guesses tab.)
            const resultsBtn = t.closest('[data-game-results]');
            if (resultsBtn) {
                e.preventDefault();
                const g = resultsBtn.getAttribute('data-game-results');
                if (gamesResultTimer) { clearTimeout(gamesResultTimer); gamesResultTimer = null; }
                gamesFinishedView[g] = 'results';
                rerenderGame(g);
                try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) {}
                return;
            }
            // Rank compare: tap a poster to isolate its connector, tap again (or tap
            // off) to clear. This is the touch equivalent of the desktop hover.
            const rkCell = t.closest('#games-play .rank-compare [data-rk]');
            if (rkCell) {
                e.preventDefault();
                const wrap = rkCell.closest('.rank-compare');
                const cur = wrap ? (wrap.dataset.rkActive || '') : '';
                const next = rkCell.getAttribute('data-rk');
                setRankCompareFocus(cur === next ? null : next);
                return;
            }
            // Any other click clears an active isolate. Cheap no-op when none is set,
            // and deliberately does NOT return — other handlers still get the event.
            setRankCompareFocus(null);

            const rtabBtn = t.closest('[data-game-rtab]');
            if (rtabBtn) {
                e.preventDefault();
                setGameResultsTab(rtabBtn.getAttribute('data-rtab-game'), rtabBtn.getAttribute('data-game-rtab'));
                return;
            }
            const answerBtn = t.closest('[data-game-answer]');
            if (answerBtn) { e.preventDefault(); openGameAnswerSpotlight(answerBtn.getAttribute('data-game-answer')); return; }
            const fullLbBtn = t.closest('[data-game-fulllb]');
            if (fullLbBtn) { e.preventDefault(); openGameFullLeaderboard(fullLbBtn.getAttribute('data-game-fulllb')); return; }
            const nudgeBtn = t.closest('[data-nudge-user]');
            if (nudgeBtn) { e.preventDefault(); nudgeGamePlayer(nudgeBtn.getAttribute('data-nudge-user'), nudgeBtn); return; }
            const pick = t.closest('[data-game-guess-pick]');
            if (pick) { e.preventDefault(); submitGuess(pick.getAttribute('data-tmdb-id')); return; }
            const hintBtn = t.closest('[data-game-hint]');
            if (hintBtn) { e.preventDefault(); gameToggleHint(hintBtn.getAttribute('data-game-hint')); return; }
            const giveupBtn = t.closest('[data-game-giveup]');
            if (giveupBtn) { e.preventDefault(); gameGiveUp(giveupBtn.getAttribute('data-game-giveup')); return; }
            if (t.closest('[data-rank-giveup]')) { e.preventDefault(); rankGiveUp(); return; }
            const mv = t.closest('[data-rank-move]');
            if (mv) { e.preventDefault(); rankMove(mv.getAttribute('data-rank-id'), mv.getAttribute('data-rank-move')); return; }
            if (t.closest('[data-rank-submit]')) { e.preventDefault(); submitRank(); return; }
        }
