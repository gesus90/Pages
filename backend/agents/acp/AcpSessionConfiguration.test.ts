import { PROTOCOL_VERSION, RequestError } from "@agentclientprotocol/sdk";
import { describe, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { createAcpSessionState } from "@/backend/agents/acp/AcpEvents";
import {
  confirmAcpConfiguration,
  describeAcpSession,
  hasAcpConfigurationChanged,
  requireVerifiedAcpAdapter,
} from "@/backend/agents/acp/AcpSessionConfiguration";

import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type {
  AcpConfigStep,
  AcpDriver,
  AcpSessionProfile,
} from "@/backend/agents/acp/AcpDriver";
import type { AcpSessionState } from "@/backend/agents/acp/AcpEvents";
import type { AcpConfigurationTarget } from "@/backend/agents/acp/AcpSessionConfiguration";
import type { AcpSessionContext } from "@/backend/agents/acp/AcpSessionContracts";

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

/** Casts a partial stand-in to the type the code under test expects. */
function fake<T>(value: object): T {
  return value as T;
}

function select(
  id: string,
  currentValue: string,
  values: string[] = [currentValue],
): SessionConfigOption {
  return fake<SessionConfigOption>({
    id,
    name: id,
    type: "select",
    currentValue,
    options: values.map((value) => ({ value, name: value })),
  });
}

function setup(
  answer: (params: { configId: string; value: string }) => unknown,
  aborted = false,
): {
  request: ReturnType<typeof vi.fn>;
  state: AcpSessionState;
  target: AcpConfigurationTarget;
} {
  const request = vi.fn((...[, params]: [unknown, never]) => {
    const result = answer(params);
    if (result instanceof Error) return Promise.reject(result);
    return Promise.resolve({ configOptions: result });
  });
  const state = createAcpSessionState();
  const target = fake<AcpConfigurationTarget>({
    connection: { agent: { request }, signal: { aborted } },
    state,
    errors: { adapterUnsupported: "plan_acp_adapter_unsupported" },
    sessionId: "s1",
  });
  return { request, state, target };
}

function step(fields: Partial<AcpConfigStep> = {}): AcpConfigStep {
  return {
    id: "model",
    value: "b",
    refusal: "plan_model_unavailable",
    ...fields,
  };
}

const INITIAL = [select("model", "a", ["a", "b"])];

describe("confirmAcpConfiguration", () => {
  it("sets and confirms a value", async () => {
    const { target, state, request } = setup(() => [
      select("model", "b", ["a", "b"]),
    ]);
    const options = await confirmAcpConfiguration(target, INITIAL, [step()]);
    expect(options).toEqual([select("model", "b", ["a", "b"])]);
    expect(request).toHaveBeenCalledOnce();
    expect(state.events).toEqual(["model b confirmed"]);
  });

  it("skips a value that is already current", async () => {
    const { target, request } = setup(() => []);
    await confirmAcpConfiguration(target, INITIAL, [step({ value: "a" })]);
    expect(request).not.toHaveBeenCalled();
  });

  it("sends an explicit selection even when current", async () => {
    const { target, request } = setup(() => INITIAL);
    await confirmAcpConfiguration(target, INITIAL, [
      step({ value: "a", isExplicit: true }),
    ]);
    expect(request).toHaveBeenCalledOnce();
  });

  it("lets the adapter resolve a value it does not list", async () => {
    const { target, state } = setup(() => [select("model", "resolved")]);
    await confirmAcpConfiguration(target, INITIAL, [
      step({ value: "alias", isResolvedByAdapter: true }),
    ]);
    expect(state.events).toEqual(["model alias as resolved"]);
  });

  it("ignores a missing optional option", async () => {
    const { target } = setup(() => []);
    const options = await confirmAcpConfiguration(
      target,
      [],
      [step({ isOptional: true })],
    );
    expect(options).toEqual([]);
  });

  it("refuses a missing option with the adapter code", async () => {
    const { target, state } = setup(() => []);
    state.effective.adapter = "codex 1";
    await expect(
      confirmAcpConfiguration(target, [], [step()]),
    ).rejects.toMatchObject({ code: "plan_acp_adapter_unsupported" });
    expect(state.events).toEqual([
      "model b is not an option of the adapter (codex 1)",
    ]);
  });

  it("refuses a missing reasoning option with its own code", async () => {
    const { target } = setup(() => []);
    await expect(
      confirmAcpConfiguration(
        target,
        [],
        [step({ refusal: "plan_reasoning_unsupported" })],
      ),
    ).rejects.toMatchObject({ code: "plan_reasoning_unsupported" });
  });
});

describe("confirmAcpConfiguration refusals", () => {
  it("refuses a value the adapter does not offer", async () => {
    const { target, state } = setup(() => []);
    await expect(
      confirmAcpConfiguration(target, INITIAL, [step({ value: "z" })]),
    ).rejects.toMatchObject({ code: "plan_model_unavailable" });
    expect(state.events[0]).toContain("is not among a, b");
  });

  it("refuses a value the adapter rejects", async () => {
    const { target, state } = setup(() => new RequestError(-32602, "bad"));
    await expect(
      confirmAcpConfiguration(target, INITIAL, [step()]),
    ).rejects.toMatchObject({ code: "plan_model_unavailable" });
    expect(state.events[0]).toContain("was refused by the adapter");
  });

  it("passes on a refusal after the connection ended", async () => {
    const { target } = setup(() => new RequestError(-32602, "bad"), true);
    await expect(
      confirmAcpConfiguration(target, INITIAL, [step()]),
    ).rejects.toBeInstanceOf(RequestError);
  });

  it("passes on another request error", async () => {
    const { target } = setup(() => new Error("pipe"));
    await expect(
      confirmAcpConfiguration(target, INITIAL, [step()]),
    ).rejects.toThrow("pipe");
  });

  it("refuses an answer without the option", async () => {
    const { target, state } = setup(() => []);
    await expect(
      confirmAcpConfiguration(target, INITIAL, [step()]),
    ).rejects.toBeInstanceOf(AgentError);
    expect(state.events[0]).toContain("was not confirmed by the adapter");
  });

  it("refuses an answer that keeps another value", async () => {
    const { target, state } = setup(() => [select("model", "a", ["a", "b"])]);
    await expect(
      confirmAcpConfiguration(target, INITIAL, [step()]),
    ).rejects.toBeInstanceOf(AgentError);
    expect(state.events[0]).toContain("the adapter kept a");
  });

  it("refuses a value that changed after a later selector", async () => {
    const { target, state } = setup(({ configId }) =>
      configId === "model"
        ? [
            select("model", "b", ["a", "b"]),
            select("effort", "low", ["low", "high"]),
          ]
        : [
            select("model", "a", ["a", "b"]),
            select("effort", "high", ["low", "high"]),
          ],
    );
    await expect(
      confirmAcpConfiguration(
        target,
        [
          select("model", "a", ["a", "b"]),
          select("effort", "low", ["low", "high"]),
        ],
        [step(), step({ id: "effort", value: "high" })],
      ),
    ).rejects.toBeInstanceOf(AgentError);
    expect(state.events.at(-1)).toContain("changed after another selector");
  });

  it("tolerates a resolved step and a vanished optional option at the end", async () => {
    const { target } = setup(({ configId }) =>
      configId === "model" ? [select("model", "x")] : [select("model", "x")],
    );
    const options = await confirmAcpConfiguration(
      target,
      [select("model", "a", ["a"]), select("effort", "low", ["high", "low"])],
      [
        step({ value: "alias", isResolvedByAdapter: true }),
        step({ id: "effort", value: "high", isOptional: true }),
      ],
    );
    expect(options).toEqual([select("model", "x")]);
  });
});

describe("hasAcpConfigurationChanged", () => {
  it("never reports drift for Claude Code or without expectations", () => {
    const state = createAcpSessionState();
    expect(
      hasAcpConfigurationChanged("claude_code", { model: "x" }, state),
    ).toBe(false);
    expect(hasAcpConfigurationChanged("codex_cli", null, state)).toBe(false);
  });

  it("reports no drift when the values match", () => {
    const state = createAcpSessionState();
    state.effective.model = "m";
    expect(hasAcpConfigurationChanged("codex_cli", { model: "m" }, state)).toBe(
      false,
    );
  });

  it("names the field that drifted", () => {
    const state = createAcpSessionState();
    state.effective.model = "other";
    expect(hasAcpConfigurationChanged("codex_cli", { model: "m" }, state)).toBe(
      true,
    );
    expect(state.events).toEqual(["runtime configuration changed: model"]);
  });
});

describe("describeAcpSession", () => {
  const profile = (permissions: Record<string, string>): AcpSessionProfile =>
    fake({ permissions });

  it("records permissions and isolation", () => {
    const state = createAcpSessionState();
    describeAcpSession(
      state,
      fake<AcpSessionContext>({
        profile: profile({ shell: "none" }),
        isolation: "sandbox",
        driver: { provider: "codex_cli" },
        request: { directory: "/w" },
      }),
    );
    expect(state.effective).toEqual({ shell: "none", isolation: "sandbox" });
    expect(state.events).toEqual([]);
  });

  it("records the workspace of OpenCode, GitHub access and a YOLO account", () => {
    const state = createAcpSessionState();
    describeAcpSession(
      state,
      fake<AcpSessionContext>({
        profile: profile({ account: "igor" }),
        isolation: "host",
        driver: { provider: "opencode" },
        request: { directory: "/w" },
        github: "available",
      }),
    );
    expect(state.effective).toMatchObject({
      workspace: "/w",
      github: "available",
      account: "igor",
    });
    expect(state.events[0]).toContain("account igor");
  });
});

describe("requireVerifiedAcpAdapter", () => {
  const driver = (
    supported: boolean,
  ): Pick<AcpDriver, "isSupportedAdapter" | "supportedVersions" | "errors"> =>
    fake({
      isSupportedAdapter: () => supported,
      supportedVersions: "1.x",
      errors: { adapterUnsupported: "plan_acp_adapter_unsupported" },
    });
  const agentInfo = { name: "codex", version: "1.0" };

  it("returns a verified adapter", () => {
    const state = createAcpSessionState();
    expect(
      requireVerifiedAcpAdapter(state, driver(true), {
        agentInfo,
        protocolVersion: PROTOCOL_VERSION,
      }),
    ).toBe("codex 1.0");
    expect(state.effective.protocol).toBe(`ACP ${PROTOCOL_VERSION}`);
  });

  it("refuses an unsupported adapter", () => {
    const state = createAcpSessionState();
    expect(() =>
      requireVerifiedAcpAdapter(state, driver(false), {
        agentInfo,
        protocolVersion: PROTOCOL_VERSION,
      }),
    ).toThrow(AgentError);
    expect(state.events[0]).toContain("is not supported, Pages verified 1.x");
  });

  it("refuses an unknown adapter and another protocol version", () => {
    const state = createAcpSessionState();
    expect(() =>
      requireVerifiedAcpAdapter(state, driver(true), {
        agentInfo: null,
        protocolVersion: PROTOCOL_VERSION + 1,
      }),
    ).toThrow(AgentError);
    expect(state.effective.adapter).toBe("unknown");
  });
});
