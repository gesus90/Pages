import { readMarkdownTasks } from "@/backend/service/task/TicketChecklist";
import { AGENT_STEP_ACTIVITY_LENGTH } from "@/definition/AgentPlanStepProgress";

import {
  nativeProgressInstructions,
  workListLines,
} from "./AgentPlanProgressInstructions";

import type { AgentProviderId } from "@/definition/AgentConnection";
import type {
  AgentPlanCompletion,
  AgentPlanContract,
  AgentPlanContractItem,
} from "@/definition/AgentPlanSession";
import type { AgentPlanCompletionGate } from "@/definition/AgentPlanWork";
import type { AgentPlanTicketChecklist } from "./AgentPlanTasks";
import type { AgentSessionRunBranch } from "@/definition/AgentPlanRunBranch";

/** The criterion of a node whose tickets list no acceptance criteria. */
const DEFAULT_CRITERION =
  "The result is in the workspace and the report names how each todo is proven.";
/** The criterion of a read-only node, which cannot leave a result in the workspace. */
const DEFAULT_READ_ONLY_CRITERION =
  "The closing report answers the instruction and names how each todo is proven.";

/**
 * The evidence text of the report example; a report that keeps it proves nothing.
 * @remarks
 * The example must show the structure without offering a sentence an agent
 * could copy as its proof.
 */
export const REPORT_EVIDENCE_PLACEHOLDER = "<proof>";

/** How a node may work, as far as its contract has to say it. */
export interface AgentPlanContractOptions {
  readonly completionGate?: AgentPlanCompletionGate;
  /**
   * The session changes neither files nor Pages data, as a Codex CLI agent in
   * "Lesend": it reports its tickets instead of setting their entries.
   */
  readonly isReadOnly: boolean;
  /** Which progress details are requested; absent is `report`. */
  readonly completion?: AgentPlanCompletion;
}

/** The run contract text that tells the agent what Pages checks. */
export interface AgentPlanAssignment extends AgentPlanContractOptions {
  readonly contract: AgentPlanContract;
  /** Whether the session reaches Pages through the Pages MCP tools. */
  readonly usesMcp: boolean;
  readonly provider: AgentProviderId;
  readonly runnerLabel: string;
  readonly instanceId: string;
  readonly directory: string;
  /** Every CLI node must pass business acceptance before successors start. */
  readonly requiresAcceptance?: boolean;
  readonly acceptanceScope?: "node" | "group";
  /** The session reaches GitHub through the connection of its project. */
  readonly hasProjectGitHub?: boolean;
  /** The run branch of the workspace, compared with its Git state at the start of this turn. */
  readonly runBranch?: AgentSessionRunBranch;
}

function actualGitText(branch: AgentSessionRunBranch): string {
  const { actual } = branch;
  if (actual.state === "branch") return `\`${actual.branch}\` is checked out`;
  if (actual.state === "detached")
    return `HEAD is detached at \`${actual.commit.slice(0, 12)}\``;
  if (actual.state === "no_repository")
    return "the workspace is no Git repository";
  return "Pages could not read the Git state";
}

/**
 * The run branch line of the contract.
 * @remarks
 * It names the stored target and the state Pages read; Pages never checks a
 * branch out for the agent, so a difference is stated, not repaired.
 */
function runBranchLines(assignment: AgentPlanAssignment): readonly string[] {
  const branch = assignment.runBranch;
  if (!branch) return [];
  if (branch.expected === null)
    return branch.actual.state === "branch"
      ? [
          `Run branch: no preparation of this run set one up; ${actualGitText(branch)}.`,
        ]
      : [];
  const target = `Run branch: \`${branch.expected.branch}\``;
  if (branch.check === "matches") return [`${target} (checked out).`];
  return [
    `${target}, but ${actualGitText(branch)}. Do not switch branches unless the task requires it; name the difference in your report.`,
  ];
}

/**
 * What the mode of the session means for the workspace and the host.
 * @remarks
 * The lines describe the mode the session really runs in; the runner and
 * Pages enforce it, never this text.
 */
function accessLines(
  assignment: Pick<AgentPlanAssignment, "isReadOnly">,
): readonly string[] {
  if (assignment.isReadOnly)
    return [
      '- Mode "Lesend" (read only): read the workspace and any other readable path of the host, but do not create, change or delete files. Commands, sudo included, and host MCP servers are not available.',
    ];
  return [
    "- Mode YOLO: you run natively with the rights of the executing Linux account, your real home folder and its login PATH. The workspace is where you start and where the result belongs, not a boundary: use other paths only as far as the task requires.",
    "- A credential file the task names may be read and used; never copy its content into chat, tickets, wiki, commits, command arguments or logs. Run sudo only when the task requires it, with a password only on standard input (`sudo -S`), never as an argument.",
  ];
}

