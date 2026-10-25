import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { ProviderIcon } from "./provider-icon";

import type { OpenCodeProviderLink } from "@/definition/AgentConnection";

const STATE_CLASS: Readonly<Record<OpenCodeProviderLink["state"], string>> = {
  linked: "text-success",
  auth_failed: "text-destructive",
  unchecked: "text-muted-foreground",
  missing: "text-muted-foreground",
};

function ProviderRow({
  link,
}: {
  readonly link: OpenCodeProviderLink;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5">
      <ProviderIcon provider={link.provider} className="size-5" />
      <span className="text-sm font-medium">
        {t(`settings.agents.provider.${link.provider}`)}
      </span>
      <span
        className={cn("min-w-0 text-xs wrap-anywhere", STATE_CLASS[link.state])}
      >
        {t(`settings.agents.openCodeLink.${link.state}`, {
          connection: link.connectionName ?? "",
        })}
      </span>
    </li>
  );
}

/**
 * Lists which API keys stored in Pages OpenCode receives automatically.
 *
 * @remarks
 * No key is shown or entered here: a key is stored once, with its API
 * connection, and OpenCode receives it after a passed access check.
 */
export function AgentOpenCodeProviders({
  links,
}: {
  readonly links: readonly OpenCodeProviderLink[];
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <section className="space-y-1" aria-labelledby="agent-opencode-providers">
      <h4 id="agent-opencode-providers" className="text-sm font-medium">
        {t("settings.agents.openCodeProviders")}
      </h4>
      <p className="text-xs text-muted-foreground">
        {t("settings.agents.openCodeProvidersHint")}
      </p>
      <ul className="divide-y divide-border">
        <li className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5">
          <ProviderIcon provider="opencode" className="size-5" />
          <span className="text-sm font-medium">
            {t("settings.agents.openCodeFreeGroup")}
          </span>
          <span className="text-xs text-success">
            {t("settings.agents.openCodeLink.free")}
          </span>
        </li>
        {links.map((link) => (
          <ProviderRow key={link.provider} link={link} />
        ))}
      </ul>
    </section>
  );
}
