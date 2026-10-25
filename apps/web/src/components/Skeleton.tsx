import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export { Skeleton };

/** Placeholder rows shown while the listings load. */
export function ListingSkeleton({ count = 6 }: { count?: number }) {
  return (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="flex gap-3 p-3 sm:gap-4 sm:p-4">
          <Skeleton className="size-20 shrink-0 rounded-lg sm:size-24" />
          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-4 w-2/5" />
              </div>
              <Skeleton className="h-5 w-20" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-12" />
            </div>
            <Skeleton className="h-3 w-32" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Generic skeleton grid for stat tiles. */
export function TileSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-xl border bg-card p-3.5 shadow-xs sm:p-4">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="mt-3 h-7 w-12" />
        </div>
      ))}
    </div>
  );
}
