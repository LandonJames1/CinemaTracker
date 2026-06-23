        // ============================================================
        // Discover swipe deck (Phase 1)
        // ------------------------------------------------------------
        // A lean-back "what to watch" surface: one movie card at a time.
        //   RIGHT  -> add to Bucket List + record a 'right' swipe
        //   LEFT   -> record a 'left' swipe (soft-skip; resurfaces after 30 days)
        // Candidates + ranking come from the swift-api `swipe_deck` action
        // (taste + trending + all-time popular, scored by predictTasteScore).
        // Swipes are recorded straight to the `swipes` table (RLS = own rows).
        // ============================================================

        let discoverDeck = [];          // array of card objects from the edge
        let discoverIndex = 0;          // index of the current top card
        let discoverLoading = false;    // a batch fetch is in flight
        let discoverExhausted = false;  // the server returned no new cards
        let discoverBusy = false;       // a swipe animation is playing
        let discoverSwipesThisSession = 0; // swipes since the last appeal recompute
        const DISCOVER_BATCH = 25;
        const DISCOVER_PREFETCH_AT = 5; // fetch more when this many cards remain
        const DISCOVER_DETAILS_AHEAD = 10; // preload full details this many cards ahead

        async function discoverGetAuth() {
            try {
                const { data } = (await supabaseClient?.auth?.getSession?.()) || {};
                const session = data?.session || null;
                return { uid: session?.user?.id || null, token: session?.access_token || null };
            } catch (_) {
                return { uid: null, token: null };
            }
        }

        function discoverPosterUrl(posterPath) {
            const p = String(posterPath || '').trim();
            if (!p) return '';
            return `https://image.tmdb.org/t/p/w500${p.startsWith('/') ? p : `/${p}`}`;
        }

        function initDiscoverPage() {
            discoverDeck = [];
            discoverIndex = 0;
            discoverExhausted = false;
            discoverBusy = false;
            discoverSwipesThisSession = 0;
            loadDiscoverDeck({ append: false }).catch(() => null);
        }

        async function loadDiscoverDeck({ append = false } = {}) {
            if (discoverLoading) return;
            discoverLoading = true;
            if (!append) showDiscoverLoading();
            try {
                const data = await callSwiftApiPublic({ action: 'swipe_deck', limit: DISCOVER_BATCH });
                const incoming = Array.isArray(data?.cards) ? data.cards : [];
                // De-dupe against anything already in the deck.
                const have = new Set(discoverDeck.map((c) => Number(c.tmdb_id)));
                const fresh = incoming.filter((c) => c && Number.isFinite(Number(c.tmdb_id)) && !have.has(Number(c.tmdb_id)));
                if (fresh.length === 0) {
                    discoverExhausted = true;
                } else {
                    discoverDeck = discoverDeck.concat(fresh);
                }
                renderDiscoverStack();
            } catch (err) {
                if (!append) showDiscoverError(String(err?.message || err));
            } finally {
                discoverLoading = false;
            }
        }

        function discoverCurrentCard() {
            return discoverDeck[discoverIndex] || null;
        }

        function setDiscoverActionsVisible(visible) {
            const el = document.getElementById('discover-actions');
            if (el) el.classList.toggle('hidden', !visible);
        }

        function showDiscoverLoading() {
            const stack = document.getElementById('discover-stack');
            if (!stack) return;
            setDiscoverActionsVisible(false);
            stack.innerHTML = `
                <div class="discover-message">
                    <div class="discover-spinner"></div>
                    <p class="text-gray" style="margin-top: 0.8rem;">Finding movies for you…</p>
                </div>`;
        }

        function showDiscoverError(msg) {
            const stack = document.getElementById('discover-stack');
            if (!stack) return;
            setDiscoverActionsVisible(false);
            stack.innerHTML = `
                <div class="discover-message">
                    <p class="text-white font-bold">Couldn't load the deck</p>
                    <p class="text-gray text-sm" style="margin-top: 0.35rem;">${escapeHtml(String(msg || 'Please try again.'))}</p>
                    <button type="button" class="btn btn-outline" style="margin-top: 1rem;" onclick="initDiscoverPage()">Try again</button>
                </div>`;
        }

        function showDiscoverEmpty() {
            const stack = document.getElementById('discover-stack');
            if (!stack) return;
            discoverFlushAppeal(); // recompute taste from this session's swipes
            setDiscoverActionsVisible(false);
            stack.innerHTML = `
                <div class="discover-message">
                    <p class="text-white font-bold">You're all caught up</p>
                    <p class="text-gray text-sm" style="margin-top: 0.35rem;">Come back later for fresh picks, or rate more movies to sharpen these.</p>
                    <button type="button" class="btn btn-outline" style="margin-top: 1rem;" onclick="initDiscoverPage()">Refresh</button>
                </div>`;
        }

        // Render the visible stack: the top (interactive) card plus up to two behind
        // it for depth. Re-rendered after each swipe.
        function renderDiscoverStack() {
            const stack = document.getElementById('discover-stack');
            if (!stack) return;

            if (discoverIndex >= discoverDeck.length) {
                if (discoverExhausted) { showDiscoverEmpty(); return; }
                // Nothing rendered yet but more may be coming.
                if (!discoverLoading) loadDiscoverDeck({ append: true }).catch(() => null);
                showDiscoverLoading();
                return;
            }

            // Don't reveal the top card until its full details (incl. the IMDb rating)
            // are loaded — otherwise the poster shows first and the rating pops in late.
            // discoverEnsureDetails re-calls this once the top card's details arrive.
            const topCard = discoverDeck[discoverIndex];
            if (!discoverDetailsReady(topCard)) {
                showDiscoverLoading();
                discoverPreloadAhead();
                return;
            }

            const visible = discoverDeck.slice(discoverIndex, discoverIndex + 3);
            // Render back-to-front so the top card is the last DOM node (highest stacking).
            stack.innerHTML = visible
                .map((card, i) => buildDiscoverCardHtml(card, i))
                .reverse()
                .join('');

            setDiscoverActionsVisible(true);
            bindTopCardGestures();

            // Preload full details for up to DISCOVER_DETAILS_AHEAD cards behind the
            // current one so fast swiping never hits a not-ready card, and prefetch the
            // next batch as we near the end.
            discoverPreloadAhead();
        }

        // A card is "ready" once its details object exists — loaded OR errored (we don't
        // block forever on a failed details/OMDb fetch).
        function discoverDetailsReady(card) {
            return !!(card && card._details);
        }

        // Fire off details fetches for the current card + up to DISCOVER_DETAILS_AHEAD
        // cards behind it, and prefetch the next batch when the deck runs low.
        function discoverPreloadAhead() {
            const end = Math.min(discoverDeck.length, discoverIndex + DISCOVER_DETAILS_AHEAD + 1);
            for (let i = discoverIndex; i < end; i += 1) {
                const c = discoverDeck[i];
                if (c) discoverEnsureDetails(c).catch(() => null);
            }
            const remaining = discoverDeck.length - discoverIndex;
            if (!discoverExhausted && !discoverLoading && remaining <= DISCOVER_PREFETCH_AT) {
                loadDiscoverDeck({ append: true }).catch(() => null);
            }
        }

        // "2 friends rated this 90+" chip (Phase 2 social proof).
        function discoverSocialHtml(card) {
            const friends = Array.isArray(card?.friends) ? card.friends : [];
            if (!friends.length) return '';
            const count = Number(card?.friends_count) || friends.length;
            const avatars = friends.slice(0, 3).map((f) => {
                const av = (typeof renderUserIconHtml === 'function') ? renderUserIconHtml(f.icon, 22) : '';
                return `<span class="discover-social-avatar">${av}</span>`;
            }).join('');
            const label = count === 1 ? '1 friend rated this 85+' : `${count} friends rated this 85+`;
            return `<div class="discover-social"><span class="discover-social-avatars">${avatars}</span><span class="discover-social-label">${escapeHtml(label)}</span></div>`;
        }

        // Back-of-card details. `card._details` is lazily fetched on first flip.
        function renderBackDetailsHtml(card) {
            const d = card?._details;
            if (!d) {
                return `<div class="discover-back-loading"><div class="discover-spinner discover-spinner-sm"></div><span>Loading details…</span></div>`;
            }
            if (d._error) {
                return `<p class="text-gray text-sm">Couldn't load details.</p>`;
            }
            const fmtRuntime = (m) => {
                const n = Number(m);
                if (!Number.isFinite(n) || n <= 0) return '';
                const h = Math.floor(n / 60);
                const mm = n % 60;
                return h ? `${h}h ${mm}m` : `${mm}m`;
            };
            const detailRow = (label, val) => val
                ? `<div class="discover-detail-row"><span class="discover-detail-label">${label}</span><span class="discover-detail-val">${escapeHtml(String(val))}</span></div>`
                : '';
            const cast = Array.isArray(d.cast) ? d.cast.join(', ') : '';
            const genre = Array.isArray(d.genres) && d.genres.length ? d.genres.join(', ') : String(d.genre || '');
            const imdb = (typeof d.imdb_rating_pct === 'number' && Number.isFinite(d.imdb_rating_pct))
                ? `${Math.round(d.imdb_rating_pct)}%` : '';
            const grid = [
                detailRow('Director', d.director),
                detailRow('Cast', cast),
                detailRow('Runtime', fmtRuntime(d.runtime)),
                detailRow('Rated', d.mpa),
                detailRow('Genre', genre),
                detailRow('IMDb', imdb),
            ].filter(Boolean).join('');
            const overview = d.overview
                ? `<p class="discover-overview">${escapeHtml(String(d.overview))}</p>` : '';
            return `<div class="discover-detail-grid">${grid}</div>${overview}`;
        }

        function buildDiscoverCardHtml(card, depth) {
            const title = escapeHtml(String(card?.title || 'Untitled'));
            const year = card?.year ? ` <span class="discover-year">(${escapeHtml(String(card.year))})</span>` : '';
            const poster = discoverPosterUrl(card?.poster_path);
            const genres = Array.isArray(card?.genres) ? card.genres.slice(0, 3).join(' · ') : '';
            // IMDb rating comes from the lazily-fetched details (same source the back
            // face uses); it's empty on first paint and patched in by discoverEnsureDetails.
            const imdbPct = card?._details?.imdb_rating_pct;
            const rating = (typeof imdbPct === 'number' && Number.isFinite(imdbPct) && imdbPct > 0)
                ? `IMDb ${Math.round(imdbPct)}%` : '';
            const score = (typeof card?.taste_score === 'number') ? card.taste_score : null;
            const scoreBadge = (score !== null)
                ? `<div class="discover-score" data-tier="${score >= 80 ? 'high' : (score >= 60 ? 'mid' : 'low')}">Predicted Overall: ${score}%</div>`
                : '';
            const reasons = Array.isArray(card?.taste_reasons) && card.taste_reasons.length
                ? `<div class="discover-reason">${escapeHtml(card.taste_reasons[0])}</div>` : '';
            const social = discoverSocialHtml(card);

            const posterInner = poster
                ? `<img src="${poster}" alt="${title}" loading="lazy" decoding="async" onerror="this.style.display='none'; this.parentElement.classList.add('discover-noposter');">`
                : `<div class="discover-noposter-label">No poster</div>`;

            return `
                <div class="discover-card" data-depth="${depth}" data-tmdb="${Number(card?.tmdb_id) || ''}">
                    <div class="discover-card-inner">
                        <div class="discover-face discover-front">
                            <div class="discover-poster">${posterInner}</div>
                            <div class="discover-meta">
                                ${scoreBadge}
                                <div class="discover-title">${title}${year}</div>
                                <div class="discover-submeta">${genres ? `<span class="discover-front-genres">${escapeHtml(genres)}</span>` : ''}<span class="discover-front-imdb">${rating ? `${genres ? '  •  ' : ''}${escapeHtml(rating)}` : ''}</span></div>
                                ${reasons}
                                ${social}
                            </div>
                            <div class="discover-swipe-overlay discover-overlay-like"><span>Add to Bucket List</span></div>
                            <div class="discover-swipe-overlay discover-overlay-skip"><span>Dismiss</span></div>
                        </div>
                        <div class="discover-face discover-back">
                            <div class="discover-back-title">${title}${year}</div>
                            <div class="discover-back-details">${renderBackDetailsHtml(card)}</div>
                        </div>
                    </div>
                </div>`;
        }

        // Lazily fetch director/cast/runtime/etc. the first time a card is flipped,
        // then patch just that card's back face (no full re-render).
        async function discoverEnsureDetails(card, el) {
            if (!card || card._details || card._detailsLoading) return;
            card._detailsLoading = true;
            try {
                const d = await callSwiftApiGetMovieDetails({ tmdb_id: card.tmdb_id });
                card._details = (d && typeof d === 'object') ? d : { _error: true };
            } catch (_) {
                card._details = { _error: true };
            } finally {
                card._detailsLoading = false;
                // If the top card was waiting on its details (stack showing the spinner),
                // render it now that it's ready.
                if (discoverDeck[discoverIndex] === card && !discoverTopEl()) {
                    renderDiscoverStack();
                    return;
                }
                const top = discoverTopEl();
                const target = (el && el.isConnected) ? el : top;
                if (target && Number(target.getAttribute('data-tmdb')) === Number(card.tmdb_id)) {
                    discoverPatchCardNode(target, card);
                }
            }
        }

        // Patch an existing card node's back-details + front IMDb badge in place (no
        // re-render) once its `_details` (incl. imdb_rating_pct) have loaded.
        function discoverPatchCardNode(node, card) {
            if (!node || !card) return;
            const container = node.querySelector('.discover-back-details');
            if (container) container.innerHTML = renderBackDetailsHtml(card);
            const imdbEl = node.querySelector('.discover-front-imdb');
            if (imdbEl) {
                const pct = card?._details?.imdb_rating_pct;
                const hasGenres = !!node.querySelector('.discover-front-genres');
                imdbEl.textContent = (typeof pct === 'number' && Number.isFinite(pct) && pct > 0)
                    ? `${hasGenres ? '  •  ' : ''}IMDb ${Math.round(pct)}%` : '';
            }
        }

        function discoverTopEl() {
            const stack = document.getElementById('discover-stack');
            if (!stack) return null;
            // The interactive top is the last DOM node that ISN'T mid-fly-off — so while a
            // swiped card animates out, this already points at the promoted new top.
            const cards = stack.querySelectorAll('.discover-card:not(.discover-swiped-left):not(.discover-swiped-right)');
            return cards.length ? cards[cards.length - 1] : null;
        }

        // Pointer-drag the top card (touch + mouse). Drag state is module-scoped and
        // the window mouse listeners are bound ONCE (the per-card touch listeners die
        // with the element on re-render), so swiping many cards doesn't leak handlers.
        let discoverDrag = null;
        let discoverWindowGesturesBound = false;
        let discoverLastTouch = 0; // suppresses the synthetic mouse events iOS fires after a tap

        function discoverPointerXY(e) {
            if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
            if (e.changedTouches && e.changedTouches[0]) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
            return { x: e.clientX, y: e.clientY };
        }

        function discoverDragStart(e, el) {
            if (discoverBusy) return;
            const { x, y } = discoverPointerXY(e);
            // On the BACK (details side) we don't swipe-drag — only tap-to-flip-back +
            // letting the overview text scroll. `onBack` gates the translate/swipe.
            const onBack = !!e.target.closest('.discover-back');
            discoverDrag = { el, startX: x, startY: y, dragX: 0, decided: false, locked: false, startTarget: e.target, onBack };
            if (!onBack) el.style.transition = 'none';
        }

        function discoverDragMove(e) {
            const d = discoverDrag;
            if (!d || d.locked) return;
            const { x, y } = discoverPointerXY(e);
            const dx = x - d.startX;
            const dy = y - d.startY;
            // On the back: only track whether they moved (so a scroll isn't a "tap");
            // never translate or swipe the card.
            if (d.onBack) {
                if (Math.abs(dx) > 6 || Math.abs(dy) > 6) d.decided = true;
                return;
            }
            if (!d.decided) {
                if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
                d.decided = true;
                if (Math.abs(dy) > Math.abs(dx)) { // vertical intent → let the page scroll
                    d.locked = true;
                    d.el.style.transition = '';
                    d.el.style.transform = '';
                    return;
                }
            }
            if (e.cancelable) e.preventDefault();
            d.dragX = dx;
            d.el.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`;
            // Drag feedback: fade in the green "Add" / red "Dismiss" overlay as they pull.
            const like = d.el.querySelector('.discover-overlay-like');
            const skip = d.el.querySelector('.discover-overlay-skip');
            if (like) like.style.opacity = String(Math.max(0, Math.min(1, dx / 110)));
            if (skip) skip.style.opacity = String(Math.max(0, Math.min(1, -dx / 110)));
        }

        function discoverDragEnd() {
            const d = discoverDrag;
            if (!d) return;
            discoverDrag = null;
            d.el.style.transition = '';
            if (!d.onBack && !d.locked && d.dragX > 100) { discoverSwipe('right'); return; }
            if (!d.onBack && !d.locked && d.dragX < -100) { discoverSwipe('left'); return; }
            d.el.style.transform = '';
            const like = d.el.querySelector('.discover-overlay-like');
            const skip = d.el.querySelector('.discover-overlay-skip');
            if (like) like.style.opacity = '0';
            if (skip) skip.style.opacity = '0';

            // A tap (no real drag) flips the card: front → details, back → front.
            if (!d.decided && !d.locked) {
                discoverFlipTop();
            }
        }

        function bindTopCardGestures() {
            const el = discoverTopEl();
            if (!el) return;
            el.addEventListener('mousedown', (e) => {
                // Ignore the synthetic mousedown iOS fires ~300ms after a tap — it would
                // re-trigger discoverFlipTop and instantly undo the touch-driven flip.
                if (Date.now() - discoverLastTouch < 700) return;
                discoverDragStart(e, el);
            });
            el.addEventListener('touchstart', (e) => { discoverLastTouch = Date.now(); discoverDragStart(e, el); }, { passive: true });
            el.addEventListener('touchmove', (e) => { discoverLastTouch = Date.now(); discoverDragMove(e); }, { passive: false });
            el.addEventListener('touchend', (e) => { discoverLastTouch = Date.now(); discoverDragEnd(e); });
            el.addEventListener('touchcancel', (e) => { discoverLastTouch = Date.now(); discoverDragEnd(e); });
            if (!discoverWindowGesturesBound) {
                discoverWindowGesturesBound = true;
                window.addEventListener('mousemove', discoverDragMove);
                window.addEventListener('mouseup', discoverDragEnd);
            }
        }

        // Commit a swipe: animate the top card off, record it, advance the deck.
        function discoverSwipe(direction) {
            if (discoverBusy) return;
            const card = discoverCurrentCard();
            const el = discoverTopEl();
            if (!card || !el) return;
            discoverBusy = true;

            const dir = direction === 'right' ? 'right' : 'left';
            el.classList.add(dir === 'right' ? 'discover-swiped-right' : 'discover-swiped-left');

            // Fire the side effects without blocking the animation.
            recordSwipe(card, dir).catch(() => null);
            if (dir === 'right') addCardToBucketList(card).catch(() => null);
            discoverSwipesThisSession += 1; // both directions shift genre appeal rates

            // Promote the cards behind RIGHT NOW (not after the fly-off) so the next card
            // glides forward AS the top leaves, instead of lurching up 280ms later.
            discoverIndex += 1;
            const promoted = discoverPromoteStack(el);

            window.setTimeout(() => {
                if (el && el.parentNode) el.remove();   // retire the flown-off card
                discoverBusy = false;
                // If we couldn't promote in place (deck end / details not ready), fall back
                // to a full render now that the flown card is gone.
                if (!promoted) renderDiscoverStack();
            }, 300);
        }

        // Advance the stack by ONE in place — WITHOUT rebuilding the whole thing and
        // WITHOUT waiting for the swiped card to finish flying off. We leave the flying
        // card (`flyingEl`) in the DOM (its swipe transform is !important) and promote the
        // cards behind it: bump each one's data-depth so the CSS transform transition
        // glides it forward (no poster reload/flash), and append one fresh card at the
        // back. Returns false (so the caller can full-render) when the new top's details
        // aren't ready or the deck has run out.
        function discoverPromoteStack(flyingEl) {
            const stack = document.getElementById('discover-stack');
            if (!stack) return false;
            const topCard = discoverDeck[discoverIndex];
            if (!topCard || !discoverDetailsReady(topCard)) return false;

            // Every card except the one flying off, in DOM order (deepest first).
            const nodes = Array.from(stack.querySelectorAll('.discover-card'))
                .filter((n) => n !== flyingEl);

            // Append the newly-revealed third card at the BACK of the stack (front of DOM).
            const visible = discoverDeck.slice(discoverIndex, discoverIndex + 3);
            if (visible.length > nodes.length) {
                const back = visible[visible.length - 1];
                const wrap = document.createElement('div');
                wrap.innerHTML = buildDiscoverCardHtml(back, 0).trim();
                const node = wrap.firstElementChild;
                if (node) { stack.insertBefore(node, stack.firstChild); nodes.unshift(node); }
            }

            // Re-assign depths: last entry = depth 0 (interactive top), going up.
            const count = nodes.length;
            nodes.forEach((node, i) => node.setAttribute('data-depth', String((count - 1) - i)));

            const newTop = nodes[nodes.length - 1];
            if (newTop) {
                newTop.style.transform = '';
                newTop.style.transition = '';
                discoverPatchCardNode(newTop, topCard);
            }

            setDiscoverActionsVisible(true);
            bindTopCardGestures();
            discoverPreloadAhead();
            return true;
        }

        function discoverFlipTop() {
            const el = discoverTopEl();
            if (!el) return;
            el.classList.toggle('is-flipped');
            if (el.classList.contains('is-flipped')) {
                const card = discoverCurrentCard();
                if (card) discoverEnsureDetails(card, el).catch(() => null);
            }
        }

        async function recordSwipe(card, direction) {
            const { uid } = await discoverGetAuth();
            if (!uid || !supabaseClient) return;
            const tmdbId = Number(card?.tmdb_id);
            if (!Number.isFinite(tmdbId)) return;
            // Store the card's genres on the swipe so the taste profile can compute a
            // genre's right-swipe RATE (needs left-swiped movies' genres too, which
            // never enter the catalog otherwise). Phase 3 appeal signal.
            const genres = Array.isArray(card?.genres) ? card.genres : [];
            await supabaseClient
                .from('swipes')
                .upsert({ user_id: uid, tmdb_id: tmdbId, direction, genres }, { onConflict: 'user_id,tmdb_id' });
        }

        // End-of-session flush: if the user swiped anything, recompute their taste
        // profile once (so right-swipe appeal updates) instead of after every swipe.
        // Called when the deck empties and when navigating away from Discover.
        function discoverFlushAppeal() {
            if (discoverSwipesThisSession <= 0) return;
            discoverSwipesThisSession = 0;
            try { recomputeMyTasteProfile().catch(() => null); } catch (_) {}
        }

        async function addCardToBucketList(card) {
            const { uid, token } = await discoverGetAuth();
            if (!uid || !token) return;
            try {
                const bucketId = await ensureBucketListForUser({ user_id: uid });
                if (!bucketId) return;
                const movieId = await ensureMovieFullySyncedForLists({
                    accessToken: token,
                    title: card?.title,
                    release_year: card?.year,
                    tmdb_id: card?.tmdb_id,
                });
                if (!movieId) return;
                await addMovieToList({ user_id: uid, list_id: bucketId, movie_id: movieId });
                showToast('Added to Bucket List', { level: 'success', durationMs: 900 });
            } catch (err) {
                const msg = String(err?.message || err);
                if (/duplicate|unique/i.test(msg)) return; // already there — fine
                try { if (typeof emitLog === 'function') emitLog('error', `Bucket add failed: ${msg}`); } catch (_) {}
                showToast('Could not add to Bucket List', { level: 'warn' });
            }
        }
