import { describe, expect, it } from "vitest";

import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { readWikiImportManifest } from "@/backend/service/agents/WikiImportManifestReader";
import { readWikiImportUpdate } from "@/backend/service/agents/WikiImportUpdateReader";
import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";

import { importRequest } from "../helpers/wiki-import";

const request = {
  ...importRequest(),
  operationId: "update",
  fingerprint: "a".repeat(64),
  updates: [{ sourceKey: "new.md", expectedRevision: 1 }],
};

describe("wiki import update validation", () => {
  it("defaults overwrite to false and sorts entries without mutating the caller's package", () => {
    const input = {
      ...request,
      ...importRequest([
        { sourceKey: "a.md", content: "# A\r\n" },
        { sourceKey: "b.md", content: "# B" },
      ]),
      updates: [
        { sourceKey: "b.md", expectedRevision: 2, overwrite: true },
        { sourceKey: "a.md", expectedRevision: 1 },
      ],
    };
    expect(readWikiImportUpdate(input)).toEqual({
      ...input,
      updates: [
        { sourceKey: "a.md", expectedRevision: 1, overwrite: false },
        { sourceKey: "b.md", expectedRevision: 2, overwrite: true },
      ],
    });
    expect(input.updates[0]?.sourceKey).toBe("b.md");
    expect(readWikiImportUpdate(request).updates[0]?.overwrite).toBe(false);
  });

  it.each([null, undefined, [], "request", 1])(
    "rejects a non-record envelope %j",
    (input) => {
      expect(() => readWikiImportUpdate(input)).toThrow(AgentOperationError);
    },
  );

  it.each([
    { actor: {} },
    { operationId: undefined },
    { operationId: "" },
    { operationId: " " },
    { operationId: "x".repeat(201) },
    { fingerprint: 1 },
    { fingerprint: "A".repeat(64) },
    { fingerprint: "a".repeat(63) },
    { updates: null },
    { updates: [] },
    { updates: [null] },
    { updates: [1] },
    { updates: [[]] },
    { updates: [{ sourceKey: "new.md", expectedRevision: 1, extra: true }] },
    { updates: [{ sourceKey: 1, expectedRevision: 1 }] },
    { updates: [{ sourceKey: "new.md", expectedRevision: "1" }] },
    { updates: [{ sourceKey: "new.md", expectedRevision: 1.5 }] },
    { updates: [{ sourceKey: "new.md", expectedRevision: 0 }] },
    { updates: [{ sourceKey: "new.md", expectedRevision: Number.NaN }] },
    { updates: [{ sourceKey: "new.md", expectedRevision: 1, overwrite: 1 }] },
    { updates: [{ sourceKey: "missing.md", expectedRevision: 1 }] },
    { updates: request.updates.concat(request.updates) },
  ])("rejects malformed or injected fields %j", (fields) => {
    expect(() => readWikiImportUpdate({ ...request, ...fields })).toThrow(
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
  });

  it("rejects duplicate source keys even when the number of entries matches the loaded files", () => {
    expect(() =>
      readWikiImportUpdate({
        ...request,
        ...importRequest([
          { sourceKey: "new.md", content: "" },
          { sourceKey: "other.md", content: "" },
        ]),
        updates: request.updates.concat(request.updates),
      }),
    ).toThrow(AgentOperationError);
  });

  it("bounds the full update envelope in addition to the manifest", () => {
    const input = importRequest([
      { sourceKey: "a.md", content: '"'.repeat(16_000) },
      { sourceKey: "b.md", content: '"'.repeat(16_000) },
    ]);
    const index = Array.from({ length: 5 }, (_, position) => ({
      sourceKey: `${position}.md`,
      title: "x".repeat(180),
      titleSource: "explicit" as const,
    }));
    const plan = {
      ...input,
      manifest: {
        ...input.manifest,
        index: [...input.manifest.index, ...index],
      },
    };
    expect(readWikiImportManifest(plan)).toEqual(plan);
    expect(() =>
      readWikiImportUpdate({
        ...request,
        ...plan,
        operationId: "x".repeat(200),
        updates: input.manifest.files.map((file) => ({
          sourceKey: file.sourceKey,
          expectedRevision: 1,
          overwrite: false,
        })),
      }),
    ).toThrow(
      expect.objectContaining({
        code: "PAYLOAD_TOO_LARGE",
        details: {
          constraint: "requestBytes",
          limit: PAGES_AGENT_LIMITS.requestBytes,
        },
      }),
    );
  });
});
