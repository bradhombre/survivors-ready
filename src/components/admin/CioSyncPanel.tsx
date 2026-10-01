import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Mail, RefreshCw, Eye } from "lucide-react";
import { confirmDialog } from "@/components/ConfirmHost";

// Tables newer than the generated Supabase types
const db = supabase as unknown as { from: (table: string) => any };

type Run = { id: number; ran_at: string; ok: boolean; summary: string | null };
type Preview = {
  ok: boolean;
  error?: string;
  enabled: boolean;
  has_api_key: boolean;
  first_run: boolean;
  people: number;
  attribute_updates: number;
  events_marked_done_first_run: Record<string, number>;
  events_to_send: Record<string, number>;
  sample_attributes: Record<string, unknown>[];
  sample_events: { name: string; data: Record<string, unknown> }[];
  stages: Record<string, number>;
};

const list = (c: Record<string, number>) =>
  Object.entries(c)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`)
    .join(" · ") || "none";

/**
 * Site admin > Settings: the hourly Customer.io sync (profile attributes + events from the
 * server). Off until turned on; Preview shows exactly what a run would send.
 */
export function CioSyncPanel() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"" | "preview" | "run" | "toggle">("");

  const load = async () => {
    const [{ data: setting }, { data: log }] = await Promise.all([
      supabase.from("app_settings").select("value").eq("key", "cio_sync_enabled").maybeSingle(),
      db.from("cio_sync_log").select("id, ran_at, ok, summary").order("ran_at", { ascending: false }).limit(5),
    ]);
    setEnabled(String(setting?.value ?? "").toLowerCase() === "true");
    setRuns((log as Run[]) || []);
  };
  useEffect(() => {
    load();
  }, []);

  const runPreview = async () => {
    setBusy("preview");
    try {
      const { data, error } = await supabase.functions.invoke("cio-sync", { body: { preview: true } });
      if (error) throw error;
      setPreview(data as Preview);
    } catch (err: any) {
      toast.error(`Couldn't preview: ${err?.message || "try again"}`);
    } finally {
      setBusy("");
    }
  };

  const runNow = async () => {
    setBusy("run");
    try {
      const { data, error } = await supabase.functions.invoke("cio-sync", { body: { force: true } });
      if (error) throw error;
      toast.success((data as { summary?: string; skipped?: string })?.summary || (data as { skipped?: string })?.skipped || "Synced");
      await load();
    } catch (err: any) {
      toast.error(`Couldn't sync: ${err?.message || "try again"}`);
    } finally {
      setBusy("");
    }
  };

  const toggle = async (on: boolean) => {
    if (
      on &&
      !(await confirmDialog({
        title: "Turn on the Customer.io sync?",
        description:
          "Every hour the site updates people's profiles in Customer.io and sends events (signed up, league created or joined, season started, draft done, episode scored). The first run only marks past activity as done; nothing old is sent. No emails go out unless an automation in Customer.io is running on these.",
        confirmText: "Turn on",
      }))
    )
      return;
    setBusy("toggle");
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: "cio_sync_enabled", value: on ? "true" : "false", updated_at: new Date().toISOString() });
    if (error) toast.error("Couldn't save");
    else {
      setEnabled(on);
      toast.success(on ? "Customer.io sync is on. It runs every hour at :37." : "Customer.io sync is off");
    }
    setBusy("");
  };

  const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-3xl">
          <Mail className="h-5 w-5 text-muted-foreground" />
          Customer.io sync
        </CardTitle>
        <CardDescription>
          Keeps Customer.io up to date from the server: each person's leagues, whether they're a commissioner and their
          league's stage, plus events like league created, draft done and episode scored. Emails and in-app messages use
          these. Runs every hour; only changes are sent.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label htmlFor="cio-on" className="glass rounded-[12px] flex items-start gap-3 p-3 cursor-pointer max-w-xl">
          <Switch id="cio-on" checked={!!enabled} disabled={enabled === null || busy !== ""} onCheckedChange={toggle} />
          <span className="text-sm">
            <b className="block">{enabled ? "On" : "Off"}</b>
            <span className="text-muted-foreground">
              {enabled ? "Sending every hour at :37." : "Nothing is sent. Preview first, then turn it on."}
            </span>
          </span>
        </label>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-11 gap-2" onClick={runPreview} disabled={busy !== ""}>
            <Eye className="h-4 w-4" />
            {busy === "preview" ? "Checking…" : "Preview (sends nothing)"}
          </Button>
          {enabled && (
            <Button variant="outline" className="h-11 gap-2" onClick={runNow} disabled={busy !== ""}>
              <RefreshCw className={`h-4 w-4 ${busy === "run" ? "animate-spin" : ""}`} />
              {busy === "run" ? "Syncing…" : "Sync now"}
            </Button>
          )}
        </div>

        {preview && (
          <div className="rounded-[12px] border-2 border-border p-3 text-sm space-y-1.5">
            {preview.error ? (
              <p className="text-destructive font-semibold">{preview.error}</p>
            ) : (
              <>
                {!preview.has_api_key && <p className="text-destructive font-semibold">The Customer.io key isn't set on the server.</p>}
                <p className="tabular">
                  <b>{preview.people}</b> people · <b>{preview.attribute_updates}</b> profile updates to send
                </p>
                {preview.first_run ? (
                  <p className="tabular">
                    First run: past activity is marked as done, not sent ({list(preview.events_marked_done_first_run)}).
                  </p>
                ) : (
                  <p className="tabular">Events to send: {list(preview.events_to_send)}</p>
                )}
                <p className="tabular text-muted-foreground">League stages: {list(preview.stages)}</p>
                {preview.sample_attributes.length > 0 && (
                  <details>
                    <summary className="cursor-pointer font-semibold">Sample profile updates</summary>
                    <pre className="mt-2 whitespace-pre-wrap break-all text-xs">{JSON.stringify(preview.sample_attributes, null, 2)}</pre>
                  </details>
                )}
                {preview.sample_events.length > 0 && (
                  <details>
                    <summary className="cursor-pointer font-semibold">Sample events</summary>
                    <pre className="mt-2 whitespace-pre-wrap break-all text-xs">{JSON.stringify(preview.sample_events, null, 2)}</pre>
                  </details>
                )}
              </>
            )}
          </div>
        )}

        {runs.length > 0 && (
          <ul className="divide-y divide-border">
            {runs.map((r) => (
              <li key={r.id} className="py-2 text-sm flex gap-3">
                <span className="shrink-0 w-24 text-muted-foreground tabular">{fmt(r.ran_at)}</span>
                <span className={r.ok ? "" : "text-destructive font-semibold"}>{r.summary || (r.ok ? "Synced" : "Failed")}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
