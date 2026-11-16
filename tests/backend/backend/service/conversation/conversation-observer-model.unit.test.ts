import { expect, it, vi } from "vitest";

import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { ChatError } from "@/backend/error/ChatErrors";
import { ConversationObserverModel } from "@/backend/service/conversation/ConversationObserverModel";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type {
  ConversationObserverModelDependencies,
  ConversationObserverQuestion,
} from "@/backend/service/conversation/ConversationObserverModel";

const QUESTION = partial<ConversationObserverQuestion>({
  conversationId: "conversation",
  personIds: ["one", "two", "two"],
  trigger: "message",
  material: { kind: "routing", routing: {} },
});

it("records disabled Pica as a refusal without retrying other people", async () => {
  const resolve = vi.fn(async () => {
    throw new ChatError("disabled");
  });
  const record = vi.fn(async () => {});
  const model = new ConversationObserverModel(
    partial<ConversationObserverModelDependencies>({
      pica: { resolve },
      runs: { record },
      now: () => new Date("2026-01-01T00:00:00Z"),
    }),
  );
  await expect(model.ask(QUESTION)).rejects.toMatchObject({
    code: "pica_disabled",
  });
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(record).toHaveBeenCalledWith(
    expect.objectContaining({
      personId: "one",
      state: "refused",
      errorCode: "pica_disabled",
      connectionId: null,
    }),
  );
});

it("tries another person after access denial and records a simulated answer", async () => {
  const resolve = vi.fn(async (person: string) => {
    if (person === "one") throw new AgentExecutionError("accessDenied");
    return {
      connection: { id: "connection", provider: "codex_cli" },
      model: "model",
    };
  });
  const route = vi.fn(() => "answer");
  const record = vi.fn(async () => {});
  const model = new ConversationObserverModel(
    partial<ConversationObserverModelDependencies>({
      pica: { resolve },
      runs: { record },
      simulation: { route },
      now: () => new Date("2026-01-01T00:00:00Z"),
    }),
  );
  await expect(model.ask(QUESTION)).resolves.toBe("answer");
  expect(resolve).toHaveBeenCalledTimes(2);
  expect(record).toHaveBeenCalledWith(
    expect.objectContaining({
      personId: "two",
      connectionId: "connection",
      state: "succeeded",
      errorCode: null,
    }),
  );
});

it("records an unavailable observer and never includes provider error text", async () => {
  const record = vi.fn(async () => {});
  const model = new ConversationObserverModel(
    partial<ConversationObserverModelDependencies>({
      pica: {
        resolve: async () => ({
          connection: { id: "connection", provider: "codex_cli" },
          model: "model",
        }),
      },
      runs: { record },
      simulation: null,
      plans: null,
    }),
  );
  await expect(model.ask(QUESTION)).rejects.toMatchObject({
    code: "observer_unavailable",
  });
  expect(record).toHaveBeenCalledWith(
    expect.objectContaining({
      state: "failed",
      errorCode: "observer_unavailable",
    }),
  );
});
