import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-foreground",
        success:
          "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300",
        warning:
          "border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-300",
        info: "border-transparent bg-sky-100 text-sky-900 dark:bg-sky-950/70 dark:text-sky-300",
        destructive:
          "border-transparent bg-red-100 text-red-800 dark:bg-red-950/70 dark:text-red-300",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
