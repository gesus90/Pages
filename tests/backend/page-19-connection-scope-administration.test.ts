import { describe, expect, it, vi } from "vitest";

import { ServerCache } from "@/backend/cache/ServerCache";
import {
  AgentAccessDeniedError,
  AgentInUseError,
} from "@/backend/error/AgentErrors";
import { AgentScopeInUseError } from "@/backend/error/AdministrationError";
import { DepartmentAdministrationService } from "@/backend/service/DepartmentAdministrationService";
import { GroupAdministrationService } from "@/backend/service/GroupAdministrationService";

import {
  API_CONNECTION_ID,
  CLI_CONNECTION_ID,
  SYNTHETIC_API_CIPHERTEXT,
  createScopeHarness,
} from "../helpers/connection-scope";
import { useMigratedDatabase } from "../helpers/test-database";

import type { ScopeHarness } from "../helpers/connection-scope";
import type { AgentConnectionScope } from "@/definition/AgentConnectionScope";

const API_KEY = "synthetic-key-for-page-19";

/** Stable order: the repository returns targets by kind, then identifier. */
function sorted(scope: AgentConnectionScope): AgentConnectionScope {
  return {
    mode: scope.mode,
    targets: [...scope.targets].sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) ||
        left.targetId.localeCompare(right.targetId),
    ),
  };
}

async function scopeOf(
  h: ScopeHarness,
  connectionId: string,
): Promise<AgentConnectionScope | undefined> {
  return (await h.management.list(h.admin)).find(
    (entry) => entry.id === connectionId,
  )?.scope;
}

