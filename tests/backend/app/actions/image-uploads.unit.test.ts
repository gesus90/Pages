import { describe, expect, it } from "vitest";

import { parseAvatarUpload } from "@/app/lib/settings-actions/avatar-upload.server";
import { parseLogoUpload } from "@/app/lib/settings-actions/logo-upload.server";
import { MAXIMUM_LOGO_BYTES } from "@/definition/Instance";
import { MAXIMUM_AVATAR_BYTES } from "@/definition/User";

import { jpegBytes, pngBytes, uploadedFile, webpBytes } from "./image-fixtures";

const SVG_MARKUP =
  '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';

function sizedPng(size: number): Uint8Array {
  return pngBytes(size);
}

describe("parseAvatarUpload", () => {
  it("accepts a valid image and keeps its type", async () => {
    const result = await parseAvatarUpload(
      uploadedFile(webpBytes(), "me.webp", "image/webp"),
    );

    expect(result).toMatchObject({
      status: "ready",
      avatar: { filename: "me.webp", mimeType: "image/webp" },
    });
  });

  it.each([null, undefined, "avatar.png", 42, {}])(
    "reports %j as missing",
    async (value) => {
      expect(await parseAvatarUpload(value)).toEqual({ status: "missing" });
    },
  );

  it("reports an empty file as missing", async () => {
    const empty = uploadedFile(new Uint8Array(0), "a.png", "image/png");

    expect(await parseAvatarUpload(empty)).toEqual({ status: "missing" });
  });

  it("rejects an unsupported type", async () => {
    const gif = uploadedFile(pngBytes(), "a.gif", "image/gif");
    const svg = uploadedFile(
      new TextEncoder().encode(SVG_MARKUP),
      "a.svg",
      "image/svg+xml",
    );

    expect(await parseAvatarUpload(gif)).toEqual({ status: "invalid" });
    expect(await parseAvatarUpload(svg)).toEqual({ status: "invalid" });
  });

  it("rejects content that does not match its announced type", async () => {
    const lying = uploadedFile(jpegBytes(), "a.png", "image/png");

    expect(await parseAvatarUpload(lying)).toEqual({ status: "invalid" });
  });

  it("limits the size to five mebibytes", async () => {
    const fitting = uploadedFile(
      sizedPng(MAXIMUM_AVATAR_BYTES),
      "a.png",
      "image/png",
    );
    const oversized = uploadedFile(
      sizedPng(MAXIMUM_AVATAR_BYTES + 1),
      "a.png",
      "image/png",
    );

    expect(await parseAvatarUpload(fitting)).toMatchObject({ status: "ready" });
    expect(await parseAvatarUpload(oversized)).toEqual({ status: "invalid" });
  });

  it("reduces the file name to harmless characters", async () => {
    const result = await parseAvatarUpload(
      uploadedFile(pngBytes(), "../../etc/pa ss<wd>.png", "image/png"),
    );

    expect(result).toMatchObject({
      status: "ready",
      avatar: { filename: "....etcpasswd.png" },
    });
  });

  it("falls back to a fixed name when nothing is left", async () => {
    const result = await parseAvatarUpload(
      uploadedFile(pngBytes(), "äöü/\\", "image/png"),
    );

    expect(result).toMatchObject({ avatar: { filename: "avatar" } });
  });
});

describe("parseLogoUpload", () => {
  it("accepts a raster logo", async () => {
    const result = await parseLogoUpload(
      uploadedFile(jpegBytes(), "logo.jpg", "image/jpeg"),
    );

    expect(result).toMatchObject({
      status: "ready",
      logo: { mimeType: "image/jpeg" },
    });
  });

  it("accepts a plain SVG logo", async () => {
    const result = await parseLogoUpload(
      uploadedFile(
        new TextEncoder().encode(SVG_MARKUP),
        "l.svg",
        "image/svg+xml",
      ),
    );

    expect(result).toMatchObject({
      status: "ready",
      logo: { mimeType: "image/svg+xml" },
    });
  });

  it("rejects an SVG with active content", async () => {
    const markup = SVG_MARKUP.replace("<rect", "<script>1</script><rect");
    const result = await parseLogoUpload(
      uploadedFile(new TextEncoder().encode(markup), "l.svg", "image/svg+xml"),
    );

    expect(result).toEqual({ status: "invalid" });
  });

  it("does not take a raster signature for an SVG", async () => {
    const result = await parseLogoUpload(
      uploadedFile(pngBytes(), "l.svg", "image/svg+xml"),
    );

    expect(result).toEqual({ status: "invalid" });
  });

  it("does not take SVG markup for a raster image", async () => {
    const markup = new TextEncoder().encode(SVG_MARKUP.padEnd(40, " "));
    const result = await parseLogoUpload(
      uploadedFile(markup, "l.png", "image/png"),
    );

    expect(result).toEqual({ status: "invalid" });
  });

  it("reports absent and empty values as missing", async () => {
    const empty = uploadedFile(new Uint8Array(0), "l.png", "image/png");

    expect(await parseLogoUpload(null)).toEqual({ status: "missing" });
    expect(await parseLogoUpload("logo")).toEqual({ status: "missing" });
    expect(await parseLogoUpload(empty)).toEqual({ status: "missing" });
  });

  it("limits the size to two mebibytes and the types to the supported ones", async () => {
    const fitting = uploadedFile(
      sizedPng(MAXIMUM_LOGO_BYTES),
      "l.png",
      "image/png",
    );
    const oversized = uploadedFile(
      sizedPng(MAXIMUM_LOGO_BYTES + 1),
      "l.png",
      "image/png",
    );
    const gif = uploadedFile(pngBytes(), "l.gif", "image/gif");

    expect(await parseLogoUpload(fitting)).toMatchObject({ status: "ready" });
    expect(await parseLogoUpload(oversized)).toEqual({ status: "invalid" });
    expect(await parseLogoUpload(gif)).toEqual({ status: "invalid" });
  });
});
