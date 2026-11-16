import { createHash } from "node:crypto";

import { expect, it, vi } from "vitest";

import { RunnerAssetUploads } from "@/backend/service/runner/RunnerAssetUploads";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentAsset } from "@/definition/PagesAgentWrites";

it("publishes only a complete sequential upload matching its digest", async () => {
  const publish = vi.fn(async () => partial<AgentAsset>({ assetId: "asset" }));
  const uploads = new RunnerAssetUploads(publish);
  const digest = createHash("sha256").update("hello").digest("hex");
  uploads.register("attempt", "ticket", "operation", "result.txt");
  expect(uploads.fileName("attempt", "ticket")).toBe("result.txt");
  await expect(
    uploads.receive("attempt", {
      ticket: "ticket",
      offset: 0,
      base64: Buffer.from("hel").toString("base64"),
      done: false,
      digest,
    }),
  ).resolves.toEqual({ offset: 3 });
  await expect(
    uploads.receive("attempt", {
      ticket: "ticket",
      offset: 3,
      base64: Buffer.from("lo").toString("base64"),
      done: true,
      digest,
    }),
  ).resolves.toMatchObject({ assetId: "asset" });
  expect(publish).toHaveBeenCalledWith("ticket", Buffer.from("hello"));
  uploads.close("attempt");
  expect(uploads.fileName("attempt", "ticket")).toBe("output");
});

it("rejects invalid sequence, noncanonical encoding and changed content", async () => {
  const publish = vi.fn(async () => partial<AgentAsset>({}));
  const uploads = new RunnerAssetUploads(publish);
  const input = {
    ticket: "ticket",
    offset: 1,
    base64: "YQ==",
    done: true,
    digest: "wrong",
  };
  await expect(uploads.receive("attempt", input)).rejects.toMatchObject({
    code: "parameter_asset_unavailable",
  });
  await expect(
    uploads.receive("attempt", { ...input, offset: 0, base64: "YQ" }),
  ).rejects.toMatchObject({ code: "parameter_asset_unavailable" });
  await expect(
    uploads.receive("attempt", { ...input, offset: 0 }),
  ).rejects.toMatchObject({ code: "parameter_asset_unavailable" });
  expect(publish).not.toHaveBeenCalled();
});
