import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { cliFailure, cliOutput } from "@/scripts/runner/cli.mjs";

import {
  bindBoundary,
  command,
  restoreEnvironment,
  routeOf,
} from "./runner-cli-harness";

import type { CliCommand } from "@/scripts/runner/cli.d.mts";
import type * as ChildProcessModule from "node:child_process";

const boundary = vi.hoisted(() => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
  openCodeInventory: vi.fn(),
  openCodeResult: vi.fn(),
  openCodeCommand: vi.fn(),
  antigravityInventory: vi.fn(),
  antigravityCommand: vi.fn(),
}));

vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof ChildProcessModule>()),
  execFile: boundary.execFile,
  spawn: boundary.spawn,
}));
vi.mock("@/scripts/runner/opencode.mjs", () => ({
  openCodeInventory: boundary.openCodeInventory,
  openCodeResult: boundary.openCodeResult,
  openCodeCommand: boundary.openCodeCommand,
  remoteBanner: (workspace: string): string => `[banner ${workspace}]`,
}));
vi.mock("@/scripts/runner/antigravity.mjs", () => ({
  antigravityInventory: boundary.antigravityInventory,
  antigravityCommand: boundary.antigravityCommand,
}));

beforeEach(() => {
  bindBoundary(boundary);
});

afterEach(() => {
  restoreEnvironment();
});

const line = (value: unknown): string => JSON.stringify(value);

function forTool(tool: string, extra: Partial<CliCommand> = {}): CliCommand {
  return command({ ...extra, program: { route: routeOf(tool) } });
}

it("returns the final Claude answer behind the remote banner", () => {
  const stdout = [
    line({ type: "result", result: "first" }),
    line({ type: "assistant" }),
    line({ type: "result", result: "final" }),
  ].join("\n");
  expect(cliOutput(forTool("claude"), stdout)).toBe(
    "[banner /synthetic/work]final",
  );
});

it("returns the bare answer for payload version 1", () => {
  const claude = forTool("claude", { resultPayloadVersion: 1 });
  expect(cliOutput(claude, line({ type: "result", result: "bare" }))).toBe(
    "bare",
  );
});

it("returns nothing for a Claude run without result, with an error or with a non-text result", () => {
  const claude = forTool("claude");
  expect(cliOutput(claude, line({ type: "assistant" }))).toBe("");
  expect(
    cliOutput(claude, line({ type: "result", is_error: true, result: "boom" })),
  ).toBe("");
  expect(cliOutput(claude, line({ type: "result", result: 5 }))).toBe("");
  expect(cliOutput(claude, "not json")).toBe("");
});

it("takes the last completed agent message of a Codex run", () => {
  const message = (text: string): unknown => ({
    type: "item.completed",
    item: { type: "agent_message", text },
  });
  const stdout = [
    line(message("one")),
    line({ type: "item.completed", item: { type: "reasoning", text: "no" } }),
    line({
      type: "item.started",
      item: { type: "agent_message", text: "pending" },
    }),
    line({ type: "item.completed" }),
    line(message("two")),
  ].join("\n");
  expect(cliOutput(command(), stdout)).toBe("[banner /synthetic/work]two");
});

it("returns nothing for a Codex run without an answer or with broken output", () => {
  expect(cliOutput(command(), line({ type: "turn.completed" }))).toBe("");
  expect(cliOutput(command(), "{broken")).toBe("");
});

it.each(["opencode", "antigravity"])(
  "projects the %s answer through the ACP result",
  (tool) => {
    boundary.openCodeResult.mockReturnValue({ answer: "acp answer" });
    const acp = forTool(tool);
    expect(cliOutput(acp, "stdout")).toBe("[banner /synthetic/work]acp answer");
    expect(boundary.openCodeResult).toHaveBeenCalledWith("stdout");
    boundary.openCodeResult.mockReturnValue({ answer: "" });
    expect(cliOutput(acp, "stdout")).toBe("");
    boundary.openCodeResult.mockImplementation(() => {
      throw new Error("unreadable");
    });
    expect(cliOutput(acp, "stdout")).toBe("");
  },
);

it.each(["opencode", "antigravity"])(
  "names the %s failure code from the ACP result",
  (tool) => {
    boundary.openCodeResult.mockReturnValue({
      answer: "",
      failureCode: "quota",
    });
    expect(cliFailure(forTool(tool), "out")).toBe("quota");
    expect(boundary.openCodeResult).toHaveBeenCalledWith("out");
  },
);

it.each(["codex", "claude"])("names no failure code for %s", (tool) => {
  boundary.openCodeResult.mockReturnValue({ answer: "", failureCode: "quota" });
  expect(cliFailure(forTool(tool), "out")).toBeUndefined();
  expect(boundary.openCodeResult).not.toHaveBeenCalled();
});
