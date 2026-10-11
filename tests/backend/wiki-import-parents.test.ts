import { describe, expect, it } from "vitest";

import { WikiImportSourceService } from "@/backend/service/agents/WikiImportSourceService";
import { wikiImportPackage } from "@/backend/service/agents/WikiImportPackage";

import { pageInput } from "../helpers/wiki-harness";
import { importPlan, importRequest } from "../helpers/wiki-import";
import {
  appliedImport,
  confirmedImport,
  IMPORT_IDENTITY,
  useWikiImportApplyHarness,
} from "../helpers/wiki-import-apply";

const group = {
  sourceKey: "group/README.md",
  content: "# Group\nGroup content",
};
const child = {
  sourceKey: "group/child.md",
  content: "# Child\nChild content",
};
const complete = importRequest([group, child]);

describe("planned and previously imported parents", () => {
  const setup = useWikiImportApplyHarness();

  it("imports group content before its child package using the parent's durable mapping", async () => {
    const harness = await setup();
    const parentPackage = {
      ...complete,
      manifest: { ...complete.manifest, files: [group] },
    };
    const first = appliedImport(
      await harness.imports.apply(
        IMPORT_IDENTITY,
        await confirmedImport(harness, parentPackage),
        async () => IMPORT_IDENTITY,
      ),
    );
    const childPackage = {
      ...complete,
      manifest: { ...complete.manifest, files: [child] },
    };
    const second = appliedImport(
      await harness.imports.apply(
        IMPORT_IDENTITY,
        await confirmedImport(harness, childPackage, "child"),
        async () => IMPORT_IDENTITY,
      ),
    );
    expect(first.items).toHaveLength(1);
    expect(second).toMatchObject({
      status: "complete",
      counts: { created: 1 },
      items: [{ sourceKey: child.sourceKey, action: "created" }],
    });
    expect(
      await harness.database.query(
        "SELECT parent_id, content FROM wiki_pages WHERE title = 'Child';",
      ),
    ).toEqual([[first.items[0]?.pageId, child.content]]);
  });

  it("rejects a child package whose unloaded group content has no prior mapping", async () => {
    const harness = await setup();
    const input = await confirmedImport(harness, {
      ...complete,
      manifest: { ...complete.manifest, files: [child] },
    });
    expect(
      appliedImport(
        await harness.imports.apply(
          IMPORT_IDENTITY,
          input,
          async () => IMPORT_IDENTITY,
        ),
      ),
    ).toMatchObject({
      status: "partial",
      items: [
        {
          sourceKey: child.sourceKey,
          action: "conflict",
          errorCode: "CONFLICT",
        },
      ],
    });
    expect(await harness.database.query("SELECT id FROM wiki_pages;")).toEqual(
      [],
    );
  });

  it.each(["failed", "conflict"])(
    "blocks descendants when their parent has a %s outcome",
    async (action) => {
      const harness = await setup();
      if (action === "conflict")
        await harness.service.create(
          harness.owner,
          pageInput({ scope: "project", projectId: "alpha", title: "Group" }),
        );
      const input = await confirmedImport(harness, complete);
      const assets =
        action === "failed"
          ? [{ sourceKey: group.sourceKey, assetIds: ["missing"] }]
          : [];
      expect(
        appliedImport(
          await harness.imports.apply(
            IMPORT_IDENTITY,
            { ...input, assets },
            async () => IMPORT_IDENTITY,
          ),
        ),
      ).toMatchObject({
        status: "partial",
        items: [
          { sourceKey: group.sourceKey, action },
          {
            sourceKey: child.sourceKey,
            action: "conflict",
            errorCode: "CONFLICT",
          },
        ],
      });
    },
  );

  it.each(["kind", "template", "title", "revision", "project", "scope"])(
    "rejects a mapped parent whose %s changed",
    async (condition) => {
      const harness = await setup();
      const parentPackage = {
        ...complete,
        manifest: { ...complete.manifest, files: [group] },
      };
      const first = appliedImport(
        await harness.imports.apply(
          IMPORT_IDENTITY,
          await confirmedImport(harness, parentPackage),
          async () => IMPORT_IDENTITY,
        ),
      );
      const pageId = first.items[0]?.pageId;
      if (!pageId) throw new Error("Expected group page.");
      await harness.database.execute(
        "INSERT INTO department_members (user_id, department_id) VALUES ('writer', 'beta');",
      );
      const mutations: Record<string, string> = {
        kind: "UPDATE agent_import_sources SET target_kind = 'ticket' WHERE target_id = $id;",
        template: "UPDATE wiki_pages SET is_template = TRUE WHERE id = $id;",
        title: "UPDATE wiki_pages SET title = 'Manual title' WHERE id = $id;",
        revision: "UPDATE wiki_pages SET revision = 2 WHERE id = $id;",
        project: "UPDATE wiki_pages SET project_id = 'beta' WHERE id = $id;",
        scope: "UPDATE wiki_pages SET scope = 'instance' WHERE id = $id;",
      };
      await harness.database.execute(mutations[condition], { id: pageId });
      const input = await confirmedImport(
        harness,
        { ...complete, manifest: { ...complete.manifest, files: [child] } },
        "child",
      );
      expect(
        appliedImport(
          await harness.imports.apply(
            IMPORT_IDENTITY,
            input,
            async () => IMPORT_IDENTITY,
          ),
        ),
      ).toMatchObject({
        status: "partial",
        items: [
          {
            action:
              condition === "project" || condition === "scope"
                ? "failed"
                : "conflict",
            errorCode:
              condition === "project" || condition === "scope"
                ? "NOT_FOUND"
                : "CONFLICT",
          },
        ],
      });
      expect(
        await harness.database.query("SELECT COUNT(*) FROM wiki_pages;"),
      ).toEqual([[1]]);
    },
  );

  it("rejects an inconsistent snapshot whose planned parent is missing", async () => {
    const harness = await setup();
    const input = await confirmedImport(harness);
    const plan = importPlan(
      await harness.planner.plan(harness.actor, importRequest()),
    );
    const source = wikiImportPackage(input, plan)[0];
    if (!source) throw new Error("Expected source.");
    const snapshot = {
      plan: {
        ...plan,
        edges: [
          {
            childKey: source.targetKey,
            parent: { kind: "planned", key: "missing" } as const,
          },
        ],
      },
      parents: [],
    };
    const run = { id: "run", userId: "writer", projectId: "alpha", snapshot };
    await harness.mappings.insertRun({
      ...run,
      status: "running",
      snapshotJson: JSON.stringify(snapshot),
    });
    await new WikiImportSourceService(harness.dependencies).apply(
      run,
      source,
      input,
      async () => IMPORT_IDENTITY,
    );
    expect(
      await harness.mappings.findItem(run.id, source.sourceKey),
    ).toMatchObject({ action: "failed", errorCode: "INVALID_REQUEST" });
  });
});
