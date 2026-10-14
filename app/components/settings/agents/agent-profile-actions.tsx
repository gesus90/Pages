import { MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";

import { AgentAssignmentResult } from "./agent-assignment-result";

import type { AgentProfile } from "@/definition/AgentProfile";
import type { AgentActionResult } from "@/app/lib/settings-actions/settings-agents-response.server";

/** Submits administrator deletion directly; the router revalidates the list after success. */
export function AgentProfileActions(props: {
  readonly profile: AgentProfile;
  readonly onEdit: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<AgentActionResult>();
  const isPending = fetcher.state !== "idle";
  function remove(): void {
    if (isPending) return;
    void fetcher.submit(
      { intent: "delete-profile", profileId: props.profile.id },
      { method: "post", action: "/settings/agents" },
    );
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={isPending}
            aria-label={t("settings.agents.actionsFor", {
              name: props.profile.name,
            })}
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={props.onEdit}>
            {t("settings.agents.edit")}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive"
            onSelect={remove}
            disabled={isPending}
          >
            {t("settings.agents.remove")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {isPending ? <p role="status">{t("settings.agents.loading")}</p> : null}
      {fetcher.data?.ok === false ? (
        <AgentAssignmentResult result={fetcher.data} />
      ) : null}
    </>
  );
}
