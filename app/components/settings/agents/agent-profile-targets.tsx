import { useTranslation } from "react-i18next";

import { AGENT_PROFILE_PURPOSES } from "@/definition/AgentProfile";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";

import type {
  AgentProfileDirectory,
  AgentProfilePurpose,
  AgentProfileTarget,
  AgentProfileTargetKind,
} from "@/definition/AgentProfile";

function includeSavedTargets(
  kind: AgentProfileTargetKind,
  entries: readonly { readonly id: string; readonly name: string }[],
  targets: readonly AgentProfileTarget[],
): readonly { readonly id: string; readonly name: string }[] {
  const missing = targets.filter(
    (target) =>
      target.kind === kind &&
      !entries.some((entry) => entry.id === target.targetId),
  );
  return [
    ...entries,
    ...missing.map((target) => ({
      id: target.targetId,
      name: target.targetId,
    })),
  ];
}

function TargetOption(props: {
  readonly name: string;
  readonly isChecked: boolean;
  readonly onToggle: (checked: boolean) => void;
}): React.ReactElement {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={props.isChecked}
        onChange={(event) => props.onToggle(event.target.checked)}
      />
      <span className="break-words">{props.name}</span>
    </label>
  );
}

/** Explicit scope choices keep global functions separate from people and organization scopes. */
export function AgentProfileTargets(props: {
  readonly directory: AgentProfileDirectory;
  readonly targets: readonly AgentProfileTarget[];
  readonly disabled: boolean;
  readonly onChange: (targets: readonly AgentProfileTarget[]) => void;
  readonly scope?: AgentProfileTargetKind;
  readonly isSharing?: boolean;
  readonly purposes?: readonly AgentProfilePurpose[];
  /** Overrides the accessible name of the group of choices. */
  readonly label?: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const sections = [
    { kind: "person", entries: props.directory.persons },
    { kind: "group", entries: props.directory.groups },
    { kind: "department", entries: props.directory.departments },
    {
      kind: "system",
      entries: AGENT_PROFILE_PURPOSES.map((purpose) => ({
        id: purpose,
        name: t(`settings.agents.profiles.purpose.${purpose}`),
      })),
    },
  ] as const;
  function toggle(target: AgentProfileTarget, checked: boolean): void {
    props.onChange(
      checked
        ? [...props.targets, target]
        : props.targets.filter(
            (entry) =>
              entry.kind !== target.kind || entry.targetId !== target.targetId,
          ),
    );
  }
  return (
    <section
      className="grid gap-4 sm:grid-cols-2"
      aria-label={
        props.label ??
        t(
          props.isSharing
            ? "settings.agents.definition.sharing"
            : "settings.agents.profiles.targets",
        )
      }
    >
      {sections
        .filter((section) => !props.isSharing || section.kind !== "system")
        .map((section) => (
          <fieldset
            key={section.kind}
            disabled={
              props.disabled ||
              (!props.isSharing &&
                props.scope !== undefined &&
                props.scope !== section.kind)
            }
            className="min-w-0 rounded-xl border border-border p-3 disabled:opacity-50"
          >
            <legend className="px-1 text-sm font-medium">
              {t(`settings.agents.profiles.target.${section.kind}`)}
            </legend>
            <VerticalScrollArea
              className="max-h-44"
              contentClassName="space-y-2 pb-10"
            >
              {includeSavedTargets(
                section.kind,
                section.entries.filter(
                  (entry) =>
                    section.kind !== "system" ||
                    props.purposes === undefined ||
                    props.purposes.some((purpose) => purpose === entry.id),
                ),
                props.targets,
              ).map((entry) => (
                <TargetOption
                  key={entry.id}
                  name={entry.name}
                  isChecked={props.targets.some(
                    (target) =>
                      target.kind === section.kind &&
                      target.targetId === entry.id,
                  )}
                  onToggle={(checked) =>
                    toggle({ kind: section.kind, targetId: entry.id }, checked)
                  }
                />
              ))}
            </VerticalScrollArea>
          </fieldset>
        ))}
    </section>
  );
}
