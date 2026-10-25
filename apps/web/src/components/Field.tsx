import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function Field({
  label,
  htmlFor,
  description,
  hint,
  children,
  className,
  labelClassName,
}: {
  label: ReactNode;
  htmlFor?: string;
  description?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
  labelClassName?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor} className={labelClassName}>
        {label}
      </Label>
      {children}
      {description && (
        <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
      )}
      {hint && <p className="text-[11px] leading-relaxed text-muted-foreground/80">{hint}</p>}
    </div>
  );
}
