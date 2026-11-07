import { randomBytes, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { isValidPicaToolImage } from "@/backend/service/chat/PicaToolImageValidation";

import type {
  PicaCodexCall,
  PicaCodexImage,
  PicaCodexOperation,
  PicaCodexTool,
} from "./PicaCodexGlue";
import type { PicaToolOutcome } from "@/backend/service/chat/PicaToolSchemas";

const CHUNK_SIZE = 512 * 1024;
const RECEIPT_LIFETIME_MS = 30_000;

/** The immutable human-turn binding captured by Pages at native turn admission. */
export interface PicaCodexTurnBinding {
  readonly isCurrent: () => boolean;
  readonly invoke: (
    call: PicaCodexCall,
    signal: AbortSignal,
  ) => Promise<PicaToolOutcome>;
}

/** Server-side callbacks, available only to Pica's Codex session. */
export interface PicaCodexListener {
  readonly catalog: () => Promise<readonly PicaCodexTool[]>;
  readonly capture: () => PicaCodexTurnBinding;
}

interface Receipt {
  readonly id: string;
  readonly callId: string;
  readonly images: readonly PicaCodexImage[];
  readonly expires: number;
  readonly timer: ReturnType<typeof setTimeout>;
  image: number;
  offset: number;
}

interface PendingTurn {
  readonly operationId: string;
  readonly sequence: number;
  readonly nonce: string;
  readonly binding: PicaCodexTurnBinding;
  readonly expires: number;
}

interface PicaReadyRequest {
  readonly threadId: string;
  readonly turnId: string;
  readonly nonce: string;
  readonly operationId: string;
  readonly sequence: number;
  readonly context: string;
  readonly catalog: readonly (PicaCodexTool & {
    readonly type: "function";
  })[];
}

interface ActiveTurn {
  readonly id: string;
  readonly binding: PicaCodexTurnBinding;
  readonly operationNonce?: string;
  readonly operationId?: string;
  readonly operationSequence?: number;
  readonly controller: AbortController;
  readonly calls: Set<string>;
  pending: Promise<unknown> | null;
  receipt: Receipt | null;
}

/** Authenticates private adapter requests against one live Pica ACP session. */
export class PicaCodexRequests {
  private readonly listener: PicaCodexListener;
  private readonly requirePolicy: boolean;
  private readonly session: () => string | null;
  private readonly prompting: () => boolean;
  private threadId: string | null = null;
  private catalogNames: ReadonlySet<string> | null = null;
  private policyContext: string | null = null;
  private boundContext: string | null = null;
  private issuedCatalog: readonly PicaCodexTool[] | null = null;
  private preparedTurn: PendingTurn | null = null;
  private operationSequence = 0;
  private turn: ActiveTurn | null = null;
  private readonly endedTurns = new Map<string, Promise<void>>();
  private closedThreadId: string | null = null;
  private closeTask: Promise<void> | null = null;
  private isClosed = false;

  public constructor(options: {
    readonly listener: PicaCodexListener;
    readonly requirePolicy?: boolean;
    readonly session: () => string | null;
    readonly prompting: () => boolean;
  }) {
    this.listener = options.listener;
    this.requirePolicy = options.requirePolicy === true;
    this.session = options.session;
    this.prompting = options.prompting;
  }

  /** Lists the current Pages-owned definitions before a native thread is created. */
  public async catalog(): Promise<readonly PicaCodexTool[]> {
    if (this.isClosed || this.threadId !== null || this.catalogNames !== null)
      throw new Error("Pica request refused");
    try {
      const tools = await this.listener.catalog();
      if (this.isClosed || this.threadId !== null || this.catalogNames !== null)
        throw new Error("Pica request refused");
      const names = new Set(tools.map((tool) => tool.name));
      if (tools.length < 1 || tools.length > 512 || names.size !== tools.length)
        throw new Error("Pica request refused");
      this.catalogNames = names;
      this.issuedCatalog = structuredClone(tools);
      this.policyContext = this.requirePolicy
        ? randomBytes(32).toString("hex")
        : null;
      return tools;
    } catch {
      throw new Error("Pica catalog refused");
    }
  }

  /** Returns the one-time context bound to the catalog issued for this session. */
  public catalogContext(): string | null {
    return this.policyContext;
  }

  /** Admits the one native thread created by this ACP connection. */
  public bindThread(threadId: string, context?: string): boolean {
    if (
      this.isClosed ||
      (this.requirePolicy &&
        (context === undefined || context !== this.policyContext)) ||
      (context !== undefined && !/^[a-f0-9]{64}$/u.test(context)) ||
      this.threadId !== null ||
      this.session() !== null ||
      !this.catalogNames
    )
      return false;
    this.threadId = threadId;
    this.boundContext = this.policyContext;
    this.policyContext = null;
    return true;
  }

  /** Captures the human operation before the adapter starts a native turn. */
  public prepareTurn(threadId: string): PicaCodexOperation {
    if (
      !this.requirePolicy ||
      !this.isThread(threadId) ||
      this.turn ||
      this.preparedTurn ||
      !this.prompting()
    )
      throw new Error("Pica turn refused");
    const binding = this.listener.capture();
    if (!binding.isCurrent()) throw new Error("Pica turn refused");
    if (this.operationSequence >= Number.MAX_SAFE_INTEGER)
      throw new Error("Pica turn refused");
    const operation = {
      operationId: randomUUID(),
      nonce: randomBytes(32).toString("hex"),
      sequence: ++this.operationSequence,
    };
    this.preparedTurn = { ...operation, binding, expires: Date.now() + 30_000 };
    return operation;
  }

  /** Admits one native turn after its effective registry has been reported. */
  public admitReady(input: PicaReadyRequest): boolean {
    const pending = this.preparedTurn;
    this.preparedTurn = null;
    const expected = this.issuedCatalog?.map((tool) => ({
      type: "function",
      ...tool,
    }));
    if (
      !this.requirePolicy ||
      !pending ||
      !this.isThread(input.threadId) ||
      this.turn ||
      !this.prompting() ||
      !pending.binding.isCurrent() ||
      pending.expires < Date.now() ||
      pending.nonce !== input.nonce ||
      pending.operationId !== input.operationId ||
      pending.sequence !== input.sequence ||
      this.boundContext !== input.context ||
      this.endedTurns.has(input.turnId) ||
      this.endedTurns.size >= 4096 ||
      !expected ||
      !isDeepStrictEqual(expected, input.catalog)
    )
      return false;
    this.turn = {
      id: input.turnId,
      binding: pending.binding,
      operationNonce: pending.nonce,
      operationId: pending.operationId,
      operationSequence: pending.sequence,
      controller: new AbortController(),
      calls: new Set(),
      pending: null,
      receipt: null,
    };
    return true;
  }

  /** Revokes a pending operation without admitting a native turn. */
  public async cancelPrepare(threadId: string, nonce: string): Promise<boolean> {
    if (!this.isThread(threadId)) return false;
    if (this.preparedTurn?.nonce === nonce) {
      this.preparedTurn = null;
      return true;
    }
    const turn = this.turn;
    if (!turn || turn.operationNonce !== nonce) return false;
    await this.endTurn(threadId, turn.id);
    return true;
  }

  /** Revokes only the operation identified by a private native control request. */
  public async revokeOperation(input: PicaReadyRequest): Promise<boolean> {
    const expected = this.issuedCatalog?.map((tool) => ({ type: "function", ...tool }));
    if (!this.isThread(input.threadId) || this.boundContext !== input.context ||
        !expected || !isDeepStrictEqual(expected, input.catalog)) return false;
    const pending = this.preparedTurn;
    if (pending && pending.operationId === input.operationId && pending.nonce === input.nonce && pending.sequence === input.sequence) {
      this.preparedTurn = null;
      return true;
    }
    const turn = this.turn;
    if (!turn || turn.id !== input.turnId || turn.operationId !== input.operationId ||
        turn.operationNonce !== input.nonce || turn.operationSequence !== input.sequence) return false;
    await this.endTurn(input.threadId, input.turnId);
    return true;
  }

  /** Captures the current human operation after Pages has started its prompt. */
  public bindTurn(threadId: string, turnId: string): boolean {
    if (
      this.requirePolicy ||
      !this.isThread(threadId) ||
      this.turn ||
      this.endedTurns.has(turnId) ||
      this.endedTurns.size >= 4096 ||
      !this.prompting()
    )
      return false;
    const binding = this.listener.capture();
    if (!binding.isCurrent()) return false;
    this.turn = {
      id: turnId,
      binding,
      controller: new AbortController(),
      calls: new Set(),
      pending: null,
      receipt: null,
    };
    return true;
  }

  /** Invokes the HTTP-backed tool once and retains only bounded image data. */
  public async dispatch(
    call: PicaCodexCall,
    signal: AbortSignal,
  ): Promise<unknown> {
    const turn = this.requireTurn(call.threadId, call.turnId);
    signal.throwIfAborted();
    if (
      turn.pending ||
      turn.receipt ||
      (this.requirePolicy && (call.operationId !== turn.operationId || call.nonce !== turn.operationNonce || call.sequence !== turn.operationSequence)) ||
      !this.catalogNames?.has(call.tool) ||
      turn.calls.has(call.callId) ||
      turn.calls.size >= 4096 ||
      Buffer.byteLength(JSON.stringify(call.arguments), "utf8") > 1024 * 1024
    )
      throw new Error("Pica call refused");
    turn.calls.add(call.callId);
    const pending = turn.binding.invoke(
      call,
      AbortSignal.any([turn.controller.signal, signal]),
    );
    turn.pending = pending;
    try {
      const result = await pending;
      signal.throwIfAborted();
      this.requireSameTurn(turn, call.threadId, call.turnId);
      const images = result.images ?? [];
      if (
        images.length > 4 ||
        images.some((image) => !isValidPicaToolImage(image))
      )
        throw new Error("Pica image refused");
      const receipt = images.length
        ? this.receipt(turn, call.callId, images)
        : null;
      turn.receipt = receipt;
      return {
        success: result.ok,
        text: result.ok ? (result.result ?? "") : (result.error ?? "FAILED"),
        receipt: receipt?.id ?? null,
        images: images.map(({ mimeType, data }) => ({
          mimeType,
          length: data.length,
        })),
      };
    } catch {
      throw new Error("Pica call refused");
    } finally {
      turn.pending = null;
    }
  }

  /** Returns the next bounded portion of one authenticated image receipt. */
  public chunk(input: {
    readonly operationId?: string;
    readonly nonce?: string;
    readonly sequence?: number;
    readonly threadId: string;
    readonly turnId: string;
    readonly callId: string;
    readonly receipt: string;
    readonly image: number;
    readonly offset: number;
  }): { readonly data: string; readonly next: number } {
    const turn = this.requireTurn(input.threadId, input.turnId);
    const receipt = turn.receipt;
    if (
      (this.requirePolicy && (input.operationId !== turn.operationId || input.nonce !== turn.operationNonce || input.sequence !== turn.operationSequence)) ||
      !receipt ||
      receipt.expires < Date.now() ||
      receipt.id !== input.receipt ||
      receipt.callId !== input.callId ||
      receipt.image !== input.image ||
      receipt.offset !== input.offset
    )
      throw new Error("Pica receipt refused");
    const image = receipt.images[receipt.image];
    if (!image) throw new Error("Pica receipt refused");
    const data = image.data.slice(receipt.offset, receipt.offset + CHUNK_SIZE);
    const next = receipt.offset + data.length;
    if (next === image.data.length) {
      receipt.image += 1;
      receipt.offset = 0;
    } else receipt.offset = next;
    if (receipt.image === receipt.images.length) this.clearReceipt(turn);
    return { data, next };
  }

  /** Revokes a turn and waits for its admitted client operation to settle. */
  public async endTurn(threadId: string, turnId: string): Promise<void> {
    const turn = this.turn;
    const previous = this.endedTurns.get(turnId);
    if (
      (this.threadId === threadId || this.closedThreadId === threadId) &&
      previous
    ) {
      await previous;
      return;
    }
    if (!turn || this.threadId !== threadId || turn.id !== turnId)
      throw new Error("Pica turn refused");
    this.turn = null;
    turn.controller.abort();
    this.clearReceipt(turn);
    const settled = turn.pending
      ? Promise.allSettled([turn.pending]).then(() => undefined)
      : Promise.resolve();
    this.endedTurns.set(turnId, settled);
    await settled;
  }

  /** Revokes the native thread on session close. */
  public async closeThread(threadId: string): Promise<void> {
    if (this.closedThreadId === threadId) {
      if (this.closeTask) await this.closeTask;
      return;
    }
    if (this.threadId !== threadId) throw new Error("Pica thread refused");
    this.isClosed = true;
    this.preparedTurn = null;
    this.closedThreadId = threadId;
    this.closeTask = this.settleClosedThread(threadId);
    await this.closeTask;
  }

  /** Discards all pending image receipts on cancellation or disconnect. */
  public close(): void {
    this.isClosed = true;
    this.turn?.controller.abort();
    if (this.turn) this.clearReceipt(this.turn);
    this.turn = null;
    this.threadId = null;
    this.catalogNames = null;
    this.policyContext = null;
    this.boundContext = null;
    this.issuedCatalog = null;
    this.preparedTurn = null;
  }

  /** Revokes the current prompt even when the adapter did not send an end request. */
  public async cancelTurn(): Promise<void> {
    this.preparedTurn = null;
    const turn = this.turn;
    const thread = this.threadId;
    if (turn && thread) await this.endTurn(thread, turn.id);
  }

  /** Checks the thread reported by session/new against the private binding. */
  public confirmThread(threadId: string): void {
    if (this.threadId !== threadId) throw new Error("Pica thread refused");
  }

  private async settleClosedThread(threadId: string): Promise<void> {
    if (this.turn) await this.endTurn(threadId, this.turn.id);
    await Promise.all(this.endedTurns.values());
    this.threadId = null;
    this.catalogNames = null;
    this.policyContext = null;
    this.boundContext = null;
    this.issuedCatalog = null;
  }

  private receipt(
    turn: ActiveTurn,
    callId: string,
    images: readonly PicaCodexImage[],
  ): Receipt {
    const id = randomUUID();
    const timer = setTimeout(() => {
      if (turn.receipt?.id === id) this.clearReceipt(turn);
    }, RECEIPT_LIFETIME_MS);
    timer.unref();
    return {
      id,
      callId,
      images,
      timer,
      expires: Date.now() + RECEIPT_LIFETIME_MS,
      image: 0,
      offset: 0,
    };
  }

  private clearReceipt(turn: ActiveTurn): void {
    if (turn.receipt) clearTimeout(turn.receipt.timer);
    turn.receipt = null;
  }

  private isThread(threadId: string): boolean {
    return (
      !this.isClosed &&
      this.threadId === threadId &&
      this.session() === threadId
    );
  }

  private requireTurn(threadId: string, turnId: string): ActiveTurn {
    const turn = this.turn;
    if (
      !this.isThread(threadId) ||
      !this.prompting() ||
      !turn ||
      turn.id !== turnId ||
      !turn.binding.isCurrent() ||
      turn.controller.signal.aborted
    )
      throw new Error("Pica turn refused");
    return turn;
  }

  private requireSameTurn(
    turn: ActiveTurn,
    threadId: string,
    turnId: string,
  ): void {
    if (this.requireTurn(threadId, turnId) !== turn)
      throw new Error("Pica turn refused");
  }
}
