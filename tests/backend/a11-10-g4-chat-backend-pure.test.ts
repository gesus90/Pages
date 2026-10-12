import { Readable } from "node:stream";
import { crc32 } from "node:zlib";

import { describe, expect, it } from "vitest";

import { createTextProviderRequest } from "@/backend/agents/providers/TextProviderPayload";
import { ChatError } from "@/backend/error/ChatErrors";
import { readChatModelReply } from "@/backend/service/chat/ChatActionProtocol";
import { ChatFileProbe } from "@/backend/service/chat/ChatFileProbe";
import { classifyChatFile } from "@/backend/service/chat/ChatFileTypes";
import { createChatPrompt } from "@/backend/service/chat/ChatPrompt";

import type { ChatFileFacts } from "@/backend/service/chat/ChatFileProbe";
import type { TextExecutionInput } from "@/backend/agents/TextExecution";
import type { ChatPromptInput } from "@/backend/service/chat/ChatPrompt";

const FENCE = "```pages-action";

function action(body: string): string {
  return `${FENCE}\n${body}\n\`\`\``;
}

describe("A11.10 g4: reading the reply of the chat model", () => {
  it("reads an action without parameters as an action with an empty parameter object", () => {
    expect(
      readChatModelReply(action(JSON.stringify({ operation: "ticket.read" }))),
    ).toEqual({ kind: "action", operation: "ticket.read", parameters: {} });
    expect(
      readChatModelReply(
        action(
          JSON.stringify({
            operation: "ticket.read",
            parameters: { ticketId: "PAGE-1" },
          }),
        ),
      ),
    ).toEqual({
      kind: "action",
      operation: "ticket.read",
      parameters: { ticketId: "PAGE-1" },
    });
  });

  it("reads null parameters like missing parameters", () => {
    expect(
      readChatModelReply(
        action(JSON.stringify({ operation: "ticket.read", parameters: null })),
      ),
    ).toEqual({ kind: "action", operation: "ticket.read", parameters: {} });
  });

  it("treats a reply without an action block as the trimmed answer", () => {
    expect(readChatModelReply("  Hallo Welt \n")).toEqual({
      kind: "answer",
      text: "Hallo Welt",
    });
  });

  it.each([
    ["JSON that does not parse", action("{not json")],
    [
      "a block without an operation",
      action(JSON.stringify({ parameters: {} })),
    ],
    ["an operation that is no text", action(JSON.stringify({ operation: 5 }))],
    [
      "parameters that are a text",
      action(JSON.stringify({ operation: "ticket.read", parameters: "x" })),
    ],
    [
      "parameters that are a list",
      action(JSON.stringify({ operation: "ticket.read", parameters: [1] })),
    ],
  ])("marks %s as an invalid action", (_name, reply) => {
    expect(readChatModelReply(reply)).toEqual({ kind: "invalid" });
  });
});

const BASE_PROMPT: ChatPromptInput = {
  personName: "Wanda",
  interfaceLanguage: "de",
  today: "2026-10-12",
  history: [],
  message: "Hallo",
  attachments: [],
  steps: [],
  isLastStep: false,
};

function historyOf(prompt: string): readonly { from: string; text: string }[] {
  const section = prompt
    .split("\n\n")
    .find((entry) => entry.startsWith("Bisheriger Verlauf: "));
  if (!section) throw new Error("Missing history section.");
  const parsed: unknown = JSON.parse(
    section.slice("Bisheriger Verlauf: ".length),
  );
  if (!Array.isArray(parsed)) throw new Error("History is no list.");
  return parsed;
}

function words(tag: string, length: number): string {
  return `${tag} ${"ab ".repeat(Math.ceil(length / 3))}`.slice(0, length);
}

describe("A11.10 g4: the prompt of one chat step", () => {
  it("shortens a long earlier message and marks the cut", () => {
    const prompt = createChatPrompt({
      ...BASE_PROMPT,
      history: [
        { role: "user", content: words("lang", 7_000) },
        { role: "assistant", content: "kurz" },
      ],
    });
    const history = historyOf(prompt);
    expect(history).toHaveLength(2);
    expect(history[0].from).toBe("person");
    expect(history[0].text.endsWith("\n[gekürzt]")).toBe(true);
    expect(history[0].text).toHaveLength(6_000 + "\n[gekürzt]".length);
    expect(history[1]).toEqual({ from: "pica", text: "kurz" });
  });

  it("keeps only as many of the newest messages as fit into the history budget", () => {
    const history = Array.from({ length: 12 }, (_unused, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: words(`m${String(index).padStart(2, "0")}`, 5_000),
    }));
    const selected = historyOf(createChatPrompt({ ...BASE_PROMPT, history }));
    expect(selected.map(({ text }) => text.slice(0, 3))).toEqual([
      "m04",
      "m05",
      "m06",
      "m07",
      "m08",
      "m09",
      "m10",
      "m11",
    ]);
  });

  it("gives the agent the details of a failed action but never a temporary password", () => {
    const prompt = createChatPrompt({
      ...BASE_PROMPT,
      isLastStep: true,
      steps: [
        {
          operation: "ticket.update",
          parameters: { ticketId: "PAGE-1" },
          outcome: {
            ok: false,
            error: "AMBIGUOUS",
            details: { candidates: ["PAGE-1", "PAGE-2"] },
            temporaryPassword: {
              userId: "u1",
              username: "wanda",
              temporaryPassword: "geheim-passwort-123",
            },
          },
        },
      ],
    });
    expect(prompt).toContain(
      '"error":"AMBIGUOUS","details":{"candidates":["PAGE-1","PAGE-2"]}',
    );
    expect(prompt).not.toContain("geheim-passwort-123");
    expect(prompt).toContain("Weitere Aktionen sind nicht möglich.");
  });
});

