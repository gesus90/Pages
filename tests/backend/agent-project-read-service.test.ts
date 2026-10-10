import { describe, expect, it, vi } from "vitest";

import { AgentProjectReadService } from "@/backend/service/agents/AgentProjectReadService";
import { createUser } from "../helpers/factories";

const actor = createUser();

describe("bounded project resolution", () => {
  it("caps ambiguity at 100 candidates without choosing, orders by ID and preserves the current exact name", async () => {
    const projects = Array.from({ length: 101 }, (_, index) => ({
      id: `project-${String(index).padStart(3, "0")}`,
      name: "Duplicate",
    }));
    const access = { findAll: vi.fn().mockResolvedValue(projects.reverse()) };
    const service = new AgentProjectReadService(access);
    await expect(service.resolve(actor, " Duplicate ")).rejects.toMatchObject({
      code: "AMBIGUOUS",
      details: {
        candidates: [...projects]
          .reverse()
          .slice(0, 100)
          .map(({ id, name }) => ({ id, name })),
        truncated: true,
      },
    });
    expect(access.findAll).toHaveBeenCalledWith(actor);
  });
});
