import { expect, it } from "vitest";

import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { ProjectAccessDeniedError } from "@/backend/error/ProjectErrors";
import {
  WikiAccessDeniedError,
  WikiPageNotFoundError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";
import {
  diagnoseWikiImportSource,
  wikiImportErrorCode,
} from "@/backend/service/agents/WikiImportSourceService";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { WikiImportSource } from "@/backend/service/agents/WikiImportPackage";
import type { AgentImportPlan } from "@/definition/AgentImportManifest";

it.each([
  [new AgentOperationError("CONFLICT"), "CONFLICT"],
  [new WikiPageNotFoundError(), "NOT_FOUND"],
  [new WikiValidationError("titleRequired"), "INVALID_REQUEST"],
  [new McpAuthorizationError("invalid", 401), "AUTH_INVALID"],
  [new McpAuthorizationError("unavailable", 503), "AUTH_UNAVAILABLE"],
  [new WikiAccessDeniedError(), "FORBIDDEN"],
  [new ProjectAccessDeniedError(), "FORBIDDEN"],
  [new Error("database failed"), null],
] as const)(
  "maps anticipated import errors while preserving infrastructure failures",
  (error, expected) => {
    expect(wikiImportErrorCode(error)).toBe(expected);
  },
);

it("rejects missing pages and matching plan issues but leaves title collisions to the caller", () => {
  const source = partial<WikiImportSource>({
    sourceKey: "page.md",
    targetKey: "page",
    page: { title: "Page" },
  });
  const clean = partial<AgentImportPlan>({ errors: [], conflicts: [] });
  expect(() => diagnoseWikiImportSource(clean, source)).not.toThrow();
  expect(() =>
    diagnoseWikiImportSource(clean, { ...source, page: null }),
  ).toThrow();
  const issue = {
    code: "CONFLICT" as const,
    reason: "group_content_conflict" as const,
    sourceKeys: ["page.md"],
  };
  expect(() =>
    diagnoseWikiImportSource({ ...clean, conflicts: [issue] }, source),
  ).toThrow();
  expect(() =>
    diagnoseWikiImportSource(
      { ...clean, conflicts: [{ ...issue, reason: "title_conflict" }] },
      source,
    ),
  ).not.toThrow();
  expect(() =>
    diagnoseWikiImportSource(
      {
        ...clean,
        errors: [{ ...issue, targetKey: "other", sourceKeys: ["other.md"] }],
      },
      source,
    ),
  ).not.toThrow();
});
