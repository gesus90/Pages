import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight } from "lucide-react";

import { cn } from "@/app/lib/cn";

import { ScrollViewport } from "./scroll-viewport";

import type { ComponentProps } from "react";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

// The shell carries radius, fill and shadow; the scrolling viewport inside it
// carries none of them, so a scrollbar never paints over a rounded corner.
const MENU_SHELL_CLASS = "rounded-xl bg-surface shadow-panel";
const MENU_VIEWPORT_CLASS =
  "z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-44 p-1 outline-none";

interface DropdownMenuContentProps extends ComponentProps<
  typeof DropdownMenuPrimitive.Content
> {
  /** Classes of the shell, such as a ring; the viewport takes `className`. */
  readonly containerClassName?: string;
}

/** Renders a positioned Radix dropdown surface with Pages styling. */
export function DropdownMenuContent({
  className,
  containerClassName,
  sideOffset = 8,
  ...properties
}: DropdownMenuContentProps): React.ReactElement {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        asChild
        sideOffset={sideOffset}
        {...properties}
      >
        <ScrollViewport
          isShell
          containerClassName={cn(MENU_SHELL_CLASS, containerClassName)}
          className={cn(MENU_VIEWPORT_CLASS, className)}
        >
          {properties.children}
        </ScrollViewport>
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  );
}

/** Renders a non-interactive heading inside a Radix dropdown. */
export function DropdownMenuLabel({
  className,
  ...properties
}: ComponentProps<typeof DropdownMenuPrimitive.Label>): React.ReactElement {
  return (
    <DropdownMenuPrimitive.Label
      className={cn("px-3 py-2", className)}
      {...properties}
    />
  );
}

/** Renders a thin divider between groups of Radix dropdown items. */
export function DropdownMenuSeparator({
  className,
  ...properties
}: ComponentProps<typeof DropdownMenuPrimitive.Separator>): React.ReactElement {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn("my-1 h-px bg-border", className)}
      {...properties}
    />
  );
}

/** Renders one actionable Radix dropdown item with Pages styling. */
export function DropdownMenuItem({
  className,
  ...properties
}: ComponentProps<typeof DropdownMenuPrimitive.Item>): React.ReactElement {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        "flex min-h-10 cursor-pointer items-center rounded-md px-3 text-sm text-foreground outline-none data-highlighted:bg-muted data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...properties}
    />
  );
}

/** Renders one Radix dropdown item with a check mark that toggles a setting. */
export function DropdownMenuCheckboxItem({
  className,
  children,
  ...properties
}: ComponentProps<
  typeof DropdownMenuPrimitive.CheckboxItem
>): React.ReactElement {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      className={cn(
        "flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-3 text-xs text-foreground outline-none data-highlighted:bg-muted data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...properties}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className="size-3.5 text-primary" aria-hidden="true" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

/** Renders one Radix dropdown item of a single choice, checked while chosen. */
export function DropdownMenuRadioItem({
  className,
  children,
  ...properties
}: ComponentProps<typeof DropdownMenuPrimitive.RadioItem>): React.ReactElement {
  return (
    <DropdownMenuPrimitive.RadioItem
      className={cn(
        "flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-3 text-xs text-foreground outline-none data-highlighted:bg-muted data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...properties}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className="size-3.5 text-primary" aria-hidden="true" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

/** Renders an item that opens a nested menu, with an arrow on its right. */
export function DropdownMenuSubTrigger({
  className,
  children,
  ...properties
}: ComponentProps<
  typeof DropdownMenuPrimitive.SubTrigger
>): React.ReactElement {
  return (
    <DropdownMenuPrimitive.SubTrigger
      className={cn(
        "flex min-h-10 cursor-pointer items-center rounded-md px-3 text-sm text-foreground outline-none data-highlighted:bg-muted data-[state=open]:bg-muted data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...properties}
    >
      <span className="flex flex-1 items-center">{children}</span>
      <ChevronRight className="ml-2 size-4 shrink-0" aria-hidden="true" />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

/** Renders the surface of a nested menu with the styling of the main one. */
export function DropdownMenuSubContent({
  className,
  ...properties
}: ComponentProps<
  typeof DropdownMenuPrimitive.SubContent
>): React.ReactElement {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.SubContent asChild sideOffset={4} {...properties}>
        <ScrollViewport
          isShell
          containerClassName={MENU_SHELL_CLASS}
          className={cn(MENU_VIEWPORT_CLASS, className)}
        >
          {properties.children}
        </ScrollViewport>
      </DropdownMenuPrimitive.SubContent>
    </DropdownMenuPrimitive.Portal>
  );
}

/** Shows the keyboard shortcut of a menu item at its right edge. */
export function DropdownMenuShortcut({
  className,
  ...properties
}: ComponentProps<"span">): React.ReactElement {
  return (
    <span
      className={cn(
        "ml-auto pl-4 text-xs tracking-wide text-muted-foreground",
        className,
      )}
      {...properties}
    />
  );
}
