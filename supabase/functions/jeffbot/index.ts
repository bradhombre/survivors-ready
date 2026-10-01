import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { league_id, user_id, question, history } = await req.json();

    if (!league_id || !user_id || !question) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: league_id, user_id, question" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Only a signed-in member of this league (or the site owner) can ask, and the answer is
    // posted as a reply to them, not to whatever user_id the request claims.
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: authData } = token ? await supabase.auth.getUser(token) : { data: null };
    const callerId = authData?.user?.id;
    if (!callerId) {
      return new Response(JSON.stringify({ error: "Sign in to ask JeffBot" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const [{ data: isMember }, { data: isOwner }] = await Promise.all([
      supabase.rpc("is_league_member", { _user_id: callerId, _league_id: league_id }),
      supabase.rpc("is_super_admin", { _user_id: callerId }),
    ]);
    if (!isMember && !isOwner) {
      return new Response(JSON.stringify({ error: "Only league members can ask JeffBot here" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch current season from the league's game session
    const { data: session, error: sessionError } = await supabase
      .from("game_sessions")
      .select("season")
      .eq("league_id", league_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (sessionError) {
      console.error("Error fetching game session:", sessionError);
    }

    const currentSeason = session?.season || 49;

    const systemPrompt = `You are JeffBot 🏝️, the ultimate Survivor encyclopedia and fantasy league assistant. You have encyclopedic knowledge of every Survivor season, contestant, tribal council, immunity challenge, advantage, and strategic move in the show's history. You also know how this fantasy app works and can help users with common questions.

YOUR EXPERTISE INCLUDES:
- Complete cast lists, boot orders, and final tribal council results for all past seasons
- Detailed player stats: challenge wins, days played, voting history, alliances
- Iconic moments, blindsides, and memorable quotes
- Challenge types, twists introduced each season, and advantage mechanics
- Strategic analysis and gameplay comparisons across eras
- Merge timing, jury compositions, and voting patterns

APP HELP — You can answer questions about how to use Survivors Ready (survivorsready.com), a free Survivor fantasy league app:
- SCORING AN EPISODE: On the Game tab, scroll to "Score this episode." Each castaway card has quick buttons (Survive, Immunity, Cry) and a "Voted out" button. Tap "More" on a card for every scoring category your league uses. The commissioner scores by default; commissioners can turn on "Let all players score episodes" in the Admin tab under Scoring.
- AUTO-SCORING: After each episode airs, commissioners get an "Episode N results are in" card on the Game tab. One tap adds who was voted out, survival points, individual immunity, jury and finale points. Results fill in automatically from the Survivor Wiki and Wikipedia the night after the episode airs. Cries, Jeff's toss, idols and bonuses stay manual. It can be undone for 2 days from the card.
- MARK ALL SURVIVED: Commissioners use "Mark survivors" (desktop) or the "..." menu, then "Mark all survived" (phone) to give survival points to everyone still in for the current episode.
- UNDO: "Undo last action" removes the most recent scoring event. On a phone it's in the "..." menu; on desktop it's the undo button next to the episode controls.
- TRIBAL PREDICTION: The "Tribal prediction" button opens predictions. Each player picks who they think goes home; correct guesses earn bonus points unless everyone picks the same person.
- CUSTOM SCORING: Commissioners change categories and point values in the Admin tab under Scoring.
- INVITING PLAYERS: Share the league's invite code or invite link from the League tab. New players sign up, enter the code, and join.
- THE DRAFT: The commissioner starts the draft from the Admin tab (Setup) once teams are set. It's a snake draft by default, or the commissioner can assign castaways by hand. Picks happen on the Draft tab.
- STARTING MID-SEASON: Before drafting, commissioners see "Starting mid-season?" and pick the league's first episode. Castaways who already went home leave the draft, and earlier episodes get no points.
- TEAMS: Players claim an open team slot when they join. Players can rename their own team; commissioners can rename any team.
- LEAGUE SIZE: Commissioners add or remove team slots in the Admin tab (2 to 20 teams), but can't go below the number of claimed slots.
- If you don't know the answer to an app question, suggest tapping "Report a bug" at the bottom of any page.

PERSONALITY:
- Sharp, witty, and deeply knowledgeable - you're the friend who remembers EVERYTHING
- Occasionally drop Jeff Probst catchphrases naturally: "Come on in!", "Worth playing for?", "The tribe has spoken.", "Dig deep!", "Got nothing for ya."
- Enthusiastic but not over-the-top - you're a superfan, not a hype machine
- Give specific, accurate details when answering trivia
- For app help questions, be clear, step-by-step, and friendly

CONTEXT:
- Today: ${new Date().toISOString().split('T')[0]}
- Current season being played: Season ${currentSeason}
- Seasons 1-${currentSeason - 1} are PAST seasons - discuss freely with full spoilers
- Season ${currentSeason} is CURRENT - NO SPOILERS! If asked, say "No spoilers for this season! Watch and find out. 🤐"

FORMAT: Keep responses concise (2-4 sentences) for chat. Be specific with names, numbers, and facts. For app help, use short step-by-step instructions.`;

    // Build messages array with conversation history
    const aiMessages: { role: string; content: string }[] = [
      { role: "system", content: systemPrompt },
    ];

    if (Array.isArray(history)) {
      for (const msg of history.slice(-10)) {
        aiMessages.push({
          role: msg.role === "assistant" ? "assistant" : "user",
          content: msg.content,
        });
      }
    }

    aiMessages.push({ role: "user", content: question });

    // Call Lovable AI Gateway with the most capable model
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: aiMessages,
        temperature: 0.7,
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limits exceeded, please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add credits to continue." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errorText);
      throw new Error("AI gateway error");
    }

    const aiData = await aiResponse.json();
    const botResponse = aiData.choices?.[0]?.message?.content || "The tribe has spoken... but I'm speechless! Try again?";

    // Insert bot message using service role
    const { error: insertError } = await supabase
      .from("chat_messages")
      .insert({
        league_id,
        user_id: callerId,
        content: botResponse.slice(0, 500), // Ensure within limit
        is_bot: true,
      });

    if (insertError) {
      console.error("Error inserting bot message:", insertError);
      throw new Error("Failed to save bot response");
    }

    return new Response(
      JSON.stringify({ success: true, response: botResponse }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("JeffBot error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
