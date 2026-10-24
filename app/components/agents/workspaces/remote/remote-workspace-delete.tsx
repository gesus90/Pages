import { WorkspaceDelete } from "../workspace-delete";

import type { RemoteWorkspaceView } from "@/definition/RemoteConnection";

/** Uses the shared reference confirmation for remote registrations, under remote project rights. */
export function RemoteWorkspaceDelete(props: {
  readonly workspace: RemoteWorkspaceView;
  readonly onClose: () => void;
}): React.ReactElement {
  return <WorkspaceDelete {...props} location="remote" />;
}
