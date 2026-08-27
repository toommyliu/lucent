import { toast, Toaster, VisuallyHidden } from "@lucent/ui";
import { createSignal, onCleanup, type Accessor, type JSX } from "solid-js";

const HOTKEY_STATUS_DURATION_MS = 1_500;
const HOTKEY_STATUS_ID = "game-hotkey-status";

export interface HotkeyStatusController {
  readonly announcement: Accessor<string>;
  readonly show: (message: string, visible?: boolean) => void;
}

export interface HotkeyStatusProps {
  readonly announcement: string;
}

/** Creates a single programmatic toast that updates in place. */
export function createHotkeyStatus(): HotkeyStatusController {
  const [announcement, setAnnouncement] = createSignal("");
  let clearAnnouncementTimer: number | undefined;

  const cancelAnnouncementClear = (): void => {
    if (clearAnnouncementTimer !== undefined) {
      window.clearTimeout(clearAnnouncementTimer);
      clearAnnouncementTimer = undefined;
    }
  };

  const show = (nextMessage: string, showVisually = true): void => {
    cancelAnnouncementClear();

    if (showVisually) {
      setAnnouncement("");
      toast.create({
        class: HOTKEY_STATUS_ID,
        closable: false,
        duration: HOTKEY_STATUS_DURATION_MS,
        icon: null,
        id: HOTKEY_STATUS_ID,
        title: nextMessage,
      });
      return;
    }

    toast.dismiss(HOTKEY_STATUS_ID);
    setAnnouncement(nextMessage);
    clearAnnouncementTimer = window.setTimeout(() => {
      clearAnnouncementTimer = undefined;
      setAnnouncement("");
    }, HOTKEY_STATUS_DURATION_MS);
  };

  onCleanup(() => {
    cancelAnnouncementClear();
    toast.dismiss(HOTKEY_STATUS_ID);
  });

  return { announcement, show };
}

/** Hosts visual hotkey toasts and a stable region for announcement-only updates. */
export function HotkeyStatus(props: HotkeyStatusProps): JSX.Element {
  return (
    <>
      <Toaster class="game-hotkey-toaster" placement="top-center" />
      <VisuallyHidden aria-atomic="true" role="status">
        {props.announcement}
      </VisuallyHidden>
    </>
  );
}
