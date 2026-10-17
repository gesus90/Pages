import type { AgentToolActivity, AgentToolId } from "@/definition/AgentTools";

interface ToolLease {
  readonly tools: readonly AgentToolId[];
  readonly activity: AgentToolActivity;
}

/** Tracks the existing ACP engine's leases; it never starts another execution engine. */
export class AgentRuntimeSupervisor {
  private readonly leases = new Map<string, ToolLease>();

  /** Pins tool generations until the existing closeout confirms process absence. */
  public reserve(instanceId: string, tools: readonly AgentToolId[]): void {
    if (this.leases.has(instanceId))
      throw new Error("Duplicate tool runtime lease");
    this.leases.set(instanceId, {
      tools,
      activity: { instanceId, processId: null, sessionId: null },
    });
  }

  /** Records the actual process and ACP session milestones without prompts or credentials. */
  public identify(
    instanceId: string,
    changes: Partial<Omit<AgentToolActivity, "instanceId">>,
  ): void {
    const lease = this.leases.get(instanceId);
    if (lease)
      this.leases.set(instanceId, {
        ...lease,
        activity: { ...lease.activity, ...changes },
      });
  }

  /** Only a confirmed existing-engine closeout may release an occupied lease. */
  public release(instanceId: string): void {
    this.leases.delete(instanceId);
  }

  /** Returns safe activity for one tool, independently of installation/readiness status. */
  public activities(id: AgentToolId): readonly AgentToolActivity[] {
    return [...this.leases.values()]
      .filter((lease) => lease.tools.includes(id))
      .map((lease) => lease.activity);
  }
}
