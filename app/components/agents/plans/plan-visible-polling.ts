function isTabHidden(): boolean {
  return document.visibilityState !== "visible";
}

/**
 * Repeats a read while the browser tab is visible and reads at once on return.
 *
 * @param read - One read that handles its own errors. It receives whether the
 * tab was hidden since the last read and answers with the delay to the next
 * read, or with `null` when no further read is due.
 * @returns Stops the reads and the observation of the tab.
 *
 * @remarks
 * A hidden tab starts no read, not even the first. A read that is still under
 * way when the tab returns serves as the read on return, so reads never overlap.
 * A return also reads after `null`, because the state may have changed unseen.
 */
export function startVisiblePolling(
  read: (wasHidden: boolean) => Promise<number | null>,
): () => void {
  let timer: number | undefined;
  let isReading = false;
  let isStopped = false;
  let wasHidden = false;
  async function readAndSchedule(): Promise<void> {
    isReading = true;
    const hiddenSinceLastRead = wasHidden;
    wasHidden = false;
    const delay = await read(hiddenSinceLastRead);
    isReading = false;
    if (isStopped || delay === null || isTabHidden()) return;
    timer = window.setTimeout(() => {
      void readAndSchedule();
    }, delay);
  }
  function handleVisibilityChange(): void {
    window.clearTimeout(timer);
    if (isTabHidden()) wasHidden = true;
    else if (!isReading) void readAndSchedule();
  }
  document.addEventListener("visibilitychange", handleVisibilityChange);
  if (!isTabHidden()) void readAndSchedule();
  return () => {
    isStopped = true;
    window.clearTimeout(timer);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  };
}
