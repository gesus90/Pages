import { describe, expect, it } from "vitest";

import { operationFailure } from "../../../src/tools/operation-failure.ts";

const ISSUE = { nodeId: "node", port: "ticket", problem: "remoteAssetRunner" };
const ASSET = {
  id: "attachment",
  name: "banner.webp",
  cause: "parameter_asset_unavailable",
};

async function finding(asset: unknown): ReturnType<typeof operationFailure> {
  return operationFailure(
    Response.json(
      {
        apiVersion: "1",
        error: {
          code: "INVALID_REQUEST",
          details: { reason: "graph_invalid", issues: [{ ...ISSUE, asset }] },
        },
      },
      { status: 400 },
    ),
  );
}

describe("asset-specific plan failures", () => {
  it("preserves safe file identity, name and whitelisted cause", async () => {
    expect((await finding({ ...ASSET, secret: "omitted" }))?.details).toEqual({
      reason: "graph_invalid",
      issues: [{ ...ISSUE, asset: ASSET }],
    });
  });

  it.each([
    undefined,
    null,
    1,
    {},
    { ...ASSET, id: 1 },
    { ...ASSET, id: "a".repeat(101) },
    { ...ASSET, name: 1 },
    { ...ASSET, name: "a".repeat(301) },
    { ...ASSET, cause: 1 },
    { ...ASSET, cause: "provider-private-output" },
  ])(
    "omits unsafe file details %j while keeping the actionable graph cause",
    async (asset) => {
      expect((await finding(asset))?.details).toEqual({
        reason: "graph_invalid",
        issues: [ISSUE],
      });
    },
  );
});
