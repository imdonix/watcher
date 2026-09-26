import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Ban,
  ExternalLink,
  Heart,
  Image as ImageIcon,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import type { ListingDetailResponse, ListingItemDetails } from "@watcher/shared";
import { formatPrice } from "@watcher/shared";
import { api } from "@/lib/api";
import { formatDateTime, formatEngine, formatRelative } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageLoader } from "@/components/Spinner";
import { cn } from "@/lib/utils";

function MiniPriceChart({
  points,
}: {
  points: Array<{ at: string; price: number | null }>;
}) {
  const data = points.filter((p) => p.price != null) as Array<{ at: string; price: number }>;
  if (data.length < 2) {
    return (
      <p className="text-sm text-muted-foreground">
        Need at least two priced scrapes to chart history.
      </p>
    );
  }

  const prices = data.map((d) => d.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = Math.max(max - min, 1);
  const w = 560;
  const h = 140;
  const pad = 14;

  const coords = data.map((d, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (d.price - min) / range) * (h - pad * 2);
    return { x, y, ...d };
  });

  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`).join(" ");
  const area = `${path} L ${coords[coords.length - 1].x} ${h - pad} L ${coords[0].x} ${h - pad} Z`;

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-36 w-full" preserveAspectRatio="none">
        <path d={area} className="fill-primary/10" />
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          className="text-primary"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {coords.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r="3.5" className="fill-primary" />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
        <span>{formatPrice(min)}</span>
        <span>{formatPrice(max)}</span>
      </div>
    </div>
  );
}

export function ListingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<ListingDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setData(await api.listing(id));
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

  if (loading) return <PageLoader />;

  if (!listing || !data) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" className="-ml-2 rounded-full" asChild>
          <Link to="/listings">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
        </Button>
        <p className="text-muted-foreground">Listing not found.</p>
      </div>
    );
  }

  const unavailable = listing.status === "missing" || Boolean(listing.notInterested);
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
  const gallery = details?.images?.length
    ? details.images
    : listing.image
      ? [String(listing.image)]
      : [];
  const markImageBroken = (src: string) =>
    setBrokenImages((prev) => new Set(prev).add(src));
  const heroSrc = gallery[0] && !brokenImages.has(gallery[0]) ? gallery[0] : null;

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" className="-ml-2 h-9 rounded-full px-2.5" asChild>
        <Link to="/listings">
          <ArrowLeft className="h-4 w-4" />
          Listings
        </Link>
      </Button>

      {/* Hero card */}
      <Card className={cn("overflow-hidden border-border/80 shadow-sm", unavailable && "opacity-95")}>
        {gallery[0] && (
          <div className="flex aspect-[16/10] max-h-64 items-center justify-center overflow-hidden bg-muted sm:aspect-[2.4/1] sm:max-h-72">
            {heroSrc ? (
              <img
                src={heroSrc}
                alt=""
                className="h-full w-full object-cover"
                onError={() => markImageBroken(heroSrc)}
              />
            ) : (
              <ImageIcon className="h-10 w-10 text-muted-foreground/40" aria-hidden />
            )}
          </div>
        )}
        <CardHeader className="space-y-3 p-4 sm:p-6">
          <div className="space-y-2">
            <CardTitle className="text-xl font-semibold leading-snug tracking-tight sm:text-2xl">
              {listing.name}
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-2xl font-semibold tabular-nums tracking-tight text-primary">
                {listing.priceFormatted ?? formatPrice(listing.price)}
              </span>
              {listing.notInterested ? (
                <Badge variant="secondary">Not interested</Badge>
              ) : listing.status === "missing" ? (
                <Badge variant="warning">No longer available</Badge>
              ) : (
                <Badge variant="success">Available</Badge>
              )}
              {listing.engineSlug && (
                <Badge variant="outline" className="font-mono text-[10px] font-normal">
                  {formatEngine(listing.engineSlug)}
                </Badge>
              )}
              {!listing.detailsScrapedAt && (
                <Badge variant="secondary">Details pending</Badge>
              )}
            </div>
          </div>

          <CardDescription className="text-xs sm:text-sm">
            First seen {formatRelative(listing.firstSeenAt)} · Last seen{" "}
            {formatRelative(listing.lastSeenAt)} · {data.sightings.length} observation
            {data.sightings.length === 1 ? "" : "s"}
            {listing.detailsScrapedAt
              ? ` · details ${formatRelative(listing.detailsScrapedAt)}`
              : ""}
          </CardDescription>

          {listing.notInterested && (
            <p className="rounded-xl bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
              Hidden as not interested
              {listing.notInterestedAt ? ` · ${formatRelative(listing.notInterestedAt)}` : ""}.
              A price change will restore it automatically.
            </p>
          )}

          {/* Desktop actions (mobile uses sticky bar) */}
          <div className="hidden gap-2 pt-1 sm:flex">
            <Button variant="default" className="rounded-full" asChild>
              <a href={listing.url} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                See listing
              </a>
            </Button>
            <Button
              variant={listing.notInterested ? "secondary" : "outline"}
              className="rounded-full"
              disabled={busy}
              onClick={() => void toggleInterest()}
            >
              {listing.notInterested ? (
                <>
                  <Heart className="h-4 w-4" /> Interested again
                </>
              ) : (
                <>
                  <Ban className="h-4 w-4" /> Not interested
                </>
              )}
            </Button>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="space-y-4">
          {(hasRealDetails || detailError || !listing.detailsScrapedAt) && (
            <Card className="border-border/80 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Listing details</CardTitle>
                <CardDescription>
                  Scraped once from the item page
                  {listing.engineSlug ? ` (${formatEngine(listing.engineSlug)})` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!listing.detailsScrapedAt && (
                  <p className="text-sm text-muted-foreground">
                    Detail page not scraped yet — runs as a special job after list scrapes.
                  </p>
                )}
                {detailError && (
                  <p className="text-sm text-destructive">Detail scrape failed: {detailError}</p>
                )}
                {hasRealDetails && details?.description && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Attributes
                      </p>
                      <dl className="divide-y divide-border/60 rounded-xl border border-border/70">
                        {Object.entries(details.attributes).map(([key, value]) => (
                          <div
                            key={key}
                            className="flex items-start justify-between gap-4 px-3 py-2 text-sm"
                          >
                            <dt className="shrink-0 text-muted-foreground">{key}</dt>
                            <dd className="text-right font-medium">{String(value ?? "—")}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  )}
                {gallery.length > 1 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Photos
                    </p>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {gallery.slice(0, 8).map((src) => (
                        <a
                          key={src}
                          href={src}
                          target="_blank"
                          rel="noreferrer"
                          className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-muted"
                        >
                          {brokenImages.has(src) ? (
                            <ImageIcon
                              className="h-5 w-5 text-muted-foreground/40"
                              aria-hidden
                            />
                          ) : (
                            <img
                              src={src}
                              alt=""
                              className="h-full w-full object-cover"
                              loading="lazy"
                              onError={() => markImageBroken(src)}
                            />
                          )}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card className="border-border/80 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                Price history
                {priceDelta != null && priceDelta !== 0 && (
                  <span className="inline-flex items-center gap-1 text-sm font-normal text-muted-foreground">
                    {priceDelta < 0 ? (
                      <TrendingDown className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <TrendingUp className="h-4 w-4 text-amber-600" />
                    )}
                    {formatPrice(Math.abs(priceDelta))} {priceDelta < 0 ? "down" : "up"}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <MiniPriceChart points={data.priceHistory} />
            </CardContent>
          </Card>

          <Card className="border-border/80 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Observations</CardTitle>
              <CardDescription>Every time this listing was found</CardDescription>
            </CardHeader>
            <CardContent className="space-y-0 p-0">
              {data.sightings.length === 0 ? (
                <p className="px-6 pb-6 text-sm text-muted-foreground">No sightings yet</p>
              ) : (
                <ul className="divide-y divide-border/70">
                  {data.sightings.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{formatPrice(s.price)}</p>
                        <p className="text-xs text-muted-foreground">
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
        </div>

        <div className="space-y-4">
          <Card className="border-border/80 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">On site</span>
                <span className="font-medium">
                  {listing.status === "active" ? "Listed" : "Gone from search"}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Interest</span>
                <span className="font-medium">
                  {listing.notInterested ? "Dismissed" : "Tracking"}
                </span>
              </div>
              <p className="border-t border-border/70 pt-3 text-xs leading-relaxed text-muted-foreground">
                Missing is only set after a complete scrape. Partial failures never mark items
                gone.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/80 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Events</CardTitle>
            </CardHeader>
            <CardContent className="space-y-0 p-0">
              {data.events.length === 0 ? (
                <p className="px-6 pb-6 text-sm text-muted-foreground">No events yet</p>
              ) : (
                <ul className="divide-y divide-border/70">
                  {data.events.map((e) => (
                    <li key={e.id} className="space-y-1 px-4 py-3 sm:px-6">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant={
                            e.kind === "missing"
                              ? "warning"
                              : e.kind === "price_change"
                                ? "info"
                                : e.kind === "first_seen"
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
                        <p className="text-xs text-muted-foreground">
                          {e.oldPrice != null ? formatPrice(e.oldPrice) : "—"} →{" "}
                          {e.newPrice != null ? formatPrice(e.newPrice) : "—"}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Mobile sticky action bar */}
      <div
        className="fixed inset-x-0 z-30 border-t border-border/70 bg-background/95 p-3 backdrop-blur-xl sm:hidden"
        style={{
          bottom: "calc(3.5rem + env(safe-area-inset-bottom))",
        }}
      >
        <div className="mx-auto flex max-w-5xl gap-2">
          <Button className="h-12 flex-1 rounded-xl text-base" asChild>
            <a href={listing.url} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
              See listing
            </a>
          </Button>
          <Button
            variant={listing.notInterested ? "secondary" : "outline"}
            className="h-12 flex-1 rounded-xl text-base"
            disabled={busy}
            onClick={() => void toggleInterest()}
          >
            {listing.notInterested ? (
              <>
                <Heart className="h-4 w-4" /> Restore
              </>
            ) : (
              <>
                <Ban className="h-4 w-4" /> Hide
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
