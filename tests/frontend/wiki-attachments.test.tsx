// @vitest-environment jsdom
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { WikiAttachmentsView } from "@/app/components/wiki/wiki-attachments-view";
import { WikiPageEditor } from "@/app/components/wiki/wiki-page-editor";
import { contentDisposition } from "@/app/lib/content-disposition";
import { formatBytes } from "@/app/lib/format-bytes";
import {
  formatAttachmentMarkdown,
  uploadWikiFile,
  WikiUploadError,
} from "@/app/lib/wiki-upload";

import { installEditorGeometry } from "../helpers/editor";
import { renderInWiki } from "../helpers/wiki-render";

import type { WikiAttachmentEntry } from "@/app/components/wiki/wiki-attachments-view";
import type { WikiAttachment, WikiPage } from "@/definition/Wiki";

const ATTACHMENT: WikiAttachment = {
  contentType: "image/png",
  createdAt: "2026-01-02 10:00:00",
  fileName: "logo [v2].png",
  id: "a1",
  isEmbeddable: true,
  kind: "media",
  pageId: "p1",
  size: 1536,
  uploadedBy: "o1",
  uploadedByName: "Olga",
};

/** A scripted stand-in for XMLHttpRequest. */
class FakeRequest {
  public static instances: FakeRequest[] = [];
  public static next: { status: number; body: string } | "error" | "throw" = {
    body: JSON.stringify({ attachment: ATTACHMENT }),
    status: 200,
  };

  public method = "";
  public url = "";
  public sent: unknown = null;
  public status = 0;
  public responseText = "";
  public onload: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  public upload: { onprogress: ((event: ProgressEvent) => void) | null } = {
    onprogress: null,
  };

  public constructor() {
    FakeRequest.instances.push(this);
  }

  public open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  public send(body: unknown): void {
    this.sent = body;

    if (FakeRequest.next === "throw") {
      throw new TypeError("send failed");
    }

    this.upload.onprogress?.({
      lengthComputable: true,
      loaded: 1,
      total: 4,
    } as ProgressEvent);
    this.upload.onprogress?.({
      lengthComputable: false,
      loaded: 0,
      total: 0,
    } as ProgressEvent);

    const answer = FakeRequest.next;

    queueMicrotask(() => {
      if (typeof answer === "string") {
        this.onerror?.();

        return;
      }

      this.status = answer.status;
      this.responseText = answer.body;
      this.onload?.();
    });
  }
}

beforeEach(() => {
  FakeRequest.instances = [];
  FakeRequest.next = {
    body: JSON.stringify({ attachment: ATTACHMENT }),
    status: 200,
  };
  vi.stubGlobal("XMLHttpRequest", FakeRequest);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("small helpers", () => {
  it("writes sizes in a sensible unit", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(15 * 1024)).toBe("15 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3.0 GB");
    expect(formatBytes(2048 * 1024 ** 4)).toBe("2048 TB");
  });

  it("builds a download header that survives umlauts and quotes", () => {
    expect(contentDisposition("attachment", 'Bericht "Q3" Größe.pdf')).toBe(
      "attachment; filename=\"Bericht _Q3_ Gr__e.pdf\"; filename*=UTF-8''Bericht%20%22Q3%22%20Gr%C3%B6%C3%9Fe.pdf",
    );
    expect(contentDisposition("inline", "it's (x)*.png")).toContain(
      "filename*=UTF-8''it%27s%20%28x%29%2A.png",
    );
  });

  it("writes images and links for uploads", () => {
    expect(formatAttachmentMarkdown(ATTACHMENT)).toBe(
      "![logo \\[v2\\].png](/wiki/attachments/a1)",
    );
    expect(
      formatAttachmentMarkdown({ ...ATTACHMENT, isEmbeddable: false }),
    ).toBe("[logo \\[v2\\].png](/wiki/attachments/a1)");
  });
});

