import { expect, it } from "vitest";

import {
  readChatCompletion,
  readModelList,
} from "@/backend/agents/providers/ProviderResponses";

it("counts listed models and keeps the pagination hint", () => {
  expect(
    readModelList({ data: [{ id: "a" }, { id: "b" }], has_more: true }),
  ).toEqual({ modelCount: 2, hasMoreModels: true });
});

it("refuses model listings without an array or with unnamed entries", () => {
  expect(readModelList({})).toBeNull();
  expect(readModelList({ data: [{ id: "a" }, { name: "b" }] })).toBeNull();
});

it("accepts a completed assistant choice with its token usage", () => {
  expect(
    readChatCompletion(
      {
        choices: [{ message: { role: "assistant", content: "ok" } }],
        usage: { prompt_tokens: 5, completion_tokens: 1 },
      },
      "model-1",
    ),
  ).toEqual({ model: "model-1", inputTokens: 5, outputTokens: 1 });
});

it("accepts a choice truncated at the token cap without content", () => {
  expect(
    readChatCompletion(
      {
        choices: [{ message: { role: "assistant" }, finish_reason: "length" }],
      },
      "model-1",
    ),
  ).toEqual({ model: "model-1" });
});

it("refuses missing choices, foreign roles and unfinished empty content", () => {
  expect(readChatCompletion({}, "m")).toBeNull();
  expect(readChatCompletion({ choices: [] }, "m")).toBeNull();
  expect(
    readChatCompletion(
      { choices: [{ message: { role: "user", content: "x" } }] },
      "m",
    ),
  ).toBeNull();
  expect(
    readChatCompletion(
      { choices: [{ message: { role: "assistant" }, finish_reason: "stop" }] },
      "m",
    ),
  ).toBeNull();
});
