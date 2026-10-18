import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { AgentProfileActions } from "./agent-profile-actions";

import type { AgentAvailability } from "@/definition/AgentAvailability";
import type { AgentConnectionSummary } from "@/definition/AgentConnection";
import type {
  AgentProfile,
  AgentProfileDirectory,
} from "@/definition/AgentProfile";
import type { TFunction } from "i18next";

/** Displays an executor-specific reason alongside reduced opacity, with protected administration actions. */
export function AgentProfileRow(props: {
  readonly profile: AgentProfile;
  readonly connections: readonly AgentConnectionSummary[];
  readonly directory: AgentProfileDirectory;
  readonly availability: AgentAvailability | undefined;
  readonly onEdit: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { profile, directory, availability } = props;
  const connection = props.connections.find(
    (entry) => entry.id === profile.connectionId,
  );
  const targets = targetNames(profile, directory, t);
  const scope =
    profile.configuration?.scope ?? profile.targets[0]?.kind ?? "system";
  return (
    <tr className="transition-colors hover:bg-muted/40">
      <th
        scope="row"
        className={cn(
          "px-4 py-3 text-sm font-medium",
          availability?.isUsable === false && "opacity-60",
        )}
      >
        <span className="pages-selectable">{profile.name}</span>
        {profile.configuration?.tag ? (
          <span className="ml-2 inline-flex rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
            {profile.configuration.tag}
          </span>
        ) : null}
      </th>
      <td className="px-4 py-3">
        <p>{t(`settings.agents.profiles.target.${scope}`)}</p>
        <p className="text-xs text-muted-foreground">
          {targets.join(", ") || "—"}
        </p>
      </td>
      <td className="px-4 py-3">{connection?.name ?? profile.connectionId}</td>
      <td className="pages-selectable px-4 py-3">
        {profile.model} ·{" "}
        {profile.reasoningEffort ?? t("settings.agents.reasoning.default")}
      </td>
      <td className="px-4 py-3">
        {profile.purposes
          .map((purpose) => t(`settings.agents.profiles.purpose.${purpose}`))
          .join(", ")}
      </td>
      <td className="px-4 py-3">
        {t(
          profile.isActive
            ? "settings.agents.profiles.active"
            : "settings.agents.profiles.inactive",
        )}
      </td>
      <td className="px-4 py-3">
        <AgentProfileUsability availability={availability} />
      </td>
      <td className="px-4 py-3">
        <AgentProfileActions profile={profile} onEdit={props.onEdit} />
      </td>
    </tr>
  );
}

function AgentProfileUsability(props: {
  readonly availability: AgentAvailability | undefined;
}): React.ReactElement {
  const { t } = useTranslation();
  if (!props.availability)
    return <span className="text-muted-foreground">—</span>;
  const reason = props.availability.reason;
  return (
    <>
      <p>
        {t(
          props.availability.isUsable
            ? "settings.agents.definition.usable"
            : "settings.agents.definition.blocked",
        )}
      </p>
      {reason ? (
        <p className="pages-selectable max-w-56 text-xs text-muted-foreground">
          {t(`agentExecution.error.${reason}`, {
            defaultValue: t(`settings.agents.error.${reason}`),
          })}
        </p>
      ) : null}
    </>
  );
}

function targetNames(
  profile: AgentProfile,
  directory: AgentProfileDirectory,
  t: TFunction,
): readonly string[] {
  const collections = {
    person: directory.persons,
    group: directory.groups,
    department: directory.departments,
  };
  return profile.targets.map((target) => {
    if (target.kind === "system")
      return `${t("settings.agents.profiles.target.system")} → ${t(`settings.agents.profiles.purpose.${target.targetId}`)}`;
    const name =
      collections[target.kind].find((entry) => entry.id === target.targetId)
        ?.name ?? target.targetId;
    return `${t(`settings.agents.profiles.target.${target.kind}`)}: ${name}`;
  });
}
