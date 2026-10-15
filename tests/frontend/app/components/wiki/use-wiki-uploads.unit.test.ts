import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { useWikiUploads } from "@/app/components/wiki/use-wiki-uploads";
import { uploadWikiFile, WikiUploadError } from "@/app/lib/wiki-upload";

import type * as WikiUpload from "@/app/lib/wiki-upload";
import type { WikiAttachment } from "@/definition/Wiki";

vi.mock("@/app/lib/wiki-upload", async (importOriginal) => ({
  ...(await importOriginal<typeof WikiUpload>()),
  uploadWikiFile: vi.fn(),
}));
beforeEach(() => {
  vi.mocked(uploadWikiFile).mockReset();
});

const attachment: WikiAttachment = {
  id: "attachment",
  pageId: "page",
  fileName: "photo.png",
  contentType: "image/png",
  kind: "media",
  size: 12,
  uploadedBy: "editor",
  uploadedByName: "Editor",
  createdAt: "2026-10-01",
  isEmbeddable: true,
};

it("shows file progress while waiting and inserts markdown after success", async () => {
  const uploaded = vi.fn();
  const { result } = renderHook(() => useWikiUploads("page", uploaded));
  let finish: (attachment: WikiAttachment) => void = () => {
    throw new Error("Upload not started");
  };
  vi.mocked(uploadWikiFile).mockImplementation((pageId, file, progress) => {
    expect(pageId).toBe("page");
    expect(file.name).toBe("photo.png");
    progress(0.5);
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const file = new File(["image"], "photo.png");
  let pending: Promise<WikiAttachment[]> = Promise.resolve([]);
  act(() => {
    pending = result.current.upload([file]);
  });
  expect(result.current.fileName).toBe("photo.png");
  expect(result.current.progress).toBe(0.5);
  expect(uploadWikiFile).toHaveBeenCalledWith(
    "page",
    file,
    expect.any(Function),
  );
  expect(uploaded).not.toHaveBeenCalled();
  await act(async () => {
    finish(attachment);
    await pending;
  });
  expect(await pending).toEqual([attachment]);
  expect(uploaded).toHaveBeenCalledExactlyOnceWith(
    "![photo.png](/wiki/attachments/attachment)",
  );
  expect(result.current.progress).toBeNull();
  expect(result.current.fileName).toBeNull();
  expect(result.current.errorCode).toBeNull();
});

it.each([new WikiUploadError("tooLarge"), new Error("offline")])(
  "continues after a failed file and resets the error on the next batch (%s)",
  async (error) => {
    const uploaded = vi.fn();
    const { result } = renderHook(() => useWikiUploads("page", uploaded));
    vi.mocked(uploadWikiFile)
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(attachment);
    let stored: WikiAttachment[] = [];
    await act(async () => {
      stored = await result.current.upload([
        new File(["bad"], "bad.png"),
        new File(["ok"], "photo.png"),
      ]);
    });
    expect(stored).toEqual([attachment]);
    expect(uploaded).toHaveBeenCalledTimes(1);
    expect(result.current.errorCode).toBe(
      error instanceof WikiUploadError ? "tooLarge" : "network",
    );
    expect(result.current.fileName).toBeNull();
    expect(result.current.progress).toBeNull();
    await act(async () => {
      expect(await result.current.upload([])).toEqual([]);
    });
    expect(result.current.errorCode).toBeNull();
  },
);

it("does not start the second file before the first completes", async () => {
  const { result } = renderHook(() => useWikiUploads("page", vi.fn()));
  let finish: (attachment: WikiAttachment) => void = () => {
    throw new Error("Upload not started");
  };
  vi.mocked(uploadWikiFile)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce({ ...attachment, id: "second" });
  let pending: Promise<WikiAttachment[]> = Promise.resolve([]);
  act(() => {
    pending = result.current.upload([
      new File(["1"], "first.png"),
      new File(["2"], "second.png"),
    ]);
  });
  expect(uploadWikiFile).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish(attachment);
    await pending;
  });
  expect(uploadWikiFile).toHaveBeenCalledTimes(2);
  expect((await pending).map((entry) => entry.id)).toEqual([
    "attachment",
    "second",
  ]);
});
