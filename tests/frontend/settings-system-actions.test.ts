import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/backend/runtime/PagesRuntime", () => ({
  getPagesRuntime: vi.fn(),
}));

import { handleSettingsAction } from "@/app/lib/settings-actions/settings-actions.server";
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
  role: ROLE.ADMIN,
  username: "admin",
};

let update: ReturnType<typeof vi.fn>;

function submit(port: string | null, user: User = ADMIN): Promise<unknown> {
  const formData = new FormData();

  if (port !== null) {
    formData.set("port", port);
  }

  return handleSettingsAction("update-port", {
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
