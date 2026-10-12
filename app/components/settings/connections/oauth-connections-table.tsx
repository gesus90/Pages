import { useTranslation } from "react-i18next";
import { Button } from "@/app/components/ui/button";
import { HorizontalScrollArea } from "@/app/components/ui/horizontal-scroll-area";
import { ConnectionTime } from "./connection-time";
import type { McpConnectionsView } from "@/definition/McpConnections";
import type { ConnectionAction } from "./connection-action";

/** Lists only public OAuth grant facts, with owner revocation for active grants. */
export function OAuthConnectionsTable({
  grants,
  pending,
  onAction,
}: {
  readonly grants: McpConnectionsView["oauth"]["grants"];
  readonly pending: boolean;
  readonly onAction: (action: ConnectionAction) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <HorizontalScrollArea className="mt-5">
      <table tabIndex={0} className="w-full text-left text-sm">
        <caption className="sr-only">
          {t("settings.connections.oauth.title")}
        </caption>
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            {["client", "confirmed", "expires", "status", "actions"].map(
              (column) => (
                <th key={column} scope="col" className="p-3 font-medium">
                  {t(`settings.connections.oauth.columns.${column}`)}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {grants.map((grant) => (
            <tr
              key={grant.id}
              className="border-b border-border/60 last:border-0"
            >
              <td className="pages-selectable min-w-48 p-3 font-medium">
                {grant.clientName}
              </td>
              <td className="whitespace-nowrap p-3">
                <ConnectionTime time={grant.verifiedAt} />
              </td>
              <td className="whitespace-nowrap p-3">
                <ConnectionTime time={grant.expiresAt} unlimited />
              </td>
              <td className="p-3">
                {t(`settings.connections.stdio.status.${grant.status}`)}
              </td>
              <td className="p-3">
                {grant.status === "active" ? (
                  <Button
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      onAction({
                        intent: "revoke-oauth-grant",
                        id: grant.id,
                        name: grant.clientName,
                      })
                    }
                  >
                    {t("settings.connections.menu.revoke")}
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </HorizontalScrollArea>
  );
}
