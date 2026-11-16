import { beforeEach, expect, it, vi } from "vitest";

import { partial } from "../../app/lib/service-wiring-fakes";

import type { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import type { DesignThemeRegistry } from "@/backend/service/design/DesignThemeRegistry";

const readFile = vi.hoisted(() => vi.fn());
vi.mock("node:fs/promises", () => ({ readFile }));

import { DesignThemeService } from "@/backend/service/DesignThemeService";

const find = vi.fn();
const list = vi.fn();
const chosen = vi.fn();
const save = vi.fn();
const service = new DesignThemeService(
  partial<DesignThemeRegistry>({ find, list }),
  partial<UserSettingsRepository>({
    findDesignThemeId: chosen,
    upsertDesignTheme: save,
  }),
);
const theme = {
  manifest: {
    id: "custom",
    name: "Custom",
    description: "Description",
    modes: ["light"],
    colors: {},
  },
  stylesheet: "/theme.css",
  previewImagePath: "/theme.PNG",
  signature: "version 1",
};

beforeEach(() => {
  vi.resetAllMocks();
  chosen.mockResolvedValue("custom");
  find.mockResolvedValue(theme);
  list.mockResolvedValue({ themes: [theme], skipped: [{ directory: "bad" }] });
  readFile.mockResolvedValue(Buffer.from("image"));
});

it("uses the installed choice or falls back when it disappeared", async () => {
  expect(await service.getActiveTheme("user")).toEqual({
    id: "custom",
    stylesheet: "/theme.css",
  });
  find.mockResolvedValueOnce(null);
  expect(await service.getActiveTheme("user")).toMatchObject({
    stylesheet: null,
  });
});

it("offers preview metadata and reveals skipped themes only when requested", async () => {
  const selection = await service.getSelection("user", {
    includeSkipped: false,
  });
  expect(selection).toMatchObject({
    selectedId: "custom",
    choices: [
      {
        id: "custom",
        previewImageUrl: "/design-themes/custom/preview?v=version%201",
      },
    ],
    skipped: [],
  });
  expect(
    (await service.getSelection("user", { includeSkipped: true })).skipped,
  ).toEqual([{ directory: "bad" }]);
});

it("stores only known selections and serves recognized preview images", async () => {
  expect(await service.select("user", "custom")).toBe("saved");
  expect(save).toHaveBeenCalledWith("user", "custom");
  expect(await service.readPreviewImage("custom")).toEqual({
    data: Buffer.from("image"),
    contentType: "image/png",
  });
  find.mockResolvedValueOnce(null);
  expect(await service.select("user", "missing")).toBe("unknown");
  readFile.mockRejectedValueOnce(
    Object.assign(new Error("missing"), { code: "ENOENT" }),
  );
  expect(await service.readPreviewImage("custom")).toBeNull();
});
