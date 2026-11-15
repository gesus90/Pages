import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CardOverlay } from "@/app/components/chat-page/content/card-panel";
import { MessageContentView } from "@/app/components/chat-page/content/message-content-view";
import { PreviewCard } from "@/app/components/chat-page/content/preview-card";
import { PreviewPanel } from "@/app/components/chat-page/content/preview-panel";
import {
  CodeCard,
  MarkdownCard,
} from "@/app/components/chat-page/content/text-cards";
import { createI18n } from "@/app/lib/i18n";

import type { OpenedCard } from "@/app/components/chat-page/content/card-types";
import type { PreviewFile } from "@/app/components/chat-page/content/preview-kinds";

const content = vi.hoisted(() => ({
  isExpanded: true,
  besideKey: null as string | null,
  overlay: null as OpenedCard | null,
  setState: vi.fn(),
  openBeside: vi.fn(),
  closeBeside: vi.fn(),
  openOverlay: vi.fn(),
  closeOverlay: vi.fn(),
  sendFromPreview: vi.fn(),
}));
vi.mock("@/app/components/chat-page/content/chat-content-context", () => ({
  useChatContent: () => ({
    conversationId: "team",
    stateOf: () => (content.isExpanded ? "expanded" : "collapsed"),
    setState: content.setState,
    beside: content.besideKey === null ? null : { key: content.besideKey },
    openBeside: content.openBeside,
    closeBeside: content.closeBeside,
    overlay: content.overlay,
    openOverlay: content.openOverlay,
    closeOverlay: content.closeOverlay,
    sendFromPreview: content.sendFromPreview,
  }),
}));

const actions = vi.hoisted(() => ({ download: vi.fn(), copy: vi.fn() }));
vi.mock("@/app/components/chat-page/content/preview-download", () => ({
  downloadPreviewFiles: actions.download,
}));
vi.mock("@/app/components/chat-page/content/use-card-text", () => ({
  useCardText: (text: { source: string | null }) => ({
    source: text.source,
    isFailed: false,
  }),
  copyText: actions.copy,
  saveTextFile: vi.fn(),
}));

const mermaid = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("@/app/components/chat-page/content/mermaid-render", () => ({
  renderMermaid: mermaid.render,
}));

const i18n = createI18n("en");
const origin = { senderName: "Ada", createdAt: "2026-11-14T10:00:00.000Z" };
const HTML_FILES: readonly PreviewFile[] = [
  {
    name: "index.html",
    languageHint: "html",
    source: "<button id=b>Go</button>",
  },
  { name: "style.css", languageHint: "css", source: "button { color: red; }" },
  { name: "app.js", languageHint: "js", source: "pages.chat.send('B')" },
];

function wrap(node: React.ReactElement): React.ReactElement {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}

function htmlCard(isDetected = false): React.ReactElement {
  return wrap(
    <PreviewCard
      cardKey="m1:0"
      files={HTML_FILES}
      isDetected={isDetected}
      kind="html"
      name=""
      origin={origin}
    />,
  );
}

function frame(): HTMLIFrameElement {
  const element = document.querySelector("iframe");
  if (!element) throw new Error("No preview frame");
  return element;
}

