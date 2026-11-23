import { describe, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { AgentStepFailedError } from "@/backend/error/AgentStepFailedError";

import { createCliEnvironment } from "./CliEnvironment";
import {
  prepareGitHubAccess,
  readConnectionStatus,
  recordGitHubNamespace,
  requireAcpMode,
  requireAdapter,
  sessionAcpProvider,
  sessionContainment,
  validateSessionStatus,
} from "./CliSessionChecks";

import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";
import type { AcpDriver } from "@/backend/agents/acp/AcpDriver";
import type {
  CliCredentialAccess,
  CliHome,
  CliSessionRequest,
  CliStatusOutcome,
} from "./CliContracts";
import type { CliGitHubAccess } from "./CliGitHubCredentials";
import type { VerifiedStart } from "./CliSessionChecks";

const home: CliHome = {
  root: "/r",
  home: "/r/h",
  config: "/r/c",
  work: "/r/w",
};
const driver = {
  errors: {
    modeRequired: "codex_permission_mode_required",
    adapterMissing: "plan_acp_adapter_missing",
  },
} as unknown as AcpDriver;
const credentials: CliCredentialAccess = {
  modelProviders: ["opencode"],
  ownProvider: null,
  environmentFor: () => ({}),
  redact: (text) => text,
};
const signal = new AbortController().signal;

function sessionInput(
  provider: string,
  extra: Record<string, unknown> = {},
): AgentPlanSessionInput {
  return {
    agent: { connection: { provider }, model: "opencode/model" },
    options: { access: "yolo" },
    instanceId: "instance-1",
    ...extra,
  } as unknown as AgentPlanSessionInput;
}

function codeOf(call: () => unknown): unknown {
  try {
    call();
  } catch (error: unknown) {
    return error instanceof AgentError ? error.code : error;
  }
  return null;
}

describe("sessionContainment", () => {
  const request = (unit?: object): CliSessionRequest =>
    ({ unit }) as unknown as CliSessionRequest;

  it("names the real frame of a session", () => {
    expect(sessionContainment(true, request({}))).toBe("pid_namespace");
    expect(sessionContainment(false, request({}))).toBe("worker_unit");
    expect(sessionContainment(false, request())).toBe("none");
  });
});

describe("requireAcpMode and requireAdapter", () => {
  it("returns a stored mode and refuses an earlier one", () => {
    expect(requireAcpMode(driver, sessionInput("codex_cli"))).toBe("yolo");
    const earlier = sessionInput("codex_cli", { options: { access: "x" } });
    expect(codeOf(() => requireAcpMode(driver, earlier))).toBe(
      "codex_permission_mode_required",
    );
  });

  it("requires the adapter path", () => {
    expect(requireAdapter("/adapter", driver)).toBe("/adapter");
    expect(codeOf(() => requireAdapter(null, driver))).toBe(
      "plan_acp_adapter_missing",
    );
  });
});

describe("recordGitHubNamespace", () => {
  const namespace = { pid: 1, uid: 2, start: 3, boot: "b" };

  it("records only when both exist", async () => {
    const recordNamespace = vi.fn();
    const github = { recordNamespace } as unknown as CliGitHubAccess;
    await recordGitHubNamespace(null, namespace);
    await recordGitHubNamespace(github, undefined);
    expect(recordNamespace).not.toHaveBeenCalled();
    await recordGitHubNamespace(github, namespace);
    expect(recordNamespace).toHaveBeenCalledWith(namespace);
  });
});

describe("sessionAcpProvider", () => {
  it("maps the provider and refuses a chat without adapter", () => {
    expect(sessionAcpProvider(sessionInput("openrouter"))).toBe("opencode");
    expect(sessionAcpProvider(sessionInput("openai"))).toBeNull();
    expect(sessionAcpProvider(sessionInput("openai", { chat: {} }))).toBeNull();
    expect(sessionAcpProvider(sessionInput("codex_cli", { chat: {} }))).toBe(
      "codex_cli",
    );
  });
});

describe("readConnectionStatus", () => {
  const okVersion = { ok: true, detail: {} } as const;
  const status: CliStatusOutcome = {
    outcome: okVersion,
    accountLabel: "account",
  };

  function dependencies(
    version: unknown = okVersion,
    apiCredentials?: () => Promise<CliCredentialAccess>,
  ): {
    runtime: { adapter: ReturnType<typeof vi.fn> };
    apiCredentials?: () => Promise<CliCredentialAccess>;
    readStatus: ReturnType<typeof vi.fn>;
  } {
    const readStatus = vi.fn().mockResolvedValue(status);
    const adapter = vi.fn().mockResolvedValue({
      version: vi.fn().mockResolvedValue(version),
      readStatus,
    });
    return { runtime: { adapter }, apiCredentials, readStatus };
  }

  it("resolves API credentials for an OpenRouter session", async () => {
    const deps = dependencies(okVersion, async () => credentials);
    await expect(
      readConnectionStatus(deps as never, sessionInput("openrouter"), {
        home,
        signal,
        file: "/opencode",
      }),
    ).resolves.toEqual({
      outcome: { ok: true, detail: {} },
      accountLabel: null,
      credentials,
    });
    expect(deps.runtime.adapter).toHaveBeenCalledWith("opencode", "/opencode");
  });

  it("refuses an OpenRouter session whose version check fails", async () => {
    const deps = dependencies({ ok: false, errorCode: "cli_check_failed" });
    await expect(
      readConnectionStatus(deps as never, sessionInput("openrouter"), {
        home,
        signal,
      }),
    ).rejects.toMatchObject({ code: "cli_check_failed" });
  });

  it("refuses an OpenRouter session without credentials", async () => {
    for (const apiCredentials of [
      undefined,
      async () => undefined as unknown as CliCredentialAccess,
    ])
      await expect(
        readConnectionStatus(
          dependencies(okVersion, apiCredentials) as never,
          sessionInput("openrouter"),
          { home, signal },
        ),
      ).rejects.toMatchObject({ code: "secret_unavailable" });
  });

  it("refuses a provider that has no native ACP session", async () => {
    await expect(
      readConnectionStatus(dependencies() as never, sessionInput("openai"), {
        home,
        signal,
      }),
    ).rejects.toMatchObject({ code: "provider_invalid" });
  });

  it("reads the status of a native CLI with and without a file", async () => {
    const deps = dependencies();
    const options = { home, signal };
    await expect(
      readConnectionStatus(deps as never, sessionInput("codex_cli"), options),
    ).resolves.toBe(status);
    expect(deps.runtime.adapter).toHaveBeenLastCalledWith("codex_cli");
    await readConnectionStatus(deps as never, sessionInput("codex_cli"), {
      ...options,
      file: "/codex",
    });
    expect(deps.runtime.adapter).toHaveBeenLastCalledWith(
      "codex_cli",
      "/codex",
    );
  });

  it("checks the OpenCode version before its status", async () => {
    const good = dependencies();
    await expect(
      readConnectionStatus(good as never, sessionInput("opencode"), {
        home,
        signal,
      }),
    ).resolves.toBe(status);
    const bad = dependencies({ ok: false, errorCode: "cli_check_failed" });
    await expect(
      readConnectionStatus(bad as never, sessionInput("opencode"), {
        home,
        signal,
      }),
    ).rejects.toMatchObject({ code: "cli_check_failed" });
    expect(bad.readStatus).not.toHaveBeenCalled();
  });
});

describe("validateSessionStatus", () => {
  const ok = (extra: Partial<CliStatusOutcome> = {}): CliStatusOutcome => ({
    outcome: { ok: true, detail: {} },
    accountLabel: null,
    ...extra,
  });
  const failed = (errorCode: string): CliStatusOutcome =>
    ({
      outcome: { ok: false, errorCode, detail: {} },
      accountLabel: null,
    }) as unknown as CliStatusOutcome;

  it("refuses an aborted start", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      validateSessionStatus(sessionInput("codex_cli"), ok(), controller.signal),
    ).toThrow(AgentPlanCancelledError);
  });

  it("throws the plain code for OpenCode and a missing login", () => {
    expect(
      codeOf(() =>
        validateSessionStatus(
          sessionInput("opencode"),
          failed("cli_check_failed"),
          signal,
        ),
      ),
    ).toBe("cli_check_failed");
    expect(
      codeOf(() =>
        validateSessionStatus(
          sessionInput("codex_cli"),
          failed("cli_not_logged_in"),
          signal,
        ),
      ),
    ).toBe("cli_not_logged_in");
  });

  it("names the failed sign-in check for other failures", () => {
    expect(() =>
      validateSessionStatus(
        sessionInput("codex_cli"),
        failed("cli_check_failed"),
        signal,
      ),
    ).toThrow(AgentStepFailedError);
  });

  it("requires a live OpenCode model whose provider the credentials reach", () => {
    const input = sessionInput("opencode");
    expect(() =>
      validateSessionStatus(input, ok({ credentials }), signal),
    ).not.toThrow();
    expect(codeOf(() => validateSessionStatus(input, ok(), signal))).toBe(
      "plan_model_unavailable",
    );
    const other = { ...credentials, modelProviders: ["google"] };
    expect(
      codeOf(() =>
        validateSessionStatus(input, ok({ credentials: other }), signal),
      ),
    ).toBe("plan_model_unavailable");
    const retired = sessionInput("opencode", {
      agent: { connection: { provider: "opencode" }, model: "zai/model" },
    });
    expect(
      codeOf(() => validateSessionStatus(retired, ok({ credentials }), signal)),
    ).toBe("plan_model_unavailable");
  });

  it("accepts a healthy native CLI without credentials", () => {
    expect(() =>
      validateSessionStatus(sessionInput("codex_cli"), ok(), signal),
    ).not.toThrow();
  });
});

