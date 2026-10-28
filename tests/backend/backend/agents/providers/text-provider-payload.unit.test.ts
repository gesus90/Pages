import { expect, it } from "vitest";

import {
  createTextProviderRequest,
  readTextProviderResponse,
} from "@/backend/agents/providers/TextProviderPayload";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";

import { TICKET_ASSETS, textInput } from "../parsers/text-provider-input";

import type { TextExecutionInput } from "@/backend/agents/TextExecution";

function withoutImageSupport(): TextExecutionInput {
  const input = textInput();
  return { ...input, agent: { ...input.agent, supportsImages: false } };
}

it("sends images as a file notice when the model cannot read images", () => {
  const request = createTextProviderRequest(
    "openai",
    withoutImageSupport(),
    TICKET_ASSETS,
  );
  const body = JSON.stringify(request.body);
  expect(body).toContain(
    "Original file only: model-image-capability-unavailable. No model content available.",
  );
  expect(body).toContain("plain notes");
  expect(body).not.toContain("QUJD");
});

it("keeps native images when the model supports them", () => {
  const request = createTextProviderRequest(
    "anthropic",
    textInput(),
    TICKET_ASSETS,
  );
  expect(JSON.stringify(request.body)).toContain("QUJD");
});

it("refuses an Anthropic search answer without a content list", () => {
  expect(() =>
    readTextProviderResponse(
      "anthropic",
      { stop_reason: "end_turn", content: "plain text" },
      { webSearch: true },
    ),
  ).toThrow(new AgentExecutionError("invalidOutput"));
});
