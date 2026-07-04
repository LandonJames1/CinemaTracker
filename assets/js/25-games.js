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
        // Cheat-resistance: the pool + daily answers are NEVER client-readable.
        // Everything here goes through the authenticated edge actions
        // (game_today / game_search / game_guess / game_submit), which strip
        // ratings/answers for unfinished games. Route is auth-gated (02-router.js).
        //
        // Loaded BEFORE 19-logging-boot.js despite the higher number (19 must be
        // last). Styles live in the "Games page" block in styles.css.
        // ============================================================

        let gamesTodayData = null;      // last game_today response ({ date, games:{...} })
        let gamesActiveGame = null;     // 'spottle' | 'rank' | 'poster' | null
        let _gamesBound = false;
        let gameSearchTimer = null;     // debounce for the autocomplete
        let rankOrderIds = [];          // current rank ordering (tmdb_id[])
        let gamesSearchIndex = null;    // cached full pool title index (fast local filter)
        let gamesSearchIndexLoading = null;

        const GAME_META = {
            spottle: { title: 'Spottle', tag: 'Guess the movie', icon: 'search',
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
            return { play: 'Play', progress: 'In progress', solved: 'Solved', done: 'Done',
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
                const streak = Number(d?.streak) || 0;
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
                            ${streak > 0 ? `<span class="games-streak" title="Day streak">🔥 ${streak}</span>` : ''}
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
            // Warm the guess autocomplete index so the first keystroke is instant.
            if (game === 'spottle' || game === 'poster') { try { loadGameSearchIndex(); } catch (_) {} }
            if (game === 'spottle') renderSpottle();
            else if (game === 'rank') renderRank();
            else if (game === 'poster') renderPoster();
            try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch (_) {}
        }

        function closeGame() {
            gamesActiveGame = null;
            const hub = document.getElementById('games-hub');
            const play = document.getElementById('games-play');
            if (play) { play.hidden = true; play.innerHTML = ''; }
            if (hub) hub.hidden = false;
            renderGamesHub();   // reflect any freshly-finished game on the cards
        }

        function gamePlayHeadHtml(game) {
            const meta = GAME_META[game] || {};
            return `
                <div class="games-play-head">
                    <button class="games-back" type="button" data-game-back>
                        <span class="games-back-caret">‹</span> All games
                    </button>
                    <div class="games-play-title">${escapeHtml(meta.title || '')}</div>
                </div>`;
        }

        function gameGuessInputHtml(context, left) {
            return `
                <div class="games-guess">
                    <input id="game-guess-input" class="games-guess-input" type="text"
                           placeholder="Guess a movie…${left != null ? ` (${left} left)` : ''}"
                           autocomplete="off" spellcheck="false" data-game-context="${context}">
                    <div id="game-guess-results" class="games-guess-results"></div>
                </div>`;
        }

        function gameResultBanner(game, d) {
            const a = d.answer || {};
            const win = !!d.solved;
            const title = a.title
                ? `${escapeHtml(a.title)}${a.release_year ? ` (${a.release_year})` : ''}`
                : 'the movie';
            const msg = win
                ? `Solved in ${d.attempts} ${d.attempts === 1 ? 'guess' : 'guesses'}! It was <strong>${title}</strong>.`
                : `Out of guesses — it was <strong>${title}</strong>.`;
            return `
                <div class="games-result-banner ${win ? 'is-win' : ''}">
                    <div>${msg}</div>
                    <div class="games-donenote">Come back tomorrow for a new puzzle.</div>
                </div>`;
        }

        // ---- Spottle -------------------------------------------------------------
        function spottleTileHtml(label, fb) {
            const st = (fb && fb.status) || 'gray';
            const dir = fb && fb.dir === 'up' ? '▲' : (fb && fb.dir === 'down' ? '▼' : '');
            const val = (fb && fb.value != null) ? String(fb.value) : '—';
            return `
                <div class="spottle-tile is-${st}">
                    <span class="spottle-tile-label">${escapeHtml(label)}</span>
                    <span class="spottle-tile-val">${escapeHtml(val)}${dir ? ` <span class="spottle-dir">${dir}</span>` : ''}</span>
                </div>`;
        }

        function spottlePersonHtml(name, profilePath, status, label) {
            const url = profilePath ? gamesPosterUrl(profilePath, 'w185') : '';
            const initials = String(name || '?').trim().split(/\s+/).map((w) => w[0] || '').slice(0, 2).join('').toUpperCase() || '?';
            const face = url
                ? `<img class="spottle-person-img" src="${url}" alt="">`
                : `<div class="spottle-person-img spottle-person-noimg">${escapeHtml(initials)}</div>`;
            return `
                <div class="spottle-person is-${status || 'gray'}">
                    ${face}
                    <span class="spottle-person-name">${escapeHtml(name || '—')}</span>
                    ${label ? `<span class="spottle-person-label">${escapeHtml(label)}</span>` : ''}
                </div>`;
        }

        function spottleRowHtml(g) {
            const fb = g.feedback || {};
            const dir = fb.director || {};
            const dirHtml = spottlePersonHtml(dir.value || 'Unknown', dir.profile_path, dir.status || 'gray', 'Director');
            const shared = (fb.cast && Array.isArray(fb.cast.shared)) ? fb.cast.shared : [];
            const castHtml = shared.length
                ? shared.map((c) => spottlePersonHtml(c.name, c.profile_path, 'green', 'Shared cast')).join('')
                : '';
            const tiles = [
                spottleTileHtml('Year', fb.year),
                spottleTileHtml('Genre', fb.genre),
                spottleTileHtml('IMDb', fb.imdb),
                spottleTileHtml('Runtime', fb.runtime),
                spottleTileHtml('MPA', fb.mpa),
                spottleTileHtml('Studio', fb.studio),
            ].join('');
            return `
                <div class="spottle-row ${g.correct ? 'is-correct' : ''}">
                    <div class="spottle-guess-title">${escapeHtml(g.title || '')}${g.release_year ? ` <span class="games-dim">(${g.release_year})</span>` : ''}</div>
                    <div class="spottle-people">${dirHtml}${castHtml}</div>
                    <div class="spottle-tiles">${tiles}</div>
                </div>`;
        }

        function renderSpottle() {
            const play = document.getElementById('games-play');
            const d = gamesTodayData?.games?.spottle;
            if (!play) return;
            if (!d) { play.innerHTML = gamePlayHeadHtml('spottle') + '<div class="games-error">No puzzle available today.</div>'; return; }
            const rows = (d.guesses || []).map(spottleRowHtml).join('')
                || '<div class="games-empty">Make your first guess below.</div>';
            const left = Math.max(0, (d.max_guesses || 6) - (d.attempts || 0));
            const footer = d.done ? gameResultBanner('spottle', d) : gameGuessInputHtml('spottle', left);
            play.innerHTML = `
                ${gamePlayHeadHtml('spottle')}
                <div class="spottle-legend">🟩 exact · 🟨 close · ⬛ off · ▲ answer is higher / ▼ lower. The director + any <strong>shared cast</strong> (green) also appear per guess.</div>
                <div class="spottle-board">${rows}</div>
                ${footer}`;
        }

        // ---- Poster --------------------------------------------------------------
        function renderPoster() {
            const play = document.getElementById('games-play');
            const d = gamesTodayData?.games?.poster;
            if (!play) return;
            if (!d) { play.innerHTML = gamePlayHeadHtml('poster') + '<div class="games-error">No puzzle available today.</div>'; return; }
            const url = gamesPosterUrl(d.poster_path, 'w500');
            const blur = d.done ? 0 : Number(d.blur) || 0;
            const chips = (d.guesses || []).map((g) =>
                `<span class="poster-guess-chip ${g.correct ? 'is-correct' : ''}">${escapeHtml(g.title || '')}</span>`).join('');
            const left = Math.max(0, (d.max_guesses || 6) - (d.attempts || 0));
            const footer = d.done ? gameResultBanner('poster', d) : gameGuessInputHtml('poster', left);
            play.innerHTML = `
                ${gamePlayHeadHtml('poster')}
                <div class="poster-stage">
                    <div class="poster-frame">
                        ${url ? `<img class="poster-img" style="filter: blur(${blur}px);" src="${url}" alt="Mystery movie poster">`
                              : '<div class="poster-missing">No image</div>'}
                    </div>
                </div>
                ${chips ? `<div class="poster-guesses">${chips}</div>` : ''}
                ${footer}`;
        }

        // ---- Rank ----------------------------------------------------------------
        function rankRowsHtml(movies) {
            const byId = new Map(movies.map((m) => [Number(m.tmdb_id), m]));
            return rankOrderIds.map((id, idx) => {
                const m = byId.get(Number(id));
                if (!m) return '';
                return `
                    <div class="rank-row" data-rank-id="${id}">
                        <span class="rank-grip" aria-hidden="true">⠿</span>
                        <span class="rank-num">${idx + 1}</span>
                        <img class="rank-poster" src="${gamesPosterUrl(m.poster_path, 'w185')}" alt="" draggable="false">
                        <span class="rank-title">${escapeHtml(m.title || '')}${m.release_year ? ` <span class="games-dim">(${m.release_year})</span>` : ''}</span>
                        <span class="rank-moves">
                            <button class="rank-move" type="button" data-rank-move="up" data-rank-id="${id}" ${idx === 0 ? 'disabled' : ''} aria-label="Move up">▲</button>
                            <button class="rank-move" type="button" data-rank-move="down" data-rank-id="${id}" ${idx === rankOrderIds.length - 1 ? 'disabled' : ''} aria-label="Move down">▼</button>
                        </span>
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
            rankOrderIds = (d.movies || []).map((m) => Number(m.tmdb_id));
            play.innerHTML = `
                ${gamePlayHeadHtml('rank')}
                <div class="rank-hint">Drag the cards (or use ▲▼) to order them from <strong>highest</strong> to <strong>lowest</strong> IMDb rating.</div>
                <div id="rank-list" class="rank-list"></div>
                <button class="btn-glass rank-submit" type="button" data-rank-submit>Submit ranking</button>`;
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

        // Pointer-based drag reorder (works for touch + mouse). The dragged row
        // follows the finger via transform; as the pointer crosses a sibling's
        // midpoint the row is physically re-inserted in the DOM, then rankOrderIds
        // is rebuilt from DOM order on release.
        function onRankPointerDown(e) {
            if (e.target && e.target.closest && e.target.closest('.rank-move')) return; // let ▲▼ work
            const row = e.currentTarget;
            const list = document.getElementById('rank-list');
            if (!list) return;
            e.preventDefault();
            const startY = e.clientY;
            const startTop = row.getBoundingClientRect().top;
            const offsetY = startY - startTop;
            row.classList.add('rank-dragging');
            try { row.setPointerCapture(e.pointerId); } catch (_) {}

            const renumber = () => {
                Array.from(list.querySelectorAll('.rank-row')).forEach((r, i) => {
                    const n = r.querySelector('.rank-num');
                    if (n) n.textContent = String(i + 1);
                });
            };

            const onMove = (ev) => {
                const siblings = Array.from(list.querySelectorAll('.rank-row:not(.rank-dragging)'));
                let placed = false;
                for (const sib of siblings) {
                    const r = sib.getBoundingClientRect();
                    if (ev.clientY < r.top + r.height / 2) { list.insertBefore(row, sib); placed = true; break; }
                }
                if (!placed) list.appendChild(row);
                const nat = row.getBoundingClientRect().top;
                row.style.transform = `translateY(${ev.clientY - offsetY - nat}px)`;
                renumber();
            };
            const onUp = () => {
                row.classList.remove('rank-dragging');
                row.style.transform = '';
                row.removeEventListener('pointermove', onMove);
                row.removeEventListener('pointerup', onUp);
                row.removeEventListener('pointercancel', onUp);
                rankOrderIds = Array.from(list.querySelectorAll('.rank-row')).map((r) => Number(r.getAttribute('data-rank-id')));
                paintRankList(); // clean re-render (resets transforms + ▲▼ disabled states)
            };
            row.addEventListener('pointermove', onMove);
            row.addEventListener('pointerup', onUp);
            row.addEventListener('pointercancel', onUp);
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
            const banner = d.solved ? 'Perfect — you nailed the exact order!' : `You scored ${d.score || 0} points.`;
            play.innerHTML = `
                ${gamePlayHeadHtml('rank')}
                <div class="games-result-banner ${d.solved ? 'is-win' : ''}">${banner}</div>
                <div class="rank-result-list">${rows}</div>
                <div class="games-donenote">Come back tomorrow for a new set.</div>`;
        }

        async function submitRank() {
            const btn = document.querySelector('[data-rank-submit]');
            if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }
            try {
                const res = await gamesApi({ action: 'game_submit', order: rankOrderIds });
                if (!res?.ok) { showToast(res?.message || 'Could not submit ranking.', { level: 'warn' }); if (btn) { btn.disabled = false; btn.textContent = 'Submit ranking'; } return; }
                const d = gamesTodayData.games.rank;
                d.done = true; d.solved = !!res.solved; d.score = res.score || 0;
                d.result = res.true_order || [];
                d.submitted_order = res.submitted_order || rankOrderIds.slice();
                renderRankResult(d);
            } catch (e) {
                showToast(String(e?.message || e), { level: 'error' });
                if (btn) { btn.disabled = false; btn.textContent = 'Submit ranking'; }
            }
        }

        // ---- Guessing (spottle + poster) -----------------------------------------
        // The pool's movie NAMES aren't secret (only the answers/ratings are), so we
        // fetch the whole title index ONCE and filter locally — instant typing, no
        // per-keystroke round trip. Prefetched when a guessing game opens.
        function loadGameSearchIndex() {
            if (gamesSearchIndex) return Promise.resolve(gamesSearchIndex);
            if (gamesSearchIndexLoading) return gamesSearchIndexLoading;
            gamesSearchIndexLoading = (async () => {
                try {
                    const res = await gamesApi({ action: 'game_search', all: true });
                    gamesSearchIndex = Array.isArray(res?.results) ? res.results : [];
                } catch (_) { gamesSearchIndex = []; }
                gamesSearchIndexLoading = null;
                return gamesSearchIndex;
            })();
            return gamesSearchIndexLoading;
        }

        function gamesNormalize(s) {
            return String(s || '').toLowerCase().normalize('NFKD')
                .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ')
                .replace(/\s+/g, ' ').trim();
        }

        function gamesDelegatedInput(e) {
            const inp = e.target && e.target.closest ? e.target.closest('#game-guess-input') : null;
            if (!inp) return;
            const q = inp.value.trim();
            if (gameSearchTimer) clearTimeout(gameSearchTimer);
            const box = document.getElementById('game-guess-results');
            if (q.length < 1) { if (box) box.innerHTML = ''; return; }
            // Local filter is cheap, so a tiny debounce is plenty.
            gameSearchTimer = setTimeout(() => gameSearchRun(q), 80);
        }

        async function gameSearchRun(q) {
            const box = document.getElementById('game-guess-results');
            if (!box) return;
            const idx = await loadGameSearchIndex();
            const words = gamesNormalize(q).split(' ').filter(Boolean);
            if (!words.length) { box.innerHTML = ''; return; }
            const matches = [];
            for (const m of idx) {
                const t = gamesNormalize(m.title);
                if (words.every((w) => t.includes(w))) matches.push(m);
                if (matches.length >= 8) break;
            }
            if (!matches.length) { box.innerHTML = '<div class="games-guess-empty">No matches</div>'; return; }
            // The POSTER game must NOT show poster thumbnails in the guess list — that
            // would give the answer away — so we hide them for that game only.
            const showPoster = gamesActiveGame !== 'poster';
            box.innerHTML = matches.map((m) => `
                <button class="games-guess-item ${showPoster ? '' : 'no-poster'}" type="button" data-game-guess-pick data-tmdb-id="${m.tmdb_id}">
                    ${showPoster ? `<img src="${gamesPosterUrl(m.poster_path, 'w92')}" alt="">` : ''}
                    <span>${escapeHtml(m.title || '')}${m.release_year ? ` <span class="games-dim">(${m.release_year})</span>` : ''}</span>
                </button>`).join('');
        }

        async function submitGuess(tmdbId) {
            const game = gamesActiveGame;
            if (game !== 'spottle' && game !== 'poster') return;
            const box = document.getElementById('game-guess-results');
            const inp = document.getElementById('game-guess-input');
            if (box) box.innerHTML = '';
            if (inp) inp.value = '';
            try {
                const res = await gamesApi({ action: 'game_guess', game, tmdb_id: Number(tmdbId) });
                if (!res?.ok) { showToast(res?.message || 'Could not submit guess.', { level: 'warn' }); return; }
                const d = gamesTodayData.games[game];
                d.guesses = Array.isArray(res.guesses) ? res.guesses : (d.guesses || []);
                d.attempts = res.attempts;
                d.solved = !!res.solved;
                d.done = !!res.done;
                d.score = res.score || 0;
                if (res.answer) d.answer = res.answer;
                if (game === 'poster' && res.blur != null) d.blur = res.blur;
                if (game === 'spottle') renderSpottle();
                else renderPoster();
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
            const mv = t.closest('[data-rank-move]');
            if (mv) { e.preventDefault(); rankMove(mv.getAttribute('data-rank-id'), mv.getAttribute('data-rank-move')); return; }
            if (t.closest('[data-rank-submit]')) { e.preventDefault(); submitRank(); return; }
        }
