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

import { AttachmentCards } from "@/app/components/chat-page/content/attachment-cards";
import {
  BINARY_ROW_COLUMNS,
  fileEndingOf,
  shortChecksum,
} from "@/app/components/chat-page/content/binary-file-row";
import { CardOverlay } from "@/app/components/chat-page/content/card-panel";
import { ChatContentProvider } from "@/app/components/chat-page/content/chat-content-context";
import { resetDocumentReadings } from "@/app/components/chat-page/content/documents/use-document";
import { MessageContentView } from "@/app/components/chat-page/content/message-content-view";
import {
  documentFactsQuery,
  rememberPdfFacts,
  resetPdfFacts,
} from "@/app/components/chat-page/content/pdf-facts";
import { SplitPanel } from "@/app/components/chat-page/content/split-panel";
import { createI18n } from "@/app/lib/i18n";

import { docxFixture, pptxFixture, xlsxFixture } from "./zip-fixture";

import type { ConversationAttachment } from "@/definition/ConversationContent";

vi.mock("react-router", () => ({ useFetcher: () => ({ submit: vi.fn() }) }));

class HiddenObserver {
  /** No-op intersection observe stub. */
  public observe(): void {}
  /** No-op intersection unobserve stub. */
  public unobserve(): void {}
  /** No-op intersection disconnect stub. */
  public disconnect(): void {}
}

const i18n = createI18n("de");
const SHA = "3f2a9c1d00112233445566778899aabbccddeeff00112233445566778899c1d9";

function file(
  id: string,
  name: string,
  overrides: Partial<ConversationAttachment> = {},
): ConversationAttachment {
  return {
    id,
    name,
    mimeType: "application/octet-stream",
    sizeBytes: 4096,
    kind: "file",
    url: `/chat/files/${id}`,
    createdAt: "2026-11-14T10:00:00.000Z",
    ...overrides,
  };
}

const FILES: Readonly<Record<string, Uint8Array>> = {
  "/chat/files/doc": docxFixture(),
  "/chat/files/deck": pptxFixture(),
  "/chat/files/book": xlsxFixture(),
  "/chat/files/csv": new TextEncoder().encode(
    "Monat;Betrag\nJan;10\nFeb;2,5\nMär;30\n",
  ),
};

function Chat({
  attachments,
}: {
  readonly attachments: readonly ConversationAttachment[];
}): React.ReactElement {
  return (
    <I18nextProvider i18n={i18n}>
      <ChatContentProvider
        conversationId="conv-1"
        conversationKey="entry"
        directory={{ viewPreferences: { cardStates: {}, splitWidth: null } }}
      >
        <div className="flex">
          <article data-chat-message="msg-1">
            <AttachmentCards
              attachments={attachments}
              origin={{ senderName: "Ed", messageId: "msg-1" }}
            />
          </article>
          <SplitPanel storedWidth={null} />
        </div>
        <CardOverlay />
      </ChatContentProvider>
    </I18nextProvider>
  );
}

function cardOf(container: HTMLElement, id: string): HTMLElement {
  const card = container.querySelector(`[data-content-card='att:${id}']`);
  if (!(card instanceof HTMLElement)) throw new Error(`card ${id} missing`);
  return card;
}

/** The accessible names of the actions in the head of a card, in order, the line as "|". */
function headActions(card: HTMLElement): string[] {
  const actions = card.querySelector("header > div:last-child");
  return [...(actions?.children ?? [])].map((element) =>
    element.getAttribute("aria-hidden") === "true"
      ? "|"
      : (
          element.getAttribute("aria-label") ??
          element.textContent ??
          ""
        ).trim(),
  );
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", HiddenObserver);
  vi.stubGlobal("innerWidth", 1920);
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const bytes = FILES[url];
      return Promise.resolve(
        bytes
          ? new Response(bytes.slice())
          : new Response(null, { status: 404 }),
      );
    }),
  );
  URL.createObjectURL = vi.fn(() => "blob:image");
  URL.revokeObjectURL = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(() => Promise.resolve()) },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetDocumentReadings();
  resetPdfFacts();
});

