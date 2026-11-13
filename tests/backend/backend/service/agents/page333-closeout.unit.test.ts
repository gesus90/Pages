import { beforeEach, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";

import { reportedTurn, runClosedStep } from "./page333-closeout-fixture";
import { closed } from "./page81-resource-fixture";

const boundaries = vi.hoisted(() => ({
  hasRunningWorkerUnit: vi.fn<() => Promise<boolean>>(),
  hasEndedOwnedNamespace: vi.fn<() => Promise<boolean>>(),
  logEvent: vi.fn(),
  logCaughtError: vi.fn(),
  logDiagnostic: vi.fn(),
}));
vi.mock("@/backend/agents/cli/CliOwnedNamespace", () => ({
  hasEndedOwnedNamespace: boundaries.hasEndedOwnedNamespace,
}));
vi.mock("@/backend/agents/cli/CliWorkerUnit", () => ({
  hasRunningWorkerUnit: boundaries.hasRunningWorkerUnit,
}));
vi.mock("@/backend/logging/Logger", () => boundaries);

beforeEach(() => {
  vi.clearAllMocks();
  boundaries.hasRunningWorkerUnit.mockReset().mockResolvedValue(false);
  boundaries.hasEndedOwnedNamespace.mockReset().mockResolvedValue(false);
});

it("succeeds after exit zero and confirmed native closeout", async () => {
  const close = vi.fn(async () => closed());
  const node = await runClosedStep({
    turn: Promise.resolve(reportedTurn()),
    close,
  });
  expect(node.result).toMatchObject({
    status: "succeeded",
    error: null,
    session: { closeout: "confirmed", resultCode: 0 },
  });
  expect(close).toHaveBeenCalledOnce();
  expect(boundaries.hasEndedOwnedNamespace).not.toHaveBeenCalled();
});

it("keeps plan_closeout_failed when independent process evidence finds a surviving namespace", async () => {
  const node = await runClosedStep({
    turn: Promise.resolve(reportedTurn()),
    close: async () => {
      throw new AgentError("plan_local_control_failed");
    },
  });
  expect(node.result).toMatchObject({
    status: "failed",
    error: "plan_closeout_failed",
    session: { closeout: "failed" },
  });
  expect(node.result.session?.acceptance?.verdict).toBe("accepted");
  expect(boundaries.hasEndedOwnedNamespace).toHaveBeenCalledExactlyOnceWith({
    pid: 42,
    uid: 1000,
    start: 1234,
    boot: "11111111-1111-4111-8111-111111111111",
  });
});

it.each([
  {
    name: "success",
    turn: reportedTurn(),
    expected: { status: "succeeded", error: null },
  },
  {
    name: "provider failure",
    turn: reportedTurn({
      failure: "failed",
      errorCode: "plan_model_unavailable",
    }),
    expected: { status: "failed", error: "plan_model_unavailable" },
  },
  {
    name: "business rejection",
    turn: reportedTurn({ output: "No valid business report" }),
    expected: { status: "failed", error: "plan_acceptance_failed" },
  },
  {
    name: "cancellation",
    turn: reportedTurn({ failure: "cancelled" }),
    expected: { status: "cancelled", cancellation: "confirmed" },
  },
])(
  "preserves $name and logs recovery when independent evidence proves that no processes remain",
  async ({ turn, expected }) => {
    boundaries.hasEndedOwnedNamespace.mockResolvedValue(true);
    const node = await runClosedStep({
      turn: Promise.resolve(turn),
      close: async () => {
        throw new AgentError("plan_local_control_failed");
      },
    });
    expect(node.result).toMatchObject(expected);
    expect(node.result.session).toMatchObject({
      closeout: "confirmed",
      containment: "pid_namespace",
      exit: null,
    });
    expect(node.revoke).toHaveBeenCalledWith("run", "step");
    expect(JSON.stringify(boundaries.logEvent.mock.calls)).toContain(
      "Turn result retained",
    );
    expect(boundaries.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "plan.session.close_reconciled",
        metadata: { code: "plan_local_control_failed", isConfirmed: true },
      }),
    );
  },
);

it.each(["missing", "unreadable"])(
  "fails closed for %s process evidence",
  async (evidence) => {
    boundaries.hasEndedOwnedNamespace.mockRejectedValue(
      new Error("process table unavailable"),
    );
    const node = await runClosedStep(
      {
        turn: Promise.resolve(reportedTurn()),
        close: async () => {
          throw new AgentError("plan_local_control_failed");
        },
      },
      evidence !== "missing",
    );
    expect(node.result).toMatchObject({
      status: "failed",
      error: "plan_closeout_failed",
    });
  },
);

it("never replaces an explicit unconfirmed cleanup with an empty process check", async () => {
  boundaries.hasEndedOwnedNamespace.mockResolvedValue(true);
  const node = await runClosedStep({
    turn: Promise.resolve(reportedTurn()),
    close: async () => closed(false),
  });
  expect(node.result).toMatchObject({
    status: "failed",
    error: "plan_closeout_failed",
  });
  expect(boundaries.hasEndedOwnedNamespace).not.toHaveBeenCalled();
});

it.each(["active", "unreadable"])(
  "keeps accepted work and fails closeout when worker units are %s",
  async (state) => {
    boundaries.hasEndedOwnedNamespace.mockResolvedValue(true);
    if (state === "active")
      boundaries.hasRunningWorkerUnit.mockResolvedValue(true);
    else
      boundaries.hasRunningWorkerUnit.mockRejectedValue(
        new Error("private worker details"),
      );
    const node = await runClosedStep({
      turn: Promise.resolve(reportedTurn()),
      close: async () => {
        throw new AgentError("plan_local_control_failed");
      },
    });
    expect(node.result).toMatchObject({
      status: "failed",
      error: "plan_closeout_failed",
      session: { acceptance: { verdict: "accepted" } },
    });
    expect(JSON.stringify(boundaries.logEvent.mock.calls)).not.toContain(
      "private worker details",
    );
  },
);

it.each([true, false])(
  "keeps accepted work after lost owner proof only when the process ended: %s",
  async (hasEnded) => {
    boundaries.hasEndedOwnedNamespace.mockResolvedValue(hasEnded);
    const node = await runClosedStep({
      turn: Promise.resolve(reportedTurn()),
      close: async () => {
        throw new AgentError("plan_local_owner_unverified");
      },
    });
    expect(node.result).toMatchObject({
      status: hasEnded ? "succeeded" : "failed",
      error: hasEnded ? null : "plan_closeout_failed",
      session: { acceptance: { verdict: "accepted" } },
    });
  },
);
