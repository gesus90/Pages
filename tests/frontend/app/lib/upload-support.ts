import { vi } from "vitest";

/** The progress fields the upload code reads. */
export interface FakeProgress {
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly total: number;
}

/** One request the code under test opened; the test drives its answer. */
export class FakeUploadRequest {
  public status = 0;
  public responseText = "";
  public method = "";
  public address = "";
  public sent: Blob | null = null;
  public onerror: (() => void) | null = null;
  public onload: (() => void) | null = null;
  public readonly upload: {
    onprogress: ((event: FakeProgress) => void) | null;
  } = { onprogress: null };

  /** Remembers the method and the address. */
  public open(method: string, address: string): void {
    this.method = method;
    this.address = address;
  }

  /** Remembers the body; nothing is sent. */
  public send(body: Blob): void {
    this.sent = body;
  }

  /** Reports upload progress as the browser would. */
  public progress(event: FakeProgress): void {
    this.upload.onprogress?.(event);
  }

  /** Ends the request with a network error. */
  public fail(): void {
    this.onerror?.();
  }

  /** Ends the request with the given server answer. */
  public answer(status: number, body: string): void {
    this.status = status;
    this.responseText = body;
    this.onload?.();
  }
}

/**
 * Replaces `XMLHttpRequest` by a recorder the test drives by hand.
 *
 * @returns The requests the code under test opened, in order.
 */
export function stubUploadRequests(): FakeUploadRequest[] {
  const requests: FakeUploadRequest[] = [];
  vi.stubGlobal(
    "XMLHttpRequest",
    class extends FakeUploadRequest {
      /** Registers itself so the test can reach the request. */
      public constructor() {
        super();
        requests.push(this);
      }
    },
  );
  return requests;
}
