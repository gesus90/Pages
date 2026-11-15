import { describe, expect, it } from "vitest";

import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { bridgeToolDetails } from "@/backend/service/chat/acp/PicaBridgeToolEvents";
import { PicaPlanConfirmation } from "@/backend/service/chat/PicaPlanConfirmation";
import {
  createAgentToolkitJob,
  guardPagesOperation,
  isConsequentialOperation,
} from "@/backend/service/chat/toolkit/AgentToolkit";
import { isConsequentialCommand } from "@/backend/service/chat/toolkit/AgentShellTools";
import { htmlToText, parseSearchResults } from "@/backend/service/chat/toolkit/AgentWebText";
import { AgentAccessLevelChanges } from "@/backend/service/employee/AgentAccessLevelChanges";
import { createAgentEmployeeInstructions } from "@/backend/service/employee/AgentEmployeeInstructions";
import { readAgentEmployeeInput } from "@/backend/service/employee/AgentEmployeeInput";
import { foldToolCalls } from "@/backend/service/employee/AgentToolCallView";
import { readChatJobEvent } from "@/definition/ChatJobReader";
import {
  agentToolPolicy,
  enablesAgentToolGroup,
  readAgentToolGroups,
} from "@/definition/AgentToolGroups";

import { callContext } from "./page390-toolkit-world";

import type { UserPolicyService } from "@/backend/auth/UserPolicyService";
import type { AccountAccess } from "@/definition/Authorization";

describe("PAGE-390 policy of the access levels", () => {
  it("gives Nur Lesen only reading groups and no shell, and full access every group", () => {
    expect(agentToolPolicy("read_only")).toEqual({
      shell: "off",
      files: "read",
      web: "read",
      browser: "read",
      pages: "read",
      chat: "full",
    });
    for (const access of ["workspace", "yolo"] as const)
      expect(Object.values(agentToolPolicy(access))).toEqual(
        Array(6).fill("full"),
      );
  });

  it("switches single groups off per agent", () => {
    expect(agentToolPolicy("workspace", ["browser"])).toMatchObject({
      browser: "off",
      web: "full",
    });
    expect(readAgentToolGroups(["web", "browser", "web"])).toEqual([
      "web",
      "browser",
    ]);
    expect(readAgentToolGroups(["mail"])).toBeNull();
    expect(readAgentToolGroups(undefined)).toEqual([]);
    expect(enablesAgentToolGroup(["browser"], [])).toBe(true);
    expect(enablesAgentToolGroup([], ["browser"])).toBe(false);
  });

  it("reads the switched-off groups from the agent panel", () => {
    const input = readAgentEmployeeInput({
      displayName: "Ada",
      username: "ada",
      roleId: "role",
      connectionId: "connection",
      model: "model",
      access: "workspace",
      disabledToolGroups: ["browser", "shell"],
    });
    expect(input.settings.disabledToolGroups).toEqual(["shell", "browser"]);
    expect(() =>
      readAgentEmployeeInput({
        displayName: "Ada",
        username: "ada",
        roleId: "role",
        connectionId: "connection",
        model: "model",
        access: "workspace",
        disabledToolGroups: ["everything"],
      }),
    ).toThrow(AgentEmployeeError);
  });

  it("lets only an administrator switch a disabled group on again", () => {
    const changes = (hasGlobalAccess: boolean): AgentAccessLevelChanges =>
      new AgentAccessLevelChanges(
        { hasGlobalAccess: () => hasGlobalAccess } as unknown as UserPolicyService,
        {} as never,
        undefined,
      );
    const actor = {} as AccountAccess;
    expect(() =>
      changes(false).requireToolGroupChange(actor, [], ["browser"]),
    ).not.toThrow();
    expect(() =>
      changes(false).requireToolGroupChange(actor, ["browser"], []),
    ).toThrow(AgentEmployeeError);
    expect(() =>
      changes(true).requireToolGroupChange(actor, ["browser"], []),
    ).not.toThrow();
  });
});

