import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Car,
  ChevronDown,
  ChevronRight,
  Copy,
  Cpu,
  ExternalLink,
  House,
  MoreHorizontal,
  Newspaper,
  Pencil,
  Plus,
  Save,
  Settings2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { EngineMeta, EngineOption } from "@watcher/shared";
import { buildRoutinePreview, formatPrice } from "@watcher/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field } from "@/components/Field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { PageLoader } from "@/components/Spinner";

type Routine = Record<string, unknown> & {
  engine: number;
  keywords?: string;
  enabled?: boolean;
};

/** Which editor screen is open: list, new, or existing index */
type View = { kind: "list" } | { kind: "new" } | { kind: "edit"; index: number };

const ADVANCED_IDS = new Set([
  "depth",
  "search",
  "listPath",
  "extraFilters",
  "enableCompany",
  "enablePost",
  "excludeKeywords",
  "titleOnly",
  "exactMatch",
  "noIced",
  "shippingOnly",
]);

const WIDE_IDS = new Set(["keywords", "domain", "location", "key", "category", "search"]);

function routineTitle(r: Routine): string {
  const kw = r.keywords != null ? String(r.keywords).trim() : "";
  if (kw) return kw;
  if (r.location) return String(r.location);
  if (r.category) {
    const last = String(r.category).split("/").filter(Boolean).pop();
    if (last) return last.replace(/[_-]+/g, " ");
  }
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

function filterCount(r: Routine): number {
  const skip = new Set(["engine", "_id", "enabled", "aiPrompt"]);
  let n = 0;
  for (const [key, value] of Object.entries(r)) {
    if (skip.has(key)) continue;
    if (value === "" || value == null || value === false) continue;
    n++;
  }
  return n;
}

function EngineIcon({ slug, className }: { slug?: string | null; className?: string }) {
  const cls = cn("size-4", className);
  switch (slug) {
    case "ingatlan.com":
      return <House className={cls} />;
    case "hasznaltauto.hu":
      return <Car className={cls} />;
    case "hardverapro.hu":
      return <Cpu className={cls} />;
    default:
      return <Newspaper className={cls} />;
  }
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
        className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border bg-card px-3.5 transition-colors hover:bg-muted/40"
      >
        <Checkbox
          id={opt.id}
          checked={Boolean(value)}
          onCheckedChange={(v) => onChange(Boolean(v))}
        />
        <div className="min-w-0 flex-1 py-2.5">
          <span className="text-sm font-medium leading-none">{opt.name}</span>
          {opt.description && (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{opt.description}</p>
          )}
        </div>
      </label>
    );
  }

  if (opt.type === "select") {
    const selectValue =
      value != null && String(value) !== "" ? String(value) : String(opt.default || "__empty");
    return (
      <Field label={opt.name} htmlFor={opt.id} description={opt.description}>
        <Select
          value={selectValue}
          onValueChange={(v) => onChange(v === "__empty" ? "" : v)}
        >
          <SelectTrigger id={opt.id}>
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
      </Field>
    );
  }

  return (
    <Field label={opt.name} htmlFor={opt.id} description={opt.description}>
      <Input
        id={opt.id}
        type={opt.type === "number" ? "number" : opt.type === "url" ? "url" : "text"}
        placeholder={opt.placeholder}
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
    </Field>
  );
}

