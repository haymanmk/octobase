/**
 * Debounced write-behind used by the pane note editor: keystrokes call
 * update(), the newest value wins, and one commit fires after the delay.
 * flush() forces the pending value out immediately (tab switch / unmount) so
 * an in-flight draft is never lost. Pure and framework-free for testability.
 */

export interface DebouncedCommit<T> {
  /** Replace the pending value and restart the delay. */
  update(value: T): void;
  /** Commit the pending value now, if any. */
  flush(): void;
  /** Drop the pending value without committing. */
  cancel(): void;
}

export function createDebouncedCommit<T>(
  commit: (value: T) => void,
  delayMs: number,
): DebouncedCommit<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { value: T } | null = null;

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const fire = () => {
    const p = pending;
    pending = null;
    clear();
    if (p) commit(p.value);
  };

  return {
    update(value: T) {
      pending = { value };
      clear();
      timer = setTimeout(fire, delayMs);
    },
    flush: fire,
    cancel() {
      pending = null;
      clear();
    },
  };
}