describe.each([
  ["api", { provider: "openrouter", apiKey: API_KEY }],
  ["cli", { provider: "codex_cli" }],
] as const)("PAGE-19 scope administration of a %s connection", (_, input) => {
  const getDatabase = useMigratedDatabase();

  it("stores global and mixed restricted scopes and returns exactly the saved selection", async () => {
    const h = await createScopeHarness(getDatabase());
    const mixed: AgentConnectionScope = {
      mode: "restricted",
      targets: [
        { kind: "person", targetId: h.carol.id },
        { kind: "person", targetId: h.bob.id },
        { kind: "group", targetId: "team" },
        { kind: "department", targetId: "engineering" },
        { kind: "department", targetId: "finance" },
      ],
    };
    const id = await h.management.create(h.admin, {
      name: "Scoped connection",
      ...input,
      scope: mixed,
    });
    expect(await scopeOf(h, id)).toEqual(sorted(mixed));
    // A new connection without a scope stays system-wide, as before scopes.
    const plain = await h.management.create(h.admin, {
      name: "Plain connection",
      ...input,
    });
    expect(await scopeOf(h, plain)).toEqual({ mode: "global", targets: [] });
    // Saving without a scope field keeps the stored scope.
    await h.management.update(h.admin, id, {
      name: "Renamed connection",
    });
    expect(await scopeOf(h, id)).toEqual(sorted(mixed));
    // Replacing the selection leaves exactly the new one, no stale target.
    const narrower: AgentConnectionScope = {
      mode: "restricted",
      targets: [{ kind: "group", targetId: "team" }],
    };
    await h.management.update(h.admin, id, {
      name: "Renamed connection",
      scope: narrower,
    });
    expect(await scopeOf(h, id)).toEqual(narrower);
    await h.management.update(h.admin, id, {
      name: "Renamed connection",
      scope: { mode: "global", targets: [] },
    });
    expect(await scopeOf(h, id)).toEqual({ mode: "global", targets: [] });
    expect(
      await getDatabase().query(
        "SELECT target_id FROM agent_connection_scope_targets WHERE connection_id = $id;",
        { id },
      ),
    ).toEqual([]);
  });

  it("rejects incomplete, contradictory and unknown scopes without changing anything", async () => {
    const h = await createScopeHarness(getDatabase());
    const id = await h.management.create(h.admin, {
      name: "Scoped connection",
      ...input,
      scope: {
        mode: "restricted",
        targets: [{ kind: "person", targetId: h.carol.id }],
      },
    });
    const before = await scopeOf(h, id);
    const invalid: readonly [unknown, string][] = [
      [{ mode: "restricted", targets: [] }, "connection_scope_invalid"],
      [{ mode: "restricted" }, "connection_scope_invalid"],
      [
        {
          mode: "global",
          targets: [{ kind: "person", targetId: h.carol.id }],
        },
        "connection_scope_invalid",
      ],
      [{ mode: "everybody", targets: [] }, "connection_scope_invalid"],
      [
        {
          mode: "restricted",
          targets: [{ kind: "system", targetId: "text" }],
        },
        "connection_scope_invalid",
      ],
      [
        { mode: "restricted", targets: [{ kind: "person", targetId: " " }] },
        "connection_scope_invalid",
      ],
      [{ mode: "restricted", targets: "carol" }, "connection_scope_invalid"],
      [null, "connection_scope_invalid"],
      [
        {
          mode: "restricted",
          targets: Array.from({ length: 201 }, (_, index) => ({
            kind: "person",
            targetId: `person-${index}`,
          })),
        },
        "connection_scope_invalid",
      ],
      [
        {
          mode: "restricted",
          targets: [{ kind: "person", targetId: "nobody" }],
        },
        "profile_target_invalid",
      ],
      [
        {
          mode: "restricted",
          targets: [
            { kind: "person", targetId: h.carol.id },
            { kind: "group", targetId: "missing-group" },
          ],
        },
        "profile_target_invalid",
      ],
      [
        {
          mode: "restricted",
          targets: [{ kind: "department", targetId: "missing-department" }],
        },
        "profile_target_invalid",
      ],
    ];
    for (const [scope, code] of invalid) {
      await expect(
        h.management.update(h.admin, id, { name: "Scoped connection", scope }),
      ).rejects.toMatchObject({ code });
      expect(await scopeOf(h, id)).toEqual(before);
    }
    const connectionsBefore = (await h.management.list(h.admin)).length;
    await expect(
      h.management.create(h.admin, {
        name: "Never created",
        ...input,
        scope: { mode: "restricted", targets: [] },
      }),
    ).rejects.toMatchObject({ code: "connection_scope_invalid" });
    await expect(
      h.management.create(h.admin, {
        name: "Never created either",
        ...input,
        scope: {
          mode: "restricted",
          targets: [{ kind: "group", targetId: "missing-group" }],
        },
      }),
    ).rejects.toMatchObject({ code: "profile_target_invalid" });
    expect((await h.management.list(h.admin)).length).toBe(connectionsBefore);
    expect(
      await getDatabase().query(
        "SELECT connection_id FROM agent_connection_scopes WHERE connection_id NOT IN (SELECT id FROM agent_connections);",
      ),
    ).toEqual([]);
  });

  it("lets only an administrator in admin mode create or change a scope", async () => {
    const h = await createScopeHarness(getDatabase());
    const id = await h.management.create(h.admin, {
      name: "Scoped connection",
      ...input,
      scope: {
        mode: "restricted",
        targets: [{ kind: "person", targetId: h.carol.id }],
      },
    });
    const before = await scopeOf(h, id);
    const outsiders = [
      // An ordinary person, an administrator in role mode, an inactive one.
      (await h.authorization.snapshot()).accounts.find(
        (account) => account.userId === h.bob.id,
      ),
      { ...h.admin, mode: "role" as const },
      { ...h.admin, isActive: false },
    ];
    for (const actor of outsiders) {
      if (!actor) throw new Error("Missing fixture account");
      await expect(
        h.management.update(actor, id, {
          name: "Scoped connection",
          scope: { mode: "global", targets: [] },
        }),
      ).rejects.toBeInstanceOf(AgentAccessDeniedError);
      await expect(
        h.management.update(actor, id, {
          name: "Scoped connection",
          scope: {
            mode: "restricted",
            targets: [
              { kind: "person", targetId: h.carol.id },
              { kind: "person", targetId: actor.userId },
            ],
          },
        }),
      ).rejects.toBeInstanceOf(AgentAccessDeniedError);
      await expect(
        h.management.create(actor, {
          name: "Sneaked in",
          ...input,
          scope: { mode: "global", targets: [] },
        }),
      ).rejects.toBeInstanceOf(AgentAccessDeniedError);
      await expect(h.management.list(actor)).rejects.toBeInstanceOf(
        AgentAccessDeniedError,
      );
      await expect(h.management.remove(actor, id)).rejects.toBeInstanceOf(
        AgentAccessDeniedError,
      );
    }
    expect(await scopeOf(h, id)).toEqual(before);
  });
});

