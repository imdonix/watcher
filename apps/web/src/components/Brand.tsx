import { Radar } from "lucide-react";
import { cn } from "@/lib/utils";

export function Brand({
  className,
  compact = false,
  tagline = false,
}: {
  className?: string;
  compact?: boolean;
  tagline?: boolean;
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm shadow-primary/25">
        <Radar className="size-5" strokeWidth={2.2} />
      </span>
      {!compact && (
        <span className="flex min-w-0 flex-col leading-none">
          <span className="truncate text-[15px] font-semibold tracking-tight">Watcher</span>
          {tagline && (
            <span className="mt-1 truncate text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Deal watch
            </span>
          )}
        </span>
      )}
    </span>
  );
}
