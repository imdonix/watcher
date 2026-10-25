import { useCallback, useEffect, useState } from "react";
import {
  BellRing,
  Clock,
  Eye,
  EyeOff,
  Save,
  Sparkles,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import type { SystemSettings } from "@watcher/shared";
import { api } from "@/lib/api";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field } from "@/components/Field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/PageHeader";
import { PageLoader } from "@/components/Spinner";
import {
  disablePushNotifications,
  enablePushNotifications,
  getExistingSubscription,
  getNotificationPermission,
  isPushSupported,
} from "@/lib/push";
import { notifyPushStateChanged } from "@/lib/push-events";

interface AiForm {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  passThreshold: string;
}

function PushSettings() {
  const supported = isPushSupported();
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      if (!supported) return;
      const perm = await getNotificationPermission();
      const sub = await getExistingSubscription();
      setOn(perm === "granted" && Boolean(sub));
    })();
  }, [supported]);

  async function toggle() {
    setBusy(true);
    try {
      if (on) {
        await disablePushNotifications();
        setOn(false);
        notifyPushStateChanged();
        toast.message("Push notifications off");
      } else {
        await enablePushNotifications();
        setOn(true);
        notifyPushStateChanged();
        toast.success("Push notifications on");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Push setup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="grid size-7 place-items-center rounded-md bg-muted text-muted-foreground">
            <BellRing className="size-4" />
          </span>
          Notifications
        </CardTitle>
        <CardDescription>
          Push alerts for new listings and price drops, delivered through the service worker.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/20 px-3.5 py-3">
          <div className="min-w-0">
            <Label htmlFor="push-enabled" className="text-sm">
              Push notifications on this device
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {supported
                ? on
                  ? "This device is subscribed and will receive alerts."
                  : "Enable to receive alerts when the app is closed."
                : "This browser does not support Web Push."}
            </p>
          </div>
          <Switch
            id="push-enabled"
            checked={on}
            disabled={!supported || busy}
            onCheckedChange={() => void toggle()}
          />
        </div>
      </CardContent>
    </Card>
  );
}

export function SettingsPage() {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [intervalMinutes, setIntervalMinutes] = useState("");
  const [ai, setAi] = useState<AiForm>({
    enabled: true,
    baseUrl: "",
    apiKey: "",
    model: "",
    passThreshold: "65",
  });
  const [showKey, setShowKey] = useState(false);
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
      passThreshold: String(next.aiPassThreshold ?? 65),
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
          (next.nextScrapeAt ? ` · next ${formatRelative(next.nextScrapeAt)}` : ""),
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
    const threshold = Number(ai.passThreshold);
    if (!Number.isInteger(threshold) || threshold < 0 || threshold > 100) {
      toast.error("Pass threshold must be a whole number between 0 and 100");
      return;
    }

    setSaving(true);
    try {
      const next = await api.updateSettings({
        aiEnabled: ai.enabled,
        aiBaseUrl: baseUrl,
        aiApiKey: ai.apiKey.trim(),
        aiModel: ai.model.trim(),
        aiPassThreshold: threshold,
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

  if (loading && !settings) return <PageLoader label="Loading settings…" />;

  if (!settings) {
    return (
      <div className="space-y-4">
        <PageHeader title="Settings" />
        <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          {error ?? "Settings unavailable."}
        </div>
      </div>
    );
  }

  const parsed = Number(intervalMinutes);
  const dirty = Number.isInteger(parsed) && parsed !== settings.scrapIntervalMinutes;
  const aiDirty =
    ai.enabled !== settings.aiEnabled ||
    ai.baseUrl.trim().replace(/\/+$/, "") !== settings.aiBaseUrl ||
    ai.apiKey.trim() !== settings.aiApiKey ||
    ai.model.trim() !== settings.aiModel ||
    Number(ai.passThreshold) !== settings.aiPassThreshold;

  const presets = [15, 30, 60, 120, 240, 360, 720].filter(
    (n) => n >= settings.scrapIntervalMin && n <= settings.scrapIntervalMax,
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings"
        description="System preferences live in the database and survive restarts and deploys."
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="grid size-7 place-items-center rounded-md bg-muted text-muted-foreground">
                  <Clock className="size-4" />
                </span>
                Scraping schedule
              </CardTitle>
              <CardDescription>How often enabled routines are scraped automatically.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field
                label="Interval (minutes)"
                htmlFor="scrap-interval"
                description={`Allowed range: ${settings.scrapIntervalMin}–${settings.scrapIntervalMax} minutes. Currently every ${settings.scrapIntervalMinutes} min.`}
              >
                <div className="flex gap-2">
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
                  >
                    <Save />
                    {saving ? "Saving…" : "Save"}
                  </Button>
                </div>
              </Field>

              {presets.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {presets.map((n) => (
                    <Button
                      key={n}
                      type="button"
                      variant={String(n) === intervalMinutes ? "secondary" : "outline"}
                      size="sm"
                      className="h-8 px-2.5 text-[11px] tabular-nums"
                      onClick={() => setIntervalMinutes(String(n))}
                    >
                      {n < 60 ? `${n} min` : `${n / 60} h`}
                    </Button>
                  ))}
                </div>
              )}

              <Separator />

              <dl className="space-y-2 text-sm">
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-muted-foreground">Next scrape</dt>
                  <dd className="text-right font-medium">
                    {settings.nextScrapeAt
                      ? `${formatRelative(settings.nextScrapeAt)} · ${formatDateTime(settings.nextScrapeAt)}`
                      : "—"}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-muted-foreground">Last scrape</dt>
                  <dd className="text-right font-medium">
                    {settings.lastScrapeAt
                      ? `${formatRelative(settings.lastScrapeAt)} · ${formatDateTime(settings.lastScrapeAt)}`
                      : "—"}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <PushSettings />
        </div>

        <Card className="self-start">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="grid size-7 place-items-center rounded-md bg-muted text-muted-foreground">
                <Sparkles className="size-4" />
              </span>
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
            <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/20 px-3.5 py-3">
              <div className="min-w-0">
                <Label htmlFor="ai-enabled" className="text-sm">
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

            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field
                label="Base URL"
                htmlFor="ai-base-url"
                description="Any Ollama-compatible endpoint (cloud or local)."
                className="sm:col-span-2"
              >
                <Input
                  id="ai-base-url"
                  type="url"
                  placeholder="https://ollama.com"
                  value={ai.baseUrl}
                  onChange={(e) => setAi((a) => ({ ...a, baseUrl: e.target.value }))}
                />
              </Field>
              <Field
                label="Model"
                htmlFor="ai-model"
                description="Model name as listed by the endpoint."
              >
                <Input
                  id="ai-model"
                  placeholder="gemma4:31b"
                  value={ai.model}
                  onChange={(e) => setAi((a) => ({ ...a, model: e.target.value }))}
                />
              </Field>
              <Field
                label="Pass threshold"
                htmlFor="ai-threshold"
                description="Scores at or above this (0–100) count as pass."
              >
                <Input
                  id="ai-threshold"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  step={1}
                  className="tabular-nums"
                  value={ai.passThreshold}
                  onChange={(e) => setAi((a) => ({ ...a, passThreshold: e.target.value }))}
                />
              </Field>
              <Field
                label="API key"
                htmlFor="ai-api-key"
                description="Bearer token. Leave empty for keyless local endpoints."
                className="sm:col-span-2"
              >
                <div className="relative">
                  <Input
                    id="ai-api-key"
                    type={showKey ? "text" : "password"}
                    autoComplete="off"
                    placeholder="Bearer token"
                    value={ai.apiKey}
                    onChange={(e) => setAi((a) => ({ ...a, apiKey: e.target.value }))}
                    className="pr-10 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((s) => !s)}
                    className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    aria-label={showKey ? "Hide API key" : "Show API key"}
                    tabIndex={-1}
                  >
                    {showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                </div>
              </Field>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={testingAi}
                onClick={() => void testAi()}
              >
                <Zap className={cn(testingAi && "animate-pulse")} />
                {testingAi ? "Testing…" : "Test connection"}
              </Button>
              <Button
                type="button"
                disabled={saving || !aiDirty}
                onClick={() => void saveAi()}
              >
                <Save />
                {saving ? "Saving…" : aiDirty ? "Save AI settings" : "Saved"}
              </Button>
              {aiDirty && (
                <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                  Unsaved changes
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
