import { describe, expect, it } from "vitest";

import { parseLogoUpload } from "@/app/lib/settings-actions/logo-upload.server";
import { MAXIMUM_LOGO_BYTES } from "@/definition/Instance";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0];
const WEBP = [...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")];
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
);

function file(parts: BlobPart, type: string, name = "logo"): File {
  return new File([parts], name, { type });
}

describe("parseLogoUpload", () => {
  it.each([
    ["a PNG", file(new Uint8Array(PNG), "image/png")],
    ["a JPEG", file(new Uint8Array(JPEG), "image/jpeg")],
    ["a WebP image", file(new Uint8Array(WEBP), "image/webp")],
    ["an SVG", file(new Uint8Array(SVG), "image/svg+xml")],
  ])("accepts %s", async (_name, upload) => {
    const result = await parseLogoUpload(upload);

    expect(result).toMatchObject({
      logo: { mimeType: upload.type },
      status: "ready",
    });
  });

  it.each([
    [null],
    ["text"],
    [new File([], "empty.png", { type: "image/png" })],
  ])("reports %j as missing", async (value) => {
    await expect(parseLogoUpload(value)).resolves.toEqual({
      status: "missing",
    });
  });

  it.each([
    ["a type that is no logo type", file(new Uint8Array(PNG), "image/gif")],
    ["a PNG that is none", file(new Uint8Array(12), "image/png")],
    [
      "an SVG with a script",
      file(Buffer.from("<svg><script/></svg>"), "image/svg+xml"),
    ],
    [
      "a file over the limit",
      file(new Uint8Array(MAXIMUM_LOGO_BYTES + 1), "image/png"),
    ],
  ])("rejects %s", async (_name, upload) => {
    await expect(parseLogoUpload(upload)).resolves.toEqual({
      status: "invalid",
    });
  });
});
