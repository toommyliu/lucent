export type TabMenu = "overflow" | "recent" | null;

export const makeTabMenuController = (options: {
  readonly setNativeOpen: (open: boolean) => Promise<boolean>;
  readonly onMenuChange: (menu: TabMenu) => void;
  readonly onError: (cause: unknown) => void;
}) => {
  let menu: TabMenu = null;
  let desired: TabMenu | undefined;
  let pending: TabMenu | undefined;
  let disposed = false;

  const publish = (next: TabMenu): void => {
    if (disposed) return;
    menu = next;
    options.onMenuChange(next);
  };

  const flush = async (): Promise<void> => {
    if (pending !== undefined) return;
    while (desired !== undefined) {
      const requested = desired;
      const previous = menu;
      pending = requested;
      try {
        const open = await options.setNativeOpen(requested !== null);
        if (desired === requested) {
          desired = undefined;
          publish(open ? requested : null);
        }
      } catch (cause) {
        if (!disposed) options.onError(cause);
        if (desired === requested) {
          desired = undefined;
          publish(previous);
        }
      } finally {
        pending = undefined;
      }
    }
  };

  return {
    request(next: TabMenu): void {
      if (
        disposed ||
        desired === next ||
        (desired === undefined && pending === undefined && menu === next)
      )
        return;
      desired = next;
      if (next === null) options.onMenuChange(null);
      void flush();
    },
    nativeOpenChanged(open: boolean): void {
      if (open || disposed) return;
      publish(null);
      if (pending !== null) desired = undefined;
    },
    dispose(): void {
      disposed = true;
      desired = undefined;
    },
  };
};
