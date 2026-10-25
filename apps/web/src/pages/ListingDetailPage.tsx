import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  BellRing,
  CalendarClock,
  ExternalLink,
  Heart,
  Image as ImageIcon,
  Info,
  PackageSearch,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import type { ListingDetailResponse, ListingItemDetails } from "@watcher/shared";
import { formatPrice } from "@watcher/shared";
import { api } from "@/lib/api";
import { aiScoreVariant } from "@/lib/ai";
import { formatDateTime, formatEngine, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageLoader } from "@/components/Spinner";

function MiniPriceChart({
  points,
}: {
  points: Array<{ at: string; price: number | null }>;
}) {
  const data = points.filter((p) => p.price != null) as Array<{ at: string; price: number }>;
  if (data.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-10 text-center">
        <TrendingUp className="size-5 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">
          Need at least two priced scrapes to chart history.
        </p>
      </div>
    );
  }

  const prices = data.map((d) => d.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = Math.max(max - min, 1);
  const w = 560;
  const h = 170;
  const padX = 10;
  const padY = 18;

  const coords = data.map((d, i) => {
    const x = padX + (i / (data.length - 1)) * (w - padX * 2);
    const y = padY + (1 - (d.price - min) / range) * (h - padY * 2);
    return { x, y, ...d };
  });

  const line = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`).join(" ");
  const area = `${line} L ${coords[coords.length - 1].x} ${h - padY} L ${coords[0].x} ${h - padY} Z`;

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-auto w-full overflow-visible"
        role="img"
        aria-label={`Price history from ${formatPrice(min)} to ${formatPrice(max)}`}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={padX}
            x2={w - padX}
            y1={padY + f * (h - padY * 2)}
            y2={padY + f * (h - padY * 2)}
            className="stroke-border"
            strokeDasharray="3 5"
            strokeWidth="1"
          />
        ))}
        <path d={area} className="fill-primary/10" />
        <path
          d={line}
          fill="none"
          stroke="currentColor"
          className="text-primary"
          strokeWidth="2.25"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {coords.map((c, i) => (
          <circle
            key={i}
            cx={c.x}
            cy={c.y}
            r={i === coords.length - 1 ? 4 : 2.5}
            className={cn(
              i === coords.length - 1 ? "fill-primary" : "fill-card stroke-primary",
            )}
            strokeWidth="2"
          />
        ))}
      </svg>
      <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{formatRelative(data[0].at)}</span>
        <span className="tabular-nums">
          {formatPrice(min)} – {formatPrice(max)}
        </span>
        <span>{formatRelative(data[data.length - 1].at)}</span>
      </div>
    </div>
  );
}

function GlanceRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium leading-snug">{value}</dd>
    </div>
  );
}

export function ListingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [data, setData] = useState<ListingDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [passThreshold, setPassThreshold] = useState(65);
  const [targetInput, setTargetInput] = useState("");
  const [targetBusy, setTargetBusy] = useState(false);
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());
  const [heroIndex, setHeroIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [showStickyBar, setShowStickyBar] = useState(false);
  const summaryActionsRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setData(await api.listing(id));
      void api
        .settings()
        .then((s) => setPassThreshold(Number(s.aiPassThreshold) || 65))
        .catch(() => {});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load listing");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const listing = data?.listing;

  useEffect(() => {
    setTargetInput(listing?.targetPrice != null ? String(listing.targetPrice) : "");
  }, [listing?.id, listing?.targetPrice]);

  useEffect(() => {
    setHeroIndex(0);
    setBrokenImages(new Set());
  }, [listing?.id]);

  // Only show the mobile action bar once the inline actions scroll away.
  useEffect(() => {
    setShowStickyBar(false);
    const el = summaryActionsRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      setShowStickyBar(!entry.isIntersecting);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [listing?.id]);

  const priceDelta = useMemo(() => {
    const hist = data?.priceHistory?.filter((p) => p.price != null) ?? [];
    if (hist.length < 2) return null;
    const first = hist[0].price!;
    const last = hist[hist.length - 1].price!;
    return last - first;
  }, [data]);

  async function toggleInterest() {
    if (!listing) return;
    setBusy(true);
    try {
      const next = !listing.notInterested;
      await api.setNotInterested(listing.id, next);
      setData((prev) =>
        prev
          ? {
              ...prev,
              listing: {
                ...prev.listing,
                notInterested: next,
                notInterestedAt: next ? new Date().toISOString() : null,
              },
            }
          : prev,
      );
      toast.success(next ? "Marked not interested" : "Tracking again");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function reevaluate() {
    if (!listing) return;
    setAiBusy(true);
    try {
      const res = await api.evaluateItem(listing.id);
      setData((prev) =>
        prev
          ? {
              ...prev,
              listing: {
                ...prev.listing,
                aiVerdict: res.listing.aiVerdict ?? null,
                aiScore: res.listing.aiScore ?? null,
                aiReason: res.listing.aiReason ?? null,
                aiModel: res.listing.aiModel ?? null,
                aiEvaluatedAt: res.listing.aiEvaluatedAt ?? null,
              },
            }
          : prev,
      );
      toast.success(`AI score ${res.verdict.score} — ${res.verdict.pass ? "pass" : "fail"}`, {
        description: res.verdict.reason || undefined,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI evaluation failed");
    } finally {
      setAiBusy(false);
    }
  }

  async function saveTarget() {
    if (!listing) return;
    const raw = targetInput.trim();
    let target: number | null = null;
    if (raw) {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > 100_000_000) {
        toast.error("Target price must be a whole number (Ft)");
        return;
      }
      target = n;
    }
    setTargetBusy(true);
    try {
      const updated = await api.setTargetPrice(listing.id, target);
      setData((prev) =>
        prev
          ? { ...prev, listing: { ...prev.listing, targetPrice: updated.targetPrice ?? null } }
          : prev,
      );
      toast.success(
        target != null
          ? `Alert when the price drops to ${formatPrice(target)}`
          : "Target price cleared",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save target price");
    } finally {
      setTargetBusy(false);
    }
  }

  /**
   * Use real history back instead of pushing another /listings entry.
   * Pushing on every visit makes the iOS back gesture walk a long
   * detail → list → detail chain, remounting the list each time.
   */
  function backToListings(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    e.preventDefault();
    if (location.key !== "default") {
      navigate(-1);
    } else {
      navigate("/listings", { replace: true });
    }
  }

  if (loading) return <PageLoader label="Loading listing…" />;

  if (!listing || !data) {
    return (
      <div className="space-y-5">
        <Button variant="ghost" size="sm" className="-ml-2" asChild>
          <Link to="/listings" onClick={backToListings}>
            <ArrowLeft />
            Listings
          </Link>
        </Button>
        <div className="rounded-xl border bg-card p-10 text-center">
          <PackageSearch className="mx-auto size-8 text-muted-foreground/50" />
          <p className="mt-3 font-medium">Listing not found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            It may have been removed, or the link is no longer valid.
          </p>
        </div>
      </div>
    );
  }

  const unavailable = listing.status === "missing" || Boolean(listing.notInterested);
  const prevPrice = typeof listing.prevPrice === "number" ? listing.prevPrice : null;
  const curPrice = typeof listing.price === "number" ? listing.price : null;
  const priceDropped = prevPrice != null && curPrice != null && prevPrice > curPrice;
  const details = (listing.details ?? null) as ListingItemDetails | null;
  const detailError =
    details && typeof (details as { error?: unknown }).error === "string"
      ? String((details as { error: string }).error)
      : null;
  const hasRealDetails =
    Boolean(details) &&
    !detailError &&
    Boolean(
      details?.description ||
        (details?.images && details.images.length > 0) ||
        (details?.attributes && Object.keys(details.attributes).length > 0),
    );

  const gallery = Array.from(
    new Set<string>(
      (details?.images?.length
        ? details.images
        : listing.image
          ? [String(listing.image)]
          : []
      ).map(String),
    ),
  );
  const markImageBroken = (src: string) =>
    setBrokenImages((prev) => new Set(prev).add(src));

  const safeIndex = Math.min(heroIndex, Math.max(gallery.length - 1, 0));
  const heroSrc = gallery[safeIndex] && !brokenImages.has(gallery[safeIndex]) ? gallery[safeIndex] : null;
  const score = typeof listing.aiScore === "number" ? listing.aiScore : null;
  const hasEvaluation = score != null || Boolean(listing.aiVerdict);

  const actions = (
    <>
      <Button className="h-11 flex-1 sm:h-9 sm:flex-none" asChild>
        <a href={listing.url} target="_blank" rel="noreferrer">
          <ExternalLink />
          Open original
        </a>
      </Button>
      <Button
        variant={listing.notInterested ? "secondary" : "outline"}
        className="h-11 flex-1 sm:h-9 sm:flex-none"
        disabled={busy}
        onClick={() => void toggleInterest()}
      >
        {listing.notInterested ? (
          <>
            <Heart />
            Restore
          </>
        ) : (
          <>
            <Ban />
            Not interested
          </>
        )}
      </Button>
    </>
  );

  return (
    <div className="space-y-4 pb-20 lg:pb-0">
      {/* Back row */}
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" className="-ml-2" asChild>
          <Link to="/listings" onClick={backToListings}>
            <ArrowLeft />
            Listings
          </Link>
        </Button>
        <Button variant="ghost" size="sm" className="text-muted-foreground" asChild>
          <a href={listing.url} target="_blank" rel="noreferrer">
            <span className="hidden sm:inline">View on {formatEngine(listing.engineSlug) || "site"}</span>
            <ExternalLink />
          </a>
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-5">
        <div className="min-w-0 space-y-4">
          {/* Gallery */}
          <Card className="gap-0 overflow-hidden py-0">
            <div className="relative bg-muted">
              {gallery.length > 0 ? (
                <button
                  type="button"
                  className="group relative block w-full cursor-zoom-in"
                  onClick={() => heroSrc && setLightboxOpen(true)}
                  aria-label="Open photo"
                >
                  <div className="flex aspect-[16/10] max-h-[26rem] items-center justify-center">
                    {heroSrc ? (
                      <img
                        src={heroSrc}
                        alt=""
                        className="size-full object-cover"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        onError={() => markImageBroken(gallery[safeIndex])}
                      />
                    ) : (
                      <ImageIcon className="size-9 text-muted-foreground/40" />
                    )}
                  </div>
                  <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              ) : (
                <div className="flex aspect-[16/10] max-h-[26rem] flex-col items-center justify-center gap-2 text-muted-foreground/50">
                  <ImageIcon className="size-9" />
                  <p className="text-xs">No photos scraped yet</p>
                </div>
              )}

              <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
                <div className="flex flex-wrap gap-1.5">
                  {listing.notInterested ? (
                    <Badge variant="secondary" className="shadow-sm">
                      Hidden
                    </Badge>
                  ) : listing.status === "missing" ? (
                    <Badge variant="warning" className="shadow-sm">
                      No longer available
                    </Badge>
                  ) : (
                    <Badge variant="success" className="shadow-sm">
                      Available
                    </Badge>
                  )}
                  {hasEvaluation && (
                    <Badge
                      variant={score != null ? aiScoreVariant(score, passThreshold) : listing.aiVerdict === "pass" ? "success" : "destructive"}
                      className="pointer-events-auto shadow-sm"
                      title={listing.aiReason ?? "AI evaluation"}
                    >
                      <Sparkles className="size-3" />
                      {score != null ? `${score}/100` : listing.aiVerdict}
                    </Badge>
                  )}
                </div>
                {gallery.length > 1 && (
                  <Badge variant="outline" className="pointer-events-auto border-white/30 bg-black/35 text-white shadow-sm backdrop-blur-sm">
                    {safeIndex + 1} / {gallery.length}
                  </Badge>
                )}
              </div>

              {gallery.length > 1 && (
                <>
                  <Button
                    variant="secondary"
                    size="icon-sm"
                    className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-background/85 opacity-90 shadow-sm backdrop-blur hover:bg-background"
                    onClick={() => setHeroIndex((safeIndex - 1 + gallery.length) % gallery.length)}
                    aria-label="Previous photo"
                  >
                    <ArrowLeft />
                  </Button>
                  <Button
                    variant="secondary"
                    size="icon-sm"
                    className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-background/85 opacity-90 shadow-sm backdrop-blur hover:bg-background"
                    onClick={() => setHeroIndex((safeIndex + 1) % gallery.length)}
                    aria-label="Next photo"
                  >
                    <ArrowRight />
                  </Button>
                </>
              )}
            </div>

            {gallery.length > 1 && (
              <div className="no-scrollbar flex gap-2 overflow-x-auto border-t bg-card p-2.5">
                {gallery.map((src, i) => (
                  <button
                    key={src}
                    type="button"
                    onClick={() => setHeroIndex(i)}
                    className={cn(
                      "relative size-14 shrink-0 overflow-hidden rounded-md border-2 bg-muted transition-all",
                      i === safeIndex
                        ? "border-primary"
                        : "border-transparent opacity-70 hover:opacity-100",
                    )}
                    aria-label={`Photo ${i + 1}`}
                    aria-current={i === safeIndex}
                  >
                    {brokenImages.has(src) ? (
                      <ImageIcon className="absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 text-muted-foreground/40" />
                    ) : (
                      <img
                        src={src}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        className="size-full object-cover"
                        onError={() => markImageBroken(src)}
                      />
                    )}
                  </button>
                ))}
              </div>
            )}
          </Card>

          {/* Summary */}
          <Card>
            <CardHeader className="gap-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-2">
                  <CardTitle className="text-balance text-xl leading-snug tracking-tight sm:text-2xl">
                    {listing.name}
                  </CardTitle>
                  <div className="flex flex-wrap items-center gap-2">
                    {listing.engineSlug && (
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {formatEngine(listing.engineSlug)}
                      </Badge>
                    )}
                    {!listing.detailsScrapedAt && <Badge variant="secondary">Details pending</Badge>}
                    {listing.notInterested && <Badge variant="secondary">Not interested</Badge>}
                    {listing.status === "missing" && <Badge variant="warning">Gone from search</Badge>}
                  </div>
                </div>
                <div className="shrink-0 sm:text-right">
                  <div className="flex items-baseline gap-2 sm:justify-end">
                    <span className="text-2xl font-semibold tabular-nums tracking-tight text-primary sm:text-3xl">
                      {listing.priceFormatted ?? formatPrice(listing.price)}
                    </span>
                    {priceDropped && (
                      <span className="text-sm text-muted-foreground line-through">
                        {formatPrice(prevPrice)}
                      </span>
                    )}
                  </div>
                  {priceDropped && (
                    <Badge
                      variant="success"
                      className="mt-1.5"
                      title={
                        listing.priceChangedAt
                          ? `Dropped ${formatRelative(listing.priceChangedAt)}`
                          : "Price dropped"
                      }
                    >
                      <TrendingDown className="size-3" />
                      {formatPrice(prevPrice - curPrice)}
                    </Badge>
                  )}
                </div>
              </div>
              <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className="inline-flex items-center gap-1">
                  <CalendarClock className="size-3" />
                  First seen {formatRelative(listing.firstSeenAt)}
                </span>
                <span className="text-border">·</span>
                <span>Last seen {formatRelative(listing.lastSeenAt)}</span>
                <span className="text-border">·</span>
                <span>
                  {data.sightings.length} observation{data.sightings.length === 1 ? "" : "s"}
                </span>
                {listing.detailsScrapedAt && (
                  <>
                    <span className="text-border">·</span>
                    <span>Details {formatRelative(listing.detailsScrapedAt)}</span>
                  </>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {listing.notInterested && (
                <div className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                  Hidden as not interested
                  {listing.notInterestedAt ? ` ${formatRelative(listing.notInterestedAt)}` : ""}.
                  A price change restores it automatically.
                </div>
              )}
              <div ref={summaryActionsRef} className="flex flex-wrap gap-2">{actions}</div>
            </CardContent>
          </Card>

          {/* Tabs */}
          <Tabs defaultValue="details" className="gap-3">
            <TabsList className="grid h-10 w-full grid-cols-4">
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="ai">AI</TabsTrigger>
              <TabsTrigger value="history">
                History
                <span className="hidden tabular-nums text-muted-foreground sm:inline">
                  {data.sightings.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="activity">
                Activity
                <span className="hidden tabular-nums text-muted-foreground sm:inline">
                  {data.events.length}
                </span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="details" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Listing details</CardTitle>
                  <CardDescription>
                    Scraped once from the item page
                    {listing.engineSlug ? ` on ${formatEngine(listing.engineSlug)}` : ""}.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  {detailError && (
                    <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-3.5 py-2.5 text-sm text-destructive">
                      Detail scrape failed: {detailError}
                    </div>
                  )}
                  {!listing.detailsScrapedAt && (
                    <div className="flex items-start gap-2.5 rounded-lg border border-sky-500/20 bg-sky-500/5 px-3.5 py-2.5 text-sm text-sky-900 dark:text-sky-200">
                      <Info className="mt-0.5 size-4 shrink-0" />
                      <p>
                        Detail page not scraped yet — it runs as a special job after list
                        scrapes.
                      </p>
                    </div>
                  )}

                  {hasRealDetails && details?.description && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Description
                      </p>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                        {details.description}
                      </p>
                    </div>
                  )}

                  {hasRealDetails &&
                    details?.attributes &&
                    Object.keys(details.attributes).length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Attributes
                        </p>
                        <dl className="divide-y rounded-lg border">
                          {Object.entries(details.attributes).map(([key, value]) => (
                            <div
                              key={key}
                              className="flex items-start justify-between gap-4 px-3.5 py-2.5 text-sm"
                            >
                              <dt className="shrink-0 text-muted-foreground">{key}</dt>
                              <dd className="text-right font-medium">{String(value ?? "—")}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    )}

                  {gallery.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Photos · {gallery.length}
                      </p>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
                        {gallery.map((src, i) => (
                          <button
                            key={src}
                            type="button"
                            className="group relative aspect-square overflow-hidden rounded-lg border bg-muted"
                            onClick={() => {
                              setHeroIndex(i);
                              setLightboxOpen(true);
                            }}
                            aria-label={`Open photo ${i + 1}`}
                          >
                            {brokenImages.has(src) ? (
                              <ImageIcon className="absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 text-muted-foreground/40" />
                            ) : (
                              <img
                                src={src}
                                alt=""
                                loading="lazy"
                                decoding="async"
                                referrerPolicy="no-referrer"
                                className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                                onError={() => markImageBroken(src)}
                              />
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {listing.detailsScrapedAt && !hasRealDetails && !detailError && (
                    <div className="flex flex-col items-center gap-2 py-6 text-center">
                      <Info className="size-5 text-muted-foreground/50" />
                      <p className="text-sm text-muted-foreground">
                        No description or attributes were found on the listing page.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="ai">
              <Card>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    <Sparkles className="size-4 text-muted-foreground" />
                    AI evaluation
                    {score != null ? (
                      <Badge variant={aiScoreVariant(score, passThreshold)}>{score}/100</Badge>
                    ) : listing.aiVerdict ? (
                      <Badge variant={listing.aiVerdict === "pass" ? "success" : "destructive"}>
                        {listing.aiVerdict}
                      </Badge>
                    ) : null}
                  </CardTitle>
                  <CardDescription>
                    {listing.aiEvaluatedAt
                      ? `${listing.aiModel ? `${listing.aiModel} · ` : ""}evaluated ${formatRelative(listing.aiEvaluatedAt)} · pass at ≥ ${passThreshold}`
                      : "Not evaluated yet — add an evaluation prompt to the routine and an API key in Settings."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {score != null && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Match score</span>
                        <span className="font-medium tabular-nums">{score}/100</span>
                      </div>
                      <Progress value={score} className="h-2" />
                    </div>
                  )}
                  {listing.aiReason ? (
                    <p className="rounded-lg bg-muted/50 px-3.5 py-3 text-sm leading-relaxed text-foreground">
                      {listing.aiReason}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {hasEvaluation
                        ? "No reasoning was stored for this evaluation."
                        : "Run an evaluation to score this listing against the routine prompt."}
                    </p>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full sm:w-auto"
                    disabled={aiBusy}
                    onClick={() => void reevaluate()}
                  >
                    <Sparkles className={cn(aiBusy && "animate-pulse")} />
                    {aiBusy
                      ? "Evaluating…"
                      : hasEvaluation
                        ? "Re-evaluate with AI"
                        : "Evaluate with AI"}
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="history" className="space-y-4">
              <Card>
                <CardHeader className="flex flex-row items-start justify-between space-y-0">
                  <div className="space-y-1">
                    <CardTitle className="text-base">Price history</CardTitle>
                    <CardDescription>
                      {data.priceHistory.filter((p) => p.price != null).length} priced
                      observation
                      {data.priceHistory.filter((p) => p.price != null).length === 1 ? "" : "s"}
                    </CardDescription>
                  </div>
                  {priceDelta != null && priceDelta !== 0 && (
                    <Badge variant={priceDelta < 0 ? "success" : "warning"}>
                      {priceDelta < 0 ? (
                        <TrendingDown className="size-3" />
                      ) : (
                        <TrendingUp className="size-3" />
                      )}
                      {formatPrice(Math.abs(priceDelta))} {priceDelta < 0 ? "down" : "up"}
                    </Badge>
                  )}
                </CardHeader>
                <CardContent>
                  <MiniPriceChart points={data.priceHistory} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Observations</CardTitle>
                  <CardDescription>Every time this listing was found</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  {data.sightings.length === 0 ? (
                    <p className="px-5 pb-6 text-sm text-muted-foreground sm:px-6">
                      No sightings yet
                    </p>
                  ) : (
                    <ul className="divide-y border-t">
                      {data.sightings.map((s) => (
                        <li
                          key={s.id}
                          className="flex items-center justify-between gap-3 px-5 py-3 sm:px-6"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium tabular-nums">
                              {formatPrice(s.price)}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {formatDateTime(s.observedAt)} · run #{s.scrapeRunId}
                            </p>
                          </div>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {formatRelative(s.observedAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="activity">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Events</CardTitle>
                  <CardDescription>
                    Price changes, disappearances and alerts for this listing.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  {data.events.length === 0 ? (
                    <p className="px-5 pb-6 text-sm text-muted-foreground sm:px-6">
                      No events yet
                    </p>
                  ) : (
                    <ul className="divide-y border-t">
                      {data.events.map((e) => (
                        <li key={e.id} className="space-y-1.5 px-5 py-3.5 sm:px-6">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant={
                                e.kind === "missing"
                                  ? "warning"
                                  : e.kind === "price_change"
                                    ? "info"
                                    : e.kind === "first_seen" || e.kind === "target_hit"
                                      ? "success"
                                      : "secondary"
                              }
                              className="capitalize"
                            >
                              {e.kind.replace("_", " ")}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {formatRelative(e.createdAt)}
                            </span>
                          </div>
                          {(e.oldPrice != null || e.newPrice != null) && (
                            <p className="text-sm tabular-nums text-muted-foreground">
                              {e.oldPrice != null ? formatPrice(e.oldPrice) : "—"} →{" "}
                              {e.newPrice != null ? formatPrice(e.newPrice) : "—"}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground">
                            {formatDateTime(e.createdAt)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Side rail */}
        <aside className="min-w-0 space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BellRing className="size-4 text-muted-foreground" />
                Price alert
              </CardTitle>
              <CardDescription>
                Get a push notification when the price drops to or below your target.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5">
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  placeholder="No target"
                  value={targetInput}
                  onChange={(e) => setTargetInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveTarget();
                  }}
                  className="tabular-nums"
                  aria-label="Target price"
                />
                <Button
                  variant="outline"
                  className="shrink-0"
                  disabled={targetBusy || targetInput === String(listing.targetPrice ?? "")}
                  onClick={() => void saveTarget()}
                >
                  {targetBusy ? "…" : "Save"}
                </Button>
              </div>
              {listing.targetPrice != null ? (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <BellRing className="size-3" />
                  Alert active at {formatPrice(listing.targetPrice)}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Leave empty to disable. Prices are in Ft.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">At a glance</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                <GlanceRow
                  label="On site"
                  value={listing.status === "active" ? "Listed" : "Gone from search"}
                />
                <GlanceRow
                  label="Interest"
                  value={listing.notInterested ? "Dismissed" : "Tracking"}
                />
                <GlanceRow label="Site" value={formatEngine(listing.engineSlug) || "—"} />
                <GlanceRow label="First seen" value={formatDateTime(listing.firstSeenAt)} />
                <GlanceRow label="Last seen" value={formatDateTime(listing.lastSeenAt)} />
                <GlanceRow
                  label="Details scraped"
                  value={
                    listing.detailsScrapedAt
                      ? formatDateTime(listing.detailsScrapedAt)
                      : "Pending"
                  }
                />
                <GlanceRow label="Observations" value={data.sightings.length} />
                <GlanceRow label="Events" value={data.events.length} />
              </dl>
              <p className="border-t pt-3 text-[11px] leading-relaxed text-muted-foreground">
                Missing is only set after a complete scrape — partial failures never mark
                items gone.
              </p>
            </CardContent>
          </Card>

          <Button variant="outline" className="w-full" asChild>
            <a href={listing.url} target="_blank" rel="noreferrer">
              <ExternalLink />
              Open on {formatEngine(listing.engineSlug) || "source site"}
            </a>
          </Button>
        </aside>
      </div>

      {/* Mobile action bar — appears once the inline actions scroll away */}
      {showStickyBar && (
        <div
          className="fixed inset-x-0 z-30 animate-sheet-bottom border-t bg-background/95 p-2.5 backdrop-blur-xl lg:hidden"
          style={{ bottom: "calc(3.5rem + env(safe-area-inset-bottom))" }}
        >
          <div className="mx-auto flex max-w-lg gap-2">{actions}</div>
        </div>
      )}

      {/* Lightbox */}
      <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
        <DialogContent
          className="max-w-5xl gap-3 bg-card p-2 sm:p-3"
          onKeyDown={(e) => {
            if (gallery.length < 2) return;
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              setHeroIndex((safeIndex - 1 + gallery.length) % gallery.length);
            } else if (e.key === "ArrowRight") {
              e.preventDefault();
              setHeroIndex((safeIndex + 1) % gallery.length);
            }
          }}
        >
          <DialogTitle className="sr-only">Listing photo</DialogTitle>
          <div className="relative flex items-center justify-center rounded-lg bg-muted">
            {heroSrc ? (
              <img
                src={heroSrc}
                alt=""
                decoding="async"
                referrerPolicy="no-referrer"
                className="max-h-[78vh] w-full rounded-lg object-contain"
              />
            ) : (
              <ImageIcon className="size-10 py-16 text-muted-foreground/40" />
            )}
            {gallery.length > 1 && (
              <>
                <Button
                  variant="secondary"
                  size="icon-sm"
                  className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full shadow"
                  onClick={() =>
                    setHeroIndex((safeIndex - 1 + gallery.length) % gallery.length)
                  }
                  aria-label="Previous photo"
                >
                  <ArrowLeft />
                </Button>
                <Button
                  variant="secondary"
                  size="icon-sm"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full shadow"
                  onClick={() => setHeroIndex((safeIndex + 1) % gallery.length)}
                  aria-label="Next photo"
                >
                  <ArrowRight />
                </Button>
                <Badge variant="secondary" className="absolute bottom-2 left-1/2 -translate-x-1/2 shadow">
                  {safeIndex + 1} / {gallery.length}
                </Badge>
              </>
            )}
          </div>
          <div className="no-scrollbar flex gap-2 overflow-x-auto">
            {gallery.map((src, i) => (
              <button
                key={src}
                type="button"
                onClick={() => setHeroIndex(i)}
                className={cn(
                  "size-12 shrink-0 overflow-hidden rounded-md border-2 bg-muted",
                  i === safeIndex ? "border-primary" : "border-transparent opacity-60 hover:opacity-100",
                )}
                aria-label={`Photo ${i + 1}`}
              >
                {brokenImages.has(src) ? (
                  <ImageIcon className="mx-auto size-4 text-muted-foreground/40" />
                ) : (
                  <img
                    src={src}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    className="size-full object-cover"
                  />
                )}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
