import { expect, it } from "vitest";

import { detectTicketFileType } from "./TicketFileType";

it.each([
  ["%PDF-1.7", "application/pdf", "pdf"],
  [
    "\uFEFF  <?xml version='1.0'?><!-- note --><svg viewBox='0 0'>",
    "image/svg+xml",
    "svg",
  ],
  [" <!DOCTYPE html><html>", "text/html", "html"],
  [" <html lang='en'>", "text/html", "html"],
  ["plain text", "application/octet-stream", "bin"],
])("detects %s by content", (text, contentType, extension) => {
  expect(detectTicketFileType(Buffer.from(text))).toEqual({
    kind: "file",
    isEmbeddable: false,
    contentType,
    extension,
  });
});

it("keeps raster images embeddable and assigns their extension", () => {
  expect(
    detectTicketFileType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])),
  ).toEqual({
    kind: "media",
    isEmbeddable: true,
    contentType: "image/png",
    extension: "png",
  });
});
