/**
 * Focuses an element as soon as React attaches it.
 *
 * @remarks
 * Pass it as `ref={focusOnMount}` to a field that appears after a deliberate
 * user action, such as starting an inline edit. It replaces `autoFocus`,
 * which assistive technology cannot tell apart from focus that moves on page
 * load. As a stable module-level function it runs on mount only, so a
 * re-render never takes the focus away from the user.
 *
 * @param element - The mounted element, or `null` when React detaches it.
 */
export function focusOnMount(element: HTMLElement | null): void {
  element?.focus();
}