describe("prepareGitHubAccess", () => {
  const prepared = { prepared: true } as unknown as CliGitHubAccess;
  const baseStart: VerifiedStart = {
    provider: "codex_cli",
    home,
    file: "/synthetic/bin/codex",
    adapter: "/synthetic/adapter/acp",
  };

  function dependencies(): {
    github: { prepare: ReturnType<typeof vi.fn> };
    locator: { locate: ReturnType<typeof vi.fn> };
  } {
    return {
      github: { prepare: vi.fn().mockResolvedValue(prepared) },
      locator: { locate: vi.fn().mockResolvedValue({ path: "/usr/bin/gh" }) },
    };
  }

  it("returns null without a GitHub preparer", async () => {
    await expect(
      prepareGitHubAccess(
        { locator: dependencies().locator as never },
        sessionInput("codex_cli"),
        { start: baseStart, mode: "yolo" },
      ),
    ).resolves.toBeNull();
  });

  it("prepares an available project connection with gh and the bridge", async () => {
    const deps = dependencies();
    const bridge = { bridge: true };
    const input = sessionInput("codex_cli", {
      github: async () => ({ status: "available" }),
      gitBridge: async () => bridge,
    });
    await expect(
      prepareGitHubAccess(deps as never, input, {
        start: baseStart,
        mode: "yolo",
      }),
    ).resolves.toBe(prepared);
    expect(deps.locator.locate).toHaveBeenCalledWith("gh");
    expect(deps.github.prepare).toHaveBeenCalledWith({
      instanceId: "instance-1",
      access: { status: "available" },
      gh: "/usr/bin/gh",
      bridge,
      searchPath: createCliEnvironment(
        home,
        "codex_cli",
        "/synthetic/adapter/acp",
      ).PATH,
    });
  });

  it("explains a missing project connection in YOLO without a bridge", async () => {
    const deps = dependencies();
    await prepareGitHubAccess(deps as never, sessionInput("codex_cli"), {
      start: { ...baseStart, adapter: null },
      mode: "yolo",
    });
    expect(deps.locator.locate).not.toHaveBeenCalled();
    expect(deps.github.prepare).toHaveBeenCalledWith({
      instanceId: "instance-1",
      access: {
        status: "unavailable",
        reason: "no authorized project connection",
      },
      gh: null,
      bridge: undefined,
      searchPath: createCliEnvironment(home, "codex_cli", baseStart.file).PATH,
    });
  });

  it("marks a read-only session and skips the bridge", async () => {
    const deps = dependencies();
    const input = sessionInput("codex_cli", {
      gitBridge: async () => ({ bridge: true }),
    });
    await prepareGitHubAccess(deps as never, input, {
      start: baseStart,
      mode: "read_only",
    });
    expect(deps.github.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        access: { status: "unavailable", reason: "read-only session" },
        bridge: undefined,
      }),
    );
  });
});
