import { beforeEach, expect, it, vi } from "vitest";

import { preparePicaSession } from "@/backend/agents/cli/CliAcpSessionSetup";
import {
  selectPicaNativeArtifact,
  picaCodexBundle,
  acpPicaSupport,
} from "@/backend/agents/cli/CliPicaSessionSetup";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";

vi.mock("@/backend/agents/cli/CliPicaSessionSetup", () => ({
  selectPicaNativeArtifact: vi.fn(),
  picaCodexBundle: vi.fn(),
  acpPicaSupport: { synthetic: true },
}));

beforeEach(() => vi.clearAllMocks());

it("does not initialize chat support for a plan session", async () => {
  const options = partial<Parameters<typeof preparePicaSession>[0]>({
    input: partial<AgentPlanSessionInput>({
      directory: "/synthetic/workspace",
    }),
  });
  await expect(preparePicaSession(options)).resolves.toEqual({
    picaNative: null,
    picaBundle: null,
  });
  expect(selectPicaNativeArtifact).not.toHaveBeenCalled();
  expect(picaCodexBundle).not.toHaveBeenCalled();
});

it("preserves native Pica preparation and protocol registration for a chat", async () => {
  const options = partial<Parameters<typeof preparePicaSession>[0]>({
    input: { directory: "/synthetic/workspace", chat: {} },
    adapter: "/synthetic/adapter",
  });
  vi.mocked(selectPicaNativeArtifact).mockReturnValue(null);
  vi.mocked(picaCodexBundle).mockReturnValue(null);
  const prepared = await preparePicaSession(options);
  expect(selectPicaNativeArtifact).toHaveBeenCalledWith(options);
  expect(picaCodexBundle).toHaveBeenCalledWith(
    null,
    "/synthetic/workspace",
    "/synthetic/adapter",
  );
  expect(prepared.picaSupport).toBe(acpPicaSupport);
});
