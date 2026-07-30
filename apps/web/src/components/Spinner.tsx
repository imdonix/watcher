import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn(
        "h-7 w-7 animate-spin rounded-full border-2 border-primary/25 border-t-primary",
        className,
      )}
    />
  );
}

export function PageLoader() {
  return (
    <div className="flex justify-center py-20">
      <Spinner />
    </div>
  );
}
