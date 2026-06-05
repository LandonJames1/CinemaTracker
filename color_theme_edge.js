import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const colorOutputSchema = {
  type: "object",
  title: "color_output",
  additionalProperties: false,
  required: ["colors", "notes"],
  properties: {
    colors: {
      type: "object",
      additionalProperties: false,
      required: [
        "bg_dark",
        "surface",
        "border",
        "text_main",
        "text_muted",
        "brand",
        "brand_hover",
        "brand_2",
        "brand_3",
        "accent_1",
        "accent_2",
        "nav_accent",
        "nav_title",
        "brand_light",
        "brand_shadow",
        "nav_active_a",
        "nav_active_b",
        "glass_bg",
        "glass_border",
        "glass_shadow",
        "btn_outline_bg",
        "focus_ring",
        "bg_overlay"
      ],
      properties: {
        bg_dark: { type: "string" },
        surface: { type: "string" },
        border: { type: "string" },
        text_main: { type: "string" },
        text_muted: { type: "string" },
        brand: { type: "string" },
        brand_hover: { type: "string" },
        brand_2: { type: "string" },
        brand_3: { type: "string" },
        accent_1: { type: "string" },
        accent_2: { type: "string" },
        nav_accent: { type: "string" },
        nav_title: { type: "string" },
        brand_light: { type: "string" },
        brand_shadow: { type: "string" },
        nav_active_a: { type: "string" },
        nav_active_b: { type: "string" },
        glass_bg: { type: "string" },
        glass_border: { type: "string" },
        glass_shadow: { type: "string" },
        btn_outline_bg: { type: "string" },
        focus_ring: { type: "string" },
        bg_overlay: { type: "string" }
      }
    },
    notes: { type: "string" }
  }
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const COLOR_TOKEN_DESCRIPTIONS = {
  bg_dark: "Global background color behind everything. This is the dominant page backdrop; it anchors the theme mood and drives overall contrast. Keep it dark and low-saturation so imagery can show through.",
  surface: "Primary surface fill for cards, panels, and section blocks. Should be close to bg_dark but lighter to separate content from the background. Keep it dark and low-chroma to avoid overpowering backdrops.",
  border: "Default border color for cards, inputs, pills, and separators. Should be subtle yet visible against surface.",
  text_main: "Primary text color for headings and body copy. Must maintain strong contrast against bg_dark and surface.",
  text_muted: "Secondary text for labels, helper text, and metadata. Should be visibly softer than text_main but still readable.",
  brand: "Main brand accent used for primary buttons, key highlights, and emphasis. This is the signature color of the theme.",
  brand_hover: "Hover/active variant of brand for interactive states. Should be a clear step from brand without losing identity.",
  brand_2: "Secondary accent wash used in glass gradients and soft glows. Usually a companion hue to brand; keep it translucent and avoid heavy saturation so it does not tint large areas.",
  brand_3: "Tertiary accent wash used for extra gradient depth and subtle lighting effects. Keep it translucent and complementary without overpowering the dark base.",
  accent_1: "Small highlight accent for chips, badges, and micro-details. Use for subtle pops that support the brand color.",
  accent_2: "Secondary highlight accent. Use as a complement to accent_1 for variety without noise.",
  nav_accent: "Navbar logo color for the 'Cinema' word. This is a display accent and can be a brighter variant of brand.",
  nav_title: "Navbar logo color for the 'Tracker' word. Typically near-white or a light neutral for clarity.",
  brand_light: "Translucent brand tint used for chip fills and soft hover backgrounds. This should feel like brand at low opacity and not wash out the background.",
  brand_shadow: "Brand glow used in button shadows and highlights. Controls how luminous and premium the primary button feels.",
  nav_active_a: "First color stop for the active nav pill gradient. Should echo brand and feel energetic but not loud.",
  nav_active_b: "Second color stop for the active nav pill gradient. Usually ties to brand_2 for a subtle two-tone blend.",
  glass_bg: "Glass panel background tint. Sets the frosted glass feel; should be semi-transparent, dark, and low-saturation so backdrops remain visible.",
  glass_border: "Glass panel border tint. Subtle outline to define panels without harsh contrast.",
  glass_shadow: "Glass panel shadow color. Controls depth and layering of panels.",
  btn_outline_bg: "Outline button background fill. Should be a faint, dark surface tint (low chroma) so outline buttons still feel clickable without tinting the UI.",
  focus_ring: "Focus ring glow for inputs and key controls. Should be a clear accessibility cue and align with brand.",
  bg_overlay: "Background overlay gradient applied over backdrops for legibility. Keep it dark and mostly neutral; avoid heavy color tint so imagery stays visible."
};

const DEFAULT_COLORS = {
  bg_dark: "#09090b",
  surface: "#18181b",
  border: "#27272a",
  text_main: "#e4e4e7",
  text_muted: "#a1a1aa",
  brand: "#14b8a6",
  brand_hover: "#0d9488",
  brand_2: "rgba(168, 85, 247, 0.35)",
  brand_3: "rgba(59, 130, 246, 0.35)",
  accent_1: "#5eead4",
  accent_2: "#a78bfa",
  nav_accent: "#74c6cd",
  nav_title: "#fdfbf8",
  brand_light: "rgba(20, 184, 166, 0.1)",
  brand_shadow: "rgba(20, 184, 166, 0.3)",
  nav_active_a: "rgba(20,184,166,0.28)",
  nav_active_b: "rgba(168,85,247,0.22)",
  glass_bg: "rgba(24, 24, 27, 0.6)",
  glass_border: "rgba(255, 255, 255, 0.05)",
  glass_shadow: "rgba(0, 0, 0, 0.35)",
  btn_outline_bg: "rgba(24, 24, 27, 0.65)",
  focus_ring: "rgba(20, 184, 166, 0.6)",
  bg_overlay: "linear-gradient(to bottom, rgba(9,9,11,0.1), rgba(9,9,11,0.55) 50%, rgba(9,9,11,0.9) 100%)"
};

const AVOID_TIER_COLORS = [
  "#ef4444",
  "#fb923c",
  "#facc15",
  "#4ade80",
  "#60a5fa",
  "#a137c6"
];

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

async function callAnthropicJson({ apiKey, model, schemaName, schema, system, user }) {
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: user }],
      tools: [{
        name: schemaName,
        description: "Return the result as structured JSON matching the schema.",
        input_schema: schema,
      }],
      tool_choice: { type: "tool", name: schemaName },
    }),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.error?.message || `Anthropic HTTP ${res.status}`;
    throw new Error(msg);
  }

  const content = Array.isArray(json?.content) ? json.content : [];
  for (const block of content) {
    if (block?.type === "tool_use" && block?.input) {
      return block.input;
    }
  }
  throw new Error("Anthropic returned no tool_use block.");
}

