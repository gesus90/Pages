import { beforeEach, describe, expect, it, vi } from "vitest";
import { RouterContextProvider } from "react-router";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { loader as accountVersion } from "@/app/routes/account-version";
import { handleSetMode } from "@/app/lib/settings-actions/settings-mode-action.server";
import { AdministrationError } from "@/backend/error/AdministrationError";
import { action, loader, middleware } from "@/app/routes/users";
import { getApplicationServices } from "@/app/lib/services.server";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { AdministrationService } from "@/backend/service/AdministrationService";
import { PasswordHasher } from "@/backend/auth/PasswordHasher";
import { ServerCache } from "@/backend/cache/ServerCache";
import { CAPABILITY } from "@/definition/Authorization";
import { createUser } from "../helpers/factories";
import { createRole } from "../helpers/authorization";
import { useMigratedDatabase } from "../helpers/test-database";

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

const VALID_CREATE = {
  intent: "create-user",
  username: "new",
  firstName: "New",
  lastName: "Person",
  role: "junior",
};

function args(
  fields: Record<string, string | undefined>,
  actorId: string | null = "admin",
  method = "POST",
): Parameters<typeof action>[0] {
  const body = new URLSearchParams();
  for (const [name, entry] of Object.entries(fields))
    if (entry !== undefined) body.set(name, entry);
  return {
    params: {},
    context: { get: () => (actorId ? createUser({ id: actorId }) : null) },
    request: new Request("http://pages.invalid/users", {
      method,
      ...(method === "POST" ? { body } : {}),
    }),
  } as unknown as Parameters<typeof action>[0];
}

