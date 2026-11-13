import { expect, it } from "vitest";

import { PicaAcpSessionPool } from "@/backend/service/chat/acp/PicaAcpSessionPool";

import { FIRST } from "../page48-chat-fixture";
import { PicaJobWorld } from "./page103-job-fixture";

import type { PicaAcpJobPool } from "@/backend/service/chat/acp/PicaAcpPoolOpening";

function keptSession(pool: PicaAcpSessionPool): PicaAcpJobPool {
  return {
    sessions: pool,
    session: {
      chatSessionId: FIRST,
      agentId: "agent-1",
      agentName: "Ed",
      conversation: "Gruppe „A-Team“",
      fingerprint: "configuration-1",
    },
  };
}

it("answers the next job of an agent's chat in the resting native session instead of starting a process", async () => {
  const pool = new PicaAcpSessionPool({ idleMinutes: async () => 10 });
  const first = new PicaJobWorld("claude_code", null, {}, keptSession(pool));
  const { completion } = await first.start();
  first.complete();
  await completion;
  expect(first.opened).toHaveBeenCalledOnce();
  expect(first.close).not.toHaveBeenCalled();
  expect(first.finish).toHaveBeenCalledWith("job", "completed", null);
  expect(pool.describe()).toMatchObject([{ state: "idle", agentName: "Ed" }]);

  const second = new PicaJobWorld(
    "claude_code",
    "native-session",
    {},
    keptSession(pool),
  );
  await second.job.run(second.controller.signal);
  expect(second.opened).not.toHaveBeenCalled();
  expect(second.finish).toHaveBeenCalledWith("job", "completed", null);
  expect(second.messages.map((message) => message.content)).toEqual([
    "Follow-up answer",
  ]);
  expect(second.events).toContainEqual({ kind: "session", isResumed: true });

  await pool.closeAll();
  expect(first.close).toHaveBeenCalledOnce();
  expect(pool.describe()).toEqual([]);
});

it("ends the kept session when the person stops its job", async () => {
  const pool = new PicaAcpSessionPool({ idleMinutes: async () => 10 });
  const world = new PicaJobWorld("claude_code", null, {}, keptSession(pool));
  const { completion } = await world.start();
  world.job.stop();
  world.controller.abort();
  await completion;
  expect(world.close).toHaveBeenCalledOnce();
  expect(pool.describe()).toEqual([]);
});
