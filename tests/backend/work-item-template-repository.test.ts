import { describe, expect, it } from "vitest";

import { WorkItemTemplateRepository } from "@/backend/database/repositories/task/WorkItemTemplateRepository";
import { TEMPLATE_SCOPE } from "@/definition/WorkItemTemplate";
import { useMigratedDatabase } from "../helpers/test-database";

import type { NewWorkItemTemplate } from "@/backend/database/repositories/task/WorkItemTemplateRepository";

const TEMPLATE: NewWorkItemTemplate = {
  checklist: ["Write tests", "Update docs"],
  departmentIds: ["backend", "frontend"],
  description: "Steps to reproduce",
  id: "t1",
  labelIds: ["bug", "ci"],
  name: "Bug report",
  ownerId: "alice",
  priority: "high",
  projectIds: ["p1"],
  scope: TEMPLATE_SCOPE.DEPARTMENTS,
  title: "Bug: ",
  type: "task",
};

describe("work item template repository", () => {
  const getDatabase = useMigratedDatabase();

  async function setup(): Promise<WorkItemTemplateRepository> {
    await getDatabase().execute(`
      INSERT INTO labels (id, name)
      VALUES ('bug', 'Bug'), ('ci', 'CI');
    `);

    return new WorkItemTemplateRepository(getDatabase());
  }

  it("round-trips a template with everything shared with it", async () => {
    const repository = await setup();

    await repository.save(TEMPLATE);

    const stored = await repository.findById("t1");

    expect(stored).toMatchObject(TEMPLATE);
    expect(stored?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} /);
    expect(stored?.updatedAt).toBe(stored?.createdAt);
    expect(await repository.findById("missing")).toBeNull();
  });

  it("reads a template without any parts", async () => {
    const repository = await setup();

    await repository.save({
      ...TEMPLATE,
      checklist: [],
      departmentIds: [],
      labelIds: [],
      projectIds: [],
      scope: TEMPLATE_SCOPE.PRIVATE,
    });

    expect(await repository.findById("t1")).toMatchObject({
      checklist: [],
      departmentIds: [],
      labelIds: [],
      projectIds: [],
    });
  });

  it("replaces the parts of an existing template and keeps its identity", async () => {
    const repository = await setup();

    await repository.save(TEMPLATE);
    await repository.save({
      ...TEMPLATE,
      checklist: ["Only step"],
      departmentIds: ["frontend", "frontend"],
      labelIds: [],
      name: "Renamed",
      scope: TEMPLATE_SCOPE.ALL,
    });

    const all = await repository.findAll();

    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      checklist: ["Only step"],
      departmentIds: ["frontend"],
      labelIds: [],
      name: "Renamed",
      scope: TEMPLATE_SCOPE.ALL,
    });
  });

  it("orders templates by name ignoring case and omits deleted labels", async () => {
    const repository = await setup();

    await repository.save({ ...TEMPLATE, id: "t2", name: "alpha" });
    await repository.save({ ...TEMPLATE, id: "t3", name: "Beta" });
    await getDatabase().execute("DELETE FROM labels WHERE id = 'bug';");

    const all = await repository.findAll();

    expect(all.map((template) => template.name)).toEqual(["alpha", "Beta"]);
    expect(all[0]?.labelIds).toEqual(["ci"]);
  });

  it("deletes a template with all its parts", async () => {
    const repository = await setup();

    await repository.save(TEMPLATE);
    await repository.delete("t1");

    expect(await repository.findAll()).toEqual([]);

    for (const table of [
      "work_item_template_departments",
      "work_item_template_projects",
      "work_item_template_labels",
      "work_item_template_checklist_items",
    ]) {
      expect(await getDatabase().query(`SELECT 1 FROM ${table};`)).toEqual([]);
    }
  });

  it("rejects stored values it does not know", async () => {
    const repository = await setup();

    await repository.save(TEMPLATE);
    await getDatabase().execute("UPDATE work_item_templates SET type = 'x';");
    await expect(repository.findAll()).rejects.toThrow("template content");
    await getDatabase().execute(
      "UPDATE work_item_templates SET type = 'task', scope = 'x';",
    );
    await expect(repository.findAll()).rejects.toThrow("template scope");
  });
});