/** The credential and publication rules of a session with a project connection. */
const PROJECT_GITHUB_LINES = [
  "- GitHub: `printenv PAGES_GITHUB_ACCESS` says what Pages found out about the project connection when this session started. The connection reaches only the repository of this project; do not look for other Git credentials.",
  '- Publish with `sh "$PAGES_GIT_PUBLISH" <branch>` (unset without a usable credential). It accepts `origin` as the project repository or an SSH alias of GitHub for it, pushes HEAD over the project connection without force, pushes nothing when the remote branch already holds HEAD, stops before a push when the remote branch moved, repeats only transport failures, at most three times, and reads the remote branch back. Only its `PUBLISHED` line proves a publication: report everything else as not published and keep your commit and branch. A repeated run after an interruption is safe.',
  "- An authentication or permission failure needs a project manager: do not retry it. Report it as blocked with the message of Git and Pages.",
] as const;

/** The intended way to report a result, for every session that reaches Pages through MCP. */
const STEP_REPORT_LINE =
  "Report your result by calling the Pages MCP tool `report_step_result`: `status` (`done`, or `blocked` when a person has to decide), `message`, `todos` and `criteria` with the IDs above, `decisions` and `summary`. This is the intended way. Pages checks the call at once; when it refuses, correct what `details.problems` names and call again. A valid call is the result of this step, a later call of this attempt replaces it, and it takes precedence over any text in your closing message.";

const MCP_PROGRESS_LINES = [
  `- Report live progress with \`update_step_progress\`: \`plan\` for your own work list, \`todos\` only for the assigned IDs shown above, \`activity\` for one short line on what you do now (up to ${AGENT_STEP_ACTIVITY_LENGTH} characters). Send \`todos: []\` when no assigned todo changes. Reuse the list when continuing the same step.`,
] as const;

/** The work list of an MCP session lives in `update_step_progress`, the same way for every runner. */
const MCP_WORK_LIST_TARGET = {
  tool: "the `plan` field of `update_step_progress` (if you also keep a built-in task list, keep it identical; Pages shows the newest of both)",
  failure:
    "Mark an entry `failed` when it failed or was interrupted and name the reason in `activity`.",
} as const;

const MCP_REPORTING_LINES = [
  "- Report progress, changes and blockers immediately. Mark finished entries `done`. Keep the affected entry `active` during a blockage and name the blocker in `activity`.",
  "- During long work, send a short `activity` update at least every 5 minutes, even if nothing changed.",
  "- Before your final report, update the list one last time. Leave unfinished entries `open` or `failed` and name each one with its reason in the final report.",
] as const;

function progressLines(assignment: AgentPlanAssignment): readonly string[] {
  if (!assignment.usesMcp)
    return nativeProgressInstructions({
      ...assignment,
      ticketCount: assignment.contract.tickets.length,
    }).progress;
  return [
    ...MCP_PROGRESS_LINES,
    ...MCP_REPORTING_LINES,
    ...(!assignment.isReadOnly && assignment.contract.todos.length > 0
      ? [
          "- When you mark an assigned ticket TODO `done` through `update_step_progress`, Pages also checks its ticket checkbox. TODOs requiring lint, check, typecheck, formatting, coverage or full test suites may be marked done with activity `an die Abschluss-QA übergeben` when handed to the final QA step.",
        ]
      : []),
  ];
}

/**
 * The rules of the agent's own work list as a section of their own.
 * @remarks
 * The section stands before the working rules, because the list has to be
 * sent before any command: a rule deep in the working rules was read too late
 * and lists arrived with entries already done or finished in one batch.
 * Empty for a runner without a work list.
 */
function workListSection(assignment: AgentPlanAssignment): readonly string[] {
  const ticketCount = assignment.contract.tickets.length;
  const lines = assignment.usesMcp
    ? workListLines({ ...MCP_WORK_LIST_TARGET, ticketCount })
    : nativeProgressInstructions({ ...assignment, ticketCount }).workList;
  return lines.length > 0 ? ["", "### Your work list", ...lines] : [];
}

function gitHubLines(assignment: AgentPlanAssignment): readonly string[] {
  return assignment.hasProjectGitHub === true ? PROJECT_GITHUB_LINES : [];
}

