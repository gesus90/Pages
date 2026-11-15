import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkSessionProcesses } from "@/backend/service/agents/AgentPlanRecovery";
import { cleanupPlanStartOwner } from "@/backend/service/agents/AgentPlanStartCleanup";
import {
  closeRecoveryScripts,
  closeRecoverySessions,
} from "@/backend/service/agents/recovery/AgentPlanRecoveryScripts";
import {
  hasEndedWithReboot,
  predatesBoot,
  readBootTime,
} from "@/backend/service/agents/recovery/AgentPlanBootBoundary";
import { recoveryFixture } from "./page84-recovery-fixture";

import type * as FileSystem from "node:fs/promises";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";

const host = vi.hoisted(() => ({
  stat: vi.fn<() => Promise<string>>(),
  scan: vi.fn<() => Promise<readonly never[] | null>>(async () => null),
  end: vi.fn(async () => ({ found: 0, remaining: 1 })),
}));
vi.mock("node:fs/promises", async (load) => ({
  ...(await load<typeof FileSystem>()),
  readFile: vi.fn(async (file: string) =>
    file === "/proc/stat" ? host.stat() : "",
  ),
}));
vi.mock("@/backend/agents/cli/CliProcessScan", () => ({
  findTaggedProcesses: host.scan,
  readScopeSince: vi.fn(async () => ({ earliestStart: 1 })),
  endTaggedProcesses: host.end,
}));
vi.mock("@/backend/agents/local/LocalOwnerControl", () => ({
  settleManagedLocalOwner: vi.fn(async () => null),
}));

/** 2026-11-15T15:41:45Z, the reboot that ended the agents of that afternoon. */
const BOOT_SECONDS = 1794757305;
const BOOT = BOOT_SECONDS * 1000;
const BEFORE = new Date(BOOT - 3_600_000).toISOString();
const AFTER = new Date(BOOT + 60_000).toISOString();

/** A cancelled run whose first step left a script with failed closeout. */
async function cancelledRun(start = BEFORE): Promise<AgentPlanRun> {
  const fixture = await recoveryFixture();
  return {
    ...fixture.failed,
    status: "cancelled",
    startedAt: start,
    steps: fixture.failed.steps.map((step, index): AgentPlanStepResult =>
      index === 0
        ? {
            ...step,
            session: null,
            script: {
              instanceId: "68938e2f-b847-4ec1-8924-e5ef84a30d77",
              attemptId: "7fa89f36-17ae-4aac-9914-846bc80ba0f6",
              userId: fixture.failed.userId,
              interpreterProfileId: "bash",
              directory: "/home/user/workspace",
              uid: 1000,
              gid: 1000,
              processId: null,
              startedAt: start,
              endedAt: start,
              exitCode: null,
              signal: null,
              stdout: null,
              stderr: "",
              closeout: "failed",
              failure: "cleanup",
            },
          }
        : { ...step, session: null },
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  host.stat.mockResolvedValue(
    `cpu  1 2 3\nbtime ${BOOT_SECONDS}\nprocesses 9\n`,
  );
});

describe("readBootTime", () => {
  it("reads btime of /proc/stat in milliseconds", async () => {
    await expect(readBootTime()).resolves.toBe(BOOT);
  });

  it("refuses a missing boot time", async () => {
    host.stat.mockResolvedValue("cpu  1 2 3\n");
    await expect(readBootTime()).rejects.toThrow("Boot time unavailable");
  });
});

describe("predatesBoot", () => {
  it("proves the end of an ended local run whose every attempt started before the boot", async () => {
    expect(predatesBoot(await cancelledRun(), BOOT)).toBe(true);
  });

  it("keeps a run that started after the boot", async () => {
    expect(predatesBoot(await cancelledRun(AFTER), BOOT)).toBe(false);
  });

  it("keeps an attempt that started after the boot in an older run", async () => {
    const run = await cancelledRun();
    const first = run.steps[0];
    const later: AgentPlanRun = {
      ...run,
      steps: run.steps.map((step, index) =>
        index === 1 && first?.script
          ? { ...step, script: { ...first.script, startedAt: AFTER } }
          : step,
      ),
    };
    expect(predatesBoot(later, BOOT)).toBe(false);
  });

  it("keeps an active run and a process without a known start", async () => {
    const run = await cancelledRun();
    const fixture = await recoveryFixture();
    const unknown: AgentPlanRun = {
      ...fixture.failed,
      status: "failed",
      startedAt: BEFORE,
      steps: fixture.failed.steps.map((step) =>
        step.session
          ? { ...step, session: { ...step.session, startedAt: null } }
          : step,
      ),
    };
    expect(predatesBoot({ ...run, status: "paused" }, BOOT)).toBe(false);
    expect(predatesBoot(unknown, BOOT)).toBe(false);
  });
});

describe("hasEndedWithReboot", () => {
  it("proves nothing when the boot time cannot be read", async () => {
    host.stat.mockRejectedValue(new Error("no proc"));
    await expect(hasEndedWithReboot(await cancelledRun())).resolves.toBe(false);
  });
});

describe("cleanup checks of a run that ended with a reboot", () => {
  it("confirms a failed script closeout without scanning or stopping anything", async () => {
    const run = await cancelledRun();

    const scripts = await closeRecoveryScripts(run);
    const sessions = await closeRecoverySessions(scripts);
    const checked = await checkSessionProcesses(sessions);

    expect(scripts).toBe(run);
    expect(sessions).toBe(run);
    expect(checked).toEqual({ confirmed: true, failure: null });
    expect(host.end).not.toHaveBeenCalled();
    expect(host.scan).not.toHaveBeenCalled();
  });

  it("lets a restart release the script of that run without stopping anything", async () => {
    const run = await cancelledRun();

    const released = await cleanupPlanStartOwner(run, []);

    expect(released).toEqual([
      {
        instanceId: "68938e2f-b847-4ec1-8924-e5ef84a30d77",
        processId: null,
        kind: "local_script",
        confirmed: true,
      },
    ]);
    expect(host.end).not.toHaveBeenCalled();
  });

  it("keeps a restart blocked for the same script within its boot", async () => {
    const released = await cleanupPlanStartOwner(await cancelledRun(AFTER), []);

    expect(released[0]?.confirmed).toBe(false);
  });

  it("keeps the same run unconfirmed within the boot it ran in", async () => {
    const run = await cancelledRun(AFTER);

    await expect(closeRecoveryScripts(run)).rejects.toMatchObject({
      code: "cleanup_unconfirmed",
    });
    await expect(checkSessionProcesses(run)).resolves.toMatchObject({
      confirmed: false,
    });
  });
});
