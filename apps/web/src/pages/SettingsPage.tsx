import { useCallback, useEffect, useState } from "react";
import { Clock, Save } from "lucide-react";
import { toast } from "sonner";
import type { SystemSettings } from "@watcher/shared";
import { api } from "@/lib/api";
import { formatDateTime, formatRelative } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageLoader } from "@/components/Spinner";

export function SettingsPage() {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [intervalMinutes, setIntervalMinutes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await api.settings();
      setSettings(next);
      setIntervalMinutes(String(next.scrapIntervalMinutes));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    const n = Number(intervalMinutes);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      toast.error("Enter a whole number of minutes");
      return;
    }
    if (n < settings!.scrapIntervalMin || n > settings!.scrapIntervalMax) {
      toast.error(
        `Interval must be between ${settings!.scrapIntervalMin} and ${settings!.scrapIntervalMax} minutes`,
      );
      return;
    }

    setSaving(true);
    try {
      const next = await api.updateSettings({ scrapIntervalMinutes: n });
      setSettings(next);
      setIntervalMinutes(String(next.scrapIntervalMinutes));
      toast.success(
        `Scrape interval set to ${next.scrapIntervalMinutes} min` +
          (next.nextScrapeAt
            ? ` · next ${formatRelative(next.nextScrapeAt)}`
            : ""),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (loading && !settings) return <PageLoader />;

  if (!settings) {
    return <p className="text-muted-foreground">{error ?? "Settings unavailable."}</p>;
  }

  const parsed = Number(intervalMinutes);
  const dirty =
    Number.isInteger(parsed) && parsed !== settings.scrapIntervalMinutes;

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        System preferences are stored in the database and survive restarts.
      </p>

      <Card className="border-border/80 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4 text-muted-foreground" />
            Scraping
          </CardTitle>
          <CardDescription>
            How often enabled routines are scraped automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="scrap-interval">Interval (minutes)</Label>
            <div className="flex flex-wrap items-end gap-2">
              <Input
                id="scrap-interval"
                type="number"
                inputMode="numeric"
                min={settings.scrapIntervalMin}
                max={settings.scrapIntervalMax}
                step={1}
                className="max-w-[10rem] tabular-nums"
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void save();
                }}
              />
              <Button
                type="button"
                onClick={() => void save()}
                disabled={saving || !dirty}
                className="gap-1.5"
              >
                <Save className="h-4 w-4" />
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Allowed range: {settings.scrapIntervalMin}–{settings.scrapIntervalMax} minutes
              (currently every {settings.scrapIntervalMinutes} min).
            </p>
          </div>

          <div className="rounded-xl border border-border/70 bg-muted/30 px-3 py-2.5 text-sm">
            <div className="flex flex-wrap justify-between gap-2 py-1">
              <span className="text-muted-foreground">Next scrape</span>
              <span className="text-right font-medium">
                {settings.nextScrapeAt
                  ? `${formatRelative(settings.nextScrapeAt)} · ${formatDateTime(settings.nextScrapeAt)}`
                  : "—"}
              </span>
            </div>
            <div className="flex flex-wrap justify-between gap-2 border-t border-border/60 py-1">
              <span className="text-muted-foreground">Last scrape</span>
              <span className="text-right font-medium">
                {settings.lastScrapeAt
                  ? `${formatRelative(settings.lastScrapeAt)} · ${formatDateTime(settings.lastScrapeAt)}`
                  : "—"}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
