import { expect, it, vi } from "vitest";

import { AgentRunArchive } from "@/backend/service/agents/AgentRunArchive";
import { writeArtifact } from "@/backend/service/agents/AgentArtifactPath";

import { notesRunFixture } from "./page78-notes-fixture";

import type { PageAgentRunRecord } from "@/definition/PageAgent";

vi.mock("@/backend/service/agents/AgentArtifactPath", () => ({
  artifactDirectory: vi.fn(),
  artifactExists: vi.fn(),
  requireArtifactId: vi.fn(),
  writeArtifact: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: () => {
    throw new Error("Notes must never be read by the archive");
  },
  readdir: () => {
    throw new Error("Notes must never be scanned by the archive");
  },
  rm: vi.fn(),
}));

it("archives only the sent prompt and answer, without reading any notes file", async () => {
  const { run, snapshot } = await notesRunFixture();
  const save = vi.fn(async (record: PageAgentRunRecord) => record);
  const archive = new AgentRunArchive(
    {
      pinInput: vi.fn(),
      findInput: async () => ({
        prompt: "Notes path: /notes/plan/run",
        startedAt: run.startedAt,
      }),
      find: vi.fn(),
      save,
      discardInput: vi.fn(),
      markArchived: vi.fn(),
      unarchived: vi.fn(),
      keys: vi.fn(),
      get: vi.fn(),
    },
    "/agents",
  );
  await archive.complete(
    {
      ...run,
      status: "succeeded",
      steps: [
        {
          id: "step",
          name: "Agent",
          status: "succeeded",
          output: "Finished",
          error: null,
          isBlocked: false,
          cancellation: "none",
        },
      ],
    },
    snapshot,
  );
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      input: "Notes path: /notes/plan/run",
      result: "Finished",
    }),
  );
  expect(writeArtifact).toHaveBeenCalledTimes(1);
  expect(vi.mocked(writeArtifact).mock.calls[0]?.[1]).toContain("Finished");
});
