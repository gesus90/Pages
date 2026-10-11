import type { AgentProviderId } from "./AgentConnection";
import type { AgentAvailability } from "./AgentAvailability";
import type { AgentProfile } from "./AgentProfile";

/** Filters narrow an already authorized central list, never grant access. */
export interface AgentFilters {
  readonly search: string;
  readonly scope: string;
  readonly provider: string;
  readonly connection: string;
  readonly purpose: string;
  readonly status: string;
  readonly usability: string;
}

export const EMPTY_AGENT_FILTERS: AgentFilters = {
  search: "",
  scope: "",
  provider: "",
  connection: "",
  purpose: "",
  status: "",
  usability: "",
};

/** Reads the bounded display filters from the central panel's query string. */
export function readAgentFilters(search: URLSearchParams): AgentFilters {
  function field(name: keyof AgentFilters): string {
    return (search.get(`agent_${name}`) ?? "").slice(0, 200);
  }
  return {
    search: field("search"),
    scope: field("scope"),
    provider: field("provider"),
    connection: field("connection"),
    purpose: field("purpose"),
    status: field("status"),
    usability: field("usability"),
  };
}

/** Tests one authorized row against the panel filters; task tags remain plain categorization. */
export function matchesAgentFilters(
  profile: AgentProfile,
  context: {
    readonly filters: AgentFilters;
    readonly provider: AgentProviderId | undefined;
    readonly availability: AgentAvailability | undefined;
  },
): boolean {
  const { filters, provider, availability } = context;
  return (
    matchesIdentity(profile, filters) &&
    matchesValue(filters.provider, provider) &&
    (!filters.purpose ||
      profile.purposes.some((purpose) => purpose === filters.purpose)) &&
    matchesValue(filters.status, profile.isActive ? "active" : "inactive") &&
    matchesValue(
      filters.usability,
      availability?.isUsable ? "usable" : "blocked",
    )
  );
}

function matchesIdentity(
  profile: AgentProfile,
  filters: AgentFilters,
): boolean {
  const scope =
    profile.configuration?.scope ?? profile.targets[0]?.kind ?? "system";
  const searched =
    `${profile.name} ${profile.configuration?.tag ?? ""} ${profile.model}`.toLocaleLowerCase();
  return (
    (!filters.search ||
      searched.includes(filters.search.toLocaleLowerCase())) &&
    matchesValue(filters.scope, scope) &&
    matchesValue(filters.connection, profile.connectionId)
  );
}

function matchesValue(filter: string, value: string | undefined): boolean {
  return filter === "" || filter === value;
}
