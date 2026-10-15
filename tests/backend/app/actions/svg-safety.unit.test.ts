import { describe, expect, it } from "vitest";

import { isSafeSvg } from "@/app/lib/settings-actions/svg-safety.server";

const OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">';

function svg(body: string): string {
  return `${OPEN}${body}</svg>`;
}

function check(markup: string): boolean {
  return isSafeSvg(Buffer.from(markup, "utf8"));
}

describe("isSafeSvg accepts plain artwork", () => {
  it.each([
    ["a shape", svg('<rect width="10" height="10" fill="#f97316"/>')],
    ["an XML declaration", `<?xml version="1.0" encoding="UTF-8"?>${svg("")}`],
    ["a declaration without encoding", `<?xml version="1.0"?>\n${svg("")}`],
    ["a leading comment", `<!-- logo -->${svg("")}`],
    ["a leading blank", `  \n${svg("")}`],
    ["a gradient reference", svg('<rect fill="url(#g)"/><use href="#g"/>')],
    ["a quoted gradient reference", svg("<rect style=\"fill:url('#g')\"/>")],
    [
      "an inline raster image",
      svg('<image href="data:image/png;base64,iVBORw0KGgo="/>'),
    ],
    ["a style rule without references", svg("<style>rect{fill:red}</style>")],
    ["a UTF-8 byte order mark", `﻿${svg("")}`],
  ])("%s", (caseName, markup) => {
    expect(check(markup)).toBe(true);
  });
});

describe("isSafeSvg rejects active content", () => {
  it.each([
    ["a script", svg("<script>alert(1)</script>")],
    ["an upper-case script", svg("<SCRIPT>alert(1)</SCRIPT>")],
    ["a prefixed script", svg("<svg:script>alert(1)</svg:script>")],
    ["a script with attributes", svg('<script\ttype="x">1</script>')],
    ["a script in CDATA", svg("<![CDATA[<script>1</script>]]>")],
    ["a foreignObject", svg("<foreignObject><div/></foreignObject>")],
    ["an iframe", svg("<iframe src='#x'/>")],
    ["an embed", svg("<embed/>")],
    ["an object", svg("<object/>")],
    ["an audio element", svg("<audio/>")],
    ["a video element", svg("<video/>")],
    ["an animate element", svg('<animate attributeName="href"/>')],
    ["a set element", svg('<set attributeName="href" to="x"/>')],
    ["a handler element", svg("<handler/>")],
    ["a listener element", svg("<listener/>")],
    ["an event attribute", svg('<rect onclick="alert(1)"/>')],
    ["an upper-case event attribute", svg('<rect ONLOAD = "x"/>')],
    ["an event attribute on the root", `<svg onload="x" xmlns="x"></svg>`],
    ["a javascript link", svg('<a href="javascript:alert(1)"><rect/></a>')],
    ["an entity-obfuscated link", svg('<a href="java&#115;cript:alert(1)"/>')],
    ["a tab-obfuscated link", svg('<a href="java\tscript:alert(1)"/>')],
    ["a javascript text", svg("<text>javascript:alert(1)</text>")],
  ])("%s", (caseName, markup) => {
    expect(check(markup)).toBe(false);
  });
});

describe("isSafeSvg rejects external references", () => {
  it.each([
    ["an https image", svg('<image href="https://evil.invalid/x.png"/>')],
    ["a protocol-relative image", svg('<image href="//evil.invalid/x.png"/>')],
    ["a relative file", svg('<image href="logo.png"/>')],
    ["an xlink image", svg('<image xlink:href="http://evil.invalid/x"/>')],
    ["an inline HTML document", svg('<image href="data:text/html,<b>x</b>"/>')],
    [
      "an inline SVG document",
      svg('<image href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="/>'),
    ],
    ["a src attribute", svg('<image src="https://evil.invalid/x"/>')],
    [
      "a stylesheet url",
      svg('<rect style="fill:url(https://evil.invalid/p)"/>'),
    ],
    [
      "a quoted stylesheet url",
      svg("<style>rect{fill:url('//evil.invalid')}</style>"),
    ],
    [
      "a style import",
      svg("<style>@import url(//evil.invalid/a.css);</style>"),
    ],
    ["an upper-case import", svg("<style>@IMPORT 'a.css';</style>")],
  ])("%s", (caseName, markup) => {
    expect(check(markup)).toBe(false);
  });

  it("rejects a mixed document when one reference is external", () => {
    const markup = svg('<use href="#a"/><image href="https://evil.invalid/"/>');

    expect(check(markup)).toBe(false);
  });
});

describe("isSafeSvg rejects documents that are not plain svg", () => {
  it.each([
    ["an empty file", ""],
    ["plain text", "hello"],
    ["an HTML page", "<html><body></body></html>"],
    ["an svg inside HTML", "<html><svg></svg></html>"],
    ["text before the root", `text${svg("")}`],
    ["a different root", "<svgx></svgx>"],
    ["a document type", `<!DOCTYPE svg PUBLIC "x" "y">${svg("")}`],
    ["an entity declaration", `<!DOCTYPE svg [<!ENTITY a "b">]>${svg("&a;")}`],
    ["a stylesheet instruction", `<?xml-stylesheet href="a.css"?>${svg("")}`],
    [
      "a legacy encoding",
      `<?xml version="1.0" encoding="ISO-8859-1"?>${svg("")}`,
    ],
    [
      "a single-quoted legacy encoding",
      `<?xml version='1.0' encoding='utf-16'?>${svg("")}`,
    ],
    ["a NUL byte", svg("\u0000<script>1</script>")],
  ])("%s", (caseName, markup) => {
    expect(check(markup)).toBe(false);
  });

  it("rejects bytes that are not UTF-8", () => {
    const invalid = Buffer.concat([
      Buffer.from(OPEN),
      Buffer.from([0xff, 0xfe]),
      Buffer.from("</svg>"),
    ]);

    expect(isSafeSvg(invalid)).toBe(false);
  });

  it("rejects UTF-16 text that would hide markup from the checks", () => {
    const utf16 = Buffer.from(`﻿${svg("<script>1</script>")}`, "utf16le");

    expect(isSafeSvg(utf16)).toBe(false);
  });
});
