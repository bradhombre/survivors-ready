import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface FetchRequest {
  season_number: number;
  contestant_ids?: string[];
  force_refresh?: boolean;
  cast_page_url?: string;
}

interface ContestantResult {
  id: string;
  name: string;
  success: boolean;
  image_url?: string;
  error?: string;
}

interface CastMapping {
  name: string;
  image_url: string;
}

// --- Utility Functions ---

async function validateImageUrl(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ImageValidator/1.0)" },
    });
    if (!response.ok) return false;
    const contentType = response.headers.get("content-type") || "";
    return contentType.startsWith("image/") || /\.(jpg|jpeg|png|webp)$/i.test(url);
  } catch {
    return false;
  }
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

// Generate all name variants for matching (handles nicknames like Benjamin "Coach" Wade)
function getNameVariants(name: string): string[] {
  const variants: string[] = [normalizeName(name)];

  // Extract nickname from quotes: Benjamin "Coach" Wade -> Coach Wade
  const nicknameMatch = name.match(/"([^"]+)"/);
  if (nicknameMatch) {
    const nickname = nicknameMatch[1];
    const withoutQuotedPart = name.replace(/"[^"]+"/g, "").replace(/\s+/g, " ").trim();
    const parts = withoutQuotedPart.split(/\s+/);
    const lastName = parts[parts.length - 1];

    // Nickname + LastName (Coach Wade)
    if (lastName) variants.push(normalizeName(`${nickname} ${lastName}`));
    // Just nickname (Coach)
    variants.push(normalizeName(nickname));
    // Full name without nickname (Benjamin Wade)
    variants.push(normalizeName(withoutQuotedPart));
  }

  // Also try first + last only (skip middle names)
  const cleanParts = normalizeName(name).split(" ");
  if (cleanParts.length >= 3) {
    variants.push(`${cleanParts[0]} ${cleanParts[cleanParts.length - 1]}`);
  }

  return [...new Set(variants)];
}

function namesMatch(dbName: string, extractedName: string): boolean {
  const dbVariants = getNameVariants(dbName);
  const extVariants = getNameVariants(extractedName);

  // Check all variant combinations
  for (const a of dbVariants) {
    for (const b of extVariants) {
      if (a === b) return true;
      // Last name match
      const aParts = a.split(" ");
      const bParts = b.split(" ");
      const aLast = aParts[aParts.length - 1];
      const bLast = bParts[bParts.length - 1];
      if (aLast === bLast && aLast.length > 2) return true;
      // Contains check
      if (a.includes(b) || b.includes(a)) return true;
    }
  }

  return false;
}

function cleanWikiaUrl(url: string): string {
  const baseMatch = url.match(/^(https?:\/\/static\.wikia\.nocookie\.net\/[^/]+\/images\/[^/]+\/[^/]+\/[^/]+)/);
  if (baseMatch) {
    return baseMatch[1] + "/revision/latest/scale-to-width-down/400";
  }
  return url;
}

// Extract just the Castaways section from the full HTML to reduce size
function extractCastawaysSection(html: string): string {
  // Look for the Castaways heading and grab content until the next major section
  const castawaysHeadings = [
    /id="Castaways"/i,
    /id="Cast"/i,
    />Castaways<\//i,
    />Cast<\//i,
  ];

  let startIdx = -1;
  for (const pattern of castawaysHeadings) {
    const match = html.match(pattern);
    if (match && match.index !== undefined) {
      startIdx = match.index;
      break;
    }
  }

  if (startIdx === -1) {
    console.log("[Section Extract] Could not find Castaways section, using full HTML");
    return html;
  }

  // Find the next major section heading after the castaways table
  const afterCastaways = html.substring(startIdx);
  const nextSectionPatterns = [
    /id="Season_Summary"/i,
    /id="Voting_History"/i,
    /id="Episode_Guide"/i,
    /id="Trivia"/i,
    />Season Summary<\//i,
    />Voting History<\//i,
  ];

  let endIdx = afterCastaways.length;
  for (const pattern of nextSectionPatterns) {
    const match = afterCastaways.match(pattern);
    if (match && match.index !== undefined && match.index < endIdx) {
      endIdx = match.index;
    }
  }

  const section = afterCastaways.substring(0, endIdx);
  console.log(`[Section Extract] Extracted castaways section: ${section.length} chars (from ${startIdx} to ${startIdx + endIdx})`);
  return section;
}

// --- Direct HTML parsing ---

