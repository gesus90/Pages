import { vi } from "vitest";

import { AgentBrowserSessions } from "@/backend/service/chat/browser/AgentBrowserSessions";

import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { AgentEmployeeAccess } from "@/definition/AgentEmployee";
import type { User } from "@/definition/User";

export { runtimeFiles } from "./page328-browser-files";

/** Creates fresh account boundaries and a real issuer; every filesystem call is mocked. */
export function browserWorld(access: AgentEmployeeAccess = "workspace"): {
  readonly sessions: AgentBrowserSessions;
  readonly accounts: {
    user: ReturnType<typeof vi.fn<(id: string) => Promise<User | null>>>;
    employee: ReturnType<
      typeof vi.fn<
        (
          id: string,
        ) => Promise<{ access: AgentEmployeeAccess; revision: number } | null>
      >
    >;
    origins: () => string[];
  };
  readonly user: User;
  readonly context: RuntimeExecutionContext;
  readonly controller: AbortController;
} {
  const user: User = {
    id: "agent-1",
    username: "bakuman",
    displayName: "Bakuman",
    isActive: true,
    isAgent: true,
    mustChangePassword: false,
    role: "employee",
  };
  const accounts = {
    user: vi.fn<(id: string) => Promise<User | null>>(async () => user),
    employee: vi.fn<
      (
        id: string,
      ) => Promise<{ access: AgentEmployeeAccess; revision: number } | null>
    >(async () => ({ access, revision: 1 })),
    origins: () => ["http://127.0.0.1:3000", "https://pages.example.org"],
  };
  const controller = new AbortController();
  const context: RuntimeExecutionContext = {
    userId: user.id,
    sessionId: "chat-1",
    runId: "job-1",
    signal: controller.signal,
    authorize: vi.fn(async () => undefined),
  };
  return {
    sessions: new AgentBrowserSessions(accounts),
    accounts,
    user,
    context,
    controller,
  };
}
