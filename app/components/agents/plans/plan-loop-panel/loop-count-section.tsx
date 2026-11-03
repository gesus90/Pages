import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import {
  PLAN_LOOP_RUNS,
  PLAN_LOOP_RUNS_BINDING,
  isPlanLoopRuns,
  planLoopMode,
} from "@/definition/AgentPlanLoop";
import { planLoopBoundRuns } from "@/definition/AgentPlanLoopGraph";

import { planLoopEffectiveRuns } from "../plan-loop-summary";
import { PanelField, PanelNote, PanelSwitch } from "../plan-panel-controls";
import { LoopWhileSection } from "./loop-while-section";

import type {
  AgentPlanBinding,
  AgentPlanInput,
  AgentPlanSources,
} from "@/definition/AgentPlan";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";

interface CountProps {
  readonly loop: AgentPlanLoop;
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly isDisabled: boolean;
  readonly onChange: (loop: AgentPlanLoop) => void;
}

/** The counter as the menu shows it: the fixed number, or 0 for a bound count. */
function counterText(loop: AgentPlanLoop): string {
  return loop.runsSource === "parameter" ? "0" : String(loop.runs);
}

/**
 * A typed counter commits only as a whole number from 0 to 999; anything else stays visible and is refused.
 *
 * @remarks
 * 1 to 999 is a fixed count. 0 means the count is bound: a parameter or the
 * count output of a stack supplies it when the loop starts.
 */
function useCounterText(
  loop: AgentPlanLoop,
  onChange: (loop: AgentPlanLoop) => void,
): {
  readonly text: string;
  readonly isValid: boolean;
  readonly change: (text: string) => void;
} {
  const [text, setText] = useState(counterText(loop));
  const shown = counterText(loop);
  useEffect(() => {
    setText(shown);
  }, [shown]);
  function change(next: string): void {
    setText(next);
    const runs = /^[0-9]{1,4}$/u.test(next) ? Number(next) : Number.NaN;
    if (runs === 0) onChange({ ...loop, runsSource: "parameter" });
    else if (isPlanLoopRuns(runs))
      onChange({ ...loop, runs, runsSource: "value" });
  }
  const runs = /^[0-9]{1,4}$/u.test(text) ? Number(text) : Number.NaN;
  return { text, isValid: runs === 0 || isPlanLoopRuns(runs), change };
}

function CounterField(props: CountProps): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const field = useCounterText(props.loop, props.onChange);
  return (
    <PanelField
      id={id}
      label={t("plans.loops.runs.label")}
      info={{
        label: t("plans.loops.runs.infoLabel"),
        text: t("plans.loops.runs.counterInfo"),
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
          field.isValid
            ? "plans.loops.runs.counterHint"
            : "plans.loops.runs.counterInvalid",
          { maximum: PLAN_LOOP_RUNS.maximum },
        )}
      </p>
    </PanelField>
  );
}

/** The values that can supply a bound count: number parameters and the count output of every stack. */
interface CountSource {
  readonly value: string;
  readonly binding: AgentPlanBinding;
  readonly name: string;
}

function countSources(draft: AgentPlanInput): readonly CountSource[] {
  return draft.nodes.flatMap((node): CountSource[] => {
    if (node.type === "parameter")
      return [
        {
          value: `source:${node.id}`,
          binding: { kind: "source" as const, nodeId: node.id },
          name: node.name,
        },
      ];
    if (node.type !== "stack") return [];
    return [
      {
        value: `stack:${node.id}`,
        binding: {
          kind: "stack" as const,
          stackId: node.id,
          output: "count" as const,
        },
        name: node.name,
      },
    ];
  });
}

function bindingValue(binding: AgentPlanBinding | undefined): string {
  if (binding?.kind === "source") return `source:${binding.nodeId}`;
  return binding?.kind === "stack" ? `stack:${binding.stackId}` : "";
}

/** The bound source of the count; drawing a line to the loop's Count input chooses the same. */
function BoundField(props: CountProps): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const { loop, draft } = props;
  const sources = countSources(draft);
  const binding = loop.bindings[PLAN_LOOP_RUNS_BINDING];
  const runs = planLoopBoundRuns(binding, draft);
  function choose(value: string): void {
    const source = sources.find((entry) => entry.value === value);
    const rest = Object.fromEntries(
      Object.entries(loop.bindings).filter(
        ([name]) => name !== PLAN_LOOP_RUNS_BINDING,
      ),
    );
    props.onChange({
      ...loop,
      bindings: source
        ? { ...rest, [PLAN_LOOP_RUNS_BINDING]: source.binding }
        : rest,
    });
  }
  return (
    <PanelField
      id={id}
      label={t("plans.loops.runs.boundLabel")}
      info={{
        label: t("plans.loops.runs.parameterInfoLabel"),
        text: t("plans.loops.runs.boundInfo"),
      }}
    >
      <Select
        className="h-8"
        id={id}
        value={bindingValue(binding)}
        disabled={props.isDisabled || sources.length === 0}
        onValueChange={choose}
        placeholder={t("plans.loops.runs.parameterPlaceholder")}
        options={[
          { value: "", label: t("plans.loops.runs.parameterNone") },
          ...sources.map((source) => ({
            value: source.value,
            label: `${source.name} · ${planLoopBoundRuns(source.binding, draft) ?? "—"}`,
          })),
        ]}
      />
      <p
        className={
          runs === null
            ? "text-xs text-destructive"
            : "text-xs text-muted-foreground"
        }
      >
        {runs === null
          ? t("plans.loops.runs.boundInvalid")
          : t("plans.loops.runs.boundValue", { count: runs })}
      </p>
    </PanelField>
  );
}

/** The Count checkbox: on, the loop counts; off, it runs as a while loop. */
function CountToggle(props: CountProps): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const isCount = planLoopMode(props.loop) === "count";
  return (
    <label
      htmlFor={id}
      className="flex items-center gap-2 text-xs font-semibold"
    >
      <Checkbox
        id={id}
        checked={isCount}
        disabled={props.isDisabled}
        onChange={(event) =>
          props.onChange({
            ...props.loop,
            mode: event.target.checked ? "count" : "while",
          })
        }
      />
      {t("plans.loops.countToggle")}
    </label>
  );
}

/** Count or while: the counter with its bound source and the exact switch, or the while boolean. */
export function LoopCountSection(props: CountProps): React.ReactElement {
  const { t } = useTranslation();
  const { loop } = props;
  if (planLoopMode(loop) === "while")
    return (
      <div className="flex flex-col gap-4">
        <CountToggle {...props} />
        <LoopWhileSection {...props} />
      </div>
    );
  const runs = planLoopEffectiveRuns(props.draft, loop);
  return (
    <div className="flex flex-col gap-4">
      <CountToggle {...props} />
      <CounterField {...props} />
      {loop.runsSource === "parameter" ? <BoundField {...props} /> : null}
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
        isChecked={loop.countMode === "expected"}
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
