import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

/**
 * App-wide toast host — the single notification surface for all Velnox apps.
 *
 * Position: TOP-LEFT (per product spec) instead of sonner's bottom-right
 * default, so notifications never cover mobile bottom sheets / tab bars.
 * Offsets keep sonner's defaults (24px desktop, 16px mobile) and support
 * device safe areas via env().
 *
 * Accessibility: sonner renders the container with aria-live="polite"
 * (status semantics) — error toasts additionally announce via the same
 * live region; individual toasts are focusable and dismissible.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="top-left"
      offset={{
        top: "calc(16px + env(safe-area-inset-top))",
        left: "calc(16px + env(safe-area-inset-left))",
      }}
      mobileOffset={{
        top: "calc(12px + env(safe-area-inset-top))",
        left: "calc(12px + env(safe-area-inset-left))",
      }}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
