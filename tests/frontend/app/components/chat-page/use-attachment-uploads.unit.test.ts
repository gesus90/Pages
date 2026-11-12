import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { useAttachmentUploads } from "@/app/components/chat-page/use-attachment-uploads";
import { CONVERSATION_ATTACHMENT_MAXIMUM_BYTES } from "@/definition/ConversationContent";

const createThumbnail = vi.hoisted(() => vi.fn());
vi.mock("@/app/components/chat-page/content/media-thumbnails", () => ({
  createThumbnail,
}));

const selection = { kind: "group", id: "team" } as const;
let requests: XMLHttpRequest[];

beforeEach(() => {
  requests = [];
  createThumbnail.mockReset();
  vi.spyOn(XMLHttpRequest.prototype, "open").mockImplementation(function (
    this: XMLHttpRequest,
  ) {
    requests.push(this);
  });
  vi.spyOn(XMLHttpRequest.prototype, "setRequestHeader").mockImplementation(
    () => undefined,
  );
  vi.spyOn(XMLHttpRequest.prototype, "send").mockImplementation(
    () => undefined,
  );
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response()));
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:preview"),
      revokeObjectURL: vi.fn(),
    }),
  );
});

function respond(request: XMLHttpRequest, status: number, body: unknown): void {
  Object.defineProperty(request, "status", {
    configurable: true,
    value: status,
  });
  Object.defineProperty(request, "response", {
    configurable: true,
    value: body,
  });
  request.dispatchEvent(new Event("load"));
}

it("tracks upload progress and returns stored IDs without deleting sent files", async () => {
  const { result } = renderHook(() => useAttachmentUploads(selection));
  const file = new File(["hello"], "note.txt", { type: "text/plain" });
  act(() => result.current.add([file]));
  expect(result.current.isUploading).toBe(true);
  expect(requests).toHaveLength(1);
  act(() => {
    requests[0].upload.dispatchEvent(
      new ProgressEvent("progress", {
        lengthComputable: true,
        loaded: 2,
        total: 4,
      }),
    );
  });
  expect(result.current.items[0].progress).toBe(0.5);
  await act(async () =>
    respond(requests[0], 200, { ok: true, attachment: { id: "stored" } }),
  );
  expect(result.current.items[0]).toMatchObject({
    state: "ready",
    progress: 1,
    attachmentId: "stored",
  });
  let taken: string[] = [];
  act(() => {
    taken = result.current.take();
  });
  expect(taken).toEqual(["stored"]);
  expect(result.current.items).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});

it("reports refused uploads and clears the failure when removed", async () => {
  const { result } = renderHook(() => useAttachmentUploads(selection));
  act(() => result.current.add([new File(["x"], "large.txt")]));
  await act(async () => respond(requests[0], 413, {}));
  expect(result.current.failure).toBe("tooLarge");
  expect(result.current.items[0]).toMatchObject({
    state: "failed",
    mimeType: "application/octet-stream",
  });
  act(() => result.current.remove(result.current.items[0].localId));
  expect(result.current.failure).toBeNull();
  expect(result.current.items).toEqual([]);
});

it("limits file size and count before sending", () => {
  const { result } = renderHook(() => useAttachmentUploads(selection));
  const large = new File([], "large");
  Object.defineProperty(large, "size", {
    value: CONVERSATION_ATTACHMENT_MAXIMUM_BYTES + 1,
  });
  act(() => result.current.add([large]));
  expect(result.current.failure).toBe("tooLarge");
  expect(requests).toHaveLength(0);
  act(() =>
    result.current.add(
      Array.from({ length: 11 }, (_, index) => new File(["x"], `${index}.txt`)),
    ),
  );
  expect(result.current.failure).toBe("tooMany");
  expect(result.current.items).toHaveLength(10);
  expect(requests).toHaveLength(10);
});

it("uploads an image preview and deletes the stored attachment when removed", async () => {
  const thumbnail = new Blob(["preview"], { type: "image/webp" });
  createThumbnail.mockResolvedValue(thumbnail);
  const { result } = renderHook(() => useAttachmentUploads(selection));
  act(() =>
    result.current.add([new File(["x"], "photo.png", { type: "image/png" })]),
  );
  await act(async () =>
    respond(requests[0], 201, { ok: true, attachment: { id: "image 1" } }),
  );
  await waitFor(() => expect(result.current.items[0].state).toBe("ready"));
  expect(fetch).toHaveBeenCalledWith(
    "/chat-page-api/files?attachmentId=image+1",
    {
      method: "PUT",
      headers: { "Content-Type": "image/webp" },
      body: thumbnail,
    },
  );
  act(() => result.current.remove(result.current.items[0].localId));
  expect(fetch).toHaveBeenCalledWith(
    "/chat-page-api/files?attachmentId=image+1",
    { method: "DELETE", keepalive: true },
  );
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
});

it("aborts pending uploads when changing conversation", () => {
  const abort = vi.spyOn(XMLHttpRequest.prototype, "abort");
  const { result, rerender } = renderHook(
    ({ id }) => useAttachmentUploads({ kind: "group", id }),
    { initialProps: { id: "first" } },
  );
  act(() => result.current.add([new File(["x"], "note.txt")]));
  rerender({ id: "second" });
  expect(abort).toHaveBeenCalledTimes(1);
  expect(result.current.items).toEqual([]);
});
