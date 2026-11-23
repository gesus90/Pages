import { expect, it } from "vitest";

import { acpDriverFor } from "@/backend/agents/acp/AcpDrivers";
import { ANTIGRAVITY_ACP_DRIVER } from "@/backend/agents/acp/AntigravityAcpDriver";
import { CLAUDE_ACP_DRIVER } from "@/backend/agents/acp/ClaudeAcpDriver";
import { CODEX_ACP_DRIVER } from "@/backend/agents/acp/CodexAcpDriver";
import { OPENCODE_ACP_DRIVER } from "@/backend/agents/acp/OpenCodeAcpDriver";

it("maps native runners to their drivers", () => {
  expect(acpDriverFor("codex_cli")).toBe(CODEX_ACP_DRIVER);
  expect(acpDriverFor("claude_code")).toBe(CLAUDE_ACP_DRIVER);
  expect(acpDriverFor("opencode")).toBe(OPENCODE_ACP_DRIVER);
  expect(acpDriverFor("antigravity")).toBe(ANTIGRAVITY_ACP_DRIVER);
});

it("runs openrouter through OpenCode", () => {
  expect(acpDriverFor("openrouter")).toBe(OPENCODE_ACP_DRIVER);
});
