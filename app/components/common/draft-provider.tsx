import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

import { createDraftJournal } from "@/app/lib/drafts/draft-journal";
import { DraftQueue } from "@/app/lib/drafts/draft-queue";
import {
  descriptionDraftAdapter,
  wikiDraftAdapter,
} from "@/app/lib/drafts/draft-transport";
import {
  descriptionContentSchema,
  wikiSaveContentSchema,
} from "@/definition/BackgroundSave";

import type {
  DescriptionContent,
  WikiSaveContent,
} from "@/definition/BackgroundSave";

interface DraftStores {
  readonly wiki: DraftQueue<WikiSaveContent>;
  readonly descriptions: DraftQueue<DescriptionContent>;
}

const DraftContext = createContext<DraftStores | null>(null);

/** Whether any edit still waits for the server's confirmation. */
function hasUnconfirmed(stores: DraftStores): boolean {
  return [...stores.wiki.list(), ...stores.descriptions.list()].some(
    (entry) =>
      entry.hasChanges ||
      entry.isSaving ||
      entry.pending !== null ||
      entry.current !== undefined,
  );
}

/**
 * Retains account-local edits above every workspace route and warns on tab close.
 *
 * @remarks
 * Edits the server has not confirmed are also kept in the browser for
 * `ownerId`, so they outlast a reload or an outage; an unconfirmed write is
 * sent again as soon as the connection is back.
 */
export function DraftProvider({
  ownerId,
  children,
}: {
  readonly ownerId: string | null;
  readonly children: React.ReactNode;
}): React.ReactElement {
  const [stores] = useState<DraftStores>(() => ({
    wiki: new DraftQueue(
      wikiDraftAdapter,
      createDraftJournal(ownerId, "wiki", wikiSaveContentSchema),
    ),
    descriptions: new DraftQueue(
      descriptionDraftAdapter,
      createDraftJournal(ownerId, "ticket", descriptionContentSchema),
    ),
  }));
  useEffect(() => {
    stores.wiki.setActive(true);
    stores.descriptions.setActive(true);
    const warn = (event: BeforeUnloadEvent): void => {
      if (!hasUnconfirmed(stores)) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const resend = (): void => {
      stores.wiki.retryUnconfirmed();
      stores.descriptions.retryUnconfirmed();
    };
    window.addEventListener("beforeunload", warn);
    window.addEventListener("online", resend);
    return () => {
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("online", resend);
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

/** Returns a check, made when it is called, whether an edit still waits for the server. */
export function useUnconfirmedDraftCheck(): () => boolean {
  const stores = useContext(DraftContext);
  return () => stores !== null && hasUnconfirmed(stores);
}
