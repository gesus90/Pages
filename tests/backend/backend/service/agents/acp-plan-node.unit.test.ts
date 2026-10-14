import { expect, it, vi } from "vitest";

import { AgentPlanExecution } from "@/backend/agents/AgentPlanExecution";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import { AgentPlanStepRunner } from "@/backend/service/agents/AgentPlanStepRunner";
import {
  DEFAULT_ACP_RUN_OPTIONS,
  acpRunOptions,
} from "@/definition/AgentConfiguration";

import { parameterRunFixture } from "./page55-run-fixture";

import type {
  AgentPlanSessionInput,
  PlanSessionRunner,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanSessionGrant } from "@/backend/service/agents/AgentPlanSessionAccess";
import type { AgentPlanTicketChecklist } from "@/backend/service/agents/AgentPlanTasks";
import type {
  AgentConfiguration,
  AgentRunOptions,
} from "@/definition/AgentConfiguration";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";

// An agent saved without run options; `emptyAgentConfiguration` would name the earlier write mode.
const CONFIGURATION: AgentConfiguration = {
  scope: "person",
  tag: "",
  projectId: null,
  accessMode: "shared",
  directoryParameter: null,
  sharing: { isGlobal: false, targets: [] },
  markdown: "Review ticket:\n{{ticket}}\nDepth {{depth}}, focus {{focus}}.",
  parameters: [
    {
      name: "ticket",
      type: "ticket",
      description: "",
      isRequired: true,
      defaultValue: { type: "ticket", ticketId: "ticket-id" },
    },
    {
      name: "depth",
      type: "number",
      description: "",
      isRequired: true,
      defaultValue: { type: "number", number: 3 },
    },
    {
      name: "focus",
      type: "text",
      description: "",
      isRequired: true,
      defaultValue: { type: "text", text: "security" },
    },
  ],
};

const REPORT = [
  "Done.",
  "```pages-report",
  JSON.stringify({
    todos: [{ id: "T1", status: "done" }],
    criteria: [{ id: "K1", met: true, evidence: "src/review.md lines 1-9" }],
    decisions: [],
    summary: "Reviewed.",
  }),
  "```",
].join("\n");

function checklist(): AgentPlanTicketChecklist {
  return {
    id: "ticket-id",
    key: "SYN-55",
    title: "Synthetic review",
    checklist: {
      items: [
        {
          id: "todo-1",
          source: "description",
          text: "First todo",
          checked: false,
          order: 0,
          depth: 0,
          parentId: null,
        },
        {
          id: "criterion-1",
          source: "criteria",
          text: "Review is complete",
          checked: false,
          order: 1,
          depth: 0,
          parentId: null,
        },
      ],
      contentHash: "content",
      requirementsHash: "requirements",
      markers: new Map(),
      criteria: new Map(),
    },
  };
}

function turn(changes: Partial<PlanSessionTurn> = {}): PlanSessionTurn {
  return {
    output: REPORT,
    sessionId: "thread-synthetic",
    failure: null,
    errorCode: null,
    endedAt: "2026-10-14T10:00:00.000Z",
    permissionDenials: 0,
    effective: { permissionMode: "read_only", model: "synthetic-free:free" },
    events: ["session thread-synthetic"],
    ...changes,
  };
}

interface NodeResult {
  readonly result: Awaited<ReturnType<AgentPlanStepRunner["run"]>>;
  readonly opened: AgentPlanSessionInput;
  readonly grants: AgentPlanSessionGrant[];
  readonly records: AgentPlanSessionRecord[];
  readonly close: ReturnType<typeof vi.fn>;
}

/** The ACP runners; the plan engine treats both the same way. */
const PROVIDERS = [
  { provider: "codex_cli" },
  { provider: "claude_code" },
] as const;

type AcpProvider = (typeof PROVIDERS)[number]["provider"];

async function runNode(
  provider: AcpProvider,
  options: AgentRunOptions | undefined,
  sessionTurn: PlanSessionTurn = turn(),
): Promise<NodeResult> {
  const fixture = await parameterRunFixture(
    { ...CONFIGURATION, ...(options === undefined ? {} : { run: options }) },
    provider,
  );
  const prepared = await fixture.start.prepare(
    fixture.run,
    fixture.snapshot,
    fixture.step,
  );
  const opened: AgentPlanSessionInput[] = [];
  const close = vi.fn(async () => ({
    exit: { code: 0, signal: null },
    endedAt: "2026-10-14T10:01:00.000Z",
    leftovers: 0,
    isConfirmed: true,
  }));
  const cli: PlanSessionRunner = {
    open: async (input, signal, observer) => {
      opened.push(input);
      observer.started({
        mode: "interactive",
        processId: 4242,
        startedAt: "2026-10-14T09:59:00.000Z",
        arguments: [],
        unattended: "ACP session mode read-only",
      });
      observer.identified("thread-synthetic");
      return { turn: Promise.resolve(sessionTurn), close };
    },
  };
  const grants: AgentPlanSessionGrant[] = [];
  const records: AgentPlanSessionRecord[] = [];
  const runner = new AgentPlanStepRunner({
    start: { prepare: async () => prepared },
    execution: new AgentPlanExecution(
      { run: vi.fn() },
      cli,
      new AgentOperationRegistry(),
      { requireUser: async () => {} },
    ),
    tasks: { checklist: async () => checklist() },
    access: {
      grant: async (grant) => {
        grants.push(grant);
        return {
          node: "/synthetic/bin/node",
          bundle: "/synthetic/pages-mcp.cjs",
          url: "http://pages.invalid",
          token: "synthetic-run-token",
          tools: null,
        };
      },
      revoke: async () => 1,
    },
  });
  const result = await runner.run(
    fixture.run,
    fixture.snapshot,
    { ...fixture.step, taskIds: ["ticket-id"] },
    {
      signal: new AbortController().signal,
      save: async (record) => {
        records.push(record);
      },
    },
  );
  const [first] = opened;
  if (!first) throw new Error("The node opened no session.");
  return { result, opened: first, grants, records, close };
}

