import { cn } from "@workspace/ui/lib/utils"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import type { ReactNode } from "react"

export interface InfoOverlayProps {
  open: boolean
  children: ReactNode
  /** Top corner to pin to within the nearest positioned ancestor. Default 'right'. */
  side?: "left" | "right"
  /** Override the `prefers-reduced-motion` default. */
  reduceMotion?: boolean
  /** Entrance/exit spring duration in ms. Default 300. */
  durationMs?: number
  /** Extra classes merged onto the floating card. */
  className?: string
  "aria-label"?: string
}

/**
 * A floating, non-resizable overlay card pinned to a top corner of its nearest
 * positioned ancestor. Fades + slides up on enter (compositor-only `opacity` +
 * `transform`), so it never shifts layout. Because it is absolutely positioned,
 * it tracks the ancestor's edge — drop it inside a chat panel and it follows the
 * chat as a side panel opens, staying within the chat rather than over the panel.
 *
 * Content is composed entirely through `children`; this primitive owns only the
 * frame, positioning, and motion. Respects `prefers-reduced-motion`.
 */
export function InfoOverlay({
  open,
  children,
  side = "right",
  reduceMotion,
  durationMs = 300,
  className,
  "aria-label": ariaLabel,
}: InfoOverlayProps) {
  const prefersReduced = useReducedMotion()
  const reduce = reduceMotion ?? !!prefersReduced

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          aria-label={ariaLabel}
          className={cn(
            "absolute top-3 z-20 flex max-h-[calc(100%-1.5rem)] w-80 max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-xl border border-border bg-card/95 shadow-lg backdrop-blur-md",
            side === "left" ? "left-3" : "right-3",
            className
          )}
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
          transition={
            reduce
              ? { duration: 0 }
              : { type: "spring", duration: durationMs / 1000, bounce: 0 }
          }
        >
          {children}
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