describe("PDF in the chat (PAGE-385)", () => {
  it("shows a small preview of the first page with title, page count and Öffnen, and opens the dark viewer", async () => {
    const pdf = file("p1", "q3.pdf", {
      kind: "pdf",
      mimeType: "application/pdf",
      thumbnailUrl: "/chat/files/p1/thumbnail",
      pageCount: 12,
      documentTitle: "Quartalsbericht Q3",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    const { container } = render(<Chat attachments={[pdf]} />);
    const card = cardOf(container, "p1");
    expect(card.dataset.cardState).toBe("expanded");
    expect(card.querySelector("[data-pdf-title]")?.textContent).toBe(
      "Quartalsbericht Q3",
    );
    expect(within(card).getAllByText("12 Seiten").length).toBeGreaterThan(0);
    expect(card.querySelector("img")?.getAttribute("src")).toBe(
      "/chat/files/p1/thumbnail",
    );
    expect(card.querySelector("img")?.closest("button")?.className).toContain(
      "w-28",
    );
    expect(headActions(card)).toEqual([
      "Herunterladen",
      "|",
      "Daneben",
      "Vollbild",
      "Zuklappen",
    ]);
    // The original loads only when it is opened.
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByRole("button", { name: "Öffnen" }));
    const viewer = await screen.findByRole("dialog");
    expect(viewer.dataset.documentViewer).toBe("pdf");
    expect(viewer.className).toContain("bg-viewer-scrim");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("names an encrypted PDF and keeps it downloadable", () => {
    rememberPdfFacts("p2", { isEncrypted: true });
    const { container } = render(
      <Chat
        attachments={[
          file("p2", "geheim.pdf", {
            kind: "pdf",
            mimeType: "application/pdf",
          }),
        ]}
      />,
    );
    const card = cardOf(container, "p2");
    expect(within(card).getByRole("note").textContent).toContain(
      "verschlüsselt",
    );
    expect(
      within(card)
        .getByRole("link", { name: "Herunterladen" })
        .getAttribute("href"),
    ).toBe("/chat/files/p2?download=1");
  });

  it("sends page count and title with the preview", () => {
    expect(documentFactsQuery({ pageCount: 12, title: "Bericht & Plan" })).toBe(
      "&pageCount=12&title=Bericht+%26+Plan",
    );
    expect(documentFactsQuery({ isEncrypted: true })).toBe("");
  });
});

describe("Word, PowerPoint and tables in the chat (PAGE-385)", () => {
  it("shows the start of a .docx in the Pages design and opens the whole document next to the chat", async () => {
    const { container } = render(
      <Chat attachments={[file("doc", "Bericht.docx")]} />,
    );
    const card = cardOf(container, "doc");
    expect(await within(card).findByText("Quartalsbericht")).toBeTruthy();
    expect(within(card).getByText("deutlich").className).toContain(
      "font-semibold",
    );
    expect(
      within(card).getByText(/Word-Dokument · 3 Seiten · 4 KB/u),
    ).toBeTruthy();
    expect(within(card).getByText("Seite 1 von 3")).toBeTruthy();
    expect(card.querySelector("table")).not.toBeNull();
    await waitFor(() =>
      expect(card.querySelector("img")?.getAttribute("src")).toBe("blob:image"),
    );
    expect(headActions(card)).toEqual([
      "Herunterladen",
      "|",
      "Daneben",
      "Vollbild",
      "Zuklappen",
    ]);
    fireEvent.click(
      within(card).getByRole("button", { name: "Ganzes Dokument öffnen" }),
    );
    const panel = await waitFor(() => {
      const element = container.querySelector("[data-word-panel]");
      if (!(element instanceof HTMLElement)) throw new Error("panel missing");
      return element;
    });
    const contents = within(panel).getByRole("navigation", { name: "Inhalt" });
    expect(
      within(contents)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Quartalsbericht", "Ausblick"]);
    fireEvent.change(within(panel).getByRole("searchbox"), {
      target: { value: "umsatz" },
    });
    expect(within(panel).getByText("1 von 2")).toBeTruthy();
    expect(panel.querySelectorAll("[data-search-match]").length).toBe(2);
    // The card and the panel share one download of the original.
    expect(
      vi.mocked(fetch).mock.calls.filter(([url]) => url === "/chat/files/doc"),
    ).toHaveLength(1);
  });

  it("never loads pictures outside a document and offers its links without following them", async () => {
    const { container } = render(
      <Chat attachments={[file("doc", "Bericht.docx")]} />,
    );
    const card = cardOf(container, "doc");
    await within(card).findByText("Quartalsbericht");
    fireEvent.click(within(card).getByRole("button", { name: "Vollbild" }));
    const viewer = await screen.findByRole("dialog");
    await within(viewer).findByText("Webseite");
    const sources = [...document.querySelectorAll("img")].map((image) =>
      image.getAttribute("src"),
    );
    expect(sources.every((source) => source === "blob:image")).toBe(true);
    const link = within(viewer).getByText("Webseite").closest("a");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(
      within(viewer).getByText("Eingebettetes Objekt – wird nicht ausgeführt"),
    ).toBeTruthy();
    expect(document.querySelector("script, iframe, object, embed")).toBeNull();
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).not.toContain(
      "https://tracker.example/pixel.png",
    );
  });

  it("turns the slides of a .pptx in the card and with the arrow keys in the full screen", async () => {
    const { container } = render(
      <Chat attachments={[file("deck", "Pitch.pptx")]} />,
    );
    const card = cardOf(container, "deck");
    expect(await within(card).findByText("Willkommen")).toBeTruthy();
    expect(within(card).getByText("Folie 1 von 2")).toBeTruthy();
    expect(within(card).getByText(/PowerPoint · 2 Folien/u)).toBeTruthy();
    fireEvent.click(
      within(card).getByRole("button", { name: "Nächste Folie" }),
    );
    expect(within(card).getByText("Zahlen")).toBeTruthy();
    expect(within(card).getByText("Folie 2 von 2")).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "Vollbild" }));
    const viewer = await screen.findByRole("dialog");
    await within(viewer).findByText("Folie 1 von 2");
    act(() => {
      fireEvent.keyDown(window, { key: "ArrowRight" });
    });
    expect(within(viewer).getByText("Folie 2 von 2")).toBeTruthy();
    const strip = within(viewer).getByRole("navigation", { name: "Folien" });
    expect(
      within(strip)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["1Willkommen", "2Zahlen"]);
  });

  it("shows a workbook as a table with sheet tabs, row numbers, column letters and right-aligned numbers", async () => {
    const { container } = render(
      <Chat attachments={[file("book", "Umsatz.xlsx")]} />,
    );
    const card = cardOf(container, "book");
    const tabs = await within(card).findByRole("tablist", { name: "Blätter" });
    expect(
      within(tabs)
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["Umsatz", "Kosten"]);
    const table = card.querySelector("[data-sheet-table]");
    if (!(table instanceof HTMLElement)) throw new Error("table missing");
    expect(
      [...table.querySelectorAll("thead th")].map((cell) => cell.textContent),
    ).toEqual(["", "ARegion", "BUmsatz", "CDatum", "DAnteil"]);
    expect(
      [...table.querySelectorAll("tbody th")].map((cell) => cell.textContent),
    ).toEqual(["2", "3", "4"]);
    expect(within(table).getAllByText("1200.5")[0]?.className).toContain(
      "text-right",
    );
    expect(within(card).getByText("3 von 3 Zeilen")).toBeTruthy();
    fireEvent.click(within(tabs).getByRole("tab", { name: "Kosten" }));
    expect(within(card).getByText("7")).toBeTruthy();
  });

  it("opens the whole table with search, sorting, a fixed head and the sum of marked cells", async () => {
    const { container } = render(
      <Chat
        attachments={[file("csv", "monate.csv", { mimeType: "text/csv" })]}
      />,
    );
    const card = cardOf(container, "csv");
    fireEvent.click(
      await within(card).findByRole("button", { name: "Ganze Tabelle öffnen" }),
    );
    const panel = await waitFor(() => {
      const element = container.querySelector("[data-sheet-panel]");
      if (!(element instanceof HTMLElement)) throw new Error("panel missing");
      return element;
    });
    expect(within(panel).getByText("Trennzeichen: Semikolon")).toBeTruthy();
    expect(panel.querySelector("thead th:nth-child(2)")?.className).toContain(
      "sticky",
    );
    fireEvent.click(
      within(panel).getByRole("button", { name: "Nach Betrag sortieren" }),
    );
    const firstColumn = (): string[] =>
      [...panel.querySelectorAll("tbody tr td:first-of-type")].map(
        (cell) => cell.textContent ?? "",
      );
    expect(firstColumn()).toEqual(["Feb", "Jan", "Mär"]);
    fireEvent.click(
      within(panel).getByRole("button", { name: "Nach Betrag sortieren" }),
    );
    expect(firstColumn()).toEqual(["Mär", "Jan", "Feb"]);
    const amounts = [...panel.querySelectorAll("tbody tr td:nth-of-type(2)")];
    fireEvent.mouseDown(amounts[0] ?? panel);
    fireEvent.mouseDown(amounts[2] ?? panel, { shiftKey: true });
    expect(panel.querySelector("[data-sheet-summary]")?.textContent).toBe(
      "Summe 42,5 · 3 Zellen · 3 Zahlen · Mittelwert 14,166667",
    );
    fireEvent.change(within(panel).getByRole("searchbox"), {
      target: { value: "jan" },
    });
    expect(firstColumn()).toEqual(["Jan"]);
  });
});