describe("user directory route with real A2 authorization", () => {
  const getDatabase = useMigratedDatabase();
  let repository: AuthorizationRepository;
  let service: AdministrationService;
  beforeEach(async () => {
    repository = new AuthorizationRepository(getDatabase());
    service = new AdministrationService(
      repository,
      new ServerCache(),
      new PasswordHasher(),
    );
    await repository.users().insert({
      id: "admin",
      username: "admin",
      displayName: "Admin",
      role: "admin",
      passwordHash: "hash",
    });
    await service.saveRole(
      "admin",
      createRole({
        id: "junior",
        name: "Junior",
        rank: 10,
        permissions: [CAPABILITY.WRITE],
      }),
    );
    vi.mocked(getApplicationServices).mockResolvedValue({
      administrationService: service,
      wikiService: {
        listAllPlaceholders: vi.fn().mockResolvedValue({
          admin: [{ id: "page-1", ownerId: "admin", ownerName: "Admin" }],
        }),
      },
    } as unknown as Awaited<ReturnType<typeof getApplicationServices>>);
  });

  it("registers the server management gate", () => {
    expect(middleware).toHaveLength(1);
  });

  it("loads actual configurable roles and filtered identities with action hints", async () => {
    const result = await loader(args({}, "admin", "GET"));
    expect(result.assignableRoles.map((role) => role.id)).toEqual(["junior"]);
    expect(result.users[0]).toMatchObject({
      id: "admin",
      account: { role: null, isAdmin: true },
      canManage: true,
    });
    expect(result.actor.mode).toBe("admin");
    expect(result.privateWikiPages).toEqual({
      admin: [{ id: "page-1", ownerId: "admin", ownerName: "Admin" }],
    });
  });

  it("rejects missing authenticated context in loaders and actions", async () => {
    await expect(loader(args({}, null, "GET"))).rejects.toThrow(
      "Authenticated middleware",
    );
    await expect(action(args(VALID_CREATE, null))).rejects.toMatchObject({
      status: 403,
    });
    await expect(action(args({}, "admin", "DELETE"))).rejects.toMatchObject({
      status: 405,
    });
  });

  it("creates a real account without accepting a caller-provided password", async () => {
    const result = await action(
      args({ ...VALID_CREATE, password: "attacker-selected" }),
    );
    expect(result.data).toMatchObject({
      intent: "create-user",
      ok: true,
      temporaryPassword: expect.any(String),
    });
    expect(result.init?.headers).toEqual({ "Cache-Control": "no-store" });
    expect(
      await repository.users().findCredentialsByUsername("new"),
    ).toMatchObject({ user: { mustChangePassword: true } });
    expect((await repository.snapshot()).accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: expect.objectContaining({ id: "junior" }),
          firstName: "New",
          lastName: "Person",
        }),
      ]),
    );
  });

  it.each([
    { firstName: "" },
    { lastName: "" },
    { username: " " },
    { firstName: "x".repeat(201) },
    { lastName: "x".repeat(201) },
    { username: "x".repeat(201) },
    { email: "invalid" },
    { role: "missing" },
    { intent: "unknown" },
  ])("rejects invalid creation %j without inserting data", async (override) => {
    const result = await action(args({ ...VALID_CREATE, ...override }));
    expect(result.data).toMatchObject({ ok: false });
    expect(await repository.users().findAll()).toHaveLength(1);
  });

  it("reports duplicate usernames and email addresses inline", async () => {
    await action(args({ ...VALID_CREATE, email: "one@test.invalid" }));
    expect((await action(args(VALID_CREATE))).data).toMatchObject({
      error: "usernameTaken",
    });
    expect(
      (
        await action(
          args({
            ...VALID_CREATE,
            username: "other",
            email: "one@test.invalid",
          }),
        )
      ).data,
    ).toMatchObject({ error: "emailTaken" });
  });

  it("does not trust forged role or personal-admin selections", async () => {
    await repository.users().insert({
      id: "manager",
      username: "manager",
      displayName: "Manager",
      role: "manager",
      passwordHash: "hash",
    });
    const denied = await action(
      args({ ...VALID_CREATE, isAdmin: "true" }, "manager"),
    );
    expect(denied.data).toMatchObject({ ok: false, error: "forbidden" });
    const actor = await loader(args({}, "manager", "GET"));
    expect(actor.canManageRoles).toBe(false);
    expect(actor.canCreate).toBe(true);
  });

  it("updates permitted profile fields, assigns roles and enforces reset/deactivation policy", async () => {
    await action(args(VALID_CREATE));
    const target = await repository.users().findCredentialsByUsername("new");
    if (!target) throw new Error("Missing created account");
    const userId = target.user.id;
    expect(
      (
        await action(
          args({
            intent: "update-user",
            userId,
            username: "renamed",
            firstName: "Other",
            lastName: "Name",
            email: "",
          }),
        )
      ).data,
    ).toEqual({ intent: "update-user", ok: true });
    expect(
      (await action(args({ intent: "set-role", userId, role: "junior" }))).data,
    ).toEqual({ intent: "set-role", ok: true });
    expect(
      (await action(args({ intent: "reset-password", userId }))).data,
    ).toMatchObject({
      ok: true,
      temporaryPassword: expect.any(String),
      userId,
    });
    expect(
      (await action(args({ intent: "set-active", userId, isActive: "false" })))
        .data,
    ).toMatchObject({ ok: true });
    expect(
      (await action(args({ intent: "set-active", userId, isActive: "true" })))
        .data,
    ).toMatchObject({ ok: true });
    expect(
      (
        await action(
          args({ intent: "set-active", userId: "admin", isActive: "false" }),
        )
      ).data,
    ).toMatchObject({ error: "lastAdministrator" });
  });

  it.each([
    { intent: "set-role", role: "junior" },
    { intent: "set-role", userId: "admin", role: "" },
    { intent: "set-active", userId: "admin", isActive: "maybe" },
    { intent: "reset-password" },
    { intent: "update-user", userId: "admin" },
  ])("rejects malformed actions %j", async (fields) => {
    expect((await action(args(fields))).data).toMatchObject({
      ok: false,
      error: "invalidInput",
    });
  });
  it("returns only an uncacheable fingerprint of the requesting account", async () => {
    const context = new RouterContextProvider();
    const request = new Request("http://pages.invalid/account-version");
    await expect(
      accountVersion({
        context,
        params: {},
        request,
        url: new URL(request.url),
        pattern: "/account-version",
      }),
    ).rejects.toMatchObject({ status: 403 });
    context.set(authenticatedUserContext, createUser({ id: "admin" }));
    const result = await accountVersion({
      context,
      params: {},
      request,
      url: new URL(request.url),
      pattern: "/account-version",
    });
    expect(result.init?.headers).toEqual({ "Cache-Control": "no-store" });
    expect(result.data).toEqual({ version: await service.version("admin") });
  });

  it("applies mode actions to the caller, validates input, and explains domain rejection", async () => {
    const services = await getApplicationServices();
    const formData = new FormData();
    const context = {
      services,
      formData,
      user: createUser({ id: "admin" }),
      request: new Request("http://pages.invalid/settings"),
    };
    formData.set("mode", "unknown");
    await expect(handleSetMode(context)).rejects.toMatchObject({ status: 400 });
    formData.set("mode", "role");
    expect(await handleSetMode(context)).toMatchObject({
      data: { intent: "set-mode", ok: false },
      init: { status: 403 },
    });
    await service.assignRole("admin", "admin", "junior");
    expect(await handleSetMode(context)).toMatchObject({
      data: { intent: "set-mode", ok: true },
    });
    expect((await service.getContext("admin")).mode).toBe("role");
    formData.set("mode", "admin");
    expect(await handleSetMode(context)).toMatchObject({ data: { ok: true } });
    vi.spyOn(service, "setMode")
      .mockRejectedValueOnce(new AdministrationError("forbidden"))
      .mockRejectedValueOnce(new Error("storage failure"));
    expect(await handleSetMode(context)).toMatchObject({ data: { ok: false } });
    await expect(handleSetMode(context)).rejects.toThrow("storage failure");
  });
});
