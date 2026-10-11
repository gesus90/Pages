import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";

import { AgentAssignmentResult } from "./agent-assignment-result";

import type { AgentActionResult } from "@/app/lib/settings-actions/settings-agents-response.server";
import type {
  AgentProfile,
  AgentProfileDirectory,
} from "@/definition/AgentProfile";
import type { AgentUsage } from "@/definition/AgentUsage";
import type { TFunction } from "i18next";

/** Reads current uses before confirmation; atomic server deletion checks them again. */
export function AgentProfileDelete(props: {
  readonly profile: AgentProfile;
  readonly directory: AgentProfileDirectory;
  readonly onClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<AgentActionResult>();
  const { submit } = fetcher;
  const { onClose } = props;
  const id = props.profile.id;
  useEffect(() => {
    void submit(
      { intent: "profile-usages", profileId: id },
      { method: "post", action: "/settings/agents" },
    );
  }, [submit, id]);
  useEffect(() => {
    if (
      fetcher.state === "idle" &&
      fetcher.data?.ok &&
      fetcher.data.intent === "delete-profile"
    )
      onClose();
  }, [fetcher.state, fetcher.data, onClose]);
  const usages = fetcher.data?.ok ? fetcher.data.usages : undefined;
  const isPending = fetcher.state !== "idle";
  return (
    <Dialog open onOpenChange={props.onClose}>
      <DialogContent size="md">
        <DialogTitle className="text-lg font-semibold">
          {t("settings.agents.definition.deleteTitle", {
            name: props.profile.name,
          })}
        </DialogTitle>
        <DialogDescription className="mt-1.5 text-sm text-muted-foreground">
          {t("settings.agents.definition.deleteDescription")}
        </DialogDescription>
        {isPending ? (
          <p role="status" className="mt-4 text-sm">
            {t("settings.agents.loading")}
          </p>
        ) : null}
        {usages?.length ? (
          <VerticalScrollArea
            className="mt-4 max-h-60"
            contentClassName="pb-10"
          >
            <p className="text-sm font-medium">
              {t("settings.agents.definition.usedBy")}
            </p>
            <ul className="pages-selectable mt-2 space-y-1 text-sm">
              {usages.map((usage, index) => (
                <li key={index}>{usageLabel(usage, props.directory, t)}</li>
              ))}
            </ul>
          </VerticalScrollArea>
        ) : null}
        {fetcher.data?.ok === false ? (
          <AgentAssignmentResult result={fetcher.data} />
        ) : null}
        <fetcher.Form
          method="post"
          action="/settings/agents"
          className="mt-6 flex justify-end gap-2"
        >
          <input type="hidden" name="intent" value="delete-profile" />
          <input type="hidden" name="profileId" value={id} />
          <Button type="button" variant="ghost" onClick={props.onClose}>
            {t("settings.agents.cancel")}
          </Button>
          <Button
            type="submit"
            variant="destructive"
            disabled={isPending || usages === undefined || usages.length > 0}
          >
            {t("settings.agents.remove")}
          </Button>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}

function usageLabel(
  usage: AgentUsage,
  directory: AgentProfileDirectory,
  t: TFunction,
): string {
  if (usage.kind === "global")
    return t("settings.agents.definition.shareGlobally");
  if ("id" in usage)
    return t(`settings.agents.definition.usage.${usage.kind}`, {
      id: usage.id,
    });
  const target = usage.target;
  if (target.kind === "system")
    return t("settings.agents.definition.usage.assignment", {
      target: t(`settings.agents.profiles.purpose.${target.targetId}`),
    });
  const collections = {
    person: directory.persons,
    group: directory.groups,
    department: directory.departments,
  };
  const name =
    collections[target.kind].find((entry) => entry.id === target.targetId)
      ?.name ?? target.targetId;
  const label = `${t(`settings.agents.profiles.target.${target.kind}`)}: ${name}`;
  return t(`settings.agents.definition.usage.${usage.kind}`, { target: label });
}
