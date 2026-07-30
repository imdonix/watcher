import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  ExternalLink,
  Plus,
  Save,
  Settings2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { EngineMeta, EngineOption } from "@watcher/shared";
import { buildRoutinePreview, formatPrice } from "@watcher/shared";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import { PageLoader } from "@/components/Spinner";
import { cn } from "@/lib/utils";

type Routine = Record<string, unknown> & { engine: number; keywords?: string };

/** Which editor screen is open: list, new, or existing index */
type View = { kind: "list" } | { kind: "new" } | { kind: "edit"; index: number };

const ADVANCED_IDS = new Set([
  "depth",
  "search",
  "listPath",
  "extraFilters",
  "enableCompany",
  "enablePost",
]);

function routineTitle(r: Routine): string {
  const kw = r.keywords != null ? String(r.keywords).trim() : "";
  if (kw) return kw;
  if (r.location) return String(r.location);
  if (r.key) return `Search ${String(r.key).slice(0, 16)}…`;
  if (r.domain) {
    try {
      return new URL(String(r.domain)).pathname.replace(/\/$/, "") || "Routine";
    } catch {
      return "Routine";
    }
  }
  return "Untitled routine";
}

function priceSummary(r: Routine): string | null {
  const min = r.minPrice != null && r.minPrice !== "" ? Number(r.minPrice) : null;
  const max = r.maxPrice != null && r.maxPrice !== "" ? Number(r.maxPrice) : null;
  if (min != null && Number.isFinite(min) && max != null && Number.isFinite(max)) {
    return `${formatPrice(min)} – ${formatPrice(max)}`;
  }
  if (min != null && Number.isFinite(min)) return `from ${formatPrice(min)}`;
  if (max != null && Number.isFinite(max)) return `up to ${formatPrice(max)}`;
  return null;
}

function defaultsFor(engine: EngineMeta | undefined): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  engine?.options.forEach((o) => {
    if (o.default !== undefined) defaults[o.id] = o.default;
  });
  return defaults;
}

