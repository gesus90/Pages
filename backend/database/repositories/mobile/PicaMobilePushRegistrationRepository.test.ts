import { expect, it, vi } from "vitest";

import { PicaMobilePushRegistrationRepository } from "./PicaMobilePushRegistrationRepository";

import type { DatabaseValue } from "@/backend/database/Database";

type Rows = DatabaseValue[][];

/** Answers each query in order; an exhausted script answers no rows. */
function doubleOf(script: Rows[] = []): {
  repository: PicaMobilePushRegistrationRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const queue = [...script];
  const query = vi.fn(async () => queue.shift() ?? []);
  const execute = vi.fn(async () => undefined);
  const executor = { query, execute };
  const database = {
    ...executor,
    transaction: async (work: (value: typeof executor) => unknown) =>
      work(executor),
  };

  return {
    repository: new PicaMobilePushRegistrationRepository(
      database as unknown as ConstructorParameters<
        typeof PicaMobilePushRegistrationRepository
      >[0],
    ),
    query,
    execute,
  };
}

function registrationRow(
  accountId = "a1",
  overrides: Partial<Record<number, DatabaseValue>> = {},
): DatabaseValue[] {
  const row: DatabaseValue[] = [
    "d1",
    accountId,
    "s1",
    "fp1",
    "enc",
    "de",
    "hidden",
    "2026-01-01",
    "2026-01-02",
    null,
  ];

  for (const [index, value] of Object.entries(overrides)) {
    row[Number(index)] = value as DatabaseValue;
  }

  return row;
}

const BINDING = {
  deviceId: "d1",
  accountId: "a1",
  sessionId: "s1",
  tokenFingerprint: "fp1",
  tokenEncrypted: "enc",
  locale: "de",
  preview: "hidden",
  now: "now",
} as const;

it("inserts a first registration", async () => {
  const { repository, execute } = doubleOf([
    [],
    [],
    [["d1"]],
    [registrationRow()],
  ]);

  const bound = await repository.bind(BINDING, 5);

  expect(bound.displacedDeviceIds).toEqual([]);
  expect(bound.registration.activatedAt).toBeNull();
  expect(bound.registration.preview).toBe("hidden");
  expect(execute).toHaveBeenCalledTimes(1);
  expect(String(execute.mock.calls[0]?.[0])).toContain("INSERT INTO");
});

it("renews a registration of the same account", async () => {
  const { repository, execute } = doubleOf([
    [registrationRow()],
    [],
    [["d1"]],
    [registrationRow("a1", { 9: "act", 5: "en", 6: "details" })],
  ]);

  const bound = await repository.bind(BINDING, 5);

  expect(bound.registration).toMatchObject({
    activatedAt: "act",
    locale: "en",
    preview: "details",
  });
  expect(execute.mock.calls[0]?.[1]).toMatchObject({ is_renewal: true });
  expect(execute).toHaveBeenCalledTimes(1);
});

it("restarts the binding when another account takes the device over", async () => {
  const { repository, execute } = doubleOf([
    [registrationRow("other")],
    [],
    [["d1"]],
    [registrationRow()],
  ]);

  await repository.bind(BINDING, 5);

  expect(execute.mock.calls[0]?.[1]).toMatchObject({ is_renewal: false });
  expect(execute.mock.calls.at(-1)?.[1]).toEqual({
    device_id: "d1",
    now: "now",
  });
});

it("displaces a moved token and the oldest registrations over the limit", async () => {
  const { repository, execute } = doubleOf([
    [],
    [["old1"]],
    [["d0"], ["d1"], ["d2"], ["d3"]],
    [registrationRow()],
  ]);

  const bound = await repository.bind(BINDING, 2);

  expect(bound.displacedDeviceIds).toEqual(["old1", "d0", "d2"]);
  const parameters = execute.mock.calls.map((call) => call[1]);
  expect(parameters).toContainEqual({ device_id: "d0" });
  expect(parameters).toContainEqual({ device_id: "d2", now: "now" });
});

it("fails when the registration cannot be read back", async () => {
  const { repository } = doubleOf([[], [], [], []]);

  await expect(repository.bind(BINDING, 5)).rejects.toThrow("not stored");
});

it("rejects a stored locale or preview it does not know", async () => {
  const locale = doubleOf([[registrationRow("a1", { 5: "fr" })]]);
  const preview = doubleOf([[registrationRow("a1", { 6: "full" })]]);

  await expect(locale.repository.find("d1")).rejects.toThrow("locale");
  await expect(preview.repository.find("d1")).rejects.toThrow("preview");
});

it("finds one registration or none", async () => {
  await expect(
    doubleOf([[registrationRow()]]).repository.find("d1"),
  ).resolves.toMatchObject({ deviceId: "d1" });
  await expect(doubleOf().repository.find("d1")).resolves.toBeNull();
});

it("activates a registration", async () => {
  const { repository, execute } = doubleOf();

  await repository.activate(
    { deviceId: "d1", accountId: "a1", sessionId: "s1" },
    "now",
  );

  expect(execute.mock.calls[0]?.[1]).toEqual({
    device_id: "d1",
    account_id: "a1",
    session_id: "s1",
    now: "now",
  });
});

it("removes only the own device of an account", async () => {
  const own = doubleOf([[registrationRow()]]);
  const foreign = doubleOf([[registrationRow("other")]]);
  const missing = doubleOf();

  await own.repository.removeOwn("d1", "a1", "now");
  await foreign.repository.removeOwn("d1", "a1", "now");
  await missing.repository.removeOwn("d1", "a1", "now");

  expect(own.execute).toHaveBeenCalledTimes(2);
  expect(foreign.execute).not.toHaveBeenCalled();
  expect(missing.execute).not.toHaveBeenCalled();
});

it("removes only the exactly observed binding", async () => {
  const binding = { deviceId: "d1", tokenFingerprint: "fp1", sessionId: "s1" };
  const exact = doubleOf([[registrationRow()]]);
  const otherToken = doubleOf([[registrationRow("a1", { 3: "fp2" })]]);
  const otherSession = doubleOf([[registrationRow("a1", { 2: "s2" })]]);
  const missing = doubleOf();

  await exact.repository.removeBinding(binding, "now");
  await otherToken.repository.removeBinding(binding, "now");
  await otherSession.repository.removeBinding(binding, "now");
  await missing.repository.removeBinding(binding, "now");

  expect(exact.execute).toHaveBeenCalledTimes(2);
  expect(otherToken.execute).not.toHaveBeenCalled();
  expect(otherSession.execute).not.toHaveBeenCalled();
  expect(missing.execute).not.toHaveBeenCalled();
});

it("lists activated and all registrations", async () => {
  const { repository } = doubleOf([[registrationRow()], [registrationRow()]]);

  await expect(repository.listActivated("a1")).resolves.toHaveLength(1);
  await expect(repository.listAll()).resolves.toHaveLength(1);
});
