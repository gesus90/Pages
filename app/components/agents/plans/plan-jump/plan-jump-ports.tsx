import { X } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";
import { unbindPlanParameter } from "@/definition/AgentPlanGroupEdit";

import { usePlanFlowContext } from "../plan-flow-context";
import { PlanFlowHandle } from "../plan-flow-handle";
import { planInTargetClass } from "../plan-flow-ports";
import { PLAN_NODE_TEXT } from "../plan-node-text";
import { isSamePlanConnection } from "./plan-jump-model";

import type { TFunction } from "i18next";
import type { AgentPlanBinding } from "@/definition/AgentPlan";
import type { PlanPortSpec } from "./plan-jump-model";

/** The mark in front of a failure output: its shape names it as well as its colour. */
const OUTPUT_MARKS: Readonly<Partial<Record<PlanPortSpec["kind"], string>>> = {
  error: "◆",
  timeout: "◇",
};

/** The colour of the name of an output; fixed names say what they are, so colour is never alone. */
const OUTPUT_TONES: Readonly<Partial<Record<PlanPortSpec["kind"], string>>> = {
  error: "text-destructive",
  timeout: "text-warning",
};

const ROW_BUTTON =
  "nodrag nopan h-7 min-h-7 gap-1.5 rounded-md border border-transparent px-1 text-left font-medium hover:bg-surface/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default xl:min-h-7 xl:px-1 xl:text-xs";

/** The shown name of a port: its fixed word or its declared name. */
export function planPortLabel(
  port: PlanPortSpec,
  translate: TFunction,
): string {
  return port.labelKey ? translate(port.labelKey) : port.text;
}

/** What a node's grid needs to draw and connect its ports. */
interface PlanPortContext {
  readonly nodeId: string;
  /** The node's name, which the controls of a row name. */
  readonly label: string;
  /** The bindings of the node, to offer releasing a bound input. */
  readonly bindings: Readonly<Record<string, AgentPlanBinding>>;
}

/** Releases the binding of one value input of a node and drops a selected line to it. */
function useDisconnect(nodeId: string): (parameter: string) => void {
  const { graph } = usePlanFlowContext();
  return (parameter) => {
    graph.edit((draft) => unbindPlanParameter(draft, nodeId, parameter));
    const link = graph.selectedLink;
    if (
      link?.kind === "data" &&
      link.to === nodeId &&
      link.parameter === parameter
    )
      graph.selectLink(null);
  };
}

function useHasIssue(nodeId: string, port: PlanPortSpec): boolean {
  const { graph } = usePlanFlowContext();
  const name = port.parameter ?? port.id;
  return (
    port.isInvalid ||
    graph.issues.some((issue) => issue.nodeId === nodeId && issue.port === name)
  );
}

/** A port the stored configuration no longer has: it only anchors the lines that still end there. */
function InvalidPort(props: {
  readonly context: PlanPortContext;
  readonly port: PlanPortSpec;
}): React.ReactElement {
  const { t } = useTranslation();
  const { port } = props;
  const isInput = port.side === "in";
  return (
    <div
      data-plan-port-invalid={port.id}
      className={cn(
        "relative flex h-8 items-center gap-1",
        isInput ? "justify-start" : "justify-end",
      )}
    >
      <PlanFlowHandle
        id={port.id}
        type={isInput ? "target" : "source"}
        kind={port.kind}
        hasIssue
      />
      <span
        title={t("plans.jump.invalidPort")}
        className={cn(
          "truncate text-destructive line-through",
          PLAN_NODE_TEXT.field,
        )}
      >
        {planPortLabel(port, t)}
      </span>
      <span className="sr-only">{t("plans.jump.invalidPort")}</span>
    </div>
  );
}

