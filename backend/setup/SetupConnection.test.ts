import { beforeEach, expect, it, vi } from "vitest";

import { DATABASE_LOCATION_STATUS } from "@/definition/Setup";

import { checkSetupConnection, isSetupDatabaseUrl } from "./SetupConnection";

const database = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
}));
vi.mock("pg", () => ({
  Client: class {
    public connect = database.connect;
    public query = database.query;
    public end = database.end;
  },
}));
vi.mock("@/backend/logging/LogRedaction", () => ({
  registerLogSecret: vi.fn(),
}));

beforeEach(() => {
  database.connect.mockReset().mockResolvedValue(undefined);
  database.query.mockReset().mockResolvedValue({ rows: [{ occupied: false }] });
  database.end.mockReset().mockResolvedValue(undefined);
});

it("validates postgres URLs without opening a connection", () => {
  expect(isSetupDatabaseUrl("postgres://user:pass@localhost/db")).toBe(true);
  expect(isSetupDatabaseUrl("postgresql://localhost/db")).toBe(true);
  for (const input of [
    "",
    "postgres://localhost/\u0000",
    "x".repeat(4097),
    "https://example.com",
    "not a URL",
    "postgres://u:%xx@localhost/db",
  ]) {
    expect(isSetupDatabaseUrl(input)).toBe(false);
  }
  expect(database.connect).not.toHaveBeenCalled();
});

it("reports empty and invalid input without reaching the database", async () => {
  expect(await checkSetupConnection("")).toBe(DATABASE_LOCATION_STATUS.EMPTY);
  expect(await checkSetupConnection("https://example.com")).toBe(
    DATABASE_LOCATION_STATUS.INVALID,
  );
  expect(database.connect).not.toHaveBeenCalled();
});

it("reports empty, occupied and unreachable databases and closes each client", async () => {
  const url = "postgres://user:pass@localhost/db";
  expect(await checkSetupConnection(url)).toBe(
    DATABASE_LOCATION_STATUS.AVAILABLE,
  );
  database.query.mockResolvedValueOnce({ rows: [{ occupied: true }] });
  expect(await checkSetupConnection(url)).toBe(
    DATABASE_LOCATION_STATUS.FOREIGN,
  );
  database.query.mockResolvedValueOnce({ rows: [] });
  expect(await checkSetupConnection(url)).toBe(
    DATABASE_LOCATION_STATUS.FOREIGN,
  );
  database.connect.mockRejectedValueOnce(new Error("offline"));
  expect(await checkSetupConnection(url)).toBe(
    DATABASE_LOCATION_STATUS.NOT_WRITABLE,
  );
  expect(database.end).toHaveBeenCalledTimes(4);
});
