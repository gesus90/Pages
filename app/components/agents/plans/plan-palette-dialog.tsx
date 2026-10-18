import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { isAgentParameterName } from "@/definition/AgentParameters";

import type { AgentPlanSources } from "@/definition/AgentPlan";
import type { PlanPaletteRequest } from "./use-plan-node-palette";

interface PaletteDialogProps {
  readonly request: PlanPaletteRequest;
  readonly sources: AgentPlanSources;
  readonly blocked: string | null;
  readonly onConfirm: (reference: string) => void;
  readonly onClose: () => void;
}

/** Requires an explicit permitted source or valid name before a node is added. */
export function PlanPaletteDialog(
  props: PaletteDialogProps,
): React.ReactElement {
  const { t } = useTranslation();
  const [reference, setReference] = useState("");
  const { kind } = props.request;
  let isValid = reference.trim().length > 0;
  if (kind === "parameter") isValid = isAgentParameterName(reference);
  if (kind === "agent")
    isValid = props.sources.agents.some(
      (agent) => agent.id === reference && agent.availability.isUsable,
    );
  if (kind === "task")
    isValid = props.sources.tasks.some((task) => task.id === reference);
  function submit(event: React.FormEvent): void {
    event.preventDefault();
    if (isValid && !props.blocked) props.onConfirm(reference.trim());
  }
  function restoreFocus(event: Event): void {
    event.preventDefault();
    document
      .querySelector<HTMLButtonElement>(`[data-plan-palette-kind="${kind}"]`)
      ?.focus({ preventScroll: true });
  }
  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) props.onClose();
      }}
    >
      <DialogContent
        className="space-y-4 overflow-y-auto"
        onCloseAutoFocus={restoreFocus}
      >
        <DialogTitle className="text-lg font-semibold">
          {t("plans.palette.addTitle", { type: t(`plans.nodeType.${kind}`) })}
        </DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {t(`plans.palette.configure.${kind}`)}
        </DialogDescription>
        <form onSubmit={submit} className="space-y-4">
          <PaletteReference
            kind={kind}
            reference={reference}
            onChange={setReference}
            sources={props.sources}
            disabled={Boolean(props.blocked)}
          />
          <PaletteSourceNotice kind={kind} sources={props.sources} />
          {kind === "parameter" && reference && !isValid ? (
            <p className="text-xs text-destructive">
              {t("plans.validation.name")}
            </p>
          ) : null}
          {props.blocked ? (
            <p role="status" className="text-sm text-muted-foreground">
              {props.blocked}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={props.onClose}>
              {t("settings.agents.cancel")}
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!isValid || Boolean(props.blocked)}
            >
              {t("plans.palette.add")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PaletteSourceNotice(props: {
  readonly kind: PlanPaletteRequest["kind"];
  readonly sources: AgentPlanSources;
}): React.ReactElement | null {
  const { t } = useTranslation();
  let message: string | null = null;
  if (
    props.kind === "agent" &&
    !props.sources.agents.some((agent) => agent.availability.isUsable)
  )
    message = t("plans.palette.noAgents");
  if (props.kind === "task" && props.sources.tasks.length === 0)
    message = t("plans.palette.noTickets");
  return message ? (
    <p role="status" className="text-sm text-muted-foreground">
      {message}
    </p>
  ) : null;
}

function PaletteReference(props: {
  readonly kind: PlanPaletteRequest["kind"];
  readonly reference: string;
  readonly onChange: (reference: string) => void;
  readonly sources: AgentPlanSources;
  readonly disabled: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  if (props.kind === "task")
    return (
      <Select
        value={props.reference}
        onValueChange={props.onChange}
        ariaLabel={t("plans.ticketPicker.choose")}
        disabled={props.disabled}
        className="w-full min-w-0 [&>span]:truncate"
        options={[
          { value: "", label: t("plans.ticketPicker.choose") },
          ...props.sources.tasks.map((task) => ({
            value: task.id,
            label: `${task.key}: ${task.title}`,
          })),
        ]}
      />
    );
  if (props.kind === "agent")
    return (
      <Select
        ariaLabel={t("plans.palette.chooseAgent")}
        value={props.reference}
        onValueChange={props.onChange}
        disabled={props.disabled}
        className="w-full min-w-0 [&>span]:truncate"
        options={[
          { value: "", label: t("plans.palette.chooseAgent") },
          ...props.sources.agents
            .filter((agent) => agent.availability.isUsable)
            .map((agent) => ({ value: agent.id, label: agent.name })),
        ]}
      />
    );
  return (
    <label className="grid gap-1.5 text-sm">
      {t(
        props.kind === "parameter"
          ? "plans.parameterName"
          : "plans.groups.name",
      )}
      <Input
        value={props.reference}
        onChange={(event) => props.onChange(event.target.value)}
        maxLength={props.kind === "parameter" ? 64 : 120}
        disabled={props.disabled}
        required
      />
    </label>
  );
}
