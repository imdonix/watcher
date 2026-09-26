import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-lg bg-muted/80 dark:bg-muted", className)}
    />
  );
}

/** Placeholder card list shown while listings load. */
export function ListingSkeleton({ count = 6 }: { count?: number }) {
  return (
    <ul className="flex flex-col gap-2.5 sm:gap-3" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <li key={i}>
          <div className="flex overflow-hidden rounded-2xl border border-border/80 bg-card shadow-card">
            <div className="w-[7.25rem] shrink-0 bg-muted sm:w-36" />
            <div className="flex min-w-0 flex-1 flex-col gap-2 p-3 sm:p-3.5">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-3/5" />
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-4 w-24" />
              </div>
              <div className="mt-1 flex justify-end gap-2 border-t border-border/70 pt-2">
                <Skeleton className="h-7 w-20" />
                <Skeleton className="h-7 w-28" />
              </div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Generic skeleton grid for stats/tiles. */
export function TileSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="rounded-2xl border border-border/80 bg-card p-3 shadow-card sm:p-4"
        >
          <Skeleton className="h-3 w-16" />
          <Skeleton className="mt-2.5 h-7 w-12" />
        </div>
      ))}
    </div>
  );
}
