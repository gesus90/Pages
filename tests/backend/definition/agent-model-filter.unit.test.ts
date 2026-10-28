import { expect, it } from "vitest";

import { isAgentModel, isChatModel } from "@/definition/AgentModelFilter";

const TEXT_MODEL = {
  status: "active",
  output: { text: true, image: false },
  toolCall: true,
};

it("lists an active text model and a model with unstated traits", () => {
  expect(isChatModel(TEXT_MODEL)).toBe(true);
  expect(
    isChatModel({ status: undefined, output: undefined, toolCall: undefined }),
  ).toBe(true);
  expect(isChatModel({ ...TEXT_MODEL, output: null })).toBe(true);
});

it("removes inactive models and models without text output", () => {
  expect(isChatModel({ ...TEXT_MODEL, status: "deprecated" })).toBe(false);
  expect(isChatModel({ ...TEXT_MODEL, output: { text: false } })).toBe(false);
});

it("removes models that generate images, video or audio", () => {
  expect(isChatModel({ ...TEXT_MODEL, output: { audio: true } })).toBe(false);
  expect(isChatModel({ ...TEXT_MODEL, output: { video: true } })).toBe(false);
});

it("requires agents to call tools unless OpenCode does not say", () => {
  expect(isAgentModel(TEXT_MODEL)).toBe(true);
  expect(isAgentModel({ ...TEXT_MODEL, toolCall: undefined })).toBe(true);
  expect(isAgentModel({ ...TEXT_MODEL, toolCall: false })).toBe(false);
  expect(isAgentModel({ ...TEXT_MODEL, status: "beta" })).toBe(false);
});
