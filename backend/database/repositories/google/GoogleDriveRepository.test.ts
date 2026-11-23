import { expect, it, vi } from "vitest";

import { GoogleDriveRepository } from "./GoogleDriveRepository";

type Database = ConstructorParameters<typeof GoogleDriveRepository>[0];

function doubleOf(rows: unknown[][] = []): {
  repository: GoogleDriveRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn();
  const database = {
    query,
    execute,
    transaction: async (work: (transaction: unknown) => Promise<void>) =>
      work({ query, execute }),
  } as unknown as Database;
  return { repository: new GoogleDriveRepository(database), query, execute };
}

const ATTEMPT_ROW = [
  "a1",
  "h",
  "u1",
  "uri",
  "secret",
  "10",
  "20",
  null,
  "write",
];

it("stores an attempt after dropping expired ones", async () => {
  const { repository, execute } = doubleOf();

  await repository.insertAttempt({
    id: "a1",
    stateHash: "h",
    userId: "u1",
    redirectUri: "uri",
    codeVerifierSecret: "secret",
    createdAt: 10,
    expiresAt: 20,
    requestedAccess: "write",
  });

  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls[0]?.[1]).toEqual({ now: 10 });
  expect(execute.mock.calls[1]?.[1]).toMatchObject({
    id: "a1",
    requested_access: "write",
  });
});

it("claims an open attempt and maps it", async () => {
  const { repository, query } = doubleOf([ATTEMPT_ROW]);

  await expect(
    repository.claimAttempt({ stateHash: "h", userId: "u1", now: 11 }),
  ).resolves.toEqual({
    id: "a1",
    stateHash: "h",
    userId: "u1",
    redirectUri: "uri",
    codeVerifierSecret: "secret",
    createdAt: 10,
    expiresAt: 20,
    consumedAt: null,
    requestedAccess: "write",
  });
  expect(query.mock.calls[0]?.[1]).toEqual({
    now: 11,
    state_hash: "h",
    user_id: "u1",
  });
});

it("returns null for an unclaimable attempt", async () => {
  const { repository } = doubleOf();

  await expect(
    repository.claimAttempt({ stateHash: "h", userId: "u1", now: 11 }),
  ).resolves.toBeNull();
  await expect(repository.findAttemptByStateHash("h")).resolves.toBeNull();
});

it("finds a consumed read attempt by state hash", async () => {
  const row = [...ATTEMPT_ROW];
  row[7] = "15";
  row[8] = "other";
  const { repository } = doubleOf([row]);

  await expect(repository.findAttemptByStateHash("h")).resolves.toMatchObject({
    consumedAt: 15,
    requestedAccess: "read",
  });
});

it("maps the stored connection with and without a reason", async () => {
  const row = ["g1", "a@b.c", "token", "scope", "u1", "7", "scope_missing"];
  const { repository } = doubleOf([row]);

  await expect(repository.findConnection()).resolves.toEqual({
    googlePermissionId: "g1",
    googleEmail: "a@b.c",
    refreshTokenSecret: "token",
    grantedScope: "scope",
    connectedByUserId: "u1",
    connectedAt: 7,
    reauthorizationReason: "scope_missing",
  });

  const unknown = doubleOf([[...row.slice(0, 6), "bogus"]]);
  await expect(unknown.repository.findConnection()).resolves.toMatchObject({
    reauthorizationReason: null,
  });
  await expect(doubleOf().repository.findConnection()).resolves.toBeNull();
});

it("saves the connection under the instance id", async () => {
  const { repository, execute } = doubleOf();

  await repository.saveConnection({
    googlePermissionId: "g1",
    googleEmail: null,
    refreshTokenSecret: "t",
    grantedScope: "s",
    connectedByUserId: "u1",
    connectedAt: 7,
  });

  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    id: "instance",
    google_email: null,
    connected_at: 7,
  });
});

it("reports whether a refresh still belongs to the connection", async () => {
  const input = { connectedAt: 7, now: 9, refreshTokenSecret: null };

  await expect(
    doubleOf([["instance"]]).repository.recordRefresh(input),
  ).resolves.toBe(true);
  await expect(doubleOf().repository.recordRefresh(input)).resolves.toBe(false);
});

it("records a verification and a required reauthorization", async () => {
  const { repository, execute } = doubleOf();

  await repository.recordVerification({
    connectedAt: 7,
    now: 9,
    googleEmail: "a@b.c",
  });
  await repository.requireReauthorization({
    connectedAt: 7,
    reason: "access_revoked",
  });

  expect(execute.mock.calls[0]?.[1]).toMatchObject({ google_email: "a@b.c" });
  expect(execute.mock.calls[1]?.[1]).toMatchObject({
    reason: "access_revoked",
  });
});
