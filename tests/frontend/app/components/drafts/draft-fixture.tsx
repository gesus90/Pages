import { useTranslation } from "react-i18next";
import { Link, useLoaderData } from "react-router";

import { BackgroundSaveStatus } from "@/app/components/common/background-save-status";
import { DraftProvider } from "@/app/components/common/draft-provider";
import { NavigationContent } from "@/app/components/common/navigation-content";
import { useWikiDraft } from "@/app/components/wiki/use-wiki-draft";
import { useTicketDescription } from "@/app/components/tasks/description/use-ticket-description";

import type { WikiPage } from "@/definition/Wiki";

/** A deliberately controlled backend/loader boundary. */
export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (result: T) => void;
  reject: (error: Error) => void;
} {
  let resolve: (result: T) => void = () => {
    throw new Error("Promise not initialized");
  };
  let reject: (error: Error) => void = () => {
    throw new Error("Promise not initialized");
  };
  const promise = new Promise<T>((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
}

/** Authorized page metadata, with no database behind it. */
export function wikiPage(id = "one"): WikiPage {
  return {
    id,
    title: id,
    content: `Text ${id}`,
    icon: null,
    revision: 1,
    cover: null,
    scope: "instance",
    projectId: null,
    projectName: null,
    parentId: null,
    ownerId: "owner",
    ownerName: "Owner",
    currentUntil: null,
    updatedAt: "2026-10-15T10:00:00Z",
    createdAt: "2026-10-15T10:00:00Z",
    isTemplate: false,
    updatedByName: "Owner",
    anchors: [],
    breadcrumb: [],
  };
}

/** Workspace frame persists while its nested routes change. */
export function DraftWorkspace(): React.ReactElement {
  return (
    <DraftProvider>
      <nav>
        <Link to="/wiki/one">One</Link>
        <Link to="/wiki/two">Two</Link>
        <Link to="/dashboard">Dashboard</Link>
        <Link to="/tasks/T-1">Ticket</Link>
      </nav>
      <BackgroundSaveStatus />
      <NavigationContent />
    </DraftProvider>
  );
}

/** Exercises the production draft hook through ordinary editor events. */
export function WikiEditorFixture(): React.ReactElement {
  const page = useLoaderData<WikiPage>();
  const state = useWikiDraft(page);
  const { t } = useTranslation();
  return (
    <section>
      <h1>{page.title}</h1>
      <input
        aria-label="Content"
        value={state.draft.content}
        onChange={(event) =>
          state.setDraft({ ...state.draft, content: event.target.value })
        }
      />
      <p>{t(`wiki.editor.status.${state.status}`)}</p>
      <button onClick={state.saveNow}>Save now</button>
      {state.conflict ? (
        <>
          <button onClick={state.conflict.keepMine}>Keep mine</button>
          <button onClick={state.conflict.takeTheirs}>Take theirs</button>
        </>
      ) : null}
    </section>
  );
}

/** Exposes explicit description saving without loading the rich text editor. */
export function DescriptionFixture(): React.ReactElement {
  const state = useTicketDescription({
    id: "ticket",
    key: "T-1",
    description: "Old description",
    updatedAt: "2026-10-15T10:00:00Z",
  });
  return (
    <section>
      <h1>Ticket</h1>
      <input
        aria-label="Description"
        value={state.draft}
        onChange={(event) => state.change(event.target.value)}
      />
      <output>{state.status}</output>
      <button onClick={() => state.save()}>Save description</button>
      <button onClick={() => state.save(true)}>Overwrite description</button>
      <button onClick={state.takeLatest}>Latest description</button>
    </section>
  );
}
