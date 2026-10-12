import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { Button } from "@/app/components/ui/button";
import { UserAvatar } from "@/app/components/common/user-avatar";
import { ConnectionTime } from "@/app/components/settings/connections/connection-time";

import type { ReactNode } from "react";
import type { McpPairingView } from "@/definition/McpPairing";

/** Presents unverified client metadata and the account that will grant access. */
export function PairingDetails({
  view,
}: {
  readonly view: McpPairingView;
}): React.ReactElement {
  const { t } = useTranslation();
  const fields: readonly (readonly [string, ReactNode])[] = [
    [t("mcpPairing.details.client"), view.clientName],
    [t("mcpPairing.details.device"), view.device],
    [t("mcpPairing.details.version"), view.packageVersion],
    [
      t("mcpPairing.details.requested"),
      <ConnectionTime key="requested" time={view.requestedAt ?? null} />,
    ],
  ];
  return (
    <dl className="space-y-3 text-sm">
      {fields.map(([label, content]) => (
        <div key={label} className="grid gap-1 sm:grid-cols-3">
          <dt className="font-medium">{label}</dt>
          <dd className="pages-selectable min-w-0 break-words sm:col-span-2">
            {content}
          </dd>
        </div>
      ))}
      <div className="grid gap-1 sm:grid-cols-3">
        <dt className="font-medium">{t("mcpPairing.details.account")}</dt>
        <dd className="min-w-0 sm:col-span-2">
          <span className="flex items-center gap-2">
            <UserAvatar user={view.account} size="sm" />
            <span className="pages-selectable min-w-0 break-words">
              {view.account.displayName} ({view.account.username})
            </span>
          </span>
          <Form method="post">
            <input type="hidden" name="intent" value="switch-account" />
            <Button variant="link" type="submit" className="min-h-11 px-0">
              {t("mcpPairing.details.switchAccount")}
            </Button>
          </Form>
        </dd>
      </div>
      <div>
        <dt className="sr-only">{t("mcpPairing.details.client")}</dt>
        <dd className="text-xs text-muted-foreground">
          {t("mcpPairing.details.clientHint")}
        </dd>
      </div>
    </dl>
  );
}
