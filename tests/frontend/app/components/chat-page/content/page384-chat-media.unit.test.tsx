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
  AUDIO_ROW_COLUMNS,
  AudioCard,
} from "@/app/components/chat-page/content/audio-player";
import { CardOverlay } from "@/app/components/chat-page/content/card-panel";
import { ChatContentProvider } from "@/app/components/chat-page/content/chat-content-context";
import {
  formatResolution,
  resetMediaFacts,
} from "@/app/components/chat-page/content/media-facts";
import {
  claimPlayback,
  positionOf,
  registerMedia,
  resetMediaSession,
  savePosition,
  takeOver,
  unregisterMedia,
} from "@/app/components/chat-page/content/media-session";
import { SplitPanel } from "@/app/components/chat-page/content/split-panel";
import { formatFixedMediaTime } from "@/app/components/chat-page/content/use-media-player";
import { readChatMedia } from "@/app/components/chat-page/content/use-chat-images";
import {
  VIEWER_CONTROLS_IDLE_MILLISECONDS,
  viewerKeyAction,
} from "@/app/components/chat-page/content/use-video-viewer-keys";
import {
  activityOf,
  mediaToolKind,
} from "@/app/components/chat-page/live/live-answer-state";
import { createI18n } from "@/app/lib/i18n";

import type {
  ConversationAttachment,
  ConversationImage,
} from "@/definition/ConversationContent";
import type { LiveAnswerView } from "@/app/components/chat-page/live/live-answer-state";

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

function video(
  id: string,
  overrides: Partial<ConversationAttachment> = {},
): ConversationAttachment {
  return {
    id,
    name: `${id}.mp4`,
    mimeType: "video/mp4",
    sizeBytes: 2048,
    kind: "video",
    url: `/chat/files/${id}`,
    thumbnailUrl: `/chat/files/${id}/thumbnail`,
    createdAt: "2026-11-14T10:00:00.000Z",
    width: 1920,
    height: 1080,
    durationSeconds: 112,
    ...overrides,
  };
}

function sound(id: string, name: string): ConversationAttachment {
  return {
    id,
    name,
    mimeType: "audio/wav",
    sizeBytes: 4096,
    kind: "audio",
    url: `/chat/files/${id}`,
    createdAt: "2026-11-14T10:00:00.000Z",
    expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

function entry(
  attachment: ConversationAttachment,
  messageId: string,
): ConversationImage {
  return {
    attachment,
    messageId,
    senderId: "ed",
    senderName: "Ed",
    sentAt: "2026-11-14T10:00:00.000Z",
  };
}

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
          <article data-chat-message="msg-1" tabIndex={-1}>
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

const VIDEOS = [
  video("v1"),
  video("v2", { durationSeconds: 8, width: 720, height: 1280 }),
  video("v3"),
];

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", HiddenObserver);
  vi.stubGlobal("innerWidth", 1920);
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(
        url.startsWith("/chat/videos/")
          ? Response.json({
              videos: VIDEOS.map((attachment, index) =>
                entry(attachment, `msg-${String(index + 1)}`),
              ),
            })
          : new Response(null, { status: 404 }),
      ),
    ),
  );
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function play(
    this: HTMLMediaElement,
  ) {
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(
    function pause(this: HTMLMediaElement) {
      this.dispatchEvent(new Event("pause"));
    },
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetMediaSession();
  resetMediaFacts();
});

