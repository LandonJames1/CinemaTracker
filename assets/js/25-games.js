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
        // ALL THREE games have a Hint + a two-tap Give Up (points account for both;
        // giving up still records a finished/"Done" result). spottle+poster share the
        // guess-game hint (decade+genre, unlocks after N guesses); rank's hint reveals
        // the #1 film (game_hint) and costs points on submit.
        //
        // Cheat-resistance: the daily answers are NEVER client-readable. Progress +
        // guess-checking go through the authenticated edge actions (game_today /
        // game_guess / game_submit / game_giveup / game_hint), which strip
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

        const GAME_META = {
            spottle: { title: 'Filmle', tag: 'Guess the movie', icon: 'search',
                       desc: 'Guess the daily film — each guess shows how close you are.' },
            rank:    { title: 'Rank It', tag: 'Sort by IMDb', icon: 'sort',
                       desc: 'Put 4 movies in order by their IMDb rating.' },
            poster:  { title: 'Poster Blur', tag: 'Name the poster', icon: 'film',
                       desc: 'A blurred poster sharpens with every wrong guess.' },
        };
        const GAME_ORDER = ['spottle', 'rank', 'poster'];

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
            const cards = GAME_ORDER.map((g) => {
                const d = games[g];
                const meta = GAME_META[g] || {};
                const status = gameStatusFor(g, d);
                const disabled = status === 'unavailable';
                const ico = (typeof icons === 'object' && icons[meta.icon]) ? icons[meta.icon] : (icons?.gamepad || '');
                return `
                    <button class="games-card status-${status}" type="button"
                            ${disabled ? 'disabled' : `data-game-open="${g}"`}>
                        <span class="games-card-ico">${ico}</span>
                        <span class="games-card-body">
                            <span class="games-card-title">${escapeHtml(meta.title || '')}</span>
                            <span class="games-card-tag">${escapeHtml(meta.tag || '')}</span>
                            <span class="games-card-desc">${escapeHtml(meta.desc || '')}</span>
                        </span>
                        <span class="games-card-foot">
                            <span class="games-status-pill">${gameStatusLabel(status)}</span>
                        </span>
                    </button>`;
            }).join('');
            const total = Number(gamesTodayData?.game_points) || 0;
            hub.innerHTML = `
                <div class="games-points-total">
                    <span class="games-points-total-ico">🏆</span>
                    <span class="games-points-total-num">${total.toLocaleString()}</span>
                    <span class="games-points-total-lbl">total points</span>
                </div>
                <div class="games-grid">${cards}</div>`;
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
            // Reset the shared hint/give-up state for a fresh play surface.
            gameHintRevealed.spottle = false; gameHintRevealed.poster = false;
            gameGiveUpArmed.spottle = false; gameGiveUpArmed.poster = false; gameGiveUpArmed.rank = false;
            if (gameGiveUpTimer) { clearTimeout(gameGiveUpTimer); gameGiveUpTimer = null; }
            if (game === 'spottle') renderSpottle();
            else if (game === 'rank') { rankHintUsed = false; rankHintId = null; rankOrderIds = []; renderRank(); }
            else if (game === 'poster') { posterPrevBlur = null; renderPoster(); }
            try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch (_) {}
        }

        function closeGame() {
            gamesActiveGame = null;
            const hub = document.getElementById('games-hub');
            const play = document.getElementById('games-play');
            if (play) { play.hidden = true; play.innerHTML = ''; }
            if (hub) hub.hidden = false;
            setGamesMobileHeader('Games');   // restore the hub header
            renderGamesHub();   // reflect any freshly-finished game on the cards
        }

        function gamePlayHeadHtml(game) {
            // No in-page game title — the top header bar shows the game name (set in
            // openGame/closeGame via setGamesMobileHeader). Just the Back control here.
            return `
                <div class="games-play-head">
                    <button class="games-back" type="button" data-game-back>
                        <span class="games-back-caret">‹</span> All games
                    </button>
                </div>`;
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
                if (!rows.length) { fill(headHtml + '<div class="games-compare-empty">No results yet.</div>'); return; }
                const list = rows.map((r, i) => gamesCompareRowHtml(r, i + 1, game)).join('');
                const soloNote = rows.length === 1
                    ? '<div class="games-compare-solo">You\'re the first in your circle to play — follow more friends to compare!</div>'
                    : '';
                fill(`${headHtml}<div class="games-compare-list">${list}</div>${soloNote}`);
            } catch (e) {
                if (token !== _gamesCompareToken) return;
                fill(headHtml + '<div class="games-compare-empty">Couldn\'t load your circle\'s results.</div>');
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

        // ---- Spottle -------------------------------------------------------------
        // Small inline icons (not in the shared `icons` map).
        const SPOTTLE_LOCK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>';
        const SPOTTLE_FLAG_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>';
        // Per-play hint/give-up state, keyed by game. spottle + poster share the
        // guess-game hint (decade + genre, unlocks after N guesses); rank's hint
        // reveals the #1 film. Give Up is a two-tap confirm on all three.
        const gameHintRevealed = { spottle: false, poster: false };   // Hint text shown?
        const gameGiveUpArmed = { spottle: false, poster: false, rank: false };  // two-tap arm
        let gameGiveUpTimer = null;
        let rankHintUsed = false;            // rank: was the #1 hint revealed this play?
        let rankHintId = null;               // rank: tmdb_id of the hinted #1 film

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
            return `
                <div class="spottle-guess-card ${g.correct ? 'is-correct' : ''}">
                    <div class="spottle-guess-title">${escapeHtml(g.title || '')}</div>
                    ${genrePills ? `<div class="spottle-genres">${genrePills}</div>` : ''}
                    <div class="spottle-guess-top">
                        ${poster}
                        <div class="spottle-tiles">${tiles}</div>
                    </div>
                    <div class="spottle-people">${director}${lead}${support}</div>
                </div>`;
        }

        // Top control bar for a guess game (spottle + poster):
        // Hint (lock) · Guess N of M · Give Up (flag). Shared markup + CSS.
        function guessTopbarHtml(game, d) {
            const max = d.max_guesses || (game === 'spottle' ? 10 : 6);
            const attempts = d.attempts || 0;
            const cur = Math.min(max, attempts + 1);
            const hintAfter = (d.hint_after != null) ? d.hint_after : 3;
            const unlocked = attempts >= hintAfter;
            const remaining = Math.max(0, hintAfter - attempts);
            const armed = !!gameGiveUpArmed[game];
            const hintBtn = unlocked
                ? `<button class="spottle-topbtn spottle-hint-btn" type="button" data-game-hint="${game}">${SPOTTLE_LOCK_ICON} Hint</button>`
                : `<button class="spottle-topbtn spottle-hint-btn is-locked" type="button" disabled>${SPOTTLE_LOCK_ICON} Hint in ${remaining}</button>`;
            return `
                <div class="spottle-topbar">
                    ${hintBtn}
                    <div class="spottle-counter">Guess <span class="spottle-counter-num">${cur}</span> of ${max}</div>
                    <button class="spottle-topbtn spottle-giveup-btn ${armed ? 'is-armed' : ''}" type="button" data-game-giveup="${game}">${SPOTTLE_FLAG_ICON} ${armed ? 'Confirm' : 'Give Up'}</button>
                </div>`;
        }

        // Re-render whichever guess game is active.
        function rerenderGuessGame(game) {
            if (game === 'spottle') renderSpottle();
            else if (game === 'poster') renderPoster();
        }

        function renderSpottle() {
            const play = document.getElementById('games-play');
            const d = gamesTodayData?.games?.spottle;
            if (!play) return;
            if (!d) { play.innerHTML = gamePlayHeadHtml('spottle') + '<div class="games-error">No puzzle available today.</div>'; return; }
            const realGuesses = (d.guesses || []).filter((g) => g && !g.gave_up);
            // Newest guess on top, right under the search bar.
            const rows = realGuesses.slice().reverse().map(spottleRowHtml).join('');
            const hintText = d.hint && gameHintRevealed.spottle
                ? `<div class="spottle-hint-reveal">💡 Hint: <strong>${escapeHtml(d.hint)}</strong></div>` : '';
            const board = rows || '<div class="games-empty">Make your first guess to see how close you are.</div>';
            const footer = d.done
                ? gameResultBanner('spottle', d)
                : `${guessTopbarHtml('spottle', d)}${hintText}${gameGuessInputHtml('spottle')}`;
            play.innerHTML = `
                ${gamePlayHeadHtml('spottle')}
                ${footer}
                ${d.done ? gamesCompareSlotHtml('spottle') : ''}
                <div class="spottle-board">${board}</div>`;
            if (d.done) loadGameDayLeaderboard('spottle');
        }

        // Reveal the (already-delivered) hint text for a guess game (spottle/poster).
        function gameToggleHint(game) {
            const d = gamesTodayData?.games?.[game];
            if (!d || !d.hint) return;
            gameHintRevealed[game] = true;
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
                rerenderGuessGame(game);
            } catch (e) {
                showToast(String(e?.message || e), { level: 'error' });
            }
        }

        // ---- Poster --------------------------------------------------------------
        function renderPoster() {
            const play = document.getElementById('games-play');
            const d = gamesTodayData?.games?.poster;
            if (!play) return;
            if (!d) { play.innerHTML = gamePlayHeadHtml('poster') + '<div class="games-error">No puzzle available today.</div>'; return; }
            const url = gamesPosterUrl(d.poster_path, 'w500');
            const max = d.max_guesses || 6;
            const attempts = d.attempts || 0;
            const left = Math.max(0, max - attempts);
            const guesses = Array.isArray(d.guesses) ? d.guesses : [];

            // Sharpen ANIMATION: render at the previously-shown blur, then transition to
            // the new (lower) blur one frame later so the CSS `filter` transition runs.
            const targetBlur = d.done ? 0 : Number(d.blur) || 0;
            const startBlur = (posterPrevBlur == null) ? targetBlur : posterPrevBlur;
            posterPrevBlur = targetBlur;

            // One pip per guess slot — filled red as guesses are spent (green if solved).
            const pips = Array.from({ length: max }, (_, i) => {
                const g = guesses[i];
                const cls = g ? (g.correct ? 'is-correct' : 'is-used') : (i < attempts ? 'is-used' : '');
                return `<span class="poster-pip ${cls}"></span>`;
            }).join('');

            // Wrong/right guess feed, newest on top; the newest animates in (+ shakes if wrong).
            const rows = guesses.slice().reverse().map((g, ri) => {
                const correct = !!g.correct;
                const isNew = ri === 0;
                return `
                    <div class="poster-guess-row ${correct ? 'is-correct' : 'is-wrong'} ${isNew ? 'is-new' : ''}">
                        <span class="poster-guess-mark">${correct ? '✓' : '✕'}</span>
                        <span class="poster-guess-name">${escapeHtml(g.title || '')}</span>
                        <span class="poster-guess-tag">${correct ? 'Correct' : 'Not it'}</span>
                    </div>`;
            }).join('');

            const hintText = d.hint && gameHintRevealed.poster
                ? `<div class="spottle-hint-reveal">💡 Hint: <strong>${escapeHtml(d.hint)}</strong></div>` : '';
            const topbar = d.done ? '' : `${guessTopbarHtml('poster', d)}${hintText}`;
            const footer = d.done ? gameResultBanner('poster', d) : gameGuessInputHtml('poster', left);
            play.innerHTML = `
                ${gamePlayHeadHtml('poster')}
                ${topbar}
                <div class="poster-play">
                    <div class="poster-progress">
                        <div class="poster-pips">${pips}</div>
                        ${d.done ? '' : `<div class="poster-left-label">${left} ${left === 1 ? 'guess' : 'guesses'} left</div>`}
                    </div>
                    <div class="poster-stage">
                        <div class="poster-frame ${d.done ? 'is-revealed' : ''}">
                            ${url
                                ? `<img class="poster-img" style="filter: blur(${startBlur}px);" src="${url}" alt="Mystery movie poster">
                                   ${d.done ? '' : '<div class="poster-scrim"></div>'}`
                                : '<div class="poster-missing">No image</div>'}
                        </div>
                    </div>
                    ${footer}
                    ${d.done ? gamesCompareSlotHtml('poster') : ''}
                    ${rows ? `<div class="poster-guesses">${rows}</div>` : ''}
                </div>`;

            if (d.done) loadGameDayLeaderboard('poster');
            if (url && startBlur !== targetBlur) {
                requestAnimationFrame(() => {
                    const img = play.querySelector('.poster-img');
                    if (img) img.style.filter = `blur(${targetBlur}px)`;
                });
            }
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
            // Initialize the order ONCE per play (openGame clears it) so re-renders
            // triggered by the hint / give-up controls preserve the user's arrangement.
            if (!rankOrderIds.length) rankOrderIds = (d.movies || []).map((m) => Number(m.tmdb_id));
            const armed = !!gameGiveUpArmed.rank;
            const hintBtn = rankHintUsed
                ? `<button class="spottle-topbtn spottle-hint-btn is-locked" type="button" disabled>${SPOTTLE_LOCK_ICON} Hint used</button>`
                : `<button class="spottle-topbtn spottle-hint-btn" type="button" data-rank-hint>${SPOTTLE_LOCK_ICON} Hint</button>`;
            const hintBanner = rankHintUsed
                ? '<div class="spottle-hint-reveal">💡 Hint: the top-rated film was placed at #1.</div>' : '';
            play.innerHTML = `
                ${gamePlayHeadHtml('rank')}
                <div class="spottle-topbar">
                    ${hintBtn}
                    <div class="spottle-counter">Order ${(d.movies || []).length || 6} films</div>
                    <button class="spottle-topbtn spottle-giveup-btn ${armed ? 'is-armed' : ''}" type="button" data-rank-giveup>${SPOTTLE_FLAG_ICON} ${armed ? 'Confirm' : 'Give Up'}</button>
                </div>
                ${hintBanner}
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

        // Rank hint: reveal the single highest-rated film and place it at #1 (the
        // user can still rearrange). Costs points on submit (server penalty).
        async function rankRevealHint() {
            const d = gamesTodayData?.games?.rank;
            if (!d || d.done || rankHintUsed) return;
            try {
                const res = await gamesApi({ action: 'game_hint', game: 'rank' });
                if (!res?.ok || !res.tmdb_id) { showToast(res?.message || 'No hint available.', { level: 'warn' }); return; }
                rankHintUsed = true;
                rankHintId = Number(res.tmdb_id);
                const i = rankOrderIds.indexOf(rankHintId);
                if (i > 0) { rankOrderIds.splice(i, 1); rankOrderIds.unshift(rankHintId); }
                renderRank();   // rankOrderIds is preserved; re-render shows the banner + disabled button
                try { showToast('The top-rated film is now #1.', { durationMs: 1800 }); } catch (_) {}
            } catch (e) {
                showToast(String(e?.message || e), { level: 'error' });
            }
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
                renderRankResult(d);
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
                ${gamesCompareSlotHtml('rank')}
                <div class="rank-result-list">${rows}</div>`;
            loadGameDayLeaderboard('rank');
        }

        async function submitRank() {
            const btn = document.querySelector('[data-rank-submit]');
            const btnHtml = btn ? btn.innerHTML : '';
            if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }
            try {
                const res = await gamesApi({ action: 'game_submit', order: rankOrderIds, hint_used: rankHintUsed });
                if (!res?.ok) { showToast(res?.message || 'Could not submit ranking.', { level: 'warn' }); if (btn) { btn.disabled = false; btn.innerHTML = btnHtml; } return; }
                const d = gamesTodayData.games.rank;
                d.done = true; d.solved = !!res.solved; d.score = res.score || 0;
                d.result = res.true_order || [];
                d.submitted_order = res.submitted_order || rankOrderIds.slice();
                gamesBankLocalPoints(res.score);
                // Animate the user's cards sliding from THEIR order into the correct
                // order (so they can compare their guess to the answer) before the
                // final result view snaps in.
                await animateRankToTrueOrder(d);
                renderRankResult(d);
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
            const inp = e.target && e.target.closest ? e.target.closest('#game-guess-input') : null;
            if (!inp) return;
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
                const data = await callSwiftApiPublic({ action: 'search', query: q, page: 1, limit: 8 });
                results = Array.isArray(data?.results) ? data.results : [];
            } catch (_) { results = []; }
            if (token !== _gameSearchToken) return;   // superseded by a newer keystroke
            const inp = document.getElementById('game-guess-input');
            if (!inp || !inp.value.trim()) { box.innerHTML = ''; return; }  // box cleared while awaiting
            if (!results.length) { box.innerHTML = '<div class="games-guess-empty">No matches</div>'; return; }
            // The POSTER game must NOT show poster thumbnails in the guess list — that
            // would reveal the poster you're trying to name — so hide them there.
            const showPoster = gamesActiveGame !== 'poster';
            box.innerHTML = results.slice(0, 8).map((m) => {
                const year = m.year || m.release_year || '';
                return `
                <button class="games-guess-item ${showPoster ? '' : 'no-poster'}" type="button" data-game-guess-pick data-tmdb-id="${m.tmdb_id}">
                    ${showPoster ? `<img src="${gamesPosterUrl(m.poster_path, 'w92')}" alt="">` : ''}
                    <span>${escapeHtml(m.title || '')}${year ? ` <span class="games-dim">(${year})</span>` : ''}</span>
                </button>`;
            }).join('');
        }

        async function submitGuess(tmdbId) {
            const game = gamesActiveGame;
            if (game !== 'spottle' && game !== 'poster') return;
            const box = document.getElementById('game-guess-results');
            const inp = document.getElementById('game-guess-input');
            if (box) box.innerHTML = '';
            if (inp) inp.value = '';
            try {
                const res = await gamesApi({
                    action: 'game_guess', game, tmdb_id: Number(tmdbId),
                    hint_used: !!gameHintRevealed[game],
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
                if (res.hint_after != null) d.hint_after = res.hint_after;
                d.hint = res.hint || null;
                gameGiveUpArmed[game] = false;   // a new guess disarms Give Up
                if (gameGiveUpTimer) { clearTimeout(gameGiveUpTimer); gameGiveUpTimer = null; }
                rerenderGuessGame(game);
                if (d.done && d.solved) { try { showToast('Solved! 🎉', { durationMs: 1400 }); } catch (_) {} }
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
            const pick = t.closest('[data-game-guess-pick]');
            if (pick) { e.preventDefault(); submitGuess(pick.getAttribute('data-tmdb-id')); return; }
            const hintBtn = t.closest('[data-game-hint]');
            if (hintBtn) { e.preventDefault(); gameToggleHint(hintBtn.getAttribute('data-game-hint')); return; }
            const giveupBtn = t.closest('[data-game-giveup]');
            if (giveupBtn) { e.preventDefault(); gameGiveUp(giveupBtn.getAttribute('data-game-giveup')); return; }
            if (t.closest('[data-rank-hint]')) { e.preventDefault(); rankRevealHint(); return; }
            if (t.closest('[data-rank-giveup]')) { e.preventDefault(); rankGiveUp(); return; }
            const mv = t.closest('[data-rank-move]');
            if (mv) { e.preventDefault(); rankMove(mv.getAttribute('data-rank-id'), mv.getAttribute('data-rank-move')); return; }
            if (t.closest('[data-rank-submit]')) { e.preventDefault(); submitRank(); return; }
        }
