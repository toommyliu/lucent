import {
  app,
  dialog,
  type MessageBoxOptions,
  type MessageBoxReturnValue,
} from "electron";

import { Context, Effect, Layer, Schema } from "effect";

export class ElectronDialogMessageBoxError extends Schema.TaggedErrorClass<ElectronDialogMessageBoxError>()(
  "ElectronDialogMessageBoxError",
  {
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Failed to show Electron message box.";
  }
}

export interface ElectronDialogShape {
  readonly showMessageBox: (
    options: MessageBoxOptions,
  ) => Effect.Effect<MessageBoxReturnValue, ElectronDialogMessageBoxError>;
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

export const layer = Layer.succeed(
  ElectronDialog,
  ElectronDialog.of({
    showMessageBox: (options) =>
      Effect.tryPromise({
        try: () => dialog.showMessageBox(options),
        catch: (cause) => new ElectronDialogMessageBoxError({ cause }),
      }),
    showErrorBox: (title, content) =>
      Effect.sync(() => {
        dialog.showErrorBox(title, content);
      }),
    showWarningAndQuit: (input) =>
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
      ),
  }),
);
