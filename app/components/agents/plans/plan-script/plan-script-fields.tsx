import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import { cn } from "@/app/lib/cn";
import {
  PLAN_SCRIPT_CONTENT_LENGTH,
  PLAN_SCRIPT_NAME_LENGTH,
  PLAN_SCRIPT_TIMEOUT,
} from "@/definition/AgentPlanScript";
import {
  planScriptProfileState,
  planScriptProfileText,
} from "./plan-script-profile";
import type { AgentPlanInterpreter } from "@/definition/AgentPlanScript";
import type {
  PlanScriptFieldIssue,
  PlanScriptForm,
} from "./use-plan-script-form";

const LABEL_CLASS = "block text-sm font-medium";

/** The message below a field: its problem, or a hint while it has none. */
export function PlanScriptFieldMessage(props: {
  readonly id: string;
  readonly issue: PlanScriptFieldIssue | null;
  readonly hint?: string;
}): React.ReactElement | null {
  const { t, i18n } = useTranslation();
  if (props.issue)
    return (
      <p id={props.id} className="text-xs text-destructive">
        {t(`plans.scripts.validation.${props.issue}`, {
          maximum: PLAN_SCRIPT_CONTENT_LENGTH.toLocaleString(i18n.language),
          minimum: PLAN_SCRIPT_TIMEOUT.minimum,
          timeout: PLAN_SCRIPT_TIMEOUT.maximum,
        })}
      </p>
    );
  return props.hint ? (
    <p id={props.id} className="text-xs text-muted-foreground">
      {props.hint}
    </p>
  ) : null;
}

/** The first shown problem of a field among the ones it can have. */
function shownIssue(
  form: PlanScriptForm,
  field: Parameters<PlanScriptForm["isShown"]>[0],
  candidates: readonly PlanScriptFieldIssue[],
): PlanScriptFieldIssue | null {
  if (!form.isShown(field)) return null;
  return candidates.find((issue) => form.issues.fields.has(issue)) ?? null;
}

/** The name of the script, as its card shows it. */
export function PlanScriptNameField(props: {
  readonly form: PlanScriptForm;
}): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const issue = shownIssue(props.form, "name", ["name"]);
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={LABEL_CLASS}>
        {t("plans.scripts.name")}
      </label>
      <Input
        id={id}
        value={props.form.values.name}
        maxLength={PLAN_SCRIPT_NAME_LENGTH}
        autoComplete="off"
        aria-invalid={issue !== null}
        aria-describedby={`${id}-message`}
        data-plan-script-field="name"
        onChange={(event) => props.form.change({ name: event.target.value })}
      />
      <PlanScriptFieldMessage id={`${id}-message`} issue={issue} />
    </div>
  );
}

/** One configured profile as the choice lists it: its version and status. */
function profileOption(
  profile: AgentPlanInterpreter,
  translate: ReturnType<typeof useTranslation>["t"],
): {
  readonly value: string;
  readonly label: string;
  readonly description: string;
} {
  const text = planScriptProfileText(
    { kind: profile.status, profile },
    translate,
  );
  return {
    value: profile.id,
    label: profile.name,
    description: [profile.version, text.status, text.reason]
      .filter(Boolean)
      .join(" · "),
  };
}

/**
 * The interpreter profile, chosen among the profiles the server configures.
 *
 * @remarks
 * Local profiles show their status and inherited workspace. Remote targets
 * never inherit a local interpreter check. A saved profile the server no longer
 * configures stays chosen and is named as missing until another is chosen.
 */
