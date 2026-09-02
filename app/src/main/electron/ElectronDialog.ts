import {
  app,
  BrowserWindow,
  dialog,
  type MessageBoxOptions,
  type MessageBoxReturnValue,
  type OpenDialogOptions,
  type OpenDialogReturnValue,
} from "electron";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export class ElectronDialogMessageBoxError extends Schema.TaggedError<ElectronDialogMessageBoxError>()(
  "ElectronDialogMessageBoxError",
  {
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Failed to show Electron message box.";
  }
}

export class ElectronDialogOpenDialogError extends Schema.TaggedError<ElectronDialogOpenDialogError>()(
  "ElectronDialogOpenDialogError",
  {
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Failed to show Electron open dialog.";
  }
}

export interface ElectronDialogShape {
  readonly showMessageBox: (
    options: MessageBoxOptions,
    parentWindowId?: number,
  ) => Effect.Effect<MessageBoxReturnValue, ElectronDialogMessageBoxError>;
  readonly showOpenDialog: (
    options: OpenDialogOptions,
    parentWindowId?: number,
  ) => Effect.Effect<OpenDialogReturnValue, ElectronDialogOpenDialogError>;
  readonly showErrorBox: (
    title: string,
    content: string,
  ) => Effect.Effect<void>;
  readonly showWarningAndQuit: (input: {
    readonly title: string;
    readonly message: string;
    readonly detail: string;
  }) => Effect.Effect<void>;
}

export class ElectronDialog extends Context.Service<
  ElectronDialog,
  ElectronDialogShape
>()("lucent/desktop/electron/ElectronDialog") {}

const showMessageBox: ElectronDialogShape["showMessageBox"] = (
  options,
  parentWindowId,
) =>
  Effect.tryPromise({
    try: () => {
      if (parentWindowId === undefined) {
        return dialog.showMessageBox(options);
      }

      const browserWindow = BrowserWindow.fromId(parentWindowId);
      if (browserWindow === null) {
        throw new Error(`Browser window is not open: ${parentWindowId}`);
      }
      return dialog.showMessageBox(browserWindow, options);
    },
    catch: (cause) => new ElectronDialogMessageBoxError({ cause }),
  });

const showOpenDialog: ElectronDialogShape["showOpenDialog"] = (
  options,
  parentWindowId,
) =>
  Effect.tryPromise({
    try: () => {
      if (parentWindowId === undefined) {
        return dialog.showOpenDialog(options);
      }

      const browserWindow = BrowserWindow.fromId(parentWindowId);
      if (browserWindow === null) {
        throw new Error(`Browser window is not open: ${parentWindowId}`);
      }
      return dialog.showOpenDialog(browserWindow, options);
    },
    catch: (cause) => new ElectronDialogOpenDialogError({ cause }),
  });

const showErrorBox: ElectronDialogShape["showErrorBox"] = (title, content) =>
  Effect.sync(() => {
    dialog.showErrorBox(title, content);
  });

const showWarningAndQuit: ElectronDialogShape["showWarningAndQuit"] = (input) =>
  Effect.promise(() =>
    dialog
      .showMessageBox({
        type: "warning",
        title: input.title,
        message: input.message,
        detail: input.detail,
        buttons: ["Quit"],
        defaultId: 0,
        cancelId: 0,
      })
      .catch(() => undefined),
  ).pipe(
    Effect.tap(() =>
      Effect.sync(() => {
        app.quit();
      }),
    ),
    Effect.asVoid,
  );

export const layer = Layer.succeed(
  ElectronDialog,
  ElectronDialog.of({
    showMessageBox,
    showOpenDialog,
    showErrorBox,
    showWarningAndQuit,
  }),
);
