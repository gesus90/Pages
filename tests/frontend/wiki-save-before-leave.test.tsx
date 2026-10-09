// @vitest-environment jsdom
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Link } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { useSaveBeforeLeave } from "@/app/components/wiki/use-save-before-leave";
import { useWikiDraft } from "@/app/components/wiki/use-wiki-draft";

import { renderInWiki } from "../helpers/wiki-render";

import type { WikiSaveStatus } from "@/app/components/wiki/use-wiki-draft";
import type { WikiPage } from "@/definition/Wiki";

interface Draft {
  readonly isClean: boolean;
  readonly status: WikiSaveStatus;
}

let setDraft: (draft: Draft) => void = () => undefined;

function Guard({
  initial,
  saveNow,
}: {
  readonly initial: Draft;
  readonly saveNow: () => void;
}): React.ReactElement {
  const [draft, setDraftState] = useState(initial);
  const isWaiting = useSaveBeforeLeave({ ...draft, saveNow });

  setDraft = setDraftState;

  return (
    <>
      <Link to="/wiki/p2">Other page</Link>
      <Link to="/wiki/p1?tab=history">Same page</Link>
      <p>{isWaiting ? "waiting" : "free"}</p>
    </>
  );
}

function renderGuard(initial: Draft) {
  const saveNow = vi.fn();
  const rendered = renderInWiki(<Guard initial={initial} saveNow={saveNow} />, {
    path: "/wiki/p1",
  });

  return { ...rendered, saveNow };
}

describe("useSaveBeforeLeave", () => {
  it("lets saved drafts leave and keeps changes of the query free", async () => {
    const { router } = renderGuard({ isClean: false, status: "unsaved" });

    await userEvent.click(
      await screen.findByRole("link", { name: "Same page" }),
    );
    expect(router.state.location.search).toBe("?tab=history");
    expect(screen.getByText("free")).toBeVisible();

    act(() => setDraft({ isClean: true, status: "saved" }));
    await userEvent.click(screen.getByRole("link", { name: "Other page" }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/wiki/p2"),
    );
  });

  it("saves first and goes on once the draft is saved", async () => {
    const { router, saveNow } = renderGuard({
      isClean: false,
      status: "unsaved",
    });

    await userEvent.click(
      await screen.findByRole("link", { name: "Other page" }),
    );
    expect(await screen.findByText("waiting")).toBeVisible();
    expect(saveNow).toHaveBeenCalled();
    expect(router.state.location.pathname).toBe("/wiki/p1");

    act(() => setDraft({ isClean: false, status: "saving" }));
    expect(screen.getByText("waiting")).toBeVisible();

    act(() => setDraft({ isClean: false, status: "saved" }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/wiki/p2"),
    );
    expect(screen.getByText("free")).toBeVisible();
  });

  it("goes on when the draft became clean without a save", async () => {
    const { router } = renderGuard({ isClean: false, status: "unsaved" });

    await userEvent.click(
      await screen.findByRole("link", { name: "Other page" }),
    );
    expect(await screen.findByText("waiting")).toBeVisible();

    act(() => setDraft({ isClean: true, status: "unsaved" }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/wiki/p2"),
    );
  });

  it("stays on the page when the draft cannot be saved", async () => {
    const { router, saveNow } = renderGuard({
      isClean: false,
      status: "conflict",
    });

    await userEvent.click(
      await screen.findByRole("link", { name: "Other page" }),
    );

    await waitFor(() => expect(screen.getByText("free")).toBeVisible());
    expect(router.state.location.pathname).toBe("/wiki/p1");
    expect(saveNow).not.toHaveBeenCalled();
  });

  it("asks the browser before the tab closes with unsaved text", async () => {
    renderGuard({ isClean: false, status: "unsaved" });
    await screen.findByText("free");

    const unsaved = new Event("beforeunload", { cancelable: true });

    window.dispatchEvent(unsaved);
    expect(unsaved.defaultPrevented).toBe(true);

    act(() => setDraft({ isClean: true, status: "saved" }));

    const saved = new Event("beforeunload", { cancelable: true });

    window.dispatchEvent(saved);
    expect(saved.defaultPrevented).toBe(false);
  });
});

describe("useWikiDraft", () => {
  const PAGE: WikiPage = {
    anchors: [],
    breadcrumb: [],
    content: "Text",
    cover: null,
    createdAt: "2026-01-01 10:00:00",
    currentUntil: null,
    icon: null,
    id: "p1",
    isTemplate: false,
    ownerId: "o1",
    ownerName: "Olga",
    parentId: null,
    projectId: null,
    projectName: null,
    revision: 1,
    scope: "instance",
    title: "Guide",
    updatedAt: "2026-01-02 10:00:00",
    updatedByName: "Olga",
  };

  function Probe(): React.ReactElement {
    const state = useWikiDraft(PAGE);

    return (
      <button type="button" onClick={state.saveNow}>
        Save now ({state.status})
      </button>
    );
  }

  it("does not save a draft that has nothing new", async () => {
    const { pageSubmissions } = renderInWiki(<Probe />, { path: "/wiki/p1" });

    await userEvent.click(
      await screen.findByRole("button", { name: "Save now (saved)" }),
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

    expect(pageSubmissions).toEqual([]);
  });
});