describe("uploadWikiFile", () => {
  const file = new File(["data"], "my file.txt");

  it("sends the file as the body and reports the progress", async () => {
    const progress = vi.fn();

    await expect(uploadWikiFile("p 1", file, progress)).resolves.toEqual(
      ATTACHMENT,
    );

    const [request] = FakeRequest.instances;

    expect(request?.method).toBe("PUT");
    expect(request?.url).toBe(
      "/wiki-api/attachments?page=p%201&name=my%20file.txt",
    );
    expect(request?.sent).toBe(file);
    expect(progress.mock.calls).toEqual([[0.25], [0]]);
  });

  it("names the reason the server gave", async () => {
    FakeRequest.next = {
      body: JSON.stringify({ error: "fileTooLarge" }),
      status: 413,
    };

    await expect(uploadWikiFile("p", file, vi.fn())).rejects.toMatchObject({
      code: "fileTooLarge",
    });
  });

  it("falls back to a network error for odd answers", async () => {
    for (const body of [
      "not json",
      "null",
      JSON.stringify({}),
      JSON.stringify("text"),
    ]) {
      FakeRequest.next = { body, status: 500 };

      await expect(uploadWikiFile("p", file, vi.fn())).rejects.toBeInstanceOf(
        WikiUploadError,
      );
    }

    FakeRequest.next = {
      body: JSON.stringify({ attachment: ATTACHMENT }),
      status: 500,
    };
    await expect(uploadWikiFile("p", file, vi.fn())).rejects.toMatchObject({
      code: "network",
    });

    FakeRequest.next = "error";
    await expect(uploadWikiFile("p", file, vi.fn())).rejects.toMatchObject({
      code: "network",
    });
  });
});

