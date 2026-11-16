import { beforeEach, expect, it, vi } from "vitest";

import { startLocalSessionOwner } from "@/backend/agents/local/LocalSessionOwner";
import { readLocalRecord } from "@/backend/agents/local/LocalSessionFiles";

vi.mock("@/backend/agents/local/LocalSessionFiles", () => ({
  readLocalRecord: vi.fn(),
  writeLocalRecord: vi.fn(),
}));

const id = "123e4567-e89b-42d3-a456-426614174000";
const manifest = {
  version: 1,
  instanceKey: "a".repeat(64),
  capability: "b".repeat(64),
  configPath: "/instance/config.json",
  directory: "/instance/session",
  unit: `pages-local-${id}.service`,
  launch: {
    runId: id,
    stepId: "step",
    sessionScopeId: "scope",
    attemptId: id,
    turnId: id,
    isInstruction: false,
    instanceId: id,
    userId: id,
    prompt: "hello",
    instruction: "",
    resumeSessionId: null,
    timeoutMinutes: 1,
    mcp: null,
  },
};
const args = [
  "--config",
  manifest.configPath,
  "--directory",
  manifest.directory,
];

beforeEach(() => vi.resetAllMocks());

it("rejects malformed owner arguments before reading any records", async () => {
  for (const input of [
    [],
    ["--config", "relative", "--directory", "/x"],
    ["--directory", "/x", "--config", "/y"],
  ]) {
    await expect(startLocalSessionOwner(input)).rejects.toThrow(
      /Invalid local owner/,
    );
  }
  expect(readLocalRecord).not.toHaveBeenCalled();
});

it("refuses to reuse a claimed owner and rejects a mismatched binding", async () => {
  vi.mocked(readLocalRecord)
    .mockResolvedValueOnce(manifest)
    .mockResolvedValueOnce({});
  await expect(startLocalSessionOwner(args)).rejects.toThrow("already claimed");
  const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
  vi.mocked(readLocalRecord)
    .mockResolvedValueOnce({ ...manifest, directory: "/other" })
    .mockRejectedValueOnce(missing);
  await expect(startLocalSessionOwner(args)).rejects.toThrow(
    "binding mismatch",
  );
});

it("propagates control record errors instead of treating them as an unclaimed session", async () => {
  vi.mocked(readLocalRecord)
    .mockResolvedValueOnce(manifest)
    .mockRejectedValueOnce(new Error("permission denied"));
  await expect(startLocalSessionOwner(args)).rejects.toThrow(
    "permission denied",
  );
});