function FieldControl({
  opt,
  value,
  onChange,
}: {
  opt: EngineOption;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (opt.type === "checkbox") {
    return (
      <label
        htmlFor={opt.id}
        className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-border/70 bg-card px-3.5 transition-colors hover:bg-muted/40"
      >
        <Checkbox
          id={opt.id}
          checked={Boolean(value)}
          onCheckedChange={(v) => onChange(Boolean(v))}
        />
        <div className="min-w-0 flex-1 py-2.5">
          <span className="text-sm font-medium leading-none">{opt.name}</span>
          {opt.description && (
            <p className="mt-1 text-xs text-muted-foreground">{opt.description}</p>
          )}
        </div>
      </label>
    );
  }

  if (opt.type === "select") {
    const selectValue =
      value != null && String(value) !== ""
        ? String(value)
        : String(opt.default || "__empty");
    return (
      <div className="space-y-1.5">
        <Label htmlFor={opt.id} className="text-xs font-medium text-muted-foreground">
          {opt.name}
        </Label>
        <Select
          value={selectValue}
          onValueChange={(v) => onChange(v === "__empty" ? "" : v)}
        >
          <SelectTrigger id={opt.id} className="h-11 rounded-xl">
            <SelectValue placeholder={opt.placeholder || opt.name} />
          </SelectTrigger>
          <SelectContent>
            {(opt.choices ?? []).map((c) => (
              <SelectItem key={c.value || "__empty"} value={c.value || "__empty"}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {opt.description && (
          <p className="text-[11px] leading-snug text-muted-foreground">{opt.description}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={opt.id} className="text-xs font-medium text-muted-foreground">
        {opt.name}
      </Label>
      <Input
        id={opt.id}
        type={opt.type === "number" ? "number" : opt.type === "url" ? "url" : "text"}
        placeholder={opt.placeholder}
        className="h-11 rounded-xl"
        value={value != null ? String(value) : ""}
        onChange={(e) =>
          onChange(
            opt.type === "number"
              ? e.target.value === ""
                ? ""
                : Number(e.target.value)
              : e.target.value,
          )
        }
      />
      {opt.description && (
        <p className="text-[11px] leading-snug text-muted-foreground">{opt.description}</p>
      )}
    </div>
  );
}

export function RoutinesPage() {
  const [engines, setEngines] = useState<EngineMeta[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [view, setView] = useState<View>({ kind: "list" });
  const [engineId, setEngineId] = useState<number | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [formDirty, setFormDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const currentEngine = useMemo(
    () => engines.find((e) => e.id === (engineId ?? engines[0]?.id)),
    [engines, engineId],
  );

  const load = useCallback(async () => {
    try {
      const [eng, rts] = await Promise.all([api.engines(), api.routines()]);
      setEngines(eng);
      setRoutines(rts as Routine[]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function setField(id: string, value: unknown) {
    setForm((f) => ({ ...f, [id]: value }));
    setFormDirty(true);
  }

  function openNew() {
    const eng = engines[0];
    setEngineId(eng?.id ?? null);
    setForm(defaultsFor(eng));
    setFormDirty(false);
    setView({ kind: "new" });
  }

  function openEdit(index: number) {
    const r = routines[index];
    if (!r) return;
    setEngineId(Number(r.engine));
    const { engine: _e, _id, enabled, ...rest } = r;
    setForm(rest);
    setFormDirty(false);
    setView({ kind: "edit", index });
  }

  function goList() {
    if (formDirty && view.kind !== "list") {
      const ok = window.confirm("Discard unsaved changes?");
      if (!ok) return;
    }
    setFormDirty(false);
    setView({ kind: "list" });
  }

  function onEngineChange(id: string) {
    const num = Number(id);
    setEngineId(num);
    const eng = engines.find((e) => e.id === num);
    setForm((prev) => ({
      ...defaultsFor(eng),
      keywords: prev.keywords,
    }));
    setFormDirty(true);
  }

  async function persist(next: Routine[]) {
    setSaving(true);
    try {
      await api.uploadRoutines(next);
      setRoutines(next);
      setFormDirty(false);
      toast.success("Saved");
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveRoutine() {
    if (!currentEngine) return;
    const routine: Routine = { ...form, engine: currentEngine.id };

    let next: Routine[];
    if (view.kind === "new") {
      next = [...routines, routine];
    } else if (view.kind === "edit") {
      next = routines.map((x, i) => (i === view.index ? routine : x));
    } else {
      return;
    }

    const ok = await persist(next);
    if (ok) {
      if (view.kind === "new") {
        setView({ kind: "edit", index: next.length - 1 });
      }
      // stay in editor after save
    }
  }

  async function deleteRoutine() {
    if (view.kind !== "edit") return;
    if (!window.confirm("Delete this routine?")) return;
    const next = routines.filter((_, i) => i !== view.index);
    const ok = await persist(next);
    if (ok) {
      setView({ kind: "list" });
      setFormDirty(false);
    }
  }

  const preview = useMemo(
    () => buildRoutinePreview(currentEngine?.slug, form),
    [currentEngine?.slug, form],
  );

  const mainOptions = useMemo(
    () => (currentEngine?.options ?? []).filter((o) => !ADVANCED_IDS.has(o.id)),
    [currentEngine],
  );
  const advancedOptions = useMemo(
    () => (currentEngine?.options ?? []).filter((o) => ADVANCED_IDS.has(o.id)),
    [currentEngine],
  );
  const checkboxAdvanced = advancedOptions.filter((o) => o.type === "checkbox");
  const otherAdvanced = advancedOptions.filter((o) => o.type !== "checkbox");

  if (loading) return <PageLoader />;

  /* ───────────── LIST ───────────── */
  if (view.kind === "list") {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {routines.length} search routine{routines.length === 1 ? "" : "s"}
          </p>
          <Button size="sm" className="h-10 rounded-full px-4" onClick={openNew}>
            <Plus className="h-4 w-4" />
            New
          </Button>
        </div>

        {routines.length === 0 ? (
          <EmptyState
            icon={<Settings2 className="h-6 w-6" />}
            title="No routines yet"
            description="Create a search routine to start watching deals on jofogas, ingatlan.com or hasznaltauto."
            action={
              <Button className="rounded-full" onClick={openNew}>
                <Plus className="h-4 w-4" />
                Create routine
              </Button>
            }
          />
        ) : (
          <ul className="grid gap-2.5 sm:grid-cols-2">
            {routines.map((r, i) => {
              const eng = engines.find((e) => e.id === Number(r.engine));
              const price = priceSummary(r);
              const prev = buildRoutinePreview(eng?.slug, r);
              return (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => openEdit(i)}
                    className={cn(
                      "group flex w-full items-stretch gap-0 overflow-hidden rounded-2xl border border-border/80 bg-card text-left shadow-sm",
                      "transition-all hover:border-primary/30 hover:shadow-md active:scale-[0.99]",
                      "touch-manipulation",
                    )}
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="truncate text-[15px] font-semibold leading-snug">
                          {routineTitle(r)}
                        </h3>
                        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary" className="font-normal">
                          {eng?.name ?? "engine"}
                        </Badge>
                        {price && (
                          <span className="text-xs font-medium tabular-nums text-muted-foreground">
                            {price}
                          </span>
                        )}
                      </div>
                      {(prev.path || prev.url) && (
                        <p className="line-clamp-1 font-mono text-[10px] text-muted-foreground/90">
                          {prev.path ?? prev.url}
                        </p>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}

            <li>
              <button
                type="button"
                onClick={openNew}
                className={cn(
                  "flex h-full min-h-[6.5rem] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-muted/20",
                  "text-sm font-medium text-muted-foreground transition-colors",
                  "hover:border-primary/40 hover:bg-muted/40 hover:text-foreground",
                  "touch-manipulation",
                )}
              >
                <Plus className="h-5 w-5" />
                Add routine
              </button>
            </li>
          </ul>
        )}
      </div>
    );
  }

  /* ───────────── EDITOR ───────────── */
  const editingTitle = view.kind === "new" ? "New routine" : "Edit routine";

  return (
    <div className="space-y-4 pb-24 sm:pb-8">
      {/* Top bar */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 h-10 rounded-full px-2.5"
          onClick={goList}
        >
          <ArrowLeft className="h-4 w-4" />
          Routines
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">{editingTitle}</h2>
          {formDirty && (
            <p className="text-xs text-amber-700 dark:text-amber-500">Unsaved changes</p>
          )}
        </div>
        {view.kind === "edit" && (
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 shrink-0 rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => void deleteRoutine()}
            disabled={saving}
            aria-label="Delete routine"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Live preview */}
      <Card className="overflow-hidden border-border/80 shadow-sm">
        <CardContent className="space-y-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Preview
            </span>
            {preview.url && (
              <a
                href={preview.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                Open in browser
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          {preview.path || preview.url ? (
            <>
              <code className="block break-all font-mono text-[12px] leading-relaxed text-foreground">
                {preview.path ?? preview.url}
              </code>
              {preview.url && preview.path && preview.url !== preview.path && (
                <p className="break-all font-mono text-[10px] text-muted-foreground">
                  {preview.url}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {preview.hint ?? "Fill in the fields to build a search URL"}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Engine */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Engine
        </h3>
        <div className="grid gap-2 sm:grid-cols-3">
          {engines.map((e) => {
            const active = currentEngine?.id === e.id;
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => onEngineChange(String(e.id))}
                className={cn(
                  "rounded-xl border px-3 py-3 text-left text-sm font-medium transition-all touch-manipulation",
                  active
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "border-border/80 bg-card hover:border-primary/30 hover:bg-muted/40",
                )}
              >
                {e.name}
              </button>
            );
          })}
        </div>
      </section>

      {/* Main filters */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Search
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {mainOptions.map((opt) => (
            <div
              key={opt.id}
              className={cn(
                opt.type === "checkbox" && "sm:col-span-2",
                (opt.id === "keywords" ||
                  opt.id === "domain" ||
                  opt.id === "location" ||
                  opt.id === "key" ||
                  opt.id === "search") &&
                  "sm:col-span-2",
              )}
            >
              <FieldControl
                opt={opt}
                value={form[opt.id]}
                onChange={(v) => setField(opt.id, v)}
              />
            </div>
          ))}
        </div>
      </section>

      {/* Advanced */}
      {(otherAdvanced.length > 0 || checkboxAdvanced.length > 0) && (
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Options
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {otherAdvanced.map((opt) => (
              <div
                key={opt.id}
                className={cn(
                  (opt.id === "search" || opt.id === "extraFilters") && "sm:col-span-2",
                )}
              >
                <FieldControl
                  opt={opt}
                  value={form[opt.id]}
                  onChange={(v) => setField(opt.id, v)}
                />
              </div>
            ))}
          </div>
          {checkboxAdvanced.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {checkboxAdvanced.map((opt) => (
                <FieldControl
                  key={opt.id}
                  opt={opt}
                  value={form[opt.id]}
                  onChange={(v) => setField(opt.id, v)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Sticky save bar (mobile) + desktop actions */}
      <div
        className="fixed inset-x-0 z-30 border-t border-border/70 bg-background/95 p-3 backdrop-blur-xl sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none"
        style={{
          bottom: "calc(3.5rem + env(safe-area-inset-bottom))",
        }}
      >
        <div className="mx-auto flex max-w-5xl gap-2 sm:pt-2">
          <Button
            variant="outline"
            className="h-12 flex-1 rounded-xl sm:h-10 sm:flex-none sm:px-5"
            onClick={goList}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            className="h-12 flex-[1.4] rounded-xl sm:h-10 sm:flex-1"
            onClick={() => void saveRoutine()}
            disabled={saving || !formDirty}
          >
            <Save className="h-4 w-4" />
            {saving ? "Saving…" : formDirty ? "Save" : "Saved"}
          </Button>
        </div>
      </div>
    </div>
  );
}
