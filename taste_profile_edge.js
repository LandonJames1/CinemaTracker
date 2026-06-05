import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RUNTIME_BIN_MINUTES = 10;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
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

    const body = await req.json().catch(() => ({}));
    const requestedUserId = String(body?.user_id || "").trim();
    const userId = String(userData.user.id).trim();
    if (requestedUserId && requestedUserId !== userId) {
      return jsonResponse({ message: "User mismatch." }, 403);
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const rows = await fetchAllUserRatings(supabaseAdmin, userId);
    if (!rows.length) {
      return jsonResponse({ message: "No ratings found for user." }, 400);
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

    Object.values(runtimeBins).forEach((bin) => {
      bin.avg = bin.count ? Number((bin.sum / bin.count).toFixed(2)) : 0;
      delete bin.sum;
    });

    Object.values(decadeBins).forEach((bin) => {
      bin.avg = bin.count ? Number((bin.sum / bin.count).toFixed(2)) : 0;
      delete bin.sum;
    });

    const meanOverall = Number(mean(overallRatings).toFixed(2));
    const medianOverall = Number(median(overallRatings).toFixed(2));
    const stdOverall = Number(stddev(overallRatings).toFixed(2));
    const likeThreshold = Number(percentile(overallRatings, 0.75).toFixed(2));
    const imdbDelta = Number(mean(imdbDeltas).toFixed(2));

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
        .map((entry) => ({
          id: entry.id,
          name: entry.name,
          roles: Array.from(entry.roles),
          avg: entry.count ? Number((entry.sum / entry.count).toFixed(2)) : 0,
          count: entry.count,
        }))
        .sort((a, b) => (b.avg - a.avg) || (b.count - a.count))
        .slice(0, 50);

      peopleAffinity = Object.fromEntries(topPeople.map((entry) => [
        entry.id,
        {
          name: entry.name,
          roles: entry.roles,
          avg: entry.avg,
          count: entry.count,
        },
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
    };

    const { error: upsertErr } = await supabaseAdmin
      .from("Taste Profiles")
      .upsert(payload, { onConflict: "user_id" });

    if (upsertErr) throw upsertErr;

    return jsonResponse({
      ok: true,
      user_id: userId,
      ratings_count: overallRatings.length,
      people_count: Object.keys(peopleAffinity).length,
    });
  } catch (err) {
    return jsonResponse({ message: String(err?.message || err) }, 500);
  }
});
