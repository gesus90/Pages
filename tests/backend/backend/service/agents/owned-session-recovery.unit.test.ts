import { expect, it, vi } from "vitest";

import { settleOwnedNamespace } from "@/backend/agents/cli/CliOwnedNamespace";
import { endTaggedProcesses } from "@/backend/agents/cli/CliProcessScan";
import { endInterruptedSession } from "@/backend/service/agents/AgentPlanRecovery";

import { recoveryFixture } from "./page84-recovery-fixture";

import type * as CliOwnedNamespace from "@/backend/agents/cli/CliOwnedNamespace";

vi.mock("@/backend/agents/cli/CliOwnedNamespace", async (importOriginal) => ({
  ...(await importOriginal<typeof CliOwnedNamespace>()),
  settleOwnedNamespace: vi.fn(),
}));
vi.mock("@/backend/agents/cli/CliProcessScan", () => ({
  endTaggedProcesses: vi.fn(),
  findTaggedProcesses: vi.fn(),
  readScopeSince: vi.fn(),
}));

const NAMESPACE = {
  pid: 123,
  uid: 1000,
  start: 101,
  boot: "10000000-0000-4000-8000-000000000001",
};

it.each([
  ["pending", true],
  ["pending", false],
  ["failed", true],
  ["failed", false],
] as const)(
  "rechecks %s Antigravity cleanup using supervisor termination: %s",
  async (closeout, ended) => {
    const fixture = await recoveryFixture();
    const step = fixture.completed.steps.find((entry) => entry.id === "a");
    if (!step?.session) throw new Error("Missing session fixture");
    vi.mocked(settleOwnedNamespace).mockResolvedValueOnce(ended);
    const result = await endInterruptedSession(
      {
        ...step,
        session: {
          ...step.session,
          runner: "antigravity",
          closeout,
          namespace: NAMESPACE,
        },
      },
      fixture.completed.startedAt,
    );
    expect(result.session?.closeout).toBe(ended ? "confirmed" : "failed");
    expect(result.session?.containment).toBe(
      ended ? "pid_namespace" : undefined,
    );
    expect(endTaggedProcesses).not.toHaveBeenCalled();
  },
);
