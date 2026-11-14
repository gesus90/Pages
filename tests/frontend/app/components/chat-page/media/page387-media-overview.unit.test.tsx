import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatPageHeader } from "@/app/components/chat-page/chat-page-header";
import { CardOverlay } from "@/app/components/chat-page/content/card-panel";
import { ChatContentProvider } from "@/app/components/chat-page/content/chat-content-context";
import { SplitPanel } from "@/app/components/chat-page/content/split-panel";
import { readMediaOverview } from "@/app/components/chat-page/media/media-overview-api";
import { groupByMonth, mediaCardOf } from "@/app/components/chat-page/media/media-overview-model";
import { MediaOverviewOverlay, MediaOverviewPanel } from "@/app/components/chat-page/media/media-overview-panel";
import { useMessageReveal } from "@/app/components/chat-page/use-message-reveal";
import { createI18n } from "@/app/lib/i18n";

import { group, participant } from "../chat-page-fixture";

import type { ConversationAttachment } from "@/definition/ConversationContent";
import type { ConversationMediaFile, ConversationMediaOverview } from "@/definition/ConversationMediaOverview";

vi.mock("react-router", () => ({
  useFetcher: () => ({ data: undefined, state: "idle", submit: vi.fn() }),
  useRevalidator: () => ({ state: "idle", revalidate: vi.fn() }),
}));

class HiddenObserver {
  public observe(): void {}
  public unobserve(): void {}
  public disconnect(): void {}
}

const i18n = createI18n("en");
const NOW = Date.parse("2026-11-15T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function attachment(id: string, overrides: Partial<ConversationAttachment> = {}): ConversationAttachment {
  return {
    id,
    name: `${id}.png`,
    mimeType: "image/png",
    sizeBytes: 2048,
    kind: "image",
    url: `/chat/files/${id}`,
    thumbnailUrl: `/chat/files/${id}/thumbnail`,
    createdAt: "2026-11-15T08:00:00.000Z",
    ...overrides,
  };
}

function file(
  tab: ConversationMediaFile["tab"],
  item: ConversationAttachment,
  overrides: Partial<ConversationMediaFile> = {},
): ConversationMediaFile {
  return { tab, attachment: item, messageId: `m-${item.id}`, senderId: "igor", sentAt: "2026-11-15T08:00:00.000Z", ...overrides };
}

const OVERVIEW: ConversationMediaOverview = {
  conversationId: "g",
  files: [
    file("images", attachment("photo")),
    file("images", attachment("older"), { sentAt: "2026-10-02T08:00:00.000Z" }),
    file("videos", attachment("clip", { name: "clip.mp4", mimeType: "video/mp4", kind: "video", durationSeconds: 125 })),
    file(
      "documents",
      attachment("report", {
        name: "Bericht.pdf",
        mimeType: "application/pdf",
        kind: "pdf",
        thumbnailUrl: undefined,
        expiresAt: new Date(NOW + 5 * HOUR).toISOString(),
      }),
      { senderId: "ed" },
    ),
    file("documents", attachment("offer", { name: "Angebot.docx", mimeType: "application/octet-stream", kind: "file", thumbnailUrl: undefined })),
    file("documents", attachment("gone", { name: "Alt.pdf", mimeType: "application/pdf", kind: "pdf", expiredAt: "2026-11-14T08:00:00.000Z" }), { senderId: "ed" }),
    file("files", attachment("zip", { name: "build.zip", mimeType: "application/zip", kind: "file", thumbnailUrl: undefined })),
  ],
  links: [
    { url: "https://docs.example/a", domain: "docs.example", title: "Handbuch", imageUrl: null, messageId: "m-link", senderId: "ed", sentAt: "2026-11-15T09:00:00.000Z" },
  ],
  senders: [
    { id: "ed", name: "Ed", kind: "agent" },
    { id: "igor", name: "Igor", kind: "human" },
  ],
};

