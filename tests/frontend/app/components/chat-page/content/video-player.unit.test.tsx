import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import {
  VideoCard,
  VideoPlayer,
} from "@/app/components/chat-page/content/video-player";
import { createI18n } from "@/app/lib/i18n";

import type { ConversationAttachment } from "@/definition/ConversationContent";

vi.mock("@/app/components/chat-page/content/use-attachment-preview", () => ({
  useAttachmentPreview: () => ({
    previewUrl: null,
    isPending: true,
    target: () => undefined,
  }),
}));

const attachment: ConversationAttachment = {
  id: "video",
  name: "clip.mp4",
  mimeType: "video/mp4",
  sizeBytes: 1024,
  kind: "video",
  url: "/clip",
};

it("plays, seeks and changes speed with the video controls", () => {
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  const { container } = render(
    <I18nextProvider i18n={createI18n("en")}>
      <VideoPlayer attachment={attachment} />
    </I18nextProvider>,
  );
  const video = container.querySelector("video");
  if (!video) throw new Error("Video missing");
  expect(video.getAttribute("preload")).toBe("none");
  expect(screen.getByText(/clip.mp4/).textContent).toContain("1 KB");
  const seek = screen.getByRole("slider");
  expect(seek.hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getAllByRole("button", { name: "Play" })[0]);
  expect(play).toHaveBeenCalledOnce();
  fireEvent.play(video);
  expect(screen.getAllByRole("button", { name: "Pause" })).toHaveLength(2);
  Object.defineProperty(video, "duration", { configurable: true, value: 120 });
  fireEvent.durationChange(video);
  fireEvent.change(seek, { target: { value: "500" } });
  expect(video.currentTime).toBe(60);
  expect(seek.getAttribute("aria-valuetext")).toBe("1:00 / 2:00");
  fireEvent.click(screen.getByRole("button", { name: /speed/i }));
  expect(video.playbackRate).toBe(1.5);
});

it("offers the original video as a download", () => {
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <VideoCard
        card={{
          key: "video",
          descriptor: { kind: "video", attachment },
          origin: { senderName: "Ada" },
        }}
      />
    </I18nextProvider>,
  );
  expect(
    screen.getByRole("link", { name: "Download" }).getAttribute("href"),
  ).toBe("/clip?download=1");
});
