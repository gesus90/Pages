import { afterEach, expect, it, vi } from "vitest";

import { createThumbnail } from "@/app/components/chat-page/content/media-thumbnails";

const drawImage = vi.fn();
const close = vi.fn();
const encode = vi.fn();

function mockCanvas(): void {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => null,
  );
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => ({ drawImage }),
  });
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(encode);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  drawImage.mockReset();
  close.mockReset();
  encode.mockReset();
});

it("scales a decoded image and encodes it as WebP", async () => {
  const bitmap = { width: 1280, height: 320, close };
  const preview = new Blob(["preview"], { type: "image/webp" });
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
  mockCanvas();
  encode.mockImplementation((callback: BlobCallback) => callback(preview));
  expect(await createThumbnail(new Blob(["source"]), "IMAGE/PNG")).toBe(
    preview,
  );
  expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 640, 160);
  expect(encode).toHaveBeenCalledWith(expect.any(Function), "image/webp", 0.8);
  expect(close).toHaveBeenCalledOnce();
});

it("falls back to JPEG when WebP encoding is unavailable", async () => {
  const jpeg = new Blob(["jpeg"], { type: "image/jpeg" });
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn().mockResolvedValue({ width: 10, height: 20, close }),
  );
  mockCanvas();
  encode.mockImplementationOnce((callback: BlobCallback) =>
    callback(new Blob([], { type: "image/png" })),
  );
  encode.mockImplementationOnce((callback: BlobCallback) => callback(jpeg));
  expect(await createThumbnail(new Blob(), "image/png")).toBe(jpeg);
  expect(encode).toHaveBeenLastCalledWith(
    expect.any(Function),
    "image/jpeg",
    0.8,
  );
  expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 10, 20);
});

it("returns null for unsupported media, empty dimensions and decoder failures", async () => {
  expect(await createThumbnail(new Blob(), "text/plain")).toBeNull();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn().mockResolvedValue({ width: 0, height: 0, close }),
  );
  expect(await createThumbnail(new Blob(), "image/png")).toBeNull();
  expect(close).toHaveBeenCalledOnce();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn().mockRejectedValue(new Error("decode")),
  );
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:test"),
    revokeObjectURL: vi.fn(),
  });
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.stubGlobal(
    "Image",
    class {
      public src = "";
      /** Simulates an image decoder rejecting invalid bytes. */
      public decode(): Promise<void> {
        return Promise.reject(new Error("invalid image"));
      }
    },
  );
  expect(await createThumbnail(new Blob(), "image/png")).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
  expect(warning).toHaveBeenCalledOnce();
});
