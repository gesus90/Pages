import { expect, it, vi } from "vitest";

import { browserSessionCookie } from "@/backend/auth/BrowserSessionCookie";
import { redactLogText, safeLogMetadata } from "@/backend/logging/LogRedaction";
import { redactCredentials } from "@/backend/security/AgentTextSafety";
import {
  sanitizeArtifactText,
  sanitizePlanOutput,
} from "@/backend/service/agents/AgentPlanOutput";
import { ChatAnswerFileService } from "@/backend/service/chat/ChatAnswerFileService";
import { PicaAcpJournal } from "@/backend/service/chat/acp/PicaAcpJournal";
import { PicaAcpToolCalls } from "@/backend/service/chat/acp/PicaAcpToolCalls";

import type { ChatAnswerFileDependencies } from "@/backend/service/chat/ChatAnswerFileService";
import type { ChatJobRepository } from "@/backend/database/repositories/chat/ChatJobRepository";

const TOKEN = "pabs_PLACEHOLDER_TOKEN_NEVER_PUBLISH";
const FILE = "/runtime/pages-agent-browser-placeholder/chat/storage-state.json";

it("masks raw/encoded state and its path in messages, logs, metadata and plan reports", async () => {
  const header = await browserSessionCookie.serialize(TOKEN);
  const encoded = decodeURIComponent(
    header.split(";")[0].slice("pages_session=".length),
  );
  const state = JSON.stringify({
    cookies: [{ name: "pages_session", value: encoded }],
  });
  for (const sanitize of [
    redactCredentials,
    redactLogText,
    sanitizeArtifactText,
    sanitizePlanOutput,
  ]) {
    const output = sanitize(`${TOKEN}\n${state}\n${FILE}`);
    expect(output).not.toContain(TOKEN);
    expect(output).not.toContain(encoded);
    expect(output).not.toContain(FILE);
  }
  expect(
    JSON.stringify(safeLogMetadata({ operation: TOKEN, code: FILE })),
  ).not.toContain(TOKEN);
  expect(
    JSON.stringify(safeLogMetadata({ operation: TOKEN, code: FILE })),
  ).not.toContain(FILE);
});

it("masks browser state printed by native tools or returned in journal text", async () => {
  const tools = new PicaAcpToolCalls();
  const event = tools.read({
    sessionUpdate: "tool_call",
    toolCallId: "call",
    title: "cat",
    rawInput: { command: `cat ${FILE}` },
    rawOutput: TOKEN,
  });
  expect(JSON.stringify(event)).not.toContain(TOKEN);
  expect(JSON.stringify(event)).not.toContain(FILE);
  const append = vi.fn<ChatJobRepository["append"]>(async () => undefined);
  const journal = new PicaAcpJournal({ append }, "job");
  journal.text(1, false, `Result: ${TOKEN}`);
  await journal.drain();
  expect(JSON.stringify(append.mock.calls)).not.toContain(TOKEN);
  expect(JSON.stringify(append.mock.calls)).toContain("[redacted]");
});

it("never persists split browser credentials across timed flushes or intervening events", async () => {
  vi.useFakeTimers();
  try {
    const header = await browserSessionCookie.serialize(TOKEN);
    const encoded = decodeURIComponent(
      header.split(";")[0].slice("pages_session=".length),
    );
    for (const secret of [TOKEN, encoded, FILE]) {
      for (let split = 1; split < secret.length; split += 1) {
        const append = vi.fn<ChatJobRepository["append"]>(
          async () => undefined,
        );
        const journal = new PicaAcpJournal({ append }, "job");
        journal.text(1, false, `Result: ${secret.slice(0, split)}`);
        await vi.advanceTimersByTimeAsync(400);
        await journal.record({ kind: "phase", phase: "running" });
        journal.text(1, false, `${secret.slice(split)} done.`);
        await journal.drain();
        const text = append.mock.calls
          .flatMap(([, , event]) =>
            event.kind === "text" ? [event.delta] : [],
          )
          .join("");
        expect(text, `split ${split}`).toBe("Result: [redacted] done.");
      }
    }
  } finally {
    vi.useRealTimers();
  }
});

it("refuses copied raw state and cookie values before any answer attachment can be stored", async () => {
  const dependencies: ChatAnswerFileDependencies = {
    attachments: {
      insertAnswerFile: vi.fn(),
      answerFiles: vi.fn(async () => []),
      claimAnswerFiles: vi.fn(),
      removeUnclaimedAnswerFiles: vi.fn(),
    },
    files: { write: vi.fn(), remove: vi.fn() },
    isSafeSvg: () => true,
  };
  const service = new ChatAnswerFileService(dependencies);
  const header = await browserSessionCookie.serialize(TOKEN);
  for (const contents of [TOKEN, decodeURIComponent(header.split(";")[0])]) {
    await expect(
      service.stage(
        { userId: "agent", sessionId: "chat", runId: "job" },
        {
          fileName: "state.json",
          bytes: Buffer.from(contents),
          extensions: new Set(["json"]),
        },
      ),
    ).rejects.toMatchObject({ code: "FILE_CREDENTIALS" });
  }
  expect(dependencies.files.write).not.toHaveBeenCalled();
  expect(dependencies.attachments.insertAnswerFile).not.toHaveBeenCalled();
});
