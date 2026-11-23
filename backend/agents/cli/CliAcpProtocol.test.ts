import { beforeEach, expect, it, vi } from "vitest";

import { prepareAcpProtocol } from "@/backend/agents/cli/CliAcpProtocol";
import { AGENT_ACCESS_POLICY_VERSION } from "@/definition/AgentAccessMode";

import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";
import type { AcpDriver } from "@/backend/agents/acp/AcpDriver";
import type { VerifiedStart } from "@/backend/agents/cli/CliSessionChecks";

const h = vi.hoisted(() => ({
  nativeHostProfile: vi.fn<(...parameters: unknown[]) => unknown>(),
  redactNativeHost: vi.fn<(...parameters: unknown[]) => unknown>(),
  planAcpLaunch: vi.fn<(...parameters: unknown[]) => unknown>(),
  channel: vi.fn<(...parameters: unknown[]) => unknown>(),
  acknowledgement: vi.fn<(...parameters: unknown[]) => unknown>(),
}));

vi.mock("@/backend/agents/cli/CliNativeHost", () => ({
  nativeHostProfile: h.nativeHostProfile,
  redactNativeHost: h.redactNativeHost,
}));
vi.mock("@/backend/agents/cli/CliAcpLaunch", () => ({
  planAcpLaunch: h.planAcpLaunch,
}));
vi.mock("@/backend/agents/acp/AcpLineChannel", () => ({
  AcpLineChannel: class {
    public enableAcknowledgement = h.acknowledgement;
    public constructor(isSensitive: boolean) {
      h.channel(isSensitive);
    }
  },
}));

/** Casts a partial stand-in to the type the code under test expects. */
function fake<T>(value: object): T {
  return value as T;
}

function sessionInput(parts: object = {}): AgentPlanSessionInput {
  return fake<AgentPlanSessionInput>({
    options: { access: "read_only" },
    agent: { connection: { provider: "claude_code" }, model: "model" },
    ...parts,
  });
}

function driverOf(provider: string): AcpDriver {
  return fake<AcpDriver>({
    provider,
    profile: vi.fn((mode: string, purpose: string) => ({
      unattended: `${mode}/${purpose}`,
      permissions: { base: true },
    })),
  });
}

function startOf(host?: object): VerifiedStart {
  return fake<VerifiedStart>({
    file: "/file",
    host,
    credentials: { redact: (text: string) => text.replace("key", "[k]") },
  });
}

beforeEach(() => {
  h.planAcpLaunch.mockReturnValue({ environment: {} });
  h.redactNativeHost.mockImplementation((text) => `host:${String(text)}`);
});

it("prepares a read-only plan session without a native host", () => {
  const driver = driverOf("claude_code");
  const protocol = prepareAcpProtocol(driver, sessionInput(), startOf(), null);
  expect(driver.profile).toHaveBeenCalledWith("read_only", "plan");
  expect(protocol.profile).toEqual({
    unattended: "read_only/plan",
    permissions: {
      base: true,
      accessPolicy: `read_only v${AGENT_ACCESS_POLICY_VERSION}`,
    },
  });
  expect(h.planAcpLaunch).toHaveBeenCalledWith(
    driver,
    expect.anything(),
    "/file",
    protocol.profile,
  );
  expect(h.channel).toHaveBeenCalledWith(false);
  expect(h.acknowledgement).toHaveBeenCalledOnce();
  expect(protocol.redact("key")).toBe("host:[k]");
});

it("uses the native host profile and the full access of a non-read-only session", () => {
  h.nativeHostProfile.mockReturnValue({ native: true });
  const host = { name: "host" };
  const protocol = prepareAcpProtocol(
    driverOf("claude_code"),
    sessionInput({
      options: { access: "full" },
      purpose: "decision",
    }),
    startOf(host),
    null,
  );
  const [described, usedHost] = h.nativeHostProfile.mock.calls[0];
  expect(described).toMatchObject({
    permissions: {
      accessPolicy: `yolo v${AGENT_ACCESS_POLICY_VERSION}`,
    },
  });
  expect(usedHost).toBe(host);
  expect(protocol.profile).toEqual({ native: true });
  protocol.redact("x");
  expect(h.redactNativeHost).toHaveBeenCalledWith("x", host);
});

it("treats chat transports of Codex and OpenCode as sensitive", () => {
  const chat = sessionInput({ chat: {} });
  prepareAcpProtocol(driverOf("codex_cli"), chat, startOf(), null);
  prepareAcpProtocol(driverOf("opencode"), chat, startOf(), null);
  prepareAcpProtocol(driverOf("claude_code"), chat, startOf(), null);
  expect(h.channel.mock.calls).toEqual([[true], [true], [false]]);
  const driver = driverOf("claude_code");
  prepareAcpProtocol(driver, chat, startOf(), null);
  expect(driver.profile).toHaveBeenCalledWith("read_only", "chat");
});
