import { beforeEach, describe, expect, it, vi } from "vitest";

import { handleSystemSettingsAction } from "@/app/lib/settings-actions/settings-system-actions.server";
import { InstanceSettingsDeniedError } from "@/backend/service/InstanceSettingsService";

import { createUser } from "../helpers/factories";

import type { ApplicationServices } from "@/app/lib/services.server";

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);

const updateCompanyName = vi.fn();
const replaceLogo = vi.fn();
const removeLogo = vi.fn();

function submit(
  intent: string,
  fields: Record<string, string | File> = {},
): Promise<unknown> {
  const formData = new FormData();

  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }

  return handleSystemSettingsAction(intent, {
    formData,
    request: new Request("http://pages.invalid/settings/system", {
      method: "POST",
    }),
    services: {
      instanceSettingsService: { removeLogo, replaceLogo, updateCompanyName },
    } as unknown as ApplicationServices,
    user: createUser(),
  });
}

describe("instance settings actions", () => {
  beforeEach(() => {
    updateCompanyName.mockReset().mockResolvedValue(true);
    replaceLogo.mockReset().mockResolvedValue(undefined);
    removeLogo.mockReset().mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe("update-company-name", () => {
    it("stores the name", async () => {
      await expect(
        submit("update-company-name", { companyName: "Muster GmbH" }),
      ).resolves.toMatchObject({
        data: { intent: "update-company-name", ok: true },
      });
      expect(updateCompanyName).toHaveBeenCalledWith(
        expect.anything(),
        "Muster GmbH",
      );
    });

    it("treats a missing field as an empty name", async () => {
      updateCompanyName.mockResolvedValue(false);

      await expect(submit("update-company-name")).resolves.toMatchObject({
        data: { error: "invalidName", ok: false },
        init: { status: 400 },
      });
      expect(updateCompanyName).toHaveBeenCalledWith(expect.anything(), "");
    });

    it("answers 403 to users who may not change it", async () => {
      updateCompanyName.mockRejectedValue(new InstanceSettingsDeniedError());

      await expect(
        submit("update-company-name", { companyName: "X" }),
      ).rejects.toMatchObject({ status: 403 });
    });

    it("reports a failure of the storage", async () => {
      updateCompanyName.mockRejectedValue(new Error("disk"));

      await expect(
        submit("update-company-name", { companyName: "X" }),
      ).resolves.toMatchObject({
        data: { error: "general", ok: false },
        init: { status: 500 },
      });
    });
  });

  describe("update-logo", () => {
    it("stores a valid logo", async () => {
      await expect(
        submit("update-logo", {
          logo: new File([PNG], "logo.png", { type: "image/png" }),
        }),
      ).resolves.toMatchObject({ data: { intent: "update-logo", ok: true } });
      expect(replaceLogo).toHaveBeenCalledWith(expect.anything(), {
        data: Buffer.from(PNG),
        mimeType: "image/png",
      });
    });

    it("asks for a file when none was sent", async () => {
      await expect(submit("update-logo")).resolves.toMatchObject({
        data: { error: "missing", ok: false },
        init: { status: 400 },
      });
      expect(replaceLogo).not.toHaveBeenCalled();
    });

    it("refuses a file that is no valid logo", async () => {
      await expect(
        submit("update-logo", {
          logo: new File([new Uint8Array(12)], "x.png", { type: "image/png" }),
        }),
      ).resolves.toMatchObject({
        data: { error: "invalidLogo", ok: false },
        init: { status: 400 },
      });
    });

    it("answers 403 to users who may not change it", async () => {
      replaceLogo.mockRejectedValue(new InstanceSettingsDeniedError());

      await expect(
        submit("update-logo", {
          logo: new File([PNG], "logo.png", { type: "image/png" }),
        }),
      ).rejects.toMatchObject({ status: 403 });
    });

    it("reports a failure of the storage", async () => {
      replaceLogo.mockRejectedValue(new Error("disk"));

      await expect(
        submit("update-logo", {
          logo: new File([PNG], "logo.png", { type: "image/png" }),
        }),
      ).resolves.toMatchObject({
        data: { error: "general", intent: "update-logo", ok: false },
        init: { status: 500 },
      });
    });
  });

  describe("remove-logo", () => {
    it("removes the logo", async () => {
      await expect(submit("remove-logo")).resolves.toMatchObject({
        data: { intent: "remove-logo", ok: true },
      });
    });

    it("answers 403 to users who may not change it", async () => {
      removeLogo.mockRejectedValue(new InstanceSettingsDeniedError());

      await expect(submit("remove-logo")).rejects.toMatchObject({
        status: 403,
      });
    });

    it("reports a failure of the storage", async () => {
      removeLogo.mockRejectedValue(new Error("disk"));

      await expect(submit("remove-logo")).resolves.toMatchObject({
        data: { intent: "remove-logo", ok: false },
        init: { status: 500 },
      });
    });
  });
});