/** One input: a flow IN or a named value input with its handle, its connect button and its release. */
function InputPort(props: {
  readonly context: PlanPortContext;
  readonly port: PlanPortSpec;
}): React.ReactElement {
  const { t } = useTranslation();
  const { graph, canEdit } = usePlanFlowContext();
  const disconnect = useDisconnect(props.context.nodeId);
  const requiredId = useId();
  const { nodeId, label, bindings } = props.context;
  const { port } = props;
  const hasIssue = useHasIssue(nodeId, port);
  const name = planPortLabel(port, t);
  const isFlow = port.parameter === undefined;
  return (
    <div className="relative flex h-8 items-center gap-1">
      <PlanFlowHandle
        id={port.id}
        type="target"
        kind={port.kind}
        hasIssue={hasIssue}
      />
      <button
        type="button"
        data-plan-in={nodeId}
        data-plan-port={port.id}
        title={port.type ? `${name} · ${port.type}` : name}
        aria-label={
          isFlow
            ? t("plans.flowIn")
            : t("plans.bindPort", { parameter: name, name: label })
        }
        aria-describedby={port.isRequired ? requiredId : undefined}
        className={cn(
          ROW_BUTTON,
          "-ml-1.25 flex min-w-0 items-center",
          PLAN_NODE_TEXT.field,
          hasIssue && "text-destructive",
          planInTargetClass(graph, nodeId, port.parameter),
        )}
        disabled={!canEdit}
        onClick={() => graph.connect(nodeId, port.parameter)}
      >
        <span className="truncate">{name}</span>
        {port.isRequired ? (
          <span
            className={cn(
              "shrink-0 text-muted-foreground",
              PLAN_NODE_TEXT.meta,
            )}
          >
            {t("plans.jump.required")}
          </span>
        ) : null}
      </button>
      {port.isRequired ? (
        <span id={requiredId} className="sr-only">
          {t("plans.requiredValue")}
        </span>
      ) : null}
      {port.parameter !== undefined && bindings[port.parameter] ? (
        <button
          type="button"
          className="nodrag nopan flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-surface hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
          disabled={!canEdit}
          aria-label={t("plans.disconnect", { name })}
          title={t("plans.disconnect", { name })}
          onClick={() => disconnect(port.parameter ?? port.id)}
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/** One output: its name as the button that starts a line, and its handle on the right edge. */
function OutputPort(props: {
  readonly context: PlanPortContext;
  readonly port: PlanPortSpec;
}): React.ReactElement {
  const { t } = useTranslation();
  const { graph, canEdit } = usePlanFlowContext();
  const { nodeId, label } = props.context;
  const { port } = props;
  const hasIssue = useHasIssue(nodeId, port);
  const name = planPortLabel(port, t);
  const mark = OUTPUT_MARKS[port.kind];
  const connection = port.connection;
  return (
    <div className="relative flex h-8 items-center justify-end gap-2">
      <Button
        size="xs"
        variant="ghost"
        data-plan-out={nodeId}
        data-plan-out-kind={port.kind}
        data-plan-port={port.id}
        title={port.type ? `${name} · ${port.type}` : name}
        aria-label={t("plans.jump.startLine", { port: name, name: label })}
        className={cn(
          ROW_BUTTON,
          "-mr-1.25 max-w-full cursor-crosshair justify-end",
          PLAN_NODE_TEXT.field,
          OUTPUT_TONES[port.kind] ?? "text-foreground",
          hasIssue && "text-destructive",
          isSamePlanConnection(graph.connection, connection) &&
            "border-primary",
        )}
        disabled={!canEdit || connection === undefined}
        onClick={() => {
          if (connection) graph.begin(connection);
        }}
      >
        {mark ? <span aria-hidden="true">{mark}</span> : null}
        <span className="truncate">{name}</span>
      </Button>
      <PlanFlowHandle
        id={port.id}
        type="source"
        kind={port.kind}
        hasIssue={hasIssue}
      />
    </div>
  );
}

function PortRow(props: {
  readonly context: PlanPortContext;
  readonly port: PlanPortSpec;
}): React.ReactElement {
  if (props.port.isInvalid) return <InvalidPort {...props} />;
  return props.port.side === "in" ? (
    <InputPort {...props} />
  ) : (
    <OutputPort {...props} />
  );
}

/**
 * The ports of a card in two columns: the inputs on the left, the outputs on the right.
 * @remarks
 * Every port keeps its name visible and a labelled button for keyboards; the
 * handle is the dot a line is dragged from or to. A port that only lines still
 * use is struck through and marked invalid, so no line disappears silently.
 */
export function PlanPortGrid(props: {
  readonly nodeId: string;
  readonly label: string;
  readonly ports: readonly PlanPortSpec[];
  readonly bindings?: Readonly<Record<string, AgentPlanBinding>>;
}): React.ReactElement {
  const { t } = useTranslation();
  const context: PlanPortContext = {
    nodeId: props.nodeId,
    label: props.label,
    bindings: props.bindings ?? {},
  };
  return (
    <div
      role="group"
      aria-label={t("plans.jump.ports", { name: props.label })}
      data-plan-ports=""
      className="grid grid-cols-2 gap-x-3"
    >
      {(["in", "out"] as const).map((side) => (
        <div key={side} className="flex min-w-0 flex-col">
          {props.ports
            .filter((port) => port.side === side)
            .map((port) => (
              <PortRow
                key={`${side}:${port.id}`}
                context={context}
                port={port}
              />
            ))}
        </div>
      ))}
    </div>
  );
}
