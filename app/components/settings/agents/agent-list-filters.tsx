import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link } from "react-router";

import { Button, buttonVariants } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { AGENT_PROVIDERS } from "@/definition/AgentConnection";

import type { AgentFilters } from "@/definition/AgentFilters";
import type { AgentConnectionSummary } from "@/definition/AgentConnection";
import type { TFunction } from "i18next";

/** Sends filters to the central loader; the server retains every authorization check. */
export function AgentListFilters(props: {
  readonly filters: AgentFilters;
  readonly connections: readonly AgentConnectionSummary[];
}): React.ReactElement {
  const { t } = useTranslation();
  const [filters, setFilters] = useState(props.filters);
  const fields = filterFields(t, props.connections);
  return (
    <Form
      method="get"
      action="/settings/agents"
      className="flex flex-wrap items-end gap-2.5"
    >
      <label className="min-w-44 flex-1 space-y-1.5 text-xs font-medium">
        <span className="block">{t("settings.agents.definition.search")}</span>
        <Input
          name="agent_search"
          size="sm"
          defaultValue={filters.search}
          maxLength={200}
          placeholder={t("settings.agents.definition.searchPlaceholder")}
        />
      </label>
      {fields.map((field) => (
        <label
          key={field.name}
          className="min-w-32 space-y-1.5 text-xs font-medium"
        >
          <span className="block">
            {t(`settings.agents.definition.filter.${field.name}`)}
          </span>
          <input
            type="hidden"
            name={`agent_${field.name}`}
            value={filters[field.name]}
          />
          <Select
            className="w-full"
            value={filters[field.name]}
            ariaLabel={t(`settings.agents.definition.filter.${field.name}`)}
            onValueChange={(chosen) =>
              setFilters({ ...filters, [field.name]: chosen })
            }
            options={[
              { value: "", label: t("settings.agents.definition.all") },
              ...field.options,
            ]}
          />
        </label>
      ))}
      <Button type="submit" size="sm" variant="outline">
        {t("settings.agents.definition.applyFilters")}
      </Button>
      <Link
        to="/settings/agents"
        className={buttonVariants({ size: "sm", variant: "ghost" })}
      >
        {t("settings.agents.definition.resetFilters")}
      </Link>
    </Form>
  );
}

function filterFields(
  t: TFunction,
  connections: readonly AgentConnectionSummary[],
): readonly {
  readonly name: Exclude<keyof AgentFilters, "search">;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
  }[];
}[] {
  return [
    {
      name: "scope",
      options: ["person", "group", "department", "system"].map((scope) => ({
        value: scope,
        label: t(`settings.agents.profiles.target.${scope}`),
      })),
    },
    {
      name: "provider",
      options: [
        ...new Set(connections.map((connection) => connection.provider)),
      ].map((provider) => ({
        value: provider,
        label: t(AGENT_PROVIDERS[provider].labelKey),
      })),
    },
    {
      name: "connection",
      options: connections.map((connection) => ({
        value: connection.id,
        label: connection.name,
      })),
    },
    {
      name: "purpose",
      options: ["chat", "agent"].map((purpose) => ({
        value: purpose,
        label: t(`settings.agents.profiles.purpose.${purpose}`),
      })),
    },
    {
      name: "status",
      options: ["active", "inactive"].map((status) => ({
        value: status,
        label: t(`settings.agents.profiles.${status}`),
      })),
    },
    {
      name: "usability",
      options: ["usable", "blocked"].map((status) => ({
        value: status,
        label: t(`settings.agents.definition.${status}`),
      })),
    },
  ];
}
