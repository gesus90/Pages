// @vitest-environment jsdom
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/wiki-upload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/wiki-upload")>()),
  uploadWikiFile: vi.fn(),
}));

import { WikiCoverDialog } from "@/app/components/wiki/wiki-cover-dialog";
import { WikiPageCover } from "@/app/components/wiki/wiki-page-cover";
import { WikiPageHero } from "@/app/components/wiki/wiki-page-hero";
import { WIKI_SEARCH_EVENT } from "@/app/components/wiki/wiki-shell";
import { WikiSidebarSection } from "@/app/components/wiki/wiki-sidebar-section";
import { WikiSubpageDialog } from "@/app/components/wiki/wiki-subpage-dialog";
import { WikiTitleField } from "@/app/components/wiki/wiki-title-field";
import { uploadWikiFile, WikiUploadError } from "@/app/lib/wiki-upload";

import { installEditorGeometry } from "../helpers/editor";
import { renderInWiki } from "../helpers/wiki-render";

import type { WikiHeroEditing } from "@/app/components/wiki/wiki-page-hero";
import type { WikiAttachment, WikiPage } from "@/definition/Wiki";

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

function attachment(overrides: Partial<WikiAttachment>): WikiAttachment {
  return {
    contentType: "image/png",
    createdAt: "2026-01-02 10:00:00",
    fileName: "photo.png",
    id: "a1",
    isEmbeddable: true,
    kind: "media",
    pageId: "p1",
    size: 10,
    uploadedBy: "o1",
    uploadedByName: "Olga",
    ...overrides,
  };
}

function editing(overrides: Partial<WikiHeroEditing> = {}): WikiHeroEditing {
  return {
    icon: "",
    onChooseCover: vi.fn(),
    onIconChange: vi.fn(),
    onTitleChange: vi.fn(),
    onTitleEnter: vi.fn(),
    title: "Guide",
    ...overrides,
  };
}

beforeAll(installEditorGeometry);

afterEach(() => {
  vi.mocked(uploadWikiFile).mockReset();
});

describe("WikiPageHero", () => {
  it("shows icon, cover and title to readers", async () => {
    const { container } = renderInWiki(
      <WikiPageHero
        page={{
          ...PAGE,
          cover: { kind: "preset", preset: "ocean" },
          icon: "📘",
        }}
      />,
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "Guide" }),
    ).toBeVisible();
    expect(screen.getByText("📘")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector(".-mt-10")).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers icon and cover to editors and passes the changes on", async () => {
    const changes = editing();

    renderInWiki(<WikiPageHero editing={changes} page={PAGE} />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Add cover" }),
    );
    expect(changes.onChooseCover).toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Add icon" }));
    await userEvent.click(
      within(
        await screen.findByRole("dialog", { name: "Page icon" }),
      ).getByRole("button", { name: "😀" }),
    );
    expect(changes.onIconChange).toHaveBeenCalledWith("😀");

    fireEvent.change(screen.getByRole("textbox", { name: "Page title" }), {
      target: { value: "New\ntitle" },
    });
    expect(changes.onTitleChange).toHaveBeenCalledWith("New title");
  });

  it("changes and removes a chosen icon and opens the cover choice from the cover", async () => {
    const changes = editing({ icon: "📘" });

    renderInWiki(
      <WikiPageHero
        editing={changes}
        page={{ ...PAGE, cover: { attachmentId: "a1", kind: "attachment" } }}
      />,
    );

    expect(screen.queryByRole("button", { name: "Add cover" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add icon" })).toBeNull();
    await userEvent.click(
      await screen.findByRole("button", { name: "Change cover" }),
    );
    expect(changes.onChooseCover).toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Page icon" }));
    fireEvent.keyDown(
      await screen.findByRole("dialog", { name: "Page icon" }),
      { key: "Escape" },
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(changes.onIconChange).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Page icon" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Remove" }),
    );
    expect(changes.onIconChange).toHaveBeenCalledWith("");
  });
});

