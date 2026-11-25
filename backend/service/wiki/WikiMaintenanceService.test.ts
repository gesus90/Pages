import { expect, it, vi } from "vitest";

import { WikiMaintenanceService } from "./WikiMaintenanceService";

import type { WikiAttachmentService } from "./WikiAttachmentService";
import type { WikiSettingsService } from "./WikiSettingsService";
import type { WikiTrashService } from "./WikiTrashService";
import type { WikiVersionService } from "./WikiVersionService";

it("purges, removes files, prunes versions and sweeps", async () => {
  const order: string[] = [];
  const service = new WikiMaintenanceService(
    {
      get: async () => ({
        trashRetentionDays: 7,
        versionKeepLast: 3,
        versionRetentionDays: 30,
      }),
    } as unknown as WikiSettingsService,
    {
      purgeExpired: vi.fn(async () => ({ files: ["f"], rootIds: ["r"] })),
    } as unknown as WikiTrashService,
    {
      prune: vi.fn(async () => {
        order.push("prune");
      }),
    } as unknown as WikiVersionService,
    {
      removeFiles: vi.fn(async () => {
        order.push("files");
      }),
      sweep: vi.fn(async () => {
        order.push("sweep");
      }),
    } as unknown as WikiAttachmentService,
  );

  await expect(service.run()).resolves.toEqual(["r"]);
  expect(order).toEqual(["files", "prune", "sweep"]);
});
