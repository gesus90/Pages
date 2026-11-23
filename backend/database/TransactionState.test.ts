import { expect, it } from "vitest";

import { holdsTransaction } from "@/backend/database/TransactionState";

it("opens on BEGIN", () => {
  expect(holdsTransaction(" begin", false)).toBe(true);
});

it("stays open until COMMIT or ROLLBACK", () => {
  expect(holdsTransaction("SELECT 1", true)).toBe(true);
  expect(holdsTransaction("commit", true)).toBe(false);
  expect(holdsTransaction("ROLLBACK", true)).toBe(false);
  expect(holdsTransaction("SELECT 1", false)).toBe(false);
});