function completionInstruction(assignment: AgentPlanAssignment): string {
  if (assignment.contract.completionGate)
    return (
      "This node explicitly requires the versioned ticket work gate. Read ticket, checklist and read_ticket_work. Before implementation reuse or create concrete TODOs with real IDs, then save_ticket_work action scope, classifying EVERY current entry: relevant or excluded with a concrete reason. Keep completed foreign work unchanged. Tick actual completed work immediately with current revisions. When requirements change, read and reconcile scope again with a reason; new/unclassified items block completion. Before Review and the final JSON, read fresh ticket/checklist/work; call save_ticket_work action confirm with the saved scope, factual evidence for every relevant completed entry, and each required check's actual command, exitCode 0 and evidence. Required checks: " +
      assignment.contract.completionGate.requiredChecks.join(", ") +
      ". Missing, stale or unproven work fails the node and blocks successors even after exit 0. Keep evidence in these separate metadata calls; preserve the exact final JSON contract of the assignment. Never claim success when confirmation is refused."
    );
  if (assignment.requiresAcceptance)
    return `${assignment.acceptanceScope === "node" ? "This agent node requires business acceptance." : "This is an internal group step."} Complete every todo and criterion and ${assignment.usesMcp ? "report them through `report_step_result`" : "include a valid pages-report"} with the required IDs, done todos, met criteria and real evidence. Missing or invalid reports, open todos, unmet criteria and missing evidence fail this step and block all later steps. Report unfinished work honestly; do not invent completion.`;
  return "Complete the assignment and report unfinished or blocked work honestly. A technical turn completion never establishes business success.";
}

function itemLine(item: AgentPlanContractItem): string {
  const source = item.ticket
    ? ` (ticket ${item.ticket.key}, checklist item \`${item.ticket.itemId}\`)`
    : "";
  return `- **${item.id}**: ${item.text}${source}`;
}

function readOnlyMcpSection(contract: AgentPlanContract): string {
  const keys = contract.tickets.map((ticket) => `\`${ticket.key}\``).join(", ");
  return [
    "- The Pages MCP server lets you read Pages content and report live progress and the final result for this step.",
    ...(keys
      ? [
          `- Read ticket ${keys} with \`read_ticket\` and \`read_ticket_checklist\`. Do not try to change tickets or their checklists; report your progress and leave open entries open.`,
        ]
      : []),
  ].join("\n");
}

function mcpSection(contract: AgentPlanContract): string {
  if (contract.tickets.length === 0)
    return "- The Pages MCP server is connected with the tools your account may use.";
  const keys = contract.tickets.map((ticket) => `\`${ticket.key}\``).join(", ");
  return [
    `- The Pages MCP server is connected for ticket ${keys}. Call \`read_ticket_checklist\` with that ticket ID to read the entries and the current revision.`,
    "- Tick each checklist item as soon as you fulfilled it and can prove it: call `set_ticket_checklist_item` with the ticket ID, the item ID, `checked: true`, the latest revision as `expectedRevision` and a new `operationId`. Never set an item you did not fulfil. After a `CONFLICT`, read the checklist again and reconcile your changes with the current list.",
    "- Pages reads the same entries after your turn: an entry counts only when it is checked in the ticket.",
    "- Ticket edits, new revisions and your own allowed writes do not stop execution. Read the current list again and continue without redoing completed work; keep unfinished items open.",
  ].join("\n");
}

function mcpLines(assignment: AgentPlanAssignment): readonly string[] {
  if (!assignment.usesMcp) return [];
  return [
    assignment.isReadOnly
      ? readOnlyMcpSection(assignment.contract)
      : mcpSection(assignment.contract),
  ];
}

/**
 * Fixes the todo list and the acceptance criteria of a node before it starts.
 * @param instruction - The instruction of the node; its task list items become todos.
 * @param tickets - The tickets bound to the node, with their current checklists.
 * @param options - Whether the node may change anything, and how it completes.
 * @returns Todos, criteria and tickets; an empty work list stays empty.
 * @remarks
 * Task list items of a ticket description are todos, the acceptance criteria
 * of a ticket are also todos. Both keep their checklist item, so the agent sets
 * them through MCP and Pages checks the same entries afterwards; a read-only
 * node only reports them. A node that completes by its todo list has only
 * todos, including ticket criteria; no default todo or criterion is invented.
 */
