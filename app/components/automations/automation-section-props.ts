import type { AutomationOptions } from "@/definition/Automation";
import type { AutomationDraft, DraftChange } from "./automation-draft";
import type { LabelContext } from "./automation-time-format";

/** What every field section of the panel receives. */
export interface SectionProps {
  readonly draft: AutomationDraft;
  readonly change: DraftChange;
  /** Shows the saved values instead of inputs. */
  readonly isReadOnly: boolean;
  readonly options: AutomationOptions;
  readonly context: LabelContext;
}
