import { expect, it, vi } from "vitest";

import {
  limitAcpWorkerUnit,
  requireAcpMode,
  secureAcpSession,
  sessionContainment,
} from "@/backend/agents/cli/CliAcpSpawn";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AcpDriver } from "@/backend/agents/acp/AcpDriver";
import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";
import type { CliSessionRequest } from "@/backend/agents/cli/CliContracts";
import type { VerifiedStart } from "@/backend/agents/cli/CliSessionChecks";

it("derives containment and validates the selected permission mode", () => {
  const request = partial<CliSessionRequest>({});
  expect(sessionContainment(true, request)).toBe("pid_namespace");
  expect(sessionContainment(false, request)).toBe("none");
  expect(
    sessionContainment(false, { ...request, unit: partial({ name: "unit" }) }),
  ).toBe("worker_unit");
  const driver = partial<AcpDriver>({
    errors: { modeRequired: "plan_permission_mode_unenforceable" },
  });
  expect(
    requireAcpMode(
      driver,
      partial<AgentPlanSessionInput>({
        options: { access: "full_environment" },
      }),
    ),
  ).toBe("yolo");
  expect(
    requireAcpMode(
      driver,
      partial<AgentPlanSessionInput>({ options: { access: "read_only" } }),
    ),
  ).toBe("read_only");
  expect(() =>
    requireAcpMode(
      driver,
      partial<AgentPlanSessionInput>({ options: { access: "unknown" } }),
    ),
  ).toThrow();
});

it("requires a limited worker for chat and full environment, while warning for ordinary plan work", async () => {
  const request = partial<CliSessionRequest>({});
  const missing = vi.fn();
  const plan = partial<AgentPlanSessionInput>({
    instanceId: "instance",
    options: { access: "read_only" },
  });
  await expect(
    limitAcpWorkerUnit({ request, input: plan, onMissingUnits: missing }),
  ).resolves.toEqual({ request, label: "no limited unit" });
  expect(missing).toHaveBeenCalledOnce();
  await expect(
    limitAcpWorkerUnit({
      request,
      input: partial<AgentPlanSessionInput>({ ...plan, chat: {} }),
      onMissingUnits: missing,
    }),
  ).rejects.toMatchObject({ code: "acp_worker_unit_unavailable" });
  const wrap = vi.fn(async () => ({ request, unit: { name: "unit" } }));
  const units = partial<
    NonNullable<Parameters<typeof limitAcpWorkerUnit>[0]["units"]>
  >({ isAvailable: async () => true, wrap });
  const limited = await limitAcpWorkerUnit({
    request,
    input: plan,
    units,
    onMissingUnits: missing,
  });
  expect(limited.request.unit).toMatchObject({ name: "unit" });
  expect(limited.label).toContain("unit unit");
});

it("secures credentials even when GitHub cleanup fails", async () => {
  const cleanup = vi.fn(async () => {
    throw new Error("cleanup failed");
  });
  const secure = vi.fn(async () => undefined);
  const input = partial<AgentPlanSessionInput>({
    agent: { connection: { id: "connection" } },
  });
  const start = partial<VerifiedStart>({ owner: false, provider: "codex_cli" });
  await expect(
    secureAcpSession({
      input,
      start,
      github: partial({ cleanup }),
      store: { secure },
    }),
  ).rejects.toThrow("cleanup failed");
  expect(secure).toHaveBeenCalledWith("connection", "codex_cli");
});