export function buildPlanContract(
  instruction: string,
  tickets: readonly AgentPlanTicketChecklist[],
  options: AgentPlanContractOptions,
): AgentPlanContract {
  const isTodoList = options.completion === "todos";
  const todos: AgentPlanContractItem[] = readMarkdownTasks(instruction).map(
    (task, index) => ({
      id: `T${index + 1}`,
      text: task.text,
      checked: task.checked,
      ticket: null,
    }),
  );
  const criteria: AgentPlanContractItem[] = [];
  for (const ticket of tickets)
    for (const item of ticket.checklist.items) {
      const reference = { id: ticket.id, key: ticket.key, itemId: item.id };
      todos.push({
        id: `T${todos.length + 1}`,
        text: item.text,
        checked: item.checked,
        ticket: reference,
      });
      if (item.source === "criteria" && !isTodoList)
        criteria.push({
          id: `K${criteria.length + 1}`,
          text: item.text,
          ticket: reference,
        });
    }
  if (!isTodoList && todos.length > 0) addDefaultCriterion(criteria, options);
  return {
    ...(isTodoList ? { completion: "todos" as const } : {}),
    ...(options.completionGate
      ? { completionGate: options.completionGate }
      : {}),
    todos,
    criteria,
    tickets: tickets.map(({ id, key, title, checklist }) => ({
      id,
      key,
      title,
      requirementsHash: checklist.requirementsHash,
    })),
  };
}

function addDefaultCriterion(
  criteria: AgentPlanContractItem[],
  options: AgentPlanContractOptions,
): void {
  if (criteria.length === 0)
    criteria.push({
      id: "K1",
      text: options.isReadOnly
        ? DEFAULT_READ_ONLY_CRITERION
        : DEFAULT_CRITERION,
      ticket: null,
    });
}

function todoMcpLines(assignment: AgentPlanAssignment): readonly string[] {
  const { contract } = assignment;
  if (!assignment.usesMcp) return [];
  const keys = contract.tickets.map((ticket) => `\`${ticket.key}\``).join(", ");
  if (assignment.isReadOnly)
    return [
      "- The Pages MCP server lets you read Pages content and report live progress and the final result for this step.",
      ...(keys
        ? [
            `- Read ticket ${keys} with \`read_ticket\` and \`read_ticket_checklist\`. You cannot change its status or checklist in this mode; name the todos you finished in your closing message.`,
          ]
        : []),
    ];
  if (keys === "")
    return [
      "- The Pages MCP server is connected with the tools your account may use.",
    ];
  return [
    `- The Pages MCP server is connected for ticket ${keys}. Call \`read_ticket\` for its status and the status IDs of its project, and \`read_ticket_checklist\` for the entries and the current revision.`,
    '- Before you start the work, move the ticket to its in-progress status ("In Arbeit") with `set_ticket_status` unless it already has it; `expectedStatusId` is the status you read.',
    "- Read the full assignment, current description, checklist and relevant attachments before planning. Reuse equivalent concrete ticket tasks and add only missing work with the available revision-protected description tools. Preserve acceptance criteria, unrelated work and completed items. If the required ticket writes are unavailable, report the blocker instead of pretending to have created a work list.",
    "- Tick every todo as soon as it is really done, do not wait for the end: `set_ticket_checklist_items` with the ticket ID, `expectedRevision`, `items` of `{itemId, checked: true}` and a new `operationId` (or `set_ticket_checklist_item` for one). Never tick a todo you did not finish. After a `CONFLICT`, read the checklist again and continue with what it holds now.",
    "- If your adapter reports ACP plan activity, begin the title of an actually in-progress ticket task with its exact ticket key, # and checklist ID (for example KEY-12#md-… followed by its text). Pages can then associate that explicit activity with the real entry. A plain title or the first open checkbox does not prove that work is active.",
    '- When every current todo is done, move the ticket to its review status ("Review") the same way. Never set it to done.',
    "- Changes of the ticket by others, new revisions and your own writes do not stop the run: read again, take over the current list and continue without redoing finished work.",
  ];
}

/** The text report remains the way of a session without Pages MCP and the fallback of every other. */
const REPORT_FALLBACK_LEAD =
  "Only if that tool is unavailable, include a fenced pages-report block with a JSON object like this instead:";

function todoReportLead(assignment: AgentPlanAssignment): string {
  if (assignment.usesMcp) return REPORT_FALLBACK_LEAD;
  return assignment.requiresAcceptance
    ? "Include this pages-report block; it is also the record of todos without a ticket entry:"
    : "A pages-report block is optional and only shown. It is the only record of a todo without a ticket entry:";
}

function reportLead(assignment: AgentPlanAssignment): string {
  if (assignment.usesMcp) return REPORT_FALLBACK_LEAD;
  return assignment.requiresAcceptance
    ? "Include a fenced pages-report block with a JSON object like this:"
    : "You may include a fenced pages-report block with a JSON object like this to describe progress:";
}

