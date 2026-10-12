import { useTranslation } from "react-i18next";

import { GLOBAL_CONNECTION_SCOPE } from "@/definition/AgentConnectionScope";

import { AgentProfileTargets } from "./agent-profile-targets";

import type {
  AgentConnectionScope,
  AgentConnectionScopeTarget,
} from "@/definition/AgentConnectionScope";
import type {
  AgentProfileDirectory,
  AgentProfileTarget,
} from "@/definition/AgentProfile";

/** A system function is no usage target; the picker never offers one in sharing mode. */
function toScopeTargets(
  targets: readonly AgentProfileTarget[],
): AgentConnectionScopeTarget[] {
  return targets.flatMap((target) =>
    target.kind === "system"
      ? []
      : [{ kind: target.kind, targetId: target.targetId }],
  );
}

/** Chooses between global use and a union of persons, groups and departments. */
export function AgentScopeFields(props: {
  readonly scope: AgentConnectionScope;
  readonly directory: AgentProfileDirectory;
  readonly disabled: boolean;
  readonly onChange: (scope: AgentConnectionScope) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const isRestricted = props.scope.mode === "restricted";
  return (
    <fieldset className="space-y-3" disabled={props.disabled}>
      <legend className="text-sm font-semibold">
        {t("settings.agents.scope.title")}
      </legend>
      <p className="text-xs text-muted-foreground">
        {t("settings.agents.scope.description")}
      </p>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="radio"
          name="agent-scope-mode"
          className="mt-1"
          checked={!isRestricted}
          onChange={() => props.onChange(GLOBAL_CONNECTION_SCOPE)}
        />
        <span>
          <span className="font-medium">
            {t("settings.agents.scope.global")}
          </span>
          <span className="block text-xs text-muted-foreground">
            {t("settings.agents.scope.globalHint")}
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="radio"
          name="agent-scope-mode"
          className="mt-1"
          checked={isRestricted}
          onChange={() =>
            props.onChange({ mode: "restricted", targets: props.scope.targets })
          }
        />
        <span>
          <span className="font-medium">
            {t("settings.agents.scope.restricted")}
          </span>
          <span className="block text-xs text-muted-foreground">
            {t("settings.agents.scope.restrictedHint")}
          </span>
        </span>
      </label>
      {isRestricted ? (
        <>
          <AgentProfileTargets
            directory={props.directory}
            targets={props.scope.targets}
            disabled={props.disabled}
            isSharing
            label={t("settings.agents.scope.targets")}
            onChange={(targets) =>
              props.onChange({
                mode: "restricted",
                targets: toScopeTargets(targets),
              })
            }
          />
          {props.scope.targets.length === 0 ? (
            <p className="text-xs text-destructive">
              {t("settings.agents.scope.targetsRequired")}
            </p>
          ) : null}
        </>
      ) : null}
    </fieldset>
  );
}
