import type { McpDeviceView } from "./McpDevice";
import type { PicaMobileSettingsView } from "./PicaMobile";

/** Public connections data of the settings; no token or hash is returned to a browser. */
export interface ConnectionsView {
  /** Only present for an administrator in the admin mode. */
  readonly picaMobile?: PicaMobileSettingsView;
  /** The machines paired with the account (PAGE-243); absent in an answer kept by an older build. */
  readonly mcpDevices?: readonly McpDeviceView[];
}
