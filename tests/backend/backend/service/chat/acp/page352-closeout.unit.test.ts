import { expect, it, vi } from "vitest";

import { PicaAcpSessionPool } from "@/backend/service/chat/acp/PicaAcpSessionPool";

import { deferred } from "../../agents/page81-resource-fixture";
import { FIRST } from "../page48-chat-fixture";
import { PicaJobWorld } from "./page103-job-fixture";

it("closes and saves the session, consumes attachments, and only then removes the workspace and ends the job", async () => {
  const order: string[] = [];
  const copied = deferred<void>();
  const world = new PicaJobWorld("claude_code", null, {
    acpSessions: {
      save: async () => {
        order.push("saved");
      },
    },
    consumeAnswer: async (answer) => {
      expect(answer).toBe("Answer with attachment");
      order.push("copying");
      await copied.promise;
      order.push("copied");
    },
    workspaceClosed: async () => {
      order.push("removed");
    },
  });
  world.close.mockImplementation(async () => {
    order.push("closed");
    return {
      exit: null,
      endedAt: "2026-11-13",
      leftovers: 0,
      isConfirmed: true,
    };
  });
  const { completion } = await world.start();
  world.complete({
    output: "Answer with attachment",
    sessionId: "native-session",
    failure: null,
    errorCode: null,
    endedAt: "2026-11-13",
    permissionDenials: 0,
    effective: {},
    events: [],
  });
  await vi.waitFor(() => expect(order).toContain("copying"));
  expect(order).toEqual(["closed", "saved", "copying"]);
  expect(world.finish).not.toHaveBeenCalled();
  copied.resolve();
  await completion;
  expect(order).toEqual(["closed", "saved", "copying", "copied", "removed"]);
  expect(world.finish).toHaveBeenCalledWith("job", "completed", null);
});

it("preserves the workspace if native closeout cannot confirm the end of the process", async () => {
  const remove = vi.fn(async () => undefined);
  const world = new PicaJobWorld("codex_cli", null, {
    workspaceClosed: remove,
  });
  world.close.mockResolvedValue({
    exit: null,
    endedAt: "2026-11-13",
    leftovers: 1,
    isConfirmed: false,
  });
  const { completion } = await world.start();
  world.complete();
  await completion;
  expect(remove).not.toHaveBeenCalled();
});

it("ends a pooled native session before deleting its cwd; the next job resumes the saved native ID", async () => {
  const pool = new PicaAcpSessionPool({ idleMinutes: async () => 10 });
  const remove = vi.fn(async () => {
    await pool.closeForWorkspace(FIRST);
  });
  const kept = {
    sessions: pool,
    session: {
      chatSessionId: FIRST,
      agentId: "agent",
      agentName: "Agent",
      conversation: "Chat",
      fingerprint: "same",
    },
  };
  const first = new PicaJobWorld(
    "claude_code",
    null,
    { workspaceClosed: remove },
    kept,
  );
  const { completion } = await first.start();
  first.complete();
  await completion;
  expect(first.close).toHaveBeenCalledOnce();
  expect(pool.describe()).toEqual([]);
  const second = new PicaJobWorld(
    "claude_code",
    "native-session",
    { workspaceClosed: remove },
    kept,
  );
  const next = await second.start();
  expect(second.resumeSessionId).toBe("native-session");
  second.complete();
  await next.completion;
  expect(second.close).toHaveBeenCalledOnce();
});

it("waits for Pica answer-file staging and claiming before deleting its workspace", async () => {
  const staged = deferred<void>();
  let isClaimed = false;
  const remove = vi.fn(async () => {
    expect(isClaimed).toBe(true);
  });
  const world = new PicaJobWorld("codex_cli", null, {
    workspaceClosed: remove,
    answerFiles: {
      stage: async () => {
        await staged.promise;
        return {
          id: "file",
          fileName: "answer.txt",
          contentType: "text/plain",
          size: 5,
        };
      },
      claim: async () => {
        isClaimed = true;
        return [];
      },
      discard: async () => undefined,
    },
  });
  const { completion } = await world.start();
  world.listener?.update({
    sessionUpdate: "agent_message_chunk",
    content: {
      type: "resource",
      resource: {
        uri: "file:///answer.txt",
        mimeType: "text/plain",
        text: "bytes",
      },
    },
  });
  world.complete();
  await Promise.resolve();
  expect(remove).not.toHaveBeenCalled();
  staged.resolve();
  await completion;
  expect(remove).toHaveBeenCalledOnce();
});
