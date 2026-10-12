import { vi } from "vitest";

import { a11Fetch, callA11Tool, useA11McpHarness } from "./a11-mcp";

/** The in-process Pages and MCP stack with real authorization and an isolated DuckDB. */
export type TicketHarness = Awaited<
  ReturnType<ReturnType<typeof useA11McpHarness>>
>;

/** A ticket the create tool returned. */
export interface CreatedTicket {
  readonly id: string;
  readonly key: string;
}

/**
 * The result of a hidden and of a missing record alike: the code and the fixed
 * message, nothing that tells the two apart.
 */
export const NOT_FOUND = {
  code: "NOT_FOUND",
  message: "Not found or no access.",
} as const;

let sequence = 0;

/**
 * Wires the MCP adapter of a fixture to the Pages API of the same fixture.
 *
 * @returns A starter that builds a fresh fixture whose requests stay in process.
 *
 * @remarks
 * Ticket keys start with the initials of the project name, and a prefix is
 * unique. The fixture names both projects alike, so the second project gets a
 * name of its own and can hold tickets next to the first.
 */
export function useTicketHarness(): () => Promise<TicketHarness> {
  const setup = useA11McpHarness();
  return async () => {
    const harness = await setup();
    await harness.database.execute(
      "UPDATE projects SET name = 'Beta Site' WHERE id = 'p2';",
    );
    vi.stubGlobal("fetch", a11Fetch(harness));
    return harness;
  };
}

/** Switches the credential the MCP adapter sends to the one of a fixture account. */
export function actAs(harness: TicketHarness, userId: string): void {
  harness.configuration.token = harness.tokens.get(userId) ?? "";
}

/** Calls a tool through the real MCP request handlers and returns its JSON result. */
export function callTool(
  harness: TicketHarness,
  name: string,
  parameters: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return callA11Tool(harness.connection, name, parameters);
}

/** An operation ID that no earlier call of the test run used. */
export function operationId(prefix = "op"): string {
  sequence += 1;
  return `${prefix}-${String(sequence)}`;
}

/** Reads a text field of a tool result, failing the test when it is absent. */
export function textOf(result: Record<string, unknown>, name: string): string {
  const value = result[name];
  if (typeof value !== "string")
    throw new Error(`Expected "${name}" in ${JSON.stringify(result)}`);
  return value;
}

/** Reads a list field of a tool result, failing the test when it is absent. */
export function listOf(
  result: Record<string, unknown>,
  name: string,
): Record<string, unknown>[] {
  const value = result[name];
  if (!Array.isArray(value))
    throw new Error(`Expected "${name}" in ${JSON.stringify(result)}`);
  return value as Record<string, unknown>[];
}

/**
 * Creates a ticket as the account the fixture currently acts for.
 *
 * @param harness - The fixture.
 * @param fields - Create arguments; the project and type must be given.
 * @returns The identifier and key of the new ticket.
 */
export async function createTicket(
  harness: TicketHarness,
  fields: Record<string, unknown>,
): Promise<CreatedTicket> {
  const result = await callTool(harness, "create_ticket", {
    operationId: operationId("create"),
    projectId: "p1",
    title: "Ticket",
    description: "",
    statusId: null,
    parentId: null,
    ...fields,
  });
  if (typeof result.ticketId !== "string" || typeof result.key !== "string")
    throw new Error(`Expected a created ticket: ${JSON.stringify(result)}`);
  return { id: result.ticketId, key: result.key };
}

/** Reads one ticket as the account the fixture currently acts for. */
export function readTicket(
  harness: TicketHarness,
  ticketId: string,
): Promise<Record<string, unknown>> {
  return callTool(harness, "read_ticket", { ticketId });
}

/**
 * Pages through a list tool until it has no continuation.
 *
 * @param harness - The fixture.
 * @param name - A tool with `cursor` and `limit`.
 * @param parameters - The query; the same one for every page.
 * @param listName - The result field that holds the entries.
 * @param limit - Entries per page.
 * @returns Every entry in the order the pages delivered it, and the number of pages.
 */
export async function collectPages(
  harness: TicketHarness,
  name: string,
  parameters: Record<string, unknown>,
  listName: string,
  limit: number,
): Promise<{
  readonly entries: Record<string, unknown>[];
  readonly pages: number;
}> {
  const entries: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page: Record<string, unknown> = await callTool(harness, name, {
      ...parameters,
      limit,
      ...(cursor === null ? {} : { cursor }),
    });
    entries.push(...listOf(page, listName));
    pages += 1;
    cursor = typeof page.nextCursor === "string" ? page.nextCursor : null;
  } while (cursor !== null && pages < 100);
  return { entries, pages };
}