function PreviewCard({
  preview,
}: {
  preview: { path?: string | null; url?: string | null; hint?: string | null };
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Live preview</CardTitle>
        <CardDescription>The exact URL this routine will scrape.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {preview.path || preview.url ? (
          <>
            <code className="block break-all rounded-md bg-muted/70 px-2.5 py-2 font-mono text-[11px] leading-relaxed">
              {preview.path ?? preview.url}
            </code>
            {preview.url && preview.path && preview.url !== preview.path && (
              <p className="break-all font-mono text-[10px] leading-relaxed text-muted-foreground">
                {preview.url}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {preview.hint ?? "Fill in the fields to build a search URL."}
          </p>
        )}
        {preview.url && (
          <Button variant="outline" size="sm" className="w-full" asChild>
            <a href={preview.url} target="_blank" rel="noreferrer">
              <ExternalLink />
              Open in browser
            </a>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function RoutinesPage() {
  const [engines, setEngines] = useState<EngineMeta[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [view, setView] = useState<View>({ kind: "list" });
  const [engineId, setEngineId] = useState<number | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [formDirty, setFormDirty] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

  const currentEngine = useMemo(
    () => engines.find((e) => e.id === (engineId ?? engines[0]?.id)),
    [engines, engineId],
  );

  const load = useCallback(async () => {
    try {
      const [eng, rts] = await Promise.all([api.engines(), api.routines()]);
      setEngines(eng);
      setRoutines(
        (rts as Routine[]).map((r) => ({ ...r, enabled: r.enabled !== false })),
      );
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
    setForm({ ...defaultsFor(eng), enabled: true });
    setFormDirty(false);
    setAdvancedOpen(false);
    setView({ kind: "new" });
  }

  function openEdit(index: number) {
    const r = routines[index];
    if (!r) return;
    setEngineId(Number(r.engine));
    const { engine: _e, _id, ...rest } = r;
    setForm({ ...rest, enabled: r.enabled !== false });
    setFormDirty(false);
    setAdvancedOpen(false);
    setView({ kind: "edit", index });
  }

  function leaveEditor() {
    setFormDirty(false);
    setView({ kind: "list" });
  }

  function goList() {
    if (formDirty && view.kind !== "list") {
      setDiscardOpen(true);
      return;
    }
    leaveEditor();
  }

  function onEngineChange(id: string) {
    const num = Number(id);
    setEngineId(num);
    const eng = engines.find((e) => e.id === num);
    setForm((prev) => ({
      ...defaultsFor(eng),
      keywords: prev.keywords,
      enabled: prev.enabled !== false,
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
    const routine: Routine = {
      ...form,
      engine: currentEngine.id,
      enabled: form.enabled !== false,
    };

    let next: Routine[];
    if (view.kind === "new") {
      next = [...routines, routine];
    } else if (view.kind === "edit") {
      next = routines.map((x, i) => (i === view.index ? routine : x));
    } else {
      return;
    }

    const ok = await persist(next);
    if (ok && view.kind === "new") {
      setView({ kind: "edit", index: next.length - 1 });
    }
  }

  async function deleteRoutine() {
    if (view.kind !== "edit") return;
    const next = routines.filter((_, i) => i !== view.index);
    setDeleteOpen(false);
    const ok = await persist(next);
    if (ok) leaveEditor();
  }

  async function deleteFromList(index: number) {
    const next = routines.filter((_, i) => i !== index);
    setPendingDelete(null);
    await persist(next);
  }

  async function duplicateRoutine(index: number) {
    const r = routines[index];
    if (!r) return;
    const next = [...routines];
    next.splice(index + 1, 0, { ...r });
    await persist(next);
  }

  async function toggleEnabled(index: number, enabled: boolean) {
    const next = routines.map((r, i) => (i === index ? { ...r, enabled } : r));
    await persist(next);
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
  const activeAdvanced = advancedOptions.filter((o) => {
    const v = form[o.id];
    return v !== "" && v != null && v !== false && v !== o.default;
  }).length;

  if (loading) return <PageLoader label="Loading routines…" />;

  /* ───────────── LIST ───────────── */
  if (view.kind === "list") {
    const enabledCount = routines.filter((r) => r.enabled !== false).length;

    return (
      <div className="space-y-5">
        <PageHeader
          title="Routines"
          description={
            routines.length > 0
              ? `${routines.length} search routine${routines.length === 1 ? "" : "s"} · ${enabledCount} enabled. Disabled routines are skipped by scheduled scrapes.`
              : "Search rules that tell Watcher what to look for on each site."
          }
          actions={
            <Button size="sm" onClick={openNew}>
              <Plus />
              New routine
            </Button>
          }
        />

        {routines.length === 0 ? (
          <EmptyState
            icon={<Settings2 className="size-5" />}
            title="No routines yet"
            description="Create a search routine to start watching deals on jofogas, ingatlan.com, hasznaltauto or hardverapro."
            action={
              <Button onClick={openNew}>
                <Plus />
                Create routine
              </Button>
            }
          />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {routines.map((r, i) => {
              const eng = engines.find((e) => e.id === Number(r.engine));
              const price = priceSummary(r);
              const prev = buildRoutinePreview(eng?.slug, r);
              const enabled = r.enabled !== false;
              const ai = typeof r.aiPrompt === "string" && r.aiPrompt.trim().length > 0;
              const title = routineTitle(r);

              return (
                <li key={`${r._id ?? "new"}-${i}`} className="min-w-0">
                  <Card
                    className={cn(
                      "group relative w-full min-w-0 gap-0 overflow-hidden py-0 transition-all hover:border-primary/30 hover:shadow-card-hover",
                      !enabled && "opacity-85",
                    )}
                  >
                    <CardHeader className="gap-2 px-4 pb-0 pt-4">
                      <div className="flex items-center gap-2">
                        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                          <EngineIcon slug={eng?.slug} />
                        </span>
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className="max-w-full truncate">
                            {eng?.name ?? "engine"}
                          </Badge>
                          {ai && <Badge variant="info">AI</Badge>}
                          {!enabled && <Badge variant="warning">Paused</Badge>}
                        </div>
                        <div className="relative z-10">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="text-muted-foreground"
                                aria-label={`Actions for ${title}`}
                              >
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              <DropdownMenuItem onSelect={() => openEdit(i)}>
                                <Pencil />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => void duplicateRoutine(i)}>
                                <Copy />
                                Duplicate
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                destructive
                                onSelect={() => setPendingDelete(i)}
                              >
                                <Trash2 />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                      <CardTitle className="line-clamp-2 pt-1 text-[15px] leading-snug">
                        {title}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 px-4 pb-3 pt-2">
                      {price && (
                        <p className="text-xs font-medium tabular-nums text-muted-foreground">
                          {price}
                        </p>
                      )}
                      <p className="truncate font-mono text-[10px] leading-relaxed text-muted-foreground/90">
                        {prev.path ?? prev.url ?? "No search URL yet"}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {filterCount(r)} active filter{filterCount(r) === 1 ? "" : "s"}
                      </p>
                    </CardContent>
                    <CardFooter className="relative z-10 justify-between gap-2 border-t bg-muted/20 px-4 py-2">
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                        {enabled ? "Enabled" : "Paused"}
                        <ChevronRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                      </span>
                      <Switch
                        checked={enabled}
                        disabled={saving}
                        onCheckedChange={(v) => void toggleEnabled(i, v)}
                        aria-label={`${enabled ? "Pause" : "Enable"} ${title}`}
                      />
                    </CardFooter>
                    <button
                      type="button"
                      className="absolute inset-0 z-0 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
                      onClick={() => openEdit(i)}
                      aria-label={`Edit ${title}`}
                    />
                  </Card>
                </li>
              );
            })}

            <li>
              <button
                type="button"
                onClick={openNew}
                className="flex h-full min-h-[12rem] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/40 p-6 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted/40 hover:text-foreground"
              >
                <span className="grid size-9 place-items-center rounded-lg bg-muted">
                  <Plus className="size-4" />
                </span>
                Add routine
              </button>
            </li>
          </ul>
        )}

        <ConfirmDialog
          open={pendingDelete != null}
          onOpenChange={(open) => !open && setPendingDelete(null)}
          title="Delete this routine?"
          description={
            pendingDelete != null
              ? `“${routineTitle(routines[pendingDelete])}” will be removed. Existing listings stay in your history.`
              : undefined
          }
          confirmLabel="Delete"
          destructive
          onConfirm={() => {
            if (pendingDelete != null) void deleteFromList(pendingDelete);
          }}
        />
      </div>
    );
  }

  /* ───────────── EDITOR ───────────── */
  const editing = view.kind === "edit";
  const editingTitle = editing ? "Edit routine" : "New routine";
  const enabled = form.enabled !== false;

  return (
    <div className="space-y-4 pb-24 lg:pb-0">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={goList}>
          <ArrowLeft />
          Routines
        </Button>
        <div className="flex items-center gap-1.5">
          <Badge variant={enabled ? "success" : "secondary"}>
            {enabled ? "Enabled" : "Paused"}
          </Badge>
          {editing && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setDeleteOpen(true)}
              disabled={saving}
              aria-label="Delete routine"
            >
              <Trash2 />
            </Button>
          )}
        </div>
      </div>
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{editingTitle}</h1>
        <p
          className={cn(
            "text-xs",
            formDirty ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
          )}
        >
          {formDirty ? "Unsaved changes" : "All changes saved"}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-5">
        <div className="min-w-0 space-y-4">
          <div className="lg:hidden">
            <PreviewCard preview={preview} />
          </div>

          {/* Engine */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Site</CardTitle>
              <CardDescription>Which marketplace this routine searches.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {engines.map((e) => {
                  const active = currentEngine?.id === e.id;
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => onEngineChange(String(e.id))}
                      className={cn(
                        "flex min-h-[4.5rem] min-w-0 flex-col items-center justify-center gap-1.5 rounded-lg border p-2.5 text-center text-sm transition-all",
                        active
                          ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20"
                          : "bg-card hover:border-primary/30 hover:bg-muted/40",
                      )}
                    >
                      <span
                        className={cn(
                          "grid size-8 shrink-0 place-items-center rounded-md",
                          active
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        <EngineIcon slug={e.slug} />
                      </span>
                      <span className="w-full break-words text-[13px] font-medium leading-tight">
                        {e.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Search filters */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Search</CardTitle>
              <CardDescription>
                Core filters for {currentEngine?.name ?? "this engine"}. Changes preview live.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3.5 sm:grid-cols-2">
                {mainOptions.map((opt) => (
                  <div
                    key={opt.id}
                    className={cn(
                      opt.type === "checkbox" && "sm:col-span-2",
                      WIDE_IDS.has(opt.id) && "sm:col-span-2",
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

              <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2.5">
                <div className="min-w-0">
                  <Label htmlFor="routine-enabled" className="text-sm">
                    Routine enabled
                  </Label>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Paused routines are skipped by scheduled scrapes.
                  </p>
                </div>
                <Switch
                  id="routine-enabled"
                  checked={enabled}
                  onCheckedChange={(v) => setField("enabled", v)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Advanced */}
          {(otherAdvanced.length > 0 || checkboxAdvanced.length > 0) && (
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} asChild>
              <Card className="gap-0 py-0">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 p-4 text-left sm:px-6"
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-base font-semibold tracking-tight">
                        Advanced options
                        {activeAdvanced > 0 && (
                          <Badge variant="secondary" className="tabular-nums">
                            {activeAdvanced}
                          </Badge>
                        )}
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        Pagination, sorting and engine-specific flags.
                      </p>
                    </div>
                    <ChevronDown
                      className={cn(
                        "size-4 shrink-0 text-muted-foreground transition-transform",
                        advancedOpen && "rotate-180",
                      )}
                    />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="space-y-3.5 border-t pt-4">
                    <div className="grid gap-3.5 sm:grid-cols-2">
                      {otherAdvanced.map((opt) => (
                        <div
                          key={opt.id}
                          className={cn(
                            (opt.id === "search" || opt.id === "extraFilters") &&
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
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          )}

          {/* AI */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="grid size-6 place-items-center rounded-md bg-primary/10 text-primary">
                  <Settings2 className="size-3.5" />
                </span>
                AI evaluation
              </CardTitle>
              <CardDescription>
                After each scrape, an AI model checks listings from this routine against the
                prompt below.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Field
                label="Evaluation prompt (optional)"
                htmlFor="aiPrompt"
                description="Write it in the language you want the reasons in. Leave empty to skip AI for this routine. Requires an API key in Settings."
              >
                <Textarea
                  id="aiPrompt"
                  rows={4}
                  value={typeof form.aiPrompt === "string" ? form.aiPrompt : ""}
                  onChange={(e) => setField("aiPrompt", e.target.value)}
                  placeholder="When is a listing a good match? e.g. Magánszemély hirdetése, bútorozott lakás, ár 150 000 Ft alatt…"
                />
              </Field>
            </CardContent>
          </Card>
        </div>

        {/* Desktop rail */}
        <aside className="hidden min-w-0 space-y-4 lg:sticky lg:top-6 lg:block lg:self-start">
          <PreviewCard preview={preview} />
          <Card>
            <CardContent className="space-y-2">
              <Button
                className="w-full"
                onClick={() => void saveRoutine()}
                disabled={saving || !formDirty || !currentEngine}
              >
                <Save />
                {saving ? "Saving…" : formDirty ? "Save changes" : "Saved"}
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={goList}
                disabled={saving}
              >
                Cancel
              </Button>
              <p className="pt-1 text-center text-[11px] text-muted-foreground">
                {formDirty
                  ? "You have unsaved changes."
                  : "Routine is up to date."}
              </p>
            </CardContent>
          </Card>
        </aside>
      </div>

      {/* Mobile save bar */}
      <div
        className="fixed inset-x-0 z-30 border-t bg-background/95 p-2.5 backdrop-blur-xl lg:hidden"
        style={{ bottom: "calc(3.5rem + env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto flex max-w-lg gap-2">
          <Button
            variant="outline"
            className="h-11 flex-1"
            onClick={goList}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            className="h-11 flex-[1.5]"
            onClick={() => void saveRoutine()}
            disabled={saving || !formDirty || !currentEngine}
          >
            <Save />
            {saving ? "Saving…" : formDirty ? "Save" : "Saved"}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Discard unsaved changes?"
        description="Your edits to this routine will be lost."
        confirmLabel="Discard"
        destructive
        onConfirm={leaveEditor}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this routine?"
        description={
          editing && view.kind === "edit"
            ? `“${routineTitle(routines[view.index])}” will be removed. Existing listings stay in your history.`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => void deleteRoutine()}
      />
    </div>
  );
}
