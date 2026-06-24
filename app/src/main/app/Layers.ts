import { Layer } from "effect";

import * as DesktopEnvironment from "./DesktopEnvironment";
import * as DesktopLifecycle from "./DesktopLifecycle";
import * as DesktopObservability from "./DesktopObservability";
import * as DesktopData from "../data/DesktopData";
import * as DesktopUpdates from "../updates/DesktopUpdates";
import * as DesktopWindows from "../window/DesktopWindows";
import * as ElectronApp from "../electron/ElectronApp";
import * as ElectronDialog from "../electron/ElectronDialog";
import * as ElectronSession from "../electron/ElectronSession";
import * as ElectronWindow from "../electron/ElectronWindow";
import * as FlashTrust from "../flash/FlashTrust";

export const makeDesktopLayer = (
  envConfig: DesktopEnvironment.DesktopEnvironmentConfig,
) => {
  const environmentLayer = DesktopEnvironment.layer(envConfig);
  const electronLayer = Layer.mergeAll(
    DesktopLifecycle.layer,
    ElectronApp.layer,
    ElectronDialog.layer,
    ElectronSession.layer,
    ElectronWindow.layer,
    FlashTrust.layer,
  );

  const observabilityLayer = DesktopObservability.layer.pipe(
    Layer.provideMerge(environmentLayer),
  );

  const dataLayer = DesktopData.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(environmentLayer, observabilityLayer)),
  );

  const updatesLayer = DesktopUpdates.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        ElectronApp.layer,
        environmentLayer,
        observabilityLayer,
        dataLayer,
      ),
    ),
  );

  const windowsLayer = DesktopWindows.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        ElectronApp.layer,
        ElectronSession.layer,
        ElectronWindow.layer,
        environmentLayer,
        observabilityLayer,
      ),
    ),
  );

  return Layer.mergeAll(
    electronLayer,
    environmentLayer,
    observabilityLayer,
    dataLayer,
    updatesLayer,
    windowsLayer,
  );
};