/** A ZIP archive with a central directory; the entries hold stored text. */
function zip(entries: Readonly<Record<string, string>>): Buffer {
  const locals: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.from(content);
    const fileName = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, fileName, data);
    directory.push(central, fileName);
    offset += local.length + fileName.length + data.length;
  }
  const directoryBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directoryBytes, end]);
}

const DOCX = {
  "[Content_Types].xml": "<Types/>",
  "word/document.xml": "<w:document/>",
};

async function factsOf(content: Buffer): Promise<ChatFileFacts> {
  const probe = new ChatFileProbe();
  for await (const chunk of probe.observe(Readable.from([content])))
    expect(chunk.length).toBeGreaterThan(0);
  return probe.facts();
}

function isSafe(): boolean {
  return true;
}

/** Returns what `classifyChatFile` throws, or `null` when it accepts the file. */
function refusalOf(fileName: string, facts: ChatFileFacts): unknown {
  try {
    classifyChatFile(fileName, facts, isSafe);
  } catch (error: unknown) {
    return error;
  }
  return null;
}

/** Offset of the end-of-directory record of an archive without a comment. */
function endOf(archive: Buffer): number {
  return archive.length - 22;
}

describe("A11.10 g4: deciding the type of an upload from its content", () => {
  it("accepts an Office file whose central directory is intact", async () => {
    const facts = await factsOf(zip(DOCX));
    expect(classifyChatFile("brief.docx", facts, isSafe)).toEqual({
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      isText: false,
    });
  });

  it.each([
    [
      "a text that only carries an Office name",
      () => Buffer.from("Das ist nur Text."),
    ],
    [
      "an archive without any end record",
      () => Buffer.concat([Buffer.from("PK\u0003\u0004"), Buffer.alloc(40)]),
    ],
    [
      "an archive shorter than an end record",
      () => Buffer.concat([Buffer.from("PK\u0003\u0004"), Buffer.alloc(6)]),
    ],
    [
      "an archive that claims ZIP64 entries",
      () => {
        const archive = zip(DOCX);
        archive.writeUInt16LE(0xffff, endOf(archive) + 10);
        return archive;
      },
    ],
    [
      "an archive with more entries than allowed",
      () => {
        const archive = zip(DOCX);
        archive.writeUInt16LE(10_001, endOf(archive) + 10);
        return archive;
      },
    ],
    [
      "an archive whose directory size runs past its end record",
      () => {
        const archive = zip(DOCX);
        archive.writeUInt32LE(0x7fffffff, endOf(archive) + 12);
        return archive;
      },
    ],
    [
      "an archive that names more entries than its directory holds",
      () => {
        const archive = zip(DOCX);
        archive.writeUInt16LE(3, endOf(archive) + 10);
        return archive;
      },
    ],
    [
      "an archive with a damaged directory entry",
      () => {
        const archive = zip(DOCX);
        const start = archive.readUInt32LE(endOf(archive) + 16);
        archive.writeUInt32LE(0, start);
        return archive;
      },
    ],
  ])("refuses %s", async (_name, build) => {
    const error = refusalOf("brief.docx", await factsOf(build()));
    expect(error).toBeInstanceOf(ChatError);
    expect(error).toMatchObject({ code: "fileTypeNotAllowed" });
  });

  it("refuses an archive whose directory lies before the kept tail of the file", async () => {
    const archive = zip(DOCX);
    const facts = await factsOf(archive);
    const truncated: ChatFileFacts = {
      ...facts,
      size: archive.length + 1_000_000,
    };
    expect(refusalOf("brief.docx", truncated)).toMatchObject({
      code: "fileTypeNotAllowed",
    });
  });
});

function textInput(overrides: Partial<TextExecutionInput>): TextExecutionInput {
  return {
    agent: {
      model: "gpt-test",
      reasoningEffort: null,
      connection: {
        isActive: true,
        id: "connection",
        name: "Synthetic",
        provider: "openai",
        hasApiKey: true,
        testModel: null,
        reasoningEffort: null,
        cliLoggedInAt: null,
        cliAccountLabel: null,
        updatedAt: "now",
      },
    },
    prompt: "Frage",
    webSearch: true,
    ...overrides,
  };
}

describe("A11.10 g4: OpenAI search request", () => {
  it("leaves out instruction and reasoning when none are selected", () => {
    const request = createTextProviderRequest("openai", textInput({}));
    expect(request.path).toBe("/responses");
    expect(request.body).toEqual({
      model: "gpt-test",
      input: "Frage",
      tools: [{ type: "web_search" }],
      max_output_tokens: 16_384,
      store: false,
    });
  });

  it("sends instruction and reasoning effort when they are selected", () => {
    const base = textInput({ instructions: "Sei kurz." });
    const request = createTextProviderRequest("openai", {
      ...base,
      agent: { ...base.agent, reasoningEffort: "high" },
    });
    expect(request.body).toMatchObject({
      instructions: "Sei kurz.",
      reasoning: { effort: "high" },
    });
  });
});
