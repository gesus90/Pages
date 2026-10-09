import { describe, expect, it } from "vitest";

import {
  readAssistantContext,
  readAssistantIdentifier,
  readAssistantPreferences,
  readAssistantRequest,
  redactAssistantCredentials,
  requireCredentialFreeText,
} from "@/backend/service/assistant/TextAssistantValidation";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import { createTextAssistantPrompt } from "@/backend/service/assistant/TextAssistantPrompt";

import { assistantRequest } from "../helpers/text-assistant";

import type { TextAssistantAction } from "@/definition/TextAssistant";

const ACTIONS: readonly TextAssistantAction[] = [
  "translate",
  "proofread",
  "generate",
  "summarize",
  "explain",
  "instruct",
  "chat",
];

describe("text assistant input and prompt boundaries", () => {
  it.each(ACTIONS)(
    "accepts the explicit %s action without adding other context",
    (action) => {
      const request = assistantRequest({
        action,
        instruction: "Do the requested action",
        change: "answer",
      });
      expect(readAssistantRequest(request)).toEqual(request);
      const prompt = createTextAssistantPrompt(request);
      expect(prompt).toContain(request.source);
      expect(prompt).not.toContain(request.context.id);
      expect(prompt).not.toContain(request.requestId);
      expect(prompt).toContain('"targetLanguage":"en"');
    },
  );

  it("accepts document and no-context envelopes and pins the exact ticket baseline", () => {
    const ticket = { kind: "ticket", id: "ticket-1", version: "Saved text\n" };
    expect(readAssistantContext(ticket)).toEqual(ticket);
    expect(
      readAssistantRequest(assistantRequest({ scope: "document", source: "" }))
        .source,
    ).toBe("");
    expect(
      readAssistantRequest(
        assistantRequest({
          action: "chat",
          scope: "none",
          source: "",
          change: "answer",
          instruction: "A question",
        }),
      ).scope,
    ).toBe("none");
    expect(
      readAssistantRequest(assistantRequest({ conversationId: "history-1" }))
        .conversationId,
    ).toBe("history-1");
  });

  it.each([
    { action: "metadata" },
    { scope: "project" },
    { change: "status" },
    { source: 1 },
    { source: "x".repeat(200_001) },
    { instruction: 1 },
    { instruction: "x".repeat(5001) },
    { targetLanguage: 1 },
    { targetLanguage: "" },
    { targetLanguage: "en;exec" },
    { requestId: null },
    { requestId: "../path" },
    { conversationId: undefined },
    { context: null },
    { context: { kind: "project", id: "page", version: "1" } },
    { context: { kind: "wiki", id: "page", version: 1 } },
    { context: { kind: "wiki", id: "page", version: "old" } },
    { context: { kind: "ticket", id: "page", version: "x".repeat(65_537) } },
    { context: { kind: "wiki", id: "", version: "1" } },
    { scope: "none" },
    { scope: "none", source: "" },
    { action: "summarize" },
    { action: "explain" },
    { action: "generate" },
    { action: "instruct" },
    { action: "chat" },
    { source: "   " },
  ])(
    "rejects malformed or contradictory envelopes without a provider call: %j",
    (override) => {
      expect(() =>
        readAssistantRequest({ ...assistantRequest(), ...override }),
      ).toThrow(TextAssistantError);
    },
  );

  it("checks preference ownership contracts and recognizes credential patterns", () => {
    expect(
      readAssistantPreferences({ autoApply: true, targetLanguage: "pt-BR" }),
    ).toEqual({ autoApply: true, targetLanguage: "pt-BR" });
    expect(() =>
      readAssistantPreferences({ autoApply: "true", targetLanguage: "en" }),
    ).toThrow(TextAssistantError);
    expect(readAssistantIdentifier("id-1")).toBe("id-1");
    for (const credential of [
      "sk-syntheticcredential",
      "AIza012345678901234567890123",
      "Bearer synthetic-secret",
      "api_key=synthetic-secret",
      "password=synthetic-password",
      "v1.nonce.ciphertext.tag",
    ]) {
      expect(redactAssistantCredentials(credential)).toBe("[redacted]");
      expect(() => requireCredentialFreeText(credential)).toThrow(
        "credentialsInText",
      );
      expect(() =>
        readAssistantRequest(assistantRequest({ source: credential })),
      ).toThrow("credentialsInText");
    }
    expect(redactAssistantCredentials("Plain text")).toBe("Plain text");
    expect(() =>
      requireCredentialFreeText("Do not change meaning"),
    ).not.toThrow();
  });
});
