import { expect, it, vi } from "vitest";

import { TicketAssetAuditRepository } from "./TicketAssetAuditRepository";

it("maps every ticket row of the audit read", async () => {
  const query = vi.fn(async () => [["1", "PAGE-1", "text"]]);
  const repository = new TicketAssetAuditRepository({
    execute: vi.fn(),
    query,
  });

  await expect(repository.tickets()).resolves.toEqual([
    { id: "1", key: "PAGE-1", description: "text" },
  ]);
  expect(query).toHaveBeenCalledOnce();
});

it("rejects a row with a broken column", async () => {
  const repository = new TicketAssetAuditRepository({
    execute: vi.fn(),
    query: async () => [["1", "PAGE-1", null]],
  });

  await expect(repository.tickets()).rejects.toThrow('"description"');
});
