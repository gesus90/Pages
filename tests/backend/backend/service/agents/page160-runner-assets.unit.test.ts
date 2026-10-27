import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { RunnerAssetUploads } from "@/backend/service/runner/RunnerAssetUploads";

import { modelAssetContent } from "../../../../../scripts/runner/pages.mjs";
import { PNG, JPG, WEBP } from "./page160-asset-fixtures";

import type { Stats } from "node:fs";

const FILES = vi.hoisted(() => new Map<string, string | Buffer>());
vi.mock("node:fs/promises", () => {
  const bytes = (file: string): Buffer => {
    const value = FILES.get(file);
    if (value === undefined)
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return Buffer.isBuffer(value) ? value : Buffer.from(value);
  };
  const stat = (
    file: string,
  ): Pick<Stats, "size" | "ino" | "dev" | "isFile" | "isSymbolicLink"> => ({
    size: bytes(file).length,
    ino: 1,
    dev: 1,
    isFile: () => true,
    isSymbolicLink: () => false,
  });
  return {
    readFile: vi.fn(async (file: string) => bytes(file).toString("utf8")),
    realpath: vi.fn(async (file: string) => file),
    lstat: vi.fn(async (file: string) => stat(file)),
    open: vi.fn(async (file: string) => ({
      stat: async () => stat(file),
      close: vi.fn(),
      read: async (
        buffer: Buffer,
        offset: number,
        length: number,
        position: number,
      ) => ({
        bytesRead: bytes(file).copy(
          buffer,
          offset,
          position,
          position + length,
        ),
      }),
    })),
  };
});

describe("remote model asset delivery", () => {
  it.each([
    ["image/png", PNG],
    ["image/jpeg", JPG],
    ["image/webp", WEBP],
  ] as const)(
    "delivers original %s bytes without a Pages host path or PNG relabelling",
    async (type, bytes) => {
      const digest = createHash("sha256").update(bytes).digest("hex");
      FILES.set(
        "/synthetic/job/runtime/assets-manifest.json",
        JSON.stringify([
          {
            type,
            name: "source",
            path: "/synthetic/workspace/.pages-assets-run/0-source",
            digest,
            size: bytes.length,
            representation: "model-image",
          },
        ]),
      );
      FILES.set("/synthetic/workspace/.pages-assets-run/0-source", bytes);
      const content = await modelAssetContent("/synthetic/job", "prompt", true);
      expect(content).toContainEqual({
        type: "image_url",
        image_url: { url: `data:${type};base64,${bytes.toString("base64")}` },
      });
      const textOnly = await modelAssetContent(
        "/synthetic/job",
        "prompt",
        false,
      );
      expect(JSON.stringify(textOnly)).not.toContain("data:image");
      expect(JSON.stringify(textOnly)).toContain("No image has been viewed");
    },
  );

  it("refuses a changed transfer instead of substituting current bytes under frozen provenance", async () => {
    FILES.set(
      "/synthetic/job/runtime/assets-manifest.json",
      JSON.stringify([
        {
          type: "image/png",
          path: "/synthetic/workspace/source",
          digest: "0".repeat(64),
          size: PNG.length,
          representation: "model-image",
        },
      ]),
    );
    FILES.set("/synthetic/workspace/source", PNG);
    await expect(
      modelAssetContent("/synthetic/job", "prompt", true),
    ).rejects.toThrow("Original asset changed");
  });
});

describe("runner binary output", () => {
  const CHUNK = {
    ticket: "a".repeat(43),
    offset: 0,
    base64: PNG.toString("base64"),
    done: true,
    digest: createHash("sha256").update(PNG).digest("hex"),
  };

  it("returns a permanent link only after the attachment service finishes", async () => {
    const publish = vi.fn(async () => ({
      assetId: "published",
      link: "/aufgaben/attachments/published",
      fileName: "edited.png",
      contentType: "image/png",
      size: PNG.length,
      expiresAt: null,
    }));
    const uploads = new RunnerAssetUploads(publish);
    expect(await uploads.receive("attempt", CHUNK)).toMatchObject({
      link: "/aufgaben/attachments/published",
      expiresAt: null,
    });
    expect(publish).toHaveBeenCalledWith(CHUNK.ticket, PNG);
  });

  it("rejects corrupt, out-of-order and oversized binary output and clears unfinished copies", async () => {
    const publish = vi.fn();
    const uploads = new RunnerAssetUploads(publish);
    await expect(
      uploads.receive("attempt", { ...CHUNK, digest: "0".repeat(64) }),
    ).rejects.toMatchObject({ code: "parameter_asset_unavailable" });
    await expect(
      uploads.receive("attempt", { ...CHUNK, offset: 1 }),
    ).rejects.toMatchObject({ code: "parameter_asset_unavailable" });
    await expect(
      uploads.receive("attempt", {
        ...CHUNK,
        base64: Buffer.alloc(32769).toString("base64"),
      }),
    ).rejects.toMatchObject({ code: "parameter_asset_unavailable" });
    await uploads.receive("attempt", { ...CHUNK, done: false });
    uploads.close("attempt");
    await expect(
      uploads.receive("attempt", { ...CHUNK, offset: PNG.length }),
    ).rejects.toMatchObject({ code: "parameter_asset_unavailable" });
    expect(publish).not.toHaveBeenCalled();
  });
});

async function sendOutput(
  uploads: RunnerAssetUploads,
  ticket: string,
  bytes: Buffer,
): Promise<unknown> {
  const digest = createHash("sha256").update(bytes).digest("hex");
  let result: unknown;
  for (let offset = 0; offset < bytes.length; offset += 32768)
    result = await uploads.receive("attempt", {
      ticket,
      offset,
      digest,
      base64: bytes.subarray(offset, offset + 32768).toString("base64"),
      done: offset + 32768 >= bytes.length,
    });
  return result;
}

it("preserves output quota for response-loss replays with a new one-use ticket", async () => {
  const bytes = Buffer.alloc(6 * 1024 * 1024, 65);
  const publish = vi.fn(async () => ({
    assetId: "saved",
    link: "/aufgaben/attachments/saved",
    contentType: "text/plain",
    fileName: "result.txt",
    size: bytes.length,
    expiresAt: null,
  }));
  const uploads = new RunnerAssetUploads(publish);
  uploads.register("attempt", "first", "same-operation");
  expect(await sendOutput(uploads, "first", bytes)).toMatchObject({
    link: "/aufgaben/attachments/saved",
  });
  uploads.register("attempt", "retry", "same-operation");
  expect(await sendOutput(uploads, "retry", bytes)).toMatchObject({
    link: "/aufgaben/attachments/saved",
  });
  uploads.register("attempt", "other", "new-operation");
  await expect(
    sendOutput(uploads, "other", Buffer.alloc(5 * 1024 * 1024, 66)),
  ).rejects.toMatchObject({ code: "parameter_assets_too_large" });
  expect(publish).toHaveBeenCalledTimes(2);
});
