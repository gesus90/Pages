import { describe, expect, it } from "vitest";

import {
  AgentAccessDeniedError,
  AgentError,
  AGENT_ERROR_MESSAGES,
  isAgentErrorCode,
} from "@/backend/error/AgentErrors";
import {
  AGENT_PROVIDERS,
  isAgentProvider,
  isApiProvider,
  isLoginActive,
  MODEL_TEST_PROMPT,
  ZAI_FREE_MODEL,
} from "@/definition/AgentConnection";
import german from "@/language/locales/de/translation.json";
import english from "@/language/locales/en/translation.json";

describe("agent contracts", () => {
  it("defines five fixed API endpoints and two independent CLI accounts", () => {
    expect(Object.keys(AGENT_PROVIDERS)).toHaveLength(7);
    for (const provider of Object.keys(AGENT_PROVIDERS)) {
      expect(isAgentProvider(provider)).toBe(true);
      if (!isAgentProvider(provider)) throw new Error("invalid fixture");
      expect(isApiProvider(provider)).toBe(
        !["codex_cli", "claude_code"].includes(provider),
      );
    }
    for (const invalid of [null, 2, "other", "toString"])
      expect(isAgentProvider(invalid)).toBe(false);
    expect(AGENT_PROVIDERS.zai.endpoint).toBe("https://api.z.ai/api/paas/v4");
    expect(ZAI_FREE_MODEL).toBe("glm-4.7-flash");
    expect(MODEL_TEST_PROMPT).toBe("Reply with exactly: OK");
  });

  it("distinguishes active login states from completed sessions", () => {
    expect(
      (["starting", "awaiting_user", "verifying"] as const).map(isLoginActive),
    ).toEqual([true, true, true]);
    expect(isLoginActive("failed")).toBe(false);
    expect(isLoginActive("succeeded")).toBe(false);
  });

  it("has translated safe messages for every error", () => {
    for (const code of Object.keys(AGENT_ERROR_MESSAGES)) {
      expect(isAgentErrorCode(code)).toBe(true);
      if (!isAgentErrorCode(code)) throw new Error("invalid fixture");
      expect(new AgentError(code)).toMatchObject({
        code,
        message: AGENT_ERROR_MESSAGES[code],
        name: "AgentError",
      });
      expect(german.settings.agents.error[code]).not.toBe("");
      expect(english.settings.agents.error[code]).not.toBe("");
    }
    expect(isAgentErrorCode(undefined)).toBe(false);
    expect(isAgentErrorCode("toString")).toBe(false);
    expect(new AgentAccessDeniedError().name).toBe("AgentAccessDeniedError");
  });
});