describe("the video card (PAGE-384)", () => {
  it("shows the preview with a play button, resolution and length, and loads the original only on start", () => {
    const { container } = render(<Chat attachments={[video("v1")]} />);
    const element = container.querySelector("video");
    expect(element?.getAttribute("preload")).toBe("none");
    expect(element?.getAttribute("poster")).toBe("/chat/files/v1/thumbnail");
    expect(
      container.querySelector("[data-video-resolution]")?.textContent,
    ).toBe("1080p");
    expect(container.querySelector("[data-video-duration]")?.textContent).toBe(
      "1:52",
    );
    const card = container.querySelector("[data-content-card='att:v1']");
    if (!(card instanceof HTMLElement)) throw new Error("card missing");
    expect(within(card).getByText(/Video · 1:52 · 1080p · 2 KB/u)).toBeTruthy();
    // Head: Herunterladen (accent), line, Daneben, Vollbild, Zuklappen in this order.
    const head = card.querySelector("header");
    const actions = [...(head?.querySelectorAll("a, button") ?? [])].map(
      (action) => action.getAttribute("title") ?? action.textContent,
    );
    expect(actions).toEqual([
      "Herunterladen",
      "Daneben",
      "Vollbild",
      "Zuklappen",
    ]);
    expect(head?.querySelector("a")?.className).toContain("bg-primary");
    expect(screen.queryByRole("slider")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "v1.mp4 abspielen" }));
    expect(screen.getByRole("slider")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ton aus" })).toBeTruthy();
  });

  it("opens beside, keeps the chat, offers the other videos and plays on where the card was", async () => {
    const { container } = render(<Chat attachments={[video("v1")]} />);
    fireEvent.click(screen.getByRole("button", { name: "v1.mp4 abspielen" }));
    const cardVideo = container.querySelector(
      "[data-video-player='v1'] video",
    ) as HTMLVideoElement;
    cardVideo.currentTime = 42;
    fireEvent.timeUpdate(cardVideo);
    fireEvent.click(screen.getByRole("button", { name: "Daneben" }));
    const panel = await waitFor(() => {
      const found = container.querySelector("[data-video-panel='v1']");
      if (!found) throw new Error("panel missing");
      return found as HTMLElement;
    });
    // The chat stays: the card is still there.
    expect(
      container.querySelector("[data-content-card='att:v1']"),
    ).not.toBeNull();
    const panelVideo = panel.querySelector("video") as HTMLVideoElement;
    expect(panelVideo.currentTime).toBe(42);
    // The split view took the playing video over: the card paused, the panel plays.
    const pause = HTMLMediaElement.prototype.pause as unknown as {
      mock: { contexts: unknown[] };
    };
    const play = HTMLMediaElement.prototype.play as unknown as {
      mock: { contexts: unknown[] };
    };
    expect(pause.mock.contexts).toContain(cardVideo);
    expect(play.mock.contexts.at(-1)).toBe(panelVideo);
    const others = await waitFor(() =>
      within(panel).getByRole("navigation", {
        name: "Weitere Videos in diesem Chat",
      }),
    );
    expect(
      within(others)
        .getAllByRole("button")
        .map((button) => button.getAttribute("data-video-tile")),
    ).toEqual(["v2", "v3"]);
    fireEvent.click(
      within(others).getByRole("button", { name: "v2.mp4 daneben öffnen" }),
    );
    await waitFor(() =>
      expect(container.querySelector("[data-video-panel='v2']")).not.toBeNull(),
    );
    // The head of the split view lights its "Daneben" as the active view.
    expect(
      screen.getAllByRole("button", { name: "Rechts geöffnet" }).length,
    ).toBeGreaterThan(0);
  });
});

