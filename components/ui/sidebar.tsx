"use client"

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { PanelLeftIcon } from "lucide-react"

import { useIsMobile } from "@/hooks/use-mobile"
import { DUR, EASE_EMPHASIZED_CSS } from "@/lib/motion"
import { isMotionReduced } from "@/lib/motion-preference"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const SIDEBAR_COOKIE_NAME = "sidebar_state"
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7
// 264px. Wider than shadcn's 16rem default because the pill nav spends 32px on
// horizontal inset that a square row does not, and "Cellular Information" must
// not truncate at the longest locale.
const SIDEBAR_WIDTH = "16.5rem"
const SIDEBAR_WIDTH_MOBILE = "18rem"
const SIDEBAR_KEYBOARD_SHORTCUT = "b"

// The icon rail width is set in the wrapper className, not here: the row is 40px
// on a mouse and 44px on a coarse pointer, and the rail is the row plus 8px each side.
const SIDEBAR_ICON_TOKENS =
  "[--sidebar-icon-row:2.5rem] [--sidebar-width-icon:3.5rem] pointer-coarse:[--sidebar-icon-row:2.75rem] pointer-coarse:[--sidebar-width-icon:3.75rem]"

// Horizontal inset that centres one icon row in the collapsed rail. The +2px is
// the inset variant's own allowance in the container width below.
const ICON_RAIL_PX =
  "group-data-[collapsible=icon]:px-[calc((var(--sidebar-width-icon)+2px-var(--sidebar-icon-row))/2)]"

// Collapsed state is read from the provider cookie through an external store; the
// server snapshot is the expanded default and hydration swaps in the cookie value.
const sidebarStateListeners = new Set<() => void>()

function subscribeSidebarState(listener: () => void) {
  sidebarStateListeners.add(listener)
  return () => {
    sidebarStateListeners.delete(listener)
  }
}

