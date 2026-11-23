import { describe, expect, it } from "vitest";

import { AgentProviderError } from "@/backend/error/AgentProviderError";
import { AgentStepFailedError } from "@/backend/error/AgentStepFailedError";
import { AutomationError } from "@/backend/error/AutomationError";

describe("agent step and provider errors", () => {
  it("keeps the provider failure and uses its code", () => {
    const failure = {
      code: "provider_unreachable",
      resetAt: null,
    } as const;
    const error = new AgentProviderError(failure);

    expect(error.failure).toBe(failure);
    expect(error.code).toBe("provider_unreachable");
    expect(error.name).toBe("AgentProviderError");
  });

  it("keeps the failed step and its optional cause", () => {
    expect(new AgentStepFailedError("s").cause).toBeNull();
    const error = new AgentStepFailedError("s", "why");

    expect(error.step).toBe("s");
    expect(error.cause).toBe("why");
    expect(error.code).toBe("plan_step_failed");
  });
});

describe("automation errors", () => {
  it.each([
    ["invalid_request", 400],
    ["forbidden", 403],
    ["not_found", 404],
    ["conflict", 409],
    ["too_large", 413],
    ["rate_limited", 429],
    ["server_unavailable", 503],
  ] as const)("maps %s to status %i", (code, status) => {
    const error = new AutomationError(code);

    expect(error.status).toBe(status);
    expect(error.reason).toBeNull();
    expect(error.currentRevision).toBeNull();
    expect(error.problems).toEqual([]);
    expect(error.message).toBe(`The automation request was refused (${code}).`);
  });

  it("keeps the reason, revision and problems when given", () => {
    const error = new AutomationError("conflict", {
      reason: "revision_conflict",
      currentRevision: 3,
      problems: ["a"],
    });

    expect(error.reason).toBe("revision_conflict");
    expect(error.currentRevision).toBe(3);
    expect(error.problems).toEqual(["a"]);
  });
});
