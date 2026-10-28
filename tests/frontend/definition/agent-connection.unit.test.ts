import { expect, it } from "vitest";

import {
  AGENT_PROVIDERS,
  apiProviderEndpoint,
  isApiProvider,
  isLoginActive,
  isOpenCodeKeyProvider,
  isZaiAccountType,
  linkedApiProviderOf,
  openCodeLinkedModelProvider,
  openCodeModelProvider,
} from "@/definition/AgentConnection";

it("accepts only the two z.ai account types", () => {
  expect(isZaiAccountType("api")).toBe(true);
  expect(isZaiAccountType("coding-plan")).toBe(true);
  expect(isZaiAccountType("team")).toBe(false);
});

it("accepts only the native OpenCode key destinations", () => {
  expect(isOpenCodeKeyProvider("opencode")).toBe(true);
  expect(isOpenCodeKeyProvider("openrouter")).toBe(true);
  expect(isOpenCodeKeyProvider("zai")).toBe(false);
});

it("maps native OpenCode providers back to the linked API provider", () => {
  expect(linkedApiProviderOf("zai-coding-plan")).toBe("zai");
  expect(linkedApiProviderOf("google")).toBe("google_ai_studio");
  expect(linkedApiProviderOf("openrouter")).toBe("openrouter");
  expect(linkedApiProviderOf("opencode")).toBeNull();
});

it("sends a z.ai coding-plan key to its own OpenCode provider", () => {
  expect(
    openCodeLinkedModelProvider({
      provider: "zai",
      zaiAccountType: "coding-plan",
    }),
  ).toBe("zai-coding-plan");
  expect(
    openCodeLinkedModelProvider({ provider: "zai", zaiAccountType: "api" }),
  ).toBe("zai");
  expect(openCodeLinkedModelProvider({ provider: "google_ai_studio" })).toBe(
    "google",
  );
});

it("reads the native provider of a full OpenCode model id", () => {
  expect(openCodeModelProvider("google/gemini-3.8-flash")).toBe("google");
  expect(openCodeModelProvider("plain")).toBe("plain");
});

it("uses the fixed endpoint of the saved account type", () => {
  expect(apiProviderEndpoint("zai", "coding-plan")).toBe(
    "https://api.z.ai/api/coding/paas/v4",
  );
  expect(apiProviderEndpoint("zai", "api")).toBe(AGENT_PROVIDERS.zai.endpoint);
  expect(apiProviderEndpoint("openai")).toBe(AGENT_PROVIDERS.openai.endpoint);
});

it("keeps polling only while a CLI login is in progress", () => {
  expect(isLoginActive("starting")).toBe(true);
  expect(isLoginActive("awaiting_user")).toBe(true);
  expect(isLoginActive("verifying")).toBe(true);
  expect(isLoginActive("succeeded")).toBe(false);
  expect(isLoginActive("cancelled")).toBe(false);
});

it("tells API keys apart from CLI accounts", () => {
  expect(isApiProvider("anthropic")).toBe(true);
  expect(isApiProvider("claude_code")).toBe(false);
});
