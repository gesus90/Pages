import { describe, expect, it } from "vitest";

import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { PAGES_AGENT_READ_OPERATIONS } from "@/definition/PagesAgentOperations";
import {
  issueCode,
  testOAuthConfiguration,
  wireFixture,
} from "../helpers/mcp-authorization";
import { createWikiHarness, pageInput } from "../helpers/wiki-harness";
import { useMigratedDatabase } from "../helpers/test-database";

const readInputs = [
  { operation: "projects.resolve", parameters: { name: "Project alpha" } },
  { operation: "projects.read", parameters: { projectId: "alpha" } },
  { operation: "wiki.page.read", parameters: { pageId: "page" } },
  { operation: "wiki.tree.read", parameters: {} },
  { operation: "wiki.search", parameters: { text: "needle" } },
];

describe("next-call authentication on A9.5 reads", () => {
  const getDatabase = useMigratedDatabase();

  async function setup() {
    const database = getDatabase();
    const harness = createWikiHarness(database);
    await harness.addDepartment("alpha");
    await harness.addUser("user-1", {
      departments: ["alpha"],
      capabilities: [],
    });
    const owner = await harness.addUser("owner", {
      isAdmin: true,
      mode: "admin",
    });
    await harness.addProject("alpha", ["alpha"]);
    const page = await harness.service.create(
      owner,
      pageInput({ projectId: "alpha", scope: "project", content: "needle" }),
    );
    const authorization = new AuthorizationRepository(database);
    const users = new UserRepository(database);
    const fixture = wireFixture(database);
    fixture.users.getById.mockImplementation((id: string) =>
      users.findById(id),
    );
    fixture.administration.getContext.mockImplementation(async (id: string) => {
      const account = (await authorization.snapshot()).accounts.find(
        (entry) => entry.userId === id,
      );
      if (!account) throw new Error("Missing account");
      return account;
    });
    return { ...fixture, page, authorization };
  }

  it("offers all scope-limited read tools and rejects every next read after personal-token revocation", async () => {
    const fixture = await setup();
    const created = await fixture.personal.create("user-1", "read-test", null);
    expect(
      await fixture.api.handle(created.token, { operation: "verify" }),
    ).toMatchObject({
      tools: ["projects.names.list", ...PAGES_AGENT_READ_OPERATIONS],
    });
    expect(
      await fixture.api.handle(created.token, {
        operation: "wiki.page.read",
        parameters: { pageId: fixture.page.id },
      }),
    ).toMatchObject({ result: { content: "needle" } });
    await fixture.personal.revoke("user-1", created.summary.id);
    for (const input of readInputs)
      await expect(
        fixture.api.handle(created.token, input),
      ).rejects.toMatchObject({ status: 401 });
  });

  it("rejects an already issued delegation on the next read after OAuth grant revocation", async () => {
    const fixture = await setup();
    const { exchange } = await issueCode(fixture);
    const tokens = await fixture.tokens.exchange(exchange);
    const delegated = await fixture.tokens.delegate(
      tokens.access_token,
      testOAuthConfiguration.resource,
    );
    expect(
      await fixture.api.handle(delegated.delegationToken, {
        operation: "wiki.page.read",
        parameters: { pageId: fixture.page.id },
      }),
    ).toMatchObject({ result: { content: "needle" } });
    const { grants } = await fixture.grants.get("user-1");
    const grant = grants[0];
    if (!grant) throw new Error("Expected issued grant");
    await fixture.grants.revoke("user-1", grant.id);
    for (const input of readInputs)
      await expect(
        fixture.api.handle(delegated.delegationToken, input),
      ).rejects.toMatchObject({ status: 401 });
  });

  it("applies revoked project scope and deactivation on the next authenticated request", async () => {
    const fixture = await setup();
    const created = await fixture.personal.create("user-1", "read-test", null);
    expect(
      await fixture.api.handle(created.token, readInputs[1] ?? {}),
    ).toMatchObject({ result: { id: "alpha" } });
    await fixture.database.execute(
      "DELETE FROM department_members WHERE user_id = 'user-1';",
    );
    await expect(
      fixture.api.handle(created.token, readInputs[1] ?? {}),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      await fixture.api.handle(created.token, readInputs[4] ?? {}),
    ).toMatchObject({ result: { results: [], total: 0 } });
    await fixture.database.execute(
      "UPDATE users SET is_active = 0 WHERE id = 'user-1';",
    );
    for (const input of readInputs)
      await expect(
        fixture.api.handle(created.token, input),
      ).rejects.toMatchObject({ status: 401 });
  });
});
