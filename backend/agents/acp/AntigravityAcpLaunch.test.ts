import { expect, it } from "vitest";

import {
  ANTIGRAVITY_AGENT_NAME,
  antigravityAcpArguments,
  isSupportedAntigravityAcp,
} from "@/backend/agents/acp/AntigravityAcpLaunch";

import type { CliHome } from "@/backend/agents/cli/CliContracts";

it("points the entry point at the folders of the connection", () => {
  const home: CliHome = {
    root: "/connection",
    home: "/connection/home",
    config: "/connection/config",
    work: "/connection/work",
  };
  expect(antigravityAcpArguments(home)).toEqual([
    "acp",
    "--gemini-dir=/connection/config",
    "--app-data-dir=antigravity-acp",
    "--disable-telemetry",
  ]);
});

it("accepts a stable release at or above the minimum", () => {
  expect(
    isSupportedAntigravityAcp({
      name: ANTIGRAVITY_AGENT_NAME,
      version: "1.5.9",
    }),
  ).toBe(true);
});

it("refuses an older release, a preview and another agent", () => {
  expect(
    isSupportedAntigravityAcp({
      name: ANTIGRAVITY_AGENT_NAME,
      version: "1.5.8",
    }),
  ).toBe(false);
  expect(
    isSupportedAntigravityAcp({
      name: ANTIGRAVITY_AGENT_NAME,
      version: "1.6.0-beta",
    }),
  ).toBe(false);
  expect(isSupportedAntigravityAcp({ name: "other", version: "2.0.0" })).toBe(
    false,
  );
});

it("refuses a missing agent", () => {
  expect(isSupportedAntigravityAcp(null)).toBe(false);
  expect(isSupportedAntigravityAcp(undefined)).toBe(false);
});
