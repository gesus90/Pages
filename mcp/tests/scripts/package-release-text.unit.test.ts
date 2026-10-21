import { describe, expect, it } from "vitest";

import {
  assertNoSecrets,
  createReleaseManifest,
  parseReleaseTag,
  stampManifest,
  stampReadme,
} from "../../scripts/package-release.ts";

import type { ArchiveEntry } from "../../scripts/package-release.ts";

const TOKEN_SHAPED = "Q".repeat(43);
const BEARER_TOKEN = `Bearer ${"t".repeat(24)}`;
const NO_ENVIRONMENT: Readonly<Record<string, string | undefined>> = {};

const README = [
  "# Pages MCP 0.1.0",
  "",
  "Run `pages-mcp-v0.1.0.cjs` or keep a copy of pages-mcp-v0.1.0.cjs.",
  "Version 0.1.0 of other tools stays unchanged.",
].join("\n");
const SECRET = "s3cr3t-instance-value";

function textEntry(name: string, text: string): ArchiveEntry {
  return { name, content: Buffer.from(text, "utf8") };
}

function scanFailure(
  entries: readonly ArchiveEntry[],
  environment: Readonly<Record<string, string | undefined>> = NO_ENVIRONMENT,
): string {
  try {
    assertNoSecrets(entries, environment);
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

describe("parseReleaseTag", () => {
  it.each([
    ["mcp-v0.0.0", "0.0.0"],
    ["mcp-v1.2.3", "1.2.3"],
    ["mcp-v10.20.300", "10.20.300"],
  ])("returns the version of %s", (tag, version) => {
    expect(parseReleaseTag(tag)).toBe(version);
  });

  it.each([
    "",
    "v1.2.3",
    "mcp-1.2.3",
    "mcp-v1.2",
    "mcp-v1.2.3.4",
    "mcp-v01.2.3",
    "mcp-v1.02.3",
    "mcp-v1.2.03",
    "mcp-v1.2.3-beta",
    "mcp-v1.2.3\n",
    " mcp-v1.2.3",
    "refs/tags/mcp-v1.2.3",
  ])("rejects the tag %j", (tag) => {
    expect(() => parseReleaseTag(tag)).toThrow(
      "Release tags must have the form mcp-vMAJOR.MINOR.PATCH.",
    );
  });
});

describe("stampReadme", () => {
  it("replaces every title and bundle name with the release version", () => {
    expect(stampReadme(README, "0.1.0", "2.3.4")).toBe(
      [
        "# Pages MCP 2.3.4",
        "",
        "Run `pages-mcp-v2.3.4.cjs` or keep a copy of pages-mcp-v2.3.4.cjs.",
        "Version 0.1.0 of other tools stays unchanged.",
      ].join("\n"),
    );
  });

  it("rejects a README without the versioned title", () => {
    expect(() =>
      stampReadme("# Pages MCP\n\npages-mcp-v0.1.0.cjs", "0.1.0", "1.0.0"),
    ).toThrow("The README must name the package version and bundle file.");
  });

  it("rejects a README without the versioned bundle filename", () => {
    expect(() =>
      stampReadme(
        "# Pages MCP 0.1.0\n\npages-mcp-vX.Y.Z.cjs",
        "0.1.0",
        "1.0.0",
      ),
    ).toThrow("The README must name the package version and bundle file.");
  });

  it("rejects a README that names a different current version", () => {
    expect(() => stampReadme(README, "0.2.0", "1.0.0")).toThrow(
      "The README must name the package version and bundle file.",
    );
  });
});

describe("createReleaseManifest", () => {
  it("describes the dependency-free CommonJS bundle of the version", () => {
    const manifestText = createReleaseManifest("3.1.4");
    const manifest: unknown = JSON.parse(manifestText);

    expect(manifestText.endsWith("}\n")).toBe(true);
    expect(manifestText).toContain('\n  "name": "pages-mcp",');
    expect(manifest).toEqual({
      name: "pages-mcp",
      version: "3.1.4",
      license: "MIT",
      type: "commonjs",
      main: "pages-mcp-v3.1.4.cjs",
      engines: { node: ">=24.0.0" },
    });
  });
});

describe("stampManifest", () => {
  it("replaces only the version value and keeps the formatting", () => {
    const manifest =
      '{\n    "name": "pages-mcp",\n    "version":   "0.1.0",\n  "private": true\n}\n';

    expect(stampManifest(manifest, "1.2.3")).toEqual({
      text: '{\n    "name": "pages-mcp",\n    "version":   "1.2.3",\n  "private": true\n}\n',
      currentVersion: "0.1.0",
    });
  });

  it("stamps only the first version field", () => {
    const manifest =
      '{\n  "version": "0.1.0",\n  "engines": {\n    "version": "9.9.9"\n  }\n}';

    expect(stampManifest(manifest, "2.0.0").text).toBe(
      '{\n  "version": "2.0.0",\n  "engines": {\n    "version": "9.9.9"\n  }\n}',
    );
  });

  it.each([
    '{ "name": "pages-mcp" }',
    '{\n  "version": 1\n}',
    '{\n  "version": ""\n}',
  ])("rejects a manifest without a version string: %j", (manifest) => {
    expect(() => stampManifest(manifest, "1.0.0")).toThrow(
      "package.json must declare a version.",
    );
  });
});

describe("assertNoSecrets with environment values", () => {
  it.each(["PAGES_TOKEN", "PAGES_URL", "GITHUB_TOKEN", "GH_TOKEN"])(
    "rejects content that contains the value of %s without naming it",
    (variableName) => {
      const message = scanFailure(
        [textEntry("release/README.md", `configured: ${SECRET}`)],
        { [variableName]: SECRET },
      );

      expect(message).toBe(
        "release/README.md contains a configured environment value.",
      );
      expect(message).not.toContain(SECRET);
    },
  );

  it("checks environment values in files of every extension", () => {
    expect(
      scanFailure([textEntry("release/logo.png", SECRET)], {
        GH_TOKEN: SECRET,
      }),
    ).toBe("release/logo.png contains a configured environment value.");
  });

  it("ignores empty, missing and unrelated environment values", () => {
    expect(() =>
      assertNoSecrets([textEntry("release/README.md", "plain text")], {
        PAGES_TOKEN: "",
        PAGES_URL: undefined,
        HOME: "plain",
      }),
    ).not.toThrow();
  });

  it("accepts an empty list of entries", () => {
    expect(() => assertNoSecrets([], { PAGES_TOKEN: SECRET })).not.toThrow();
  });
});

describe("assertNoSecrets with token-shaped values", () => {
  it.each([
    ["release/README.md", `token ${TOKEN_SHAPED} end`],
    ["release/package.json", `{"token":"${TOKEN_SHAPED}"}`],
    ["release/codex-config.toml", `token = "${"_-a9".repeat(10)}abc"`],
    ["release/bundle.cjs.sha256", `${TOKEN_SHAPED}  bundle.cjs`],
    ["release/README.md", `Authorization: ${BEARER_TOKEN}`],
    ["release/bundle.cjs", `const token = "${TOKEN_SHAPED}";`],
    ["release/bundle.js", `const token = '${TOKEN_SHAPED}';`],
    ["release/bundle.cjs", `headers.authorization = "${BEARER_TOKEN}"`],
  ])("rejects %s with a token-shaped value", (name, text) => {
    expect(scanFailure([textEntry(name, text)])).toBe(
      `${name} contains a token-shaped value.`,
    );
  });

  it.each([
    ["release/README.md", `short ${"Q".repeat(42)} end`],
    ["release/README.md", `long ${"Q".repeat(44)} end`],
    ["release/README.md", `prefixed x.${"Q".repeat(42)} end`],
    ["release/README.md", "Bearer short-token"],
    ["release/bundle.cjs", `const unquoted = ${TOKEN_SHAPED};`],
    ["release/bundle.cjs", `exports["${"Q".repeat(42)}"] = 1;`],
    [
      "release/bundle.cjs",
      'name("ElicitationCompleteNotificationParamsSchema")',
    ],
    [
      "release/bundle.cjs",
      "name('SubscriptionsAcknowledgedNotificationSchema')",
    ],
    ["release/logo.png", TOKEN_SHAPED],
    ["release/LICENSE", BEARER_TOKEN],
  ])("accepts %s without a token-shaped value: %j", (name, text) => {
    expect(scanFailure([textEntry(name, text)])).toBe("");
  });

  it("names the first offending file in entry order", () => {
    expect(
      scanFailure([
        textEntry("release/a.md", "clean"),
        textEntry("release/b.md", TOKEN_SHAPED),
        textEntry("release/c.md", BEARER_TOKEN),
      ]),
    ).toBe("release/b.md contains a token-shaped value.");
  });
});

describe("assertNoSecrets with addresses", () => {
  it.each([
    "See https://pages.internal.example.org/wiki for details.",
    "Call http://10.0.0.12:3000 directly.",
    "Use HTTPS://Pages.Company.TEST/api.",
    "Use http://example.com.evil.org now.",
    "Broken http://[oops address.",
    "Mirror at http://[fe80::1]:3000/",
  ])("rejects the address in %j", (text) => {
    expect(scanFailure([textEntry("release/README.md", text)])).toBe(
      "release/README.md contains an address outside the placeholder hosts.",
    );
  });

  it.each([
    "PAGES_URL=http://127.0.0.1:3000",
    "PAGES_URL=http://localhost:3000/path?query=1#part",
    "PAGES_URL=http://[::1]:3000",
    "Visit https://example.com and https://pages.example.com/x.",
    "Docs: https://modelcontextprotocol.io/spec and https://github.com/org/repo",
    "Raw: https://raw.githubusercontent.com/org/repo/main/file",
    'Schema: "https://json-schema.org/draft/2020-12/schema"',
    "No address at all, only text.",
  ])("accepts the placeholder address text %j", (text) => {
    expect(scanFailure([textEntry("release/README.md", text)])).toBe("");
  });

  it("accepts the IPv6 URL template of the pinned SDK in the bundle", () => {
    expect(
      scanFailure([
        textEntry("release/bundle.cjs", "const url = `http://[${value}]`;"),
      ]),
    ).toBe("");
  });

  it("does not inspect addresses in files without a text extension", () => {
    expect(
      scanFailure([
        textEntry("release/logo.png", "https://pages.internal.example.org"),
      ]),
    ).toBe("");
  });
});
