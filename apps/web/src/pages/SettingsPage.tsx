import { useCallback, useEffect, useState } from "react";
import { Clock, Save, Sparkles, Zap } from "lucide-react";
import { toast } from "sonner";
import type { SystemSettings } from "@watcher/shared";
import { api } from "@/lib/api";
import { formatDateTime, formatRelative } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PageLoader } from "@/components/Spinner";

interface AiForm {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function SettingsPage() {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [intervalMinutes, setIntervalMinutes] = useState("");
  const [ai, setAi] = useState<AiForm>({ enabled: true, baseUrl: "", apiKey: "", model: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingAi, setTestingAi] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applySettings = useCallback((next: SystemSettings) => {
    setSettings(next);
    setIntervalMinutes(String(next.scrapIntervalMinutes));
    setAi({
      enabled: next.aiEnabled,
      baseUrl: next.aiBaseUrl,
      apiKey: next.aiApiKey,
      model: next.aiModel,
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const next = await api.settings();
      applySettings(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, [applySettings]);

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
      applySettings(next);
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

  async function saveAi() {
    const baseUrl = ai.baseUrl.trim().replace(/\/+$/, "");
    if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
      toast.error("Base URL must start with http:// or https://");
      return;
    }
    if (!ai.model.trim()) {
      toast.error("Model is required");
      return;
    }

    setSaving(true);
    try {
      const next = await api.updateSettings({
        aiEnabled: ai.enabled,
        aiBaseUrl: baseUrl,
        aiApiKey: ai.apiKey.trim(),
        aiModel: ai.model.trim(),
      });
      applySettings(next);
      toast.success("AI evaluation settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function testAi() {
    setTestingAi(true);
    try {
      const res = await api.aiTest({
        aiBaseUrl: ai.baseUrl.trim(),
        aiApiKey: ai.apiKey.trim(),
        aiModel: ai.model.trim(),
      });
      if (res.ok) toast.success(`Connection OK · ${res.detail}`, { description: res.model });
      else toast.error(`Connection failed · ${res.detail}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Connection test failed");
    } finally {
      setTestingAi(false);
    }
  }

  if (loading && !settings) return <PageLoader />;

  if (!settings) {
    return <p className="text-muted-foreground">{error ?? "Settings unavailable."}</p>;
  }

  const parsed = Number(intervalMinutes);
  const dirty =
    Number.isInteger(parsed) && parsed !== settings.scrapIntervalMinutes;
  const aiDirty =
    ai.enabled !== settings.aiEnabled ||
    ai.baseUrl.trim().replace(/\/+$/, "") !== settings.aiBaseUrl ||
    ai.apiKey.trim() !== settings.aiApiKey ||
    ai.model.trim() !== settings.aiModel;

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

      <Card className="border-border/80 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            AI evaluation
          </CardTitle>
          <CardDescription>
            Listings are evaluated against each routine's AI prompt after every scrape. Uses an
            Ollama-compatible cloud API — create a key at{" "}
            <a
              href="https://ollama.com/settings/keys"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary hover:underline"
            >
              ollama.com/settings/keys
            </a>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/30 px-3.5 py-3">
            <div className="min-w-0">
              <Label htmlFor="ai-enabled" className="text-sm font-medium">
                Enable AI evaluation
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Runs automatically as the last step of each scrape.
              </p>
            </div>
            <Switch
              id="ai-enabled"
              checked={ai.enabled}
              onCheckedChange={(v) => setAi((a) => ({ ...a, enabled: v }))}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ai-base-url">Base URL</Label>
              <Input
                id="ai-base-url"
                type="url"
                placeholder="https://ollama.com"
                value={ai.baseUrl}
                onChange={(e) => setAi((a) => ({ ...a, baseUrl: e.target.value }))}
              />
              <p className="text-[11px] text-muted-foreground">
                Any Ollama-compatible endpoint (cloud or local).
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-model">Model</Label>
              <Input
                id="ai-model"
                placeholder="gemma4:31b"
                value={ai.model}
                onChange={(e) => setAi((a) => ({ ...a, model: e.target.value }))}
              />
              <p className="text-[11px] text-muted-foreground">
                Model name as listed by the endpoint.
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ai-api-key">API key</Label>
            <Input
              id="ai-api-key"
              type="password"
              autoComplete="off"
              placeholder="Bearer token (leave empty for keyless local endpoints)"
              value={ai.apiKey}
              onChange={(e) => setAi((a) => ({ ...a, apiKey: e.target.value }))}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="gap-1.5"
              disabled={testingAi}
              onClick={() => void testAi()}
            >
              <Zap className="h-4 w-4" />
              {testingAi ? "Testing…" : "Test connection"}
            </Button>
            <Button
              type="button"
              className="gap-1.5"
              disabled={saving || !aiDirty}
              onClick={() => void saveAi()}
            >
              <Save className="h-4 w-4" />
              {saving ? "Saving…" : aiDirty ? "Save" : "Saved"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
