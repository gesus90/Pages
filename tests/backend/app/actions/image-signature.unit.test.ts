import { describe, expect, it } from "vitest";

import { hasImageSignature } from "@/app/lib/settings-actions/image-signature.server";

import { jpegBytes, pngBytes, webpBytes } from "./image-fixtures";

describe("hasImageSignature", () => {
  it("accepts each type with its own magic bytes", () => {
    expect(hasImageSignature(Buffer.from(jpegBytes()), "image/jpeg")).toBe(
      true,
    );
    expect(hasImageSignature(Buffer.from(pngBytes()), "image/png")).toBe(true);
    expect(hasImageSignature(Buffer.from(webpBytes()), "image/webp")).toBe(
      true,
    );
  });

  it("rejects content announced as another type", () => {
    expect(hasImageSignature(Buffer.from(pngBytes()), "image/jpeg")).toBe(
      false,
    );
    expect(hasImageSignature(Buffer.from(jpegBytes()), "image/png")).toBe(
      false,
    );
    expect(hasImageSignature(Buffer.from(jpegBytes()), "image/webp")).toBe(
      false,
    );
  });

  it("rejects a RIFF container that is not WebP", () => {
    const wave = webpBytes();
    wave.set(new TextEncoder().encode("WAVE"), 8);

    expect(hasImageSignature(Buffer.from(wave), "image/webp")).toBe(false);
  });

  it("rejects files shorter than twelve bytes, even with a valid start", () => {
    expect(hasImageSignature(Buffer.from(jpegBytes(11)), "image/jpeg")).toBe(
      false,
    );
    expect(hasImageSignature(Buffer.from(jpegBytes(12)), "image/jpeg")).toBe(
      true,
    );
  });

  it.each(["image/gif", "image/svg+xml", "text/html", "", "IMAGE/PNG"])(
    "rejects the unsupported announced type %j",
    (mimeType) => {
      expect(hasImageSignature(Buffer.from(pngBytes()), mimeType)).toBe(false);
    },
  );

  it("rejects a script that claims to be an image", () => {
    const script = Buffer.from("<script>alert(1)</script>".padEnd(32, " "));

    expect(hasImageSignature(script, "image/png")).toBe(false);
    expect(hasImageSignature(script, "image/jpeg")).toBe(false);
    expect(hasImageSignature(script, "image/webp")).toBe(false);
  });
});
