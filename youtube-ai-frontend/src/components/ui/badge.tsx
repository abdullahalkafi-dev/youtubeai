import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap transition-all",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        destructive: "bg-destructive/10 text-destructive dark:bg-destructive/20",
        outline: "border-border text-foreground",
        ghost: "hover:bg-muted hover:text-muted-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        green: "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
        yellow: "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400",
        red: "bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400",
        blue: "bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-400",
        purple: "bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-400",
        gray: "bg-gray-100 dark:bg-gray-500/15 text-gray-600 dark:text-gray-400",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