describe("WikiAttachmentsView", () => {
  const entry = (
    overrides: Partial<WikiAttachmentEntry> = {},
  ): WikiAttachmentEntry => ({
    ...ATTACHMENT,
    canRemove: true,
    ...overrides,
  });

  it("lists attachments with download links and removes after confirmation", async () => {
    const { pageSubmissions } = renderInWiki(
      <WikiAttachmentsView
        attachments={[
          entry(),
          entry({
            canRemove: false,
            fileName: "notes.txt",
            id: "a2",
            isEmbeddable: false,
          }),
        ]}
        canUpload
        pageId="p1"
      />,
      { path: "/wiki/p1" },
    );

    const link = await screen.findByRole("link", { name: "logo [v2].png" });

    expect(link).toHaveAttribute("href", "/wiki/attachments/a1?download=1");
    expect(screen.getAllByText(/1\.5 KB · Olga · 2026-01-02/)).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(1);

    await userEvent.click(
      screen.getByRole("button", { name: "Remove logo [v2].png" }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Remove “logo [v2].png”?",
    });

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Remove" }),
    );
    await waitFor(() =>
      expect(pageSubmissions[0]).toEqual({
        attachmentId: "a1",
        intent: "delete-attachment",
      }),
    );
  });

  it("closes the removal dialog without removing", async () => {
    renderInWiki(
      <WikiAttachmentsView attachments={[entry()]} canUpload pageId="p1" />,
      {
        path: "/wiki/p1",
      },
    );

    await userEvent.click(
      await screen.findByRole("button", { name: /^Remove / }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Cancel" }),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("hides the upload button from people who cannot upload", async () => {
    renderInWiki(
      <WikiAttachmentsView
        attachments={[entry()]}
        canUpload={false}
        pageId="p1"
      />,
      { path: "/wiki/p1" },
    );

    await screen.findByRole("link", { name: "logo [v2].png" });

    expect(
      screen.queryByRole("button", { name: "Attach an image or file" }),
    ).toBeNull();
  });

  it("shows nothing without attachments for people who cannot upload", async () => {
    const { container } = renderInWiki(
      <WikiAttachmentsView attachments={[]} canUpload={false} pageId="p1" />,
      { path: "/wiki/p1" },
    );

    await waitFor(() => expect(container.querySelector("section")).toBeNull());
  });

  it("invites to upload when there are none", async () => {
    renderInWiki(
      <WikiAttachmentsView attachments={[]} canUpload pageId="p1" />,
      {
        path: "/wiki/p1",
      },
    );

    expect(await screen.findByText("No attachments.")).toBeVisible();
  });

  it("uploads chosen files one after the other and shows the progress and a failure", async () => {
    renderInWiki(
      <WikiAttachmentsView attachments={[]} canUpload pageId="p1" />,
      {
        path: "/wiki/p1",
      },
    );

    const input = await screen.findByLabelText("Choose a file");

    await userEvent.upload(input, [
      new File(["a"], "a.txt"),
      new File(["b"], "b.txt"),
    ]);

    await waitFor(() => expect(FakeRequest.instances).toHaveLength(2));

    FakeRequest.next = {
      body: JSON.stringify({ error: "fileEmpty" }),
      status: 400,
    };
    await userEvent.upload(input, new File(["c"], "c.txt"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The file is empty.",
    );
  });

  it("treats an unexpected failure of the upload as a network problem", async () => {
    FakeRequest.next = "throw";
    renderInWiki(
      <WikiAttachmentsView attachments={[]} canUpload pageId="p1" />,
      {
        path: "/wiki/p1",
      },
    );

    await userEvent.upload(
      await screen.findByLabelText("Choose a file"),
      new File(["x"], "a.txt"),
    );

    expect(
      await screen.findByText("The server cannot be reached."),
    ).toBeVisible();
  });

  it("ignores a change without files", async () => {
    renderInWiki(
      <WikiAttachmentsView attachments={[]} canUpload pageId="p1" />,
      {
        path: "/wiki/p1",
      },
    );

    const input = await screen.findByLabelText("Choose a file");

    Object.defineProperty(input, "files", { value: null });
    fireEvent.change(input);

    expect(FakeRequest.instances).toHaveLength(0);
  });

  it("opens the file chooser from the button", async () => {
    renderInWiki(
      <WikiAttachmentsView attachments={[]} canUpload pageId="p1" />,
      {
        path: "/wiki/p1",
      },
    );

    const input = (await screen.findByLabelText(
      "Choose a file",
    )) as HTMLInputElement;
    const click = vi.spyOn(input, "click");

    await userEvent.click(
      screen.getByRole("button", { name: "Attach an image or file" }),
    );

    expect(click).toHaveBeenCalled();
  });
});

describe("attachments in the editor", () => {
  beforeAll(installEditorGeometry);

  const PAGE: WikiPage = {
    anchors: [],
    breadcrumb: [],
    content: "",
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

  async function renderEditor(): Promise<HTMLElement> {
    renderInWiki(
      <WikiPageEditor
        attachments={[]}
        meta={null}
        page={PAGE}
        onComment={vi.fn()}
        onSaved={vi.fn()}
        onTextChange={vi.fn()}
        onTextElement={vi.fn()}
      />,
      { path: "/wiki/p1" },
    );

    return screen.findByRole("textbox", { name: "Page text" });
  }

  function pasteFile(element: HTMLElement, file: File): void {
    const paste = new Event("paste", {
      bubbles: true,
      cancelable: true,
    }) as Event & { clipboardData: unknown };

    paste.clipboardData = {
      files: [file],
      getData: () => "",
      types: ["Files"],
    };
    act(() => {
      element.dispatchEvent(paste);
    });
  }

  it("inserts pasted and chosen files at the caret", async () => {
    const element = await renderEditor();

    pasteFile(element, new File(["x"], "logo.png"));

    expect(await within(element).findByRole("img")).toHaveAttribute(
      "src",
      "/wiki/attachments/a1",
    );
    expect(FakeRequest.instances[0]?.url).toBe(
      "/wiki-api/attachments?page=p1&name=logo.png",
    );

    FakeRequest.next = {
      body: JSON.stringify({
        attachment: {
          ...ATTACHMENT,
          fileName: "plan.pdf",
          isEmbeddable: false,
        },
      }),
      status: 200,
    };

    const input = document.querySelector('input[type="file"]');

    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(["y"], "plan.pdf")] },
    });

    expect(
      await within(element).findByRole("link", { name: "plan.pdf" }),
    ).toHaveAttribute("href", "/wiki/attachments/a1");
  });

  it("reports an unexpected failure as a network problem", async () => {
    FakeRequest.next = "error";

    pasteFile(await renderEditor(), new File(["x"], "a.png"));

    expect(
      await screen.findByText("The server cannot be reached."),
    ).toBeVisible();
  });
});
