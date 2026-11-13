import { beforeEach, expect, it, vi } from "vitest";

import { ConversationContextReader } from "@/backend/service/conversation/ConversationContextReader";
import {
  conversationModelRoot,
  createConversationModelDirectory,
} from "@/backend/service/conversation/ConversationModelDirectory";
import { ConversationObserverMonitor } from "@/backend/service/conversation/ConversationObserverMonitor";

import { ACTOR } from "../../../app/actions/action-fixtures";

import type { ConversationObserverOutcome } from "@/backend/database/repositories/conversation/ConversationObserverRunRepository";

import type * as LoggerModule from "@/backend/logging/Logger";

const files = vi.hoisted(() => ({
  mkdir: vi.fn(),
  lstat: vi.fn(),
  mkdtemp: vi.fn(),
}));
vi.mock("node:fs/promises", () => files);
vi.mock("@/backend/logging/Logger", async (importOriginal) => ({
  ...(await importOriginal<typeof LoggerModule>()),
  logCaughtError: vi.fn(),
}));

const NOW = new Date("2026-11-12T20:00:00.000Z");

function outcome(
  state: ConversationObserverOutcome["state"],
  errorCode: string | null = null,
): ConversationObserverOutcome {
  return {
    kind: "routing",
    state,
    errorCode,
    endedAt: "2026-11-12T19:00:00.000Z",
  };
}

function reader(
  observer?: ConstructorParameters<
    typeof ConversationContextReader
  >[0]["observer"],
): ConversationContextReader {
  return new ConversationContextReader({
    conversations: {
      findForMember: vi.fn().mockResolvedValue({ kind: "group" }),
    },
    messages: { contentAfter: vi.fn(async () => []) },
    contexts: {
      find: vi.fn(async () => null),
      pendingCount: vi.fn(async () => 0),
      isSourceCurrent: vi.fn(async () => true),
    },
    directory: { read: vi.fn() },
    ...(observer ? { observer } : {}),
  });
}

const MEMBER = ACTOR;

beforeEach(() => {
  vi.clearAllMocks();
  files.mkdir.mockResolvedValue(undefined);
  files.lstat.mockResolvedValue({
    isSymbolicLink: () => false,
    isDirectory: () => true,
    uid: process.getuid?.() ?? 0,
  });
  files.mkdtemp.mockImplementation(async (prefix: string) => `${prefix}xyz`);
});

it("counts the failures in a row since the last success and names the newest", async () => {
  const latest = vi.fn(async () => [
    outcome("failed", "antigravity_acp_session_failed"),
    outcome("refused", "pica_model_missing"),
    outcome("succeeded"),
    outcome("failed", "older"),
  ]);
  const monitor = new ConversationObserverMonitor(
    { latest, health: vi.fn() },
    () => NOW,
  );

  await expect(monitor.status("group")).resolves.toEqual({
    consecutiveFailures: 2,
    lastFailure: {
      kind: "routing",
      state: "failed",
      code: "antigravity_acp_session_failed",
      at: "2026-11-12T19:00:00.000Z",
    },
  });
  expect(latest).toHaveBeenCalledWith("group", 20);
});

it("reports no failure once the newest call succeeded", async () => {
  const monitor = new ConversationObserverMonitor({
    latest: vi.fn(async () => [outcome("succeeded"), outcome("failed")]),
    health: vi.fn(),
  });

  await expect(monitor.status("group")).resolves.toEqual({
    consecutiveFailures: 0,
    lastFailure: null,
  });
});

it("reads the administrators' health over the last 24 hours", async () => {
  const health = vi.fn(async (since: string) => ({
    since,
    succeeded: 0,
    failed: 3,
    refused: 0,
    lastSuccessAt: null,
    lastFailure: null,
  }));
  const monitor = new ConversationObserverMonitor(
    { latest: vi.fn(), health },
    () => NOW,
  );

  await monitor.health();

  expect(health).toHaveBeenCalledWith("2026-11-11T20:00:00.000Z");
});

it("shows a member the observer status next to the group context", async () => {
  const status = vi.fn(async () => ({
    consecutiveFailures: 4,
    lastFailure: null,
  }));

  const view = await reader({ status }).forMember(MEMBER, "group");

  expect(view.observer).toEqual({ consecutiveFailures: 4, lastFailure: null });
  expect(status).toHaveBeenCalledWith("group");
});

it("keeps the group context readable when the observer status cannot be read", async () => {
  const view = await reader({
    status: vi.fn(async () => {
      throw new Error("database busy");
    }),
  }).forMember(MEMBER, "group");

  expect(view.observer).toBeUndefined();
  expect(view.status).toBe("unavailable");
});

it("puts observer directories next to Pica's, outside the service's private /tmp", async () => {
  const root = conversationModelRoot("/srv/pages/config/pica-sessions");

  expect(root).toBe("/srv/pages/config/observer-sessions");
  await expect(
    createConversationModelDirectory(root, "observer-"),
  ).resolves.toBe("/srv/pages/config/observer-sessions/observer-xyz");
  expect(files.mkdir).toHaveBeenCalledWith(root, {
    recursive: true,
    mode: 0o700,
  });
});

it("refuses a linked observer root", async () => {
  files.lstat.mockResolvedValue({
    isSymbolicLink: () => true,
    isDirectory: () => false,
    uid: process.getuid?.() ?? 0,
  });

  await expect(
    createConversationModelDirectory("/srv/pages/observer-sessions", "x-"),
  ).rejects.toThrow("not a private directory");
  expect(files.mkdtemp).not.toHaveBeenCalled();
});
