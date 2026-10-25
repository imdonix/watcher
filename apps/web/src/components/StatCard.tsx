import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const toneClasses = {
  default: "text-foreground",
  muted: "text-muted-foreground",
  primary: "text-primary",
  success: "text-emerald-600 dark:text-emerald-400",
  warning: "text-amber-600 dark:text-amber-400",
  destructive: "text-destructive",
} as const;

export function StatCard({
  label,
  value,
  icon,
  hint,
  tone = "default",
  className,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  hint?: ReactNode;
  tone?: keyof typeof toneClasses;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border bg-card p-3.5 shadow-xs sm:p-4", className)}>
      <div className="flex items-center gap-2">
        {icon && (
          <span className={cn("[&_svg]:size-4", toneClasses[tone])} aria-hidden>
            {icon}
          </span>
        )}
        <span className="truncate text-xs font-medium text-muted-foreground">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight sm:text-[1.75rem]">
        {value}
      </p>
      {hint && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