describe("the video card fullscreen viewer (PAGE-384)", () => {
  it("pages through the videos of the chat in full screen with the keys and hides the controls", async () => {
    const { container } = render(<Chat attachments={[video("v1")]} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Vollbild" })[0]);
    const dialog = await screen.findByRole("dialog", {
      name: "Video im Vollbild",
    });
    await waitFor(() =>
      expect(within(dialog).getByRole("status").textContent).toContain("1 / 3"),
    );
    fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true });
    await waitFor(() =>
      expect(within(dialog).getByRole("status").textContent).toContain("2 / 3"),
    );
    expect(container.querySelector("[data-video-viewer='v2']")).not.toBeNull();
    fireEvent.keyDown(window, { key: "ArrowLeft", shiftKey: true });
    await waitFor(() =>
      expect(
        container.querySelector("[data-video-viewer='v1']"),
      ).not.toBeNull(),
    );
    const stageVideo = container.querySelector(
      "[data-video-viewer='v1'] video",
    ) as HTMLVideoElement;
    Object.defineProperty(stageVideo, "duration", {
      configurable: true,
      value: 112,
    });
    fireEvent.durationChange(stageVideo);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(stageVideo.currentTime).toBe(5);
    fireEvent.keyDown(window, { key: "m" });
    expect(stageVideo.muted).toBe(true);
    vi.useFakeTimers();
    fireEvent.keyDown(window, { key: " " });
    expect(
      container
        .querySelector("[data-controls-visible]")
        ?.getAttribute("data-controls-visible"),
    ).toBe("true");
    act(() => {
      vi.advanceTimersByTime(VIEWER_CONTROLS_IDLE_MILLISECONDS + 10);
    });
    expect(
      container
        .querySelector("[data-controls-visible]")
        ?.getAttribute("data-controls-visible"),
    ).toBe("false");
    fireEvent.pointerMove(
      container.querySelector("[data-video-viewer]") as HTMLElement,
    );
    expect(
      container
        .querySelector("[data-controls-visible]")
        ?.getAttribute("data-controls-visible"),
    ).toBe("true");
    vi.useRealTimers();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Video im Vollbild" }),
      ).toBeNull(),
    );
  });
});

describe("one playback across card, split view and full screen (PAGE-384)", () => {
  function element(): HTMLMediaElement {
    const media = document.createElement("video");
    document.body.append(media);
    return media;
  }

  it("pauses every other medium when one starts", () => {
    const first = element();
    const second = element();
    const a = registerMedia("a", () => first);
    const b = registerMedia("b", () => second);
    claimPlayback(a);
    claimPlayback(b);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
    expect(a.isPlaying).toBe(false);
    expect(b.isPlaying).toBe(true);
  });

  it("hands the position over to a new view and back to the remaining one when it closes", () => {
    const card = element();
    const handle = registerMedia("v", () => card);
    card.currentTime = 30;
    claimPlayback(handle);
    const opened = element();
    const beside = registerMedia("v", () => opened);
    expect(takeOver(beside)).toEqual({ positionSeconds: 30, isPlaying: true });
    expect(handle.isPlaying).toBe(false);
    claimPlayback(beside);
    opened.currentTime = 50;
    unregisterMedia(beside, (task) => task());
    expect(card.currentTime).toBe(50);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it("does not hand back when another view opens in the same moment", () => {
    const card = element();
    registerMedia("v", () => card);
    const opened = element();
    const beside = registerMedia("v", () => opened);
    claimPlayback(beside);
    const pending: (() => void)[] = [];
    unregisterMedia(beside, (task) => pending.push(task));
    const next = registerMedia("v", () => element());
    expect(takeOver(next).isPlaying).toBe(true);
    for (const task of pending) task();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it("remembers where a file stopped", () => {
    savePosition("x", 12);
    expect(positionOf("x")).toBe(12);
  });
});

describe("sound rows (PAGE-384)", () => {
  it("line up in the same fixed columns whatever the name, and offer no beside or full screen", () => {
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <AudioCard attachment={sound("s1", "kurz.wav")} />
        <AudioCard
          attachment={sound("s2", `${"ein sehr langer Name ".repeat(8)}.wav`)}
        />
      </I18nextProvider>,
    );
    const rows = [...container.querySelectorAll("[data-audio-player]")];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.className).toContain(AUDIO_ROW_COLUMNS);
      expect(row.querySelector("[data-audio-time]")?.textContent).toBe(
        "0:00 / –:––",
      );
      expect(row.querySelector("[data-audio-name] span")?.className).toContain(
        "truncate",
      );
      expect(row.querySelector("a[download]")?.className).toContain(
        "bg-primary",
      );
    }
    expect(screen.queryByRole("button", { name: /Daneben/u })).toBeNull();
    expect(screen.queryByRole("button", { name: "Vollbild" })).toBeNull();
    expect(screen.getAllByText(/noch \d+ Tage/u)).toHaveLength(2);
  });

  it("plays one sound at a time", () => {
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <AudioCard attachment={sound("s1", "a.wav")} />
        <AudioCard attachment={sound("s2", "b.wav")} />
      </I18nextProvider>,
    );
    const [first, second] = [...container.querySelectorAll("audio")];
    const buttons = screen.getAllByRole("button", { name: "Abspielen" });
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
    expect(
      (
        HTMLMediaElement.prototype.pause as unknown as {
          mock: { contexts: unknown[] };
        }
      ).mock.contexts[0],
    ).toBe(first);
    expect(second).toBeTruthy();
  });

  it("formats the time always as position / length", () => {
    expect(formatFixedMediaTime(41, 112)).toBe("0:41 / 1:52");
    expect(formatFixedMediaTime(0, null)).toBe("0:00 / –:––");
    expect(formatFixedMediaTime(65, 3725)).toBe("1:05 / 1:02:05");
  });
});

