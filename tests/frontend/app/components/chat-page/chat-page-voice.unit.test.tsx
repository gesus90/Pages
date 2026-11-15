import { I18nextProvider } from "react-i18next";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  ChatPageVoice,
  VOICE_ROW_COLUMNS,
} from "@/app/components/chat-page/chat-page-voice";
import { VOICE_WAVE_BARS } from "@/app/components/chat-page/voice-audio";
import { createI18n } from "@/app/lib/i18n";

import type * as VoiceAudio from "@/app/components/chat-page/voice-audio";
import type { VirtualVoice } from "@/definition/VirtualChat";

const decodeAudio = vi.hoisted(() => vi.fn());
vi.mock("@/app/components/chat-page/voice-audio", async (importOriginal) => ({
  ...(await importOriginal<typeof VoiceAudio>()),
  decodeAudio,
}));

const i18n = createI18n("en");
const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<unknown>>();

const VOICE: VirtualVoice = {
  url: "/voice/one.wav",
  durationMs: 65_000,
  transcriptionState: "done",
};

function renderVoice(
  options: {
    voice?: Partial<VirtualVoice>;
    text?: string;
    senderName?: string;
  } = {},
): void {
  render(
    <I18nextProvider i18n={i18n}>
      <ChatPageVoice
        voice={{ ...VOICE, ...options.voice }}
        text={options.text ?? "Hello there"}
        senderName={options.senderName ?? "Ada"}
      />
    </I18nextProvider>,
  );
}

function audioElement(): HTMLAudioElement {
  const element = document.querySelector<HTMLAudioElement>("audio");
  if (!element) throw new Error("no audio element");
  return element;
}

function waveButton(): HTMLElement {
  return screen.getByRole("button", {
    name: "Jump to a point of the voice message",
  });
}

function peakAudio(samples: Float32Array): unknown {
  return { getChannelData: () => samples };
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: false });
  decodeAudio.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function timeText(): string {
  return document.querySelector("[data-voice-time]")?.textContent ?? "";
}

function showTextButton(): HTMLElement {
  return screen.getByRole("button", { name: "Show text" });
}

it("shows sender, length and the time as position / length", () => {
  renderVoice();

  expect(screen.getByText("Ada")).toBeTruthy();
  expect(screen.getByText("Voice message · 1:05")).toBeTruthy();
  expect(timeText()).toBe("0:00 / 1:05");
  expect(audioElement().getAttribute("src")).toBe("/voice/one.wav");
  expect(
    screen.getByRole("button", { name: "Play voice message" }),
  ).toBeTruthy();
});

it("announces a pending recognition as a status in italics", () => {
  renderVoice({ voice: { transcriptionState: "pending" }, text: "" });

  const status = screen.getByRole("status");
  expect(status.textContent).toBe("Recognizing …");
  expect(status.className).toContain("italic");
});

it("tells that a failed recognition leaves the audio playable", () => {
  renderVoice({ voice: { transcriptionState: "failed" }, text: "" });

  const note = screen.getByText(
    "The text could not be recognized. The recording stays playable.",
  );
  expect(note.className).toContain("italic");
  expect(note.getAttribute("role")).toBeNull();
});

it("keeps the recognized text collapsed until Show text opens it", () => {
  renderVoice();

  expect(screen.queryByText("Hello there")).toBeNull();
  expect(showTextButton().getAttribute("aria-expanded")).toBe("false");

  fireEvent.click(showTextButton());
  expect(screen.getByText("Hello there")).toBeTruthy();
  const hide = screen.getByRole("button", { name: "Hide text" });
  expect(hide.getAttribute("aria-expanded")).toBe("true");

  fireEvent.click(hide);
  expect(screen.queryByText("Hello there")).toBeNull();
});

it("offers no text toggle while the recognized text is empty", () => {
  renderVoice({ text: "" });

  expect(screen.queryByRole("button", { name: "Show text" })).toBeNull();
});

it("draws the row in the theme tokens with the accent color for play only", () => {
  renderVoice();

  const row = document.querySelector("[data-voice-row]");
  expect(row?.className).toContain("bg-surface");
  expect(row?.className).toContain("border-border");
  expect(
    screen.getByRole("button", { name: "Play voice message" }).className,
  ).toContain("bg-primary");
  expect(waveButton().querySelector("span")?.className).toContain(
    "bg-border",
  );
  expect(screen.getByText("Voice message · 1:05").className).toContain(
    "text-muted-foreground",
  );
  // No download in a voice message (PAGE-388).
  expect(screen.queryByRole("link")).toBeNull();
});

