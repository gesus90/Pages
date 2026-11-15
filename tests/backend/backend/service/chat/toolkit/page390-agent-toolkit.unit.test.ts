import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { closeAgentToolkitJob } from "@/backend/service/chat/toolkit/AgentToolkit";

import {
  callContext,
  resultOf,
  toolkitWorld,
  workingFolder,
} from "./page390-toolkit-world";

import type * as LoggerModule from "@/backend/logging/Logger";

import type { ToolkitWorld } from "./page390-toolkit-world";

// Never start the independent MCP plan catalog in the Pages unit scope.
vi.mock("@/backend/service/chat/PicaPlanTools", () => ({
  registerPicaPlanTools: vi.fn(),
}));

const logged = vi.hoisted(() => [] as unknown[]);
vi.mock("@/backend/logging/Logger", async (original) => ({
  ...(await original<typeof LoggerModule>()),
  logEvent: (entry: unknown) => logged.push(entry),
}));

const worlds: ToolkitWorld[] = [];

async function world(
  options: Parameters<typeof toolkitWorld>[0],
): Promise<ToolkitWorld> {
  const created = toolkitWorld(options);
  worlds.push(created);
  return created;
}

afterEach(async () => {
  for (const created of worlds.splice(0))
    await closeAgentToolkitJob(created.job);
  logged.splice(0);
});

const FIRST = { id: "message-1", text: "Bitte erledige das." };
const APPROVAL = { id: "message-2", text: "Ja, bitte." };

function ids(registry: ReturnType<ToolkitWorld["turn"]>): string[] {
  return registry.describe().map((tool) => tool.id);
}

describe("PAGE-390 toolkit with full access (Arbeitsplatz/YOLO)", () => {
  it("runs a shell command, changes a file, fetches a page, opens the browser and creates a ticket over the bridge", async () => {
    const root = await workingFolder();
    const { turn, run, browser } = await world({ root, access: "workspace" });
    const tools = turn(FIRST);
    const context = callContext();

    const shell = await tools.invoke(
      "shell_ausfuehren",
      { command: "printf 'Hallo Welt\\n' > notiz.txt && cat notiz.txt" },
      context,
    );
    expect(shell?.isValid).toBe(true);
    expect(resultOf(shell?.output)).toMatchObject({
      state: "exited",
      exitCode: 0,
      output: "Hallo Welt\n",
    });

    const edit = await tools.invoke(
      "datei_aendern",
      { path: "notiz.txt", oldText: "Welt", newText: "Pages" },
      context,
    );
    expect(resultOf(edit?.output)).toMatchObject({ replaced: 1 });
    expect(await readFile(path.join(root, "notiz.txt"), "utf8")).toBe(
      "Hallo Pages\n",
    );

    const page = await tools.invoke(
      "web_abrufen",
      { url: "https://example.com/" },
      context,
    );
    expect(resultOf(page?.output)).toMatchObject({
      title: "Example Domain",
      text: "Example\n\nHello & welcome.",
    });

    const opened = await tools.invoke(
      "browser_open",
      { task: "Seite ansehen", url: "https://example.com/" },
      context,
    );
    expect(opened?.isValid).toBe(true);
    expect(browser).toHaveBeenCalledWith(
      "browser_open",
      { task: "Seite ansehen", url: "https://example.com/" },
      expect.anything(),
    );

    const ticket = await tools.invoke(
      "tickets_create",
      {
        projectId: "project-1",
        type: "task",
        title: "Neues Ticket",
        description: "",
        statusId: null,
        parentId: null,
      },
      context,
    );
    expect(resultOf(ticket?.output)).toMatchObject({ key: "PAGE-1" });
    expect(run).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({ operation: "ticket.create" }),
      null,
    );
  });

  it("offers the same toolkit catalog for YOLO", async () => {
    const root = await workingFolder();
    const { turn } = await world({ root, access: "yolo" });
    expect(ids(turn(FIRST))).toEqual(
      expect.arrayContaining([
        "shell_ausfuehren",
        "shell_status",
        "datei_schreiben",
        "datei_aendern",
        "web_suchen",
        "web_abrufen",
        "browser_click",
        "tickets_create",
      ]),
    );
  });
});

