import { RequestError } from "@agentclientprotocol/sdk";
import { describe, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { createAcpSessionState } from "@/backend/agents/acp/AcpEvents";
import {
  abortFailure,
  acpErrorFailure,
  classifiedAcpFailure,
  disconnectedAcpOutcome,
  finishAcpTurn,
  stopFailure,
} from "@/backend/agents/acp/AcpSessionOutcome";

import type { AcpDriver } from "@/backend/agents/acp/AcpDriver";
import type { CliSessionExit } from "@/backend/agents/cli/CliSessionProcess";

vi.mock("@/backend/logging/Logger", () => ({
  logEvent: vi.fn(),
  logCaughtError: vi.fn(),
}));

const DRIVER: Pick<AcpDriver, "provider" | "errors"> = {
  provider: "codex_cli",
  errors: {
    modeRequired: "codex_permission_mode_required",
    adapterMissing: "plan_acp_adapter_missing",
    adapterUnsupported: "plan_acp_adapter_unsupported",
    sessionFailed: "plan_acp_session_failed",
  },
};

const OPENCODE: Pick<AcpDriver, "provider" | "errors"> = {
  ...DRIVER,
  provider: "opencode",
};

const redact = (text: string): string => text.replace("secret", "***");

describe("stopFailure and abortFailure", () => {
  it("maps every stop reason", () => {
    expect(stopFailure("end_turn")).toBeNull();
    expect(stopFailure("cancelled")).toBe("cancelled");
    expect(stopFailure("refusal")).toBe("failed");
    expect(stopFailure("max_tokens")).toBe("incomplete");
    expect(stopFailure("max_turn_requests")).toBe("incomplete");
  });

  it("tells a deadline from a cancellation", () => {
    const timeout = AbortSignal.timeout(0);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(abortFailure(timeout)).toBe("timeout");
        const controller = new AbortController();
        controller.abort("stop");
        expect(abortFailure(controller.signal)).toBe("cancelled");
        const named = new AbortController();
        named.abort(new DOMException("x", "AbortError"));
        expect(abortFailure(named.signal)).toBe("cancelled");
        resolve();
      }, 5);
    });
  });
});

describe("finishAcpTurn", () => {
  it("returns the redacted result of a clean turn", () => {
    const state = createAcpSessionState();
    state.text = "a secret";
    state.sessionId = "s-secret";
    state.effective["k-secret"] = "v-secret";
    state.events.push("e-secret");
    const turn = finishAcpTurn(
      state,
      { failure: null, errorCode: null, hasHistoryFailure: false },
      redact,
    );
    expect(turn).toMatchObject({
      output: "a ***",
      sessionId: "s-***",
      failure: null,
      effective: { "k-***": "v-***" },
      events: ["e-***"],
    });
    expect(turn).not.toHaveProperty("providerFailure");
  });

  it("fails a turn whose history is lost", () => {
    const state = createAcpSessionState();
    state.text = "x";
    state.providerFailure = { code: "provider_quota_exhausted", resetAt: null };
    const turn = finishAcpTurn(
      state,
      { failure: null, errorCode: null, hasHistoryFailure: true },
      redact,
    );
    expect(turn).toMatchObject({
      output: "",
      sessionId: null,
      failure: "failed",
      errorCode: "plan_history_unavailable",
    });
    expect(turn.providerFailure?.code).toBe("provider_quota_exhausted");
  });

  it("fails an oversized result", () => {
    const state = createAcpSessionState();
    state.isResultOversized = true;
    const turn = finishAcpTurn(
      state,
      { failure: null, errorCode: null, hasHistoryFailure: false },
      redact,
    );
    expect(turn).toMatchObject({ output: "", errorCode: "acp_result_limit" });
  });

  it("keeps the failure of an oversized result that already failed", () => {
    const state = createAcpSessionState();
    state.isResultOversized = true;
    const turn = finishAcpTurn(
      state,
      { failure: "timeout", errorCode: null, hasHistoryFailure: false },
      redact,
    );
    expect(turn.failure).toBe("timeout");
  });
});

describe("classifiedAcpFailure", () => {
  it("keeps the session code without a more specific cause", () => {
    expect(classifiedAcpFailure(DRIVER, "boom")).toBe(
      "plan_acp_session_failed",
    );
  });

  it("names a specific cause", () => {
    expect(classifiedAcpFailure(DRIVER, "429")).toBe("provider_rate_limited");
    expect(classifiedAcpFailure(DRIVER, "429", true)).toBe(
      "openrouter_rate_limited",
    );
  });
});

