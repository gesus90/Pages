import { describe, expect, it } from "vitest";

import { parseCatalogPage } from "@/backend/agents/catalog/CatalogParsing";
import {
  isCatalogModel,
  isDecisionOutputModel,
  isTextModel,
} from "@/backend/agents/catalog/CatalogTextModels";
import { catalogModelChoice } from "@/definition/AgentModelChoice";
import {
  consumerModels,
  modelConsumerRefusal,
} from "@/definition/AgentModelConsumers";
import { isDecisionModel } from "@/definition/ConversationDecision";

const DECIDER = {
  id: "perplexity/pplx-decider-v1.3",
  name: "Perplexity: Decider V1.3",
  context_length: 262_144,
  architecture: {
    input_modalities: ["text", "image"],
    output_modalities: ["decisions"],
  },
  pricing: { prompt: "0.00000002", completion: "0" },
};
const CHAT = {
  id: "vendor/chat",
  name: "Chat",
  architecture: { input_modalities: ["text"], output_modalities: ["text"] },
};

describe("decision models in the catalog", () => {
  it("recognizes a model that states `decisions` among its outputs, and only on OpenRouter", () => {
    expect(isDecisionOutputModel(DECIDER, "openrouter")).toBe(true);
    expect(isDecisionOutputModel(CHAT, "openrouter")).toBe(false);
    expect(isDecisionOutputModel(DECIDER, "openai")).toBe(false);
    expect(isTextModel(DECIDER, "openrouter")).toBe(false);
    expect(isCatalogModel(DECIDER, "openrouter")).toBe(true);
  });

  it("keeps a decision model of a listing page with its modalities", () => {
    const page = parseCatalogPage({ data: [DECIDER, CHAT] }, "openrouter");
    const decider = page.models.find((model) => model.id === DECIDER.id);
    expect(decider?.outputModalities).toEqual(["decisions"]);
    expect(decider?.contextWindow).toBe(262_144);
    expect(page.models).toHaveLength(2);
    expect(isDecisionModel(decider ?? {})).toBe(true);
  });

  it("marks the decision model in the shared choice, so only decisions of group chats take it", () => {
    const connection = {
      id: "openrouter",
      name: "OpenRouter",
      provider: "openrouter",
    } as const;
    const [decider, chat] = parseCatalogPage(
      { data: [DECIDER, CHAT] },
      "openrouter",
    ).models.map((model) => catalogModelChoice(connection, model));
    if (decider === undefined || chat === undefined)
      throw new Error("both models expected");
    expect(decider.isDecisionCapable).toBe(true);
    expect(chat.isDecisionCapable).toBeUndefined();
    expect(consumerModels("decision", [decider, chat])).toEqual([decider]);
    expect(modelConsumerRefusal("decision", chat)).toBe("noDecision");
    // Chat and agents refuse it: OpenRouter has no chat adapter, and plans name the reason.
    expect(modelConsumerRefusal("plan", decider)).toBe("decisionOnly");
    expect(modelConsumerRefusal("pica", decider)).not.toBeNull();
    expect(modelConsumerRefusal("employee", decider)).not.toBeNull();
    expect(
      modelConsumerRefusal("pica", { ...decider, provider: "opencode" }),
    ).toBe("decisionOnly");
    expect(modelConsumerRefusal("stt", decider)).toBe("noSpeech");
    expect(modelConsumerRefusal("tts", decider)).toBe("noSpeechOutput");
  });
});
