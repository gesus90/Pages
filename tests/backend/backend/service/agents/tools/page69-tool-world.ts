import { vi } from "vitest";

import { AgentToolManagerService } from "@/backend/service/agents/tools/AgentToolManagerService";

import type { AgentToolDefinition } from "@/backend/service/agents/tools/AgentToolRegistry";
import type {
  AgentToolHealth,
  AgentToolLocation,
  AgentToolStorage,
} from "@/backend/service/agents/tools/AgentToolContracts";
import type { AgentToolId } from "@/definition/AgentTools";
import type { AccountAccess } from "@/definition/Authorization";

/** Synthetic persisted personal system administrator. */
export const TOOL_ADMIN: AccountAccess = {
  userId: "admin",
  role: null,
  isAdmin: true,
  mode: "admin",
  isActive: true,
  firstName: "Test",
  lastName: "Admin",
  departments: [],
  managedDepartments: [],
  allDepartments: false,
  allProjects: false,
  hasHadDepartment: false,
};

/** Creates a generation without a real filesystem, installation or provider. */
export function toolLocation(
  id: AgentToolId,
  version = "synthetic",
  source: AgentToolLocation["source"] = "managed",
): AgentToolLocation {
  return {
    file: `/memory/tools/${id}/${version}/bin`,
    release: source === "managed" ? `/memory/tools/${id}/${version}` : null,
    version,
    source,
  };
}

/** In-memory external boundaries for manager unit tests; credentials are deliberately outside them. */
export function toolWorld(): {
  readonly manager: AgentToolManagerService;
  readonly recreate: () => AgentToolManagerService;
  readonly current: Map<AgentToolId, AgentToolLocation>;
  readonly system: Map<AgentToolId, AgentToolLocation>;
  readonly outcomes: Map<string, AgentToolHealth>;
  readonly storage: AgentToolStorage;
  readonly install: ReturnType<
    typeof vi.fn<
      (
        tool: AgentToolDefinition,
        candidate: AgentToolLocation,
        signal: AbortSignal,
      ) => Promise<void>
    >
  >;
  readonly activate: ReturnType<typeof vi.fn<AgentToolStorage["activate"]>>;
  readonly check: ReturnType<
    typeof vi.fn<
      (
        tool: AgentToolDefinition,
        location: AgentToolLocation,
      ) => Promise<AgentToolHealth>
    >
  >;
  readonly removed: AgentToolId[];
  readonly discarded: AgentToolLocation[];
} {
  const current = new Map<AgentToolId, AgentToolLocation>();
  const previous = new Map<AgentToolId, AgentToolLocation>();
  const system = new Map<AgentToolId, AgentToolLocation>(
    ["node", "bubblewrap", "pages_mcp"].map((id) => {
      if (id !== "node" && id !== "bubblewrap" && id !== "pages_mcp")
        throw new Error("Invalid fixture");
      return [id, toolLocation(id, "synthetic", "system")];
    }),
  );
  const outcomes = new Map<string, AgentToolHealth>();
  const removed: AgentToolId[] = [];
  const discarded: AgentToolLocation[] = [];
  const activate = vi.fn<AgentToolStorage["activate"]>(
    async (tool, location) => {
      const prior = current.get(tool.id);
      if (prior) previous.set(tool.id, prior);
      current.set(tool.id, { ...location, approvedTarget: tool.version });
    },
  );
  const storage = memoryToolStorage({
    current,
    previous,
    activate,
    removed,
    discarded,
    generation: 0,
    enabled: [],
  });
  const install = vi.fn<
    (
      tool: AgentToolDefinition,
      candidate: AgentToolLocation,
      signal: AbortSignal,
    ) => Promise<void>
  >(async () => {});
  const check = vi.fn(
    async (
      tool: AgentToolDefinition,
      location: AgentToolLocation,
    ): Promise<AgentToolHealth> =>
      outcomes.get(location.file) ?? {
        status: "ready",
        diagnostic: "ready",
        version: tool.version ?? "synthetic",
      },
  );
  const dependencies = {
    files: storage,
    installer: { install },
    health: { check },
    system: async (tool: AgentToolDefinition) => system.get(tool.id) ?? null,
  };
  const recreate = (): AgentToolManagerService =>
    new AgentToolManagerService(dependencies);
  return {
    manager: recreate(),
    recreate,
    current,
    system,
    outcomes,
    storage,
    install,
    activate,
    check,
    removed,
    discarded,
  };
}

interface StorageContext {
  readonly current: Map<AgentToolId, AgentToolLocation>;
  readonly previous: Map<AgentToolId, AgentToolLocation>;
  readonly activate: AgentToolStorage["activate"];
  readonly removed: AgentToolId[];
  readonly discarded: AgentToolLocation[];
  generation: number;
  enabled: readonly AgentToolId[];
}

function memoryToolStorage(context: StorageContext): AgentToolStorage {
  const { current, previous, activate, removed, discarded } = context;
  return {
    root: "/memory/tools",
    home: async () => ({
      root: "/memory/probe",
      home: "/memory/probe/home",
      config: "/memory/probe/config",
      work: "/memory/probe/work",
    }),
    current: async (tool) => current.get(tool.id) ?? null,
    candidate: async (tool) => ({
      ...toolLocation(
        tool.id,
        `${tool.version}-generation-${++context.generation}`,
      ),
      version: tool.version,
    }),
    activate,
    previous: async (tool) => previous.get(tool.id) ?? null,
    discard: async (location) => {
      discarded.push(location);
    },
    remove: async (tool) => {
      current.delete(tool.id);
      removed.push(tool.id);
    },
    readEnabled: async () => context.enabled,
    writeEnabled: async (ids) => {
      context.enabled = ids;
    },
  };
}
