/** Fixed transport diagnostic; an interrupted write must be reconciled before a deliberate retry. */
export class PagesTransportError extends Error {
  /** Discards native diagnostics and never asserts whether an interrupted write committed. */
  public constructor() {
    super(
      "Could not reach the Pages agent API. Check the connection before retrying; an interrupted write may already have applied.",
    );
  }
}
