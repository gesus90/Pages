import { SquareTerminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Select } from "@/app/components/ui/select";
import { cn } from "@/app/lib/cn";
import { effectivePlanTarget } from "@/definition/AgentPlanTarget";
import { usePlanFlowContext } from "../plan-flow-context";
import { PLAN_NODE_TEXT } from "../plan-node-text";
import {
  planScriptProfileState,
  planScriptProfileText,
} from "../plan-script/plan-script-profile";
import { PLAN_CARD_FOOTER } from "./plan-card";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";
import type {
  PlanScriptProfileState,
  PlanScriptProfileText,
} from "../plan-script/plan-script-profile";

// The one field over the full width of the footer: the profile's tile, its
// name or choice and its status, inside the field's 1.5 px edge.
const PROFILE_FIELD_CLASS =
  "flex h-10 min-w-0 items-center gap-1.5 rounded-xl border-[1.5px] border-plan-script/40 bg-surface pr-2 pl-[5px]";
const PROFILE_SELECT_CLASS =
  "nodrag nopan nokey h-8 min-h-8 min-w-0 flex-1 border-0 bg-transparent px-1 text-xs leading-4 font-semibold shadow-none xl:h-8 xl:px-1 xl:text-xs [&>span]:min-w-0 [&>span]:truncate";

const TONES = {
  success: { text: "text-muted-foreground", dot: "bg-success-dot" },
  destructive: { text: "text-destructive", dot: "bg-destructive" },
  neutral: {
    text: "text-muted-foreground",
    dot: "border border-muted-foreground",
  },
};

/**
 * The interpreter profile of a script at the bottom of its card, where an
 * agent shows its model: one field over the full width of the footer.
 * @remarks
 * The profile is chosen among the profiles the server configures, by their
 * identifier. Beside it stand the version and a status dot that is never the
 * only sign: green with the version, red with a short reason, neutral while
 * unchecked; the full reason is in the tooltip and for screen readers. A
 * profile the server no longer configures stays named and red; nothing
 * replaces it.
 */
export function PlanScriptProfile(props: {
  readonly script: AgentPlanScript;
}): React.ReactElement {
  const { t } = useTranslation();
  const { sources, canEdit } = usePlanFlowContext();
  const { script } = props;
  const interpreters = sources.interpreters;
  const state = planScriptProfileState(
    script.interpreterProfileId,
    interpreters,
  );
  const text = planScriptProfileText(state, t);
  const name =
    state.kind === "missing" || state.kind === "unknown"
      ? t("plans.scripts.missingProfile", { id: script.interpreterProfileId })
      : state.profile.name;
  return (
    <footer className={PLAN_CARD_FOOTER}>
      <div
        data-plan-script-profile=""
        className={cn(
          PROFILE_FIELD_CLASS,
          state.kind === "missing" && "border-destructive",
        )}
      >
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-plan-script-subtle text-plan-script"
        >
          <SquareTerminal className="size-4" />
        </span>
        {canEdit && interpreters && interpreters.length > 0 ? (
          <ProfileChoice script={script} state={state} />
        ) : (
          <p
            className={cn(
              "min-w-0 flex-1 truncate px-1 text-xs leading-4 font-semibold",
              state.kind === "missing" && "text-destructive",
            )}
            title={name}
          >
            <span className="sr-only">{t("plans.scripts.profile")}: </span>
            {name}
          </p>
        )}
        <ProfileStatus name={name} text={text} />
      </div>
    </footer>
  );
}

/** The version or short reason and the status dot, with the complete status as text. */
function ProfileStatus(props: {
  readonly name: string;
  readonly text: PlanScriptProfileText;
}): React.ReactElement {
  const { t } = useTranslation();
  const { text } = props;
  const tone = TONES[text.tone];
  const status = [text.status, text.reason].filter(Boolean).join(" · ");
  const spoken = [text.tone === "success" ? text.short : null, status]
    .filter(Boolean)
    .join(" · ");
  return (
    <p
      className={cn(
        "flex max-w-[45%] min-w-0 shrink-0 items-center justify-end gap-1.5",
        PLAN_NODE_TEXT.meta,
        tone.text,
      )}
      title={`${props.name} · ${spoken}`}
    >
      <span className="truncate" aria-hidden="true">
        {text.short}
      </span>
      <span
        className={cn("size-2 shrink-0 rounded-full", tone.dot)}
        aria-hidden="true"
      />
      <span className="sr-only">
        {t("plans.scripts.profileStatus", {
          name: props.name,
          status: spoken,
        })}
      </span>
    </p>
  );
}

/** The configured profiles; a missing one stays listed, disabled and named. */
function ProfileChoice(props: {
  readonly script: AgentPlanScript;
  readonly state: PlanScriptProfileState;
}): React.ReactElement {
  const { t } = useTranslation();
  const { graph, sources, draft } = usePlanFlowContext();
  const { script, state } = props;
  function choose(interpreterProfileId: string): void {
    graph.replaceNode({ ...script, interpreterProfileId });
  }
  const target = effectivePlanTarget(script, draft);
  const options = (sources.interpreters ?? [])
    .filter((profile) =>
      target?.kind === "remote"
        ? profile.runnerWorkspaceId === target.workspaceId
        : !profile.runnerWorkspaceId,
    )
    .map((profile) => {
      const text = planScriptProfileText({ kind: profile.status, profile }, t);
      return {
        value: profile.id,
        label: profile.name,
        description: [profile.version, text.status, text.reason]
          .filter(Boolean)
          .join(" · "),
      };
    });
  return (
    <Select
      ariaLabel={t("plans.scripts.profile")}
      value={script.interpreterProfileId}
      className={cn(
        PROFILE_SELECT_CLASS,
        state.kind === "missing" && "text-destructive",
      )}
      options={[
        ...(state.kind === "missing"
          ? [
              {
                value: script.interpreterProfileId,
                label: t("plans.scripts.missingProfile", {
                  id: script.interpreterProfileId,
                }),
                disabled: true,
              },
            ]
          : []),
        ...options,
      ]}
      onValueChange={choose}
    />
  );
}