describe("PAGE-19 scope administration invariants", () => {
  const getDatabase = useMigratedDatabase();

  it("changing the scope keeps credentials, checks and the saved model", async () => {
    const h = await createScopeHarness(getDatabase());
    await h.management.update(h.admin, API_CONNECTION_ID, {
      name: "Synthetic API",
      testModel: "other-default",
      scope: {
        mode: "restricted",
        targets: [{ kind: "person", targetId: h.carol.id }],
      },
    });
    const connection = await h.connections.find(API_CONNECTION_ID);
    expect(connection).toMatchObject({
      hasApiKey: true,
      testModel: "other-default",
    });
    expect(
      await h.connections.checks().find(API_CONNECTION_ID, "auth"),
    ).toMatchObject({ status: "passed" });
    expect(await h.connections.findSecretEncrypted(API_CONNECTION_ID)).toBe(
      SYNTHETIC_API_CIPHERTEXT,
    );
  });

  it("keeps every credential and every secret out of lists, offers and errors", async () => {
    const h = await createScopeHarness(getDatabase());
    const spies = (["error", "warn", "info", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    );
    const id = await h.management.create(h.admin, {
      name: "Keyed connection",
      provider: "openrouter",
      apiKey: API_KEY,
      scope: {
        mode: "restricted",
        targets: [{ kind: "person", targetId: h.carol.id }],
      },
    });
    const profileId = await h.createTextAgent(API_CONNECTION_ID);
    await h.setScope(API_CONNECTION_ID, {
      mode: "restricted",
      targets: [{ kind: "person", targetId: h.carol.id }],
    });
    const outputs: unknown[] = [
      await h.management.list(h.admin),
      await h.profiles.choices(h.carol.id, "text"),
      await h.profiles.catalog(h.carol.id),
      await h.connections
        .scopes()
        .list()
        .then((all) => [...all.entries()]),
    ];
    const failures: unknown[] = [];
    for (const operation of [
      () => h.profiles.resolve(h.bob.id, "text", profileId),
      () =>
        h.management.update(h.admin, id, {
          name: "Keyed connection",
          apiKey: API_KEY,
          scope: { mode: "restricted", targets: [] },
        }),
      () =>
        h.execution.run(
          {
            agent: {
              connection: {
                isActive: true,
                id,
                name: "Keyed connection",
                provider: "openrouter",
                hasApiKey: true,
                testModel: null,
                reasoningEffort: null,
                cliLoggedInAt: null,
                cliAccountLabel: null,
                updatedAt: "now",
              },
              model: "model-a",
              reasoningEffort: null,
            },
            userId: h.bob.id,
            prompt: "Prompt",
          },
          new AbortController().signal,
        ),
    ])
      failures.push(await operation().catch((error: unknown) => error));
    const text = JSON.stringify([
      outputs,
      failures.map((failure) =>
        failure instanceof Error
          ? { name: failure.name, message: failure.message }
          : failure,
      ),
    ]);
    for (const secret of [API_KEY, SYNTHETIC_API_CIPHERTEXT])
      expect(text).not.toContain(secret);
    expect(failures.every((failure) => failure instanceof Error)).toBe(true);
    for (const spy of spies)
      for (const call of spy.mock.calls)
        expect(JSON.stringify(call)).not.toContain(API_KEY);
    vi.restoreAllMocks();
  });

  it("blocks deleting a group or department that a connection scope still lists", async () => {
    const h = await createScopeHarness(getDatabase());
    await h.setScope(CLI_CONNECTION_ID, {
      mode: "restricted",
      targets: [
        { kind: "group", targetId: "team" },
        { kind: "department", targetId: "engineering" },
      ],
    });
    const groups = new GroupAdministrationService(
      h.authorization,
      new ServerCache(),
    );
    const departments = new DepartmentAdministrationService(h.authorization);
    for (const deletion of [
      () => groups.deleteGroup(h.admin.userId, "team"),
      () => departments.deleteDepartment(h.admin.userId, "engineering"),
    ]) {
      const rejection = await deletion().catch((error: unknown) => error);
      expect(rejection).toBeInstanceOf(AgentScopeInUseError);
      expect(rejection).toMatchObject({
        code: "agentInUse",
        agents: ["Synthetic CLI"],
      });
    }
    expect(
      await getDatabase().query("SELECT id FROM user_groups ORDER BY id;"),
    ).toEqual([["team"]]);
    await h.management.update(h.admin, CLI_CONNECTION_ID, {
      name: "Synthetic CLI",
      scope: { mode: "global", targets: [] },
    });
    await groups.deleteGroup(h.admin.userId, "team");
    await departments.deleteDepartment(h.admin.userId, "engineering");
    expect(await getDatabase().query("SELECT id FROM user_groups;")).toEqual(
      [],
    );
  });

  it("removes the scope with its connection, and an agent still blocks removal", async () => {
    const h = await createScopeHarness(getDatabase());
    await h.setScope(CLI_CONNECTION_ID, {
      mode: "restricted",
      targets: [{ kind: "person", targetId: h.carol.id }],
    });
    await h.createTextAgent(CLI_CONNECTION_ID);
    await expect(
      h.management.remove(h.admin, CLI_CONNECTION_ID),
    ).rejects.toBeInstanceOf(AgentInUseError);
    expect(await scopeOf(h, CLI_CONNECTION_ID)).toMatchObject({
      mode: "restricted",
    });
    const unused = await h.management.create(h.admin, {
      name: "Unused",
      provider: "codex_cli",
      scope: {
        mode: "restricted",
        targets: [{ kind: "group", targetId: "team" }],
      },
    });
    await h.management.remove(h.admin, unused);
    for (const table of [
      "agent_connection_scopes",
      "agent_connection_scope_targets",
    ])
      expect(
        await getDatabase().query(
          `SELECT connection_id FROM ${table} WHERE connection_id = $id;`,
          { id: unused },
        ),
      ).toEqual([]);
  });
});