describe("PAGE-390 guards of Pages operations", () => {
  const job = createAgentToolkitJob({
    agentId: "agent-1",
    root: "/tmp",
    policy: agentToolPolicy("read_only"),
    isIsolated: true,
  });
  const turn = { id: "message-1", message: "Bitte" };

  it("refuses every Pages write in Nur Lesen, whatever tool reaches it", () => {
    for (const operation of [
      "ticket.create",
      "plans.update",
      "automations.create",
      "calendar.event.create",
    ])
      expect(
        guardPagesOperation(
          { job, approvals: new PicaPlanConfirmation() },
          { operation, parameters: {}, context: callContext(), turn },
        ),
      ).toMatchObject({ ok: false, error: "READ_ONLY_ACCESS" });
    expect(
      guardPagesOperation(
        { job, approvals: new PicaPlanConfirmation() },
        {
          operation: "tickets.search",
          parameters: {},
          context: callContext(),
          turn,
        },
      ),
    ).toBeNull();
  });

  it("names deleting and archiving as consequential, not their previews", () => {
    expect(isConsequentialOperation("ticket.delete", {})).toBe(true);
    expect(isConsequentialOperation("wiki.page.delete", {})).toBe(true);
    expect(isConsequentialOperation("ticket.archive", {})).toBe(false);
    expect(
      isConsequentialOperation("ticket.archive", { confirmed: true }),
    ).toBe(true);
    expect(
      isConsequentialOperation("calendar.event.delete", { confirmed: true }),
    ).toBe(true);
    expect(isConsequentialOperation("ticket.create", {})).toBe(false);
  });

  it("names deleting, sending out, publishing and paying commands as consequential", () => {
    for (const command of [
      "rm -rf build",
      "git push origin main",
      "curl -X POST https://api.example.com/pay",
      "echo hi | mail igor@example.com",
      "scp a.txt host:/tmp",
      "npm publish",
      "cd x && find . -name '*.log' -delete",
    ])
      expect(isConsequentialCommand(command)).toBe(true);
    for (const command of [
      "ls -la",
      "cat README.md",
      "git status",
      "curl https://example.com",
      "pnpm test",
      "grep -r term .",
    ])
      expect(isConsequentialCommand(command)).toBe(false);
  });
});

describe("PAGE-390 web text", () => {
  it("reads the hits of a search page and keeps page text readable", () => {
    const html = `
      <div class="result results_links web-result"><div class="links_main result__body">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fpages.example%2Fdocs&amp;rut=x">Pages <b>Docs</b></a>
        <a class="result__snippet" href="#">Self-hosted &amp; simple.</a>
      </div></div>`;
    expect(parseSearchResults(html, 5)).toEqual([
      {
        title: "Pages Docs",
        url: "https://pages.example/docs",
        snippet: "Self-hosted & simple.",
      },
    ]);
    expect(
      htmlToText("<script>alert(1)</script><p>Eins</p><ul><li>A</li></ul>"),
    ).toBe("Eins\n\n- A");
  });
});

describe("PAGE-390 tool line", () => {
  it("shows each bridge call with short description, masked input, output and duration", () => {
    const details = bridgeToolDetails({
      catalog: [
        {
          id: "datei_lesen",
          description: "Read a text file of your working folder. More text.",
          access: "user",
          inputSchema: {},
        },
      ],
      tool: "datei_lesen",
      input: { path: "env.txt", token: "Bearer abcdefghijklmnop" },
      isPrivileged: false,
      outcome: { result: JSON.stringify({ content: "password=supersecret1" }) },
      durationMs: 42,
    });
    expect(details.summary).toBe("Read a text file of your working folder.");
    expect(details.durationMs).toBe(42);
    expect(details.input).toContain("env.txt");
    expect(details.input).not.toContain("abcdefghijklmnop");
    expect(details.output).not.toContain("supersecret1");
    expect(details.output).toContain("[redacted]");
    const privileged = bridgeToolDetails({
      catalog: [],
      tool: "admin_users_list",
      input: { query: "x" },
      isPrivileged: true,
      durationMs: 3,
    });
    expect(privileged).toEqual({ durationMs: 3 });
  });

  it("keeps summary and duration through the journal into the stored tool calls", () => {
    const event = readChatJobEvent({
      kind: "tool",
      callId: "call-1",
      tool: "shell_ausfuehren",
      status: "completed",
      error: null,
      input: "ls",
      output: "a.txt",
      summary: "Run a shell command (sh -c) in your working folder.",
      durationMs: 1234.4,
    });
    expect(event).toMatchObject({ summary: expect.any(String), durationMs: 1234 });
    const view = foldToolCalls([{ sequence: 1, event }]);
    expect(view.current).toEqual([
      expect.objectContaining({
        name: "shell_ausfuehren",
        summary: "Run a shell command (sh -c) in your working folder.",
        durationMs: 1234,
        input: "ls",
        output: "a.txt",
      }),
    ]);
  });
});

describe("PAGE-390 instruction", () => {
  it("names the toolkit with each group's mode and tells the agent to say when a tool is missing", () => {
    const text = createAgentEmployeeInstructions({
      name: "Ada",
      position: null,
      roleName: null,
      soul: "",
      instructions: "",
      memory: "",
      dream: "",
      related: [],
      access: "workspace",
      toolPolicy: agentToolPolicy("workspace", ["browser"]),
      personName: "Igor",
    });
    expect(text).toContain("Werkzeugkasten von Pages");
    expect(text).toMatch(/Browser \([^)]*\): nicht verfügbar/u);
    expect(text).toMatch(/Shell \([^)]*\): voll/u);
    expect(text).toContain("CONFIRMATION_REQUIRED");
    expect(text).toContain("dass es dir fehlt");
  });
});
