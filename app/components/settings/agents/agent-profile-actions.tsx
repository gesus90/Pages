import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";

import { AgentProfileDelete } from "./agent-profile-delete";

import type {
  AgentProfile,
  AgentProfileDirectory,
} from "@/definition/AgentProfile";

/** Keeps edit and checked deletion in the administration row's overflow menu. */
export function AgentProfileActions(props: {
  readonly profile: AgentProfile;
  readonly directory: AgentProfileDirectory;
  readonly onEdit: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const [isDeleting, setDeleting] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-sm"
            variant="ghost"
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
            onSelect={() => setDeleting(true)}
          >
            {t("settings.agents.remove")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {isDeleting ? (
        <AgentProfileDelete
          profile={props.profile}
          directory={props.directory}
          onClose={() => setDeleting(false)}
        />
      ) : null}
    </>
  );
}
