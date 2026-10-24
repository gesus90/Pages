import {
  BookOpen,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  Settings,
  SquareCheck,
  Users,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, useSubmit } from "react-router";

import iconUrl from "@/assets/icon.png";
import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/app/components/ui/sheet";
import { InstanceBrand } from "@/app/components/common/instance-brand";
import { NavigationContent } from "@/app/components/common/navigation-content";
import { BackgroundSaveStatus } from "@/app/components/common/background-save-status";
import { UserAvatar } from "@/app/components/common/user-avatar";
import { TicketSidebarSection } from "@/app/components/tasks/tree/ticket-sidebar-section";
import { WikiSidebarSection } from "@/app/components/wiki/wiki-sidebar-section";
import { AgentNavigation } from "@/app/components/settings/agents/agent-navigation";
import { cn } from "@/app/lib/cn";

import styles from "./app-shell/app-shell.module.css";
import { SidebarResizeHandle } from "./app-shell/sidebar-resize-handle";
import { SidebarToggle } from "./app-shell/sidebar-toggle";
import { useSidebarLayout } from "./app-shell/use-sidebar-layout";

import type { InstanceBranding } from "@/definition/Instance";
import type { User } from "@/definition/User";
import type { AccountAccess } from "@/definition/Authorization";
import type { RefObject } from "react";
import type { SidebarLayout } from "./app-shell/use-sidebar-layout";

/** Viewports from which the permanent sidebar replaces the mobile menu. */
const PERMANENT_SIDEBAR_QUERY = "(min-width: 48rem)";

interface AppShellProps {
  readonly isOffline?: boolean;
  readonly account: AccountAccess;
  readonly user: User;
  readonly canViewProjects?: boolean;
  readonly canViewUsers: boolean;
  readonly branding: InstanceBranding;
}

interface DesktopSidebarProps {
  readonly layout: SidebarLayout;
  readonly shellRef: RefObject<HTMLDivElement | null>;
  readonly branding: InstanceBranding;
  readonly canViewProjects: boolean;
  readonly canViewUsers: boolean;
  readonly canManageAgents: boolean;
}

interface NavigationLinksProps {
  readonly canViewProjects: boolean;
  readonly canViewUsers: boolean;
  readonly canManageAgents: boolean;
  readonly onNavigate?: () => void;
}

function getLinkClassName(isActive: boolean): string {
  return cn(
    "flex min-h-12 items-center gap-4 rounded-xl px-5 text-lg font-medium text-muted-foreground transition-colors hover:bg-sidebar-hover hover:text-foreground xl:min-h-10 xl:gap-3 xl:px-3 xl:text-sm",
    isActive && "bg-sidebar-active text-foreground shadow-xs",
  );
}

function NavigationLinks({
  canViewProjects,
  canViewUsers,
  canManageAgents,
  onNavigate,
}: NavigationLinksProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <nav
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-1"
      aria-label={t("navigation.label")}
    >
      <NavLink
        className={({ isActive }) => getLinkClassName(isActive)}
        to="/dashboard"
        prefetch="intent"
        onClick={onNavigate}
      >
        <LayoutDashboard
          className="size-6 text-primary xl:size-5"
          aria-hidden="true"
        />
        {t("navigation.dashboard")}
      </NavLink>
      {canViewProjects ? (
        <>
          <NavLink
            className={({ isActive }) => getLinkClassName(isActive)}
            to="/projekte"
            prefetch="intent"
            onClick={onNavigate}
          >
            <FolderKanban
              className="size-6 text-primary xl:size-5"
              aria-hidden="true"
            />
            {t("navigation.projects")}
          </NavLink>
          <NavLink
            className={({ isActive }) => getLinkClassName(isActive)}
            to="/aufgaben"
            prefetch="intent"
            onClick={onNavigate}
          >
            <SquareCheck
              className="size-6 text-primary xl:size-5"
              aria-hidden="true"
            />
            {t("navigation.tasks")}
          </NavLink>
          <TicketSidebarSection onNavigate={onNavigate} />
        </>
      ) : null}
      <AgentNavigation canManage={canManageAgents} onNavigate={onNavigate} />
      <NavLink
        className={({ isActive }) => getLinkClassName(isActive)}
        to="/wiki"
        prefetch="intent"
        onClick={onNavigate}
      >
        <BookOpen
          className="size-6 text-primary xl:size-5"
          aria-hidden="true"
        />
        {t("navigation.wiki")}
      </NavLink>
      <WikiSidebarSection onNavigate={onNavigate} />

      <div className="mt-auto flex flex-col gap-1 pt-2">
        {canViewUsers ? (
          <NavLink
            className={({ isActive }) => getLinkClassName(isActive)}
            to="/users"
            prefetch="intent"
            onClick={onNavigate}
          >
            <Users
              className="size-6 text-primary xl:size-5"
              aria-hidden="true"
            />
            {t("navigation.users")}
          </NavLink>
        ) : null}
        <NavLink
          className={({ isActive }) => getLinkClassName(isActive)}
          to="/settings"
          prefetch="intent"
          onClick={onNavigate}
        >
          <Settings
            className="size-6 text-primary xl:size-5"
            aria-hidden="true"
          />
          {t("navigation.settings")}
        </NavLink>
      </div>
    </nav>
  );
}

