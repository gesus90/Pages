import { expect, it, vi } from "vitest";

import { RunnerParameterFiles } from "@/backend/service/runner/RunnerParameterFiles";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentPlanRemoteAccessRepository } from "@/backend/database/repositories/agent/AgentPlanRemoteAccessRepository";
import type { AgentPlanRemoteParameters } from "@/backend/service/agents/AgentPlanRemoteParameters";
import type { ParameterFileAccess } from "@/backend/service/runner/RunnerParameterFiles";

const ACCESS = partial<ParameterFileAccess>({
  run: {
    id: "run",
    userId: "user",
    steps: [{ id: "step", execution: { attemptId: "attempt" } }],
  },
  remote: {
    step: { id: "step" },
    parameters: {
      assets: [
        {
          reference: { link: "link" },
          file: { name: "file", parameter: "input", size: 5 },
        },
      ],
    },
  },
});

it("serves a pinned file in bounded chunks and records its delivery", async () => {
  const readAsset = vi.fn(async () => Buffer.from("hello"));
  const write = vi.fn(async () => {});
  const files = new RunnerParameterFiles({
    parameters: partial<AgentPlanRemoteParameters>({
      isStreamed: () => false,
      readAsset,
    }),
    evidence: partial<AgentPlanRemoteAccessRepository>({ write }),
  });
  await expect(
    files.chunk(ACCESS, partial({ kind: "asset", index: 0, offset: 1 })),
  ).resolves.toEqual({
    base64: Buffer.from("ello").toString("base64"),
    size: 5,
    done: true,
  });
  expect(readAsset).toHaveBeenCalledOnce();
  expect(write).toHaveBeenCalledOnce();
  await expect(
    files.chunk(ACCESS, partial({ kind: "asset", index: 0, offset: 6 })),
  ).rejects.toMatchObject({ code: "parameter_asset_unavailable" });
  await expect(
    files.chunk(ACCESS, partial({ kind: "asset", index: 1, offset: 0 })),
  ).rejects.toMatchObject({ code: "parameter_asset_unavailable" });
});

it("includes authorized extracted text in the manifest", async () => {
  const parameters = partial<AgentPlanRemoteParameters>({
    isStreamed: () => false,
    readAssetContent: async () => ({
      content: {
        type: "text",
        representation: "text-extract",
        text: "contents",
      },
    }),
  });
  const files = new RunnerParameterFiles({
    parameters,
    evidence: partial<AgentPlanRemoteAccessRepository>({}),
  });
  await expect(files.manifest(ACCESS)).resolves.toMatchObject({
    files: [{ name: "file", textExtract: "contents" }],
  });
  await expect(
    files.manifest(
      partial<ParameterFileAccess>({
        run: ACCESS.run,
        remote: { step: { id: "step" } },
      }),
    ),
  ).rejects.toMatchObject({ code: "plan_mcp_unavailable" });
});
