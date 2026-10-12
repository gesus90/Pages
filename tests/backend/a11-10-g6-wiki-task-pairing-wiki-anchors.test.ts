import { describe, expect, it } from "vitest";

import { useA11McpHarness } from "../helpers/a11-mcp";
import { pageInput } from "../helpers/wiki-harness";

const setup = useA11McpHarness();
type Harness = Awaited<ReturnType<typeof setup>>;

let counter = 0;

/** Sends one `wiki.page.setAnchors` call as the administrator, without the MCP transport. */
async function setAnchors(
  harness: Harness,
  parameters: Record<string, unknown>,
): Promise<unknown> {
  counter += 1;
  const token = harness.tokens.get(harness.owner.id) ?? "";
  return harness.services.pagesAgentApiService.handle(token, {
    operation: "wiki.page.setAnchors",
    parameters: { operationId: `anchors-${counter}`, ...parameters },
  });
}

async function createPage(harness: Harness): Promise<string> {
  const page = await harness.service.create(
    harness.owner,
    pageInput({ projectId: "p1", scope: "project", title: "Concept" }),
  );
  return page.id;
}

const beta = { kind: "department", targetId: "beta" };

describe("agent wiki anchors", () => {
  it("refuses malformed anchor lists in both the new and the expected list and writes nothing", async () => {
    const harness = await setup();
    const pageId = await createPage(harness);
    const malformed: readonly unknown[] = [
      "department:beta",
      Array.from({ length: 51 }, (_, index) => ({
        kind: "department",
        targetId: `department-${index}`,
      })),
      [{ ...beta, note: "extra" }],
      [{ kind: "planet", targetId: "beta" }],
      [{ kind: "department", target: "beta" }],
      [beta, beta],
    ];

    for (const value of malformed) {
      await expect(
        setAnchors(harness, { pageId, anchors: value, expectedAnchors: [] }),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      await expect(
        setAnchors(harness, { pageId, anchors: [], expectedAnchors: value }),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    }

    expect(await harness.repository.anchors.findAnchors(pageId)).toEqual([]);
  });

  it("reports an unchanged result for anchors the page already has, however stale the expected list is", async () => {
    const harness = await setup();
    const pageId = await createPage(harness);

    expect(
      await setAnchors(harness, {
        pageId,
        anchors: [],
        expectedAnchors: [],
      }),
    ).toMatchObject({ result: { id: pageId, changed: false } });

    expect(
      await setAnchors(harness, {
        pageId,
        anchors: [beta],
        expectedAnchors: [],
      }),
    ).toMatchObject({ result: { id: pageId, changed: true } });
    expect(await harness.repository.anchors.findAnchors(pageId)).toEqual([
      expect.objectContaining(beta),
    ]);

    // Someone saved the same anchors meanwhile: nothing changes and nothing conflicts.
    expect(
      await setAnchors(harness, {
        pageId,
        anchors: [beta],
        expectedAnchors: [],
      }),
    ).toMatchObject({ result: { id: pageId, changed: false } });

    await expect(
      setAnchors(harness, { pageId, anchors: [], expectedAnchors: [] }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await harness.repository.anchors.findAnchors(pageId)).toHaveLength(
      1,
    );
  });
});
