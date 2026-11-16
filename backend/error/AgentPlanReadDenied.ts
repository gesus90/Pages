import { AgentError } from "./AgentErrors";

/** Internal origin of a denied page read; the public error remains indistinguishable. */
export class AgentPlanReadDenied extends AgentError {
  public readonly source: string;
  public readonly reason: string;

  public constructor(source: string, reason: string) {
    super("plan_access_denied");
    this.name = "AgentPlanReadDenied";
    this.source = source;
    this.reason = reason;
  }
}

/** Adds the failing page section to an otherwise unqualified access denial. */
export async function withPlanReadOrigin<T>(
  source: string,
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read();
  } catch (error: unknown) {
    if (
      error instanceof AgentError &&
      error.code === "plan_access_denied" &&
      !(error instanceof AgentPlanReadDenied)
    )
      throw new AgentPlanReadDenied(source, "access_denied");
    throw error;
  }
}
