/**
 * A Pica job over Codex ACP ended with a stable code (PAGE-68).
 *
 * @remarks
 * The code is a chat error or an agent error code the chat translates; it never
 * carries message text, tool data or provider output.
 */
export class PicaAcpJobError extends Error {
  public readonly code: string;

  public constructor(code: string) {
    super(code);
    this.name = "PicaAcpJobError";
    this.code = code;
  }
}