function AccountMenu({
  user,
  account,
}: {
  readonly user: User;
  readonly account: AccountAccess;
}): React.ReactElement {
  const { t } = useTranslation();
  const submit = useSubmit();

  function handleSignOut(): void {
    submit({}, { action: "/logout", method: "post" }).catch(
      (error: unknown) => {
        console.error("Pages could not end the session.", error);
      },
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex rounded-full shadow-card outline-none ring-2 ring-surface focus-visible:ring-2 focus-visible:ring-primary"
          type="button"
          aria-label={t("account.menu")}
        >
          <UserAvatar user={user} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <p className="text-sm font-medium text-foreground">
            {user.displayName}
          </p>
          <p className="text-xs text-muted-foreground">
            <span>{t(`users.mode.${account.mode}`)}</span>
            <span aria-hidden="true"> · </span>
            <span className="pages-selectable">
              {account.role?.name ?? "—"}
            </span>
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings">
            <Settings className="mr-2 size-4" aria-hidden="true" />
            {t("navigation.settings")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-muted-foreground hover:text-foreground"
          onSelect={handleSignOut}
        >
          <LogOut className="mr-2 size-4" aria-hidden="true" />
          {t("account.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MobileNavigation({
  canViewProjects,
  canViewUsers,
  canManageAgents,
  branding,
}: {
  readonly canViewProjects: boolean;
  readonly canViewUsers: boolean;
  readonly canManageAgents: boolean;
  readonly branding: InstanceBranding;
}): React.ReactElement {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  // The permanent sidebar takes over on wider screens; an open menu would
  // show the navigation twice.
  useEffect(() => {
    const query = window.matchMedia(PERMANENT_SIDEBAR_QUERY);

    function handleChange(event: MediaQueryListEvent): void {
      if (event.matches) {
        setIsOpen(false);
      }
    }

    query.addEventListener("change", handleChange);

    return () => query.removeEventListener("change", handleChange);
  }, []);

  function handleClose(): void {
    setIsOpen(false);
  }

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button
          size="icon"
          className="md:hidden"
          variant="ghost"
          aria-label={t("navigation.menu")}
        >
          <Menu className="size-5" aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent className="pages-navigation-palette pages-sidebar-surface">
        <div className="mb-8 flex items-center justify-between">
          <SheetTitle className="sr-only">{t("navigation.label")}</SheetTitle>
          <img
            className="pages-logo pointer-events-none w-38"
            src={iconUrl}
            alt="Pages"
            draggable={false}
          />
          <SheetClose asChild>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t("navigation.close")}
            >
              <PanelLeftClose className="size-5" aria-hidden="true" />
            </Button>
          </SheetClose>
        </div>
        <InstanceBrand branding={branding} className="-mt-3 mb-6" />
        <NavigationLinks
          canViewProjects={canViewProjects}
          canViewUsers={canViewUsers}
          canManageAgents={canManageAgents}
          onNavigate={handleClose}
        />
      </SheetContent>
    </Sheet>
  );
}

/**
 * The permanent sidebar of tablets and desktops: resizable at its right edge
 * up to half the viewport, and collapsible to a narrow strip.
 *
 * @remarks
 * A collapsed sidebar keeps its navigation mounted but hidden, so open tree
 * branches stay open and nothing hidden stays in the tab order.
 */
function DesktopSidebar({
  layout,
  shellRef,
  branding,
  canViewProjects,
  canViewUsers,
  canManageAgents,
}: DesktopSidebarProps): React.ReactElement {
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarId = useId();
  const contentId = useId();

  return (
    <aside
      ref={sidebarRef}
      id={sidebarId}
      className={cn(
        "fixed inset-y-0 left-0 hidden w-(--app-sidebar-width) flex-col bg-sidebar pages-navigation-palette pages-sidebar-surface px-5 pt-7 pb-13 md:flex xl:px-4 xl:pt-5 xl:pb-6",
        !layout.isCollapsed && "min-w-(--app-sidebar-minimum)",
      )}
    >
      <SidebarToggle
        controlsId={contentId}
        isCollapsed={layout.isCollapsed}
        onToggle={layout.toggleCollapsed}
      />
      <div
        id={contentId}
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          layout.isCollapsed && "hidden",
        )}
      >
        <img
          className="pages-logo pointer-events-none w-57 xl:w-32"
          src={iconUrl}
          alt="Pages"
          draggable={false}
        />
        <InstanceBrand branding={branding} className="mt-6 xl:mt-4" />
        <div className="mt-8 flex min-h-0 flex-1 xl:mt-6">
          <NavigationLinks
            canViewProjects={canViewProjects}
            canViewUsers={canViewUsers}
            canManageAgents={canManageAgents}
          />
        </div>
      </div>
      {layout.isCollapsed ? null : (
        <SidebarResizeHandle
          controlsId={sidebarId}
          isResizing={layout.isResizing}
          preferredWidth={layout.preferredWidth}
          shellRef={shellRef}
          sidebarRef={sidebarRef}
          onResizeEnd={layout.commitWidth}
          onResizeStart={layout.startResize}
        />
      )}
    </aside>
  );
}