function normalizeColorValue(raw) {
  return String(raw ?? "").trim();
}

function validateColorPayload(colors) {
  const requiredKeys = Object.keys(DEFAULT_COLORS);
  const out = {};
  for (const key of requiredKeys) {
    const val = normalizeColorValue(colors?.[key]);
    if (!val) throw new Error(`Missing color value for ${key}`);
    out[key] = val;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ message: "Method not allowed" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

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
    const themeId = String(body?.theme_id || "").trim();
    const movieTitle = String(body?.movie_title || "").trim();
    if (!themeId) return jsonResponse({ message: "Missing theme_id." }, 400);
    if (!movieTitle) return jsonResponse({ message: "Missing movie_title." }, 400);

    const movieYear = body?.movie_year ?? null;
    const movieGenres = Array.isArray(body?.movie_genres) ? body.movie_genres : [];
    const movieOverview = String(body?.movie_overview || "").trim();
    const themeName = String(body?.theme_name || "").trim();
    const stylePrompt = String(body?.style_prompt || "").trim();

    const inputPayload = {
      style_prompt: stylePrompt,
      movie: {
        title: movieTitle,
        year: Number.isFinite(Number(movieYear)) ? Number(movieYear) : null,
        genres: movieGenres.map((g) => String(g).trim()).filter(Boolean),
        overview: movieOverview,
      },
      theme: {
        theme_id: themeId,
        theme_name: themeName,
      },
      token_descriptions: COLOR_TOKEN_DESCRIPTIONS,
      current_colors: DEFAULT_COLORS,
      constraints: {
        avoid_colors: AVOID_TIER_COLORS,
        avoid_notes: "Do not use tier list colors or near-identical matches.",
      },
    };

    const system =
      "You are a CinemaTracker theme color designer. Generate a cohesive color palette inspired by the movie and theme context provided in the input JSON.\n\n" +
      "PRIMARY INTENT (CORE SIGNAL)\n" +
      "Use the movie title, year, genres, and overview from the movie field as the creative anchor.\n\n" +
      "AVAILABLE CONTEXT\n" +
      "Use token_descriptions to understand what each color controls. " +
      "Use current_colors only as a contrast/legibility baseline. " +
      "Use style_prompt as extra direction if provided.\n\n" +
      "CONSTRAINTS\n" +
      "- Output must match the color_output JSON schema exactly.\n" +
      "- Provide base tokens and derived tokens (do not omit derived tokens).\n" +
      "- Do not use any of the tier colors listed in constraints.avoid_colors.\n" +
      "- Use hex for solid colors (bg, surface, border, text, brand, accents, nav colors).\n" +
      "- Use rgba for accent washes (brand_2, brand_3) with alpha between 0.25 and 0.45.\n" +
      "- Use rgba for derived translucent tokens (brand_light, brand_shadow, nav_active_a, nav_active_b, glass_bg, glass_border, glass_shadow, btn_outline_bg, focus_ring).\n" +
      "- Use a linear-gradient string for bg_overlay.\n" +
      "- Maintain strong contrast for readability (text_main vs bg_dark; text_muted should be visibly softer).\n" +
      "- Main surfaces should stay dark and low-saturation. Keep bg_dark, surface, glass_bg, btn_outline_bg, and bg_overlay mostly neutral (or only subtly tinted) so background images remain visible.\n" +
      "- Avoid heavy, opaque color washes on glass_bg and bg_overlay; prefer darker translucency over saturated tints.\n\n" +
      "STYLE GUIDANCE\n" +
      "- Keep the palette cinematic, cohesive, and mood-consistent with the movie.\n" +
      "- Avoid neon unless the movie explicitly calls for it.\n" +
      "- Use brand and accents to feel premium and intentional, not noisy.\n" +
      "- Think of the page as dark glass over imagery: the brand can be bold, but the base layers should feel smoky and transparent.\n\n" +
      "OUTPUT FOCUS\n" +
      "Return only valid JSON for color_output. No extra commentary.";
    const user = JSON.stringify(inputPayload);

    const ANTHROPIC_MODEL = String(body?.model ?? "").trim()
      || Deno.env.get("ANTHROPIC_MODEL")
      || "claude-haiku-4-5-20251001";

    const parsed = await callAnthropicJson({
      apiKey: ANTHROPIC_API_KEY,
      model: ANTHROPIC_MODEL,
      schemaName: "color_output",
      schema: colorOutputSchema,
      system,
      user,
    });

    const colors = validateColorPayload(parsed?.colors);

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { error: upsertErr } = await supabaseAdmin
      .from("Themes")
      .update({ colors })
      .eq("id", themeId);

    if (upsertErr) throw upsertErr;

    return jsonResponse({ ok: true, theme_id: themeId, colors });
  } catch (err) {
    return jsonResponse({ message: String(err?.message || err) }, 500);
  }
});
