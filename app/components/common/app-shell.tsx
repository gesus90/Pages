import {
  ChevronDown,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  Settings,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useSubmit } from "react-router";

import iconUrl from "@/assets/icon.png";
import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/app/components/ui/sheet";
import { cn } from "@/app/lib/cn";

import type { User } from "@/definition/User";

interface AppShellProps {
  readonly user: User;
}

interface NavigationLinksProps {
  readonly onNavigate?: () => void;
}

function getAvatarInitial(user: User): string {
  return (user.displayName.trim() || user.username).charAt(0).toUpperCase();
}

function NavigationLinks({
  onNavigate,
}: NavigationLinksProps): React.ReactElement {
  const { t } = useTranslation();

  function getLinkClassName(isActive: boolean): string {
    return cn(
      "flex min-h-12 items-center gap-4 rounded-lg px-5 text-lg font-medium text-[#525863] transition-colors hover:bg-sidebar-hover hover:text-foreground",
      isActive && "bg-[#fdf4ee] text-foreground",
    );
  }

  return (
    <nav
      className="flex flex-1 flex-col gap-1"
      aria-label={t("navigation.label")}
    >
      <NavLink
        className={({ isActive }) => getLinkClassName(isActive)}
        to="/dashboard"
        onClick={onNavigate}
      >
        <LayoutDashboard className="size-6 text-primary" aria-hidden="true" />
        {t("navigation.dashboard")}
      </NavLink>
      <NavLink
        className={({ isActive }) => cn(getLinkClassName(isActive), "mt-auto")}
        to="/settings"
        onClick={onNavigate}
      >
        <Settings className="size-6" aria-hidden="true" />
        {t("navigation.settings")}
      </NavLink>
    </nav>
  );
}

function AccountMenu({ user }: { readonly user: User }): React.ReactElement {
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
          className="flex items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          type="button"
          aria-label={t("account.menu")}
        >
          <span
            className="inline-flex size-10 items-center justify-center rounded-full bg-[#edeef1] text-base font-medium text-[#1e262e] md:size-14 md:text-xl"
            aria-hidden="true"
          >
            {getAvatarInitial(user)}
          </span>
          <span className="ml-4 hidden text-lg font-medium md:inline">
            {user.displayName}
          </span>
          <ChevronDown
            className="ml-3 hidden size-4 text-[#525863] md:block"
            aria-hidden="true"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={handleSignOut}>
          <LogOut className="mr-2 size-4" aria-hidden="true" />
          {t("account.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MobileNavigation(): React.ReactElement {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  function handleClose(): void {
    setIsOpen(false);
  }

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button
          className="size-10 min-h-0 px-0 md:hidden"
          variant="ghost"
          aria-label={t("navigation.menu")}
        >
          <Menu className="size-5" aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent>
        <div className="mb-8 flex items-center justify-between">
          <SheetTitle className="sr-only">{t("navigation.label")}</SheetTitle>
          <img className="w-38" src={iconUrl} alt="Pages" />
          <SheetClose asChild>
            <Button
              className="size-10 min-h-0 px-0"
              variant="ghost"
              aria-label={t("navigation.close")}
            >
              <PanelLeftClose className="size-5" aria-hidden="true" />
            </Button>
          </SheetClose>
        </div>
        <NavigationLinks onNavigate={handleClose} />
      </SheetContent>
    </Sheet>
  );
}

/** Renders the responsive authenticated Pages frame. */
export function AppShell({ user }: AppShellProps): React.ReactElement {
  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 hidden w-[18.25rem] flex-col border-r bg-sidebar px-5 pt-7 pb-13 md:flex">
        <NavLink className="block" to="/dashboard">
          <img className="w-57" src={iconUrl} alt="Pages" />
        </NavLink>
        <div className="mt-12 flex flex-1">
          <NavigationLinks />
        </div>
      </aside>

      <header className="grid min-h-19 grid-cols-[1fr_auto_1fr] items-center border-b bg-background/92 px-5 md:fixed md:top-8 md:right-12 md:z-10 md:block md:min-h-0 md:border-0 md:bg-transparent md:px-0">
        <div className="justify-self-start md:hidden">
          <MobileNavigation />
        </div>
        <img className="w-26 md:hidden" src={iconUrl} alt="Pages" />
        <div className="justify-self-end">
          <AccountMenu user={user} />
        </div>
      </header>

      <main className="md:pl-[18.25rem]">
        <Outlet />
      </main>
    </div>
  );
}