/** Renders the responsive authenticated Pages frame. */
export function AppShell({
  isOffline = false,
  account,
  user,
  canViewProjects = false,
  canViewUsers,
  branding,
}: AppShellProps): React.ReactElement {
  const { t } = useTranslation();
  const shellRef = useRef<HTMLDivElement>(null);
  const layout = useSidebarLayout();
  const canManageAgents =
    account.isActive && account.isAdmin && account.mode === "admin";

  return (
    <div
      ref={shellRef}
      className={cn(
        "min-h-screen bg-background text-foreground",
        styles.shell,
        layout.isCollapsed && styles.collapsed,
        layout.isResizing && styles.resizing,
      )}
      style={layout.shellStyle}
    >
      <DesktopSidebar
        branding={branding}
        canManageAgents={canManageAgents}
        canViewProjects={canViewProjects}
        canViewUsers={canViewUsers}
        layout={layout}
        shellRef={shellRef}
      />

      <header className="fixed inset-x-0 top-0 z-20 flex min-h-19 items-center justify-between bg-background/85 backdrop-blur px-5 md:left-(--app-sidebar-width) md:bg-transparent md:pl-0 md:backdrop-blur-none">
        <div className="justify-self-start md:hidden">
          <MobileNavigation
            branding={branding}
            canViewProjects={canViewProjects}
            canViewUsers={canViewUsers}
            canManageAgents={canManageAgents}
          />
        </div>
        <img
          className="pages-logo pointer-events-none w-26 md:hidden"
          src={iconUrl}
          alt="Pages"
          draggable={false}
        />
        <div className="ml-auto flex items-center pr-1 md:pr-10 xl:pr-8">
          <AccountMenu user={user} account={account} />
        </div>
      </header>

      <main className="px-4 pt-24 pb-10 md:pr-8 md:pl-(--app-content-start) xl:pr-10">
        {isOffline ? (
          <p
            role="status"
            className="mb-4 rounded-xl bg-warning-subtle px-4 py-2.5 text-sm text-warning"
          >
            {t("users.mode.offline")}
          </p>
        ) : null}
        <BackgroundSaveStatus />
        <NavigationContent />
      </main>
    </div>
  );
}
