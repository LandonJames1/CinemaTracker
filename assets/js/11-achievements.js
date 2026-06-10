        let updateWatchChoiceResolver = null;
        let watchMethodChoiceResolver = null;
        let watchMethodPendingSelection = null;
        let priorWatchesChoiceResolver = null;
        let priorWatchesPendingCount = 0;
        let watchDetailsResolver = null;
        let watchDetailsPendingMethod = null;
        let watchDetailsPendingBefore = null; // true | false | null (unset)

        let ratingsSuccessTimer = null;
        let achievementPopupQueue = [];
        let achievementPopupOpen = false;
        let achievementsByName = new Map();
        let achievementsList = [];
        let userAchievementIds = new Set();
        let userTierSummary = null;
        let userTiersList = [];
        const TEST_ACHIEVEMENT_EMAIL = 'landon.talus@gmail.com';
        const ADMIN_EMAIL = 'landon.talus@gmail.com';
        let testAchievementEnabled = false;
        let siteSignupEnabled = false; // Global flag: is sign-up allowed?

        // ─── Admin: Sign-Up Toggle (stored in Setting table) ───
        async function loadSiteSignupSetting() {
            if (!supabaseClient) return;
            try {
                const { data, error } = await supabaseClient
                    .from('Settings')
                    .select('allow_signups')
                    .limit(1)
                    .single();
                if (!error && data) {
                    siteSignupEnabled = data.allow_signups === true;
                } else {
                    siteSignupEnabled = false;
                }
            } catch (_) {
                siteSignupEnabled = false;
            }
        }

        function updateAdminPanelVisibility(email) {
            const panel = document.getElementById('account-admin-panel');
            if (!panel) return;
            const current = String(email || '').trim().toLowerCase();
            const target = ADMIN_EMAIL.toLowerCase();
            const isAdmin = Boolean(current && current === target);
            panel.style.display = isAdmin ? 'block' : 'none';
            if (isAdmin) syncAdminSignupToggleUI();
        }

        function syncAdminSignupToggleUI() {
            const toggle = document.getElementById('admin-allow-signups-toggle');
            const slider = document.getElementById('admin-signup-slider');
            const knob = document.getElementById('admin-signup-knob');
            const statusEl = document.getElementById('admin-signup-status');
            if (!toggle) return;
            toggle.checked = siteSignupEnabled;
            if (slider) slider.style.background = siteSignupEnabled ? 'var(--brand)' : 'rgba(255,255,255,0.15)';
            if (knob) knob.style.transform = siteSignupEnabled ? 'translateX(22px)' : 'translateX(0)';
            if (statusEl) statusEl.textContent = siteSignupEnabled ? 'Sign-ups are currently enabled.' : 'Sign-ups are currently disabled.';
        }

        async function handleAdminSignupToggle(checked) {
            const statusEl = document.getElementById('admin-signup-status');
            try {
                if (!supabaseClient || !cachedIsAuthed) return;
                const uid = String(cachedAuthUser?.id || '').trim();
                if (!uid) return;

                const { data: row } = await supabaseClient
                    .from('Settings')
                    .select('id')
                    .limit(1)
                    .single();
                if (!row?.id) throw new Error('No Setting row found.');
                const { error } = await supabaseClient
                    .from('Settings')
                    .update({ allow_signups: checked })
                    .eq('id', row.id);

                if (error) throw error;

                siteSignupEnabled = checked;
                syncAdminSignupToggleUI();
                if (statusEl) statusEl.textContent = siteSignupEnabled ? 'Sign-ups enabled. Changes are immediate.' : 'Sign-ups disabled. Changes are immediate.';
            } catch (err) {
                if (statusEl) statusEl.textContent = `Error: ${String(err?.message || err)}`;
            }
        }

        const RATING_MILESTONES = [10, 25, 50, 100, 150, 250, 500, 1000];

        function buildRatingAchievementName(count) {
            return `Rated ${count} Movies`;
        }

        async function loadAchievementsDefinitions() {
            if (!supabaseClient) return;
            const { data, error } = await supabaseClient
                .from('Achievements')
                .select('id, name, description, icon_url, tier, type, points, is_active')
                .order('points', { ascending: true });
            if (error || !Array.isArray(data)) return;

            const nextList = data.filter((row) => row?.is_active !== false);
            const nextMap = new Map();
            nextList.forEach((row) => {
                const name = String(row?.name || '').trim();
                if (name) nextMap.set(name, row);
            });
            achievementsList = nextList;
            achievementsByName = nextMap;
            syncAchievementFilterOptions();
        }

        async function loadUserAchievements(userId) {
            if (!supabaseClient || !userId) return;
            const { data, error } = await supabaseClient
                .from('User Achievements')
                .select('achievement_id, earned_at')
                .eq('user_id', userId);
            if (error || !Array.isArray(data)) return;

            userAchievementIds = new Set(data.map((row) => String(row?.achievement_id || '')).filter(Boolean));
        }

        async function loadUserTierSummary(userId) {
            if (!supabaseClient || !userId) return;

            const { data: userData, error: userError } = await supabaseClient
                .from('Users')
                .select('achievement_points, tier_id')
                .eq('id', userId)
                .limit(1);
            if (userError || !Array.isArray(userData)) return;

            const userRow = userData[0] || null;
            const points = Number(userRow?.achievement_points || 0) || 0;
            const tierId = String(userRow?.tier_id || '').trim();

            const { data: tiersData, error: tiersError } = await supabaseClient
                .from('User Tiers')
                .select('id, name, tier_icon_url, points_needed')
                .order('points_needed', { ascending: true });
            if (tiersError || !Array.isArray(tiersData)) return;

            userTiersList = tiersData;

            let currentTier = tiersData.find((t) => String(t?.id || '').trim() === tierId) || null;
            if (!currentTier) {
                currentTier = tiersData
                    .filter((t) => Number(t?.points_needed || 0) <= points)
                    .slice(-1)[0] || tiersData[0] || null;
            }

            const currentPointsNeeded = Number(currentTier?.points_needed || 0) || 0;
            const nextTier = tiersData.find((t) => Number(t?.points_needed || 0) > points) || null;
            const nextPointsNeeded = Number(nextTier?.points_needed || 0) || 0;
            const span = Math.max(1, nextPointsNeeded - currentPointsNeeded);
            const progress = nextTier ? Math.min(1, Math.max(0, (points - currentPointsNeeded) / span)) : 1;

            userTierSummary = {
                points,
                currentTier,
                nextTier,
                progress,
            };
        }

        function updateTestAchievementVisibility(email) {
            const btn = document.getElementById('account-test-achievement-btn');
            const select = document.getElementById('account-test-achievement-select');
            const panel = document.getElementById('account-achievement-test-panel');
            if (!btn || !select) return;
            const target = String(TEST_ACHIEVEMENT_EMAIL || '').trim().toLowerCase();
            const current = String(email || '').trim().toLowerCase();
            const shouldShow = Boolean(target && current && target === current);
            testAchievementEnabled = shouldShow;
            btn.style.display = shouldShow ? 'inline-flex' : 'none';
            select.style.display = shouldShow ? 'inline-flex' : 'none';
            if (panel) panel.style.display = shouldShow ? 'block' : 'none';
            if (shouldShow) {
                syncTestAchievementOptions();
            }
        }

        function syncTestAchievementOptions() {
            const select = document.getElementById('account-test-achievement-select');
            if (!select) return;
            if (!Array.isArray(achievementsList) || achievementsList.length === 0) {
                select.innerHTML = '<option value="">No achievements loaded</option>';
                return;
            }

            const currentValue = String(select.value || '').trim();
            const options = ['<option value="">Select achievement...</option>'];
            achievementsList.forEach((row) => {
                const id = String(row?.id || '').trim();
                const name = String(row?.name || '').trim();
                const tier = String(row?.tier || '').trim();
                const points = Number(row?.points || 0) || 0;
                if (!id || !name) return;
                const label = [name, tier ? `(${tier})` : '', points ? `- ${points} pts` : ''].filter(Boolean).join(' ');
                options.push(`<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`);
            });
            select.innerHTML = options.join('');
            if (currentValue) select.value = currentValue;
        }

        let achievementSortMode = 'points_asc';
        let achievementTypeFilter = 'all';
        let achievementFiltersOpen = false;

        function syncAchievementFilterOptions() {
            const select = document.getElementById('account-achievement-filter');
            if (!select) return;
            if (!Array.isArray(achievementsList) || achievementsList.length === 0) {
                select.innerHTML = '<option value="all">All types</option>';
                return;
            }

            const currentValue = String(select.value || achievementTypeFilter || 'all').trim();
            const types = Array.from(new Set(achievementsList
                .map((row) => String(row?.type || '').trim())
                .filter(Boolean))).sort();

            const options = ['<option value="all">All types</option>'];
            types.forEach((type) => {
                options.push(`<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`);
            });
            select.innerHTML = options.join('');
            select.value = types.includes(currentValue) ? currentValue : 'all';
            achievementTypeFilter = select.value;
        }

        function syncAchievementSortControl() {
            const select = document.getElementById('account-achievement-sort');
            if (!select) return;
            const value = String(achievementSortMode || 'points_desc').trim();
            if (select.value !== value) select.value = value;
        }

        function setAchievementFiltersOpen(isOpen) {
            const pop = document.getElementById('account-achievement-filters-pop');
            const btn = document.getElementById('account-achievement-filters-btn');
            if (!pop || !btn) return;
            achievementFiltersOpen = Boolean(isOpen);
            pop.classList.toggle('is-open', achievementFiltersOpen);
            pop.setAttribute('aria-hidden', achievementFiltersOpen ? 'false' : 'true');
            btn.setAttribute('aria-expanded', achievementFiltersOpen ? 'true' : 'false');
        }

        function toggleAchievementFiltersOpen() {
            setAchievementFiltersOpen(!achievementFiltersOpen);
        }

        function getFilteredAchievementsList() {
            const filtered = achievementsList.filter((row) => {
                if (!achievementTypeFilter || achievementTypeFilter === 'all') return true;
                const type = String(row?.type || '').trim();
                return type === achievementTypeFilter;
            });

            const sorted = filtered.slice().sort((a, b) => {
                const pointsA = Number(a?.points || 0) || 0;
                const pointsB = Number(b?.points || 0) || 0;
                if (pointsA === pointsB) return String(a?.name || '').localeCompare(String(b?.name || ''));
                return achievementSortMode === 'points_asc' ? pointsA - pointsB : pointsB - pointsA;
            });

            return sorted;
        }


        async function triggerTestAchievementPopup() {
            if (!cachedIsAuthed || !testAchievementEnabled) return;
            if (!achievementsList.length) {
                await loadAchievementsDefinitions();
                syncTestAchievementOptions();
            }

            const select = document.getElementById('account-test-achievement-select');
            const selectedId = String(select?.value || '').trim();
            let def = null;

            if (selectedId) {
                def = achievementsList.find((row) => String(row?.id || '').trim() === selectedId) || null;
            }

            if (!def && achievementsList.length > 0) {
                def = achievementsList[0];
            }

            if (!def) return;
            enqueueAchievementPopup(def);
        }

        function renderAccountTierSummary() {
            const card = document.getElementById('account-tier-summary');
            if (!card) return;

            const nameEl = document.getElementById('account-tier-name');
            const iconEl = document.getElementById('account-tier-icon');
            const pointsEl = document.getElementById('account-tier-points');
            const nextEl = document.getElementById('account-tier-next');
            const progressEl = document.getElementById('account-tier-progress');

            if (!cachedIsAuthed) {
                if (nameEl) nameEl.textContent = '—';
                if (pointsEl) pointsEl.textContent = 'Log in to view points.';
                if (nextEl) nextEl.textContent = '';
                if (progressEl) progressEl.style.width = '0%';
                if (iconEl) iconEl.textContent = '?';
                card.dataset.tier = 'Extra';
                return;
            }

            const summary = userTierSummary || null;
            const tierName = String(summary?.currentTier?.name || '').trim() || 'Unranked';
            const tierIconUrl = String(summary?.currentTier?.tier_icon_url || '').trim();
            const points = Number(summary?.points || 0) || 0;
            const nextTierName = String(summary?.nextTier?.name || '').trim();
            const nextPointsNeeded = Number(summary?.nextTier?.points_needed || 0) || 0;
            const pct = Math.round((Number(summary?.progress || 0) || 0) * 100);

            if (nameEl) nameEl.textContent = tierName;
            if (pointsEl) pointsEl.textContent = `${points} pts`;
            if (nextEl) {
                nextEl.textContent = nextTierName
                    ? `${nextPointsNeeded - points} to next tier`
                    : 'Top tier achieved.';
            }
            if (progressEl) progressEl.style.width = `${pct}%`;
            card.dataset.tier = tierName || 'Extra';

            if (iconEl) {
                iconEl.innerHTML = tierIconUrl
                    ? `<img src="${tierIconUrl}" alt="${escapeHtml(tierName)}">`
                    : '?';
            }
        }

        function renderAccountAchievements() {
            const list = document.getElementById('account-achievements-list');
            if (!list) return;

            syncAchievementSortControl();
            syncAchievementFilterOptions();

            if (!cachedIsAuthed) {
                list.innerHTML = '<div class="text-xs text-gray">Log in to view your achievements.</div>';
                return;
            }

            if (!achievementsList.length) {
                list.innerHTML = '<div class="text-xs text-gray">No achievements found.</div>';
                return;
            }

            const filtered = getFilteredAchievementsList();
            if (!filtered.length) {
                list.innerHTML = '<div class="text-xs text-gray">No achievements match those filters.</div>';
                return;
            }

            list.innerHTML = filtered.map((row) => {
                const id = String(row?.id || '').trim();
                const name = String(row?.name || '').trim() || 'Achievement';
                const desc = String(row?.description || '').trim();
                const iconUrl = String(row?.icon_url || '').trim();
                const tier = String(row?.tier || '').trim();
                const type = String(row?.type || '').trim();
                const points = Number(row?.points || 0) || 0;
                const earned = id && userAchievementIds.has(id);
                const meta = [points ? `${points} pts` : '', earned ? 'Earned' : 'Locked'].filter(Boolean).join(' • ');
                const tierLabel = tier || 'Achievement';

                return `
                    <div class="achievement-card ${earned ? '' : 'locked'}" data-tier="${escapeHtml(tierLabel)}" data-type="${escapeHtml(type)}" data-achievement-id="${escapeHtml(id)}">
                        <div class="achievement-header">
                            <div class="achievement-icon">
                                ${iconUrl ? `<img src="${iconUrl}" alt="${escapeHtml(name)}">` : '<span class="text-xs text-gray">?</span>'}
                            </div>
                            <div class="achievement-badge">${escapeHtml(tierLabel)}</div>
                        </div>
                        <div class="achievement-title">${escapeHtml(name)}</div>
                        ${desc ? `<div class="achievement-meta">${escapeHtml(desc)}</div>` : ''}
                        ${meta ? `<div class="achievement-meta">${escapeHtml(meta)}</div>` : ''}
                    </div>
                `;
            }).join('');
        }

        let achievementEvidenceCache = null;
        let achievementEvidenceCacheUserId = null;
        let achievementEvidenceLoading = null;

        function closeAchievementDetail() {
            const overlay = document.getElementById('achievement-detail-overlay');
            if (!overlay) return;
            overlay.style.display = 'none';
        }

        async function openAchievementDetail(achievementId) {
            if (!achievementId || !cachedIsAuthed || !supabaseClient) return;
            const overlay = document.getElementById('achievement-detail-overlay');
            const titleEl = document.getElementById('achievement-detail-title');
            const bodyEl = document.getElementById('achievement-detail-body');
            if (!overlay || !titleEl || !bodyEl) return;

            const achievement = achievementsList.find((row) => String(row?.id || '').trim() === achievementId) || null;
            if (!achievement) return;

            titleEl.textContent = String(achievement?.name || 'Achievement Details');
            bodyEl.innerHTML = '<div class="text-xs text-gray">Loading details...</div>';
            overlay.style.display = 'flex';

            const uid = String(cachedAuthUser?.id || '').trim();
            if (!uid) return;

            const data = (await loadAchievementEvidence(uid)) || getEmptyAchievementEvidence();
            const earned = userAchievementIds.has(achievementId);
            bodyEl.innerHTML = buildAchievementEvidenceHtml(achievement, data, earned);
        }

        async function loadAchievementEvidence(userId) {
            if (achievementEvidenceCache && achievementEvidenceCacheUserId === userId) return achievementEvidenceCache;
            if (achievementEvidenceLoading && achievementEvidenceCacheUserId === userId) return achievementEvidenceLoading;

            achievementEvidenceCache = null;
            achievementEvidenceLoading = null;
            achievementEvidenceCacheUserId = userId;

            achievementEvidenceLoading = (async () => {
                const ratingsRes = await supabaseClient
                    .from('Movie Ratings')
                    .select('movie_id, watch_date')
                    .eq('user_id', userId);
                const watchRes = await supabaseClient
                    .from('Watch Logs')
                    .select('movie_id, watch_date')
                    .eq('user_id', userId);

                const ratings = Array.isArray(ratingsRes?.data) ? ratingsRes.data : [];
                const watchLogs = Array.isArray(watchRes?.data) ? watchRes.data : [];

                const ratedMovieIds = Array.from(new Set(ratings.map((row) => String(row?.movie_id || '')).filter(Boolean)));
                const watchedMovieIds = Array.from(new Set(watchLogs.map((row) => String(row?.movie_id || '')).filter(Boolean)));
                const allMovieIds = Array.from(new Set([...ratedMovieIds, ...watchedMovieIds]));

                let movies = [];
                if (allMovieIds.length) {
                    const moviesRes = await supabaseClient
                        .from('Movies')
                        .select('id, title, release_year')
                        .in('id', allMovieIds);
                    movies = Array.isArray(moviesRes?.data) ? moviesRes.data : [];
                }
                const moviesById = new Map(movies.map((m) => [String(m?.id || ''), m]));

                let movieGenres = [];
                if (ratedMovieIds.length) {
                    const mgRes = await supabaseClient
                        .from('Movie Genres')
                        .select('movie_id, genre_id')
                        .in('movie_id', ratedMovieIds);
                    movieGenres = Array.isArray(mgRes?.data) ? mgRes.data : [];
                }

                const genreIds = Array.from(new Set(movieGenres.map((row) => String(row?.genre_id || '')).filter(Boolean)));
                let genres = [];
                if (genreIds.length) {
                    const genresRes = await supabaseClient
                        .from('Genres')
                        .select('id, name')
                        .in('id', genreIds);
                    genres = Array.isArray(genresRes?.data) ? genresRes.data : [];
                }
                const genreNamesById = new Map(genres.map((g) => [String(g?.id || ''), String(g?.name || '')]));

                const allGenresRes = await supabaseClient
                    .from('Genres')
                    .select('id, name');
                const allGenres = Array.isArray(allGenresRes?.data) ? allGenresRes.data : [];
                const allGenreNames = allGenres.map((g) => String(g?.name || '')).filter(Boolean).sort();

                let movieCrew = [];
                if (ratedMovieIds.length) {
                    const crewRes = await supabaseClient
                        .from('Movie Crew')
                        .select('movie_id, person_id, job')
                        .eq('job', 'Director')
                        .in('movie_id', ratedMovieIds);
                    movieCrew = Array.isArray(crewRes?.data) ? crewRes.data : [];
                }

                const directorIds = Array.from(new Set(movieCrew.map((row) => String(row?.person_id || '')).filter(Boolean)));
                let people = [];
                if (directorIds.length) {
                    const peopleRes = await supabaseClient
                        .from('People')
                        .select('id, name')
                        .in('id', directorIds);
                    people = Array.isArray(peopleRes?.data) ? peopleRes.data : [];
                }
                const peopleById = new Map(people.map((p) => [String(p?.id || ''), String(p?.name || '')]));

                const ratingsCount = ratedMovieIds.length;

                const genreSet = new Set();
                movieGenres.forEach((row) => {
                    const name = genreNamesById.get(String(row?.genre_id || ''));
                    if (name) genreSet.add(name);
                });
                const genreList = Array.from(genreSet).sort();

                const decadeSet = new Set();
                ratedMovieIds.forEach((movieId) => {
                    const year = Number(moviesById.get(movieId)?.release_year);
                    if (Number.isFinite(year) && year > 0) {
                        decadeSet.add(Math.floor(year / 10) * 10);
                    }
                });
                const decadeList = Array.from(decadeSet).sort((a, b) => a - b);

                const directorMovieMap = new Map();
                movieCrew.forEach((row) => {
                    const personId = String(row?.person_id || '');
                    const movieId = String(row?.movie_id || '');
                    if (!personId || !movieId) return;
                    if (!directorMovieMap.has(personId)) directorMovieMap.set(personId, new Set());
                    directorMovieMap.get(personId).add(movieId);
                });
                const directorCounts = Array.from(directorMovieMap.entries()).map(([personId, movieSet]) => ({
                    personId,
                    count: movieSet.size,
                    name: peopleById.get(personId) || 'Unknown Director',
                })).sort((a, b) => b.count - a.count);
                const topDirector = directorCounts[0] || null;

                const rewatchMap = new Map();
                watchLogs.forEach((row) => {
                    const movieId = String(row?.movie_id || '');
                    if (!movieId) return;
                    rewatchMap.set(movieId, (rewatchMap.get(movieId) || 0) + 1);
                });
                let topRewatch = null;
                let topRewatchIds = [];
                rewatchMap.forEach((count, movieId) => {
                    if (!topRewatch || count > topRewatch.count) {
                        topRewatch = { movieId, count };
                        topRewatchIds = [movieId];
                    } else if (topRewatch && count === topRewatch.count) {
                        topRewatchIds.push(movieId);
                    }
                });
                const topRewatchTitles = topRewatchIds.map((movieId) => String(moviesById.get(movieId)?.title || 'Unknown Movie'));

                const dailyCounts = new Map();
                const watchLogsByDay = new Map();
                watchLogs.forEach((row) => {
                    const dayNum = toDayNumber(row?.watch_date);
                    const movieId = String(row?.movie_id || '');
                    if (dayNum === null || !movieId) return;
                    dailyCounts.set(dayNum, (dailyCounts.get(dayNum) || 0) + 1);
                    if (!watchLogsByDay.has(dayNum)) watchLogsByDay.set(dayNum, []);
                    watchLogsByDay.get(dayNum).push(movieId);
                });
                const dailyEntries = Array.from(dailyCounts.entries()).sort((a, b) => a[0] - b[0]);

                let maxDayCount = 0;
                let maxDayNum = null;
                dailyEntries.forEach(([dayNum, count]) => {
                    if (count > maxDayCount) {
                        maxDayCount = count;
                        maxDayNum = dayNum;
                    }
                });

                let rollingWeekMax = 0;
                let rollingWeekEnd = null;
                let startIdx = 0;
                let sum = 0;
                for (let i = 0; i < dailyEntries.length; i += 1) {
                    const [dayNum, count] = dailyEntries[i];
                    sum += count;
                    while (dayNum - dailyEntries[startIdx][0] > 6) {
                        sum -= dailyEntries[startIdx][1];
                        startIdx += 1;
                    }
                    if (sum > rollingWeekMax) {
                        rollingWeekMax = sum;
                        rollingWeekEnd = dayNum;
                    }
                }

                let dailyStreakMax = 0;
                let bestStreakStart = null;
                let bestStreakEnd = null;
                let currentStreak = 0;
                let currentStreakStart = null;
                let prevDay = null;
                dailyEntries.forEach(([dayNum]) => {
                    if (prevDay === null || dayNum !== prevDay + 1) {
                        currentStreak = 1;
                        currentStreakStart = dayNum;
                    } else {
                        currentStreak += 1;
                    }
                    if (currentStreak > dailyStreakMax) {
                        dailyStreakMax = currentStreak;
                        bestStreakStart = currentStreakStart;
                        bestStreakEnd = dayNum;
                    }
                    prevDay = dayNum;
                });

                let currentDailyStreak = 0;
                let currentDailyStreakStart = null;
                let currentDailyStreakEnd = null;
                if (dailyEntries.length) {
                    currentDailyStreakEnd = dailyEntries[dailyEntries.length - 1][0];
                    currentDailyStreak = 1;
                    for (let i = dailyEntries.length - 2; i >= 0; i -= 1) {
                        const dayNum = dailyEntries[i][0];
                        const nextDay = dailyEntries[i + 1][0];
                        if (nextDay - dayNum === 1) {
                            currentDailyStreak += 1;
                        } else {
                            break;
                        }
                    }
                    currentDailyStreakStart = currentDailyStreakEnd - (currentDailyStreak - 1);
                }

                const weekStarts = Array.from(new Set(dailyEntries.map(([dayNum]) => getWeekStart(dayNum)))).sort((a, b) => a - b);
                let weeklyStreakMax = 0;
                let bestWeekStart = null;
                let bestWeekEnd = null;
                let currentWeekStreak = 0;
                let currentWeekStart = null;
                let prevWeek = null;
                weekStarts.forEach((weekStart) => {
                    if (prevWeek === null || weekStart !== prevWeek + 7) {
                        currentWeekStreak = 1;
                        currentWeekStart = weekStart;
                    } else {
                        currentWeekStreak += 1;
                    }
                    if (currentWeekStreak > weeklyStreakMax) {
                        weeklyStreakMax = currentWeekStreak;
                        bestWeekStart = currentWeekStart;
                        bestWeekEnd = weekStart;
                    }
                    prevWeek = weekStart;
                });

                let currentWeeklyStreak = 0;
                let currentWeeklyStreakStart = null;
                let currentWeeklyStreakEnd = null;
                if (weekStarts.length) {
                    currentWeeklyStreakEnd = weekStarts[weekStarts.length - 1];
                    currentWeeklyStreak = 1;
                    for (let i = weekStarts.length - 2; i >= 0; i -= 1) {
                        const weekStart = weekStarts[i];
                        const nextWeek = weekStarts[i + 1];
                        if (nextWeek - weekStart === 7) {
                            currentWeeklyStreak += 1;
                        } else {
                            break;
                        }
                    }
                    currentWeeklyStreakStart = currentWeeklyStreakEnd - (currentWeeklyStreak - 1) * 7;
                }

                let rollingWeekCurrent = 0;
                let rollingWeekCurrentEnd = null;
                if (dailyEntries.length) {
                    rollingWeekCurrentEnd = dailyEntries[dailyEntries.length - 1][0];
                    dailyEntries.forEach(([dayNum, count]) => {
                        if (dayNum >= rollingWeekCurrentEnd - 6 && dayNum <= rollingWeekCurrentEnd) {
                            rollingWeekCurrent += count;
                        }
                    });
                }

                const bestDayMovies = maxDayNum !== null
                    ? Array.from(new Set((watchLogsByDay.get(maxDayNum) || []).map((movieId) => String(moviesById.get(movieId)?.title || 'Unknown Movie'))))
                    : [];

                const rollingWeekMovies = rollingWeekEnd !== null
                    ? Array.from(new Set(Array.from(watchLogsByDay.entries())
                        .filter(([dayNum]) => dayNum >= rollingWeekEnd - 6 && dayNum <= rollingWeekEnd)
                        .flatMap(([, movieIds]) => movieIds)
                        .map((movieId) => String(moviesById.get(movieId)?.title || 'Unknown Movie'))))
                    : [];

                const bestDailyStreakMovies = (bestStreakStart !== null && bestStreakEnd !== null)
                    ? Array.from(new Set(Array.from(watchLogsByDay.entries())
                        .filter(([dayNum]) => dayNum >= bestStreakStart && dayNum <= bestStreakEnd)
                        .flatMap(([, movieIds]) => movieIds)
                        .map((movieId) => String(moviesById.get(movieId)?.title || 'Unknown Movie'))))
                    : [];

                achievementEvidenceCache = {
                    ratingsCount,
                    genreList,
                    decadeList,
                    directorCounts,
                    topDirector,
                    rewatchMax: topRewatch ? topRewatch.count : 0,
                    topRewatchTitle: topRewatchTitles[0] || null,
                    topRewatchTitles,
                    maxDayCount,
                    maxDayDate: maxDayNum !== null ? dayNumberToDate(maxDayNum) : null,
                    bestDayMovies,
                    rollingWeekMax,
                    rollingWeekEnd: rollingWeekEnd !== null ? dayNumberToDate(rollingWeekEnd) : null,
                    rollingWeekMovies,
                    rollingWeekCurrent,
                    rollingWeekCurrentEnd: rollingWeekCurrentEnd !== null ? dayNumberToDate(rollingWeekCurrentEnd) : null,
                    dailyStreakMax,
                    bestDailyStreakStart: bestStreakStart !== null ? dayNumberToDate(bestStreakStart) : null,
                    bestDailyStreakEnd: bestStreakEnd !== null ? dayNumberToDate(bestStreakEnd) : null,
                    bestDailyStreakMovies,
                    currentDailyStreak,
                    currentDailyStreakStart: currentDailyStreakStart !== null ? dayNumberToDate(currentDailyStreakStart) : null,
                    currentDailyStreakEnd: currentDailyStreakEnd !== null ? dayNumberToDate(currentDailyStreakEnd) : null,
                    weeklyStreakMax,
                    bestWeeklyStreakStart: bestWeekStart !== null ? dayNumberToDate(bestWeekStart) : null,
                    bestWeeklyStreakEnd: bestWeekEnd !== null ? dayNumberToDate(bestWeekEnd + 6) : null,
                    currentWeeklyStreak,
                    currentWeeklyStreakStart: currentWeeklyStreakStart !== null ? dayNumberToDate(currentWeeklyStreakStart) : null,
                    currentWeeklyStreakEnd: currentWeeklyStreakEnd !== null ? dayNumberToDate(currentWeeklyStreakEnd + 6) : null,
                    allGenres: allGenreNames,
                    missingGenres: allGenreNames.filter((genre) => !genreSet.has(genre)),
                };

                achievementEvidenceLoading = null;
                return achievementEvidenceCache;
            })();

            return achievementEvidenceLoading;
        }

        function getEmptyAchievementEvidence() {
            return {
                ratingsCount: 0,
                genreList: [],
                decadeList: [],
                directorCounts: [],
                topDirector: null,
                rewatchMax: 0,
                topRewatchTitle: null,
                topRewatchTitles: [],
                maxDayCount: 0,
                maxDayDate: null,
                bestDayMovies: [],
                rollingWeekMax: 0,
                rollingWeekEnd: null,
                rollingWeekMovies: [],
                rollingWeekCurrent: 0,
                rollingWeekCurrentEnd: null,
                dailyStreakMax: 0,
                bestDailyStreakStart: null,
                bestDailyStreakEnd: null,
                bestDailyStreakMovies: [],
                currentDailyStreak: 0,
                currentDailyStreakStart: null,
                currentDailyStreakEnd: null,
                weeklyStreakMax: 0,
                bestWeeklyStreakStart: null,
                bestWeeklyStreakEnd: null,
                currentWeeklyStreak: 0,
                currentWeeklyStreakStart: null,
                currentWeeklyStreakEnd: null,
                allGenres: [],
                missingGenres: [],
            };
        }

        function toDayNumber(dateInput) {
            const dateStr = String(dateInput || '').trim();
            if (!dateStr) return null;
            const parts = dateStr.split('-');
            if (parts.length < 3) return null;
            const year = Number(parts[0]);
            const month = Number(parts[1]);
            const day = Number(parts[2]);
            if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
            return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
        }

        function dayNumberToDate(dayNum) {
            const date = new Date(dayNum * 86400000);
            const year = date.getUTCFullYear();
            const month = String(date.getUTCMonth() + 1).padStart(2, '0');
            const day = String(date.getUTCDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }

        function getWeekStart(dayNum) {
            const date = new Date(dayNum * 86400000);
            const dow = date.getUTCDay();
            const offset = (dow + 6) % 7;
            return dayNum - offset;
        }

        function formatNameList(items, limit) {
            const list = Array.isArray(items) ? items.map((item) => String(item || '').trim()).filter(Boolean) : [];
            if (!list.length) return 'None yet';
            if (!limit || list.length <= limit) return list.join(', ');
            return `${list.slice(0, limit).join(', ')} (+${list.length - limit} more)`;
        }

        function buildAchievementEvidenceHtml(achievement, data, earned) {
            const name = String(achievement?.name || '').trim();
            const desc = String(achievement?.description || '').trim();

            const rules = {
                'First Screening': { type: 'ratings', threshold: 10 },
                'Film Buff': { type: 'ratings', threshold: 50 },
                'Dedicated Critic': { type: 'ratings', threshold: 250 },
                'Cinema Archivist': { type: 'ratings', threshold: 750 },
                'Screen Authority': { type: 'ratings', threshold: 1000 },
                'Screen Legend': { type: 'ratings', threshold: 1250 },
                'Master of Cinema': { type: 'ratings', threshold: 1500 },

                'Encore': { type: 'rewatch', threshold: 2 },
                'Comfort Classic': { type: 'rewatch', threshold: 3 },
                'Repeat Viewer': { type: 'rewatch', threshold: 5 },
                'Cult Favorite': { type: 'rewatch', threshold: 7 },
                'Devoted Fan': { type: 'rewatch', threshold: 10 },
                'Legendary Obsession': { type: 'rewatch', threshold: 15 },
                'Timeless Classic': { type: 'rewatch', threshold: 25 },

                'Director Devotee': { type: 'director', threshold: 4 },
                'Director Loyalist': { type: 'director', threshold: 6 },
                'Director Disciple': { type: 'director', threshold: 8 },
                'Director Specialist': { type: 'director', threshold: 10 },
                'Director Scholar': { type: 'director', threshold: 12 },
                'Director Archivist': { type: 'director', threshold: 15 },
                'Director Master': { type: 'director', threshold: 20 },

                'Genre Explorer': { type: 'genre', threshold: 4 },
                'Genre Hopper': { type: 'genre', threshold: 6 },
                'Genre Connoisseur': { type: 'genre', threshold: 8 },
                'Genre Specialist': { type: 'genre', threshold: 10 },
                'Genre Authority': { type: 'genre', threshold: 12 },
                'Genre Virtuoso': { type: 'genre', threshold: 14 },
                'Genre Completionist': { type: 'genre', threshold: 16 },

                'Time Traveler': { type: 'decade', threshold: 3 },
                'Decade Explorer': { type: 'decade', threshold: 5 },
                'Era Enthusiast': { type: 'decade', threshold: 7 },
                'Decade Specialist': { type: 'decade', threshold: 9 },
                'Century Wanderer': { type: 'decade', threshold: 11 },
                'Historical Archivist': { type: 'decade', threshold: 13 },
                'Timeline Master': { type: 'decade', threshold: 14 },

                'Double Feature': { type: 'day', threshold: 2 },
                'Opening Weekend': { type: 'day', threshold: 5 },
                'Marathon Critic': { type: 'week', threshold: 10 },
                'Festival Run': { type: 'day_streak', threshold: 7 },
                'Premiere Season': { type: 'day_streak', threshold: 30 },
                'Endurance Champion': { type: 'day_streak', threshold: 365 },
                'Year-Long Viewer': { type: 'week_streak', threshold: 52 },
            };

            const rule = rules[name] || null;
            const detailItems = [];
            let progressValue = null;

            if (rule?.type === 'ratings') {
                progressValue = data.ratingsCount;
                detailItems.push({ label: 'Total rated', value: `${data.ratingsCount} movies` });
            } else if (rule?.type === 'rewatch') {
                progressValue = data.rewatchMax;
                detailItems.push({ label: 'Most rewatches', value: `${data.rewatchMax} times` });
                detailItems.push({ label: 'Top rewatched', value: formatNameList(data.topRewatchTitles, 5) });
            } else if (rule?.type === 'director') {
                progressValue = data.topDirector ? data.topDirector.count : 0;
                detailItems.push({
                    label: 'Top director',
                    value: data.topDirector ? `${data.topDirector.name} (${data.topDirector.count})` : 'None yet',
                });
                const topDirectors = data.directorCounts.slice(0, 3).map((row) => `${row.name} (${row.count})`);
                detailItems.push({ label: 'Top 3 directors', value: formatNameList(topDirectors, 3) });
            } else if (rule?.type === 'genre') {
                progressValue = data.genreList.length;
                detailItems.push({ label: 'Genres seen', value: formatNameList(data.genreList, 10) });
                detailItems.push({ label: 'Genres missing', value: formatNameList(data.missingGenres, 10) });
                detailItems.push({ label: 'Totals', value: `${data.genreList.length} seen / ${data.allGenres.length} total` });
            } else if (rule?.type === 'decade') {
                progressValue = data.decadeList.length;
                const decades = data.decadeList.map((d) => `${d}s`);
                detailItems.push({ label: 'Decades seen', value: formatNameList(decades, 10) });
                detailItems.push({ label: 'Total decades', value: `${data.decadeList.length}` });
            } else if (rule?.type === 'day') {
                progressValue = data.maxDayCount;
                detailItems.push({
                    label: 'Best day',
                    value: data.maxDayDate ? `${data.maxDayDate} (${data.maxDayCount} movies)` : 'None yet',
                });
                detailItems.push({ label: 'Movies that day', value: formatNameList(data.bestDayMovies, 6) });
            } else if (rule?.type === 'week') {
                progressValue = data.rollingWeekMax;
                detailItems.push({
                    label: 'Best 7-day stretch',
                    value: data.rollingWeekEnd ? `${data.rollingWeekMax} movies (ending ${data.rollingWeekEnd})` : 'None yet',
                });
                detailItems.push({
                    label: 'Current 7-day stretch',
                    value: data.rollingWeekCurrentEnd ? `${data.rollingWeekCurrent} movies (ending ${data.rollingWeekCurrentEnd})` : 'None yet',
                });
                detailItems.push({ label: 'Movies in best stretch', value: formatNameList(data.rollingWeekMovies, 6) });
            } else if (rule?.type === 'day_streak') {
                progressValue = data.dailyStreakMax;
                detailItems.push({
                    label: 'Best streak',
                    value: data.bestDailyStreakStart && data.bestDailyStreakEnd
                        ? `${data.dailyStreakMax} days (${data.bestDailyStreakStart} to ${data.bestDailyStreakEnd})`
                        : 'None yet',
                });
                detailItems.push({
                    label: 'Current streak',
                    value: data.currentDailyStreakEnd
                        ? `${data.currentDailyStreak} days (ending ${data.currentDailyStreakEnd})`
                        : 'None yet',
                });
                detailItems.push({ label: 'Movies in best streak', value: formatNameList(data.bestDailyStreakMovies, 8) });
            } else if (rule?.type === 'week_streak') {
                progressValue = data.weeklyStreakMax;
                detailItems.push({
                    label: 'Best weekly streak',
                    value: data.bestWeeklyStreakStart && data.bestWeeklyStreakEnd
                        ? `${data.weeklyStreakMax} weeks (${data.bestWeeklyStreakStart} to ${data.bestWeeklyStreakEnd})`
                        : 'None yet',
                });
                detailItems.push({
                    label: 'Current weekly streak',
                    value: data.currentWeeklyStreakEnd
                        ? `${data.currentWeeklyStreak} weeks (ending ${data.currentWeeklyStreakEnd})`
                        : 'None yet',
                });
            } else {
                detailItems.push({ label: 'Details', value: 'This achievement needs a custom rule.' });
            }

            const statusText = earned ? 'Earned' : 'Locked';
            const progressText = rule && progressValue !== null
                ? `${Math.min(rule.threshold, progressValue)}/${rule.threshold}`
                : '';

            const detailHtml = detailItems.map((item) => `
                <div class="achievement-detail-item">
                    <div class="achievement-detail-label">${escapeHtml(item.label)}</div>
                    <div class="achievement-detail-value">${escapeHtml(item.value)}</div>
                </div>
            `).join('');

            return `
                <div class="text-xs" style="text-transform: uppercase; letter-spacing: 0.08em; font-weight: 800; color: rgba(255,255,255,0.65);">${escapeHtml(statusText)}</div>
                ${desc ? `<div style="margin-top: 0.35rem;">${escapeHtml(desc)}</div>` : ''}
                <div class="achievement-detail-list">
                    ${rule ? `
                        <div class="achievement-detail-item">
                            <div class="achievement-detail-label">Progress</div>
                            <div class="achievement-detail-value">${escapeHtml(String(progressValue ?? 0))} (${escapeHtml(progressText)})</div>
                        </div>
                    ` : ''}
                    ${detailHtml}
                </div>
            `;
        }

        async function refreshAchievementsUI() {
            if (!cachedIsAuthed) {
                renderAccountTierSummary();
                renderAccountAchievements();
                return;
            }
            const uid = String(cachedAuthUser?.id || '').trim();
            if (!uid) return;
            await Promise.all([
                loadAchievementsDefinitions(),
                loadUserAchievements(uid),
                loadUserTierSummary(uid),
            ]);
            if (testAchievementEnabled) syncTestAchievementOptions();
            renderAccountTierSummary();
            renderAccountAchievements();
        }

        function enqueueAchievementPopup(achievement) {
            if (!achievement) return;
            achievementPopupQueue.push(achievement);
            if (!achievementPopupOpen) showNextAchievementPopup();
        }

        let achievementCloseAnimating = false;

        const ACHIEVEMENT_SWIPE_PATHS = {
            start: 'M0,340 C210,120 380,120 580,220 C780,320 860,520 1000,470 L1000,600 L0,600 Z',
            mid: 'M0,260 C240,60 420,140 640,260 C820,380 860,540 1000,520 L1000,600 L0,600 Z',
            end: 'M0,180 C260,40 480,160 700,300 C860,440 880,600 1000,600 L1000,600 L0,600 Z',
        };
        const ACHIEVEMENT_MOTION_PATH = 'M-40,520 C180,120 420,60 720,200 C980,340 900,520 1040,620';
        const ACHIEVEMENT_ANIM_SLOWDOWN = 3;
        const ACHIEVEMENT_ANIM_TIME_SCALE = 1 / ACHIEVEMENT_ANIM_SLOWDOWN;

        function registerAchievementPlugins() {
            if (!window.gsap) return;
            const plugins = [];
            if (window.MorphSVGPlugin) plugins.push(window.MorphSVGPlugin);
            if (window.MotionPathPlugin) plugins.push(window.MotionPathPlugin);
            if (window.DrawSVGPlugin) plugins.push(window.DrawSVGPlugin);
            if (plugins.length) gsap.registerPlugin(...plugins);
        }

        function buildAchievementPieces(overlay) {
            const container = document.getElementById('achievement-pieces');
            if (!container) return [];

            container.innerHTML = '';
            const pieces = [];
            const pieceCount = 22;
            const tierRgb = getComputedStyle(overlay).getPropertyValue('--tier-rgb').trim() || '148, 163, 184';
            const colors = [
                `rgba(${tierRgb}, 0.95)`,
                'rgba(255, 255, 255, 0.9)',
                `rgba(${tierRgb}, 0.65)`,
            ];

            for (let i = 0; i < pieceCount; i += 1) {
                const piece = document.createElement('div');
                piece.className = 'achievement-piece';
                const size = 8 + Math.random() * 18;
                const radius = Math.random() > 0.6 ? size * 0.5 : size * 0.2;
                piece.style.width = `${size}px`;
                piece.style.height = `${size}px`;
                piece.style.borderRadius = `${radius}px`;
                piece.style.background = colors[i % colors.length];
                piece.style.left = `${Math.random() * 100}%`;
                piece.style.top = `${Math.random() * 100}%`;
                container.appendChild(piece);
                pieces.push(piece);
            }

            return pieces;
        }

        function playAchievementCelebrationBurst({ overlay, splashEl, swipeEl, swipePathEl, swipeStrokeEl, motionPathEl, modal, iconEl }) {
            if (!window.gsap) return;

            registerAchievementPlugins();
            const canMorph = !!window.MorphSVGPlugin;
            const canMotion = !!window.MotionPathPlugin;
            const canDraw = !!window.DrawSVGPlugin;

            const pieces = buildAchievementPieces(overlay);
            gsap.killTweensOf([overlay, splashEl, swipeEl, swipePathEl, swipeStrokeEl, motionPathEl, pieces, modal, iconEl]);

            gsap.set(splashEl, { opacity: 0, scale: 0.35, rotate: -20, filter: 'blur(8px) saturate(1.2)', force3D: true });
            gsap.set(swipeEl, { opacity: 0, scaleX: 0.9, scaleY: 0.95, force3D: true });
            gsap.set(swipePathEl, { attr: { d: ACHIEVEMENT_SWIPE_PATHS.start } });
            gsap.set(swipeStrokeEl, { opacity: 0, force3D: true });
            gsap.set(motionPathEl, { attr: { d: ACHIEVEMENT_MOTION_PATH } });
            gsap.set(pieces, { opacity: 0, scale: 0.2, xPercent: -50, yPercent: -50, force3D: true });

            if (canDraw && swipeStrokeEl) {
                gsap.set(swipeStrokeEl, { drawSVG: '0% 0%' });
            }

            const timeline = gsap.timeline()
                .to(splashEl, { opacity: 0.9, scale: 1.2, rotate: 14, duration: 0.5, ease: 'expo.out' }, 0)
                .to(splashEl, { opacity: 0.35, scale: 1.45, rotate: 28, duration: 0.6, ease: 'sine.out' }, 0.45)
                .to(splashEl, { opacity: 0, scale: 1.7, rotate: 40, duration: 0.5, ease: 'expo.out' }, 1)
                .to(swipeEl, { opacity: 1, scaleX: 1.05, scaleY: 1.05, duration: 0.3, ease: 'sine.out' }, 0)
                .to(swipePathEl, canMorph ? { morphSVG: ACHIEVEMENT_SWIPE_PATHS.mid, duration: 0.45, ease: 'expo.out' } : { attr: { d: ACHIEVEMENT_SWIPE_PATHS.mid }, duration: 0.45, ease: 'expo.out' }, 0)
                .to(swipePathEl, canMorph ? { morphSVG: ACHIEVEMENT_SWIPE_PATHS.end, duration: 0.45, ease: 'expo.inOut' } : { attr: { d: ACHIEVEMENT_SWIPE_PATHS.end }, duration: 0.45, ease: 'expo.inOut' }, 0.45)
                .to(swipeEl, { opacity: 0, duration: 0.35, ease: 'sine.out' }, 0.8)
                .to(pieces, {
                    opacity: 1,
                    scale: 1,
                    x: () => gsap.utils.random(-380, 380),
                    y: () => gsap.utils.random(-260, 260),
                    rotation: () => gsap.utils.random(-200, 200),
                    duration: 0.75,
                    ease: 'back.out(2.2)',
                    stagger: { each: 0.012, from: 'random' },
                }, 0.1)
                .to(pieces, {
                    y: '+=220',
                    x: () => gsap.utils.random(-140, 140),
                    rotation: () => gsap.utils.random(-160, 160),
                    duration: 0.95,
                    ease: 'power2.in',
                    stagger: { each: 0.02, from: 'random' },
                }, 0.85)
                .to(pieces, { opacity: 0, duration: 0.35, ease: 'power1.out', stagger: 0.01 }, 1.35)
                .to(modal, { scale: 1.03, duration: 0.18, ease: 'power1.out' }, 0.25)
                .to(modal, { scale: 1, duration: 0.2, ease: 'power1.inOut' }, 0.43)
                .to(iconEl, { rotate: 8, duration: 0.12, ease: 'power1.out' }, 0.3)
                .to(iconEl, { rotate: 0, duration: 0.18, ease: 'power1.inOut' }, 0.42);

            timeline.timeScale(ACHIEVEMENT_ANIM_TIME_SCALE);

            if (canDraw && swipeStrokeEl) {
                timeline
                    .to(swipeStrokeEl, { opacity: 1, drawSVG: '0% 100%', duration: 0.55, ease: 'power2.out' }, 0.05)
                    .to(swipeStrokeEl, { opacity: 0, duration: 0.3, ease: 'power1.out' }, 0.7);
            }

            if (canMotion && motionPathEl && pieces.length) {
                const motionPieces = pieces.slice(0, 8);
                timeline.to(motionPieces, {
                    opacity: 1,
                    motionPath: {
                        path: motionPathEl,
                        align: motionPathEl,
                        autoRotate: true,
                        alignOrigin: [0.5, 0.5],
                    },
                    duration: 1.1,
                    ease: 'power2.out',
                    stagger: 0.03,
                }, 0.2);
            }
        }

        function replayAchievementCelebration() {
            const overlay = document.getElementById('achievement-earned-overlay');
            if (!overlay || overlay.style.display === 'none') return;

            const splashEl = document.getElementById('achievement-splash');
            const swipeEl = document.getElementById('achievement-swipe');
            const swipePathEl = document.getElementById('achievement-swipe-path');
            const swipeStrokeEl = document.getElementById('achievement-swipe-stroke');
            const motionPathEl = document.getElementById('achievement-motion-path');
            const modalEl = document.getElementById('achievement-earned-modal');
            const iconEl = document.getElementById('achievement-earned-icon');
            if (!splashEl || !swipeEl || !swipePathEl || !swipeStrokeEl || !motionPathEl || !modalEl || !iconEl) return;

            playAchievementCelebrationBurst({
                overlay,
                splashEl,
                swipeEl,
                swipePathEl,
                swipeStrokeEl,
                motionPathEl,
                modal: modalEl,
                iconEl,
            });
        }

        function playAchievementPopupOpen({ overlay, modal, iconEl, titleEl, nameEl, descEl, bodyEl, splashEl, swipeEl, swipePathEl, swipeStrokeEl, motionPathEl }) {
            overlay.style.display = 'flex';
            overlay.classList.add('open');

            if (!window.gsap) return;

            registerAchievementPlugins();
            const canMorph = !!window.MorphSVGPlugin;
            const canDraw = !!window.DrawSVGPlugin;

            const pieces = buildAchievementPieces(overlay);
            gsap.killTweensOf([overlay, modal, iconEl, titleEl, nameEl, descEl, bodyEl, splashEl, swipeEl, swipePathEl, swipeStrokeEl, motionPathEl, pieces]);
            gsap.set(overlay, { opacity: 0 });
            gsap.set(splashEl, { opacity: 0, scale: 0.25, rotate: -25, filter: 'blur(8px) saturate(1.2)', force3D: true });
            gsap.set(swipeEl, { opacity: 0, scaleX: 0.9, scaleY: 0.95, force3D: true });
            gsap.set(swipePathEl, { attr: { d: ACHIEVEMENT_SWIPE_PATHS.start } });
            gsap.set(swipeStrokeEl, { opacity: 0, force3D: true });
            gsap.set(motionPathEl, { attr: { d: ACHIEVEMENT_MOTION_PATH } });
            gsap.set(modal, { opacity: 0, y: 180, scale: 0.3, rotate: -8, force3D: true });
            gsap.set(iconEl, { opacity: 0, scale: 0.2, rotate: -90, force3D: true });
            gsap.set([titleEl, nameEl, descEl], { opacity: 0, y: 24 });
            gsap.set(bodyEl, { opacity: 0, scale: 0.9, force3D: true });
            gsap.set(pieces, { opacity: 0, scale: 0.2, xPercent: -50, yPercent: -50, force3D: true });

            if (canDraw && swipeStrokeEl) {
                gsap.set(swipeStrokeEl, { drawSVG: '0% 0%' });
            }

            const timeline = gsap.timeline()
                .to(overlay, { opacity: 1, duration: 0.2, ease: 'power2.out' }, 0)
                .to(splashEl, { opacity: 0.9, scale: 1.25, rotate: 18, duration: 0.65, ease: 'expo.out' }, 0)
                .to(splashEl, { opacity: 0.35, scale: 1.45, rotate: 36, duration: 0.6, ease: 'sine.out' }, 0.65)
                .to(splashEl, { opacity: 0.28, scale: 1.6, rotate: 52, duration: 0.85, ease: 'expo.out' }, 1.15)
                .to(swipeEl, { opacity: 1, scaleX: 1.05, scaleY: 1.05, duration: 0.3, ease: 'sine.out' }, 0)
                .to(swipePathEl, canMorph ? { morphSVG: ACHIEVEMENT_SWIPE_PATHS.mid, duration: 0.45, ease: 'expo.out' } : { attr: { d: ACHIEVEMENT_SWIPE_PATHS.mid }, duration: 0.45, ease: 'expo.out' }, 0)
                .to(swipePathEl, canMorph ? { morphSVG: ACHIEVEMENT_SWIPE_PATHS.end, duration: 0.45, ease: 'expo.inOut' } : { attr: { d: ACHIEVEMENT_SWIPE_PATHS.end }, duration: 0.45, ease: 'expo.inOut' }, 0.45)
                .to(swipeEl, { opacity: 0, duration: 0.6, ease: 'sine.out' }, 1.8)
                .to(pieces, {
                    opacity: 1,
                    scale: 1,
                    x: () => gsap.utils.random(-380, 380),
                    y: () => gsap.utils.random(-260, 260),
                    rotation: () => gsap.utils.random(-200, 200),
                    duration: 0.8,
                    ease: 'back.out(2.2)',
                    stagger: { each: 0.012, from: 'random' },
                }, 0.1)
                .to(pieces, {
                    y: '+=220',
                    x: () => gsap.utils.random(-140, 140),
                    rotation: () => gsap.utils.random(-160, 160),
                    duration: 0.95,
                    ease: 'power2.in',
                    stagger: { each: 0.02, from: 'random' },
                }, 0.85)
                .to(pieces, { opacity: 0, duration: 0.6, ease: 'power1.out', stagger: 0.01 }, 2.35)
                .to(modal, { opacity: 1, y: 0, scale: 1.08, rotate: 0, duration: 0.8, ease: 'back.out(1.7)' }, 0.5)
                .to(modal, { scale: 1, duration: 0.25, ease: 'power2.out' }, 1.15)
                .to(iconEl, { opacity: 1, scale: 1.2, rotate: 0, duration: 0.6, ease: 'back.out(2.2)' }, 0.55)
                .to(iconEl, { scale: 1, duration: 0.2, ease: 'power2.out' }, 1.12)
                .to(bodyEl, { opacity: 1, scale: 1, duration: 0.22, ease: 'power2.out' }, 0.45)
                .to([titleEl, nameEl, descEl], { opacity: 1, y: 0, duration: 0.24, stagger: 0.05, ease: 'power2.out' }, 0.5)
                .to(splashEl, { opacity: 0, scale: 1.9, duration: 0.8, ease: 'sine.out' }, 2.2);

            timeline.timeScale(ACHIEVEMENT_ANIM_TIME_SCALE);

            if (canDraw && swipeStrokeEl) {
                timeline
                    .to(swipeStrokeEl, { opacity: 1, drawSVG: '0% 100%', duration: 0.55, ease: 'power2.out' }, 0.05)
                    .to(swipeStrokeEl, { opacity: 0, duration: 0.3, ease: 'power1.out' }, 0.7);
            }
        }

        function playAchievementPopupClose({ overlay, modal, iconEl, titleEl, nameEl, descEl, bodyEl, splashEl, swipeEl, swipePathEl, swipeStrokeEl, motionPathEl }) {
            if (!window.gsap) {
                overlay.classList.remove('open');
                overlay.style.display = 'none';
                return;
            }

            const pieces = Array.from(document.querySelectorAll('#achievement-pieces .achievement-piece'));
            gsap.killTweensOf([overlay, modal, iconEl, titleEl, nameEl, descEl, bodyEl, splashEl, swipeEl, swipePathEl, swipeStrokeEl, motionPathEl, pieces]);
            const timeline = gsap.timeline()
                .set(splashEl, { opacity: 0, scale: 0.8, rotate: -12 }, 0)
                .set(swipeEl, { opacity: 0, scaleX: 0.9, scaleY: 0.95 }, 0)
                .set(swipePathEl, { attr: { d: ACHIEVEMENT_SWIPE_PATHS.start } }, 0)
                .set(swipeStrokeEl, { opacity: 0 }, 0)
                .set(motionPathEl, { attr: { d: ACHIEVEMENT_MOTION_PATH } }, 0)
                .to([titleEl, nameEl, descEl, bodyEl], { opacity: 0, y: -10, duration: 0.18, ease: 'power1.in' }, 0)
                .to(iconEl, { opacity: 0, scale: 0.6, rotate: -18, duration: 0.2, ease: 'power1.in' }, 0)
                .to(modal, { opacity: 0, y: 60, scale: 0.85, rotate: 6, duration: 0.28, ease: 'power2.in' }, 0.05)
                .to(splashEl, { opacity: 0.35, scale: 1.1, rotate: -28, duration: 0.18, ease: 'power1.out' }, 0.02)
                .to(splashEl, { opacity: 0, scale: 1.4, rotate: -40, duration: 0.26, ease: 'power2.in' }, 0.2)
                .to(pieces, { opacity: 0, duration: 0.2, ease: 'power1.out' }, 0)
                .to(overlay, { opacity: 0, duration: 0.25, ease: 'power1.in' }, 0.12);
            timeline.timeScale(ACHIEVEMENT_ANIM_TIME_SCALE);
        }

        function showNextAchievementPopup() {
            if (achievementPopupOpen) return;
            const next = achievementPopupQueue.shift();
            if (!next) return;
            achievementPopupOpen = true;

            const overlay = document.getElementById('achievement-earned-overlay');
            const nameEl = document.getElementById('achievement-earned-name');
            const descEl = document.getElementById('achievement-earned-desc');
            const iconEl = document.getElementById('achievement-earned-icon');
            const bodyEl = document.getElementById('achievement-earned-body');
            const modalEl = document.getElementById('achievement-earned-modal');
            const splashEl = document.getElementById('achievement-splash');
            const swipeEl = document.getElementById('achievement-swipe');
            const swipePathEl = document.getElementById('achievement-swipe-path');
            const swipeStrokeEl = document.getElementById('achievement-swipe-stroke');
            const motionPathEl = document.getElementById('achievement-motion-path');
            if (!overlay || !nameEl || !descEl || !iconEl || !bodyEl || !modalEl || !splashEl || !swipeEl || !swipePathEl || !swipeStrokeEl || !motionPathEl) return;

            const normalizeAchievementTier = (raw) => {
                const key = String(raw || '').trim().toLowerCase();
                const map = {
                    bronze: 'Bronze',
                    silver: 'Silver',
                    gold: 'Gold',
                    platinum: 'Platinum',
                    diamond: 'Diamond',
                    emerald: 'Emerald',
                    ruby: 'Ruby',
                };
                return map[key] || '';
            };

            const name = String(next?.name || '').trim() || 'Achievement';
            const desc = String(next?.description || '').trim() || 'Achievement earned.';
            const iconUrl = String(next?.icon_url || '').trim();
            const tier = normalizeAchievementTier(next?.tier);
            nameEl.textContent = name;
            descEl.textContent = desc;
            iconEl.innerHTML = iconUrl
                ? `<img src="${iconUrl}" alt="${escapeHtml(name)}">`
                : '<span class="text-xs text-gray">?</span>';
            bodyEl.setAttribute('data-tier', tier || '');
            modalEl.setAttribute('data-tier', tier || '');
            overlay.setAttribute('data-tier', tier || '');

            playAchievementPopupOpen({
                overlay,
                modal: modalEl,
                iconEl,
                titleEl: document.getElementById('achievement-earned-title'),
                nameEl,
                descEl,
                bodyEl,
                splashEl,
                swipeEl,
                swipePathEl,
                swipeStrokeEl,
                motionPathEl,
            });
        }

        function closeAchievementPopup() {
            const overlay = document.getElementById('achievement-earned-overlay');
            if (!overlay || achievementCloseAnimating) return;

            const modalEl = document.getElementById('achievement-earned-modal');
            const iconEl = document.getElementById('achievement-earned-icon');
            const titleEl = document.getElementById('achievement-earned-title');
            const nameEl = document.getElementById('achievement-earned-name');
            const descEl = document.getElementById('achievement-earned-desc');
            const bodyEl = document.getElementById('achievement-earned-body');
            const splashEl = document.getElementById('achievement-splash');
            const swipeEl = document.getElementById('achievement-swipe');
            const swipePathEl = document.getElementById('achievement-swipe-path');
            const swipeStrokeEl = document.getElementById('achievement-swipe-stroke');
            const motionPathEl = document.getElementById('achievement-motion-path');

            achievementCloseAnimating = true;
            playAchievementPopupClose({
                overlay,
                modal: modalEl,
                iconEl,
                titleEl,
                nameEl,
                descEl,
                bodyEl,
                splashEl,
                swipeEl,
                swipePathEl,
                swipeStrokeEl,
                motionPathEl,
            });

            const finalize = () => {
                overlay.classList.remove('open');
                overlay.style.display = 'none';
                achievementPopupOpen = false;
                achievementCloseAnimating = false;
                if (achievementPopupQueue.length) {
                    setTimeout(showNextAchievementPopup, 150);
                }
            };

            if (!window.gsap) {
                finalize();
                return;
            }

            gsap.delayedCall(0.25 * ACHIEVEMENT_ANIM_SLOWDOWN, finalize);
        }

        async function checkAndAwardRatingMilestones() {
            if (!supabaseClient || !cachedIsAuthed) return;
            const uid = String(cachedAuthUser?.id || '').trim();
            if (!uid) return;

            await loadAchievementsDefinitions();
            await loadUserAchievements(uid);

            const { count, error } = await supabaseClient
                .from('Movie Ratings')
                .select('movie_id', { count: 'exact', head: true })
                .eq('user_id', uid);

            if (error || !Number.isFinite(count)) return;

            const newlyEarned = [];
            for (const milestone of RATING_MILESTONES) {
                if (count < milestone) continue;
                const name = buildRatingAchievementName(milestone);
                const def = achievementsByName.get(name);
                const achievementId = String(def?.id || '').trim();
                if (!achievementId || userAchievementIds.has(achievementId)) continue;
                newlyEarned.push({ def, achievementId });
            }

            if (!newlyEarned.length) return;

            const rows = newlyEarned.map((item) => ({
                user_id: uid,
                achievement_id: item.achievementId,
            }));

            const { error: insertError } = await supabaseClient
                .from('User Achievements')
                .insert(rows);

            if (insertError) return;

            newlyEarned.forEach((item) => {
                if (item.achievementId) userAchievementIds.add(item.achievementId);
                if (item.def) enqueueAchievementPopup(item.def);
            });

            renderAccountAchievements();
        }

        function openRatingsSuccessModal(kind) {
            const overlay = document.getElementById('ratings-success-overlay');
            const titleEl = document.getElementById('ratings-success-title');
            if (!overlay) return;

            const k = String(kind || '').toLowerCase();
            if (titleEl) {
                titleEl.textContent = (k === 'updated') ? 'Movie Ratings Updated' : 'Movie Ratings Saved';
            }

            overlay.style.display = 'flex';
            overlay.classList.add('open');

            if (ratingsSuccessTimer) {
                clearTimeout(ratingsSuccessTimer);
                ratingsSuccessTimer = null;
            }

            ratingsSuccessTimer = setTimeout(() => {
                closeRatingsSuccessModal();
            }, 3000);
        }

        function closeRatingsSuccessModal() {
            const overlay = document.getElementById('ratings-success-overlay');

            if (ratingsSuccessTimer) {
                clearTimeout(ratingsSuccessTimer);
                ratingsSuccessTimer = null;
            }

            if (!overlay) return;
            overlay.classList.remove('open');
            overlay.style.display = 'none';
        }