beforeEach(() => {
  content.isExpanded = true;
  content.besideKey = null;
  content.overlay = null;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HTML and SVG previews (PAGE-383)", () => {
  it("starts the joined preview without a click in a sandbox without the own origin", () => {
    render(htmlCard(true));
    const card = screen.getByRole("region", { name: "HTML preview" });
    expect(card.textContent).toContain(
      "auto-detected: HTML · 3 files · 3 lines",
    );
    const element = frame();
    expect(element.getAttribute("src")).toBe("/chat/preview-frame");
    expect(element.getAttribute("sandbox")).toBe(
      "allow-scripts allow-forms allow-modals",
    );
    expect(element.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(card.textContent).toContain("Sandbox · no access to Pages");
    // Head order: main action, line, reload, beside, full screen, collapse.
    const labels = within(card)
      .getAllByRole("button")
      .map((button) => button.getAttribute("title") ?? button.textContent);
    expect(
      within(card)
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["Preview", "Code"]);
    expect(
      screen
        .getByRole("tab", { name: "Preview" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(labels).toEqual([
      "Download",
      "Reload",
      "Beside",
      "Full screen",
      "Collapse",
    ]);
    expect(
      screen.getByRole("button", { name: "Download" }).className,
    ).toContain("bg-primary");
  });

  it("shows the joined files behind file tabs in the code tab and downloads them", () => {
    render(htmlCard());
    fireEvent.click(screen.getByRole("tab", { name: "Code" }));
    expect(document.querySelector("iframe")).toBeNull();
    expect(
      screen
        .getByRole("tab", { name: "index.html" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "style.css" }));
    expect(document.querySelector("[data-code-lines]")?.textContent).toContain(
      "button { color: red; }",
    );
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(actions.download).toHaveBeenCalledWith(HTML_FILES);
  });

  it("runs nothing while collapsed or opened next to the chat", () => {
    content.isExpanded = false;
    const { rerender } = render(htmlCard());
    expect(document.querySelector("iframe")).toBeNull();
    content.isExpanded = true;
    content.besideKey = "m1:0";
    rerender(htmlCard());
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Opened on the right");
  });

  it("loads the preview again with Reload", () => {
    render(htmlCard());
    const first = frame();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(frame()).not.toBe(first);
  });

  it("frames an SVG without Reload", () => {
    render(
      wrap(
        <PreviewCard
          cardKey="svg"
          files={[
            { name: "image.svg", languageHint: "svg", source: "<svg></svg>" },
          ]}
          isDetected={false}
          kind="svg"
          name=""
          origin={origin}
        />,
      ),
    );
    expect(frame().getAttribute("sandbox")).toBe(
      "allow-scripts allow-forms allow-modals",
    );
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
  });
});

describe("writing back from a preview (PAGE-383)", () => {
  function post(element: HTMLIFrameElement, payload: unknown): void {
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: payload,
          source: element.contentWindow,
        }),
      );
    });
  }

  it("hands the frame its document once it is ready", () => {
    render(htmlCard());
    const element = frame();
    const target = element.contentWindow;
    if (!target) throw new Error("No frame window");
    const postMessage = vi
      .spyOn(target, "postMessage")
      .mockImplementation(() => undefined);
    post(element, { type: "pages-preview:ready" });
    expect(postMessage).toHaveBeenCalledOnce();
    expect(postMessage.mock.calls[0]?.[0]).toMatchObject({
      type: "pages-preview:render",
    });
    expect(JSON.stringify(postMessage.mock.calls[0]?.[0])).toContain(
      "button { color: red; }",
    );
  });

  it("writes into the chat only right after an input of the person in the frame", () => {
    render(htmlCard());
    const element = frame();
    vi.stubGlobal("navigator", {
      ...navigator,
      userActivation: { isActive: true },
    });
    post(element, { type: "pages-preview:send", text: "Variante B nehmen" });
    // The frame does not hold the focus: no click of the person in it.
    expect(content.sendFromPreview).not.toHaveBeenCalled();
    element.tabIndex = 0;
    element.focus();
    post(element, { type: "pages-preview:send", text: "Variante B nehmen" });
    expect(content.sendFromPreview).toHaveBeenCalledWith("Variante B nehmen");
    vi.stubGlobal("navigator", {
      ...navigator,
      userActivation: { isActive: false },
    });
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 5000);
    post(element, { type: "pages-preview:send", text: "noch einmal" });
    expect(content.sendFromPreview).toHaveBeenCalledOnce();
  });

  it("ignores messages of other windows", () => {
    render(htmlCard());
    vi.stubGlobal("navigator", {
      ...navigator,
      userActivation: { isActive: true },
    });
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "pages-preview:send", text: "x" },
          source: window,
        }),
      );
    });
    expect(content.sendFromPreview).not.toHaveBeenCalled();
  });
});

