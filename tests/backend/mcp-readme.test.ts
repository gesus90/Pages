import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readImportTitle } from "@/backend/service/agents/ImportMarkdownTitle";
import { readWikiImportManifest } from "@/backend/service/agents/WikiImportManifestReader";

const README = readFileSync(
  fileURLToPath(new URL("../../mcp/README.md", import.meta.url)),
  "utf8",
);
const DOCUMENTED_HOSTS = ["127.0.0.1", "::1", "localhost", "192.168.0.52"];
const IMPORT_PREVIEW = README.split("## Wiki import preview (A9.7)")[1]?.split(
  "## Wiki import application (A9.8)",
)[0];
const IMPORT_APPLICATION = README.split(
  "## Wiki import application (A9.8)",
)[1]?.split("## Updating imported wiki pages (A9.9)")[0];

describe("MCP README A9.7 preview contract", () => {
  it("provides a valid full-index example whose title claims match the supplied Markdown", () => {
    const example = IMPORT_PREVIEW?.match(/```json\n([\s\S]*?)\n```/)?.[1];
    if (example === undefined)
      throw new Error("Missing import preview example");
    const input: unknown = JSON.parse(example);
    const parsed = readWikiImportManifest(input);
    expect(parsed.parentId).toBeNull();
    expect(parsed.manifest.index).toEqual(
      parsed.manifest.files.map(readImportTitle),
    );
  });

  it("documents stateless read-only planning, complete repeated indexes and provisional content", () => {
    expect(IMPORT_PREVIEW).toContain(
      "`plan_wiki_import` calls `wiki.import.plan`",
    );
    expect(IMPORT_PREVIEW).toContain(
      "no plan, operation key, page, revision,\nvisit, favorite, attachment or source mapping is saved",
    );
    expect(IMPORT_PREVIEW).toContain("Assets are never fetched\nor uploaded");
    expect(IMPORT_PREVIEW).toContain(
      "First send the full index with `files:[]`",
    );
    expect(IMPORT_PREVIEW).toContain("Repeat that complete index in every");
    expect(IMPORT_PREVIEW).toContain(
      "An index-only H1/explicit claim remains provisional until its content arrives",
    );
    expect(IMPORT_PREVIEW).toContain(
      "A valid plan or fingerprint is not permission",
    );
  });

  it("documents UTF-8 package limits, neutral target failures and fresh state fingerprints", () => {
    for (const limit of [
      "128",
      "32",
      "16,384",
      "32,768",
      "512",
      "65,536",
      "1,048,576",
    ])
      expect(IMPORT_PREVIEW).toContain(limit);
    expect(IMPORT_PREVIEW).toContain(
      "including the index, JSON\nescapes and envelope",
    );
    expect(IMPORT_PREVIEW).toContain('"Not found or no access."');
    expect(IMPORT_PREVIEW).toContain(
      "Hidden sibling names, IDs and counts do not appear",
    );
    expect(IMPORT_PREVIEW).toContain(
      "visible ancestor revisions, direct visible sibling",
    );
    expect(IMPORT_PREVIEW).toContain("current write availability");
    expect(IMPORT_PREVIEW).toContain("Nothing is persisted");
  });
});

describe("MCP README A9.8 application contract", () => {
  it("documents confirmed plans, owner-bound recovery, independently committed outcomes and no overwrite", () => {
    for (const contract of [
      "`apply_wiki_import` calls `wiki.import.apply`",
      "`{operationId,fingerprint,projectId,parentId,manifest,assets?}`",
      "A stale fingerprint returns `CONFLICT` without creating a run or pages",
      "Index/file/asset list order is immaterial",
      "A running replay processes only sources without a committed outcome",
      "Import a directory's README/index content before packages",
      "A rollback removes copied attachment bytes",
      "preserves staged assets. Markdown remains exact",
      "an infrastructure interruption leaves the run `running`",
      "No source overwrites page content or produces an update revision",
      "Saved IDs are checked for current visibility before any replay",
      "Apply has a thirty-second MCP budget",
    ])
      expect(IMPORT_APPLICATION).toContain(contract);
  });
});

