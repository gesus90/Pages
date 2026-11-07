import { picaHelperUsage } from "@/backend/agents/acp/PicaClaudeHelper";
import { picaHelperScript } from "@/backend/agents/acp/PicaClaudeHelperScript";
import { PicaAcpJobError } from "@/backend/error/PicaAcpJobError";

import { readPicaCodexCatalog } from "./PicaCodexCatalog";
import {
  picaHelperPath,
  removePicaInvocationFile,
  writePicaInvocationFile,
} from "./PicaInvocationFile";
import { invokePicaNativeTool } from "./PicaToolClient";

import type { PicaCodexTool } from "@/backend/agents/acp/PicaCodexGlue";
import type { PicaCodexTurnBinding } from "@/backend/agents/acp/PicaCodexRequests";
import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { PicaBridgeDescriptor, PicaBridgeLease } from "./PicaBridge";

/**
 * The turn credential of one Pica job: its bridge lease, the private
 * descriptor file in the workspace and the turn the credential is bound to.
 *
 * @remarks
 * Revoking removes the file and the bridge binding together, so a credential
 * never outlives the turn it was issued for.
 */
export class PicaAcpCredential {
  private readonly directory: string;
  private readonly isClaude: boolean;
  /** Opened when the job runs, so a job that never ran leaves no token behind. */
  private lease: PicaBridgeLease | null = null;
  private file: string | null = null;
  private url: string | null = null;
  private turn: number | null = null;

  public constructor(directory: string, isClaude: boolean) {
    this.directory = directory;
    this.isClaude = isClaude;
  }

  /** The turn whose credential is current; `null` while none is. */
  public get boundTurn(): number | null {
    return this.turn;
  }

  /** Takes the bridge lease of the running job. */
  public open(lease: PicaBridgeLease): void {
    this.lease = lease;
  }

  /** Returns the lease; a job that is not running has none. */
  public requireLease(): PicaBridgeLease {
    if (this.lease === null) throw new PicaAcpJobError("general");
    return this.lease;
  }

  /** Binds the written credential to a turn, or to none while a steer is decided. */
  public bind(turn: number | null): void {
    this.turn = turn;
  }

  /** The helper a Claude Code turn may run; `null` between turns. */
  public helperPath(): string | null {
    return this.file ? picaHelperPath(this.file) : null;
  }

  /** The instruction a prompt carries for reaching the Pages tools. */
  public usage(): string {
    if (!this.isClaude)
      return "Use the available Pages tools to access the conversation's authorized data.";
    if (!this.file) throw new PicaAcpJobError("general");
    return picaHelperUsage(picaHelperPath(this.file));
  }

  /** Replaces the descriptor file; without a descriptor the bridge binding is revoked too. */
  public write(descriptor: PicaBridgeDescriptor | null): void {
    try {
      if (this.file) removePicaInvocationFile(this.directory, this.file);
      this.file = null;
      if (!descriptor) throw new PicaAcpJobError("general");
      this.file = writePicaInvocationFile(
        this.directory,
        descriptor,
        this.isClaude ? picaHelperScript(process.execPath) : undefined,
      );
      this.url = descriptor.url;
    } catch (error: unknown) {
      this.lease?.setTurn(null);
      throw error;
    }
  }

  /** Revokes the credential of the current turn. */
  public revoke(): void {
    this.turn = null;
    this.lease?.setTurn(null);
    if (this.file) removePicaInvocationFile(this.directory, this.file);
    this.file = null;
    this.url = null;
  }

  /** Waits for every call admitted so far. */
  public async settle(): Promise<void> {
    await this.lease?.settle();
  }

  /** Ends the lease when the job closes. */
  public close(): void {
    this.lease?.close();
  }

  /** Reads the catalog of the bound turn; it fails if the turn changed meanwhile. */
  public async catalog(signal: AbortSignal): Promise<readonly PicaCodexTool[]> {
    const { file, url, turn } = this;
    if (!file || !url || turn === null) throw new PicaAcpJobError("general");
    const result = await readPicaCodexCatalog(
      { descriptorFile: file, expectedUrl: url },
      signal,
    );
    if (this.file !== file || this.turn !== turn)
      throw new PicaAcpJobError("general");
    return result;
  }

  /** Captures the bound turn for a native Codex turn; its calls fail once it changed. */
  public capture(context: RuntimeExecutionContext): PicaCodexTurnBinding {
    const { file, url, turn } = this;
    if (!file || !url || turn === null) throw new PicaAcpJobError("general");
    const isCurrent = (): boolean =>
      this.file === file &&
      this.url === url &&
      this.turn === turn &&
      !context.signal.aborted;
    return {
      isCurrent,
      invoke: async (call, signal) => {
        if (!isCurrent()) throw new PicaAcpJobError("general");
        const result = await invokePicaNativeTool(
          { descriptorFile: file, expectedUrl: url },
          { name: call.tool, arguments: call.arguments },
          AbortSignal.any([signal, context.signal]),
        );
        if (!isCurrent()) throw new PicaAcpJobError("general");
        return result;
      },
    };
  }
}
