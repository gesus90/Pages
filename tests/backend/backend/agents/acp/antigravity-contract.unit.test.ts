import { describe, expect, it } from "vitest";

import { acpDriverFor } from "@/backend/agents/acp/AcpDrivers";
import {
  ANTIGRAVITY_ACP_DRIVER,
  ANTIGRAVITY_READ_TOOLS,
} from "@/backend/agents/acp/AntigravityAcpDriver";
import { requireAcpMcpCapabilities } from "@/backend/agents/acp/AcpLaunch";
import { createCliEnvironment } from "@/backend/agents/cli/CliEnvironment";
import { readAntigravityChallenge } from "@/backend/agents/cli/CliLoginParser";
import { isPicaAcpProvider } from "@/backend/service/chat/acp/PicaAcpRunners";
import { isAcpProvider } from "@/definition/AgentConfiguration";

import type { McpServer } from "@agentclientprotocol/sdk";

const HOME = {
  root: "/test/connection",
  home: "/test/connection/home",
  config: "/test/connection/gemini",
  work: "/test/connection/work",
};
const AUTH_URL =
  "https://accounts.google.com/o/oauth2/auth?response_type=code&state=synthetic-state&redirect_uri=http%3A%2F%2F127.0.0.1%3A45678%2F";

describe("official Antigravity registration", () => {
  it("pins identity, version and arguments without inventing an agy switch", () => {
    expect(isAcpProvider("antigravity")).toBe(true);
    expect(acpDriverFor("antigravity")).toBe(ANTIGRAVITY_ACP_DRIVER);
    expect(ANTIGRAVITY_ACP_DRIVER.arguments).toEqual(["--uid="]);
    expect(ANTIGRAVITY_ACP_DRIVER.binary).toBe("agy_acp_server.par");
    expect(
      ANTIGRAVITY_ACP_DRIVER.isSupportedAdapter({
        name: "antigravity-acp",
        version: "1.4.4",
      }),
    ).toBe(true);
    for (const agent of [
      null,
      { name: "agy", version: "1.4.4" },
      { name: "antigravity-acp", version: "1.4.3" },
    ])
      expect(ANTIGRAVITY_ACP_DRIVER.isSupportedAdapter(agent)).toBe(false);
  });

  it("requires exact model, thinking level and actual permission mode", () => {
    const profile = ANTIGRAVITY_ACP_DRIVER.profile("read_only");
    expect(
      profile.steps({
        model: "confirmed-flash-family",
        reasoningEffort: "low",
      }),
    ).toEqual([
      {
        id: "model",
        value: "confirmed-flash-family",
        refusal: "plan_model_unavailable",
        isExplicit: true,
      },
      {
        id: "thinking_level",
        value: "low",
        refusal: "plan_reasoning_unsupported",
        isExplicit: true,
      },
      {
        id: "mode",
        value: "default",
        refusal: "plan_permission_mode_unenforceable",
      },
    ]);
    const launch = ANTIGRAVITY_ACP_DRIVER.plan({
      instanceId: "synthetic-run",
      runnerFile: "/adapter/agy_acp_server.par",
      profile,
      mcp: null,
    });
    expect(launch.sessionMeta).toEqual({
      antigravity: {
        enabledTools: ANTIGRAVITY_READ_TOOLS,
        eagerMcpServers: ["pages"],
      },
    });
    expect(ANTIGRAVITY_READ_TOOLS).not.toContain("run_command");
    expect(
      ANTIGRAVITY_ACP_DRIVER.profile("yolo")
        .steps({ model: "confirmed", reasoningEffort: null })
        .at(-1)?.value,
    ).toBe("yolo");
  });

  it("blocks the Pica profile before starting a model until real restrictions are verified", () => {
    expect(isPicaAcpProvider("antigravity")).toBe(true);
    expect(() => ANTIGRAVITY_ACP_DRIVER.profile("read_only", "chat")).toThrow(
      expect.objectContaining({ code: "antigravity_pica_unverified" }),
    );
  });

  it("isolates Gemini home and removes unrelated credentials and updater input", () => {
    const environment = createCliEnvironment(
      HOME,
      "antigravity",
      "/adapter/agy_acp_server.par",
      {
        HOME: "/personal",
        GEMINI_HOME: "/personal/gemini",
        GOOGLE_API_KEY: "synthetic-private",
        NODE_OPTIONS: "synthetic-hook",
      },
    );
    expect(environment.GEMINI_HOME).toBe(HOME.config);
    expect(environment.HOME).toBe(HOME.home);
    expect(environment.BROWSER).toBe("/bin/true");
    expect(environment).not.toHaveProperty("GOOGLE_API_KEY");
    expect(environment).not.toHaveProperty("NODE_OPTIONS");
  });
});

it("accepts only the official Google URL with the adapter's loopback callback, with no device code", () => {
  expect(
    readAntigravityChallenge(
      `Open the following link to authenticate the ACP server: ${AUTH_URL}`,
    ),
  ).toEqual({ verificationUrl: AUTH_URL });
  for (const url of [
    AUTH_URL.replace(
      "accounts.google.com",
      "accounts.google.com.attacker.invalid",
    ),
    AUTH_URL.replace("127.0.0.1", "192.168.0.1"),
    AUTH_URL.replace("response_type=code", "response_type=token"),
    AUTH_URL.replace("state=synthetic-state", "state="),
    AUTH_URL + "#fragment",
  ])
    expect(readAntigravityChallenge(url)).toBeNull();
});

it("requires separately advertised HTTP and SSE MCP capabilities", () => {
  const http: McpServer = {
    type: "http",
    name: "pages",
    url: "http://127.0.0.1:3101/mcp",
    headers: [],
  };
  const sse: McpServer = {
    type: "sse",
    name: "pages",
    url: "http://127.0.0.1:3101/sse",
    headers: [],
  };
  expect(() =>
    requireAcpMcpCapabilities([http, sse], { http: true, sse: true }),
  ).not.toThrow();
  expect(() => requireAcpMcpCapabilities([sse], { http: true })).toThrow(
    expect.objectContaining({ code: "plan_mcp_unavailable" }),
  );
  expect(() => requireAcpMcpCapabilities([http], undefined)).toThrow();
});
