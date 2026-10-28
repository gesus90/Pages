import { expect, it } from "vitest";

import { AGENT_IMPORT_LIMITS } from "@/definition/AgentImportManifest";

it("bounds an import package by entries, files and file size", () => {
  expect(AGENT_IMPORT_LIMITS).toMatchObject({
    indexEntries: 128,
    files: 32,
    fileBytes: 16_384,
  });
});
