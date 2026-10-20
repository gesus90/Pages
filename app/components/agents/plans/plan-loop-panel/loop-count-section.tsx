import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { SegmentedControl } from "@/app/components/ui/segmented-control";
import {
  PLAN_LOOP_RUNS,
  PLAN_LOOP_RUNS_BINDING,
  isPlanLoopRuns,
} from "@/definition/AgentPlanLoop";
import { planLoopParameterRuns } from "@/definition/AgentPlanLoopGraph";

import {
  planLoopEffectiveRuns,
  planLoopParameterNode,
} from "../plan-loop-summary";
import { PanelField, PanelNote, PanelSwitch } from "../plan-panel-controls";

import type { AgentPlanInput } from "@/definition/AgentPlan";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";

interface CountProps {
  readonly loop: AgentPlanLoop;
  readonly draft: AgentPlanInput;
  readonly isDisabled: boolean;
  readonly onChange: (loop: AgentPlanLoop) => void;
}

/** A typed count commits only as a whole number from 1 to 999; anything else stays visible and is refused. */
function useRunsText(
  loop: AgentPlanLoop,
  onChange: (loop: AgentPlanLoop) => void,
): {
  readonly text: string;
  readonly isValid: boolean;
  readonly change: (text: string) => void;
} {
  const [text, setText] = useState(String(loop.runs));
  useEffect(() => {
    setText(String(loop.runs));
  }, [loop.runs]);
  function change(next: string): void {
    setText(next);
    const runs = /^[0-9]{1,4}$/u.test(next) ? Number(next) : Number.NaN;
    if (isPlanLoopRuns(runs)) onChange({ ...loop, runs });
  }
  const runs = /^[0-9]{1,4}$/u.test(text) ? Number(text) : Number.NaN;
  return { text, isValid: isPlanLoopRuns(runs), change };
}

function ValueField(props: CountProps): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const field = useRunsText(props.loop, props.onChange);
  return (
    <PanelField
      id={id}
      label={t("plans.loops.runs.label")}
      info={{
        label: t("plans.loops.runs.infoLabel"),
        text: t("plans.loops.runs.info"),
      }}
    >
      <Input
        id={id}
        size="sm"
        inputMode="numeric"
        value={field.text}
        disabled={props.isDisabled}
        aria-invalid={!field.isValid}
        aria-describedby={`${id}-hint`}
        onChange={(event) => field.change(event.target.value)}
        className="h-8 bg-muted/50"
      />
      <p
        id={`${id}-hint`}
        className={
          field.isValid
            ? "text-xs text-muted-foreground"
            : "text-xs text-destructive"
        }
      >
        {t(
          field.isValid ? "plans.loops.runs.hint" : "plans.loops.runs.invalid",
          { minimum: PLAN_LOOP_RUNS.minimum, maximum: PLAN_LOOP_RUNS.maximum },
        )}
      </p>
    </PanelField>
  );
}

function ParameterField(props: CountProps): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const parameters = props.draft.nodes.filter(
    (node) => node.type === "parameter",
  );
  const bound = planLoopParameterNode(props.draft, props.loop);
  const runs = planLoopEffectiveRuns(props.draft, props.loop);
  function choose(nodeId: string): void {
    props.onChange({
      ...props.loop,
      bindings: nodeId
        ? { [PLAN_LOOP_RUNS_BINDING]: { kind: "source", nodeId } }
        : {},
    });
  }
  return (
    <PanelField
      id={id}
      label={t("plans.loops.runs.parameterLabel")}
      info={{
        label: t("plans.loops.runs.parameterInfoLabel"),
        text: t("plans.loops.runs.parameterInfo"),
      }}
    >
      <Select
        className="h-8"
        id={id}
        value={bound?.id ?? ""}
        disabled={props.isDisabled || parameters.length === 0}
        onValueChange={choose}
        placeholder={t("plans.loops.runs.parameterPlaceholder")}
        options={[
          { value: "", label: t("plans.loops.runs.parameterNone") },
          ...parameters.map((node) => ({
            value: node.id,
            label: `${node.name} · ${planLoopParameterRuns(node) ?? "—"}`,
          })),
        ]}
      />
      {parameters.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("plans.loops.runs.noParameters")}
        </p>
      ) : (
        <p
          className={
            runs === null
              ? "text-xs text-destructive"
              : "text-xs text-muted-foreground"
          }
        >
          {runs === null
            ? t("plans.loops.runs.parameterInvalid")
            : t("plans.loops.runs.parameterValue", {
                name: bound?.name ?? "",
                count: runs,
              })}
        </p>
      )}
    </PanelField>
  );
}

/** The source of the count, the count itself and the exact switch with what they mean together. */
export function LoopCountSection(props: CountProps): React.ReactElement {
  const { t } = useTranslation();
  const { loop } = props;
  const runs = planLoopEffectiveRuns(props.draft, loop);
  const isExact = loop.countMode === "expected";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold">
          {t("plans.loops.source.label")}
        </span>
        <SegmentedControl
          ariaLabel={t("plans.loops.source.label")}
          value={loop.runsSource}
          onValueChange={(runsSource) =>
            props.onChange({ ...loop, runsSource })
          }
          options={[
            { value: "value", label: t("plans.loops.source.value") },
            { value: "parameter", label: t("plans.loops.source.parameter") },
          ]}
          className="w-full [&>button]:flex-1 [&>button]:justify-center"
        />
      </div>
      {loop.runsSource === "value" ? (
        <ValueField {...props} />
      ) : (
        <ParameterField {...props} />
      )}
      <PanelSwitch
        label={t("plans.loops.exact.label")}
        info={{
          label: t("plans.loops.exact.infoLabel"),
          text: t("plans.loops.exact.info"),
        }}
        description={
          runs === null
            ? t(`plans.loops.mode.${loop.countMode}Unresolved`)
            : t(`plans.loops.mode.${loop.countMode}Line`, { count: runs })
        }
        isChecked={isExact}
        isDisabled={props.isDisabled}
        onChange={(isChecked) =>
          props.onChange({ ...loop, countMode: isChecked ? "expected" : "max" })
        }
      />
      <PanelNote>
        {runs === null
          ? t(`plans.loops.mode.${loop.countMode}Unresolved`)
          : t(`plans.loops.mode.${loop.countMode}Explain`, { count: runs })}
      </PanelNote>
    </div>
  );
}
