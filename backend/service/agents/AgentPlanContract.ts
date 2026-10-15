import { readMarkdownTasks } from "@/backend/service/task/TicketChecklist";

import type {
  AgentPlanCompletion,
  AgentPlanContract,
  AgentPlanContractItem,
} from "@/definition/AgentPlanSession";
import type { AgentPlanTicketChecklist } from "./AgentPlanTasks";

/** The todo of a node whose instruction and tickets list none. */
const DEFAULT_TODO = "Carry out the instruction of this node completely.";
/** The criterion of a node whose tickets list no acceptance criteria. */
const DEFAULT_CRITERION =
  "The result is in the workspace and the report names how each todo is proven.";
/** The criterion of a read-only node, which cannot leave a result in the workspace. */
const DEFAULT_READ_ONLY_CRITERION =
  "The closing report answers the instruction and names how each todo is proven.";

/**
 * The evidence text of the report example; a report that keeps it proves nothing.
 *
 * @remarks
 * The example must show the structure without offering a sentence an agent
 * could copy as its proof.
 */
export const REPORT_EVIDENCE_PLACEHOLDER = "<proof>";

/** How a node may work, as far as its contract has to say it. */
export interface AgentPlanContractOptions {
  /**
   * The session changes neither files nor Pages data, as a Codex CLI agent in
   * "Nur Lesen": it reports its tickets instead of setting their entries.
   */
  readonly isReadOnly: boolean;
  /** How the node is judged; absent is `report`. */
  readonly completion?: AgentPlanCompletion;
}

