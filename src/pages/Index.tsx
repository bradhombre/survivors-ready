import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { SunO } from "@/components/Lockup";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

const Index = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const heroRef = useRef<HTMLElement>(null);
  const sunRef = useRef<HTMLSpanElement>(null);

  // Where the horizon sits, measured from the sun in the wordmark so the sun always
  // rises exactly out of the water, whatever the font metrics or screen size.
  const [horizon, setHorizon] = useState(215);

  useLayoutEffect(() => {
    const measure = () => {
      const hero = heroRef.current;
      const sun = sunRef.current;
      if (!hero || !sun) return;
      const h = hero.getBoundingClientRect();
      const r = sun.getBoundingClientRect();
      setHorizon(Math.round(r.top - h.top + r.height / 2));
    };
    measure();
    document.fonts?.ready.then(measure).catch(() => {});
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [loading]);

  useEffect(() => {
    if (!loading && user) {
      navigate("/leagues");
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const joinWithCode = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = code.trim().toUpperCase();
    if (clean) navigate(`/join/${encodeURIComponent(clean)}`);
  };

  const titleShadow = {
    textShadow:
      "3px 3px 0 #121611, -1px -1px 0 #121611, 1px -1px 0 #121611, -1px 1px 0 #121611",
  } as const;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Hero scene: sky, horizon, ocean, islands */}
      <section ref={heroRef} className="relative h-[430px] sm:h-[480px] overflow-hidden bg-sky" aria-label="Survivors Ready">
        {/* Ocean below the horizon */}
        <div
          className="absolute inset-x-0 bottom-0"
          style={{
            top: horizon,
            background:
              "repeating-linear-gradient(180deg, hsl(var(--ocean)) 0 8px, hsl(var(--ocean-stripe)) 8px 12px)",
          }}
        />
        {/* Islands sit on the horizon */}
        <span
          aria-hidden="true"
          className="absolute right-[-60px] h-10 w-[150px] sm:w-[220px] bg-[#1D3326]"
          style={{ top: horizon - 20, borderRadius: "50% 50% 0 0 / 100% 100% 0 0" }}
        />
        <span
          aria-hidden="true"
          className="absolute right-2 sm:right-10 h-24 w-24 bg-[#1D3326]"
          style={{
            top: horizon - 110,
            transform: "scaleX(-1)",
            WebkitMask: "url(/brand/gi-palm-tree.svg) center / contain no-repeat",
            mask: "url(/brand/gi-palm-tree.svg) center / contain no-repeat",
          }}
        />
        <span
          aria-hidden="true"
          className="absolute left-[-30px] sm:left-[-40px]"
          style={{ top: horizon }}
        >
          <span
            className="block h-5 w-[100px] sm:h-10 sm:w-[320px] bg-[#24402F] -translate-y-full"
            style={{ borderRadius: "50% 50% 0 0 / 100% 100% 0 0" }}
          />
        </span>

        {/* Top bar */}
        <div className="relative container max-w-5xl mx-auto px-5 pt-5 flex items-center justify-between">
          <span className="font-label text-base tracking-[0.2em] text-[#1D3326]">FREE FANTASY LEAGUE</span>
          <button
            onClick={() => navigate("/auth")}
            className="min-h-[44px] px-1 text-base font-bold text-[#1D3326] hover:underline"
          >
            Sign in
          </button>
        </div>

        {/* Wordmark sitting on the horizon: the sun rises out of the real water */}
        <div className="absolute inset-x-0 top-[180px] sm:top-[205px]">
          {/* All lines center-aligned on every screen size */}
          <div className="container max-w-5xl mx-auto px-5 flex justify-center">
            <div className="w-fit text-center">
              <h1 className="font-display leading-none text-[#E9E3D3]" style={titleShadow}>
                <span className="flex items-baseline justify-center text-[54px] sm:text-[72px]">
                  SURVIV
                  <SunO ref={sunRef} water={0.5} seeThrough />
                  RS
                </span>
                <span className="block text-[54px] sm:text-[72px] tracking-[0.02em] mt-1">READY</span>
              </h1>
              <p className="font-label mt-3 pl-[0.3em] text-lg sm:text-xl tracking-[0.3em] text-[#E9E3D3]">
                DRAFT · SCORE · OUTLAST
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Sand panel */}
      <section className="relative flex-1">
        <div
          aria-hidden="true"
          className="h-[14px]"
          style={{
            background:
              "linear-gradient(135deg, hsl(var(--accent)) 25%, transparent 25%) -7px 0 / 14px 14px, linear-gradient(225deg, hsl(var(--accent)) 25%, transparent 25%) -7px 0 / 14px 14px, hsl(var(--ocean))",
          }}
        />
        <div className="border-t-4 border-accent">
          <div className="container max-w-5xl mx-auto px-5 py-8 sm:py-10 grid grid-cols-1 gap-8 md:grid-cols-[1.2fr_1fr] md:items-start">
            <div className="flex flex-col gap-4">
              <p className="label-caps text-accent">A free fantasy league for Survivor fans · Season 51</p>
              <h2 className="font-display text-[44px] sm:text-[54px] leading-[0.92] text-primary">
                Draft the cast. Score every episode.
              </h2>
              <p className="text-[17px] leading-relaxed text-muted-foreground max-w-prose">
                Fantasy football, but for Survivor. Your group drafts castaways from the current season of
                the show, scores each episode during or after it airs, and the standings update for everyone.
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <Button variant="accent" size="lg" className="h-[58px] text-lg" onClick={() => navigate("/auth")}>
                Start a league
              </Button>
              <form onSubmit={joinWithCode} className="flex gap-2">
                <label htmlFor="invite-code" className="sr-only">
                  Invite code
                </label>
                <input
                  id="invite-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="INVITE CODE"
                  autoCapitalize="characters"
                  autoComplete="off"
                  className="h-[54px] min-w-0 flex-1 rounded-[12px] border-2 border-plank bg-card px-4 text-lg font-extrabold tracking-[0.22em] uppercase placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <Button type="submit" className="h-[54px] px-6 text-base" disabled={!code.trim()}>
                  Join
                </Button>
              </form>
              <p className="text-sm text-muted-foreground">Have an invite code? Enter it to join your league.</p>
            </div>
          </div>

        </div>
      </section>

      {/* How it works */}
      <section className="container max-w-5xl mx-auto px-5 py-10" aria-labelledby="how-heading">
        <p className="label-caps text-accent">How it works</p>
        <h2 id="how-heading" className="font-display text-4xl sm:text-5xl leading-[0.95] text-primary mt-2">
          Three steps to Tribal
        </h2>
        <ol className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          {HOW_IT_WORKS.map((step, i) => (
            <li key={step.title} className="plank p-5 flex flex-col gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-plank bg-warning text-lg font-black text-warning-foreground">
                {i + 1}
              </span>
              <h3 className="font-display text-2xl leading-none mt-1">{step.title}</h3>
              <p className="text-[15px] leading-relaxed text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* A look inside */}
      <section className="bg-header" aria-labelledby="inside-heading">
        <div className="buff-trim" aria-hidden="true" />
        <div className="container max-w-5xl mx-auto px-5 py-10">
          <p className="label-caps text-header-label">A look inside</p>
          <h2 id="inside-heading" className="font-display text-4xl sm:text-5xl leading-[0.95] mt-2">
            Built for the couch on Wednesday night
          </h2>
          <p className="mt-3 max-w-prose text-[15px] leading-relaxed text-header-label">
            Big buttons, one-tap scoring, and standings that update for everyone as points come in. Shown with a
            sample league.
          </p>
          <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-2 justify-items-center">
            <PhoneFrame caption="The Game tab: live standings">
              <SampleLeaderboard />
            </PhoneFrame>
            <PhoneFrame caption="Scoring: tap what happened">
              <SampleScoring />
            </PhoneFrame>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="container max-w-3xl mx-auto px-5 py-10" aria-labelledby="faq-heading">
        <p className="label-caps text-accent">Questions</p>
        <h2 id="faq-heading" className="font-display text-4xl sm:text-5xl leading-[0.95] text-primary mt-2">
          FAQ
        </h2>
        <Accordion type="single" collapsible className="mt-6 plank px-5">
          {FAQ.map((item, i) => (
            <AccordionItem key={item.q} value={`q${i}`} className={i === FAQ.length - 1 ? "border-b-0" : "border-border"}>
              <AccordionTrigger className="text-left text-base font-bold hover:no-underline">{item.q}</AccordionTrigger>
              <AccordionContent className="text-[15px] leading-relaxed text-muted-foreground">{item.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>

      {/* Closing call to action */}
      <section className="container max-w-3xl mx-auto px-5 pb-8 text-center flex flex-col items-center gap-4">
        <h2 className="font-display text-4xl sm:text-5xl leading-[0.95] text-primary">Survivors ready?</h2>
        <p className="text-muted-foreground">Start a league in about a minute. It's free.</p>
        <Button variant="accent" size="lg" className="h-[58px] text-lg w-full max-w-sm" onClick={() => navigate("/auth")}>
          Start a league
        </Button>
        <p className="mt-6 text-xs text-muted-foreground">
          Palm illustration by Delapouite, game-icons.net (CC BY 3.0).
        </p>
      </section>
    </div>
  );
};

const HOW_IT_WORKS = [
  {
    title: "Start a league",
    body: "Name it, pick full fantasy or winner takes all, and share an invite code or link. Anywhere from 2 to 20 teams.",
  },
  {
    title: "Draft the cast",
    body: "The official cast loads with photos and tribes. Run a snake or straight draft, live or at your own pace.",
  },
  {
    title: "Score every episode",
    body: "Tap what happened: immunity wins, idols, vote-outs, the episode title. Standings update for everyone right away.",
  },
];

const FAQ = [
  { q: "Is it free?", a: "Yes. Every league and every feature is free. There's an optional tip jar if you want to buy us a coffee." },
  {
    q: "Is this affiliated with CBS or the show?",
    a: "No. Survivors Ready is a free fan game made by a Survivor fan. It isn't affiliated with or endorsed by CBS or the show.",
  },
  { q: "How many people can play?", a: "A league can have 2 to 20 teams. Most leagues are a group of friends or family with 4 to 12." },
  {
    q: "Do I need to download an app?",
    a: "No. It works in the browser on your phone or computer. On a phone you can add it to your home screen so it opens like an app.",
  },
  {
    q: "Who does the scoring?",
    a: "The commissioner scores each episode, during or after it airs. Commissioners can also let everyone in the league score.",
  },
  {
    q: "How do points work?",
    a: "Pick a scoring template (Standard, Competitive, Simple, Survival Only or Idol Hunter) or set your own point values for every action.",
  },
  {
    q: "The season already started. Can we still play?",
    a: "Yes. Draft whenever your group is ready, then score the episodes you missed. Nothing locks after the premiere.",
  },
  {
    q: "What's winner takes all?",
    a: "Instead of scoring every episode, each team picks who they think will win. The last pick standing takes the league.",
  },
  {
    q: "What happens at the end of the season?",
    a: "Final standings are saved to your league's History. Next season, the same league starts fresh with the new cast.",
  },
];

/** Phone-shaped frame for the sample screens */
function PhoneFrame({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <figure className="flex flex-col items-center gap-3">
      <div className="w-[300px] max-w-full overflow-hidden rounded-[36px] border-[8px] border-[#121611] bg-background text-foreground shadow-2xl">
        {children}
      </div>
      <figcaption className="text-sm font-semibold text-header-label">{caption}</figcaption>
    </figure>
  );
}

const SAMPLE_TEAMS = [
  { name: "Dana", total: 412, ep: 46, active: 4, color: "#4E8A64" },
  { name: "Marco", total: 389, ep: 31, active: 5, color: "#D8B55E" },
  { name: "Priya", total: 355, ep: 12, active: 3, color: "#6B8FA8" },
  { name: "Jules", total: 301, ep: 25, active: 2, color: "#C07A5A" },
];

function SampleLeaderboard() {
  return (
    <div aria-hidden="true" className="select-none">
      <div className="bg-header px-4 pt-4 pb-3">
        <p className="label-caps text-header-label text-[10px]">Season 51 · Full fantasy</p>
        <p className="font-display text-[26px] leading-none mt-1">Beach House League</p>
        <div className="mt-3 flex items-center gap-2">
          <span className="rounded-[8px] bg-[#E9E3D3] px-3 py-1.5 text-sm font-black text-[#1D3326]">− Ep 6 +</span>
          <span className="rounded-full border-2 border-[#9DB2A2] px-2 py-0.5 text-[11px] font-bold text-[#CFDCD1]">Pre-merge</span>
        </div>
      </div>
      <div className="buff-trim" />
      <div className="flex flex-col gap-2 p-3">
        {SAMPLE_TEAMS.map((t, i) => (
          <div key={t.name} className="plank flex items-center gap-2.5 px-3 py-2">
            <span className="w-4 text-base font-black text-primary">{i + 1}</span>
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-plank text-sm font-extrabold text-[#18201B]"
              style={{ background: t.color }}
            >
              {t.name[0]}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-xl leading-none">{t.name}</p>
              <div className="mt-1 flex items-center gap-1">
                {Array.from({ length: 5 }, (_, k) => (
                  <span
                    key={k}
                    className={`h-2 w-2 rounded-full ${k < t.active ? "bg-success" : "border border-input"}`}
                  />
                ))}
                <span className="ml-1 text-[10px] font-semibold text-muted-foreground">{t.active}/5</span>
              </div>
            </div>
            <div className="text-right leading-none">
              <p className="text-xl font-black tabular">{t.total}</p>
              <p className="text-[10px] font-bold text-success">+{t.ep} ep 6</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const SAMPLE_EVENTS = [
  { label: "Won immunity", pts: 25 },
  { label: "Found an idol", pts: 100 },
  { label: "Survived the vote", pts: 5 },
  { label: "Correct Tribal vote", pts: 10 },
  { label: "Said the episode title", pts: 25 },
  { label: "Cried", pts: 10 },
];

function SampleScoring() {
  return (
    <div aria-hidden="true" className="select-none">
      <div className="buff-trim" />
      <div className="flex flex-col gap-3 p-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-plank bg-muted text-sm font-extrabold">
            RA
          </span>
          <div className="min-w-0">
            <p className="font-display text-[22px] leading-none">Riley Adair</p>
            <p className="text-[11px] font-medium text-muted-foreground">Dana's team · Still in</p>
          </div>
          <div className="ml-auto text-right leading-none">
            <p className="text-xl font-black tabular">138</p>
            <p className="text-[10px] font-bold text-success">+30 ep 6</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {SAMPLE_EVENTS.map((e) => (
            <div
              key={e.label}
              className="flex h-14 flex-col justify-center rounded-[10px] border-2 border-plank border-b-4 bg-card px-2.5"
            >
              <span className="text-[12px] font-bold leading-tight">{e.label}</span>
              <span className="text-sm font-black text-success">+{e.pts}</span>
            </div>
          ))}
        </div>
        <div className="flex h-11 items-center justify-center rounded-[10px] border-2 border-plank border-b-4 bg-accent text-sm font-extrabold text-accent-foreground">
          Voted out this episode
        </div>
        <p className="text-center text-[10px] text-muted-foreground">Sample league · Standard scoring</p>
      </div>
    </div>
  );
}

export default Index;