it("lays every voice message out in the same fixed columns", () => {
  render(
    <I18nextProvider i18n={i18n}>
      <ChatPageVoice voice={VOICE} text="a" senderName="You" />
      <ChatPageVoice
        voice={{ ...VOICE, durationMs: 3_725_000 }}
        text="b"
        senderName="A participant with a very long name"
      />
    </I18nextProvider>,
  );

  const grids = [...document.querySelectorAll("[data-voice-grid]")];
  expect(grids).toHaveLength(2);
  for (const grid of grids) {
    expect(grid.className).toContain(VOICE_ROW_COLUMNS);
    expect(grid.children).toHaveLength(5);
  }
  expect(VOICE_ROW_COLUMNS).toContain("7.5rem_3rem]");
  const rows = [...document.querySelectorAll("[data-voice-row]")];
  for (const row of rows) expect(row.className).toContain("sm:w-[42rem]");
});

it("steps through the speeds and applies them to the audio", () => {
  const play = vi
    .spyOn(HTMLMediaElement.prototype, "play")
    .mockResolvedValue(undefined);
  renderVoice();
  const element = audioElement();

  fireEvent.click(screen.getByRole("button", { name: "Speed: 1×" }));
  expect(element.playbackRate).toBe(1.5);
  fireEvent.click(screen.getByRole("button", { name: "Speed: 1.5×" }));
  expect(element.playbackRate).toBe(2);
  fireEvent.click(screen.getByRole("button", { name: "Speed: 2×" }));
  fireEvent.click(screen.getByRole("button", { name: "Speed: 0.5×" }));
  expect(screen.getByRole("button", { name: "Speed: 1×" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Speed: 1×" }));
  element.playbackRate = 1;
  fireEvent.click(screen.getByRole("button", { name: "Play voice message" }));
  expect(play).toHaveBeenCalledTimes(1);
  expect(element.playbackRate).toBe(1.5);
});

it("shows a flat wave while the audio is not decoded", () => {
  renderVoice();

  expect(waveButton().getAttribute("data-voice-wave")).toBe("pending");
  const bars = waveButton().querySelectorAll<HTMLElement>("span");
  expect(bars).toHaveLength(VOICE_WAVE_BARS);
  expect(bars[0]?.style.height).toBe("30%");
});

it("reads the waveform once the audio is fetched and decoded", async () => {
  const samples = new Float32Array(VOICE_WAVE_BARS * 16);
  samples[0] = 1;
  fetchMock.mockResolvedValue({
    ok: true,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
  });
  decodeAudio.mockResolvedValue(peakAudio(samples));

  renderVoice();

  await waitFor(() =>
    expect(waveButton().getAttribute("data-voice-wave")).toBe("decoded"),
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]?.[0]).toBe("/voice/one.wav");
  expect(fetchMock.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
  const bars = waveButton().querySelectorAll<HTMLElement>("span");
  expect(bars[0]?.style.height).toBe("100%");
  // A silent bar keeps the minimum height of 12 %.
  expect(bars[1]?.style.height).toBe("12%");
});

it("keeps the flat wave when the response is not ok", async () => {
  renderVoice();

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(decodeAudio).not.toHaveBeenCalled();
  expect(waveButton().getAttribute("data-voice-wave")).toBe("pending");
});

it("keeps the flat wave when the audio cannot be decoded", async () => {
  fetchMock.mockResolvedValue({
    ok: true,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
  });
  decodeAudio.mockRejectedValue(new Error("unreadable"));

  renderVoice();

  await waitFor(() => expect(decodeAudio).toHaveBeenCalled());
  await act(() => Promise.resolve());
  expect(waveButton().getAttribute("data-voice-wave")).toBe("pending");
});

it("aborts the read and ignores a late decode after unmounting", async () => {
  let resolveDecode: (audio: unknown) => void = () => undefined;
  fetchMock.mockResolvedValue({
    ok: true,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
  });
  decodeAudio.mockReturnValue(
    new Promise((resolve) => {
      resolveDecode = resolve;
    }),
  );
  const getChannelData = vi.fn(() => new Float32Array(48));

  const view = render(
    <I18nextProvider i18n={i18n}>
      <ChatPageVoice voice={VOICE} text="x" senderName="Ada" />
    </I18nextProvider>,
  );
  await waitFor(() => expect(decodeAudio).toHaveBeenCalled());
  const signal = fetchMock.mock.calls[0]?.[1].signal;
  view.unmount();
  expect(signal?.aborted).toBe(true);

  await act(async () => {
    resolveDecode({ getChannelData });
    await Promise.resolve();
  });
  expect(getChannelData).not.toHaveBeenCalled();
});

it("reads the audio again when the address changes", async () => {
  const view = render(
    <I18nextProvider i18n={i18n}>
      <ChatPageVoice voice={VOICE} text="x" senderName="Ada" />
    </I18nextProvider>,
  );
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  view.rerender(
    <I18nextProvider i18n={i18n}>
      <ChatPageVoice
        voice={{ ...VOICE, url: "/voice/two.wav" }}
        text="x"
        senderName="Ada"
      />
    </I18nextProvider>,
  );
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(fetchMock.mock.calls[1]?.[0]).toBe("/voice/two.wav");
});

it("plays a paused audio and shows the pause button after it started", async () => {
  const play = vi
    .spyOn(HTMLMediaElement.prototype, "play")
    .mockResolvedValue(undefined);
  renderVoice();

  fireEvent.click(screen.getByRole("button", { name: "Play voice message" }));
  expect(play).toHaveBeenCalledTimes(1);

  fireEvent.play(audioElement());
  expect(
    screen.getByRole("button", { name: "Pause voice message" }),
  ).toBeTruthy();
});

it("pauses an audio that is playing", () => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  const pause = vi
    .spyOn(HTMLMediaElement.prototype, "pause")
    .mockImplementation(() => undefined);
  renderVoice();
  const element = audioElement();
  Object.defineProperty(element, "paused", {
    configurable: true,
    get: () => false,
  });

  fireEvent.click(screen.getByRole("button", { name: "Play voice message" }));
  expect(pause).toHaveBeenCalledTimes(1);

  fireEvent.play(element);
  fireEvent.pause(element);
  expect(
    screen.getByRole("button", { name: "Play voice message" }),
  ).toBeTruthy();
});

it("returns to the play button when the browser refuses to play", async () => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(
    new Error("blocked"),
  );
  renderVoice();
  const element = audioElement();
  fireEvent.play(element);
  expect(
    screen.getByRole("button", { name: "Pause voice message" }),
  ).toBeTruthy();
  Object.defineProperty(element, "paused", {
    configurable: true,
    get: () => true,
  });

  fireEvent.click(screen.getByRole("button", { name: "Pause voice message" }));

  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Play voice message" }),
    ).toBeTruthy(),
  );
});