function extractCastFromHTML(html: string): CastMapping[] {
  const mappings: CastMapping[] = [];

  // Strategy: Find all wikia contestant thumbnail images by alt text pattern "S{num} {name} t"
  // Then correlate with bold name links nearby
  const imgPattern = /alt="S\d+\s+(\w+)\s+t"[^>]*src="(https?:\/\/static\.wikia\.nocookie\.net\/[^"]+)"|src="(https?:\/\/static\.wikia\.nocookie\.net\/[^"]+)"[^>]*alt="S\d+\s+(\w+)\s+t"/gi;
  const nameImgMap = new Map<string, string>();

  let match;
  while ((match = imgPattern.exec(html)) !== null) {
    const firstName = (match[1] || match[4]).toLowerCase();
    const url = match[2] || match[3];
    if (!url.includes("logo") && !url.includes("icon")) {
      nameImgMap.set(firstName, cleanWikiaUrl(url));
    }
  }

  console.log(`[HTML Parse] Found ${nameImgMap.size} contestant thumbnails by alt text`);

  if (nameImgMap.size === 0) return mappings;

  // Find full names from bold links: <b><a ...>Full Name</a></b> or <a ...><b>Full Name</b></a>
  const boldNamePattern = /<b>\s*<a[^>]*>([^<]+)<\/a>\s*<\/b>|<a[^>]*>\s*<b>([^<]+)<\/b>\s*<\/a>/gi;
  while ((match = boldNamePattern.exec(html)) !== null) {
    const fullName = (match[1] || match[2]).trim();
    const firstName = fullName.split(/\s+/)[0].toLowerCase();
    const imgUrl = nameImgMap.get(firstName);
    if (imgUrl) {
      mappings.push({ name: fullName, image_url: imgUrl });
    }
  }

  console.log(`[HTML Parse] Matched ${mappings.length} contestants`);
  return mappings;
}

// --- Full cast import from wiki ---

interface ImportedCastaway {
  name: string;
  tribe: string | null;
  age: number | null;
  occupation: string | null;
  image_url: string | null;
}

async function importCastFromWiki(season: number, pageUrl?: string): Promise<ImportedCastaway[]> {
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  if (!firecrawlKey || !lovableKey) throw new Error("Scraping or AI key not configured");

  const url = pageUrl || `https://survivor.fandom.com/wiki/Survivor_${season}`;
  const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: { Authorization: `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url, formats: ["markdown"] }),
  });
  if (!res.ok) throw new Error(`Wiki fetch failed [${res.status}]: ${await res.text()}`);
  const data = await res.json();
  let md: string = data.data?.markdown || data.markdown || "";
  const idx = md.search(/#+\s*Cast(aways)?\b/i);
  if (idx >= 0) md = md.substring(idx);
  md = md.substring(0, 60000);

  const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "openai/gpt-6-astra",
      instructions:
        `Extract the Survivor Season ${season} castaways from this wiki page markdown. Return ONLY a JSON array: [{"name":"Full Name","tribe":"Starting tribe or null","age":number or null,"occupation":"text or null","image_url":"castaway thumbnail URL from static.wikia.nocookie.net or null"}]. If the page has no cast listed yet, return []. Do not invent people.`,
      input: md,
    }),
  });
  if (!aiRes.ok) throw new Error(`AI extraction failed [${aiRes.status}]: ${await aiRes.text()}`);
  const ai = await aiRes.json();
  let text: string = ai.output_text || "";
  if (!text && Array.isArray(ai.output)) {
    for (const o of ai.output) for (const c of o.content || []) if (c.text) text += c.text;
  }
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  const arr = JSON.parse(m[0]) as ImportedCastaway[];
  return arr
    .filter((c) => c && typeof c.name === "string" && c.name.trim())
    .map((c) => ({
      name: c.name.trim(),
      tribe: c.tribe || null,
      age: typeof c.age === "number" ? c.age : null,
      occupation: c.occupation || null,
      image_url: c.image_url ? cleanWikiaUrl(c.image_url) : null,
    }));
}

// --- Main Handler ---

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const reqBody = await req.json();
    const {
      season_number,
      contestant_ids,
      force_refresh = false,
      cast_page_url,
    }: FetchRequest = reqBody;

    if (!season_number || typeof season_number !== "number" || season_number < 1 || season_number > 200) {
      return new Response(
        JSON.stringify({ success: false, error: "season_number is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const reqMode = reqBody?.mode as string | undefined;

    // Importing a cast or fetching photos is for the site owner (it uses paid scraping).
    // "auto" only runs when the current season has no cast yet, so it stays open.
    if (reqMode !== "auto") {
      const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
      const { data: authData } = token ? await supabase.auth.getUser(token) : { data: null };
      const callerId = authData?.user?.id;
      const { data: isOwner } = callerId ? await supabase.rpc("is_super_admin", { _user_id: callerId }) : { data: false };
      if (!isOwner) {
        return new Response(JSON.stringify({ success: false, error: "Site owner only" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (reqMode === "import_cast" || reqMode === "auto") {
      if (reqMode === "auto") {
        const { data: setting } = await supabase.from("app_settings").select("value").eq("key", "current_season").maybeSingle();
        const cur = parseInt(setting?.value || "") || season_number;
        const { count } = await supabase.from("master_contestants").select("id", { count: "exact", head: true }).eq("season_number", cur);
        if ((count || 0) > 0) {
          return new Response(JSON.stringify({ success: true, skipped: true, reason: "cast already exists" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const cast = await importCastFromWiki(cur, cast_page_url);
        if (cast.length === 0) {
          return new Response(JSON.stringify({ success: true, inserted: 0, reason: "wiki not ready" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const { error } = await supabase.from("master_contestants").insert(cast.map((c) => ({ ...c, season_number: cur })));
        return new Response(JSON.stringify({ success: !error, inserted: error ? 0 : cast.length, error: error?.message }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const cast = await importCastFromWiki(season_number, cast_page_url);
      return new Response(JSON.stringify({ success: true, cast }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let query = supabase
      .from("master_contestants")
      .select("id, name, image_url")
      .eq("season_number", season_number);

    if (contestant_ids?.length) query = query.in("id", contestant_ids);
    if (!force_refresh) query = query.is("image_url", null);

    const { data: contestants, error: fetchError } = await query;

    if (fetchError) {
      return new Response(
        JSON.stringify({ success: false, error: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!contestants?.length) {
      return new Response(
        JSON.stringify({ success: true, total: 0, found: 0, notFound: 0, results: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!firecrawlKey) {
      return new Response(
        JSON.stringify({ success: false, error: "Firecrawl API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing ${contestants.length} contestants for Season ${season_number}`);

    // --- Scrape the wiki season page ---
    const wikiUrl = cast_page_url || `https://survivor.fandom.com/wiki/Survivor_${season_number}`;
    console.log(`Scraping: ${wikiUrl}`);

    const scrapeRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${firecrawlKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: wikiUrl, formats: ["html"] }),
    });

    let castMappings: CastMapping[] = [];

    if (scrapeRes.ok) {
      const scrapeData = await scrapeRes.json();
      const fullHtml = scrapeData.data?.html || scrapeData.html || "";
      console.log(`Got ${fullHtml.length} chars HTML`);

      // Extract just the Castaways section
      const castawaysHtml = extractCastawaysSection(fullHtml);

      // Parse HTML directly
      castMappings = extractCastFromHTML(castawaysHtml);

      // If direct parsing failed, try AI on the focused section
      if (castMappings.length === 0) {
        console.log("Direct parsing found 0, trying AI...");
        const lovableKey = Deno.env.get("LOVABLE_API_KEY");
        if (lovableKey) {
          try {
            const content = castawaysHtml.length > 80000 ? castawaysHtml.substring(0, 80000) : castawaysHtml;
            const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${lovableKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "google/gemini-2.5-flash",
                messages: [
                  {
                    role: "system",
                    content: `Extract Survivor contestant names and their profile image URLs from this HTML section. Each contestant has a thumbnail from static.wikia.nocookie.net with alt text like "S50 firstname t". Extract the full name from the bold link next to the image. For image URLs, extract the base wikia CDN URL and append "/revision/latest/scale-to-width-down/400". Return ONLY a JSON array: [{"name":"Full Name","image_url":"https://static.wikia.nocookie.net/..."}]`,
                  },
                  { role: "user", content: content },
                ],
                max_tokens: 4000,
                temperature: 0,
              }),
            });
            if (aiRes.ok) {
              const aiData = await aiRes.json();
              const text = aiData.choices?.[0]?.message?.content?.trim() || "";
              const jsonMatch = text.match(/\[[\s\S]*\]/);
              if (jsonMatch) {
                castMappings = JSON.parse(jsonMatch[0]).filter((m: CastMapping) => m.name && m.image_url);
                // Clean all URLs
                castMappings = castMappings.map(m => ({ ...m, image_url: cleanWikiaUrl(m.image_url) }));
                console.log(`AI found ${castMappings.length} contestants`);
              }
            }
          } catch (err) {
            console.error("AI extraction failed:", err);
          }
        }
      }
    } else {
      console.error(`Firecrawl scrape failed: ${scrapeRes.status}`);
    }

    console.log(`Total mappings: ${castMappings.length}`);
    for (const m of castMappings.slice(0, 3)) {
      console.log(`  ${m.name} -> ${m.image_url.substring(0, 80)}`);
    }

    // Match and update
    const results: ContestantResult[] = [];
    let foundCount = 0;

    for (const contestant of contestants) {
      const match = castMappings.find((m) => namesMatch(contestant.name, m.name));

      if (match) {
        // Skip URL validation for wikia CDN URLs (they're reliable)
        const { error: updateError } = await supabase
          .from("master_contestants")
          .update({ image_url: match.image_url })
          .eq("id", contestant.id);

        if (updateError) {
          results.push({ id: contestant.id, name: contestant.name, success: false, error: updateError.message });
        } else {
          results.push({ id: contestant.id, name: contestant.name, success: true, image_url: match.image_url });
          foundCount++;
          console.log(`✓ ${contestant.name} -> ${match.name}`);
        }
      } else {
        results.push({ id: contestant.id, name: contestant.name, success: false, error: "No match" });
        console.log(`✗ ${contestant.name} - no match`);
      }
    }

    console.log(`Done: ${foundCount}/${contestants.length}`);

    return new Response(
      JSON.stringify({
        success: true,
        total: contestants.length,
        found: foundCount,
        notFound: contestants.length - foundCount,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
