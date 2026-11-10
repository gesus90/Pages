import { describe, expect, it } from "vitest";

import {
  AGENT_TEMPLATE_LIMITS,
  DEFAULT_AGENT_TEMPLATES,
} from "@/definition/AgentInstructionTemplate";

describe("instruction templates", () => {
  it("stores the three defaults once, in the order the list shows them", () => {
    expect(DEFAULT_AGENT_TEMPLATES).toEqual(["coder", "designer", "manager"]);
  });

  it("limits the name and the short description", () => {
    expect(AGENT_TEMPLATE_LIMITS).toEqual({
      nameCharacters: 80,
      descriptionCharacters: 200,
    });
  });
});
