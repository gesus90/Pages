import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AttachmentCards } from "@/app/components/chat-page/content/attachment-cards";
import {
  ChatContentProvider,
  useChatContent,
} from "@/app/components/chat-page/content/chat-content-context";
import {
  earliestExpiry,
  isAttachmentExpired,
  retentionLabel,
} from "@/app/components/chat-page/content/file-retention";
import { readChatImages } from "@/app/components/chat-page/content/use-chat-images";
import {
  activityOf,
  imageCount,
  isImageTool,
} from "@/app/components/chat-page/live/live-answer-state";
import { createI18n } from "@/app/lib/i18n";

import type {
  ConversationAttachment,
  ConversationImage,
} from "@/definition/ConversationContent";
import type { LiveAnswerView } from "@/app/components/chat-page/live/live-answer-state";

vi.mock("react-router", () => ({ useFetcher: () => ({ submit: vi.fn() }) }));

/** Previews load only when seen; jsdom has no observer, so nothing is ever seen. */
class HiddenObserver {
  public observe(): void {}
  public unobserve(): void {}
  public disconnect(): void {}
}

const HOUR = 60 * 60 * 1000;
const i18n = createI18n("de");

function image(
  id: string,
  overrides: Partial<ConversationAttachment> = {},
): ConversationAttachment {
  return {
    id,
    name: `${id}.png`,
    mimeType: "image/png",
    sizeBytes: 2048,
    kind: "image",
    url: `/chat/files/${id}`,
    thumbnailUrl: `/chat/files/${id}/thumbnail`,
    createdAt: "2026-11-14T10:00:00.000Z",
    ...overrides,
  };
}

function chatImage(
  attachment: ConversationAttachment,
  messageId: string,
  senderName: string,
): ConversationImage {
  return {
    attachment,
    messageId,
    senderId: `${senderName}-id`,
    senderName,
    sentAt: "2026-11-14T10:00:00.000Z",
  };
}

function Chat({
  attachments,
  messageId = "msg-2",
}: {
  readonly attachments: readonly ConversationAttachment[];
  readonly messageId?: string;
}): React.ReactElement {
  return (
    <I18nextProvider i18n={i18n}>
      <ChatContentProvider
        conversationId="conv-1"
        conversationKey="entry"
        directory={{ viewPreferences: { cardStates: {}, splitWidth: null } }}
      >
        <article data-chat-message="msg-1" tabIndex={-1}>
          erste Nachricht
        </article>
        <article data-chat-message={messageId} tabIndex={-1}>
          <AttachmentCards
            attachments={attachments}
            origin={{
              senderName: "Ed",
              createdAt: "2026-11-14T10:00:00.000Z",
              messageId,
            }}
          />
        </article>
        <BesideProbe />
      </ChatContentProvider>
    </I18nextProvider>
  );
}

