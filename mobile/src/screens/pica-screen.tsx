import { useRouter } from "expo-router";

import { EmptySessionState } from "@/components/empty-session-state";
import { Screen } from "@/components/screen";
import { useConnection } from "@/connection/connection-provider";

/**
 * The main view of the app: Pica's conversations.
 *
 * @remarks
 * This version has no conversations to show, so it shows the empty state.
 */
export function PicaScreen(): React.ReactElement {
  const router = useRouter();
  const connection = useConnection();

  return (
    <Screen>
      <EmptySessionState
        host={connection.host}
        onSetUpServer={() => router.navigate("/settings")}
        status={connection.status}
      />
    </Screen>
  );
}
