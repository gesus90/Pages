import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { Select } from "@/app/components/ui/select";

import type { AgentTicketChoice } from "@/definition/AgentParameters";

interface TicketChoicesResponse {
  readonly tickets?: readonly AgentTicketChoice[];
  readonly error?: string;
}

/** Selects a live authorized ticket identifier; unavailable references remain visible without disclosing ticket content. */
export function AgentTicketValue(props: {
  readonly ticketId: string;
  readonly disabled: boolean;
  readonly onChange: (ticketId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<TicketChoicesResponse>();
  const { load } = fetcher;
  useEffect(() => {
    void load("/agent-api/ticket-choices");
  }, [load]);
  const options = (fetcher.data?.tickets ?? []).map((ticket) => ({
    value: ticket.id,
    label: `${ticket.key}: ${ticket.title}`,
    disabled: false,
  }));
  if (
    props.ticketId &&
    !options.some((option) => option.value === props.ticketId)
  )
    options.push({
      value: props.ticketId,
      label: t("settings.agents.definition.unavailableTicket"),
      disabled: true,
    });
  return (
    <div className="space-y-1.5">
      <Select
        size="default"
        className="w-full"
        ariaLabel={t("settings.agents.definition.ticket")}
        value={props.ticketId}
        disabled={props.disabled || fetcher.state !== "idle"}
        options={[
          { value: "", label: t("settings.agents.definition.chooseTicket") },
          ...options,
        ]}
        onValueChange={props.onChange}
      />
      {fetcher.data?.error ? (
        <p role="alert" className="text-sm text-destructive">
          {t("settings.agents.error.parameter_ticket_unavailable")}
        </p>
      ) : null}
    </div>
  );
}