function readSidebarCookie(): boolean | null {
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${SIDEBAR_COOKIE_NAME}=(true|false)`)
  )
  return match ? match[1] === "true" : null
}

type SidebarContextProps = {
  state: "expanded" | "collapsed"
  open: boolean
  setOpen: (open: boolean) => void
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
  isMobile: boolean
  toggleSidebar: () => void
}

const SidebarContext = React.createContext<SidebarContextProps | null>(null)

function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.")
  }

  return context
}

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const isMobile = useIsMobile()
  const [openMobile, setOpenMobile] = React.useState(false)

  // Uncontrolled state lives in the cookie itself; openProp and setOpenProp
  // still take over for control from outside the component.
  const storedOpen = React.useSyncExternalStore(
    subscribeSidebarState,
    () => readSidebarCookie() ?? defaultOpen,
    () => defaultOpen
  )
  const open = openProp ?? storedOpen
  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === "function" ? value(open) : value
      document.cookie = `${SIDEBAR_COOKIE_NAME}=${openState}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`
      if (setOpenProp) {
        setOpenProp(openState)
      } else {
        sidebarStateListeners.forEach((listener) => listener())
      }
    },
    [setOpenProp, open]
  )

  // Arm the width transition two frames after the restored state paints, so a reload
  // into the collapsed rail does not animate; in a background tab it just snaps.
  const [ready, setReady] = React.useState(false)
  React.useEffect(() => {
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setReady(true))
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [])

  // Helper to toggle the sidebar.
  const toggleSidebar = React.useCallback(() => {
    return isMobile ? setOpenMobile((open) => !open) : setOpen((open) => !open)
  }, [isMobile, setOpen, setOpenMobile])

  // Adds a keyboard shortcut to toggle the sidebar.
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault()
        toggleSidebar()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [toggleSidebar])

  // We add a state so that we can do data-state="expanded" or "collapsed".
  // This makes it easier to style the sidebar with Tailwind classes.
  const state = open ? "expanded" : "collapsed"

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({
      state,
      open,
      setOpen,
      isMobile,
      openMobile,
      setOpenMobile,
      toggleSidebar,
    }),
    [state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar]
  )

  return (
    <SidebarContext.Provider value={contextValue}>
      <TooltipProvider delayDuration={0}>
        <div
          data-slot="sidebar-wrapper"
          data-ready={ready}
          style={
            {
              "--sidebar-width": SIDEBAR_WIDTH,
              ...style,
            } as React.CSSProperties
          }
          className={cn(
            // overflow-x-clip: mid-collapse the content is already full width
            // but still slid right, and must not open a horizontal scroll.
            "group/sidebar-wrapper has-data-[variant=inset]:bg-sidebar flex min-h-svh w-full overflow-x-clip",
            SIDEBAR_ICON_TOKENS,
            className
          )}
          {...props}
        >
          {children}
        </div>
      </TooltipProvider>
    </SidebarContext.Provider>
  )
}

function Sidebar({
  side = "left",
  variant = "sidebar",
  collapsible = "offcanvas",
  mobileTitle = "Sidebar",
  mobileDescription = "Displays the mobile sidebar.",
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  side?: "left" | "right"
  variant?: "sidebar" | "floating" | "inset"
  collapsible?: "offcanvas" | "icon" | "none"
  /** Translated sr-only title/description of the mobile sheet. */
  mobileTitle?: string
  mobileDescription?: string
}) {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar()

  if (collapsible === "none") {
    return (
      <div
        data-slot="sidebar"
        className={cn(
          "bg-sidebar text-sidebar-foreground flex h-full w-(--sidebar-width) flex-col",
          className
        )}
        {...props}
      >
        {children}
      </div>
    )
  }

  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile} {...props}>
        <SheetContent
          data-sidebar="sidebar"
          data-slot="sidebar"
          data-mobile="true"
          className="bg-sidebar text-sidebar-foreground w-(--sidebar-width) p-0 [&>button]:hidden"
          style={
            {
              "--sidebar-width": SIDEBAR_WIDTH_MOBILE,
            } as React.CSSProperties
          }
          side={side}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>{mobileTitle}</SheetTitle>
            <SheetDescription>{mobileDescription}</SheetDescription>
          </SheetHeader>
          <div className="flex h-full w-full flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <div
      className="group peer text-sidebar-foreground hidden desktop:block"
      data-state={state}
      data-collapsible={state === "collapsed" ? collapsible : ""}
      data-variant={variant}
      data-side={side}
      data-slot="sidebar"
    >
      {/* This is what handles the sidebar gap on desktop */}
      <div
        data-slot="sidebar-gap"
        className={cn(
          // No width transition: it would reflow the page every frame.
          // SidebarInset slides the content instead.
          "relative w-(--sidebar-width) bg-transparent",
          "group-data-[collapsible=offcanvas]:w-0",
          "group-data-[side=right]:rotate-180",
          variant === "floating" || variant === "inset"
            ? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4)))]"
            : "group-data-[collapsible=icon]:w-(--sidebar-width-icon)"
        )}
      />
      <div
        data-slot="sidebar-container"
        className={cn(
          "fixed inset-y-0 z-10 hidden h-svh w-(--sidebar-width) in-data-[ready=true]:transition-[left,right,width] duration-[var(--duration-emphasized)] ease-emphasized desktop:flex",
          side === "left"
            ? "left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]"
            : "right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]",
          // Adjust the padding for floating and inset variants.
          variant === "floating" || variant === "inset"
            ? "p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)]"
            : "group-data-[collapsible=icon]:w-(--sidebar-width-icon) group-data-[side=left]:border-r group-data-[side=right]:border-l",
          className
        )}
        {...props}
      >
        <div
          data-sidebar="sidebar"
          data-slot="sidebar-inner"
          className="bg-sidebar group-data-[variant=floating]:border-sidebar-border flex h-full w-full flex-col group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:shadow-sm"
        >
          {children}
        </div>
      </div>
    </div>
  )
}

function SidebarTrigger({
  className,
  onClick,
  label = "Toggle Sidebar",
  ...props
}: React.ComponentProps<typeof Button> & {
  /** Translated accessible name; the primitive cannot reach i18n itself. */
  label?: string
}) {
  const { toggleSidebar } = useSidebar()

  return (
    <Button
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon"
      className={cn("size-7", className)}
      onClick={(event) => {
        onClick?.(event)
        toggleSidebar()
      }}
      {...props}
    >
      <PanelLeftIcon />
      <span className="sr-only">{label}</span>
    </Button>
  )
}

function SidebarRail({
  className,
  label = "Toggle Sidebar",
  ...props
}: React.ComponentProps<"button"> & {
  /** Translated accessible name and hover title. */
  label?: string
}) {
  const { toggleSidebar } = useSidebar()

  return (
    <button
      data-sidebar="rail"
      data-slot="sidebar-rail"
      aria-label={label}
      onClick={toggleSidebar}
      title={label}
      // Pointer affordance only: keyboard users have the header trigger and
      // Ctrl/Cmd+B, so a second tab stop on the same action is noise.
      tabIndex={-1}
      className={cn(
        "hover:after:bg-sidebar-border absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 transition-[translate,background-color] duration-[var(--duration-quick)] ease-out group-data-[side=left]:-right-4 group-data-[side=right]:left-0 after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 sm:flex",
        "in-data-[side=left]:cursor-w-resize in-data-[side=right]:cursor-e-resize",
        "[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize",
        "hover:group-data-[collapsible=offcanvas]:bg-sidebar group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full",
        "[[data-side=left][data-collapsible=offcanvas]_&]:-right-2",
        "[[data-side=right][data-collapsible=offcanvas]_&]:-left-2",
        className
      )}
      {...props}
    />
  )
}

function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
  const ref = React.useRef<HTMLElement>(null)

  // The gap snaps to its final width and the inset slides over by a compositor
  // transform (FLIP); animating the gap width re-laid-out every card on each frame.
  React.useEffect(() => {
    const inset = ref.current
    const gap = inset?.parentElement?.querySelector<HTMLElement>(
      "[data-slot=sidebar-gap]"
    )
    if (!inset || !gap) return

    let left = inset.offsetLeft
    let gapWidth = gap.offsetWidth
    let slide: Animation | null = null

    // Fires after layout and before paint, so the transform lands in the same
    // frame as the jump it hides.
    const observer = new ResizeObserver(() => {
      const nextLeft = inset.offsetLeft
      const nextGapWidth = gap.offsetWidth
      const delta = left - nextLeft
      // A 0 width is the rail leaving or entering the layout at the desktop
      // breakpoint, not a collapse; that resize simply snaps.
      const animate =
        delta !== 0 &&
        gapWidth > 0 &&
        nextGapWidth > 0 &&
        inset.closest("[data-ready=true]") !== null &&
        !isMotionReduced()
      left = nextLeft
      gapWidth = nextGapWidth
      if (!animate) return

      // A toggle mid-slide continues from where the content is on screen.
      const from =
        slide && slide.playState === "running"
          ? new DOMMatrixReadOnly(getComputedStyle(inset).transform).m41 + delta
          : delta
      slide?.cancel()
      slide = inset.animate(
        [{ transform: `translateX(${from}px)` }, { transform: "translateX(0)" }],
        { duration: DUR.emphasized * 1000, easing: EASE_EMPHASIZED_CSS }
      )
    })
    observer.observe(gap)
    return () => {
      observer.disconnect()
      slide?.cancel()
    }
  }, [])

  return (
    <main
      ref={ref}
      data-slot="sidebar-inset"
      className={cn(
        "bg-background relative flex w-full flex-1 flex-col",
        "desktop:peer-data-[variant=inset]:m-2 desktop:peer-data-[variant=inset]:ml-0 desktop:peer-data-[variant=inset]:rounded-xl desktop:peer-data-[variant=inset]:shadow-sm desktop:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2",
        className
      )}
      {...props}
    />
  )
}

function SidebarInput({
  className,
  ...props
}: React.ComponentProps<typeof Input>) {
  return (
    <Input
      data-slot="sidebar-input"
      data-sidebar="input"
      className={cn("bg-background h-8 w-full shadow-none", className)}
      {...props}
    />
  )
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-header"
      data-sidebar="header"
      className={cn("flex flex-col gap-2 px-3 pt-3.5 pb-1", ICON_RAIL_PX, className)}
      {...props}
    />
  )
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-footer"
      data-sidebar="footer"
      // Opaque and above the scroll container: the nav scrolls UNDER the
      // account block rather than colliding with it.
      className={cn(
        "bg-sidebar relative z-10 flex flex-col gap-2 px-3 pt-2 pb-3.5",
        ICON_RAIL_PX,
        className,
      )}
      {...props}
    />
  )
}

function SidebarSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="sidebar-separator"
      data-sidebar="separator"
      className={cn("bg-sidebar-border mx-2 w-auto", className)}
      {...props}
    />
  )
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      data-sidebar="content"
      className={cn(
        // 18px between sections against 2px between rows: tight groups, generous
        // separation. That ratio is what lets six groups read as six, without a
        // single divider line.
        // 19 nav rows at the pill's 42px do not fit a laptop viewport, so this
        // scrolls by design. pb-2 keeps the last row from being sliced through
        // its middle at rest, which reads as a rendering bug rather than as
        // "there is more below".
        // Scrollbar hidden (a 15px Windows gutter truncates labels); the icon rail
        // scrolls too, clipping only x. Top padding absorbs the -mt-8 group label overshoot.
        "flex min-h-0 flex-1 flex-col gap-[1.125rem] overflow-x-hidden overflow-y-auto py-1.5 pb-2 group-data-[collapsible=icon]:pt-4 [scrollbar-width:none]",
        className
      )}
      {...props}
    />
  )
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group"
      data-sidebar="group"
      className={cn("relative flex w-full min-w-0 flex-col px-3", ICON_RAIL_PX, className)}
      {...props}
    />
  )
}

function SidebarGroupLabel({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "div"

  return (
    <Comp
      data-slot="sidebar-group-label"
      data-sidebar="group-label"
      className={cn(
        // Section eyebrow. Tracked caps at 11px is the deck's spec and is load-
        // bearing here rather than decorative: it is the only thing separating
        // six pill groups now that the hairline dividers are gone.
        "text-sidebar-foreground/70 ring-sidebar-ring flex h-auto shrink-0 items-center rounded-pill px-4 pb-1.5 text-[0.6875rem] font-semibold tracking-[0.09em] uppercase outline-hidden transition-[margin,opacity] duration-[var(--duration-emphasized)] ease-emphasized focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
        "group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0",
        className
      )}
      {...props}
    />
  )
}

function SidebarGroupAction({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="sidebar-group-action"
      data-sidebar="group-action"
      className={cn(
        "text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground absolute top-3.5 right-3 flex aspect-square w-5 items-center justify-center rounded-md p-0 outline-hidden transition-transform duration-[var(--duration-quick)] ease-out focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
        // Increases the hit area of the button on mobile.
        "after:absolute after:-inset-2 md:after:hidden",
        "group-data-[collapsible=icon]:hidden",
        className
      )}
      {...props}
    />
  )
}

function SidebarGroupContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group-content"
      data-sidebar="group-content"
      className={cn("w-full text-sm", className)}
      {...props}
    />
  )
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu"
      data-sidebar="menu"
      className={cn("flex w-full min-w-0 flex-col gap-1", className)}
      {...props}
    />
  )
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className={cn("group/menu-item relative", className)}
      {...props}
    />
  )
}

// Pill nav (DESIGN.md > Shapes: nav items take the pill radius).
//
// The active row deliberately declares NO background here. Its fill is painted
// by <SidebarNavIndicator>, a single element per group that translates between
// rows so the state slides rather than appears (Motion Study spec 3). The button
// keeps only the ink and weight change, which is also the grayscale-safe half of
// the active state — so if the indicator never renders, the active row is still
// unambiguous. Nothing here is load-bearing on the animation.
const sidebarMenuButtonVariants = cva(
  "peer/menu-button relative flex w-full items-center gap-3 overflow-hidden rounded-pill px-4 text-left text-sm outline-hidden ring-sidebar-ring transition-[color,background-color,font-weight] duration-(--duration-quick) ease-quick hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 group-has-data-[sidebar=menu-action]/menu-item:pr-11 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-transparent data-[active=true]:font-semibold data-[active=true]:text-on-primary-container data-[active=true]:hover:bg-transparent data-[state=open]:hover:bg-sidebar-accent data-[state=open]:hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:size-(--sidebar-icon-row)! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0! group-data-[collapsible=icon]:[&>:not(:first-child)]:sr-only! [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        outline:
          "bg-background shadow-[0_0_0_1px_hsl(var(--sidebar-border))] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_hsl(var(--sidebar-accent))]",
      },
      size: {
        // 42px: the deck's 11px vertical inset around a 20px glyph. Comfortably
        // past the 40px touch floor for roadside tablet use.
        default: "h-[2.625rem] text-sm",
        sm: "h-9 text-xs",
        lg: "h-14 text-sm group-data-[collapsible=icon]:p-0!",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function SidebarMenuButton({
  asChild = false,
  isActive = false,
  variant = "default",
  size = "default",
  tooltip,
  className,
  ...props
}: React.ComponentProps<"button"> & {
  asChild?: boolean
  isActive?: boolean
  tooltip?: string | React.ComponentProps<typeof TooltipContent>
} & VariantProps<typeof sidebarMenuButtonVariants>) {
  const Comp = asChild ? Slot : "button"
  const { isMobile, state } = useSidebar()

  const button = (
    <Comp
      data-slot="sidebar-menu-button"
      data-sidebar="menu-button"
      data-size={size}
      data-active={isActive}
      className={cn(sidebarMenuButtonVariants({ variant, size }), className)}
      {...props}
    />
  )

  if (!tooltip) {
    return button
  }

  if (typeof tooltip === "string") {
    tooltip = {
      children: tooltip,
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent
        side="right"
        align="center"
        hidden={state !== "collapsed" || isMobile}
        {...tooltip}
      />
    </Tooltip>
  )
}

function SidebarMenuAction({
  className,
  asChild = false,
  showOnHover = false,
  ...props
}: React.ComponentProps<"button"> & {
  asChild?: boolean
  showOnHover?: boolean
}) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="sidebar-menu-action"
      data-sidebar="menu-action"
      className={cn(
        // Rides inside the pill at its right inset (the deck puts the chevron on
        // the row, not beside it), vertically centred so it stays put whatever
        // the row height is. Round, because a square affordance inside a pill
        // reads as a mis-set icon.
        "text-sidebar-foreground/60 ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[active=true]/menu-button:text-on-primary-container/70 absolute right-2 flex aspect-square w-6 items-center justify-center rounded-pill p-0 outline-hidden transition-transform duration-(--duration-standard) ease-standard focus-visible:ring-2 [&>svg]:size-[1.125rem] [&>svg]:shrink-0",
        // Increases the hit area of the button on mobile.
        "after:absolute after:-inset-2 md:after:hidden",
        // Offset from the TOP of the menu item, keyed to the row height, never
        // top-1/2: the item grows to contain the expanded sub-list, so centring
        // against it drops the chevron onto the first sub-row when open.
        // (42-24)/2 = 9px for default, (36-24)/2 = 6px for sm, (56-24)/2 = 16px.
        "peer-data-[size=default]/menu-button:top-[0.5625rem]",
        "peer-data-[size=sm]/menu-button:top-1.5",
        "peer-data-[size=lg]/menu-button:top-4",
        "group-data-[collapsible=icon]:hidden",
        showOnHover &&
          "peer-data-[active=true]/menu-button:text-sidebar-accent-foreground group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 data-[state=open]:opacity-100 md:opacity-0",
        className
      )}
      {...props}
    />
  )
}

function SidebarMenuBadge({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-menu-badge"
      data-sidebar="menu-badge"
      className={cn(
        "text-sidebar-foreground pointer-events-none absolute right-1 flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-medium tabular-nums select-none",
        "peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[active=true]/menu-button:text-sidebar-accent-foreground",
        "peer-data-[size=sm]/menu-button:top-1",
        "peer-data-[size=default]/menu-button:top-1.5",
        "peer-data-[size=lg]/menu-button:top-2.5",
        "group-data-[collapsible=icon]:hidden",
        className
      )}
      {...props}
    />
  )
}

function SidebarMenuSkeleton({
  className,
  showIcon = false,
  ...props
}: React.ComponentProps<"div"> & {
  showIcon?: boolean
}) {
  // Random width between 50 to 90%.
  const width = React.useMemo(() => {
    // eslint-disable-next-line react-hooks/purity
    return `${Math.floor(Math.random() * 40) + 50}%`
  }, [])

  return (
    <div
      data-slot="sidebar-menu-skeleton"
      data-sidebar="menu-skeleton"
      className={cn("flex h-8 items-center gap-2 rounded-md px-2", className)}
      {...props}
    >
      {showIcon && (
        <Skeleton
          className="size-4 rounded-md"
          data-sidebar="menu-skeleton-icon"
        />
      )}
      <Skeleton
        className="h-4 max-w-(--skeleton-width) flex-1"
        data-sidebar="menu-skeleton-text"
        style={
          {
            "--skeleton-width": width,
          } as React.CSSProperties
        }
      />
    </div>
  )
}

function SidebarMenuSub({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu-sub"
      data-sidebar="menu-sub"
      className={cn(
        // sidebar-07 rail: a 1px neutral line from the centre of the parent glyph
        // (16px inset + 10px); the offsets keep sub-labels within 2px of the parent label.
        "border-sidebar-border ml-[1.5625rem] flex min-w-0 flex-col gap-0.5 border-l py-1 pl-1.5",
        "group-data-[collapsible=icon]:hidden",
        className
      )}
      {...props}
    />
  )
}

function SidebarMenuSubItem({
  className,
  ...props
}: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-sub-item"
      data-sidebar="menu-sub-item"
      className={cn("group/menu-sub-item relative", className)}
      {...props}
    />
  )
}

function SidebarMenuSubButton({
  asChild = false,
  size = "md",
  isActive = false,
  className,
  ...props
}: React.ComponentProps<"a"> & {
  asChild?: boolean
  size?: "sm" | "md"
  isActive?: boolean
}) {
  const Comp = asChild ? Slot : "a"

  return (
    <Comp
      data-slot="sidebar-menu-sub-button"
      data-sidebar="menu-sub-button"
      data-size={size}
      data-active={isActive}
      className={cn(
        // Sub-rows are pills too, one step quieter: shorter, lighter ink, and a
        // neutral active fill rather than the brand container. Only one row in
        // the sidebar wears primary-container at a time, and it belongs to the
        // section you are in, not the page within it.
        "text-sidebar-foreground/75 ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-foreground active:bg-sidebar-accent active:text-sidebar-foreground [&>svg]:text-sidebar-accent-foreground flex h-9 pointer-coarse:h-11 min-w-0 items-center gap-2 overflow-hidden rounded-pill px-3.5 outline-hidden transition-[color,background-color] duration-(--duration-quick) ease-quick focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0",
        "data-[active=true]:bg-surface-container-high data-[active=true]:font-medium data-[active=true]:text-sidebar-foreground",
        size === "sm" && "text-xs",
        size === "md" && "text-sm",
        "group-data-[collapsible=icon]:hidden",
        className
      )}
      {...props}
    />
  )
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
}
