import { expect, it, vi } from "vitest";

import { ConversationDecisionModel } from "@/backend/service/conversation/ConversationDecisionModel";

import { textInput } from "../../agents/parsers/text-provider-input";

const question = {
  personId: "person",
  material: {
    groupName: "Pages Team",
    candidates: [{ id: "ed", name: "Ed", username: "ed", role: "Developer" }],
    lines: [],
    maximum: 1,
  },
};

it("runs an API decision as a bounded text request without ACP, tools or a workspace", async () => {
  const run = vi
    .fn()
    .mockResolvedValue(
      '{"responders":["ed"],"needsAnswer":true,"reason":"Entwicklung"}',
    );
  const open = vi.fn();
  const service = new ConversationDecisionModel({
    settings: { resolve: async () => textInput().agent },
    plans: { run, open },
    simulation: null,
    directoryRoot: "unused",
  });
  expect(await service.ask(question)).toContain('"ed"');
  expect(open).not.toHaveBeenCalled();
  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: "person",
      directory: null,
      webSearch: false,
      instructions: expect.stringContaining("höchstens einer") as unknown,
      prompt: expect.stringContaining("Developer") as unknown,
    }),
    expect.any(AbortSignal),
  );
});

it("fails as no model before calling any execution path", async () => {
  const run = vi.fn();
  const service = new ConversationDecisionModel({
    settings: { resolve: async () => null },
    plans: { run, open: vi.fn() },
    simulation: null,
    directoryRoot: "unused",
  });
  await expect(service.ask(question)).rejects.toMatchObject({
    code: "decision_no_model",
  });
  expect(run).not.toHaveBeenCalled();
});
