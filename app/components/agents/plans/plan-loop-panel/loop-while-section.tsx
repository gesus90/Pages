import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import {
  PLAN_LOOP_PATH_LENGTH,
  PLAN_LOOP_WHILE_BINDING,
  parsePlanLoopPath,
  planLoopMembers,
} from "@/definition/AgentPlanLoop";
import { planLoopParameterBoolean } from "@/definition/AgentPlanLoopGraph";

import { planNodeLabel } from "../plan-layout";
import { PanelField, PanelNote } from "../plan-panel-controls";

import type { AgentPlanInput, AgentPlanSources } from "@/definition/AgentPlan";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";

interface WhileProps {
  readonly loop: AgentPlanLoop;
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly isDisabled: boolean;
  readonly onChange: (loop: AgentPlanLoop) => void;
}

/** The parameter whose boolean the loop checks before its first iteration. */
function BooleanField(props: WhileProps): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const { loop, draft } = props;
  const parameters = draft.nodes.filter((node) => node.type === "parameter");
  const binding = loop.bindings[PLAN_LOOP_WHILE_BINDING];
  const boundId = binding?.kind === "source" ? binding.nodeId : "";
  const bound = parameters.find((node) => node.id === boundId);
  const value = planLoopParameterBoolean(bound);
  function choose(nodeId: string): void {
    const rest = Object.fromEntries(
      Object.entries(loop.bindings).filter(
        ([name]) => name !== PLAN_LOOP_WHILE_BINDING,
      ),
    );
    props.onChange({
      ...loop,
      bindings: nodeId
        ? { ...rest, [PLAN_LOOP_WHILE_BINDING]: { kind: "source", nodeId } }
        : rest,
    });
  }
  return (
    <PanelField
      id={id}
      label={t("plans.loops.while.label")}
      info={{
        label: t("plans.loops.while.infoLabel"),
        text: t("plans.loops.while.info"),
      }}
    >
      <Select
        className="h-8"
        id={id}
        value={boundId}
        disabled={props.isDisabled || parameters.length === 0}
        onValueChange={choose}
        placeholder={t("plans.loops.while.placeholder")}
        options={[
          { value: "", label: t("plans.loops.runs.parameterNone") },
          ...parameters.map((node) => ({
            value: node.id,
            label: `${node.name} · ${String(planLoopParameterBoolean(node) ?? "—")}`,
          })),
        ]}
      />
      <p
        className={
          value === null
            ? "text-xs text-destructive"
            : "text-xs text-muted-foreground"
        }
      >
        {value === null
          ? t("plans.loops.while.invalid")
          : t("plans.loops.while.value", { value: String(value) })}
      </p>
    </PanelField>
  );
}

/** Where the checks after the first iteration read their boolean: a member's result, or the parameter again. */
function LaterField(props: WhileProps): React.ReactElement {
  const { t } = useTranslation();
  const sourceId = useId();
  const pathId = useId();
  const { loop } = props;
  const later = loop.while ?? { sourceNodeId: "", outputPath: "$.weiter" };
  const isPathValid =
    later.sourceNodeId === "" || parsePlanLoopPath(later.outputPath) !== null;
  return (
    <>
      <PanelField
        id={sourceId}
        label={t("plans.loops.while.sourceLabel")}
        info={{
          label: t("plans.loops.while.sourceInfoLabel"),
          text: t("plans.loops.while.sourceInfo"),
        }}
      >
        <Select
          className="h-8"
          id={sourceId}
          value={later.sourceNodeId}
          disabled={props.isDisabled}
          onValueChange={(sourceNodeId) =>
            props.onChange({ ...loop, while: { ...later, sourceNodeId } })
          }
          options={[
            { value: "", label: t("plans.loops.while.sourceNone") },
            ...planLoopMembers(loop).map((member) => ({
              value: member.id,
              label: planNodeLabel(member, props.sources),
            })),
          ]}
        />
      </PanelField>
      {later.sourceNodeId === "" ? null : (
        <PanelField id={pathId} label={t("plans.loops.while.pathLabel")}>
          <Input
            id={pathId}
            size="sm"
            value={later.outputPath}
            maxLength={PLAN_LOOP_PATH_LENGTH}
            disabled={props.isDisabled}
            aria-invalid={!isPathValid}
            onChange={(event) =>
              props.onChange({
                ...loop,
                while: { ...later, outputPath: event.target.value },
              })
            }
            className="h-8 bg-muted/50 font-mono"
          />
        </PanelField>
      )}
    </>
  );
}

/**
 * The settings of a while loop: the boolean before the first iteration and where later checks read it.
 *
 * @remarks
 * The loop checks before every iteration, the first one included; `false`
 * leaves it through its exit. A value that is not exactly `true` or `false`
 * stops the run with a clear message and is never read as `false`.
 */
export function LoopWhileSection(props: WhileProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <BooleanField {...props} />
      <LaterField {...props} />
      <PanelNote>{t("plans.loops.while.explain")}</PanelNote>
    </div>
  );
}
