import { app, dialog } from "electron";

import { Context, Effect, Layer } from "effect";

export interface ElectronDialogShape {
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
