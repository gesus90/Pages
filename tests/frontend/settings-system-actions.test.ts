import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/backend/runtime/PagesRuntime", () => ({
  getPagesRuntime: vi.fn(),
}));

import { handleSystemSettingsAction } from "@/app/lib/settings-actions/settings-system-actions.server";
import { PermissionService } from "@/backend/auth/PermissionService";
import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";
import { ROLE } from "@/definition/Role";

import type { ApplicationServices } from "@/app/lib/services.server";
import type { PagesRuntime } from "@/backend/runtime/PagesRuntime";
import type { User } from "@/definition/User";

const ADMIN: User = {
  displayName: "Admin",
  id: "u1",
  isActive: true,
  mustChangePassword: false,
  role: ROLE.ADMIN,
  username: "admin",
};

let update: ReturnType<typeof vi.fn>;

function submit(port: string | null, user: User = ADMIN): Promise<unknown> {
  const formData = new FormData();

  if (port !== null) {
    formData.set("port", port);
  }

  return handleSystemSettingsAction("update-port", {
    formData,
    request: new Request("http://pages.invalid/settings", { method: "POST" }),
    services: {
      permissionService: new PermissionService(),
    } as unknown as ApplicationServices,
    user,
  });
}

describe("update-port settings action", () => {
  beforeEach(() => {
    update = vi.fn().mockResolvedValue({});
    vi.mocked(getPagesRuntime).mockResolvedValue({
      configFile: { read: vi.fn(), update },
    } as unknown as PagesRuntime);
  });

  it("stores a valid port for the next start", async () => {
    await expect(submit(" 8080 ")).resolves.toMatchObject({
      data: { intent: "update-port", ok: true, port: 8080 },
    });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it.each(["", "80a", "0", "65536", null])("rejects %j", async (port) => {
    await expect(submit(port)).resolves.toMatchObject({
      data: { error: "invalidPort", ok: false },
      init: { status: 400 },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("forbids the change for users without the permission", async () => {
    await expect(
      submit("8080", { ...ADMIN, role: ROLE.EMPLOYEE }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("reports a configuration that cannot be written", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    update.mockRejectedValue(new Error("read-only"));

    await expect(submit("8080")).resolves.toMatchObject({
      data: { error: "general", ok: false },
      init: { status: 500 },
    });
    expect(error).toHaveBeenCalledWith(
      "[pages] The port could not be stored.",
      expect.any(Error),
    );
  });
});

describe("system settings action router", () => {
  function context(): Parameters<typeof handleSystemSettingsAction>[1] {
    return {
      formData: new FormData(),
      request: new Request("http://pages.invalid/settings/system", {
        method: "POST",
      }),
      services: {} as unknown as ApplicationServices,
      user: ADMIN,
    };
  }

  it.each([[null], ["unknown"], ["update-profile"], ["constructor"]])(
    "answers the intent %p with 400",
    async (intent) => {
      const failure = await handleSystemSettingsAction(intent, context()).catch(
        (error: unknown) => error,
      );

      expect((failure as Response).status).toBe(400);
    },
  );

  it("accepts the mode switch of administrators in the role mode", async () => {
    const setMode = vi.fn().mockResolvedValue(undefined);
    const formData = new FormData();

    formData.set("mode", "admin");

    await expect(
      handleSystemSettingsAction("set-mode", {
        ...context(),
        formData,
        services: {
          administrationService: { setMode },
        } as unknown as ApplicationServices,
      }),
    ).resolves.toMatchObject({ data: { intent: "set-mode", ok: true } });
    expect(setMode).toHaveBeenCalledWith(ADMIN.id, "admin");
  });
});
