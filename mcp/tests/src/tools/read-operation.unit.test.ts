import { beforeEach, describe, expect, it, vi } from "vitest";

import { postAgentRequest } from "../../../src/pages-client.ts";
import { readOperation } from "../../../src/tools/read-operation.ts";

vi.mock("../../../src/pages-client.ts", () => ({ postAgentRequest: vi.fn() }));

const CONFIGURATION = {
  agentsUrl: new URL("https://pages.example/api/v1/agents"),
  token: "token",
};

describe("readOperation", () => {
  beforeEach(() => {
    vi.mocked(postAgentRequest).mockReset();
  });

  it("returns the result object and asks for business errors", async () => {
    vi.mocked(postAgentRequest).mockResolvedValue({
      apiVersion: "1",
      result: { pageId: "w1" },
    });
    await expect(
      readOperation(CONFIGURATION, "wiki.page.read", { pageId: "w1" }),
    ).resolves.toEqual({ pageId: "w1" });
    expect(postAgentRequest).toHaveBeenCalledWith(
      CONFIGURATION,
      { operation: "wiki.page.read", parameters: { pageId: "w1" } },
      { businessErrors: true },
    );
  });

  it.each([
    null,
    "result",
    { apiVersion: "2", result: {} },
    { apiVersion: "1", result: null },
    { apiVersion: "1", result: [] },
    { apiVersion: "1", result: "text" },
  ])("rejects the unexpected response %j", async (response) => {
    vi.mocked(postAgentRequest).mockResolvedValue(response);
    await expect(
      readOperation(CONFIGURATION, "projects.read", { projectId: "p1" }),
    ).rejects.toThrow("Pages read failed.");
  });

  it("passes failures of the request through", async () => {
    vi.mocked(postAgentRequest).mockRejectedValue(new Error("offline"));
    await expect(
      readOperation(CONFIGURATION, "projects.read", { projectId: "p1" }),
    ).rejects.toThrow("offline");
  });
});
