import { rmSync } from "node:fs";

import { afterEach } from "vitest";

import { createMcpServices } from "@/app/lib/mcp-services.server";
import { ServerCache } from "@/backend/cache/ServerCache";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { CAPABILITY } from "@/definition/Authorization";

import { useMigratedDatabase } from "./test-database";
import { createWikiHarness } from "./wiki-harness";

/** Pages Agent API fixture with real authorization and an isolated DuckDB. */
export function useA11McpHarness(): () => Promise<
  Awaited<ReturnType<typeof createHarness>>
> {
  const getDatabase = useMigratedDatabase();
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories)
      rmSync(directory, { recursive: true, force: true });
    directories.length = 0;
  });
  return async () => {
    const harness = await createHarness(getDatabase());
    directories.push(harness.filesDirectory);
    return harness;
  };
}

async function createHarness(
  database: ReturnType<ReturnType<typeof useMigratedDatabase>>,
) {
  const wiki = createWikiHarness(database);
  const owner = await wiki.addUser("owner", { isAdmin: true, mode: "admin" });
  await wiki.addDepartment("alpha");
  await wiki.addDepartment("beta");
  const writer = await wiki.addUser("writer", {
    departments: ["alpha"],
    capabilities: [CAPABILITY.WRITE],
    displayName: "Visible writer",
  });
  const manager = await wiki.addUser("manager", {
    departments: ["alpha"],
    capabilities: [CAPABILITY.WRITE, CAPABILITY.MANAGE_PROJECTS],
  });
  const reader = await wiki.addUser("reader", {
    departments: ["alpha"],
    capabilities: [],
  });
  const hidden = await wiki.addUser("hidden", {
    departments: ["beta"],
    displayName: "Hidden name",
  });
  await wiki.addProject("p1", ["alpha"]);
  await wiki.addProject("p2", ["beta"]);
  const authorization = new AuthorizationRepository(database);
  const managerAccess = (await authorization.snapshot()).accounts.find(
    ({ userId }) => userId === manager.id,
  );
  if (!managerAccess) throw new Error("Missing manager access.");
  await authorization.saveAccount({
    ...managerAccess,
    managedDepartments: ["alpha"],
  });
  await authorization.groups().save({
    id: "visible-group",
    name: "Visible group",
    memberIds: [writer.id],
  });
  await authorization
    .groups()
    .save({ id: "hidden-group", name: "Hidden group", memberIds: [hidden.id] });
  const users = {
    getById: (id: string) => new UserRepository(database).findById(id),
  };
  const administration = {
    getContext: async (id: string) => {
      const account = (await authorization.snapshot()).accounts.find(
        ({ userId }) => userId === id,
      );
      if (!account) throw new Error("Missing fixture account.");
      return account;
    },
  };
  const services = createMcpServices(database, users, administration, {
    directory: wiki.filesDirectory,
    wikiService: wiki.service,
    tickets: { cache: new ServerCache(), publisher: null },
  });
  const tokens = new Map<string, string>();
  for (const user of [owner, writer, reader, manager, hidden])
    tokens.set(
      user.id,
      (
        await services.personalAgentTokenService.create(
          user.id,
          "A11 fixture",
          null,
        )
      ).token,
    );
  return {
    ...wiki,
    owner,
    writer,
    reader,
    manager,
    hidden,
    services,
    tokens,
  };
}
