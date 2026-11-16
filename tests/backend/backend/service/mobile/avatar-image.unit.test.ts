import { expect, it, vi } from "vitest";

import { shrinkAvatarImage } from "@/backend/service/mobile/PicaMobileAvatarImage";

const canvas = vi.hoisted(() => ({
  loadImage: vi.fn(),
  createCanvas: vi.fn(),
}));
vi.mock("@napi-rs/canvas", () => canvas);

function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

it("rejects malformed and excessive image dimensions before decoding", async () => {
  await expect(
    shrinkAvatarImage(Buffer.alloc(10), "image/png"),
  ).resolves.toBeNull();
  await expect(shrinkAvatarImage(png(0, 10), "image/png")).resolves.toBeNull();
  await expect(
    shrinkAvatarImage(png(6000, 6000), "image/png"),
  ).resolves.toBeNull();
  await expect(shrinkAvatarImage(png(10, 10), "image/gif")).resolves.toBeNull();
  expect(canvas.loadImage).not.toHaveBeenCalled();
});

it("scales a decoded image without enlargement and returns its re-encoded bytes", async () => {
  const drawImage = vi.fn();
  const toBuffer = vi.fn(() => Buffer.from("encoded"));
  canvas.loadImage.mockResolvedValueOnce({ width: 512, height: 256 });
  canvas.createCanvas.mockReturnValueOnce({
    getContext: () => ({ drawImage }),
    toBuffer,
  });
  await expect(shrinkAvatarImage(png(512, 256), "image/png")).resolves.toEqual({
    mimeType: "image/png",
    data: Buffer.from("encoded"),
  });
  expect(canvas.createCanvas).toHaveBeenCalledWith(256, 128);
  expect(drawImage).toHaveBeenCalledOnce();
});

it("treats a decoding failure as a missing avatar", async () => {
  canvas.loadImage.mockRejectedValueOnce(new Error("damaged"));
  await expect(shrinkAvatarImage(png(2, 2), "image/png")).resolves.toBeNull();
});
