import { expect, it, vi } from "vitest";

import {
  sessionRunOptionError,
  unsupportedRunOption,
} from "@/backend/agents/cli/CliSessionPlans";
import { acpRunOptions } from "@/definition/AgentConfiguration";

import { sessionInput } from "./cli-session-input";

import type { AcpChatOptions } from "@/backend/agents/acp/AcpChat";
import type { AgentRunOptions } from "@/definition/AgentConfiguration";

const WRITE: AgentRunOptions = {
  access: "workspace_write",
  shell: true,
  web: true,
  timeoutMinutes: 0,
};

const CHAT: AcpChatOptions = {
  mcpServers: [],
  resumeSessionId: null,
  listener: { update: vi.fn(), prompted: vi.fn(), closed: vi.fn() },
};

it("accepts the ACP modes and refuses an earlier write mode by runner", () => {
  expect(
    unsupportedRunOption("codex_cli", acpRunOptions("yolo", 0)),
  ).toBeNull();
  expect(unsupportedRunOption("claude_code", WRITE)).toBe(
    "claude_permission_mode_required",
  );
});

it("refuses a session of an API provider", () => {
  expect(
    sessionRunOptionError(
      sessionInput("openai", acpRunOptions("read_only", 0)),
    ),
  ).toBe("provider_invalid");
});

it("allows Pica over OpenCode only read-only", () => {
  expect(
    sessionRunOptionError(
      sessionInput("opencode", acpRunOptions("read_only", 0), { chat: CHAT }),
    ),
  ).toBeNull();
  expect(
    sessionRunOptionError(
      sessionInput("opencode", acpRunOptions("yolo", 0), { chat: CHAT }),
    ),
  ).toBe("opencode_chat_mode_required");
});

it("checks the plan mode of a runner session", () => {
  expect(sessionRunOptionError(sessionInput("opencode", WRITE))).toBe(
    "opencode_permission_mode_required",
  );
  expect(
    sessionRunOptionError(
      sessionInput("codex_cli", acpRunOptions("read_only", 0), { chat: CHAT }),
    ),
  ).toBeNull();
});