describe("PAGE-390 background shell commands", () => {
  it("runs long commands in the background and reports output and end", async () => {
    const root = await workingFolder();
    const { turn } = await world({ root, access: "yolo" });
    const tools = turn(FIRST);
    const started = await tools.invoke(
      "shell_ausfuehren",
      { command: "echo eins; sleep 0.2; echo zwei", background: true },
      callContext(),
    );
    const { jobId } = resultOf(started?.output) as { jobId: string };
    let status: Record<string, unknown> = {};
    for (let attempt = 0; attempt < 50; attempt += 1) {
      status = resultOf(
        (await tools.invoke("shell_status", { jobId }, callContext()))?.output,
      );
      if (status.state !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(status).toMatchObject({
      state: "exited",
      exitCode: 0,
      output: "eins\nzwei\n",
    });
  });
});

describe("PAGE-390 toolkit in Nur Lesen", () => {
  it("reads and searches files, the web, the browser and Pages but offers no writing tool", async () => {
    const root = await workingFolder();
    await writeFile(
      path.join(root, "bericht.md"),
      "Umsatz steigt\nKosten fallen\n",
    );
    const { turn } = await world({ root, access: "read_only" });
    const tools = turn(FIRST);
    const offered = ids(tools);
    expect(offered).toEqual(
      expect.arrayContaining([
        "datei_lesen",
        "ordner_auflisten",
        "dateien_suchen",
        "web_suchen",
        "web_abrufen",
        "browser_open",
        "browser_observe",
        "tickets_search",
      ]),
    );
    for (const write of [
      "shell_ausfuehren",
      "shell_status",
      "datei_schreiben",
      "datei_aendern",
      "datei_loeschen",
      "browser_click",
      "browser_type",
      "browser_form",
      "tickets_create",
      "tickets_delete",
      "calendar_event_create",
    ])
      expect(offered).not.toContain(write);

    const search = await tools.invoke(
      "dateien_suchen",
      { text: "Kosten" },
      callContext(),
    );
    expect(resultOf(search?.output)).toMatchObject({
      matches: [{ path: "bericht.md", line: 2, text: "Kosten fallen" }],
    });
    expect(
      await tools.invoke(
        "datei_schreiben",
        { path: "x.txt", content: "x" },
        callContext(),
      ),
    ).toBeNull();
  });
});

describe("PAGE-390 consequential steps", () => {
  it("asks in the chat before a deleting shell command and runs it after the person's approval", async () => {
    const root = await workingFolder();
    await writeFile(path.join(root, "alt.txt"), "weg");
    const { turn } = await world({ root, access: "workspace" });
    const call = { command: "rm alt.txt" };
    const asked = await turn(FIRST).invoke(
      "shell_ausfuehren",
      call,
      callContext(),
    );
    expect(asked?.output).toMatchObject({
      ok: false,
      error: "CONFIRMATION_REQUIRED",
    });
    await expect(readFile(path.join(root, "alt.txt"), "utf8")).resolves.toBe(
      "weg",
    );
    const approved = await turn(APPROVAL).invoke(
      "shell_ausfuehren",
      call,
      callContext("run-2"),
    );
    expect(resultOf(approved?.output)).toMatchObject({ exitCode: 0 });
    await expect(readFile(path.join(root, "alt.txt"))).rejects.toThrow();
  });

  it("holds a Pages deletion until the person approves it in a later message", async () => {
    const root = await workingFolder();
    const { turn, run } = await world({ root, access: "workspace" });
    const asked = await turn(FIRST).invoke(
      "tickets_delete",
      { ticketId: "ticket-1" },
      callContext(),
    );
    expect(asked?.output).toMatchObject({ error: "CONFIRMATION_REQUIRED" });
    expect(run).not.toHaveBeenCalled();
    const again = await turn(FIRST).invoke(
      "tickets_delete",
      { ticketId: "ticket-1" },
      callContext(),
    );
    expect(again?.output).toMatchObject({ error: "CONFIRMATION_REQUIRED" });
    await turn(APPROVAL).invoke(
      "tickets_delete",
      { ticketId: "ticket-1" },
      callContext("run-2"),
    );
    expect(run).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({ operation: "ticket.delete" }),
      null,
    );
  });

  it("asks before a browser form is submitted", async () => {
    const root = await workingFolder();
    const { turn, browser } = await world({ root, access: "workspace" });
    const asked = await turn(FIRST).invoke(
      "browser_form",
      {
        browserId: "6f1c2b8e-4a3d-4f5e-9b7a-1c2d3e4f5a6b",
        fields: [{ ref: "e2", text: "Igor" }],
        submit: "e5",
      },
      callContext(),
    );
    expect(asked?.output).toMatchObject({ error: "CONFIRMATION_REQUIRED" });
    expect(browser).not.toHaveBeenCalled();
  });
});

describe("PAGE-390 tool groups per agent", () => {
  it("neither lists nor runs a switched-off group", async () => {
    const root = await workingFolder();
    const { turn, browser, readPage } = await world({
      root,
      access: "workspace",
      disabled: ["browser", "web", "shell"],
    });
    const tools = turn(FIRST);
    const offered = ids(tools);
    for (const tool of [
      "browser_open",
      "web_abrufen",
      "web_suchen",
      "shell_ausfuehren",
    ])
      expect(offered).not.toContain(tool);
    expect(offered).toContain("datei_lesen");
    expect(offered).toContain("tickets_create");
    expect(
      await tools.invoke(
        "web_abrufen",
        { url: "https://example.com" },
        callContext(),
      ),
    ).toBeNull();
    expect(browser).not.toHaveBeenCalled();
    expect(readPage).not.toHaveBeenCalled();
  });

  it("refuses a Pages write through the operation catalog when the Pages group only reads", async () => {
    const root = await workingFolder();
    const { turn, run } = await world({
      root,
      access: "read_only",
    });
    // calendar_read stays; a write would be refused even if it were listed.
    expect(ids(turn(FIRST))).toContain("calendar_read");
    expect(run).not.toHaveBeenCalled();
  });
});

describe("PAGE-390 working folder roots", () => {
  it("refuses paths outside the working folder, also through a link", async () => {
    const root = await workingFolder();
    const outside = await workingFolder();
    await writeFile(path.join(outside, "geheim.txt"), "geheim");
    await symlink(outside, path.join(root, "link"));
    await mkdir(path.join(root, "sub"));
    const { turn } = await world({ root, access: "workspace" });
    const tools = turn(FIRST);
    for (const target of [
      "../geheim.txt",
      path.join(outside, "geheim.txt"),
      "link/geheim.txt",
      "/etc/passwd",
    ]) {
      const read = await tools.invoke(
        "datei_lesen",
        { path: target },
        callContext(),
      );
      expect(read?.output).toMatchObject({
        ok: false,
        error: "OUTSIDE_WORKSPACE",
      });
    }
    const write = await tools.invoke(
      "datei_schreiben",
      { path: "link/neu.txt", content: "x" },
      callContext(),
    );
    expect(write?.output).toMatchObject({ error: "OUTSIDE_WORKSPACE" });
    await expect(readFile(path.join(outside, "neu.txt"))).rejects.toThrow();
    const inside = await tools.invoke(
      "datei_schreiben",
      { path: "sub/neu.txt", content: "ok" },
      callContext(),
    );
    expect(inside?.output).toMatchObject({ ok: true });
  });

  it("refuses an Arbeitsplatz shell command when the isolation is missing", async () => {
    const root = await workingFolder();
    const { createAgentShellLauncher } =
      await import("@/backend/service/chat/toolkit/AgentShellLauncher");
    const launcher = createAgentShellLauncher(true, {
      probe: async () => false,
    });
    expect(await launcher("echo hi", root)).toBeNull();
    const isolated = await createAgentShellLauncher(true, {
      probe: async () => true,
    })("echo hi", root);
    expect(isolated?.file).toBe("/usr/bin/bwrap");
    expect(isolated?.args).toEqual(
      expect.arrayContaining(["--ro-bind", "/", "/", "--bind", root, root]),
    );
    expect(isolated?.env).not.toHaveProperty("PAGES_GITHUB_ACCESS");
  });
});

describe("PAGE-390 credentials and audit", () => {
  it("masks credentials in results and records every call with agent, chat, tool, time and result", async () => {
    const root = await workingFolder();
    await writeFile(
      path.join(root, "env.txt"),
      "api_key=sk-abcdefghijklmnopqrstuvwx\n",
    );
    const { turn } = await world({ root, access: "workspace" });
    const read = await turn(FIRST).invoke(
      "datei_lesen",
      { path: "env.txt" },
      callContext(),
    );
    const text = JSON.stringify(read?.output);
    expect(text).not.toContain("sk-abcdefghijklmnopqrstuvwx");
    expect(text).toContain("[redacted]");
    const audit = logged.find(
      (
        entry,
      ): entry is {
        readonly event: string;
        readonly metadata: {
          readonly agentId: string;
          readonly sessionId: string;
          readonly tool: string;
          readonly result: string;
          readonly at: unknown;
          readonly durationMs: unknown;
        };
      } =>
        typeof entry === "object" &&
        entry !== null &&
        "event" in entry &&
        entry.event === "agent.tool.call",
    );
    expect(audit?.metadata).toMatchObject({
      agentId: "agent-1",
      sessionId: "chat-1",
      tool: "datei_lesen",
      result: "ok",
    });
    expect(typeof audit?.metadata.at).toBe("string");
    expect(typeof audit?.metadata.durationMs).toBe("number");
  });
});