function renderTodoAssignment(assignment: AgentPlanAssignment): string {
  const { contract } = assignment;
  const tickets = contract.tickets.map(
    (ticket) => `- ${ticket.key} (ID \`${ticket.id}\`)`,
  );
  const example = JSON.stringify({
    todos: contract.todos
      .filter((todo) => !todo.checked)
      .map((todo) => ({ id: todo.id, status: "open" })),
    decisions: [],
    summary: "<one sentence>",
  });
  return [
    "---",
    "## Pages run contract",
    `Runner: ${assignment.runnerLabel} · session instance \`${assignment.instanceId}\``,
    `Workspace: \`${assignment.directory}\``,
    ...runBranchLines(assignment),
    ...(tickets.length > 0 ? ["", "### Tickets", ...tickets] : []),
    "",
    "### Todo list",
    ...(contract.todos.some((todo) => !todo.checked)
      ? contract.todos.filter((todo) => !todo.checked).map(itemLine)
      : ["- No assigned TODOs are open. Work on the instruction above."]),
    ...workListSection(assignment),
    "",
    "### How to work",
    completionInstruction(assignment),
    "- Nobody answers questions during this run: when a choice is needed, take the recommended option, otherwise decide yourself and name the decision in your closing message.",
    ...accessLines(assignment),
    ...todoMcpLines(assignment),
    ...progressLines(assignment),
    ...gitHubLines(assignment),
    "",
    "### Closing message",
    "Finish with a short summary: the todos you completed, the todos that stay open and why, and your decisions. Pages shows ticket todos as they are checked after your turn.",
    ...(assignment.usesMcp ? [STEP_REPORT_LINE] : []),
    todoReportLead(assignment),
    "```pages-report",
    example,
    "```",
  ].join("\n");
}

/**
 * Renders the run contract that Pages appends to the resolved prompt of a CLI node.
 * @param assignment - Contract, MCP use, read-only mode, runner, instance and workspace of the node.
 * @returns Markdown with the todos, criteria, working rules and the closing report format.
 * @remarks
 * Nobody answers questions during a run, so the agent is told to decide on
 * its own and to report its decisions. The text never contains a credential.
 */
export function renderPlanAssignment(assignment: AgentPlanAssignment): string {
  const { contract } = assignment;
  if (contract.completion === "todos") return renderTodoAssignment(assignment);
  const tickets = contract.tickets.map(
    (ticket) => `- ${ticket.key} (ID \`${ticket.id}\`)`,
  );
  const example = JSON.stringify({
    todos: contract.todos
      .filter((todo) => !todo.checked)
      .map((todo) => ({ id: todo.id, status: "open" })),
    criteria: contract.criteria.map((criterion) => ({
      id: criterion.id,
      met: false,
      evidence: REPORT_EVIDENCE_PLACEHOLDER,
    })),
    decisions: [],
    summary: "<one sentence>",
  });
  return [
    "---",
    "## Pages run contract",
    `Runner: ${assignment.runnerLabel} · session instance \`${assignment.instanceId}\``,
    `Workspace: \`${assignment.directory}\``,
    ...runBranchLines(assignment),
    ...(tickets.length > 0 ? ["", "### Tickets", ...tickets] : []),
    "",
    "### Todo list",
    ...(contract.todos.filter((todo) => !todo.checked).length
      ? contract.todos.filter((todo) => !todo.checked).map(itemLine)
      : ["- Keine offenen TODOs."]),
    "",
    "### Acceptance criteria",
    ...contract.criteria.map(itemLine),
    ...workListSection(assignment),
    "",
    "### How to work",
    "- Nobody answers questions during this run: when a choice is needed, take the recommended option, otherwise decide yourself and list the decision in the report.",
    ...accessLines(assignment),
    ...mcpLines(assignment),
    ...progressLines(assignment),
    ...gitHubLines(assignment),
    "",
    "### Closing message and optional progress report",
    "Summarize completed and open work honestly, including missing evidence and your decisions.",
    completionInstruction(assignment),
    ...(assignment.usesMcp ? [STEP_REPORT_LINE] : []),
    reportLead(assignment),
    "```pages-report",
    example,
    "```",
    'Refer to todos and criteria by their IDs. Use `status: "done"` only for completed work and `met: true` only for a fulfilled criterion; replace `<proof>` with real evidence or leave evidence empty when unknown. Keep open work open.',
  ].join("\n");
}
