import { screen } from "@testing-library/react";
import { expect, it } from "vitest";

import {
  PlanGroupSessionValue,
  planRunGroupSession,
} from "@/app/components/agents/plans/plan-group-session";

import { runStep, syntheticRun, syntheticSession } from "../page72-run-fixture";
import { i18n, renderTranslated } from "./plan-group-fixture";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";

interface MemberOptions {
  readonly role?: "created" | "continued";
  readonly acpSessionId?: string | null;
  readonly session?: Partial<AgentPlanSessionRecord>;
  readonly groupId?: string;
}

function member(id: string, options: MemberOptions = {}): AgentPlanStepResult {
  const groupId = options.groupId ?? "group";
  return runStep(id, {
    groupId,
    session: {
      ...syntheticSession(),
      ...options.session,
      group: {
        groupId,
        adapter: "codex_cli",
        role: options.role ?? "continued",
        creatorStepId: "first",
        turn: 1,
        acpSessionId: options.acpSessionId ?? null,
        nativeSessionId: null,
      },
    },
  });
}

function run(
  steps: readonly AgentPlanStepResult[],
  status: AgentPlanRun["status"] = "running",
): AgentPlanRun {
  return { ...syntheticRun(), status, steps };
}

it("knows no session without a run or without group members in it", () => {
  const empty = {
    state: "not_created",
    acpSessionId: null,
    creator: null,
    adapter: null,
    turns: 0,
  };
  expect(planRunGroupSession(null, "group")).toEqual(empty);
  expect(
    planRunGroupSession(
      run([
        runStep("loose", { groupId: "group", session: syntheticSession() }),
        member("elsewhere", { groupId: "other", role: "created" }),
      ]),
      "group",
    ),
  ).toEqual(empty);
});

it("tells a session that never got an ID apart from one that failed to open", () => {
  const pending = member("first", { role: "created" });
  expect(planRunGroupSession(run([pending]), "group")).toEqual({
    state: "not_created",
    acpSessionId: null,
    creator: pending,
    adapter: "codex_cli",
    turns: 1,
  });
  const failed = member("first", {
    role: "created",
    session: { resultCode: -1 },
  });
  expect(planRunGroupSession(run([failed]), "group").state).toBe("failed");
});

it("keeps an open session active while the run goes on and failed once it ended", () => {
  const steps = [
    member("first", { role: "created", session: { closeout: "pending" } }),
    member("second", { acpSessionId: "acp-1" }),
  ];
  const active = planRunGroupSession(run(steps), "group");
  expect(active).toMatchObject({
    state: "active",
    acpSessionId: "acp-1",
    turns: 2,
  });
  expect(active.creator?.id).toBe("first");
  for (const status of ["succeeded", "failed", "cancelled"] as const)
    expect(planRunGroupSession(run(steps, status), "group").state).toBe(
      "failed",
    );
  expect(planRunGroupSession(run(steps, "paused"), "group").state).toBe(
    "active",
  );
});

it("reads a closed session from its creator, a retirement taking precedence", () => {
  const creator = member("first", {
    role: "created",
    acpSessionId: "acp-2",
    session: { closeout: "confirmed" },
  });
  expect(planRunGroupSession(run([creator]), "group").state).toBe("closed");
  const retired = member("second", {
    session: {
      closeout: "confirmed",
      resultCode: -1,
      events: ["resource session retired: lost"],
    },
  });
  expect(planRunGroupSession(run([creator, retired]), "group").state).toBe(
    "failed",
  );
});

it("shows the session ID with its state, or says that none was created yet", () => {
  const { rerender } = renderTranslated(
    <PlanGroupSessionValue
      session={{
        state: "active",
        acpSessionId: "acp-9",
        creator: null,
        adapter: "codex_cli",
        turns: 1,
      }}
      className="extra"
    />,
  );
  const value = screen.getByTitle(i18n.t("plans.groups.session.hint"));
  expect(value.textContent).toContain("acp-9");
  expect(value.textContent).toContain(
    `(${i18n.t("plans.groups.session.state.active")})`,
  );
  expect(value.className).toContain("extra");
  rerender(
    <PlanGroupSessionValue
      session={{
        state: "not_created",
        acpSessionId: null,
        creator: null,
        adapter: null,
        turns: 0,
      }}
    />,
  );
  const empty = screen.getByTitle(i18n.t("plans.groups.session.hint"));
  expect(empty.textContent).toContain(
    i18n.t("plans.groups.session.notCreated"),
  );
  expect(empty.textContent).not.toContain("(");
});