describe("WikiTitleField", () => {
  it("continues in the text on Enter but not while composing", async () => {
    const onEnter = vi.fn();

    renderInWiki(
      <WikiTitleField value="Guide" onChange={vi.fn()} onEnter={onEnter} />,
    );

    const field = await screen.findByRole("textbox", { name: "Page title" });

    fireEvent.keyDown(field, { isComposing: true, key: "Enter" });
    fireEvent.keyDown(field, { key: "a" });
    expect(onEnter).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it("counts characters near and above the limit", async () => {
    const { unmount } = renderInWiki(
      <WikiTitleField
        value={"x".repeat(170)}
        onChange={vi.fn()}
        onEnter={vi.fn()}
      />,
    );

    expect(await screen.findByText("170 / 200")).toHaveClass(
      "text-muted-foreground",
    );
    unmount();
    renderInWiki(
      <WikiTitleField
        value={"x".repeat(201)}
        onChange={vi.fn()}
        onEnter={vi.fn()}
      />,
    );
    expect(await screen.findByText("201 / 200")).toHaveClass(
      "text-destructive",
    );
  });
});

describe("WikiPageCover", () => {
  it("removes the cover for editors only", async () => {
    const { pageSubmissions, unmount } = renderInWiki(
      <WikiPageCover
        canEdit
        cover={{ kind: "preset", preset: "sand" }}
        pageId="p1"
        onChoose={vi.fn()}
      />,
      { path: "/wiki/p1" },
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Remove cover" }),
    );
    await waitFor(() =>
      expect(pageSubmissions[0]).toEqual({ cover: "", intent: "set-cover" }),
    );
    unmount();

    renderInWiki(
      <WikiPageCover
        canEdit={false}
        cover={{ attachmentId: "a1", kind: "attachment" }}
        pageId="p1"
        onChoose={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(document.querySelector("img")).toHaveAttribute(
        "src",
        "/wiki/attachments/a1",
      ),
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("WikiCoverDialog", () => {
  function renderDialog(options: Parameters<typeof renderInWiki>[1] = {}) {
    const onClose = vi.fn();
    const rendered = renderInWiki(
      <WikiCoverDialog
        attachments={[
          attachment({}),
          attachment({ fileName: "plan.pdf", id: "a2", isEmbeddable: false }),
        ]}
        pageId="p1"
        onClose={onClose}
      />,
      { path: "/wiki/p1", ...options },
    );

    return { ...rendered, onClose };
  }

  function chooseFile(file: File | null): void {
    fireEvent.change(
      screen.getByLabelText("Upload image", { selector: "input" }),
      {
        target: { files: file ? [file] : null },
      },
    );
  }

  it("sets a prepared cover or an image of the page and closes", async () => {
    const { pageSubmissions, onClose } = renderDialog();

    expect(
      await screen.findByRole("button", { name: "photo.png" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "plan.pdf" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Ocean" }));

    await waitFor(() =>
      expect(pageSubmissions[0]).toEqual({
        cover: "preset:ocean",
        intent: "set-cover",
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows why the cover was refused and closes with cancel", async () => {
    const { onClose } = renderDialog({
      pageAnswers: { "set-cover": { error: "invalidCover", ok: false } },
    });

    await userEvent.click(
      await screen.findByRole("button", { name: "photo.png" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The cover must be a prepared cover or an image of this page.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("uploads an image as cover and refuses other files", async () => {
    const { pageSubmissions } = renderDialog();
    const click = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => undefined);

    await userEvent.click(
      await screen.findByRole("button", { name: "Upload image" }),
    );
    expect(click).toHaveBeenCalled();
    click.mockRestore();

    chooseFile(null);
    expect(uploadWikiFile).not.toHaveBeenCalled();

    vi.mocked(uploadWikiFile).mockResolvedValueOnce(
      attachment({ id: "a9", isEmbeddable: false }),
    );
    chooseFile(new File(["x"], "plan.pdf"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The cover must be",
    );

    vi.mocked(uploadWikiFile).mockResolvedValueOnce(attachment({ id: "a9" }));
    chooseFile(new File(["x"], "photo.png"));
    await waitFor(() =>
      expect(pageSubmissions[0]).toEqual({
        cover: "attachment:a9",
        intent: "set-cover",
      }),
    );
    expect(vi.mocked(uploadWikiFile).mock.calls[1]?.[0]).toBe("p1");
    expect(vi.mocked(uploadWikiFile).mock.calls[1]?.[2](0.5)).toBeUndefined();
  });

  it("names upload failures", async () => {
    renderDialog();
    await screen.findByRole("dialog", { name: "Choose cover" });

    vi.mocked(uploadWikiFile).mockRejectedValueOnce(
      new WikiUploadError("fileTooLarge"),
    );
    chooseFile(new File(["x"], "big.png"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The file exceeds the size limit",
    );

    vi.mocked(uploadWikiFile).mockRejectedValueOnce(new TypeError("offline"));
    chooseFile(new File(["x"], "a.png"));
    expect(
      await screen.findByText("The server cannot be reached."),
    ).toBeVisible();
  });
});

describe("WikiSubpageDialog", () => {
  it("creates the subpage and reports it once", async () => {
    const onDone = vi.fn();
    const { layoutSubmissions } = renderInWiki(
      <WikiSubpageDialog parentId="p1" onDone={onDone} />,
      {
        layoutAnswers: {
          "create-page": {
            ok: true,
            page: { ...PAGE, icon: "📘", id: "p9", title: "Child" },
          },
        },
      },
    );

    await userEvent.type(
      await screen.findByRole("textbox", { name: "Title" }),
      "Child",
    );
    await userEvent.click(screen.getByRole("button", { name: "Create page" }));

    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith({
        href: "/wiki/p9",
        icon: "📘",
        title: "Child",
      }),
    );
    expect(layoutSubmissions[0]).toEqual({
      intent: "create-page",
      parentId: "p1",
      stay: "1",
      title: "Child",
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("shows a refusal and cancels with the button and Escape", async () => {
    const onDone = vi.fn();

    renderInWiki(<WikiSubpageDialog parentId="p1" onDone={onDone} />, {
      layoutAnswers: { "create-page": { error: "treeTooDeep", ok: false } },
    });

    await userEvent.type(
      await screen.findByRole("textbox", { name: "Title" }),
      "Deep",
    );
    await userEvent.click(screen.getByRole("button", { name: "Create page" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "at most 10 levels",
    );

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.keyboard("{Escape}");
    expect(onDone).toHaveBeenNthCalledWith(1, null);
    expect(onDone).toHaveBeenNthCalledWith(2, null);
  });
});

describe("WikiSidebarSection", () => {
  const SHELL = {
    navigation: {
      canCreate: false,
      expandedIds: [],
      favoriteIds: [],
      nodes: [],
      projects: [],
      recent: [],
    },
    templates: [],
    today: "2026-10-07",
  };

  it("shows the wiki navigation and asks the wiki for the search", async () => {
    const onNavigate = vi.fn();
    const onSearch = vi.fn();

    window.addEventListener(WIKI_SEARCH_EVENT, onSearch);
    renderInWiki(<WikiSidebarSection onNavigate={onNavigate} />, {
      shell: SHELL,
    });

    await userEvent.click(
      await screen.findByRole("button", { name: "Search" }),
    );
    window.removeEventListener(WIKI_SEARCH_EVENT, onSearch);

    expect(onNavigate).toHaveBeenCalled();
    expect(onSearch).toHaveBeenCalled();
  });

  it("searches without a menu to close and stays away outside the wiki", async () => {
    const onSearch = vi.fn();

    window.addEventListener(WIKI_SEARCH_EVENT, onSearch);
    const { unmount } = renderInWiki(<WikiSidebarSection />, { shell: SHELL });

    await userEvent.click(
      await screen.findByRole("button", { name: "Search" }),
    );
    window.removeEventListener(WIKI_SEARCH_EVENT, onSearch);
    expect(onSearch).toHaveBeenCalled();
    unmount();

    renderInWiki(<WikiSidebarSection />);
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(screen.queryByRole("navigation")).toBeNull();
  });
});
