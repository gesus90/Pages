import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { AttachmentFullView } from "@/app/components/chat-page/content/attachment-full-view";

import type {
  ConversationAttachment,
  ConversationAttachmentKind,
} from "@/definition/ConversationContent";

vi.mock("@/app/components/chat-page/content/pdf-viewer", () => ({
  PdfViewer: ({ url }: { readonly url: string }) => <div>PDF: {url}</div>,
}));
vi.mock("@/app/components/chat-page/content/video-player", () => ({
  VideoPlayer: ({
    attachment,
    isFilling,
  }: {
    readonly attachment: ConversationAttachment;
    readonly isFilling: boolean;
  }) => (
    <div>
      Video: {attachment.name} {String(isFilling)}
    </div>
  ),
}));
vi.mock("@/app/components/chat-page/content/audio-player", () => ({
  AudioPlayer: ({
    attachment,
  }: {
    readonly attachment: ConversationAttachment;
  }) => <div>Audio: {attachment.name}</div>,
}));
vi.mock("@/app/components/chat-page/content/file-card", () => ({
  FileDetails: ({
    attachment,
    isFull,
  }: {
    readonly attachment: ConversationAttachment;
    readonly isFull: boolean;
  }) => (
    <div>
      File: {attachment.name} {String(isFull)}
    </div>
  ),
}));

function makeAttachment(
  kind: ConversationAttachmentKind,
): ConversationAttachment {
  return {
    id: kind,
    name: `${kind}.dat`,
    mimeType: "application/octet-stream",
    sizeBytes: 12,
    kind,
    url: `/attachments/${kind}`,
  };
}

it("shows the original image with its accessible name", () => {
  render(<AttachmentFullView attachment={makeAttachment("image")} />);
  expect(
    screen.getByRole("img", { name: "image.dat" }).getAttribute("src"),
  ).toBe("/attachments/image");
});

it("passes each other attachment to its full-view renderer", () => {
  const { rerender } = render(
    <AttachmentFullView attachment={makeAttachment("pdf")} />,
  );
  expect(screen.getByText("PDF: /attachments/pdf")).toBeDefined();
  rerender(<AttachmentFullView attachment={makeAttachment("video")} />);
  expect(screen.getByText("Video: video.dat true")).toBeDefined();
  rerender(<AttachmentFullView attachment={makeAttachment("audio")} />);
  expect(screen.getByText("Audio: audio.dat")).toBeDefined();
  rerender(<AttachmentFullView attachment={makeAttachment("file")} />);
  expect(screen.getByText("File: file.dat true")).toBeDefined();
});