const fetchMock = vi.fn(async (url: string) => {
  if (url.startsWith("/chat/media/")) return new Response(JSON.stringify({ overview: OVERVIEW }), { status: 200 });
  return new Response("{}", { status: 404 });
});

function tab(name: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-media-tab="${name}"]`);
  if (!element) throw new Error(`no tab ${name}`);
  return element;
}

function renderPanel(onRevealMessage = vi.fn()): { onRevealMessage: ReturnType<typeof vi.fn> } {
  render(
    <I18nextProvider i18n={i18n}>
      <ChatContentProvider
        conversationId="g"
        conversationKey="group:g"
        directory={{ viewPreferences: { cardStates: {}, splitWidth: null } }}
        onRevealMessage={onRevealMessage}
      >
        <MediaOverviewPanel />
        <CardOverlay />
      </ChatContentProvider>
    </I18nextProvider>,
  );
  return { onRevealMessage };
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, shouldAdvanceTime: true });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("IntersectionObserver", HiddenObserver);
  fetchMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("reading and shaping the overview (PAGE-387)", () => {
  it("reads the answer of the server and leaves out entries of another shape", () => {
    const read = readMediaOverview({
      overview: { ...OVERVIEW, files: [...OVERVIEW.files, { tab: "nope" }, { tab: "files", attachment: {} }], links: [...OVERVIEW.links, { url: 3 }] },
    });
    expect(read?.files).toHaveLength(OVERVIEW.files.length);
    expect(read?.links).toHaveLength(1);
    expect(read?.senders).toEqual(OVERVIEW.senders);
    expect(readMediaOverview({})).toBeNull();
  });

  it("groups images by month, newest first", () => {
    const groups = groupByMonth(OVERVIEW.files.filter((entry) => entry.tab === "images"), "en");
    expect(groups.map((entry) => [entry.key, entry.label, entry.files.length])).toEqual([
      ["2026-11", "November 2026", 1],
      ["2026-10", "October 2026", 1],
    ]);
  });

  it("opens every kind in its view: PDF viewer, readable document, text, sound, plain file", () => {
    const kinds = [
      attachment("a", { name: "a.pdf", mimeType: "application/pdf", kind: "pdf" }),
      attachment("b", { name: "b.docx", mimeType: "application/octet-stream", kind: "file" }),
      attachment("c", { name: "c.txt", mimeType: "text/plain", kind: "file", sizeBytes: 10 }),
      attachment("d", { name: "d.md", mimeType: "text/markdown", kind: "file", sizeBytes: 10 }),
      attachment("e", { name: "e.mp3", mimeType: "audio/mpeg", kind: "audio" }),
      attachment("f", { name: "f.zip", mimeType: "application/zip", kind: "file" }),
    ].map((item) => mediaCardOf(file("documents", item), "Ed").descriptor.kind);
    expect(kinds).toEqual(["pdf", "word", "code", "markdown", "audio", "file"]);
    expect(mediaCardOf(file("documents", attachment("a")), "Ed").origin).toEqual({ senderName: "Ed", createdAt: "2026-11-15T08:00:00.000Z", messageId: "m-a" });
  });
});

describe("the panel Medien & Dateien (PAGE-387)", () => {
  it("shows every tab with its count and images as a grid by month", async () => {
    renderPanel();
    await waitFor(() => expect(tab("documents").textContent).toBe("Documents3"));
    expect(fetchMock).toHaveBeenCalledWith("/chat/media/g", expect.anything());
    expect(["images", "videos", "audio", "documents", "files", "links"].map((name) => tab(name).textContent)).toEqual([
      "Images2",
      "Videos1",
      "Audio0",
      "Documents3",
      "Files1",
      "Links1",
    ]);
    expect(screen.getByText("8 entries", { exact: false })).toBeTruthy();
    expect(document.querySelectorAll("[data-media-month]")).toHaveLength(2);
    fireEvent.click(tab("videos"));
    expect(document.querySelector("[data-media-length]")?.textContent).toBe("2:05");
  });

  it("searches by name and narrows the counts", async () => {
    renderPanel();
    await waitFor(() => expect(tab("documents").textContent).toBe("Documents3"));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "bericht" } });
    expect(tab("documents").textContent).toBe("Documents1");
    expect(tab("images").textContent).toBe("Images0");
    fireEvent.click(tab("documents"));
    expect(document.querySelectorAll("[data-media-row]")).toHaveLength(1);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "handbuch" } });
    expect(tab("links").textContent).toBe("Links1");
  });

  it("shows the remaining time of files of agents, filters below 24 hours and hides expired files", async () => {
    renderPanel();
    await waitFor(() => expect(tab("documents").textContent).toBe("Documents3"));
    fireEvent.click(tab("documents"));
    const report = document.querySelector<HTMLElement>('[data-media-row="report"]');
    expect(report?.textContent).toContain("5 hrs left");
    expect(document.querySelector('[data-media-row="gone"]')?.textContent).toContain("expired");
    fireEvent.click(screen.getByRole("button", { name: "Expiring soon" }));
    expect([...document.querySelectorAll<HTMLElement>("[data-media-row]")].map((row) => row.dataset.mediaRow)).toEqual(["report"]);
    fireEvent.click(screen.getByRole("button", { name: "Expiring soon" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide expired" }));
    expect(document.querySelector('[data-media-row="gone"]')).toBeNull();
  });

  it("downloads marked files of several tabs as one ZIP", async () => {
    renderPanel();
    await waitFor(() => expect(tab("documents").textContent).toBe("Documents3"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Mark photo.png" }));
    fireEvent.click(tab("documents"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Mark Bericht.pdf" }));
    expect((screen.getByRole("checkbox", { name: "Mark Alt.pdf" }) as HTMLInputElement).disabled).toBe(true);
    const zip = screen.getByRole("link", { name: "Download 2 files as ZIP" });
    expect(zip.getAttribute("href")).toBe("/chat/media/g/files.zip?ids=photo%2Creport");
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByRole("link", { name: /as ZIP/u })).toBeNull();
  });

  it("opens a document large in the panel, pages through the tab and goes to the message", async () => {
    const { onRevealMessage } = renderPanel();
    await waitFor(() => expect(tab("documents").textContent).toBe("Documents3"));
    fireEvent.click(tab("documents"));
    fireEvent.click(screen.getByRole("button", { name: "Bericht.pdf" }));
    const detail = document.querySelector<HTMLElement>("[data-media-detail]");
    expect(detail?.dataset.mediaDetail).toBe("report");
    expect(within(detail as HTMLElement).getByText("1 of 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next entry" }));
    expect(document.querySelector<HTMLElement>("[data-media-detail]")?.dataset.mediaDetail).toBe("offer");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(document.querySelector<HTMLElement>("[data-media-detail]")?.dataset.mediaDetail).toBe("report");
    fireEvent.click(within(document.querySelector("nav") as HTMLElement).getByRole("button", { name: "Go to message" }));
    expect(onRevealMessage).toHaveBeenCalledWith("m-report");
    fireEvent.click(screen.getByRole("button", { name: "Back to Documents" }));
    expect(document.querySelector("[data-media-detail]")).toBeNull();
  });

  it("opens an image in the image viewer and a video in its full screen; links open in a new tab", async () => {
    const { onRevealMessage } = renderPanel();
    await waitFor(() => expect(tab("images").textContent).toBe("Images2"));
    fireEvent.click(tab("links"));
    const link = screen.getByRole("link", { name: "Handbuch" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(within(document.querySelector("[data-media-link]") as HTMLElement).getByText("docs.example")).toBeTruthy();
    fireEvent.click(within(document.querySelector("[data-media-link]") as HTMLElement).getByRole("button", { name: "Go to message" }));
    expect(onRevealMessage).toHaveBeenCalledWith("m-link");
    fireEvent.click(tab("videos"));
    fireEvent.click(screen.getByRole("button", { name: "clip.mp4" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(tab("images"));
    fireEvent.click(screen.getByRole("button", { name: "photo.png" }));
    const viewer = await screen.findByRole("dialog");
    expect(within(viewer).getByText("1 / 2", { exact: false })).toBeTruthy();
  });
});

describe("the entry in the chat menu (PAGE-387)", () => {
  function renderHeader(width: number): void {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    const ed = participant("ed", { name: "Ed", username: "ed" });
    render(
      <I18nextProvider i18n={i18n}>
        <ChatContentProvider conversationId="g" conversationKey="group:g" directory={{ viewPreferences: { cardStates: {}, splitWidth: null } }}>
          <ChatPageHeader
            opened={{ kind: "group", group: group("g", { name: "Team", memberIds: ["ed"] }), members: [ed] }}
            participants={[ed]}
            isAnswering={false}
            onStop={vi.fn()}
            onAddMember={vi.fn()}
            isMuted={false}
            onToggleMute={vi.fn()}
          />
          <SplitPanel storedWidth={null} />
          <MediaOverviewOverlay />
        </ChatContentProvider>
      </I18nextProvider>,
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: "Group menu" }), { button: 0, ctrlKey: false });
  }

  it("is the first entry of the group menu, shows the count and opens the overview next to the chat", async () => {
    renderHeader(1920);
    const items = screen.getAllByRole("menuitem");
    expect(items[0]?.textContent).toMatch(/^Media & files/u);
    await waitFor(() => expect(items[0]?.textContent).toBe("Media & files8"));
    fireEvent.click(items[0] as HTMLElement);
    await waitFor(() => expect(document.querySelector("[data-media-overview]")).toBeTruthy());
    expect(screen.queryByRole("dialog", { name: "Media & files" })).toBeNull();
  });

  it("opens as full screen on a phone", async () => {
    renderHeader(600);
    fireEvent.click(screen.getAllByRole("menuitem")[0] as HTMLElement);
    expect(await screen.findByRole("dialog", { name: "Media & files" })).toBeTruthy();
  });

  it("offers the entry in the menu of a direct chat", async () => {
    const bob = participant("bob", { name: "Bob", kind: "human", username: "bob", conversationId: "g" });
    render(
      <I18nextProvider i18n={i18n}>
        <ChatPageHeader opened={{ kind: "participant", participant: bob }} participants={[bob]} isAnswering={false} onStop={vi.fn()} onAddMember={vi.fn()} isMuted={false} onToggleMute={vi.fn()} />
      </I18nextProvider>,
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: "Chat menu" }), { button: 0, ctrlKey: false });
    await waitFor(() => expect(screen.getAllByRole("menuitem")[0]?.textContent).toBe("Media & files8"));
  });
});

describe("going to a message (PAGE-387)", () => {
  it("loads older pages until the message is there, then scrolls to it", () => {
    const loadOlder = vi.fn();
    const { result, rerender } = renderHook((props: { count: number; isLoading: boolean }) =>
      useMessageReveal({ messageCount: props.count, hasOlder: true, isLoadingOlder: props.isLoading, loadOlder }),
      { initialProps: { count: 10, isLoading: false } },
    );
    act(() => result.current("m-old"));
    expect(loadOlder).toHaveBeenCalledTimes(1);
    rerender({ count: 10, isLoading: true });
    rerender({ count: 10, isLoading: false });
    expect(loadOlder).toHaveBeenCalledTimes(1);
    const element = document.createElement("article");
    element.dataset.chatMessage = "m-old";
    element.tabIndex = -1;
    element.scrollIntoView = vi.fn();
    document.body.append(element);
    rerender({ count: 30, isLoading: false });
    expect(element.scrollIntoView).toHaveBeenCalled();
    expect(document.activeElement).toBe(element);
    expect(loadOlder).toHaveBeenCalledTimes(1);
    element.remove();
  });
});
