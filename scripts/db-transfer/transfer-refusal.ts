/** The transfer cannot or must not go on; the message holds names and numbers only. */
export class TransferRefusal extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "TransferRefusal";
  }
}
