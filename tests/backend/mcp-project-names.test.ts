import { beforeEach, describe, expect, it, vi } from "vitest";

import { readConfiguration } from "../../mcp/src/configuration";
import { listProjectNames } from "../../mcp/src/project-names";

const configuration = readConfiguration({
  PAGES_URL: "https://pages.invalid",
  PAGES_TOKEN: "sentinel-secret",
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("project name request", () => {
  it("sends the named operation without parameters and returns the names", async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ apiVersion: "1", projectNames: ["Alpha", "Beta"] }),
    );
    await expect(listProjectNames(configuration)).resolves.toEqual([
      "Alpha",
      "Beta",
    ]);
    expect(fetch).toHaveBeenCalledWith(
      configuration.agentsUrl,
      expect.objectContaining({
        body: JSON.stringify({
          operation: "projects.names.list",
          parameters: {},
        }),
      }),
    );
  });

  it.each([
    null,
    "names",
    {},
    { apiVersion: "2", projectNames: [] },
    { apiVersion: "1", projectNames: "Alpha" },
    { apiVersion: "1", projectNames: [{ id: "1", name: "Alpha" }] },
  ])("rejects a response of the wrong shape (%j)", async (response) => {
    vi.mocked(fetch).mockResolvedValue(Response.json(response));
    await expect(listProjectNames(configuration)).rejects.toThrow(
      "Pages project listing failed.",
    );
  });

  it("surfaces a rejected request without response details", async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ error: "sentinel-secret" }, { status: 401 }),
    );
    await expect(listProjectNames(configuration)).rejects.toThrow(
      "The Pages agent API rejected the request.",
    );
  });
});
