// Adapted from ReUI commit 067aa0dc7f8bbfec1cd76fc5ad31f842be5f569a.
// Copyright (c) 2025 Keenthemes Inc, MIT. See third-party/reui/{LICENSE,provenance.json}.
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../ui/utils"

const alertVariants = cva(
  [
    "relative w-full min-w-0 border grid grid-cols-[0_minmax(0,1fr)] gap-y-0.5 items-center has-[>svg]:grid-cols-[1rem_minmax(0,1fr)] [&>svg:not([class*=size-])]:size-4",
    "has-[>[data-slot=alert-title]+[data-slot=alert-description]]:[&_[data-slot=alert-action]]:sm:row-end-3",
    "has-[>[data-slot=alert-title]+[data-slot=alert-description]]:items-start",
    "has-[>[data-slot=alert-title]+[data-slot=alert-description]]:[&_svg]:translate-y-0.5",
    "rounded-(--lo-radius-control)",
    "px-3",
    "py-2.5",
    "has-[>svg]:gap-x-2.5",
  ],
  {
    variants: {
      variant: {
        default: "border-[color:var(--border)] bg-(--card) text-[color:var(--card-foreground)]",
        destructive:
          "border-[color:var(--danger-border)] bg-(--danger-background) text-[color:var(--danger)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  // The caller owns announcements, including when this is a visual callout.
  return (
    <div
      data-slot="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "col-start-2 min-w-0 min-h-4 wrap-anywhere font-medium tracking-tight",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "col-start-2 min-w-0 grid justify-items-start gap-1 wrap-anywhere [&_p]:leading-relaxed",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn(
        "col-start-2 flex min-w-0 flex-wrap gap-1.5 max-sm:mt-2 sm:col-start-3 sm:row-start-1 sm:justify-end sm:self-center",
        className
      )}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
