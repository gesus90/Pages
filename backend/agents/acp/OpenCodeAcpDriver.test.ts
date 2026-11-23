import { expect, it, vi } from "vitest";

import { OPENCODE_ACP_DRIVER } from "@/backend/agents/acp/OpenCodeAcpDriver";
import { openCodeAcpProfile } from "@/backend/agents/acp/OpenCodeAcpProfile";

import type { AcpLaunchSpecification } from "@/backend/agents/acp/AcpDriver";
import type { AcpLaunch } from "@/backend/agents/acp/AcpLaunch";

vi.mock("@/backend/agents/cli/OpenCodeVersion", () => ({
  SUPPORTED_OPENCODE_VERSION: "1.0.0",
  isSupportedOpenCodeVersion: (version: string) => version === "1.0.0",
}));

const MCP = { url: "http://pages/", token: "tok", tools: null };

function specification(
  purpose: AcpLaunchSpecification["purpose"],
  mode: "read_only" | "yolo",
  withModel = true,
): AcpLaunchSpecification {
  return {
    instanceId: "run-1",
    runnerFile: "/bin/opencode",
    profile: openCodeAcpProfile(mode, purpose),
    mcp: MCP,
    purpose,
    ...(withModel
      ? { model: { model: "prov/model", reasoningEffort: "high" } }
      : {}),
  };
}

interface LaunchConfig {
  readonly default_agent: string;
  readonly enabled_providers: string[];
  readonly agent: Record<string, { variant?: string; disable?: boolean }>;
}

function configOf(launch: AcpLaunch): LaunchConfig {
  const config: unknown = JSON.parse(
    launch.environment.OPENCODE_CONFIG_CONTENT ?? "{}",
  );
  return Object.assign(
    { default_agent: "", enabled_providers: [], agent: {} },
    config,
  );
}

it("accepts only a supported OpenCode agent", () => {
  expect(
    OPENCODE_ACP_DRIVER.isSupportedAdapter({
      name: "OpenCode",
      version: "1.0.0",
    }),
  ).toBe(true);
  expect(
    OPENCODE_ACP_DRIVER.isSupportedAdapter({ name: "Other", version: "1.0.0" }),
  ).toBe(false);
  expect(OPENCODE_ACP_DRIVER.isSupportedAdapter(null)).toBe(false);
});

it("refuses a launch without a model", () => {
  expect(() =>
    OPENCODE_ACP_DRIVER.plan(specification("plan", "yolo", false)),
  ).toThrow(/./u);
});

it("plans a read-only Pica chat without MCP servers", () => {
  const launch = OPENCODE_ACP_DRIVER.plan(specification("chat", "read_only"));
  const config = configOf(launch);
  expect(config.default_agent).toBe("pages-pica");
  expect(config.enabled_providers).toEqual(["prov"]);
  expect(config.agent.build).toBeUndefined();
  expect(launch.mcpServers).toEqual([]);
  expect(launch.environment.OPENCODE_SERVER_PASSWORD).toBeTruthy();
});

it.each(["decision", "observer"] as const)(
  "plans a %s without tools",
  (purpose) => {
    const launch = OPENCODE_ACP_DRIVER.plan(specification(purpose, "yolo"));
    expect(configOf(launch).default_agent).toBe("pages-decision");
    expect(configOf(launch).agent.build).toEqual({ disable: true });
    expect(launch.mcpServers).toEqual([]);
  },
);

it("plans a plan node with the Pages MCP server and the default effort", () => {
  const plan = specification("plan", "read_only");
  const launch = OPENCODE_ACP_DRIVER.plan({
    ...plan,
    model: { model: "prov/model", reasoningEffort: null },
  });
  expect(configOf(launch).default_agent).toBe("pages-read-only");
  expect(configOf(launch).agent.general?.variant).toBe("default");
  expect(launch.mcpServers).toHaveLength(1);
});

it("plans a plan node of an employee in YOLO chat with the stock agent", () => {
  const launch = OPENCODE_ACP_DRIVER.plan(specification("chat", "yolo"));
  expect(configOf(launch).default_agent).toBe("pages-yolo");
  expect(launch.mcpServers).toEqual([]);
});

it("plans without a purpose as a plan node", () => {
  const launch = OPENCODE_ACP_DRIVER.plan(specification(undefined, "yolo"));
  expect(configOf(launch).default_agent).toBe("pages-yolo");
});

it("names no agent for a profile without a session mode", () => {
  const plan = specification("plan", "yolo");
  const launch = OPENCODE_ACP_DRIVER.plan({
    ...plan,
    profile: { ...plan.profile, permissions: {} },
  });
  expect(configOf(launch).default_agent).toBe("");
});
