import { useState } from "react";

import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import type { AgentConfiguration } from "@/definition/AgentConfiguration";
import type {
  AgentProfile,
  AgentProfilePurpose,
  AgentProfileTarget,
} from "@/definition/AgentProfile";

/** Keeps task content and declarations in the same draft as model access and usage grants. */
export function useAgentProfileDraft(profile: AgentProfile | null): {
  readonly name: string;
  readonly isActive: boolean;
  readonly purposes: readonly AgentProfilePurpose[];
  readonly targets: readonly AgentProfileTarget[];
  readonly configuration: AgentConfiguration;
  readonly setName: (name: string) => void;
  readonly setActive: (isActive: boolean) => void;
  readonly setPurposes: (purposes: readonly AgentProfilePurpose[]) => void;
  readonly setTargets: (targets: readonly AgentProfileTarget[]) => void;
  readonly setConfiguration: (configuration: AgentConfiguration) => void;
} {
  const [name, setName] = useState(profile?.name ?? "");
  const [isActive, setActive] = useState(profile?.isActive ?? true);
  const [purposes, setPurposes] = useState<readonly AgentProfilePurpose[]>(
    profile?.purposes ?? ["agent"],
  );
  const [targets, setTargets] = useState<readonly AgentProfileTarget[]>(
    profile?.targets ?? [],
  );
  const [configuration, setConfiguration] = useState(
    profile?.configuration ??
      emptyAgentConfiguration(profile?.targets[0]?.kind ?? "person"),
  );
  return {
    name,
    isActive,
    purposes,
    targets,
    configuration,
    setName,
    setActive,
    setPurposes,
    setTargets,
    setConfiguration,
  };
}
