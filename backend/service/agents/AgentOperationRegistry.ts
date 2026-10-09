import { AgentError } from "@/backend/error/AgentErrors";

type OperationKind = "check" | "login" | "write";

/** Shares one operation lock across checks, login, logout and connection mutations. */
export class AgentOperationRegistry {
  private readonly operations = new Map<string, OperationKind>();

  /** Acquires synchronously so competing requests cannot pass an asynchronous preflight. */
  public acquire(id: string, kind: OperationKind): () => void {
    const current = this.operations.get(id);
    if (current)
      throw new AgentError(
        current === "login" ? "login_in_progress" : "check_in_progress",
      );
    this.operations.set(id, kind);
    return () => {
      this.operations.delete(id);
    };
  }

  /** Releases the lock on both success and failure. */
  public async run<Result>(
    id: string,
    kind: OperationKind,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    const release = this.acquire(id, kind);
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
