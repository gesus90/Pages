import { expect, vi } from "vitest";

import { PicaCodexRequests } from "@/backend/agents/acp/PicaCodexRequests";

import type {
  PicaCodexListener,
  PicaCodexTurnBinding,
} from "@/backend/agents/acp/PicaCodexRequests";
import type {
  PicaCodexCall,
  PicaCodexOperation,
  PicaCodexTool,
} from "@/backend/agents/acp/PicaCodexGlue";
import type { PicaToolOutcome } from "@/backend/service/chat/PicaToolSchemas";

export const THREAD = "thread-1";
export const TURN = "turn-1";
export const HEX_64 = /^[a-f0-9]{64}$/u;

/** The two Pages-owned tool definitions of the synthetic catalog. */
export const TOOLS: readonly PicaCodexTool[] = [
  { name: "read_ticket", description: "Reads a ticket", inputSchema: {} },
  { name: "set_title", description: "Sets a title", inputSchema: {} },
];

/** Base64 of a PNG-signed buffer of the given byte length. */
export function pngData(bytes: number): string {
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const body = Buffer.alloc(bytes - header.length, 7);
  return Buffer.concat([header, body]).toString("base64");
}

/** A tool outcome with the schema defaults filled in. */
export function outcome(part: Partial<PicaToolOutcome> = {}): PicaToolOutcome {
  return { ok: true, result: null, error: null, ...part };
}

/** A call on the synthetic thread and turn. */
export function call(part: Partial<PicaCodexCall> = {}): PicaCodexCall {
  return {
    threadId: THREAD,
    turnId: TURN,
    callId: "call-1",
    tool: "read_ticket",
    arguments: { id: "T-1" },
    ...part,
  };
}

/** A signal that is never aborted. */
export function liveSignal(): AbortSignal {
  return new AbortController().signal;
}

/** A tool outcome that the test settles by hand. */
export function deferred(): {
  readonly promise: Promise<PicaToolOutcome>;
  readonly settle: (value: PicaToolOutcome) => void;
} {
  let settle: (value: PicaToolOutcome) => void = () => undefined;
  const promise = new Promise<PicaToolOutcome>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

export interface Rig {
  readonly requests: PicaCodexRequests;
  readonly state: {
    session: string | null;
    prompting: boolean;
    current: boolean;
  };
  readonly invoke: ReturnType<typeof vi.fn<PicaCodexTurnBinding["invoke"]>>;
  readonly capture: ReturnType<typeof vi.fn<PicaCodexListener["capture"]>>;
  readonly catalog: ReturnType<typeof vi.fn<PicaCodexListener["catalog"]>>;
}

/** A fresh request guard over a mocked listener and session. */
export function rig(requirePolicy = false): Rig {
  const state = {
    session: null as string | null,
    prompting: true,
    current: true,
  };
  const invoke = vi.fn<PicaCodexTurnBinding["invoke"]>(async () =>
    outcome({ result: "done" }),
  );
  const binding: PicaCodexTurnBinding = {
    isCurrent: () => state.current,
    invoke,
  };
  const capture = vi.fn<PicaCodexListener["capture"]>(() => binding);
  const catalog = vi.fn<PicaCodexListener["catalog"]>(async () => TOOLS);
  const requests = new PicaCodexRequests({
    listener: { catalog, capture },
    requirePolicy,
    session: () => state.session,
    prompting: () => state.prompting,
  });
  return { requests, state, invoke, capture, catalog };
}

/** A rig with the catalog issued, the thread bound and the session reporting it. */
export async function boundRig(requirePolicy = false): Promise<Rig> {
  const r = rig(requirePolicy);
  await r.requests.catalog();
  expect(
    r.requests.bindThread(THREAD, r.requests.catalogContext() ?? undefined),
  ).toBe(true);
  r.state.session = THREAD;
  return r;
}

/** A bound rig with an active human turn, as under a non-policy build. */
export async function turnRig(): Promise<Rig> {
  const r = await boundRig();
  expect(r.requests.bindTurn(THREAD, TURN)).toBe(true);
  return r;
}

/** The private ready request of a prepared operation. */
export function readyFor(
  operation: PicaCodexOperation,
  context: string,
  part: Record<string, unknown> = {},
): Parameters<PicaCodexRequests["admitReady"]>[0] {
  return {
    threadId: THREAD,
    turnId: TURN,
    nonce: operation.nonce,
    operationId: operation.operationId,
    sequence: operation.sequence,
    context,
    catalog: TOOLS.map((tool) => ({ type: "function" as const, ...tool })),
    ...part,
  };
}

/** A policy rig with a prepared operation and its matching ready request. */
export async function policyRig(): Promise<
  Rig & {
    readonly context: string;
    readonly operation: PicaCodexOperation;
    readonly ready: ReturnType<typeof readyFor>;
    readonly identity: Pick<
      PicaCodexCall,
      "operationId" | "nonce" | "sequence"
    >;
  }
> {
  const r = rig(true);
  await r.requests.catalog();
  const context = r.requests.catalogContext() ?? "";
  r.requests.bindThread(THREAD, context);
  r.state.session = THREAD;
  const operation = r.requests.prepareTurn(THREAD);
  const identity = {
    operationId: operation.operationId,
    nonce: operation.nonce,
    sequence: operation.sequence,
  };
  return {
    ...r,
    context,
    operation,
    identity,
    ready: readyFor(operation, context),
  };
}
