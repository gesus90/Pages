import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { waitForLocalOwnerReady } from "@/backend/agents/local/LocalOwnerReady";

interface WatchEvent {
  readonly filename: string;
}

const mocks = vi.hoisted(() => ({
  watch: vi.fn(),
  readLocalRecord: vi.fn(),
  parse: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({ watch: mocks.watch }));
vi.mock("@/backend/agents/local/LocalSessionFiles", () => ({
  readLocalRecord: mocks.readLocalRecord,
}));
vi.mock("@/backend/agents/local/LocalSessionContracts", () => ({
  localOwnerProofSchema: { parse: mocks.parse },
}));

function missing(): Error {
  return Object.assign(new Error("missing"), { code: "ENOENT" });
}

async function* events(
  filenames: readonly string[],
): AsyncGenerator<WatchEvent> {
  for (const filename of filenames) yield { filename };
}

beforeEach(() => {
  mocks.watch.mockReset();
  mocks.readLocalRecord.mockReset();
  mocks.parse.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

it("returns at once when proof and readiness records already exist", async () => {
  mocks.watch.mockReturnValue(events([]));
  mocks.readLocalRecord.mockResolvedValue({});
  await waitForLocalOwnerReady("/owner");
  expect(mocks.readLocalRecord).toHaveBeenCalledWith("/owner/proof.json");
  expect(mocks.readLocalRecord).toHaveBeenCalledWith("/owner/ready.json");
  expect(mocks.parse).toHaveBeenCalledOnce();
});

it("waits for the readiness file when the records are still missing", async () => {
  mocks.watch.mockReturnValue(events(["proof.json", "ready.json", "later"]));
  mocks.readLocalRecord.mockRejectedValue(missing());
  await waitForLocalOwnerReady("/owner");
});

it("stops waiting when the watch ends without readiness", async () => {
  mocks.watch.mockReturnValue(events(["proof.json"]));
  mocks.readLocalRecord.mockRejectedValue(missing());
  await waitForLocalOwnerReady("/owner");
});

it.each([
  {
    kind: "an error with another code",
    failure: Object.assign(new Error("x"), { code: "EACCES" }),
  },
  { kind: "an error without a code", failure: new Error("plain") },
  { kind: "a non-error value", failure: "failure" },
])("rethrows $kind from the initial read", async ({ failure }) => {
  mocks.watch.mockReturnValue(events([]));
  mocks.readLocalRecord.mockRejectedValue(failure);
  await expect(waitForLocalOwnerReady("/owner")).rejects.toBe(failure);
});

it("rethrows an invalid proof", async () => {
  const failure = new Error("invalid proof");
  mocks.watch.mockReturnValue(events([]));
  mocks.readLocalRecord.mockResolvedValue({});
  mocks.parse.mockImplementation(() => {
    throw failure;
  });
  await expect(waitForLocalOwnerReady("/owner")).rejects.toBe(failure);
});

it("aborts the watch after sixty seconds", async () => {
  vi.useFakeTimers();
  mocks.readLocalRecord.mockRejectedValue(missing());
  mocks.watch.mockImplementation(
    (...[, options]: [string, { signal: AbortSignal }]) =>
      (async function* (): AsyncGenerator<WatchEvent> {
        await new Promise<void>((resolve) => {
          options.signal.addEventListener("abort", () => resolve());
        });
      })(),
  );
  const waiting = waitForLocalOwnerReady("/owner");
  await vi.advanceTimersByTimeAsync(60_000);
  await expect(waiting).resolves.toBeUndefined();
});
