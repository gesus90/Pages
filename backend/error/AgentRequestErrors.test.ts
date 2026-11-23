import { describe, expect, it } from "vitest";

import { AgentAuthorizationError } from "@/backend/error/AgentAuthorizationError";
import { AgentChatError } from "@/backend/error/AgentChatError";
import { AgentChatTaskError } from "@/backend/error/AgentChatTaskError";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { AgentImageError } from "@/backend/error/AgentImageError";
import { AgentJobAnswerError } from "@/backend/error/AgentJobAnswerError";
import { AgentMediaError } from "@/backend/error/AgentMediaError";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { AgentPlanPausedError } from "@/backend/error/AgentPlanPausedError";
import {
  AgentPlanReadDenied,
  withPlanReadOrigin,
} from "@/backend/error/AgentPlanReadDenied";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";
import { AgentPlanRecoveryReplayed } from "@/backend/error/AgentPlanRecoveryReplayed";
import { AgentProfileError } from "@/backend/error/AgentProfileError";
import { AgentError } from "@/backend/error/AgentErrors";

describe("coded agent errors", () => {
  it("carry their code as message", () => {
    expect(new AgentEmployeeError("busy").message).toBe("busy");
    expect(new AgentExecutionError("timeout").code).toBe("timeout");
    expect(new AgentChatTaskError("not_found").name).toBe("AgentChatTaskError");
    expect(new AgentAuthorizationError("x")).toBeInstanceOf(Error);
  });

  it("keeps the details of a chat error", () => {
    const details = { chatId: "c" };

    expect(new AgentChatError("chat_not_found", details).details).toBe(details);
    expect(new AgentChatError("chat_not_found").details).toBeUndefined();
  });

  it("defaults the detail of image and media errors", () => {
    expect(new AgentImageError("no_key").detail).toBe("");
    expect(new AgentImageError("no_key", "d").detail).toBe("d");
    expect(new AgentMediaError("no_key").detail).toBe("");
    expect(new AgentMediaError("no_key", "d").detail).toBe("d");
  });

  it("keeps the reason of a profile error", () => {
    expect(new AgentProfileError("forbidden").reason).toBeNull();
    expect(new AgentProfileError("forbidden", "why").reason).toBe("why");
  });
});

describe("agent operation errors", () => {
  it.each([
    ["NOT_FOUND", 404],
    ["CONFLICT", 409],
    ["FORBIDDEN", 403],
    ["CONFIRMATION_REQUIRED", 400],
    ["AMBIGUOUS", 409],
    ["INVALID_REQUEST", 400],
    ["PAYLOAD_TOO_LARGE", 413],
  ] as const)("maps %s to status %i", (code, status) => {
    const error = new AgentOperationError(code);

    expect(error.status).toBe(status);
    expect(error.details).toBeUndefined();
    expect(error.message).toBe(
      code === "NOT_FOUND"
        ? "Not found or no access."
        : "The agent API request was rejected.",
    );
  });
});

describe("agent job answer errors", () => {
  it("keeps only a safe failure code and the unavailable code", () => {
    const error = new AgentJobAnswerError("failed", "plan_step_failed");

    expect(error.code).toBe("unavailable");
    expect(error.failureCode).toBe("plan_step_failed");
    expect(error.detail).toBeNull();
    expect(new AgentJobAnswerError("failed", "Bad Code!").failureCode).toBe(
      "failed",
    );
    expect(new AgentJobAnswerError("failed", null).failureCode).toBe("failed");
  });

  it.each([
    ["stopped", null, true],
    ["interrupted", null, true],
    ["failed", "plan_cancelled", true],
    ["failed", "cancelled", true],
    ["failed", "other", false],
  ] as const)("recognizes %s/%s as cancelled: %s", (state, code, expected) => {
    expect(new AgentJobAnswerError(state, code).isCancelled).toBe(expected);
  });

  it("classifies tool and start failures as transient or lasting", () => {
    const notReady = (diagnostic?: string): AgentJobAnswerError =>
      new AgentJobAnswerError("failed", "agent_tool_not_ready", {
        stage: "start",
        ...(diagnostic === undefined ? {} : { diagnostic }),
      });

    expect(notReady().isTransient).toBe(true);
    expect(notReady("execution_failed").isTransient).toBe(true);
    expect(notReady("not_installed").isTransient).toBe(false);
    expect(
      new AgentJobAnswerError("failed", "plan_step_failed", { stage: "start" })
        .isTransient,
    ).toBe(true);
    expect(
      new AgentJobAnswerError("failed", "plan_step_failed").isTransient,
    ).toBe(false);
  });
});

describe("plan flow errors", () => {
  it("name the cancellation and the pause", () => {
    expect(new AgentPlanCancelledError().message).toMatch(/cancellation/u);
    expect(new AgentPlanPausedError().name).toBe("AgentPlanPausedError");
  });

  it("keep the cleanup failure of a recovery error", () => {
    const failure = {
      stepId: "s",
      kind: "loop",
      reason: "engine_active",
    } as const;

    expect(
      new AgentPlanRecoveryError("invalid_request").cleanupFailure,
    ).toBeUndefined();
    expect(new AgentPlanRecoveryError("invalid_request", failure).message).toBe(
      "Agent plan recovery: invalid_request",
    );
    const result = {
      commandId: "c",
      revision: 1,
      outcome: "recorded",
    } as const;
    expect(new AgentPlanRecoveryReplayed(result).result).toBe(result);
  });

  it("rewrites a plain denial to the source that was read", async () => {
    await expect(
      withPlanReadOrigin("src", () =>
        Promise.reject(new AgentError("plan_access_denied")),
      ),
    ).rejects.toMatchObject({ source: "src", reason: "access_denied" });
    await expect(
      withPlanReadOrigin("src", () => Promise.resolve(3)),
    ).resolves.toBe(3);
  });

  it("keeps an already attributed denial and other errors", async () => {
    const denied = new AgentPlanReadDenied("first", "why");
    const other = new AgentError("plan_invalid");

    await expect(
      withPlanReadOrigin("src", () => Promise.reject(denied)),
    ).rejects.toBe(denied);
    await expect(
      withPlanReadOrigin("src", () => Promise.reject(other)),
    ).rejects.toBe(other);
    await expect(
      withPlanReadOrigin("src", () => Promise.reject(new Error("x"))),
    ).rejects.toThrow("x");
  });
});