function BesideProbe(): React.ReactElement {
  const content = useChatContent();
  return <output data-testid="beside">{content.beside?.key ?? ""}</output>;
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", HiddenObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The position, sender and time line of the viewer head. */
function position(dialog: HTMLElement): HTMLElement {
  const element = dialog.querySelector<HTMLElement>("[data-viewer-position]");
  if (!element) throw new Error("The viewer shows no position.");
  return element;
}

describe("remaining time of files of agents (PAGE-382)", () => {
  const t = i18n.t.bind(i18n);
  const now = Date.parse("2026-11-14T12:00:00.000Z");

  it("names days, then hours in the last day", () => {
    expect(retentionLabel(new Date(now + 50 * HOUR).toISOString(), now, t)).toBe(
      "noch 2 Tage",
    );
    expect(retentionLabel(new Date(now + 5.5 * HOUR).toISOString(), now, t)).toBe(
      "noch 5 Std.",
    );
    expect(retentionLabel(new Date(now + 10 * 60 * 1000).toISOString(), now, t)).toBe(
      "noch unter 1 Std.",
    );
  });

  it("names nothing for an upload of a person or an expired file", () => {
    expect(retentionLabel(undefined, now, t)).toBeNull();
    expect(retentionLabel(new Date(now - HOUR).toISOString(), now, t)).toBeNull();
  });

  it("knows an expired file by the server or by its moment", () => {
    expect(isAttachmentExpired({ expiredAt: "2026-11-14T11:00:00.000Z" }, now)).toBe(true);
    expect(isAttachmentExpired({ expiresAt: "2026-11-14T11:00:00.000Z" }, now)).toBe(true);
    expect(isAttachmentExpired({ expiresAt: "2026-11-15T11:00:00.000Z" }, now)).toBe(false);
    expect(isAttachmentExpired({}, now)).toBe(false);
    expect(
      earliestExpiry([
        { expiresAt: "2026-11-16T00:00:00.000Z" },
        {},
        { expiresAt: "2026-11-15T00:00:00.000Z" },
      ]),
    ).toBe("2026-11-15T00:00:00.000Z");
  });
});

describe("images of a message in the chat (PAGE-382)", () => {
  it("shows several images as a gallery of four previews with +N, downloads and a ZIP", () => {
    const images = ["a", "b", "c", "d", "e", "f"].map((id) =>
      image(id, { expiresAt: new Date(Date.now() + 30 * HOUR).toISOString() }),
    );
    render(<Chat attachments={images} />);
    const gallery = screen.getByRole("region", { name: "6 Bilder" });
    const tiles = within(gallery).getAllByRole("listitem");
    expect(tiles).toHaveLength(4);
    expect(tiles[3].textContent).toContain("+2");
    const all = within(gallery).getByRole("link", { name: "Alle herunterladen" });
    expect(all.getAttribute("href")).toBe("/chat/messages/msg-2/files.zip");
    expect(
      within(gallery)
        .getByRole("link", { name: "a.png herunterladen" })
        .getAttribute("href"),
    ).toBe("/chat/files/a?download=1");
    expect(gallery.textContent).toContain("noch 1 Tag");
    // Head order: download in the accent color first, then the quiet buttons.
    const head = gallery.querySelector("[data-card-head]");
    const labels = [...(head as HTMLElement).querySelectorAll("a, button")]
      .map((element) => element.getAttribute("title") ?? element.textContent);
    expect(labels).toEqual(["Alle herunterladen", "Vollbild", "Zuklappen"]);
    expect(all.className).toContain("bg-primary");
  });

  it("shows one image as its card with Herunterladen, Daneben and Vollbild", () => {
    render(<Chat attachments={[image("only")]} />);
    const card = screen.getByRole("region", { name: "only.png" });
    const head = card.querySelector("[data-card-head]") as HTMLElement;
    const labels = [...head.querySelectorAll("a, button")]
      .map((element) => element.getAttribute("title") ?? element.textContent);
    expect(labels).toEqual(["Herunterladen", "Daneben", "Vollbild", "Zuklappen"]);
  });

  it("puts a calm placeholder with name and date where an expired file was", () => {
    render(
      <Chat
        attachments={[
          image("old", { expiredAt: "2026-11-14T13:00:00.000Z" }),
          {
            ...image("bericht"),
            name: "bericht.zip",
            kind: "file",
            mimeType: "application/zip",
            expiredAt: "2026-11-14T13:00:00.000Z",
          },
        ]}
      />,
    );
    const placeholders = document.querySelectorAll("[data-attachment-expired]");
    expect(placeholders).toHaveLength(2);
    expect(placeholders[1].textContent).toContain("bericht.zip");
    expect(placeholders[1].textContent).toContain("abgelaufen · erzeugt am");
    expect(screen.queryByRole("link", { name: /herunterladen/iu })).toBeNull();
  });
});

describe("the image viewer of the chat (PAGE-382)", () => {
  const older = image("older");
  const first = image("first", { expiresAt: new Date(Date.now() + 30 * HOUR).toISOString() });
  const second = image("second");
  const gone = image("gone", { expiredAt: "2026-11-14T11:00:00.000Z" });

  function stubImages(images: readonly ConversationImage[]): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ images }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("opens at the clicked image and pages with the arrow keys through all images of the chat", async () => {
    const fetchMock = stubImages([
      chatImage(older, "msg-1", "Igor"),
      chatImage(first, "msg-2", "Ed"),
      chatImage(second, "msg-2", "Ed"),
      chatImage(gone, "msg-3", "Mei"),
    ]);
    render(<Chat attachments={[first, second]} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Vollbild: first.png/u })[0] as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    expect(fetchMock).toHaveBeenCalledWith("/chat/images/conv-1", expect.anything());
    await waitFor(() => expect(position(dialog).textContent).toContain("2 / 4"));
    expect(position(dialog).textContent).toContain("Ed");
    expect(position(dialog).textContent).toContain("noch 1 Tag");
    expect(within(dialog).getByRole("link", { name: "Herunterladen" }).getAttribute("href")).toBe("/chat/files/first?download=1",
    );
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect(position(dialog).textContent).toContain("1 / 4");
    expect(position(dialog).textContent).toContain("Igor");
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    // The expired image is reported in its place; paging stays possible.
    expect(position(dialog).textContent).toContain("4 / 4");
    expect(within(dialog).getByRole("alert").textContent).toContain("abgelaufen · erzeugt am");
    expect(within(dialog).queryByRole("link", { name: "Herunterladen" })).toBeNull();
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect(position(dialog).textContent).toContain("3 / 4");
    // The strip below lists every image of the chat.
    expect(
      within(within(dialog).getByRole("navigation")).getAllByRole("button"),
    ).toHaveLength(4);
  });

  it("closes with Escape and hands the focus back to the message", async () => {
    stubImages([chatImage(first, "msg-2", "Ed"), chatImage(second, "msg-2", "Ed")]);
    render(<Chat attachments={[first, second]} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Vollbild: second.png/u })[0] as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.keyDown(dialog, { key: "Escape" });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(document.querySelector('[data-chat-message="msg-2"]')),
    );
  });

  it("opens the shown image next to the chat with Daneben", async () => {
    // Below 1100 px "Daneben" opens as full screen instead.
    vi.stubGlobal("innerWidth", 1600);
    stubImages([chatImage(first, "msg-2", "Ed"), chatImage(second, "msg-2", "Ed")]);
    render(<Chat attachments={[first, second]} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Vollbild: first.png/u })[0] as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Daneben" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByTestId("beside").textContent).toContain("att:first");
  });

  it("keeps the images of the message when the list of the chat cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    render(<Chat attachments={[first, second]} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Vollbild: second.png/u })[0] as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(position(dialog).textContent).toContain("2 / 2"));
  });

  it("reads only well-formed images from the server", () => {
    expect(
      readChatImages({
        images: [chatImage(first, "msg-2", "Ed"), { attachment: { id: 3 } }, null],
      }),
    ).toHaveLength(1);
    expect(readChatImages(null)).toEqual([]);
  });
});

describe("the hint while an agent generates images (PAGE-382)", () => {
  const view = (input: string): LiveAnswerView => ({
    answerId: "a",
    chatKind: "conversation",
    chatId: "c",
    agentId: "ed",
    seq: 1,
    startedAt: "2026-11-14T12:00:00.000Z",
    lastAt: "2026-11-14T12:00:01.000Z",
    text: "",
    thought: null,
    tools: [
      {
        callId: "1",
        name: "mcp__pages__bilder_erzeugen",
        status: "running",
        input,
        startedAt: "2026-11-14T12:00:00.000Z",
      },
    ],
    end: null,
  }) as LiveAnswerView;

  it("names how many images the agent generates", () => {
    expect(activityOf(view('{"beschreibung":"Fuchs","anzahl":4}'))).toEqual({
      kind: "images",
      count: 4,
    });
    expect(imageCount({ input: "{}" })).toBe(1);
    expect(isImageTool({ name: "bilder_erzeugen" })).toBe(true);
    expect(isImageTool({ name: "read_file" })).toBe(false);
    expect(i18n.t("chatPage.liveAnswer.activity.images", { name: "Ed", count: 4 })).toBe(
      "Ed erzeugt 4 Bilder …",
    );
  });
});
