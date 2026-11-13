import { expect, it } from "vitest";

import { completedTurn, PicaJobWorld } from "./page103-job-fixture";

import type { PicaTurnBrief } from "@/backend/service/chat/acp/PicaAcpContent";

/** What an agent session of a chat is opened with: the chat's end and its summary. */
const BRIEF: PicaTurnBrief = {
  instructions: "MEMORY.md und DREAM.md",
  // PAGE-376: a continued session knows its chat; only a new one gets it again.
  keepsContext: false,
  prompt: {
    personName: "Igor",
    interfaceLanguage: "de",
    today: "2026-10-18",
    history: [
      { role: "user", content: "Alter Verlauf des Chats" },
      { role: "assistant", content: "Alte Antwort" },
    ],
    summary: "Zusammenfassung der Lage",
  },
};

function promptsOf(world: PicaJobWorld): string[] {
  return world.opened.mock.calls.map(([input]) => String(input.prompt));
}

it("continues the session of a chat through the provider's resume with the new message alone", async () => {
  const world = new PicaJobWorld("claude_code", "gespeicherte-sitzung", {
    brief: BRIEF,
  });
  const { completion } = await world.start();
  world.complete();
  await completion;
  expect(world.resumeSessionId).toBe("gespeicherte-sitzung");
  const [prompt] = promptsOf(world);
  expect(prompt).not.toContain("Alter Verlauf des Chats");
  expect(prompt).not.toContain("Zusammenfassung der Lage");
  expect(world.finish).toHaveBeenCalledWith("job", "completed", null);
});

it("starts the session anew with its summary and the last messages when the resume fails, and the chat stays usable", async () => {
  const world = new PicaJobWorld("claude_code", "verlorene-sitzung", {
    brief: BRIEF,
  });
  world.opened.mockImplementationOnce(async () => ({
    turn: Promise.resolve({
      ...completedTurn(),
      errorCode: "acp_session_resume_failed",
      failure: "failed",
    }),
    close: world.close,
  }));
  const { completion } = await world.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  world.complete();
  await completion;
  expect(world.opened).toHaveBeenCalledTimes(2);
  const [resumed, restarted] = promptsOf(world);
  expect(resumed).not.toContain("Zusammenfassung der Lage");
  // The new session knows what the old one knew: the summary and the end of the chat.
  expect(restarted).toContain("Zusammenfassung der Lage");
  expect(restarted).toContain("Alter Verlauf des Chats");
  expect(restarted).toContain("MEMORY.md und DREAM.md");
  expect(world.resumeSessionId).toBeNull();
  expect(world.finish).toHaveBeenCalledWith("job", "completed", null);
});
