import {
  createPicaCodexRequests,
  registerPicaCodexRequests,
} from "./PicaCodexRegistration";
import { decidePicaHelperPermission } from "./PicaClaudeHelper";

/** Chat-only native protocol extensions, loaded at the chat boundary rather than by plan owners. */
export const acpPicaSupport = {
  createRequests: createPicaCodexRequests,
  registerRequests: registerPicaCodexRequests,
  decideHelperPermission: decidePicaHelperPermission,
};
