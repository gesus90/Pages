import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

import { DraftQueue } from "@/app/lib/drafts/draft-queue";
import {
  descriptionDraftAdapter,
  wikiDraftAdapter,
} from "@/app/lib/drafts/draft-transport";

import type {
  DescriptionContent,
  WikiSaveContent,
} from "@/definition/BackgroundSave";

interface DraftStores {
  readonly wiki: DraftQueue<WikiSaveContent>;
  readonly descriptions: DraftQueue<DescriptionContent>;
}

const DraftContext = createContext<DraftStores | null>(null);

/** Retains account-local edits above every workspace route and warns on tab close. */
export function DraftProvider({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  const [stores] = useState<DraftStores>(() => ({
    wiki: new DraftQueue(wikiDraftAdapter),
    descriptions: new DraftQueue(descriptionDraftAdapter),
  }));
  useEffect(() => {
    stores.wiki.setActive(true);
    stores.descriptions.setActive(true);
    const warn = (event: BeforeUnloadEvent): void => {
      const hasPending = [
        ...stores.wiki.list(),
        ...stores.descriptions.list(),
      ].some((entry) => entry.hasChanges || entry.isSaving);
      if (!hasPending) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      stores.wiki.setActive(false);
      stores.descriptions.setActive(false);
    };
  }, [stores]);

  return (
    <DraftContext.Provider value={stores}>{children}</DraftContext.Provider>
  );
}

/** Returns the workspace queues and subscribes the current view to their edits. */
export function useDraftStores(): DraftStores {
  const stores = useContext(DraftContext);
  if (!stores)
    throw new Error("Drafts require the authenticated workspace provider.");
  useSyncExternalStore(
    stores.wiki.subscribe,
    stores.wiki.snapshot,
    stores.wiki.snapshot,
  );
  useSyncExternalStore(
    stores.descriptions.subscribe,
    stores.descriptions.snapshot,
    stores.descriptions.snapshot,
  );
  return stores;
}
