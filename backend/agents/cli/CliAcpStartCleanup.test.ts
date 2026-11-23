import { beforeEach, expect, it, vi } from "vitest";

import { AcpCleanupUnconfirmedError } from "@/backend/error/AcpCleanupUnconfirmedError";
import { AgentError } from "@/backend/error/AgentErrors";
import {
  cleanupAcpStart,
  cleanupFailedAcpStart,
} from "@/backend/agents/cli/CliAcpStartCleanup";

import type { CliGitHubAccess } from "@/backend/agents/cli/CliGitHubCredentials";
import type { CliSessionProcess } from "@/backend/agents/cli/CliSessionProcess";

const h = vi.hoisted(() => ({
  closeCliSession: vi.fn(),
  logCaught: vi.fn(),
}));

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: h.logCaught,
  logEvent: vi.fn(),
}));
vi.mock("@/backend/agents/cli/CliSessionCloseout", () => ({
  closeCliSession: h.closeCliSession,
}));

/** Casts a partial stand-in to the type the code under test expects. */
function fake<T>(value: object): T {
  return value as T;
}

function child(): CliSessionProcess {
  return fake<CliSessionProcess>({ cancel: vi.fn() });
}

function github(cleanup: () => Promise<void>): CliGitHubAccess {
  return fake<CliGitHubAccess>({ cleanup });
}

function cleanupOf(parts: object = {}): Parameters<typeof cleanupAcpStart>[1] {
  return {
    instanceId: "instance",
    github: null,
    limited: null,
    containment: "none",
    ...parts,
  };
}

beforeEach(() => {
  h.closeCliSession.mockResolvedValue({ isConfirmed: true });
});

it("settles the unit and cleans GitHub when no worker exists", async () => {
  const settle = vi.fn(async () => {});
  const cleanup = vi.fn(async () => {});
  await cleanupAcpStart(
    null,
    cleanupOf({
      limited: { request: { unit: { settle } } },
      github: github(cleanup),
    }),
  );
  expect(settle).toHaveBeenCalledOnce();
  expect(cleanup).toHaveBeenCalledOnce();
  await cleanupAcpStart(null, cleanupOf({ limited: { request: {} } }));
});

it("cancels and closes a started worker", async () => {
  const worker = child();
  await cleanupAcpStart(worker, cleanupOf());
  expect(worker.cancel).toHaveBeenCalledWith("login_cancelled");
  expect(h.closeCliSession).toHaveBeenCalledWith(
    worker,
    "instance",
    undefined,
    "none",
  );
});

it("reports an unconfirmed close and a failing close", async () => {
  h.closeCliSession.mockResolvedValueOnce({ isConfirmed: false });
  await expect(cleanupAcpStart(child(), cleanupOf())).rejects.toBeInstanceOf(
    AcpCleanupUnconfirmedError,
  );
  h.closeCliSession.mockRejectedValueOnce(new Error("close"));
  await expect(cleanupAcpStart(child(), cleanupOf())).rejects.toBeInstanceOf(
    AcpCleanupUnconfirmedError,
  );
  expect(h.logCaught).toHaveBeenCalledOnce();
});

it("turns a credential cleanup failure into an error only when the worker end is confirmed", async () => {
  const failing = github(async () => {
    throw new Error("cleanup");
  });
  await expect(
    cleanupAcpStart(null, cleanupOf({ github: failing })),
  ).rejects.toEqual(new AgentError("credential_cleanup_failed"));
  h.closeCliSession.mockResolvedValueOnce({ isConfirmed: false });
  await expect(
    cleanupAcpStart(child(), cleanupOf({ github: failing })),
  ).rejects.toBeInstanceOf(AcpCleanupUnconfirmedError);
});

it("removes bundle and scratch after a successful cleanup", async () => {
  const bundle = vi.fn();
  const remove = vi.fn(async () => {});
  await cleanupFailedAcpStart(
    null,
    cleanupOf({ cleanupTemporaryDirectory: remove }),
    bundle,
  );
  expect(bundle).toHaveBeenCalledOnce();
  expect(remove).toHaveBeenCalledOnce();
  await cleanupFailedAcpStart(null, cleanupOf(), undefined);
});

it("logs a failing scratch removal and continues", async () => {
  const remove = vi.fn(async () => {
    throw new Error("rm");
  });
  await cleanupFailedAcpStart(
    null,
    cleanupOf({ cleanupTemporaryDirectory: remove }),
    undefined,
  );
  expect(h.logCaught).toHaveBeenCalledOnce();
});

it("keeps bundle and scratch and releases the directory when the end is unconfirmed", async () => {
  h.closeCliSession.mockResolvedValue({ isConfirmed: false });
  const bundle = vi.fn();
  const release = vi.fn();
  await expect(
    cleanupFailedAcpStart(
      child(),
      cleanupOf({ releaseTemporaryDirectory: release }),
      bundle,
    ),
  ).rejects.toBeInstanceOf(AcpCleanupUnconfirmedError);
  expect(release).toHaveBeenCalledOnce();
  expect(bundle).not.toHaveBeenCalled();
  await expect(
    cleanupFailedAcpStart(child(), cleanupOf(), undefined),
  ).rejects.toBeInstanceOf(AcpCleanupUnconfirmedError);
});

it("removes bundle and scratch when another failure occurs", async () => {
  const failing = github(async () => {
    throw new Error("cleanup");
  });
  const bundle = vi.fn();
  const remove = vi.fn(async () => {});
  await expect(
    cleanupFailedAcpStart(
      null,
      cleanupOf({ github: failing, cleanupTemporaryDirectory: remove }),
      bundle,
    ),
  ).rejects.toBeInstanceOf(AgentError);
  expect(bundle).toHaveBeenCalledOnce();
  expect(remove).toHaveBeenCalledOnce();
  await expect(
    cleanupFailedAcpStart(null, cleanupOf({ github: failing }), undefined),
  ).rejects.toBeInstanceOf(AgentError);
});
