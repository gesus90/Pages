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
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, useSubmit } from "react-router";

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
import { UserAvatar } from "@/app/components/common/user-avatar";
import { cn } from "@/app/lib/cn";

import type { InstanceBranding } from "@/definition/Instance";
import type { User } from "@/definition/User";
import type { AccountAccess } from "@/definition/Authorization";

interface AppShellProps {
  readonly isOffline?: boolean;
  readonly account: AccountAccess;
  readonly user: User;
  readonly canViewProjects?: boolean;
  readonly canViewUsers: boolean;
  readonly branding: InstanceBranding;
}

interface NavigationLinksProps {
  readonly canViewProjects: boolean;
  readonly canViewUsers: boolean;
  readonly onNavigate?: () => void;
}

function getLinkClassName(isActive: boolean): string {
  return cn(
    "flex min-h-12 items-center gap-4 rounded-xl px-5 text-lg font-medium text-muted-foreground transition-colors hover:bg-sidebar-hover hover:text-foreground xl:min-h-10 xl:gap-3 xl:px-3 xl:text-sm",
    isActive && "bg-primary-subtle text-foreground shadow-xs",
  );
}

function NavigationLinks({
  canViewProjects,
  canViewUsers,
  onNavigate,
}: NavigationLinksProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <nav
      className="flex flex-1 flex-col gap-1"
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
        </>
      ) : null}
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

      <div className="mt-auto flex flex-col gap-1">
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
  branding,
}: {
  readonly canViewProjects: boolean;
  readonly canViewUsers: boolean;
  readonly branding: InstanceBranding;
}): React.ReactElement {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

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
      <SheetContent>
        <div className="mb-8 flex items-center justify-between">
          <SheetTitle className="sr-only">{t("navigation.label")}</SheetTitle>
          <img
            className="pointer-events-none w-38"
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
          onNavigate={handleClose}
        />
      </SheetContent>
    </Sheet>
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
  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 hidden w-[18.25rem] flex-col bg-background px-5 pt-7 pb-13 md:flex xl:w-56 xl:px-4 xl:pt-5 xl:pb-6">
        <img
          className="pointer-events-none w-57 xl:w-32"
          src={iconUrl}
          alt="Pages"
          draggable={false}
        />
        <InstanceBrand branding={branding} className="mt-6 xl:mt-4" />
        <div className="mt-8 flex flex-1 xl:mt-6">
          <NavigationLinks
            canViewProjects={canViewProjects}
            canViewUsers={canViewUsers}
          />
        </div>
      </aside>

      <header className="fixed inset-x-0 top-0 z-20 flex min-h-19 items-center justify-between bg-background/85 backdrop-blur px-5 md:bg-transparent md:backdrop-blur-none md:pl-[18.25rem] xl:pl-56">
        <div className="justify-self-start md:hidden">
          <MobileNavigation
            branding={branding}
            canViewProjects={canViewProjects}
            canViewUsers={canViewUsers}
          />
        </div>
        <img
          className="pointer-events-none w-26 md:hidden"
          src={iconUrl}
          alt="Pages"
          draggable={false}
        />
        <div className="ml-auto flex items-center pr-1 md:pr-10 xl:pr-8">
          <AccountMenu user={user} account={account} />
        </div>
      </header>

      <main className="px-4 pt-24 pb-10 md:pl-[19.5rem] md:pr-8 xl:pl-64 xl:pr-10">
        {isOffline ? (
          <p
            role="status"
            className="mb-4 rounded-xl bg-warning-subtle px-4 py-2.5 text-sm text-warning"
          >
            {t("users.mode.offline")}
          </p>
        ) : null}
        <Outlet />
      </main>
    </div>
  );
}
