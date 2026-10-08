import { PanelLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Outlet, useLocation, useParams } from "react-router";

import { Button } from "@/app/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/app/components/ui/sheet";
import { WikiNavigation } from "@/app/components/wiki/wiki-navigation";
import { WikiSearchDialog } from "@/app/components/wiki/wiki-search-dialog";

import type { WikiTemplateChoice } from "@/app/components/wiki/wiki-new-page-dialog";
import type {
  WikiNavigation as WikiNavigationData,
  WikiOwnerCandidate,
} from "@/definition/Wiki";

interface WikiShellProps {
  readonly navigation: WikiNavigationData;
  readonly templates: readonly WikiTemplateChoice[];
  readonly people: readonly WikiOwnerCandidate[];
  readonly today: string;
}

/** Opens the search with Ctrl or Cmd + K, as in other tools. */
function useSearchShortcut(open: () => void): void {
  useEffect(() => {
    const listen = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        open();
      }
    };

    window.addEventListener("keydown", listen);

    return () => window.removeEventListener("keydown", listen);
  }, [open]);
}

/** The wiki frame: page navigation on the left, the open page on the right. */
export function WikiShell({
  navigation,
  templates,
  people,
  today,
}: WikiShellProps): React.ReactElement {
  const { pathname } = useLocation();
  const { pageId = null } = useParams();
  const [isSearching, setIsSearching] = useState(false);
  const openSearch = (): void => setIsSearching(true);

  useSearchShortcut(openSearch);

  return (
    <div className="mx-auto flex max-w-[92rem] gap-8">
      <aside className="hidden w-60 shrink-0 md:block">
        <div className="sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto pr-1">
          <WikiNavigation
            navigation={navigation}
            templates={templates}
            today={today}
            onSearch={openSearch}
          />
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <div className="mb-4 md:hidden">
          <MobileNavigation
            key={pathname}
            navigation={navigation}
            people={people}
            templates={templates}
            today={today}
            onSearch={openSearch}
          />
        </div>
        <Outlet />
      </div>
      {isSearching ? (
        <WikiSearchDialog
          navigation={navigation}
          pageId={pageId}
          people={people}
          onClose={() => setIsSearching(false)}
        />
      ) : null}
    </div>
  );
}

function MobileNavigation({
  navigation,
  templates,
  today,
  onSearch,
}: WikiShellProps & { readonly onSearch: () => void }): React.ReactElement {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline">
          <PanelLeft aria-hidden="true" className="size-4" />
          {t("wiki.nav.open")}
        </Button>
      </SheetTrigger>
      <SheetContent className="overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <SheetTitle className="text-base font-semibold">
            {t("wiki.nav.label")}
          </SheetTitle>
          <SheetClose asChild>
            <Button size="sm" variant="ghost">
              {t("wiki.dialog.close")}
            </Button>
          </SheetClose>
        </div>
        <WikiNavigation
          navigation={navigation}
          templates={templates}
          today={today}
          onNavigate={() => setIsOpen(false)}
          onSearch={() => {
            setIsOpen(false);
            onSearch();
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
