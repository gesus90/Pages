import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import {
  PLAN_LOOP_PATH_LENGTH,
  PLAN_LOOP_VALUE_LENGTH,
  isPlanLoopConditionActive,
  parsePlanLoopPath,
} from "@/definition/AgentPlanLoop";

import { planNodeLabel } from "../plan-layout";
import { planLoopEffectiveRuns } from "../plan-loop-summary";
import { PanelField, PanelNote, PanelSwitch } from "../plan-panel-controls";

import type { AgentPlanInput, AgentPlanSources } from "@/definition/AgentPlan";
import type {
  AgentPlanLoop,
  AgentPlanLoopCondition,
  AgentPlanLoopValue,
} from "@/definition/AgentPlanLoop";

interface ConditionProps {
  readonly loop: AgentPlanLoop;
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly isDisabled: boolean;
  readonly onChange: (loop: AgentPlanLoop) => void;
}

const VALUE_TYPES = ["boolean", "number", "string", "null"] as const;

/** The condition a loop starts with when it is switched on: its first member, `$.end`, `true`. */
function startCondition(loop: AgentPlanLoop): AgentPlanLoopCondition {
  return {
    isEnabled: false,
    sourceNodeId: loop.steps.at(0)?.id ?? "",
    outputPath: "$.end",
    operator: "equals",
    expected: { type: "boolean", value: true },
  };
}

function emptyValue(type: AgentPlanLoopValue["type"]): AgentPlanLoopValue {
  if (type === "boolean") return { type, value: true };
  if (type === "number") return { type, value: 0 };
  if (type === "string") return { type, value: "" };
  return { type };
}

function valueText(value: AgentPlanLoopValue): string {
  if (value.type === "null") return "null";
  return value.type === "string"
    ? JSON.stringify(value.value)
    : String(value.value);
}

