import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RUNTIME_BIN_MINUTES = 10;

// Bayesian shrinkage: a group's average is pulled toward the user's personal mean
// by SHRINK_K pseudo-counts, so a genre/person/bin seen only once or twice doesn't
// create a fake "favorite". A group needs ~SHRINK_K ratings before it's trusted
// over the prior. People also require a hard MIN_PEOPLE_COUNT before ranking.
const SHRINK_K = 5;
const MIN_PEOPLE_COUNT = 2;
// Keywords are far more numerous + sparse than genres, so require more evidence
// before one counts, and cap how many we keep so the stored JSON stays small.
const MIN_KEYWORD_COUNT = 3;
const MAX_KEYWORDS_STORED = 60;

// Pull `avg` (over `count` samples) toward `prior` by SHRINK_K pseudo-counts.
function shrink(avg, count, prior, k = SHRINK_K) {
  const n = Number(count) || 0;
  const a = Number(avg);
  const p = Number(prior) || 0;
  if (!Number.isFinite(a) || n <= 0) return p;
  return (n * a + k * p) / (n + k);
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

function uniqStrings(arr) {
  const seen = new Set();
  const out = [];
  (Array.isArray(arr) ? arr : []).forEach((v) => {
    const s = String(v || "").trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  });
  return out;
}

function mean(nums) {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function median(nums) {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function stddev(nums) {
  if (nums.length < 2) return 0;
  const m = mean(nums);
  const variance = nums.reduce((acc, v) => acc + (v - m) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}

function percentile(nums, p) {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

function correlation(xs, ys) {
  if (xs.length < 2 || ys.length < 2 || xs.length !== ys.length) return 0;
  const meanX = mean(xs);
  const meanY = mean(ys);
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0 || denY === 0) return 0;
  return num / Math.sqrt(denX * denY);
}

async function fetchAllUserRatings(supabaseAdmin, userId) {
  const results = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from("user_library_items_v2")
      .select(
        "movie_id, overall_rating, sound_rating, pacing_rating, imagery_rating, acting_rating, plot_rating, dialogue_rating, runtime_minutes, release_year, imdb_rating_pct"
      )
      .eq("user_id", userId)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    results.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return results;
}

async function fetchPeopleByMovieIds(supabaseAdmin, movieIds) {
  const castRows = [];
  const crewRows = [];
  const chunkSize = 200;
  for (let i = 0; i < movieIds.length; i += chunkSize) {
    const chunk = movieIds.slice(i, i + chunkSize);

    const { data: cast, error: castErr } = await supabaseAdmin
      .from("Movie Cast")
      .select("movie_id, person_id")
      .in("movie_id", chunk);
    if (castErr) throw castErr;
    if (Array.isArray(cast)) castRows.push(...cast);

    const { data: crew, error: crewErr } = await supabaseAdmin
      .from("Movie Crew")
      .select("movie_id, person_id, job")
      .in("movie_id", chunk);
    if (crewErr) throw crewErr;
    if (Array.isArray(crew)) crewRows.push(...crew);
  }
  return { castRows, crewRows };
}

async function fetchPeopleNames(supabaseAdmin, personIds) {
  const map = new Map();
  if (!Array.isArray(personIds) || personIds.length === 0) return map;
  const chunkSize = 100;
  for (let i = 0; i < personIds.length; i += chunkSize) {
    const chunk = personIds.slice(i, i + chunkSize);
    const { data, error } = await supabaseAdmin
      .from("People")
      .select("id, name")
      .in("id", chunk);
    if (error) throw error;
    if (Array.isArray(data)) {
      data.forEach((row) => {
        map.set(String(row.id), String(row.name || "").trim());
      });
    }
  }
  return map;
}

async function fetchGenresByMovieIds(supabaseAdmin, movieIds) {
  // Returns Map<movieId, string[]> of genre names for the given movies.
  const genreByMovie = new Map();
  if (!Array.isArray(movieIds) || movieIds.length === 0) return genreByMovie;

  const links = [];
  const chunkSize = 200;
  for (let i = 0; i < movieIds.length; i += chunkSize) {
    const chunk = movieIds.slice(i, i + chunkSize);
    const { data, error } = await supabaseAdmin
      .from("Movie Genres")
      .select("movie_id, genre_id")
      .in("movie_id", chunk);
    if (error) throw error;
    if (Array.isArray(data)) links.push(...data);
  }
  if (links.length === 0) return genreByMovie;

  const genreIds = Array.from(new Set(links.map((r) => r.genre_id).filter((v) => v != null)));
  const genreNameById = new Map();
  for (let i = 0; i < genreIds.length; i += 100) {
    const chunk = genreIds.slice(i, i + 100);
    const { data, error } = await supabaseAdmin
      .from("Genres")
      .select("id, name")
      .in("id", chunk);
    if (error) throw error;
    if (Array.isArray(data)) {
      data.forEach((g) => genreNameById.set(String(g.id), String(g.name || "").trim()));
    }
  }

  links.forEach((row) => {
    const mid = String(row.movie_id);
    const name = genreNameById.get(String(row.genre_id));
    if (!name) return;
    if (!genreByMovie.has(mid)) genreByMovie.set(mid, []);
    genreByMovie.get(mid).push(name);
  });
  return genreByMovie;
}

// Compute and upsert ONE user's taste profile. Returns a plain summary object
// (no HTTP). Shared by the per-user authed call and the cron batch sweep.
async function computeAndStoreTasteProfile(supabaseAdmin, userId) {
    const rows = await fetchAllUserRatings(supabaseAdmin, userId);
    if (!rows.length) {
      return { ok: false, user_id: userId, reason: "no_ratings" };
    }

    const overallRatings = [];
    const imdbDeltas = [];
    const runtimeBins = {};
    const decadeBins = {};

    const subRatings = {
      sound: { x: [], y: [] },
      pace: { x: [], y: [] },
      imagery: { x: [], y: [] },
      acting: { x: [], y: [] },
      plot: { x: [], y: [] },
      dialogue: { x: [], y: [] },
    };

    const movieRatingById = new Map();

    rows.forEach((r) => {
      const overall = Number(r?.overall_rating);
      if (!Number.isFinite(overall)) return;
      overallRatings.push(overall);

      const movieId = String(r?.movie_id || "").trim();
      if (movieId) movieRatingById.set(movieId, overall);

      const imdb = Number(r?.imdb_rating_pct);
      if (Number.isFinite(imdb)) imdbDeltas.push(overall - imdb);

      const runtime = Number(r?.runtime_minutes);
      if (Number.isFinite(runtime) && runtime > 0) {
        const binStart = Math.floor(runtime / RUNTIME_BIN_MINUTES) * RUNTIME_BIN_MINUTES;
        const key = String(binStart);
        if (!runtimeBins[key]) runtimeBins[key] = { sum: 0, count: 0, avg: 0 };
        runtimeBins[key].sum += overall;
        runtimeBins[key].count += 1;
      }

      const year = Number(r?.release_year);
      if (Number.isFinite(year) && year > 1800) {
        const decade = Math.floor(year / 10) * 10;
        const key = String(decade);
        if (!decadeBins[key]) decadeBins[key] = { sum: 0, count: 0, avg: 0 };
        decadeBins[key].sum += overall;
        decadeBins[key].count += 1;
      }

      const pairs = [
        ["sound", r?.sound_rating],
        ["pace", r?.pacing_rating],
        ["imagery", r?.imagery_rating],
        ["acting", r?.acting_rating],
        ["plot", r?.plot_rating],
        ["dialogue", r?.dialogue_rating],
      ];
      pairs.forEach(([key, val]) => {
        const n = Number(val);
        if (!Number.isFinite(n)) return;
        subRatings[key].x.push(n);
        subRatings[key].y.push(overall);
      });
    });

    const meanOverall = Number(mean(overallRatings).toFixed(2));
    const medianOverall = Number(median(overallRatings).toFixed(2));
    const stdOverall = Number(stddev(overallRatings).toFixed(2));
    const likeThreshold = Number(percentile(overallRatings, 0.75).toFixed(2));
    const imdbDelta = Number(mean(imdbDeltas).toFixed(2));

    // Finalize bins with shrinkage toward the user's mean so sparse bins (each
    // ~10-min runtime bucket / decade has few movies) don't read as strong signal.
    // `shrunk` = avg pulled toward mean; `aff` = how far above/below baseline.
    const finalizeBin = (bin) => {
      bin.avg = bin.count ? Number((bin.sum / bin.count).toFixed(2)) : 0;
      const shrunk = shrink(bin.avg, bin.count, meanOverall);
      bin.shrunk = Number(shrunk.toFixed(2));
      bin.aff = Number((shrunk - meanOverall).toFixed(2));
      delete bin.sum;
    };
    Object.values(runtimeBins).forEach(finalizeBin);
    Object.values(decadeBins).forEach(finalizeBin);

    const subratingWeights = {
      sound: Number(correlation(subRatings.sound.x, subRatings.sound.y).toFixed(4)),
      pace: Number(correlation(subRatings.pace.x, subRatings.pace.y).toFixed(4)),
      imagery: Number(correlation(subRatings.imagery.x, subRatings.imagery.y).toFixed(4)),
      acting: Number(correlation(subRatings.acting.x, subRatings.acting.y).toFixed(4)),
      plot: Number(correlation(subRatings.plot.x, subRatings.plot.y).toFixed(4)),
      dialogue: Number(correlation(subRatings.dialogue.x, subRatings.dialogue.y).toFixed(4)),
    };

    const movieIds = Array.from(movieRatingById.keys());
    let peopleAffinity = {};
    if (movieIds.length > 0) {
      const { castRows, crewRows } = await fetchPeopleByMovieIds(supabaseAdmin, movieIds);
      const personStats = new Map();

      const addPerson = (personId, role, movieId) => {
        const rating = movieRatingById.get(String(movieId));
        if (!Number.isFinite(rating)) return;
        const pid = String(personId);
        if (!personStats.has(pid)) {
          personStats.set(pid, { id: pid, roles: new Set(), sum: 0, count: 0, name: "" });
        }
        const entry = personStats.get(pid);
        entry.roles.add(role);
        entry.sum += rating;
        entry.count += 1;
      };

      castRows.forEach((row) => {
        addPerson(row.person_id, "actor", row.movie_id);
      });

      crewRows.forEach((row) => {
        const job = String(row?.job || "").toLowerCase();
        if (job === "director") {
          addPerson(row.person_id, "director", row.movie_id);
        }
      });

      const personIds = Array.from(personStats.keys());
      const names = await fetchPeopleNames(supabaseAdmin, personIds);
      personStats.forEach((entry, pid) => {
        entry.name = names.get(pid) || "";
      });

      const topPeople = Array.from(personStats.values())
        .map((entry) => {
          const avg = entry.count ? Number((entry.sum / entry.count).toFixed(2)) : 0;
          const shrunk = shrink(avg, entry.count, meanOverall);
          return {
            id: entry.id,
            name: entry.name,
            roles: Array.from(entry.roles),
            avg,
            count: entry.count,
            shrunk: Number(shrunk.toFixed(2)),
            aff: Number((shrunk - meanOverall).toFixed(2)),
          };
        })
        // Require a minimum sample so a single great/awful movie doesn't crown a
        // "favorite". Rank by shrunk affinity (how far above baseline), not raw avg.
        .filter((entry) => entry.count >= MIN_PEOPLE_COUNT)
        .sort((a, b) => (b.aff - a.aff) || (b.count - a.count))
        .slice(0, 50);

      peopleAffinity = Object.fromEntries(topPeople.map((entry) => [
        entry.id,
        {
          name: entry.name,
          roles: entry.roles,
          avg: entry.avg,
          count: entry.count,
          shrunk: entry.shrunk,
          aff: entry.aff,
        },
      ]));
    }

    // Genre affinity: per-genre mean rating, shrunk toward the user's overall mean.
    // Keyed by genre NAME so the AI Picks predictor matches TMDB candidate genres
    // directly. Covers every genre the user has rated (only ~19 exist).
    let genreAffinity = {};
    if (movieIds.length > 0) {
      const genreByMovie = await fetchGenresByMovieIds(supabaseAdmin, movieIds);
      const genreStats = new Map();
      genreByMovie.forEach((names, movieId) => {
        const rating = movieRatingById.get(String(movieId));
        if (!Number.isFinite(rating)) return;
        uniqStrings(names).forEach((name) => {
          if (!genreStats.has(name)) genreStats.set(name, { sum: 0, count: 0 });
          const s = genreStats.get(name);
          s.sum += rating;
          s.count += 1;
        });
      });
      genreAffinity = Object.fromEntries(Array.from(genreStats.entries()).map(([name, s]) => {
        const avg = s.count ? Number((s.sum / s.count).toFixed(2)) : 0;
        const shrunk = shrink(avg, s.count, meanOverall);
        return [name, {
          avg,
          count: s.count,
          shrunk: Number(shrunk.toFixed(2)),
          aff: Number((shrunk - meanOverall).toFixed(2)),
        }];
      }));
    }

    // Keyword (theme) affinity: per-keyword mean rating, shrunk toward the user's
    // mean, keyed by lowercase keyword NAME. Captures theme-level taste ("heist",
    // "dystopia", "slow burn") beyond genre. Requires MIN_KEYWORD_COUNT ratings and
    // keeps only the strongest |aff| keywords so the JSON stays small.
    let keywordAffinity = {};
    if (movieIds.length > 0) {
      const kwByMovie = await fetchKeywordsByMovieIds(supabaseAdmin, movieIds);
      const kwStats = new Map();
      kwByMovie.forEach((names, movieId) => {
        const rating = movieRatingById.get(String(movieId));
        if (!Number.isFinite(rating)) return;
        uniqStrings(names).forEach((name) => {
          if (!kwStats.has(name)) kwStats.set(name, { sum: 0, count: 0 });
          const s = kwStats.get(name);
          s.sum += rating;
          s.count += 1;
        });
      });
      const ranked = Array.from(kwStats.entries())
        .map(([name, s]) => {
          const avg = s.count ? Number((s.sum / s.count).toFixed(2)) : 0;
          const shrunk = shrink(avg, s.count, meanOverall);
          return { name, avg, count: s.count, shrunk: Number(shrunk.toFixed(2)), aff: Number((shrunk - meanOverall).toFixed(2)) };
        })
        .filter((k) => k.count >= MIN_KEYWORD_COUNT)
        .sort((a, b) => Math.abs(b.aff) - Math.abs(a.aff))
        .slice(0, MAX_KEYWORDS_STORED);
      keywordAffinity = Object.fromEntries(ranked.map((k) => [
        k.name,
        { avg: k.avg, count: k.count, shrunk: k.shrunk, aff: k.aff },
      ]));
    }

    const payload = {
      user_id: userId,
      computed_at: new Date().toISOString(),
      mean_overall: meanOverall,
      median_overall: medianOverall,
      std_overall: stdOverall,
      like_threshold: likeThreshold,
      imdb_delta: imdbDelta,
      runtime_bins_json: runtimeBins,
      decade_bins_json: decadeBins,
      people_affinity_json: peopleAffinity,
      subrating_weights_json: subratingWeights,
      genre_affinity_json: genreAffinity,
      keyword_affinity_json: keywordAffinity,
    };

    const { error: upsertErr } = await supabaseAdmin
      .from("Taste Profiles")
      .upsert(payload, { onConflict: "user_id" });

    if (upsertErr) throw upsertErr;

    return {
      ok: true,
      user_id: userId,
      ratings_count: overallRatings.length,
      people_count: Object.keys(peopleAffinity).length,
      genres_count: Object.keys(genreAffinity).length,
      keywords_count: Object.keys(keywordAffinity).length,
    };
}

// Pick which users to recompute in a batch run: everyone who has rated at least
// one movie, ordered stalest-profile-first (never-computed users come first), so a
// daily cron with a limit rotates through the whole base and backfills new users.
async function fetchTasteRecomputeTargets(supabaseAdmin, limit) {
  const raterIds = new Set();
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from("Movie Ratings")
      .select("user_id")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = Array.isArray(data) ? data : [];
    page.forEach((r) => { if (r?.user_id) raterIds.add(String(r.user_id)); });
    if (page.length < pageSize) break;
    from += pageSize;
  }

  // When was each profile last computed? Absent = never (sorts first).
  const computedAt = new Map();
  const { data: profiles } = await supabaseAdmin
    .from("Taste Profiles")
    .select("user_id, computed_at");
  (Array.isArray(profiles) ? profiles : []).forEach((p) => {
    if (p?.user_id) computedAt.set(String(p.user_id), p?.computed_at || null);
  });

  const ordered = Array.from(raterIds).sort((a, b) => {
    const ta = computedAt.has(a) ? (Date.parse(computedAt.get(a) || "") || 0) : -1;
    const tb = computedAt.has(b) ? (Date.parse(computedAt.get(b) || "") || 0) : -1;
    return ta - tb; // oldest / never-computed first
  });
  return (Number.isFinite(limit) && limit > 0) ? ordered.slice(0, limit) : ordered;
}

async function fetchKeywordsByMovieIds(supabaseAdmin, movieIds) {
  // Returns Map<movieId, string[]> of keyword names for the given movies.
  const kwByMovie = new Map();
  if (!Array.isArray(movieIds) || movieIds.length === 0) return kwByMovie;

  const links = [];
  const chunkSize = 200;
  for (let i = 0; i < movieIds.length; i += chunkSize) {
    const chunk = movieIds.slice(i, i + chunkSize);
    const { data, error } = await supabaseAdmin
      .from("Movie Keywords")
      .select("movie_id, keyword_id")
      .in("movie_id", chunk);
    if (error) throw error;
    if (Array.isArray(data)) links.push(...data);
  }
  if (links.length === 0) return kwByMovie;

  const keywordIds = Array.from(new Set(links.map((r) => r.keyword_id).filter((v) => v != null)));
  const nameById = new Map();
  for (let i = 0; i < keywordIds.length; i += 200) {
    const chunk = keywordIds.slice(i, i + 200);
    const { data, error } = await supabaseAdmin
      .from("Keywords")
      .select("id, name")
      .in("id", chunk);
    if (error) throw error;
    if (Array.isArray(data)) {
      data.forEach((k) => nameById.set(String(k.id), String(k.name || "").trim().toLowerCase()));
    }
  }

  links.forEach((row) => {
    const mid = String(row.movie_id);
    const name = nameById.get(String(row.keyword_id));
    if (!name) return;
    if (!kwByMovie.has(mid)) kwByMovie.set(mid, []);
    kwByMovie.get(mid).push(name);
  });
  return kwByMovie;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ message: "Method not allowed" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return jsonResponse({ message: "Missing Supabase env vars." }, 500);
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));

    // ---- Cron / batch mode --------------------------------------------------
    // Gated by the shared CRON_SECRET (no user session). Recomputes many users'
    // profiles at once — the daily safety-net sweep AND the one-time backfill.
    // Triggered by .github/workflows/refresh-taste-profiles.yml. Body: { limit,
    // concurrency }. limit 0/omitted = recompute everyone.
    const cronSecret = String(req.headers.get("x-cron-secret") ?? "").trim();
    if (cronSecret) {
      const expectedCron = String(Deno.env.get("CRON_SECRET") ?? "").trim();
      if (!expectedCron || cronSecret !== expectedCron) {
        return jsonResponse({ message: "Invalid cron secret." }, 401);
      }
      const limit = Math.max(0, Math.min(5000, Number(body?.limit) || 0));
      const concurrency = Math.max(1, Math.min(5, Number(body?.concurrency) || 3));
      const targets = await fetchTasteRecomputeTargets(supabaseAdmin, limit);

      let updated = 0;
      let skipped = 0;
      let failed = 0;
      for (let i = 0; i < targets.length; i += concurrency) {
        const slice = targets.slice(i, i + concurrency);
        const settled = await Promise.allSettled(
          slice.map((uid) => computeAndStoreTasteProfile(supabaseAdmin, uid)),
        );
        settled.forEach((s) => {
          if (s.status === "fulfilled" && s.value?.ok) updated += 1;
          else if (s.status === "fulfilled") skipped += 1;
          else failed += 1;
        });
      }
      return jsonResponse({ ok: true, mode: "batch", targets: targets.length, updated, skipped, failed });
    }

    // ---- Single-user mode (authed caller recomputes their own profile) ------
    const authHeader = req.headers.get("Authorization")
      ?? req.headers.get("authorization")
      ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return jsonResponse({ message: "Missing Authorization bearer token." }, 401);
    }
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return jsonResponse({ message: "Missing JWT token." }, 401);
    }
    const supabaseUserClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supabaseUserClient.auth.getUser(token);
    if (userErr || !userData?.user?.id) {
      return jsonResponse({ message: userErr?.message || "Invalid or expired session." }, 401);
    }
    const userId = String(userData.user.id).trim();
    const requestedUserId = String(body?.user_id || "").trim();
    if (requestedUserId && requestedUserId !== userId) {
      return jsonResponse({ message: "User mismatch." }, 403);
    }

    const result = await computeAndStoreTasteProfile(supabaseAdmin, userId);
    if (!result.ok && result.reason === "no_ratings") {
      return jsonResponse({ message: "No ratings found for user." }, 400);
    }
    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ message: String(err?.message || err) }, 500);
  }
});