it.each(PROVIDERS)(
  "sends AGENT.md with its parameters, the node instruction and the read-only contract to the Codex session in the plan workspace ($provider)",
  async ({ provider }) => {
    const node = await runNode(provider, undefined);
    const { prompt } = node.opened;
    expect(node.opened.options).toEqual(DEFAULT_ACP_RUN_OPTIONS);
    expect(node.opened.directory).toBe("/synthetic");
    expect(prompt.startsWith("Review ticket:\n# SYN-55")).toBe(true);
    expect(prompt).toContain("Depth 3, focus security.");
    expect(prompt).not.toMatch(/\{\{(ticket|depth|focus)\}\}/u);
    const instruction = prompt.indexOf("\n\nAdditional instruction\n\n---");
    const contract = prompt.indexOf("## Pages run contract");
    expect(instruction).toBeGreaterThan(0);
    expect(contract).toBeGreaterThan(instruction);
    expect(prompt.split("## Pages run contract")).toHaveLength(2);
    expect(prompt).toContain("This session is read-only");
    expect(prompt).toContain("connected read-only");
    expect(prompt).not.toContain("set_ticket_checklist_item");
    expect(node.grants).toEqual([
      expect.objectContaining({
        reach: "read",
        tickets: [
          { id: "ticket-id", key: "SYN-55", requirementsHash: "requirements" },
        ],
      }),
    ]);
  },
);

it.each(PROVIDERS)(
  "accepts a read-only node on its report alone and keeps run, acceptance and closeout in the record ($provider)",
  async ({ provider }) => {
    const node = await runNode(provider, acpRunOptions("read_only", 0));
    expect(node.result).toMatchObject({ status: "succeeded", error: null });
    const record = node.records.at(-1);
    expect(record).toMatchObject({
      runner: provider,
      mode: "interactive",
      sessionId: "thread-synthetic",
      processId: 4242,
      closeout: "confirmed",
      resultCode: 0,
      requested: {
        runner: provider,
        options: { access: "read_only", shell: false, web: true },
        unattended: "ACP session mode read-only",
        mcp: true,
        directory: "/synthetic",
      },
      effective: { permissionMode: "read_only" },
      acceptance: {
        verdict: "accepted",
        criteria: [
          expect.objectContaining({
            id: "K1",
            met: true,
            ticketChecked: false,
          }),
        ],
      },
    });
    expect(node.close).toHaveBeenCalledTimes(1);
  },
);

it.each(PROVIDERS)(
  "YOLO gets the full Pages reach and still needs the ticket entries checked ($provider)",
  async ({ provider }) => {
    const node = await runNode(
      provider,
      acpRunOptions("yolo", 0),
      turn({ effective: { permissionMode: "yolo" } }),
    );
    expect(node.grants[0]?.reach).toBe("full");
    expect(node.opened.options).toMatchObject({ access: "yolo", shell: true });
    expect(node.opened.prompt).toContain("set_ticket_checklist_item");
    expect(node.opened.prompt).not.toContain("This session is read-only");
    expect(node.result).toMatchObject({
      status: "failed",
      error: "plan_acceptance_failed",
    });
    expect(node.records.at(-1)?.acceptance?.issues).toContain(
      "ticket_unchecked:K1",
    );
  },
);

it.each(PROVIDERS)(
  "fails a node whose adapter refused the stored model with that reason, after closing the session ($provider)",
  async ({ provider }) => {
    const node = await runNode(
      provider,
      acpRunOptions("read_only", 0),
      turn({
        failure: "failed",
        errorCode: "plan_model_unavailable",
        output: "",
      }),
    );
    expect(node.result).toMatchObject({
      status: "failed",
      error: "plan_model_unavailable",
    });
    expect(node.records.at(-1)).toMatchObject({
      acceptance: null,
      resultCode: -1,
      closeout: "confirmed",
    });
    expect(node.close).toHaveBeenCalledTimes(1);
  },
);

it.each(PROVIDERS)(
  "records a stopped Codex session as cancelled and confirmed ($provider)",
  async ({ provider }) => {
    const node = await runNode(
      provider,
      acpRunOptions("read_only", 0),
      turn({ failure: "cancelled", output: "" }),
    );
    expect(node.result).toMatchObject({
      status: "cancelled",
      cancellation: "confirmed",
    });
    expect(node.records.at(-1)?.resultCode).toBe(-1);
  },
);