it("shows the position while playing and resets it when the audio ends", () => {
  renderVoice();
  const element = audioElement();

  element.currentTime = 12;
  fireEvent.timeUpdate(element);
  expect(timeText()).toBe("0:12 / 1:05");

  fireEvent.ended(element);
  expect(timeText()).toBe("0:00 / 1:05");
  expect(
    screen.getByRole("button", { name: "Play voice message" }),
  ).toBeTruthy();
});

it("fills the played part of the wave by the share of the position", () => {
  renderVoice({ voice: { durationMs: 48_000 } });
  const element = audioElement();

  element.currentTime = 24;
  fireEvent.timeUpdate(element);

  const bars = [...waveButton().querySelectorAll("span")];
  const rest = bars.filter((bar) => bar.className.includes("bg-border"));
  expect(rest).toHaveLength(VOICE_WAVE_BARS / 2);
  expect(bars[0]?.className).toContain("bg-primary");
  expect(bars.at(-1)?.className).toContain("bg-border");
});

it("seeks to the clicked point of the wave", () => {
  renderVoice({ voice: { durationMs: 60_000 } });
  const element = audioElement();
  vi.spyOn(waveButton(), "getBoundingClientRect").mockReturnValue(
    new DOMRect(100, 0, 200, 10),
  );

  fireEvent.click(waveButton(), { clientX: 150 });

  expect(element.currentTime).toBe(15);
  expect(timeText()).toBe("0:15 / 1:00");
});

it("keeps a seek inside the audio when the click lies outside the wave", () => {
  renderVoice({ voice: { durationMs: 60_000 } });
  const element = audioElement();
  vi.spyOn(waveButton(), "getBoundingClientRect").mockReturnValue(
    new DOMRect(100, 0, 200, 10),
  );

  fireEvent.click(waveButton(), { clientX: 500 });
  expect(element.currentTime).toBe(60);

  fireEvent.click(waveButton(), { clientX: 10 });
  expect(element.currentTime).toBe(0);
  expect(timeText()).toBe("0:00 / 1:00");
});
