import { X } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";
import { PLAN_PORT } from "@/definition/AgentPlanBranching";
import { unbindPlanParameter } from "@/definition/AgentPlanGroupEdit";

import { usePlanFlowContext } from "../plan-flow-context";
import { PlanFlowHandle } from "../plan-flow-handle";
import { planInTargetClass } from "../plan-flow-ports";
import { PLAN_NODE_TEXT } from "../plan-node-text";
import { PlanCardColumns } from "../plan-node-card/plan-card";
import { isSamePlanConnection } from "./plan-jump-model";

import type { TFunction } from "i18next";
import type { AgentPlanBinding } from "@/definition/AgentPlan";
import type { PlanFlowDots } from "../plan-flow-ports";
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
  "nodrag nopan h-7 min-h-7 gap-1.5 rounded-md border border-transparent px-1 text-left font-normal hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default xl:min-h-7 xl:px-1 xl:text-xs";

/** Whether a port is a valid flow port, which the card draws as a dot on its header edge. */
function isHeaderFlowPort(port: PlanPortSpec): boolean {
  return (
    port.kind === "flow" &&
    !port.isInvalid &&
    (port.id === PLAN_PORT.flowIn || port.id === PLAN_PORT.flowOut)
  );
}

/**
 * The flow dots on the header of a card with a port grid, from its stored ports.
 * @remarks
 * A receiving Jump has no flow input. The flow OUT of a calling Jump is
 * named by what it waits for; that name becomes the tooltip of the dot.
 */
export function planPortGridDots(
  ports: readonly PlanPortSpec[],
  translate: TFunction,
): PlanFlowDots {
  const flowOut = ports.find(
    (port) => port.side === "out" && isHeaderFlowPort(port),
  );
  return {
    hasIn: ports.some((port) => port.side === "in" && isHeaderFlowPort(port)),
    hasOut: flowOut !== undefined,
    outLabel:
      flowOut && flowOut.labelKey !== "plans.flowOutShort"
        ? planPortLabel(flowOut, translate)
        : undefined,
  };
}

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
          "-ml-1 flex min-w-0 items-center text-muted-foreground",
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
          "-mr-1 max-w-full cursor-crosshair justify-end",
          PLAN_NODE_TEXT.field,
          OUTPUT_TONES[port.kind] ?? "text-muted-foreground",
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
 * handle is the dot a line is dragged from or to. The valid flow ports are
 * the dots on the card header, so the grid leaves them out. A port that only
 * lines still use is struck through and marked invalid, so no line
 * disappears silently.
 */
export function PlanPortGrid(props: {
  readonly nodeId: string;
  readonly label: string;
  readonly ports: readonly PlanPortSpec[];
  readonly bindings?: Readonly<Record<string, AgentPlanBinding>>;
  /** Rows above the inputs in the left column, such as the name of a signal. */
  readonly leadingInputs?: React.ReactNode;
}): React.ReactElement {
  const { t } = useTranslation();
  const context: PlanPortContext = {
    nodeId: props.nodeId,
    label: props.label,
    bindings: props.bindings ?? {},
  };
  const ports = props.ports.filter((port) => !isHeaderFlowPort(port));
  function rows(side: PlanPortSpec["side"]): React.ReactNode {
    return ports
      .filter((port) => port.side === side)
      .map((port) => (
        <PortRow key={`${side}:${port.id}`} context={context} port={port} />
      ));
  }
  return (
    <div data-plan-ports="" className="contents">
      <PlanCardColumns
        label={t("plans.jump.ports", { name: props.label })}
        inputs={
          <>
            {props.leadingInputs}
            {rows("in")}
          </>
        }
        outputs={rows("out")}
      />
    </div>
  );
}
