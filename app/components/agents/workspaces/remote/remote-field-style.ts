/**
 * Outline of the inputs and dropdown triggers of the remote dialogs.
 *
 * @remarks
 * The 12 px radius matches the buttons (`rounded-lg`), and every field has
 * the same visible contour. The shared input and select keep their height:
 * 36 px from the desktop breakpoint on, larger touch targets below it.
 */
export const REMOTE_FIELD_CLASS =
  "rounded-lg border border-field-border hover:border-field-border-hover";

/** The searchable select's trigger at the height and type size of the other fields. */
export const REMOTE_SELECT_TRIGGER_CLASS = `${REMOTE_FIELD_CLASS} min-h-11 px-4 text-base xl:min-h-9 xl:px-3 xl:text-sm`;
