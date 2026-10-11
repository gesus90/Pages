import { describe, expect, it } from "vitest";

import {
  readWikiImportParents,
  requireWikiImportPage,
  resolveWikiImportContext,
} from "@/backend/service/agents/WikiImportContext";

import { pageInput } from "../helpers/wiki-harness";
import { useWikiImportApplyHarness } from "../helpers/wiki-import-apply";

describe("transaction-local wiki import policy", () => {
  const setup = useWikiImportApplyHarness();

  it.each(["missing", "inactive", "password"])(
    "rejects a %s account before any target is exposed",
    async (condition) => {
      const harness = await setup();
      if (condition === "inactive")
        await harness.database.execute(
          "UPDATE users SET is_active = FALSE WHERE id = 'writer';",
        );
      if (condition === "password")
        await harness.database.execute(
          "UPDATE users SET must_change_password = TRUE WHERE id = 'writer';",
        );
      await expect(
        harness.database.transaction((transaction) =>
          resolveWikiImportContext(
            transaction,
            condition === "missing" ? "missing" : "writer",
            "alpha",
          ),
        ),
      ).rejects.toMatchObject({ code: "invalid_token", status: 401 });
    },
  );

  it("resolves a visible project with current write rights and masks foreign projects", async () => {
    const harness = await setup();
    await harness.database.transaction(async (transaction) => {
      const context = await resolveWikiImportContext(
        transaction,
        "writer",
        "alpha",
      );
      expect(context.actor).toMatchObject(harness.actor);
      expect(context.viewer.canWrite).toBe(true);
      expect(await readWikiImportParents(context, null)).toEqual([]);
      await expect(
        resolveWikiImportContext(transaction, "writer", "beta"),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  it("retains the full selected parent chain in order without adding visits", async () => {
    const harness = await setup();
    const ancestor = await harness.service.create(
      harness.owner,
      pageInput({ scope: "project", projectId: "alpha", title: "Ancestor" }),
    );
    const parent = await harness.service.create(
      harness.owner,
      pageInput({ parentId: ancestor.id, title: "Parent" }),
    );
    await harness.database.transaction(async (transaction) => {
      const context = await resolveWikiImportContext(
        transaction,
        "writer",
        "alpha",
      );
      expect(await readWikiImportParents(context, parent.id)).toEqual([
        { id: parent.id, parentId: ancestor.id, revision: 1 },
        { id: ancestor.id, parentId: null, revision: 1 },
      ]);
      await requireWikiImportPage(context, parent.id);
      await expect(requireWikiImportPage(context, "missing")).rejects.toThrow();
    });
    expect(
      await harness.database.query("SELECT page_id FROM wiki_recent_pages;"),
    ).toEqual([]);
  });

  it.each(["project", "scope", "template"])(
    "rejects a selected parent with an invalid %s",
    async (condition) => {
      const harness = await setup();
      await harness.database.execute(
        "INSERT INTO department_members (user_id, department_id) VALUES ('writer', 'beta');",
      );
      const page = await harness.service.create(
        harness.owner,
        pageInput({
          scope: "project",
          projectId: "alpha",
          title: "Parent",
          isTemplate: condition === "template",
        }),
      );
      if (condition === "project")
        await harness.database.execute(
          "UPDATE wiki_pages SET project_id = 'beta' WHERE id = $id;",
          { id: page.id },
        );
      if (condition === "scope")
        await harness.database.execute(
          "UPDATE wiki_pages SET scope = 'instance' WHERE id = $id;",
          { id: page.id },
        );
      await harness.database.transaction(async (transaction) => {
        const context = await resolveWikiImportContext(
          transaction,
          "writer",
          "alpha",
        );
        await expect(
          readWikiImportParents(context, page.id),
        ).rejects.toMatchObject({
          code: condition === "template" ? "INVALID_REQUEST" : "NOT_FOUND",
        });
        if (condition !== "template")
          await expect(
            requireWikiImportPage(context, page.id),
          ).rejects.toMatchObject({ code: "NOT_FOUND" });
      });
    },
  );
});
