import { RouterContextProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ services: null as unknown }));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => holder.services,
}));

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { action } from "@/app/routes/settings-agents";

import {
  API_CONNECTION_ID,
  createScopeHarness,
} from "../helpers/connection-scope";
import { useMigratedDatabase } from "../helpers/test-database";

import type { ScopeHarness } from "../helpers/connection-scope";
import type { AgentConnectionScope } from "@/definition/AgentConnectionScope";
import type { User } from "@/definition/User";

const API_KEY = "synthetic-key-for-page-19-route";

function routeArgs(
  user: User,
  fields: Record<string, string>,
): Parameters<typeof action>[0] {
  const context = new RouterContextProvider();
  context.set(authenticatedUserContext, user);
  return {
    request: new Request("https://pages.invalid/settings/agents", {
      method: "POST",
      body: new URLSearchParams(fields),
    }),
    context,
    params: {},
    url: new URL("https://pages.invalid/settings/agents"),
    pattern: "/settings/agents",
  };
}

/** Real services on the real database; only the account lookup is the route's. */
function provide(h: ScopeHarness): void {
  holder.services = {
    administrationService: {
      getContext: async (userId: string) => {
        const account = (await h.authorization.snapshot()).accounts.find(
          (entry) => entry.userId === userId,
        );
        if (!account) throw new Error("Missing account");
        return account;
      },
    },
    agentConnectionService: h.management,
  };
}

function updateFields(
  scope: unknown,
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    intent: "update-connection",
    connectionId: API_CONNECTION_ID,
    name: "Synthetic API",
    provider: "openrouter",
    apiKey: API_KEY,
    testModel: "",
    reasoningEffort: "",
    scope: typeof scope === "string" ? scope : JSON.stringify(scope),
    ...overrides,
  };
}

describe("PAGE-19 scope changes through the settings route", () => {
  const getDatabase = useMigratedDatabase();

  afterEach(() => {
    holder.services = null;
  });

  async function restrictedSetup(): Promise<{
    readonly h: ScopeHarness;
    readonly restricted: AgentConnectionScope;
  }> {
    const h = await createScopeHarness(getDatabase());
    const restricted: AgentConnectionScope = {
      mode: "restricted",
      targets: [{ kind: "person", targetId: h.carol.id }],
    };
    await h.setScope(API_CONNECTION_ID, restricted);
    provide(h);
    return { h, restricted };
  }

  it("refuses a non-administrator who widens the scope or sets it to global", async () => {
    const { h, restricted } = await restrictedSetup();
    const attempts: unknown[] = [
      { mode: "global", targets: [] },
      {
        mode: "restricted",
        targets: [
          { kind: "person", targetId: h.carol.id },
          { kind: "person", targetId: h.bob.id },
        ],
      },
      { mode: "restricted", targets: [{ kind: "group", targetId: "team" }] },
    ];
    for (const user of [h.bob, h.carol])
      for (const scope of attempts) {
        const response = await action(routeArgs(user, updateFields(scope)));
        expect(response.status).toBe(403);
        expect(await response.text()).not.toContain(API_KEY);
      }
    expect(await h.connections.scopes().find(API_CONNECTION_ID)).toEqual(
      restricted,
    );
  });

  it("refuses an administrator who has switched to role mode", async () => {
    const { h, restricted } = await restrictedSetup();
    await h.authorization.saveAccount({ ...h.admin, mode: "role" });
    const response = await action(
      routeArgs(h.alice, updateFields({ mode: "global", targets: [] })),
    );
    expect(response.status).toBe(403);
    expect(await h.connections.scopes().find(API_CONNECTION_ID)).toEqual(
      restricted,
    );
  });

  it("lets the active administrator change the scope and never echoes a key", async () => {
    const { h } = await restrictedSetup();
    const response = await action(
      routeArgs(
        h.alice,
        updateFields({
          mode: "restricted",
          targets: [
            { kind: "department", targetId: "finance" },
            { kind: "group", targetId: "team" },
          ],
        }),
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(API_KEY);
    expect(await h.connections.scopes().find(API_CONNECTION_ID)).toEqual({
      mode: "restricted",
      targets: [
        { kind: "department", targetId: "finance" },
        { kind: "group", targetId: "team" },
      ],
    });
    // A saved key is replaced only when one is sent: an omitted scope field
    // leaves the scope as it is.
    const kept = await action(
      routeArgs(h.alice, updateFields("", { scope: "", apiKey: "" })),
    );
    expect(kept.status).toBe(200);
    expect(
      (await h.connections.scopes().find(API_CONNECTION_ID))?.targets,
    ).toHaveLength(2);
  });

  it("answers malformed or invalid scope content with a stable error", async () => {
    const { h, restricted } = await restrictedSetup();
    for (const scope of [
      "{not json",
      JSON.stringify({ mode: "restricted", targets: [] }),
      JSON.stringify({ mode: "global", targets: [{ kind: "person" }] }),
      "x".repeat(50_001),
    ]) {
      const response = await action(routeArgs(h.alice, updateFields(scope)));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: "connection_scope_invalid",
      });
    }
    const missing = await action(
      routeArgs(
        h.alice,
        updateFields({
          mode: "restricted",
          targets: [{ kind: "person", targetId: "nobody" }],
        }),
      ),
    );
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({
      error: "profile_target_invalid",
    });
    expect(await h.connections.scopes().find(API_CONNECTION_ID)).toEqual(
      restricted,
    );
  });

  it("creates a restricted connection through the route", async () => {
    const { h } = await restrictedSetup();
    const response = await action(
      routeArgs(h.alice, {
        intent: "create-connection",
        name: "Route-created",
        provider: "openrouter",
        apiKey: API_KEY,
        testModel: "",
        reasoningEffort: "",
        scope: JSON.stringify({
          mode: "restricted",
          targets: [{ kind: "person", targetId: h.erin.id }],
        }),
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain(API_KEY);
    expect(
      await h.connections.scopes().find(String(body.connectionId)),
    ).toEqual({
      mode: "restricted",
      targets: [{ kind: "person", targetId: h.erin.id }],
    });
  });
});