/** The run contract text that tells the agent what Pages checks. */
export interface AgentPlanAssignment extends AgentPlanContractOptions {
  readonly contract: AgentPlanContract;
  /** Whether the session reaches Pages through the Pages MCP tools. */
  readonly usesMcp: boolean;
  readonly runnerLabel: string;
  readonly instanceId: string;
  readonly directory: string;
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
    "- The Pages MCP server is connected read-only: you may read Pages content, every change is refused.",
    ...(keys
      ? [
          `- Read ticket ${keys} with \`read_ticket\` and \`read_ticket_checklist\`. Do not try to change tickets or their checklists; Pages records the acceptance from your closing report.`,
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
    "- For every listed checklist item you fulfilled and can prove, call `set_ticket_checklist_item` with the ticket ID, the item ID, `checked: true`, the latest revision as `expectedRevision` and a new `operationId`. Never set an item you did not fulfil. After a `CONFLICT`, read the checklist again.",
    "- Pages reads the same entries after your turn: an entry counts only when it is checked in the ticket.",
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
 *
 * @param instruction - The instruction of the node; its task list items become todos.
 * @param tickets - The tickets bound to the node, with their current checklists.
 * @param options - Whether the node may change anything, and how it completes.
 * @returns Todos, criteria and tickets; a node without any gets one default each.
 *
 * @remarks
 * Task list items of a ticket description are todos, the acceptance criteria
 * of a ticket are criteria. Both keep their checklist item, so the agent sets
 * them through MCP and Pages checks the same entries afterwards; a read-only
 * node only reports them. A node that completes by its todo list has only
 * todos: the criteria of its tickets are not part of its contract, and no
 * default todo or criterion is invented.
 */
export function buildPlanContract(
  instruction: string,
  tickets: readonly AgentPlanTicketChecklist[],
  options: AgentPlanContractOptions,
): AgentPlanContract {
  const isTodoList = options.completion === "todos";
  const todos: AgentPlanContractItem[] = readMarkdownTasks(instruction).map(
    (task, index) => ({ id: `T${index + 1}`, text: task.text, ticket: null }),
  );
  const criteria: AgentPlanContractItem[] = [];
  for (const ticket of tickets)
    for (const item of ticket.checklist.items) {
      const reference = { id: ticket.id, key: ticket.key, itemId: item.id };
      if (item.source === "description")
        todos.push({
          id: `T${todos.length + 1}`,
          text: item.text,
          ticket: reference,
        });
      else if (!isTodoList)
        criteria.push({
          id: `K${criteria.length + 1}`,
          text: item.text,
          ticket: reference,
        });
    }
  if (!isTodoList) addDefaults(todos, criteria, options);
  return {
    ...(isTodoList ? { completion: "todos" as const } : {}),
    todos,
    criteria,
    tickets: tickets.map(({ id, key, checklist }) => ({
      id,
      key,
      requirementsHash: checklist.requirementsHash,
    })),
  };
}

function addDefaults(
  todos: AgentPlanContractItem[],
  criteria: AgentPlanContractItem[],
  options: AgentPlanContractOptions,
): void {
  if (todos.length === 0)
    todos.push({ id: "T1", text: DEFAULT_TODO, ticket: null });
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
      "- The Pages MCP server is connected read-only: you may read Pages content, every change is refused.",
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
    "- Tick every todo as soon as it is really done, do not wait for the end: `set_ticket_checklist_items` with the ticket ID, `expectedRevision`, `items` of `{itemId, checked: true}` and a new `operationId` (or `set_ticket_checklist_item` for one). Never tick a todo you did not finish. After a `CONFLICT`, read the checklist again and continue with what it holds now.",
    '- When every current todo is done, move the ticket to its review status ("Review") the same way. Never set it to done.',
    "- Changes of the ticket by others, new revisions and your own writes do not stop the run: read again, take over the current list and continue without redoing finished work.",
  ];
}

function renderTodoAssignment(assignment: AgentPlanAssignment): string {
  const { contract } = assignment;
  const tickets = contract.tickets.map(
    (ticket) => `- ${ticket.key} (ID \`${ticket.id}\`)`,
  );
  const example = JSON.stringify({
    todos: contract.todos.map((todo) => ({ id: todo.id, status: "done" })),
    decisions: [],
    summary: "<one sentence>",
  });
  return [
    "---",
    "## Pages run contract",
    `Runner: ${assignment.runnerLabel} · session instance \`${assignment.instanceId}\``,
    `Workspace: \`${assignment.directory}\``,
    ...(tickets.length > 0 ? ["", "### Tickets", ...tickets] : []),
    "",
    "### Todo list",
    ...(contract.todos.length > 0
      ? contract.todos.map(itemLine)
      : ["- The ticket lists no todo; the instruction above is the work."]),
    "",
    "### How to work",
    "- Only the current todo list counts. Acceptance criteria, criterion evidence and a criteria report are not requested or checked; ignore any earlier text that asks for them.",
    "- Work only in the workspace. Nobody answers questions during this run: when a choice is needed, take the recommended option, otherwise decide yourself and name the decision in your closing message.",
    ...(assignment.isReadOnly
      ? [
          "- This session is read-only: read the workspace, but do not create, change or delete files. Commands are not available.",
        ]
      : []),
    ...todoMcpLines(assignment),
    "",
    "### Closing message",
    "Finish with a short summary: the todos you completed, the todos that stay open and why, and your decisions. Pages shows the todos as they are checked in the ticket after your turn; open ones stay open and do not fail the node.",
    "A `pages-report` block is optional and only shown. It is the only record of a todo without a ticket entry:",
    "```pages-report",
    example,
    "```",
  ].join("\n");
}

/**
 * Renders the run contract that Pages appends to the resolved prompt of a CLI node.
 *
 * @param assignment - Contract, MCP use, read-only mode, runner, instance and workspace of the node.
 * @returns Markdown with the todos, criteria, working rules and the closing report format.
 *
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
    todos: contract.todos.map((todo) => ({ id: todo.id, status: "done" })),
    criteria: contract.criteria.map((criterion) => ({
      id: criterion.id,
      met: true,
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
    ...(tickets.length > 0 ? ["", "### Tickets", ...tickets] : []),
    "",
    "### Todo list",
    ...contract.todos.map(itemLine),
    "",
    "### Acceptance criteria",
    ...contract.criteria.map(itemLine),
    "",
    "### How to work",
    "- Work only in the workspace. Nobody answers questions during this run: when a choice is needed, take the recommended option, otherwise decide yourself and list the decision in the report.",
    ...(assignment.isReadOnly
      ? [
          "- This session is read-only: read the workspace, but do not create, change or delete files. Commands are not available.",
        ]
      : []),
    ...mcpLines(assignment),
    "",
    "### Closing report (required)",
    "End your final message with exactly one fenced block of the language `pages-report` that holds one JSON object like this:",
    "```pages-report",
    example,
    "```",
    'List every todo and every criterion by its ID. `status` is "done" or "open"; `met` is true or false; `evidence` replaces `<proof>` with the file, command output or check that proves the criterion. `decisions` lists every choice you took on your own, or stays empty. A missing or invalid block, an open todo, an unmet criterion or a missing proof means the node did not succeed.',
  ].join("\n");
}