function PathField(props: {
  readonly condition: AgentPlanLoopCondition;
  readonly isDisabled: boolean;
  readonly onChange: (path: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState(props.condition.outputPath);
  useEffect(() => {
    setText(props.condition.outputPath);
  }, [props.condition.outputPath]);
  const isValid = parsePlanLoopPath(text) !== null;
  function change(next: string): void {
    setText(next);
    if (parsePlanLoopPath(next) !== null) props.onChange(next);
  }
  return (
    <PanelField
      id={id}
      label={t("plans.loops.condition.path")}
      info={{
        label: t("plans.loops.condition.pathInfoLabel"),
        text: t("plans.loops.condition.pathInfo"),
      }}
    >
      <Input
        id={id}
        size="sm"
        value={text}
        maxLength={PLAN_LOOP_PATH_LENGTH}
        disabled={props.isDisabled}
        aria-invalid={!isValid}
        aria-describedby={`${id}-hint`}
        onChange={(event) => change(event.target.value)}
        className="h-8 bg-muted/50 font-mono"
      />
      {isValid ? null : (
        <p id={`${id}-hint`} className="text-xs text-destructive">
          {t("plans.loops.condition.pathInvalid")}
        </p>
      )}
    </PanelField>
  );
}

function ExpectedValueField(props: {
  readonly value: AgentPlanLoopValue;
  readonly isDisabled: boolean;
  readonly onChange: (value: AgentPlanLoopValue) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const { value } = props;
  const [numberText, setNumberText] = useState(
    value.type === "number" ? String(value.value) : "0",
  );
  return (
    <PanelField
      id={id}
      label={`${t("plans.loops.condition.value")} · ${t(`plans.loops.condition.types.${value.type}`)}`}
    >
      {value.type === "boolean" ? (
        <Select
          className="h-8"
          id={id}
          value={String(value.value)}
          disabled={props.isDisabled}
          onValueChange={(text) =>
            props.onChange({ type: "boolean", value: text === "true" })
          }
          options={[
            { value: "true", label: "true" },
            { value: "false", label: "false" },
          ]}
        />
      ) : null}
      {value.type === "number" ? (
        <Input
          id={id}
          size="sm"
          inputMode="decimal"
          value={numberText}
          disabled={props.isDisabled}
          aria-invalid={!Number.isFinite(Number(numberText))}
          onChange={(event) => {
            setNumberText(event.target.value);
            const next = Number(event.target.value);
            if (event.target.value.trim() !== "" && Number.isFinite(next))
              props.onChange({ type: "number", value: next });
          }}
          className="h-8 bg-muted/50 font-mono"
        />
      ) : null}
      {value.type === "string" ? (
        <Input
          id={id}
          size="sm"
          value={value.value}
          maxLength={PLAN_LOOP_VALUE_LENGTH}
          disabled={props.isDisabled}
          onChange={(event) =>
            props.onChange({ type: "string", value: event.target.value })
          }
          className="h-8 bg-muted/50"
        />
      ) : null}
      {value.type === "null" ? (
        <p className="text-xs text-muted-foreground">
          {t("plans.loops.condition.nullValue")}
        </p>
      ) : null}
    </PanelField>
  );
}

/** Which note explains the condition: inactive in exact mode, checked, or switched off. */
function noteKey(isInactive: boolean, isActive: boolean): string {
  if (isInactive) return "plans.loops.condition.inactiveNote";
  return isActive
    ? "plans.loops.condition.noteOn"
    : "plans.loops.condition.noteOff";
}

/** The fields of the condition: source, path, comparison, type and expected value. */
function ConditionFields(props: {
  readonly loop: AgentPlanLoop;
  readonly condition: AgentPlanLoopCondition;
  readonly sources: AgentPlanSources;
  readonly isLocked: boolean;
  readonly onChange: (changes: Partial<AgentPlanLoopCondition>) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { condition, loop, isLocked } = props;
  const sourceId = useId();
  const typeId = useId();
  return (
    <div className="flex flex-col gap-4">
      <PanelField id={sourceId} label={t("plans.loops.condition.source")}>
        <Select
          className="h-8"
          id={sourceId}
          value={condition.sourceNodeId}
          disabled={isLocked || loop.steps.length === 0}
          onValueChange={(sourceNodeId) => props.onChange({ sourceNodeId })}
          placeholder={t("plans.loops.condition.sourcePlaceholder")}
          options={loop.steps.map((step) => ({
            value: step.id,
            label: `${planNodeLabel(step, props.sources)} · ${t(`plans.nodeType.${step.type}`)}`,
          }))}
        />
      </PanelField>
      <PathField
        condition={condition}
        isDisabled={isLocked}
        onChange={(outputPath) => props.onChange({ outputPath })}
      />
      <div className="grid grid-cols-2 gap-3">
        <PanelField
          id={`${sourceId}-op`}
          label={t("plans.loops.condition.operator")}
        >
          <Select
            className="h-8"
            id={`${sourceId}-op`}
            value="equals"
            disabled={isLocked}
            onValueChange={() => props.onChange({ operator: "equals" })}
            options={[
              { value: "equals", label: t("plans.loops.condition.equals") },
            ]}
          />
        </PanelField>
        <PanelField id={typeId} label={t("plans.loops.condition.type")}>
          <Select
            className="h-8"
            id={typeId}
            value={condition.expected.type}
            disabled={isLocked}
            onValueChange={(type) =>
              props.onChange({ expected: emptyValue(type) })
            }
            options={VALUE_TYPES.map((type) => ({
              value: type,
              label: t(`plans.loops.condition.types.${type}`),
            }))}
          />
        </PanelField>
      </div>
      <ExpectedValueField
        key={condition.expected.type}
        value={condition.expected}
        isDisabled={isLocked}
        onChange={(expected) => props.onChange({ expected })}
      />
    </div>
  );
}

/** The optional early end of a `max` loop: source, JSON path, comparison and a typed value. */
export function LoopConditionSection(
  props: ConditionProps,
): React.ReactElement {
  const { t } = useTranslation();
  const { loop } = props;
  const condition = loop.condition ?? startCondition(loop);
  const isInactive = loop.countMode === "expected";
  const isActive = isPlanLoopConditionActive(loop);
  function change(changes: Partial<AgentPlanLoopCondition>): void {
    props.onChange({ ...loop, condition: { ...condition, ...changes } });
  }
  const source = loop.steps.find((step) => step.id === condition.sourceNodeId);
  return (
    <div className="flex flex-col gap-4">
      <PanelSwitch
        label={t("plans.loops.condition.title")}
        info={{
          label: t("plans.loops.condition.infoLabel"),
          text: t("plans.loops.condition.info"),
        }}
        description={
          isInactive ? t("plans.loops.condition.inactive") : undefined
        }
        isChecked={condition.isEnabled}
        isDisabled={props.isDisabled}
        onChange={(isEnabled) => change({ isEnabled })}
      />
      <div aria-disabled={isInactive} data-inactive={isInactive}>
        <ConditionFields
          loop={loop}
          condition={condition}
          sources={props.sources}
          isLocked={props.isDisabled || isInactive}
          onChange={change}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {t("plans.loops.condition.summary", {
          source: source ? planNodeLabel(source, props.sources) : "—",
          path: condition.outputPath,
          value: valueText(condition.expected),
          type: t(`plans.loops.condition.types.${condition.expected.type}`),
          count: planLoopEffectiveRuns(props.draft, loop) ?? loop.runs,
        })}
      </p>
      <PanelNote tone={isInactive ? "warning" : "neutral"}>
        {t(noteKey(isInactive, isActive))}
      </PanelNote>
    </div>
  );
}
