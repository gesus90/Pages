// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WikiMoveDialog } from "@/app/components/wiki/wiki-move-dialog";
import {
  formatMoveTarget,
  listMoveTargets,
  parseMoveTarget,
} from "@/app/lib/wiki-move-targets";

import { renderInWiki } from "../helpers/wiki-render";

import type { WikiMoveRequest } from "@/app/components/wiki/use-wiki-drag";
import type { WikiNavigation, WikiTreeNode } from "@/definition/Wiki";

function node(id: string, overrides: Partial<WikiTreeNode> = {}): WikiTreeNode {
  return {
    currentUntil: null,
    icon: null,
    id,
    parentId: null,
    position: 1,
    projectId: null,
    scope: "instance",
    title: id,
    ...overrides,
  };
}

const NAVIGATION: WikiNavigation = {
  canCreate: true,
  expandedIds: [],
  favoriteIds: [],
  nodes: [
    node("a"),
    node("a1", { parentId: "a" }),
    node("b"),
    node("p", { projectId: "p1", scope: "project" }),
    node("s", { scope: "private" }),
  ],
  projects: [{ id: "p1", name: "Project One" }],
  recent: [],
};

const LABELS = {
  generalRoot: "General root",
  privateRoot: "Private root",
  projectRoot: (name: string) => `${name} root`,
};

const REQUEST: WikiMoveRequest = {
  beforeId: "b",
  from: { projectId: null, scope: "instance" },
  pageId: "a",
  parentId: null,
  projectId: null,
  scope: "instance",
};

describe("move targets", () => {
  it("lists the areas and every page except the moved subtree", () => {
    const options = listMoveTargets(NAVIGATION, "a", LABELS);

    expect(options.map((option) => option.label)).toEqual([
      "Private root",
      "General root",
      "Project One root",
      "s",
      "b",
      "p",
    ]);
  });

  it("indents the pages below others", () => {
    expect(
      listMoveTargets(NAVIGATION, "b", LABELS).map((option) => option.label),
    ).toContain("– a1");
  });

  it("writes and reads targets", () => {
    const base = { beforeId: null, from: REQUEST.from, pageId: "x" };

    expect(
      formatMoveTarget({
        ...base,
        parentId: "a",
        projectId: null,
        scope: "instance",
      }),
    ).toBe("page:a");
    expect(
      formatMoveTarget({
        ...base,
        parentId: null,
        projectId: "p1",
        scope: "project",
      }),
    ).toBe("root:project:p1");
    expect(
      formatMoveTarget({
        ...base,
        parentId: null,
        projectId: null,
        scope: "private",
      }),
    ).toBe("root:private");
    expect(parseMoveTarget("page:a")).toEqual({
      parentId: "a",
      projectId: null,
      scope: "instance",
    });
    expect(parseMoveTarget("root:project:p1")).toEqual({
      parentId: null,
      projectId: "p1",
      scope: "project",
    });
    expect(parseMoveTarget("root:private")).toEqual({
      parentId: null,
      projectId: null,
      scope: "private",
    });
    expect(parseMoveTarget("root:instance")).toEqual({
      parentId: null,
      projectId: null,
      scope: "instance",
    });
  });
});

describe("WikiMoveDialog", () => {
  function renderDialog(
    options: Parameters<typeof renderInWiki>[1] = {},
    request: WikiMoveRequest = REQUEST,
  ) {
    const onClose = vi.fn();
    const rendered = renderInWiki(
      <WikiMoveDialog
        navigation={NAVIGATION}
        request={request}
        onClose={onClose}
      />,
      options,
    );

    return { ...rendered, onClose };
  }

  it("previews the move and sends it", async () => {
    const { layoutSubmissions, onClose } = renderDialog({
      layoutAnswers: { "preview-move": { change: "same", ok: true } },
    });

    const dialog = await screen.findByRole("dialog", { name: "Move page" });

    expect(
      await within(dialog).findByText("Visibility stays the same."),
    ).toBeVisible();
    expect(layoutSubmissions[0]).toMatchObject({
      beforeId: "b",
      intent: "preview-move",
      pageId: "a",
      parentId: "",
      scope: "instance",
    });

    await userEvent.click(within(dialog).getByRole("button", { name: "Move" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(
      layoutSubmissions.some((entry) => entry.intent === "move-page"),
    ).toBe(true);
  });

  it("previews again for another target and drops the position", async () => {
    const { layoutSubmissions } = renderDialog({
      layoutAnswers: { "preview-move": { change: "narrower", ok: true } },
    });

    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("combobox", { name: "Target" }));
    await userEvent.click(
      await screen.findByRole("option", { name: "Private (top level)" }),
    );

    expect(
      await screen.findByText("Afterwards fewer people see this page."),
    ).toBeVisible();
    expect(layoutSubmissions.at(-1)).toMatchObject({
      beforeId: "",
      scope: "private",
    });
  });

  it("shows why a move is not possible and keeps the button disabled", async () => {
    renderDialog({
      layoutAnswers: { "preview-move": { error: "treeTooDeep", ok: false } },
    });

    expect(
      await screen.findByText("Pages can be nested at most 10 levels deep."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Move" })).toBeDisabled();
  });

  it("shows an error of the move itself and stays open", async () => {
    const { onClose } = renderDialog({
      layoutAnswers: {
        "move-page": { error: "forbidden", ok: false },
        "preview-move": { change: "same", ok: true },
      },
    });

    await screen.findByText("Visibility stays the same.");
    await userEvent.click(screen.getByRole("button", { name: "Move" }));

    expect(
      await screen.findByText("You lack the permission for this."),
    ).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes without moving", async () => {
    const { onClose } = renderDialog({
      layoutAnswers: { "preview-move": { change: "same", ok: true } },
    });

    await userEvent.click(
      await screen.findByRole("button", { name: "Cancel" }),
    );

    expect(onClose).toHaveBeenCalled();
  });
});
