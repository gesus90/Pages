import { beforeEach, describe, expect, it, vi } from "vitest";

import { postAgentRequest } from "../../src/pages-client.ts";
import { listProjectNames } from "../../src/project-names.ts";

vi.mock("../../src/pages-client.ts", () => ({ postAgentRequest: vi.fn() }));

const CONFIGURATION = {
  agentsUrl: new URL("https://pages.example/api/v1/agents"),
  token: "token",
};

describe("listProjectNames", () => {
  beforeEach(() => {
    vi.mocked(postAgentRequest).mockReset();
  });

  it("returns the visible project names", async () => {
    vi.mocked(postAgentRequest).mockResolvedValue({
      apiVersion: "1",
      projectNames: ["Plan", "Shared"],
    });
    await expect(listProjectNames(CONFIGURATION)).resolves.toEqual([
      "Plan",
      "Shared",
    ]);
    expect(postAgentRequest).toHaveBeenCalledWith(CONFIGURATION, {
      operation: "projects.names.list",
      parameters: {},
    });
  });

  it("accepts an empty list", async () => {
    vi.mocked(postAgentRequest).mockResolvedValue({
      apiVersion: "1",
      projectNames: [],
    });
    await expect(listProjectNames(CONFIGURATION)).resolves.toEqual([]);
  });

  it.each([
    null,
    "Plan",
    { apiVersion: "2", projectNames: [] },
    { apiVersion: "1", projectNames: "Plan" },
    { apiVersion: "1", projectNames: ["Plan", 3] },
  ])("rejects the unexpected response %j", async (response) => {
    vi.mocked(postAgentRequest).mockResolvedValue(response);
    await expect(listProjectNames(CONFIGURATION)).rejects.toThrow(
      "Pages project listing failed.",
    );
  });
});