describe("helpers of the chat media (PAGE-384)", () => {
  it("names resolutions and maps the keys of the full screen", () => {
    expect(formatResolution({ width: 3840, height: 2160 })).toBe("4K");
    expect(formatResolution({ width: 1280, height: 720 })).toBe("720p");
    expect(formatResolution({ width: 720, height: 1280 })).toBe("720 × 1280");
    expect(formatResolution({})).toBeNull();
    const actions = {
      toggle: vi.fn(),
      skip: vi.fn(),
      previous: vi.fn(),
      next: vi.fn(),
      toggleFullscreen: vi.fn(),
      toggleMute: vi.fn(),
      close: vi.fn(),
    };
    const key = (value: string, shiftKey = false): void =>
      viewerKeyAction(
        { key: value, shiftKey, ctrlKey: false, metaKey: false, altKey: false },
        actions,
      )?.();
    key(" ");
    key("ArrowLeft");
    key("ArrowRight", true);
    key("f");
    key("M");
    key("Escape");
    expect(actions.toggle).toHaveBeenCalledOnce();
    expect(actions.skip).toHaveBeenCalledWith(-5);
    expect(actions.next).toHaveBeenCalledOnce();
    expect(actions.toggleFullscreen).toHaveBeenCalledOnce();
    expect(actions.toggleMute).toHaveBeenCalledOnce();
    expect(actions.close).toHaveBeenCalledOnce();
    expect(
      viewerKeyAction(
        {
          key: "f",
          shiftKey: false,
          ctrlKey: true,
          metaKey: false,
          altKey: false,
        },
        actions,
      ),
    ).toBeNull();
  });

  it("reads the video list and shows the hint while an agent generates", () => {
    expect(
      readChatMedia(
        {
          videos: [entry(video("v1"), "m"), { attachment: { kind: "image" } }],
        },
        "video",
      ),
    ).toHaveLength(1);
    expect(mediaToolKind({ name: "pages__video_erzeugen" })).toBe("video");
    expect(mediaToolKind({ name: "audio_erzeugen" })).toBe("audio");
    expect(mediaToolKind({ name: "bilder_erzeugen" })).toBeNull();
    const view = {
      end: null,
      text: "",
      thought: null,
      lastAt: 0,
      tools: [
        { id: "t", name: "video_erzeugen", status: "running", input: "{}" },
      ],
    } as unknown as LiveAnswerView;
    expect(activityOf(view)).toEqual({ kind: "video" });
    expect(i18n.t("chatPage.liveAnswer.activity.video", { name: "Ed" })).toBe(
      "Ed erzeugt Video …",
    );
  });
});
