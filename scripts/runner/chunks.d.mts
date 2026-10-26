export const OUTPUT_CHUNK_BYTES: number;
export interface JournalBinding {
  readonly jobId: string;
  readonly sessionId: string;
  readonly plan?: object;
  readonly launchId: string;
}
export interface ChunkIndex {
  readonly version: 2;
  readonly identity: string;
  readonly chunk: number;
  readonly lastSequence: number;
  readonly bytes: number;
  readonly isClosed: boolean;
}
export interface ChunkMetadata {
  readonly identity: string;
  readonly chunk: number;
  readonly offset: number;
  readonly bytes: number;
  readonly firstSequence: number;
  readonly lastSequence: number;
  readonly sha256: string;
  readonly previousSha256: string | null;
  readonly isSealed: boolean;
}
export class ChunkJournal {
  constructor(
    directory: string,
    binding: JournalBinding,
    options?: { recordAligned?: boolean },
  );
  initialize(): Promise<void>;
  append(contents: Buffer, sequence: number): Promise<void>;
  checkpoint(isClosed?: boolean): Promise<void>;
  close(): Promise<void>;
}
export function writeAll(
  handle: { write(contents: Buffer): Promise<{ bytesWritten: number }> },
  contents: Buffer,
): Promise<void>;
export function journalIndex(
  directory: string,
  binding: JournalBinding,
): Promise<ChunkIndex>;
export function readJournalChunk(
  directory: string,
  index: ChunkIndex,
  sequence: number,
): Promise<{
  contents: Buffer;
  metadata: ChunkMetadata;
  hasUncommittedTail: boolean;
}>;
export function readJournalEvents(
  directory: string,
  binding: JournalBinding,
  after: number,
): Promise<{
  events: import("../../definition/RunnerLiveHistory").RunnerLiveEvent[];
  length: number;
}>;