describe("MCP README A9.10 granular wiki contract", () => {
  it("documents separate fields, explicit moves, revision protection and recoverable results", () => {
    const section = README.split(
      "## Single-field wiki operations (A9.10)",
    )[1]?.split("## Tickets and milestones (A9.11)")[0];
    for (const contract of [
      "`set_wiki_page_title`",
      "`wiki.page.setTitle`",
      "`set_wiki_page_content`",
      "`wiki.page.setContent`",
      "`set_wiki_page_icon`",
      "`wiki.page.setIcon`",
      "`move_wiki_page`",
      "`wiki.page.move`",
      "`operationId`, `pageId` and `expectedRevision`",
      "Each\n  change keeps the previous state as its own page version",
      "The move\n  keeps the revision",
      "A refused call stores nothing",
      "returns `CONFLICT` and nothing\n  is written",
      "`NOT_FOUND`",
      "`FORBIDDEN`",
      "`INVALID_REQUEST`",
      "100% statements, branches, functions and lines",
      "Type-only contracts have\nno executable coverage counters",
    ])
      expect(section).toContain(contract);
  });
});

describe("MCP README A9.6 contracts", () => {
  it("documents the separate binary transport, one-use capability and staging lifetime", () => {
    expect(README).toContain("## Assets and single-page creation (A9.6)");
    expect(README).toContain('header:"X-Pages-Upload-Ticket"');
    expect(README).toContain('uploadPath:"/api/v1/agent-assets"');
    expect(README).toContain("preserving any deployment prefix");
    expect(README).toContain("without an Authorization header or query string");
    expect(README).toContain("one-use, expire after five minutes");
    expect(README).toContain("File bytes never enter MCP or Agent-API JSON");
    expect(README).toContain("Unlinked assets become unusable after 24 hours");
    expect(README).toContain(
      "including PDF, SVG and HTML, download as `application/octet-stream`",
    );
  });

  it("documents explicit destinations, recoverable creation and public business failures", () => {
    expect(README).toContain(
      "`{operationId,projectId,parentId,title,content,icon,assetIds}`",
    );
    expect(README).toContain("`parentId:null`");
    expect(README).toContain("At most 100 owned, staged, unexpired asset IDs");
    expect(README).toContain(
      "including after response loss or concurrent calls",
    );
    expect(README).toContain(
      "Changed input with the same key returns `CONFLICT` (409)",
    );
    expect(README).toContain(
      "Foreign/missing/expired assets or hidden destinations return `NOT_FOUND` (404)",
    );
    expect(README).toContain("No failed create leaves an operation row");
    expect(README).toContain(
      "notifications contain only type and ID and are published after commit",
    );
  });
});

describe("MCP README remote operation", () => {
  it("documents a loopback listener behind an HTTPS reverse proxy for public remote access", () => {
    expect(README).toContain(
      "### Remote operation behind an HTTPS reverse proxy",
    );
    expect(README).toContain("TLS ends at a trusted reverse proxy");
    expect(README).toContain(
      "For public remote access, keep the listener on loopback",
    );
    expect(README).toContain("`/.well-known/oauth-protected-resource`");
    expect(README).toContain("proxy_set_header Host $http_host;");
    expect(README).toContain("proxy_pass http://127.0.0.1:8998;");
  });

  it("uses only loopback or the private intranet address in host examples", () => {
    const hostValues = [...README.matchAll(/--host\s+([^\s`,;)]+)/g)].map(
      (match) => match[1],
    );
    expect(hostValues.length).toBeGreaterThan(0);
    for (const value of hostValues) {
      const alternatives = value.split("|");
      expect(
        alternatives.every((entry) => DOCUMENTED_HOSTS.includes(entry)),
        value,
      ).toBe(true);
    }
  });

  it("documents intranet HTTP with a port and the unchanged OAuth limitation", () => {
    expect(README).toContain("### Intranet-Betrieb (HTTP)");
    expect(README).toContain(
      "--host 192.168.0.52 --port 8998 --resource http://192.168.0.52:8998/mcp",
    );
    expect(README).toContain("`PAGES_URL` verlangt weiterhin HTTPS");
    expect(README).toContain("HTTP-URL als `PAGES_MCP_RESOURCE` weiterhin ab");
    expect(README).toContain(
      "HTTPS für den direkten Intranet-Betrieb folgt später",
    );
    for (const range of ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]) {
      expect(README).toContain(range);
    }
  });

  it("does not recommend wildcard binding, public HTTP resources or tokens in URLs", () => {
    expect(README).not.toMatch(/listen\s+0\.0\.0\.0/);
    expect(README).not.toMatch(
      /http:\/\/(?!127\.0\.0\.1|localhost|\[::1\]|192\.168\.0\.52)[a-z0-9.-]+(?::\d+)?\/mcp/i,
    );
    expect(README).toContain("never put tokens into URLs or logs");
  });

  it("states the release process without a bot commit or npm package", () => {
    expect(README).toContain(
      "nothing is committed to `main`, and no npm package is published",
    );
    expect(README).toContain("mcp-vMAJOR.MINOR.PATCH");
  });
});
