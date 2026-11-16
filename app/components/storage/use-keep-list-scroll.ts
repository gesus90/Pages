import { useLayoutEffect, useRef } from "react";

/** The scrolling element of the list and where it stood. */
interface ListPlace {
  readonly element: HTMLElement;
  readonly top: number;
}

/**
 * Keeps the scroll position of the list while a preview hides it.
 * @param isHidden - Whether the list is hidden behind a preview.
 * @returns A scroll handler for the element around the list.
 * @remarks
 * A browser may forget the position of an element that is not displayed, so
 * the position is remembered while the list scrolls and put back before the
 * list shows again. Nothing is remembered across a full reload.
 */
export function useKeepListScroll(
  isHidden: boolean,
): (event: React.UIEvent<HTMLElement>) => void {
  const place = useRef<ListPlace | null>(null);
  const isHiddenNow = useRef(isHidden);

  useLayoutEffect(() => {
    isHiddenNow.current = isHidden;

    if (isHidden) return;

    const remembered = place.current;

    if (remembered?.element.isConnected === true) {
      remembered.element.scrollTop = remembered.top;
    }
  }, [isHidden]);

  return (event) => {
    // The scroll of a list that is being hidden is no scroll of the person.
    if (isHiddenNow.current || !(event.target instanceof HTMLElement)) return;

    place.current = { element: event.target, top: event.target.scrollTop };
  };
}
