/** A Pages-owned tool definition sent to Codex at thread creation. */
export interface PicaCodexTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

/** An app-server call, including the native thread, turn and call identities. */
export interface PicaCodexCall {
  readonly operationId?: string;
  readonly nonce?: string;
  readonly sequence?: number;
  readonly threadId: string;
  readonly turnId: string;
  readonly callId: string;
  readonly tool: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

/** A bounded, authorized image returned by Pages, never a model-selected URL. */
export interface PicaCodexImage {
  readonly mimeType: "image/png" | "image/jpeg";
  readonly data: string;
}

/** The Pages result before conversion into the Codex native content items. */
export interface PicaCodexResult {
  readonly success: boolean;
  readonly text: string;
  readonly images: readonly PicaCodexImage[];
}

/** Pages-issued identity for one captured human operation. */
export interface PicaCodexOperation {
  readonly operationId: string;
  readonly nonce: string;
  readonly sequence: number;
}

/**
 * Trusted single-file module contract required by the Pica-only adapter patch.
 *
 * @remarks
 * The launcher supplies the module's absolute path and digest. The module must
 * export `createPicaCodexGlue`, taking an ACP request callback and returning
 * this interface. Bind methods must
 * explicitly admit the exact job and native identities; dispatch must recheck
 * the active binding and current Pages rights. A false binding refuses calls.
 */
export interface PicaCodexGlue {
  readonly catalog: () => Promise<readonly PicaCodexTool[]>;
  readonly policyContext: () => Promise<string>;
  readonly bindThread: (threadId: string, context: string) => Promise<boolean>;
  readonly prepare: (threadId: string) => Promise<PicaCodexOperation>;
  readonly ready: (
    input: Readonly<Record<string, unknown>>,
  ) => Promise<unknown>;
  readonly revoke: (
    input: Readonly<Record<string, unknown>>,
  ) => Promise<unknown>;
  readonly cancelPrepare: (threadId: string, nonce: string) => Promise<boolean>;
  readonly endTurn: (threadId: string, turnId: string) => Promise<void>;
  readonly closeThread: (threadId: string) => Promise<void>;
  readonly dispatch: (call: PicaCodexCall) => Promise<PicaCodexResult>;
}

/** The adapter-owned ACP callback supplied to the trusted glue factory. */
export type PicaCodexRequest = (
  method: string,
  params: Readonly<Record<string, unknown>>,
) => Promise<unknown>;
