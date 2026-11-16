import { Readable } from "node:stream";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { PlanAssetReferences } from "@/backend/service/agents/assets/PlanAssetReferences";

const describe = vi.fn();
const open = vi.fn();
const references = new PlanAssetReferences(
  { describe, open },
  Buffer.from("test secret"),
);
const input = {
  assetId: "asset",
  digest: "digest",
  runId: "run",
  stepId: "step",
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01"));
  vi.resetAllMocks();
  describe.mockResolvedValue({});
  open.mockResolvedValue({
    record: {
      digest: "digest",
      fileName: "file.txt",
      mediaType: "text/plain",
      size: 5,
    },
    stream: Readable.from(["hello"]),
  });
});
afterEach(() => vi.useRealTimers());

it("issues a signed reference and rechecks access on redemption", async () => {
  const reference = await references.issue("user", input);
  const file = await references.redeem(reference);
  expect(file).toMatchObject({
    assetId: "asset",
    fileName: "file.txt",
    size: 5,
  });
  expect(describe).toHaveBeenCalledWith("user", "asset");
  expect(open).toHaveBeenCalledWith("user", "asset");
  file.stream.destroy();
});

it("rejects forged, expired and explicitly denied references", async () => {
  const reference = await references.issue("user", input);
  await expect(references.redeem(`${reference}x`)).rejects.toThrow();
  const denied = new PlanAssetReferences(
    { describe, open },
    Buffer.from("test secret"),
    { isDenied: true },
  );
  await expect(denied.redeem(reference)).rejects.toThrow();
  vi.advanceTimersByTime(300_001);
  await expect(references.redeem(reference)).rejects.toThrow();
  expect(open).not.toHaveBeenCalled();
});

it("destroys changed content and hides revoked access", async () => {
  const reference = await references.issue("user", input);
  const stream = Readable.from(["changed"]);
  open.mockResolvedValueOnce({ record: { digest: "changed" }, stream });
  await expect(references.redeem(reference)).rejects.toThrow();
  expect(stream.destroyed).toBe(true);
  open.mockRejectedValueOnce(new AgentError("plan_asset_missing"));
  await expect(references.redeem(reference)).rejects.toThrow();
});
