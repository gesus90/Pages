import { strict as assert } from "node:assert";

import { ManagementAuditRepository } from "@/backend/database/repositories/ManagementAuditRepository";
import { ManagementRepository } from "@/backend/database/repositories/ManagementRepository";

import { call } from "./world";

import type { RepositoryFlow } from "./world";

/** Checks management metadata, membership reads and audit persistence. */
export const MANAGEMENT_FLOW: RepositoryFlow = {
  title: "management",
  steps: [
    call("ManagementRepository.projects", async ({ database }) => {
      assert.deepEqual(
        await new ManagementRepository(database).projects("missing"),
        [],
      );
    }),
    call("ManagementRepository.description", async ({ database }) => {
      assert.equal(
        await new ManagementRepository(database).description("check-group"),
        "",
      );
    }),
    call("ManagementRepository.setDescription", async ({ database }) => {
      const repository = new ManagementRepository(database);
      await repository.setDescription("check-group", "first");
      await repository.setDescription("check-group", "updated");
      assert.equal(await repository.description("check-group"), "updated");
    }),
    call("ManagementAuditRepository.record", ({ database }) =>
      new ManagementAuditRepository(database).record(
        "user-admin",
        "check",
        "target",
      ),
    ),
    call("ManagementAuditRepository.list", async ({ database }) => {
      const entries = await new ManagementAuditRepository(database).list();
      assert.equal(entries[0]?.action, "check");
      assert.equal(entries[0]?.target, "target");
    }),
  ],
};
