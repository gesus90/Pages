import { useTranslation } from "react-i18next";

import { useRegionFormatter } from "@/app/components/common/region-provider";
import { HorizontalScrollArea } from "@/app/components/ui/horizontal-scroll-area";
import { ConnectionMenu } from "./connection-menu";
import { ConnectionTime } from "./connection-time";

import type { PersonalAgentToken } from "@/definition/McpAuthorization";
import type { ConnectionAction } from "./connection-action";

function TokenRow({
  token,
  onAction,
}: {
  readonly token: PersonalAgentToken;
  readonly onAction: (action: ConnectionAction) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();
  const active = token.status === "active";
  const status =
    active && token.rotationRequestedAt !== null
      ? "rotationPending"
      : token.status;
  const color = {
    active: "bg-success-subtle text-success",
    rotationPending: "bg-muted text-info",
    expired: "bg-muted text-foreground",
    revoked: "bg-muted text-foreground",
  }[status];
  return (
    <tr className="border-b border-border/60 last:border-0">
      <td className="min-w-48 p-3">
        <p className="pages-selectable break-words font-medium">{token.name}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t(`settings.connections.stdio.source.${token.source}`)}
          {token.device ? ` · ${token.device}` : ""}
          {token.rotatedAt ? (
            <>
              {" "}
              ·{" "}
              {t("settings.connections.stdio.rotated", {
                time: formatDateTime(new Date(token.rotatedAt).toISOString()),
              })}
            </>
          ) : null}
        </p>
      </td>
      <td className="p-3">
        <span
          className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${color}`}
        >
          {t(`settings.connections.stdio.status.${status}`)}
        </span>
      </td>
      <td className="whitespace-nowrap p-3">
        <ConnectionTime time={token.createdAt} />
      </td>
      <td className="whitespace-nowrap p-3">
        <ConnectionTime time={token.lastUsedAt} />
      </td>
      <td className="whitespace-nowrap p-3">
        <ConnectionTime time={token.expiresAt} unlimited />
      </td>
      <td className="p-3">
        {active ? <ConnectionMenu token={token} onAction={onAction} /> : null}
      </td>
    </tr>
  );
}

/** Shows safe connection metadata with shared responsive scrolling and explicit status text. */
export function StdioConnectionsTable({
  tokens,
  onAction,
}: {
  readonly tokens: readonly PersonalAgentToken[];
  readonly onAction: (action: ConnectionAction) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <HorizontalScrollArea>
      <table tabIndex={0} className="w-full text-left text-sm">
        <caption className="sr-only">
          {t("settings.connections.stdio.title")}
        </caption>
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            {[
              "name",
              "status",
              "created",
              "lastUsed",
              "expires",
              "actions",
            ].map((column) => (
              <th
                key={column}
                scope="col"
                className="whitespace-nowrap p-3 font-medium"
              >
                {t(`settings.connections.stdio.column.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tokens.map((token) => (
            <TokenRow key={token.id} token={token} onAction={onAction} />
          ))}
        </tbody>
      </table>
    </HorizontalScrollArea>
  );
}