function single(
  kind: "mermaid" | "json" | "csv" | "tsv",
  source: string,
  languageHint: string = kind,
): React.ReactElement {
  return wrap(
    <PreviewCard
      cardKey={kind}
      files={[{ name: `data.${kind}`, languageHint, source }]}
      isDetected={false}
      kind={kind}
      name=""
      origin={origin}
    />,
  );
}

describe("Mermaid and JSON previews (PAGE-383)", () => {
  it("draws a Mermaid diagram with zoom", async () => {
    mermaid.render.mockResolvedValue({
      isValid: true,
      svg: '<svg data-drawn="yes"></svg>',
    });
    render(single("mermaid", "graph TD\n A --> B"));
    await waitFor(() =>
      expect(document.querySelector("[data-drawn]")).not.toBeNull(),
    );
    expect(mermaid.render).toHaveBeenCalledWith("graph TD\n A --> B");
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("125 %")).toBeTruthy();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("shows the error and the code of a broken Mermaid diagram", async () => {
    mermaid.render.mockResolvedValue({
      isValid: false,
      message: "Parse error on line 2",
    });
    render(single("mermaid", "graph TD\n A -->"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Parse error on line 2");
    expect(document.querySelector("[data-code-lines]")?.textContent).toContain(
      "A -->",
    );
  });

  it("shows JSON as a tree with counts that opens and closes, and copies values", () => {
    render(
      single(
        "json",
        '{"name": "Ada", "tags": ["a", "b"], "deep": {"x": {"y": 1}}}',
      ),
    );
    const tree = screen.getByRole("tree", { name: "JSON tree" });
    expect(tree.textContent).toContain("3 entries");
    expect(tree.textContent).toContain('"Ada"');
    expect(tree.textContent).toContain("2 entries");
    // Deeper levels start closed.
    expect(tree.textContent).not.toContain("y: ");
    fireEvent.click(within(tree).getByRole("button", { name: /^x/u }));
    expect(tree.textContent).toContain("y: 1");
    fireEvent.click(
      within(tree).getAllByRole("button", { name: "Copy value" })[1],
    );
    expect(actions.copy).toHaveBeenCalledWith("Ada");
  });
});

describe("invalid JSON, CSV and TSV previews (PAGE-383)", () => {
  it("keeps invalid JSON as code with the place of the error", () => {
    render(single("json", '{\n  "a": 1,\n  "b": }'));
    expect(screen.queryByRole("tree")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(
      "Invalid JSON at line 3, column 8",
    );
    expect(document.querySelector("[data-code-lines]")?.textContent).toContain(
      '"b": }',
    );
  });

  it("shows CSV as a table with head, sorting, search and the recognized delimiter", () => {
    render(single("csv", "name;age\nAda;36\nEd;9\nMei;41"));
    const table = screen.getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["name", "age"]);
    expect(screen.getByText(/Delimiter: semicolon/u)).toBeTruthy();
    fireEvent.click(within(table).getByRole("button", { name: "age" }));
    const firstColumn = (): (string | null)[] =>
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.firstElementChild?.textContent ?? null);
    expect(firstColumn()).toEqual(["Ed", "Ada", "Mei"]);
    fireEvent.click(within(table).getByRole("button", { name: "age" }));
    expect(firstColumn()).toEqual(["Mei", "Ada", "Ed"]);
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search the table" }),
      { target: { value: "ad" } },
    );
    expect(firstColumn()).toEqual(["Ada"]);
  });

  it("reads TSV with the tab", () => {
    render(single("tsv", "a\tb\n1\t2"));
    expect(screen.getByText(/Delimiter: tab/u)).toBeTruthy();
  });
});

describe("code and Markdown cards (PAGE-383)", () => {
  it("marks a recognized language and makes Copy the main action", () => {
    render(
      wrap(
        <CodeCard
          cardKey="sql"
          isDetected
          languageHint="sql"
          name=""
          origin={origin}
          text={{ source: "SELECT 1 FROM t;" }}
        />,
      ),
    );
    const card = screen.getByRole("region", { name: "SQL" });
    expect(card.textContent).toContain("auto-detected: SQL · 1 line");
    expect(screen.getByRole("button", { name: "Copy" }).className).toContain(
      "bg-primary",
    );
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    expect(content.openOverlay).toHaveBeenCalled();
  });

  it("switches a Markdown card between view and source", () => {
    render(
      wrap(
        <MarkdownCard
          cardKey="md"
          isDetected
          name=""
          origin={origin}
          text={{ source: "# Title\n\n- one" }}
        />,
      ),
    );
    expect(
      screen.getByRole("region", { name: "Markdown" }).textContent,
    ).toContain("auto-detected: Markdown");
    expect(screen.getByRole("heading", { name: "Title" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Source" }));
    expect(screen.queryByRole("heading", { name: "Title" })).toBeNull();
    expect(document.querySelector("[data-code-lines]")?.textContent).toContain(
      "# Title",
    );
  });

  it("turns the blocks of one message into one HTML preview and the rest into their cards", () => {
    render(
      wrap(
        <MessageContentView
          message={{
            id: "m9",
            content:
              "```html\n<p>Hi</p>\n```\n```css\np{}\n```\n```\nSELECT a FROM b;\n```",
          }}
          origin={origin}
          renderText={(text) => <p>{text}</p>}
        />,
      ),
    );
    expect(screen.getByRole("region", { name: "HTML preview" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "SQL" }).textContent).toContain(
      "auto-detected: SQL",
    );
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
  });
});

describe("split view and full screen of a preview (PAGE-383)", () => {
  const descriptor = {
    kind: "preview" as const,
    name: "HTML preview",
    previewKind: "html" as const,
    files: HTML_FILES,
    isDetected: false,
  };

  it("shows title, sender and time, Preview | Code and the device widths next to the chat", () => {
    const onClose = vi.fn();
    const onFullscreen = vi.fn();
    render(
      wrap(
        <PreviewPanel
          cardKey="m1:0"
          descriptor={descriptor}
          onClose={onClose}
          onFullscreen={onFullscreen}
          origin={origin}
        />,
      ),
    );
    const panel = screen.getByRole("region", { name: "HTML preview" });
    expect(panel.textContent).toContain("HTML · Ada ·");
    expect(
      document
        .querySelector("[data-sandbox-device]")
        ?.getAttribute("data-sandbox-device"),
    ).toBe("desktop");
    fireEvent.click(screen.getByRole("tab", { name: "Mobile" }));
    expect(frame().className).toContain("w-[390px]");
    fireEvent.click(screen.getByRole("tab", { name: "Tablet" }));
    expect(frame().className).toContain("w-[768px]");
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    expect(onFullscreen).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("tab", { name: "Code" }));
    expect(screen.getByRole("tab", { name: "app.js" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("covers the page with preview, code or both, reacts to R, C and Escape and downloads", () => {
    const card: OpenedCard = { key: "m1:0", descriptor, origin };
    content.overlay = card;
    render(wrap(<CardOverlay />));
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("data-preview-fullscreen")).toBe("preview");
    expect(dialog.className).toContain("bg-viewer-scrim");
    const first = frame();
    fireEvent.keyDown(window, { key: "r" });
    expect(frame()).not.toBe(first);
    fireEvent.keyDown(window, { key: "c" });
    expect(dialog.getAttribute("data-preview-fullscreen")).toBe("both");
    expect(document.querySelector("iframe")).not.toBeNull();
    expect(document.querySelector("[data-code-lines]")).not.toBeNull();
    fireEvent.keyDown(window, { key: "C" });
    expect(dialog.getAttribute("data-preview-fullscreen")).toBe("preview");
    fireEvent.click(screen.getByRole("tab", { name: "Code" }));
    expect(document.querySelector("iframe")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "style.css" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(actions.copy).toHaveBeenCalledWith("button { color: red; }");
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(actions.download).toHaveBeenCalledWith(HTML_FILES);
    fireEvent.click(screen.getByRole("tab", { name: "Both" }));
    fireEvent.click(screen.getByRole("tab", { name: "Mobile" }));
    expect(frame().className).toContain("w-[390px]");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(content.closeOverlay).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Go to message" }));
    expect(content.closeOverlay).toHaveBeenCalledTimes(2);
  });
});
