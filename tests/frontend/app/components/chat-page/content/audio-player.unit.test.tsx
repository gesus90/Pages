import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { AudioPlayer } from "@/app/components/chat-page/content/audio-player";
import { createI18n } from "@/app/lib/i18n";

import type { ConversationAttachment } from "@/definition/ConversationContent";

const mocks = vi.hoisted(() => ({
  decode: vi.fn(),
  peaks: vi.fn(),
  seen: vi.fn(),
}));
vi.mock("@/app/components/chat-page/voice-audio", () => ({
  VOICE_WAVE_BARS: 32,
  decodeAudio: mocks.decode,
  wavePeaks: mocks.peaks,
}));
vi.mock("@/app/components/chat-page/content/use-seen", () => ({
  useSeen: mocks.seen,
}));

const attachment: ConversationAttachment = {
  id: "audio",
  name: "voice.ogg",
  mimeType: "audio/ogg",
  sizeBytes: 100,
  kind: "audio",
  url: "/audio",
};

it("loads the waveform once visible and responds to playback events", async () => {
  mocks.seen.mockReturnValue(true);
  mocks.decode.mockResolvedValue({
    getChannelData: () => new Float32Array([0.5]),
  });
  mocks.peaks.mockReturnValue([0.5]);
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(new Uint8Array([1, 2])));
  vi.stubGlobal("fetch", fetchMock);
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  const { container } = render(
    <I18nextProvider i18n={createI18n("en")}>
      <AudioPlayer attachment={attachment} />
    </I18nextProvider>,
  );
  await waitFor(() => expect(mocks.peaks).toHaveBeenCalled());
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock.mock.calls[0]?.[0]).toBe("/audio");
  fireEvent.click(screen.getByRole("button", { name: /play/i }));
  expect(play).toHaveBeenCalledOnce();
  const audio = container.querySelector("audio");
  if (!audio) throw new Error("Audio element missing");
  fireEvent.play(audio);
  expect(screen.getByRole("button", { name: /pause/i })).toBeTruthy();
  fireEvent.pause(audio);
  expect(screen.getByRole("button", { name: /play/i })).toBeTruthy();
});

it("does not read a large or unseen audio file", () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  mocks.seen.mockReturnValue(true);
  const { rerender } = render(
    <I18nextProvider i18n={createI18n("en")}>
      <AudioPlayer
        attachment={{ ...attachment, sizeBytes: 21 * 1024 * 1024 }}
      />
    </I18nextProvider>,
  );
  mocks.seen.mockReturnValue(false);
  rerender(
    <I18nextProvider i18n={createI18n("en")}>
      <AudioPlayer attachment={attachment} />
    </I18nextProvider>,
  );
  expect(fetchMock).not.toHaveBeenCalled();
});
