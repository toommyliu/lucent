import { Layer } from "effect";

import * as DesktopEnvironment from "./DesktopEnvironment";
import * as DesktopLifecycle from "./DesktopLifecycle";
import * as DesktopObservability from "./DesktopObservability";
import * as DesktopIpc from "../ipc/DesktopIpc";
import * as DesktopSettings from "../settings/DesktopSettings";
import * as DesktopUpdates from "../updates/DesktopUpdates";
import * as DesktopApplicationMenu from "../window/DesktopApplicationMenu";
import * as DesktopWindows from "../window/DesktopWindows";
import * as ElectronApp from "../electron/ElectronApp";
import * as ElectronDialog from "../electron/ElectronDialog";
import * as ElectronSession from "../electron/ElectronSession";
import * as ElectronShell from "../electron/ElectronShell";
import * as ElectronTheme from "../electron/ElectronTheme";
import * as ElectronWindow from "../electron/ElectronWindow";
import * as FlashTrust from "../flash/FlashTrust";

export const makeDesktopLayer = (
  envConfig: DesktopEnvironment.DesktopEnvironmentConfig,
) => {
  const environmentLayer = DesktopEnvironment.layer(envConfig);
  const electronSessionLayer = ElectronSession.layer.pipe(
    Layer.provideMerge(environmentLayer),
  );
  const electronLayer = Layer.mergeAll(
    DesktopLifecycle.layer,
    ElectronApp.layer,
    ElectronDialog.layer,
    DesktopIpc.layer,
    electronSessionLayer,
    ElectronShell.layer,
    ElectronTheme.layer,
    ElectronWindow.layer,
    FlashTrust.layer,
  );

  const observabilityLayer = DesktopObservability.layer.pipe(
    Layer.provideMerge(environmentLayer),
  );

  const settingsLayer = DesktopSettings.layer.pipe(
    Layer.provideMerge(environmentLayer),
  );

  const updatesLayer = DesktopUpdates.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        ElectronApp.layer,
        ElectronShell.layer,
        environmentLayer,
        observabilityLayer,
        settingsLayer,
      ),
    ),
  );

  const windowsLayer = DesktopWindows.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        ElectronApp.layer,
        electronSessionLayer,
        ElectronTheme.layer,
        ElectronWindow.layer,
        environmentLayer,
        observabilityLayer,
        settingsLayer,
      ),
    ),
  );

  const applicationMenuLayer = DesktopApplicationMenu.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        ElectronApp.layer,
        ElectronDialog.layer,
        environmentLayer,
        observabilityLayer,
        settingsLayer,
        updatesLayer,
        windowsLayer,
      ),
    ),
  );

  return Layer.mergeAll(
    electronLayer,
    environmentLayer,
    observabilityLayer,
    settingsLayer,
    updatesLayer,
    windowsLayer,
    applicationMenuLayer,
  );
};
