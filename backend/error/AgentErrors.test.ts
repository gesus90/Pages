import { describe, expect, it } from "vitest";

import {
  AGENT_ERROR_MESSAGES,
  AgentAccessDeniedError,
  AgentError,
  AgentInUseError,
  AgentPlanSkippedStepError,
  isAgentErrorCode,
} from "@/backend/error/AgentErrors";
import { AcpCleanupUnconfirmedError } from "@/backend/error/AcpCleanupUnconfirmedError";
import { AgentAssetError } from "@/backend/error/AgentAssetError";
import { AgentAssetReferenceError } from "@/backend/error/AgentAssetReferenceError";
import { AgentPlanActiveRunError } from "@/backend/error/AgentPlanActiveRunError";
import { AgentPlanCallBlockedError } from "@/backend/error/AgentPlanCallBlockedError";
import { PLAN_CALL_ERROR_MESSAGES } from "@/backend/error/AgentPlanCallErrorMessages";
import { AgentPlanValidationError } from "@/backend/error/AgentPlanValidationError";
import { AgentPlanWorkspaceConflictError } from "@/backend/error/AgentPlanWorkspaceConflictError";
import { AgentPlanWorkspaceReservationError } from "@/backend/error/AgentPlanWorkspaceReservationError";
import type { AgentPlanIssue } from "@/definition/AgentPlanIssue";

function issue(reason: AgentPlanIssue["reason"]): AgentPlanIssue {
  return { nodeId: null, port: null, reason };
}

describe("agent errors", () => {
  it("takes the message of the code and recognizes only own codes", () => {
    const error = new AgentError("plan_invalid");

    expect(error.name).toBe("AgentError");
    expect(error.code).toBe("plan_invalid");
    expect(error.message).toBe(AGENT_ERROR_MESSAGES.plan_invalid);
    expect(isAgentErrorCode("plan_invalid")).toBe(true);
    expect(isAgentErrorCode("toString")).toBe(false);
    expect(isAgentErrorCode(7)).toBe(false);
  });

  it("includes the plan call messages", () => {
    expect(AGENT_ERROR_MESSAGES.plan_jump_cycle).toBe(
      PLAN_CALL_ERROR_MESSAGES.plan_jump_cycle,
    );
  });

  it("keeps the usages of an agent that is still in use", () => {
    const usages = [{ kind: "global" } as const];
    const error = new AgentInUseError("profile_in_use", usages);

    expect(error.code).toBe("profile_in_use");
    expect(error.usages).toBe(usages);
  });

  it("names the skipped step and denies access without details", () => {
    expect(new AgentPlanSkippedStepError("n1").nodeId).toBe("n1");
    expect(new AgentAccessDeniedError().name).toBe("AgentAccessDeniedError");
  });
});

describe("agent plan errors", () => {
  it("keeps the identifying values of the plan refusals", () => {
    expect(new AcpCleanupUnconfirmedError().name).toBe(
      "AcpCleanupUnconfirmedError",
    );
    expect(new AgentPlanActiveRunError("r1").runId).toBe("r1");
    const blocked = new AgentPlanCallBlockedError(["a", "b"]);
    expect(blocked.ownerRunIds).toEqual(["a", "b"]);
    expect(blocked.code).toBe("plan_jump_start_blocked");
    expect(new AgentPlanWorkspaceReservationError("w1").workspaceId).toBe("w1");
  });

  it("keeps the conflict of a workspace start refusal", () => {
    const conflict = {
      kind: "reserved",
      targets: [],
      nodes: [{ id: "n", name: "Node" }],
    } as const;
    const error = new AgentPlanWorkspaceConflictError(conflict);

    expect(error.conflict).toBe(conflict);
    expect(error.code).toBe("plan_workspace_conflict");
  });

  it.each([
    [["startEndDisconnected", "jumpCycle"], "plan_start_end_disconnected"],
    [["manualStart", "jumpCycle"], "plan_jump_cycle"],
    [["manualStart"], "plan_manual_start_unavailable"],
    [["duplicate"], "plan_invalid"],
  ] as const)("refuses issues %j with %s", (reasons, code) => {
    const issues = reasons.map((reason) => issue(reason));
    const error = new AgentPlanValidationError(issues);

    expect(error.code).toBe(code);
    expect(error.issues).toBe(issues);
  });

  it("keeps the asset and its file name", () => {
    const asset = { source: "plan", id: "a", link: "l" } as const;
    const error = new AgentAssetError("plan_invalid", asset, "f.txt");

    expect(error.asset).toBe(asset);
    expect(error.fileName).toBe("f.txt");
    expect(new AgentAssetReferenceError("x".repeat(400)).fileName).toHaveLength(
      300,
    );
  });
});