describe("acpErrorFailure", () => {
  const plain = { isDisconnected: false };

  it("returns the code of an AgentError", () => {
    expect(
      acpErrorFailure(
        new AgentError("acp_result_limit"),
        createAcpSessionState(),
        DRIVER,
        plain,
      ),
    ).toBe("acp_result_limit");
  });

  it("keeps a provider failure in the state", () => {
    const state = createAcpSessionState();
    expect(
      acpErrorFailure(new Error("429 rate limit"), state, DRIVER, plain),
    ).toBe("provider_rate_limited");
    expect(state.providerFailure?.code).toBe("provider_rate_limited");
  });

  it("maps a rate limit to OpenRouter", () => {
    const state = createAcpSessionState();
    expect(
      acpErrorFailure(new Error("429"), state, DRIVER, {
        isDisconnected: false,
        isOpenRouter: true,
      }),
    ).toBe("openrouter_rate_limited");
  });

  it("keeps another provider failure under OpenRouter", () => {
    const state = createAcpSessionState();
    expect(
      acpErrorFailure(new Error("insufficient credits"), state, DRIVER, {
        isDisconnected: false,
        isOpenRouter: true,
      }),
    ).toBe("provider_quota_exhausted");
  });

  it("falls back to the failure the state already holds", () => {
    const state = createAcpSessionState();
    state.providerFailure = { code: "provider_unavailable", resetAt: null };
    expect(acpErrorFailure("odd", state, DRIVER, plain)).toBe(
      "provider_unavailable",
    );
  });

  it("leaves a disconnect to the process exit", () => {
    expect(
      acpErrorFailure(new Error("x"), createAcpSessionState(), DRIVER, {
        isDisconnected: true,
      }),
    ).toBeNull();
  });

  it("classifies OpenCode failures", () => {
    const state = createAcpSessionState();
    expect(
      acpErrorFailure(new Error("ModelNotFoundError"), state, OPENCODE, plain),
    ).toBe("provider_model_not_found");
    expect(state.events).toEqual([
      "OpenCode failure: provider_model_not_found",
    ]);
  });

  it("asks for a sign-in on an authentication request", () => {
    expect(
      acpErrorFailure(
        new RequestError(-32000, "auth"),
        createAcpSessionState(),
        DRIVER,
        plain,
      ),
    ).toBe("cli_not_logged_in");
  });

  it("classifies the message of another error", () => {
    const state = createAcpSessionState();
    expect(acpErrorFailure(new Error("boom"), state, DRIVER, plain)).toBe(
      "plan_acp_session_failed",
    );
    expect(
      acpErrorFailure(new RequestError(-1, "x"), state, DRIVER, plain),
    ).toBe("plan_acp_session_failed");
    expect(acpErrorFailure("text", state, DRIVER, plain)).toBe(
      "plan_acp_session_failed",
    );
    expect(state.events).toContain("error unknown");
  });
});

describe("disconnectedAcpOutcome", () => {
  const exit = (
    errorCode: CliSessionExit["errorCode"],
    stderrTail = "oops secret",
  ): CliSessionExit => ({ code: null, signal: null, errorCode, stderrTail });
  const options = { isPicaNative: false, redact };

  it("reports the deadline of the process as a timeout", () => {
    expect(
      disconnectedAcpOutcome(
        exit("check_timeout"),
        createAcpSessionState(),
        DRIVER,
        options,
      ),
    ).toEqual({ failure: "timeout", errorCode: null });
  });

  it.each([
    "acp_worker_limit",
    "acp_output_overflow",
    "acp_input_too_large",
  ] as const)("keeps the limit code %s", (code) => {
    expect(
      disconnectedAcpOutcome(
        exit(code),
        createAcpSessionState(),
        DRIVER,
        options,
      ),
    ).toEqual({ failure: "failed", errorCode: code });
  });

  it("notes the redacted error stream and classifies it", () => {
    const state = createAcpSessionState();
    expect(disconnectedAcpOutcome(exit(null), state, DRIVER, options)).toEqual({
      failure: "failed",
      errorCode: "plan_acp_session_failed",
    });
    expect(state.events).toEqual(["adapter oops ***"]);
  });

  it("keeps the stream out of the record for native Pica and OpenCode", () => {
    const native = createAcpSessionState();
    disconnectedAcpOutcome(exit(null, "429"), native, DRIVER, {
      ...options,
      isPicaNative: true,
    });
    expect(native.events).toEqual([]);
    const opencode = createAcpSessionState();
    expect(
      disconnectedAcpOutcome(exit(null, "429"), opencode, OPENCODE, {
        ...options,
        isOpenRouter: true,
      }).errorCode,
    ).toBe("openrouter_rate_limited");
    expect(opencode.events).toEqual([]);
  });
});