export function PlanScriptProfileField(props: {
  readonly form: PlanScriptForm;
  readonly interpreters: readonly AgentPlanInterpreter[] | undefined;
}): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const { form } = props;
  const selected = form.values.interpreterProfileId;
  const issue = shownIssue(form, "interpreterProfileId", [
    "profile",
    "profileMissing",
  ]);
  const target = form.values.executionTarget;
  const options = (props.interpreters ?? [])
    .filter((profile) =>
      target.kind === "remote"
        ? profile.runnerWorkspaceId === target.workspaceId
        : !profile.runnerWorkspaceId,
    )
    .map((profile) => profileOption(profile, t));
  const isListed = options.some((option) => option.value === selected);
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={LABEL_CLASS}>
        {t("plans.scripts.profile")}
      </label>
      <Select
        id={id}
        ariaLabel={t("plans.scripts.profile")}
        value={selected}
        className={cn(
          "w-full min-w-0 [&>span]:truncate",
          (issue !== null || form.isProfileWithdrawn) &&
            "border-destructive text-destructive",
        )}
        options={[
          ...(selected && !isListed
            ? [
                {
                  value: selected,
                  label: t("plans.scripts.missingProfile", { id: selected }),
                  disabled: true,
                },
              ]
            : []),
          ...(selected
            ? []
            : [{ value: "", label: t("plans.scripts.chooseProfile") }]),
          ...options,
        ]}
        onValueChange={(interpreterProfileId) =>
          form.change({ interpreterProfileId })
        }
      />
      <PlanScriptFieldMessage id={`${id}-message`} issue={issue} />
      {issue === null ? (
        <ProfileStatusLine
          profileId={selected}
          isLocalTarget={target.kind === "local"}
          interpreters={props.interpreters}
        />
      ) : null}
    </div>
  );
}

/** Shows the actual profile check; only local targets inherit the plan workspace. */
function ProfileStatusLine(props: {
  readonly isLocalTarget: boolean;
  readonly profileId: string;
  readonly interpreters: readonly AgentPlanInterpreter[] | undefined;
}): React.ReactElement {
  const { t } = useTranslation();
  const state = planScriptProfileState(props.profileId, props.interpreters);
  const text = planScriptProfileText(state, t);
  const parts = props.profileId
    ? [
        state.kind === "ok" ? state.profile.version : null,
        text.status,
        text.reason,
      ]
    : [];
  return (
    <p
      className={cn(
        "text-xs",
        text.tone === "destructive" && props.profileId
          ? "text-destructive"
          : "text-muted-foreground",
      )}
    >
      {[...parts, props.isLocalTarget ? t("plans.scripts.workspace") : null]
        .filter(Boolean)
        .join(" · ")}
    </p>
  );
}

/** The script text: a plain monospaced field, no code editor and no highlighting. */
export function PlanScriptContentField(props: {
  readonly form: PlanScriptForm;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const id = useId();
  const { form } = props;
  const issue = shownIssue(form, "content", ["content", "contentLength"]);
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={LABEL_CLASS}>
        {t("plans.scripts.content")}
      </label>
      <Textarea
        id={id}
        rows={4}
        value={form.values.content}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        wrap="off"
        aria-invalid={issue !== null}
        aria-describedby={`${id}-message`}
        data-plan-script-field="content"
        className="font-mono text-xs leading-4.5 xl:text-xs"
        onChange={(event) => form.change({ content: event.target.value })}
      />
      <PlanScriptFieldMessage
        id={`${id}-message`}
        issue={issue}
        hint={t("plans.scripts.contentCount", {
          count: form.values.content.length.toLocaleString(i18n.language),
          maximum: PLAN_SCRIPT_CONTENT_LENGTH.toLocaleString(i18n.language),
        })}
      />
    </div>
  );
}

/** The allowed run time in whole seconds. */
export function PlanScriptTimeoutField(props: {
  readonly form: PlanScriptForm;
}): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const { form } = props;
  const issue = shownIssue(form, "timeout", ["timeout"]);
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={LABEL_CLASS}>
        {t("plans.scripts.timeout")}
      </label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={PLAN_SCRIPT_TIMEOUT.minimum}
        max={PLAN_SCRIPT_TIMEOUT.maximum}
        step={1}
        value={form.values.timeout}
        aria-invalid={issue !== null}
        aria-describedby={`${id}-message`}
        data-plan-script-field="timeout"
        className="max-w-40"
        onChange={(event) => form.change({ timeout: event.target.value })}
      />
      <PlanScriptFieldMessage
        id={`${id}-message`}
        issue={issue}
        hint={t("plans.scripts.timeoutHint", {
          minimum: PLAN_SCRIPT_TIMEOUT.minimum,
          maximum: PLAN_SCRIPT_TIMEOUT.maximum,
          initial: PLAN_SCRIPT_TIMEOUT.initial,
        })}
      />
    </div>
  );
}
