import { describe, expect, it } from "vitest";

import { isSafeSvg } from "@/app/lib/settings-actions/svg-safety.server";

function svg(body: string, prefix = ""): Buffer {
  return Buffer.from(
    `${prefix}<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${body}</svg>`,
  );
}

describe("isSafeSvg", () => {
  it.each([
    ["plain shapes", svg('<rect width="10" height="10" fill="#f97316"/>')],
    [
      "an XML declaration and comments",
      svg(
        '<circle r="4"/>',
        '<?xml version="1.0" encoding="UTF-8"?>\n<!-- logo -->\n',
      ),
    ],
    [
      "an internal gradient",
      svg(
        '<defs><linearGradient id="a"/></defs><rect fill="url(#a)" width="1" height="1"/><use href="#a"/><use xlink:href=\'#a\'/>',
      ),
    ],
    [
      "an embedded raster image",
      svg('<image href="data:image/png;base64,AAAA"/>'),
    ],
    ["a stylesheet without references", svg("<style>.a{fill:red}</style>")],
  ])("accepts %s", (_name, data) => {
    expect(isSafeSvg(data)).toBe(true);
  });

  it.each([
    ["a script", svg("<script>alert(1)</script>")],
    [
      "a script behind a namespace prefix",
      svg("<svg:script>alert(1)</svg:script>"),
    ],
    ["a foreign object", svg("<foreignObject><div/></foreignObject>")],
    ["an iframe", svg('<iframe src="#a"/>')],
    [
      "an animation that rewrites a link",
      svg('<a><set attributeName="href" to="x"/></a>'),
    ],
    ["an event handler", svg('<rect onload="alert(1)"/>')],
    ["a javascript link", svg('<a href="javascript:alert(1)"><rect/></a>')],
    [
      "an entity-encoded link",
      svg('<a href="&#106;avascript:alert(1)"><rect/></a>'),
    ],
    [
      "a link to another site",
      svg('<image href="https://example.invalid/a.png"/>'),
    ],
    [
      "an embedded svg document",
      svg('<image href="data:image/svg+xml;base64,AAAA"/>'),
    ],
    [
      "a stylesheet import",
      svg("<style>@import 'https://example.invalid/a.css';</style>"),
    ],
    [
      "a stylesheet resource",
      svg('<rect style="fill:url(https://example.invalid/a)"/>'),
    ],
    ["a document type", svg("<rect/>", '<!DOCTYPE svg SYSTEM "x">')],
    ["an entity declaration", svg("<rect/>", '<!ENTITY a "b">')],
    [
      "a processing instruction",
      svg("<rect/>", '<?xml-stylesheet href="a.css"?>'),
    ],
    [
      "another text encoding",
      svg("<rect/>", '<?xml version="1.0" encoding="UTF-16"?>'),
    ],
    ["a null byte", Buffer.concat([svg("<rect/>"), Buffer.from([0])])],
    ["bytes that are no UTF-8", Buffer.from([0xff, 0xfe, 0x3c, 0x00])],
    ["no svg root", Buffer.from("<html><body/></html>")],
    ["an empty file", Buffer.alloc(0)],
  ])("rejects %s", (_name, data) => {
    expect(isSafeSvg(data)).toBe(false);
  });
});
