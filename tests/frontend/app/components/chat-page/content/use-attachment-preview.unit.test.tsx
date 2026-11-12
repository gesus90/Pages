import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { useAttachmentPreview } from "@/app/components/chat-page/content/use-attachment-preview";

import type { ConversationAttachment } from "@/definition/ConversationContent";

const mocks = vi.hoisted(() => ({ thumbnail: vi.fn(), seen: vi.fn() }));
vi.mock("@/app/components/chat-page/content/media-thumbnails", () => ({
  createThumbnail: mocks.thumbnail,
}));
vi.mock("@/app/components/chat-page/content/use-seen", () => ({
  useSeen: mocks.seen,
}));

const attachment: ConversationAttachment = {
  id: "preview-test",
  name: "image.png",
  mimeType: "image/png",
  sizeBytes: 100,
  kind: "image",
  url: "/original",
};

beforeEach(() => {
  mocks.thumbnail.mockReset();
  mocks.seen.mockReturnValue(true);
});

it("shows a known thumbnail without fetching the original", () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(() =>
    useAttachmentPreview({ ...attachment, thumbnailUrl: "/known" }),
  );
  expect(result.current.previewUrl).toBe("/known");
  expect(result.current.isPending).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("creates and uploads a preview, caches the server URL and releases the object URL", async () => {
  const preview = new Blob(["preview"], { type: "image/png" });
  mocks.thumbnail.mockResolvedValue(preview);
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(new Blob(["original"])))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ attachment: { thumbnailUrl: "/stored" } }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );
  vi.stubGlobal("fetch", fetchMock);
  const create = vi.fn().mockReturnValue("blob:preview");
  const revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    Object.assign(class extends URL {}, {
      createObjectURL: create,
      revokeObjectURL: revoke,
    }),
  );
  const { result, unmount } = renderHook(() =>
    useAttachmentPreview(attachment),
  );
  await waitFor(() => expect(result.current.previewUrl).toBe("/stored"));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(fetchMock.mock.calls[1]?.[0]).toBe(
    "/chat-page-api/files?attachmentId=preview-test",
  );
  expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
    method: "PUT",
    body: preview,
  });
  expect(result.current.isPending).toBe(false);
  await act(async () => {
    await Promise.resolve();
  });
  unmount();
  expect(revoke).toHaveBeenCalledWith("blob:preview");
  const cached = renderHook(() => useAttachmentPreview(attachment));
  expect(cached.result.current.previewUrl).toBe("/stored");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("ends a failed preview and does not fetch unsupported or unseen attachments", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 404 }));
  vi.stubGlobal("fetch", fetchMock);
  const failed = renderHook(() =>
    useAttachmentPreview({ ...attachment, id: "failed" }),
  );
  await waitFor(() => expect(failed.result.current.isPending).toBe(false));
  expect(failed.result.current.previewUrl).toBeNull();
  expect(mocks.thumbnail).not.toHaveBeenCalled();
  failed.unmount();
  mocks.seen.mockReturnValue(false);
  const unseen = renderHook(() =>
    useAttachmentPreview({ ...attachment, id: "unseen" }),
  );
  expect(unseen.result.current.isPending).toBe(true);
  unseen.unmount();
  const unsupported = renderHook(() =>
    useAttachmentPreview({ ...attachment, kind: "file" }),
  );
  expect(unsupported.result.current.isPending).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
