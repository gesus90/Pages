import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  capture: vi.fn(() => ({ id: "ctx" })),
  withLogContext: vi.fn(<T>(context: unknown, work: () => T) => work()),
}));
vi.mock("@/backend/logging/Logger", () => ({
  captureLogContext: mocks.capture,
  withLogContext: mocks.withLogContext,
}));

import { runInCall, CallTransaction } from "@/backend/database/CallTransaction";
import {
  currentDatabaseWork,
  withBackgroundDatabaseWork,
  withDatabaseWork,
} from "@/backend/database/executor/DatabaseWorkContext";

it("defaults to background work", () => {
  expect(currentDatabaseWork()).toEqual({
    workClass: "background",
    signal: undefined,
  });
});

it("runs work in the given context", async () => {
  const context = { workClass: "request", signal: undefined } as const;
  await expect(
    withDatabaseWork(context, () => Promise.resolve(currentDatabaseWork())),
  ).resolves.toBe(context);
});

it("detaches background work from request and call", async () => {
  const signal = new AbortController().signal;
  const call = new CallTransaction({
    runTransaction: () => Promise.reject(new Error("unused")),
  });
  const seen = await withDatabaseWork({ workClass: "request", signal }, () =>
    runInCall(call, () =>
      withBackgroundDatabaseWork("github_publish", () =>
        Promise.resolve(currentDatabaseWork()),
      ),
    ),
  );
  expect(seen).toEqual({
    workClass: "background",
    signal: undefined,
    origin: "github_publish",
  });
  expect(mocks.withLogContext).toHaveBeenCalledWith(
    { id: "ctx" },
    expect.any(Function),
  );
});
