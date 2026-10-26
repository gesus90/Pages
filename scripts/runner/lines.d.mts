export const MAXIMUM_PROTOCOL_LINE_BYTES: number;
export class ProtocolLines {
  constructor(receive: (line: string) => void | Promise<void>);
  receive(chunk: Uint8Array): Promise<void>;
  finish(): Promise<void>;
}