describe("binary files and documents above the limit (PAGE-385)", () => {
  it("shows binary files as aligned rows with checksum and download, without any preview", () => {
    const files = [
      file("z", "backup.tar.gz", { sha256: SHA }),
      file("e", "setup.exe", {
        sha256: SHA,
        expiresAt: "2099-01-01T00:00:00.000Z",
      }),
      file("d", "alt.doc"),
    ];
    const { container } = render(<Chat attachments={files} />);
    const rows = [...container.querySelectorAll("[data-binary-file]")];
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.className).toContain(BINARY_ROW_COLUMNS);
      expect(
        within(row as HTMLElement).queryByRole("button", { name: "Daneben" }),
      ).toBeNull();
      expect(
        within(row as HTMLElement).queryByRole("button", { name: "Vollbild" }),
      ).toBeNull();
      expect(row.querySelector("img")).toBeNull();
      expect(
        within(row as HTMLElement).getByRole("link", { name: "Herunterladen" })
          .className,
      ).toContain("bg-primary");
    }
    expect(
      within(rows[0] as HTMLElement).getByText(/TAR\.GZ · 4 KB/u),
    ).toBeTruthy();
    expect(
      within(rows[0] as HTMLElement).getByText(shortChecksum(SHA)),
    ).toBeTruthy();
    fireEvent.click(
      within(rows[0] as HTMLElement).getByRole("button", {
        name: "SHA-256-Prüfsumme kopieren",
      }),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(SHA);
    expect(
      within(rows[2] as HTMLElement).getByText("Keine Prüfsumme"),
    ).toBeTruthy();
    expect(container.querySelector("[data-content-card]")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("offers a document above 32 MB for download only, with a hint", () => {
    const { container } = render(
      <Chat
        attachments={[
          file("big", "riesig.xlsx", { sizeBytes: 40 * 1024 * 1024 }),
        ]}
      />,
    );
    const row = container.querySelector("[data-binary-file='big']");
    expect(row?.textContent).toContain("Zu groß für die Vorschau");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("names file kinds by their endings", () => {
    expect(fileEndingOf("backup.tar.gz")).toBe("TAR.GZ");
    expect(fileEndingOf("daten.sqlite")).toBe("SQLITE");
    expect(fileEndingOf("README")).toBe("");
  });
});

describe("72 hours, text files and the same view for people and agents (PAGE-385)", () => {
  it("shows the remaining time of an agent's document and a placeholder once it expired", () => {
    const now = Date.now();
    const { container } = render(
      <Chat
        attachments={[
          file("live", "plan.docx", {
            expiresAt: new Date(now + 26 * 60 * 60 * 1000).toISOString(),
          }),
          file("gone", "alt.xlsx", {
            expiresAt: "2026-11-01T00:00:00.000Z",
            expiredAt: "2026-11-01T00:00:00.000Z",
          }),
        ]}
      />,
    );
    expect(within(cardOf(container, "live")).getByText(/noch/u)).toBeTruthy();
    expect(
      container.querySelector("[data-content-card='att:gone']"),
    ).toBeNull();
    expect(container.textContent).toContain("alt.xlsx");
    expect(container.textContent).toMatch(/abgelaufen/u);
  });

  it("shows a .txt or .log as a text card and a .csv as a table", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <ChatContentProvider
          conversationId="conv-1"
          conversationKey="entry"
          directory={{ viewPreferences: { cardStates: {}, splitWidth: null } }}
        >
          <MessageContentView
            message={{
              id: "m1",
              content: "",
              attachments: [
                file("t", "notes.txt", { mimeType: "text/plain" }),
                file("l", "server.log"),
                file("c", "a.csv"),
              ],
            }}
            origin={{ senderName: "Igor" }}
            renderText={(text) => text}
          />
        </ChatContentProvider>
      </I18nextProvider>,
    );
    const textCard = document.querySelector("[data-content-card='att:t']");
    expect(textCard?.textContent).toContain("Text");
    expect(
      document.querySelector("[data-content-card='att:l']"),
    ).not.toBeNull();
    expect(
      document.querySelector("[data-content-card='att:c']")?.textContent,
    ).toContain("CSV-Tabelle");
  });
});
