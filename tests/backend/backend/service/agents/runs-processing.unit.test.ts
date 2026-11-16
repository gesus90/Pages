import { beforeEach, expect, it, vi } from "vitest";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { PagesConfig } from "@/backend/config/PagesConfig";

const boundary = vi.hoisted(() => ({
  separate: vi.fn(),
  owns: vi.fn(),
  ownsApi: vi.fn(),
  setOwner: vi.fn(),
  setApi: vi.fn(),
  acquire: vi.fn(),
}));
vi.mock("@/backend/runtime/RunsMode", () => ({
  isPagesRunsProcess: boundary.separate,
  canProcessRuns: boundary.owns,
  hasRunApiOwnership: boundary.ownsApi,
  setRunsOwnership: boundary.setOwner,
  setRunApiOwnership: boundary.setApi,
}));
vi.mock("@/backend/database/repositories/agent/PlanRunOwnerRepository", () => ({
  PlanRunOwnerRepository: class {
    public acquire = boundary.acquire;
  },
}));

import {
  claimRunApiProcessing,
  claimRunsProcessing,
} from "@/backend/service/agents/runs/RunsProcessing";

beforeEach(() => {
  vi.resetAllMocks();
  boundary.separate.mockReturnValue(false);
  boundary.owns.mockReturnValue(false);
  boundary.ownsApi.mockReturnValue(false);
  boundary.acquire.mockResolvedValue(true);
});

it("claims the configured engine role after setup", async () => {
  await claimRunsProcessing(
    partial<PagesConfig>({
      runsMode: "server",
      databaseUrl: "postgres://example",
      firstRun: false,
    }),
  );
  expect(boundary.acquire).toHaveBeenCalledOnce();
  expect(boundary.setOwner).toHaveBeenCalledWith(true);
});

it("skips other roles or existing ownership and rejects missing setup or a competing owner", async () => {
  await claimRunsProcessing(partial<PagesConfig>({ runsMode: "separate" }));
  expect(boundary.acquire).not.toHaveBeenCalled();
  await expect(
    claimRunsProcessing(
      partial<PagesConfig>({ runsMode: "server", firstRun: true }),
    ),
  ).rejects.toThrow();
  boundary.acquire.mockResolvedValue(false);
  await expect(
    claimRunsProcessing(
      partial<PagesConfig>({
        runsMode: "server",
        databaseUrl: "postgres://example",
      }),
    ),
  ).rejects.toThrow();
  expect(boundary.setOwner).not.toHaveBeenCalled();
});

it("claims a separate API owner only in server mode", async () => {
  await claimRunApiProcessing(
    partial<PagesConfig>({
      runsMode: "separate",
      databaseUrl: "postgres://example",
      firstRun: false,
    }),
  );
  expect(boundary.setApi).toHaveBeenCalledOnce();
  boundary.separate.mockReturnValue(true);
  await claimRunApiProcessing(partial<PagesConfig>({ runsMode: "separate" }));
  expect(boundary.acquire).toHaveBeenCalledOnce();
});
