import { describe, expect, it } from "vitest";

import {
  diagnoseWikiImportSource,
  wikiImportErrorCode,
} from "@/backend/service/agents/WikiImportSourceService";
import {
  wikiImportOperationFingerprint,
  wikiImportPackage,
  wikiImportSourceFingerprint,
  wikiImportSourceKey,
} from "@/backend/service/agents/WikiImportPackage";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { ProjectAccessDeniedError } from "@/backend/error/ProjectErrors";
import {
  WikiAccessDeniedError,
  WikiPageNotFoundError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";
import { AGENT_IMPORT_LIMITS } from "@/definition/AgentImportManifest";

import { importRequest } from "../helpers/wiki-import";

import type { WikiImportSource } from "@/backend/service/agents/WikiImportPackage";
import type { AgentImportApplyInput } from "@/definition/AgentImportApply";
import type {
  AgentImportPage,
  AgentImportPlan,
} from "@/definition/AgentImportManifest";

const input: AgentImportApplyInput = {
  ...importRequest(),
  operationId: "import",
  fingerprint: "a".repeat(64),
  assets: [],
};
const page: AgentImportPage = {
  key: "file:new.md",
  title: "new",
  titleSource: "filename",
  sourceKeys: ["new.md"],
  isDirectory: false,
  contentBytes: 4,
  level: 1,
  action: "create",
};
const source: WikiImportSource = {
  sourceKey: "new.md",
  targetKey: page.key,
  page,
  ordinal: 0,
};

function plan(overrides: Partial<AgentImportPlan> = {}): AgentImportPlan {
  return {
    projectId: "alpha",
    parentId: null,
    fingerprint: input.fingerprint,
    pages: [page],
    edges: [{ childKey: page.key, parent: { kind: "existing", pageId: null } }],
    errors: [],
    conflicts: [],
    assets: [],
    contentComplete: true,
    valid: true,
    limits: AGENT_IMPORT_LIMITS,
    externalEffects: [],
    ...overrides,
  };
}

describe("deterministic import package selection", () => {
  it("includes only loaded content and required empty ancestors in parent-first order", () => {
    const directory: AgentImportPage = {
      ...page,
      key: "directory:group",
      title: "group",
      sourceKeys: [],
      isDirectory: true,
      titleSource: "directory",
    };
    const group: AgentImportPage = {
      ...directory,
      key: "directory:root",
      sourceKeys: ["root/README.md"],
    };
    const child = { ...page, sourceKeys: ["new.md", "unloaded.md"] };
    const preview = plan({
      pages: [
        group,
        directory,
        child,
        child,
        { ...page, key: "unloaded", sourceKeys: ["elsewhere.md"] },
      ],
      edges: [
        { childKey: page.key, parent: { kind: "planned", key: directory.key } },
        {
          childKey: directory.key,
          parent: { kind: "planned", key: group.key },
        },
        { childKey: group.key, parent: { kind: "existing", pageId: null } },
      ],
    });
    expect(wikiImportPackage(input, preview)).toEqual([
      {
        sourceKey: directory.key,
        targetKey: directory.key,
        page: directory,
        ordinal: 0,
      },
      { ...source, page: child, ordinal: 1 },
    ]);
    expect(wikiImportSourceKey(directory)).toBe(directory.key);
    expect(wikiImportSourceKey(group)).toBe("root/README.md");
  });

  it("retains unmapped invalid sources, sorted and diagnosed, and tolerates a missing planned parent", () => {
    const request = {
      ...input,
      ...importRequest([
        { sourceKey: "z.md", content: "" },
        { sourceKey: "a.md", content: "" },
      ]),
    };
    expect(wikiImportPackage(request, plan({ pages: [] }))).toEqual([
      { sourceKey: "a.md", targetKey: "file:a.md", page: null, ordinal: 0 },
      { sourceKey: "z.md", targetKey: "file:z.md", page: null, ordinal: 1 },
    ]);
    expect(
      wikiImportPackage(
        input,
        plan({
          edges: [
            { childKey: page.key, parent: { kind: "planned", key: "missing" } },
          ],
        }),
      ),
    ).toEqual([source]);
    expect(
      wikiImportPackage(
        { ...input, manifest: { ...input.manifest, files: [] } },
        plan(),
      ),
    ).toEqual([]);
  });

  it("hashes canonical operations independently of their retry ID and binds exact content, placement and assets", () => {
    const hash = wikiImportOperationFingerprint(input);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      wikiImportOperationFingerprint({ ...input, operationId: "retry" }),
    ).toBe(hash);
    for (const changed of [
      { ...input, fingerprint: "b".repeat(64) },
      { ...input, assets: [{ sourceKey: "new.md", assetIds: ["asset"] }] },
    ])
      expect(wikiImportOperationFingerprint(changed)).not.toBe(hash);
    const parent = { kind: "existing", pageId: null } as const;
    const baseline = wikiImportSourceFingerprint(input, source, parent);
    expect(
      wikiImportSourceFingerprint(input, { ...source, page: null }, parent),
    ).not.toBe(baseline);
    expect(
      wikiImportSourceFingerprint(
        input,
        { ...source, sourceKey: "directory:group" },
        parent,
      ),
    ).not.toBe(baseline);
    expect(
      wikiImportSourceFingerprint(input, source, {
        kind: "planned",
        key: "group",
      }),
    ).not.toBe(baseline);
    expect(
      wikiImportSourceFingerprint(
        {
          ...input,
          assets: [
            { sourceKey: "else.md", assetIds: [] },
            { sourceKey: "new.md", assetIds: ["asset"] },
          ],
        },
        source,
        parent,
      ),
    ).not.toBe(baseline);
  });
});

describe("import source diagnostics", () => {
  it("leaves title collisions to mapping comparison and rejects matching diagnostics only", () => {
    expect(() =>
      diagnoseWikiImportSource(plan(), { ...source, page: null }),
    ).toThrow(AgentOperationError);
    expect(() =>
      diagnoseWikiImportSource(
        plan({
          conflicts: [
            {
              code: "CONFLICT",
              reason: "title_conflict",
              targetKey: source.targetKey,
              sourceKeys: [source.sourceKey],
            },
          ],
          errors: [
            {
              code: "INVALID_REQUEST",
              reason: "invalid_path",
              sourceKeys: ["else.md"],
            },
          ],
        }),
        source,
      ),
    ).not.toThrow();
    for (const issue of [
      {
        code: "CONFLICT",
        reason: "group_content_conflict",
        targetKey: source.targetKey,
        sourceKeys: [],
      },
      {
        code: "INVALID_REQUEST",
        reason: "invalid_path",
        sourceKeys: [source.sourceKey],
      },
    ] as const)
      expect(() =>
        diagnoseWikiImportSource(plan({ errors: [issue] }), source),
      ).toThrow(expect.objectContaining({ code: issue.code }));
  });

  it.each([
    [new AgentOperationError("CONFLICT"), "CONFLICT"],
    [new WikiPageNotFoundError(), "NOT_FOUND"],
    [new WikiValidationError("invalidParent"), "INVALID_REQUEST"],
    [new McpAuthorizationError("invalid_token", 503), "AUTH_UNAVAILABLE"],
    [new McpAuthorizationError("invalid_token", 401), "AUTH_INVALID"],
    [new WikiAccessDeniedError(), "FORBIDDEN"],
    [new ProjectAccessDeniedError(), "FORBIDDEN"],
    [new Error("storage"), null],
    [null, null],
  ])("translates only anticipated errors %j", (error, code) => {
    expect(wikiImportErrorCode(error)).toBe(code);
  });
});
