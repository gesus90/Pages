import { afterEach, expect, it, vi } from "vitest";

import {
  antigravityEnvironment,
  antigravityTurnFailure,
  chooseAntigravity,
} from "@/scripts/runner/antigravity.mjs";

const savedEnvironment = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnvironment };
});

it("binds an absolute managed context and rejects unsafe roots", () => {
  process.env.PAGES_RUNNER_ANTIGRAVITY_CONTEXT_ROOT = "/synthetic/context";
  expect(antigravityEnvironment({ HOME: "/synthetic/home" })).toMatchObject({
    HOME: "/synthetic/context/home",
    GEMINI_HOME: "/synthetic/context/gemini",
    XDG_CONFIG_HOME: "/synthetic/context/config",
    XDG_CACHE_HOME: "/synthetic/context/work",
    BROWSER: "/bin/true",
  });
  for (const root of ["relative", "/", "/synthetic/../other", "/synthetic/"]) {
    process.env.PAGES_RUNNER_ANTIGRAVITY_CONTEXT_ROOT = root;
    expect(() => antigravityEnvironment({ HOME: "/synthetic/home" })).toThrow(
      "Invalid Antigravity context",
    );
  }
});

it("selects grouped options only when the adapter confirms the exact value", async () => {
  const options = [
    {
      id: "model",
      type: "select",
      options: [{ group: "models", options: [{ value: "a" }] }],
    },
  ];
  const confirmed = [{ id: "model", currentValue: "a" }];
  const client = { call: vi.fn(async () => ({ configOptions: confirmed })) };
  await expect(
    chooseAntigravity(client, "session", options, {
      id: "model",
      value: "a",
      error: "unavailable",
    }),
  ).resolves.toEqual(confirmed);
  expect(client.call).toHaveBeenCalledWith("session/set_config_option", {
    sessionId: "session",
    configId: "model",
    value: "a",
  });
  await expect(
    chooseAntigravity(client, "session", options, {
      id: "model",
      value: "b",
      error: "unavailable",
    }),
  ).rejects.toMatchObject({ pagesCode: "unavailable" });
  expect(client.call).toHaveBeenCalledTimes(1);
});

it("classifies adapter failures and requires an MCP server for MCP failures", () => {
  expect(
    antigravityTurnFailure(
      "Usage Limit Reached\n\nYou have reached your current quota for this period.",
      false,
    ),
  ).toBe("provider_quota_exhausted");
  expect(
    antigravityTurnFailure(
      "The MCP server 'pages' failed to initialize: failure",
      true,
    ),
  ).toBe("plan_mcp_unavailable");
  expect(
    antigravityTurnFailure(
      "The MCP server 'pages' failed to initialize: failure",
      false,
    ),
  ).toBeNull();
  expect(antigravityTurnFailure("Agent execution error: failure", false)).toBe(
    "antigravity_acp_session_failed",
  );
  expect(antigravityTurnFailure("ordinary answer", true)).toBeNull();
});
