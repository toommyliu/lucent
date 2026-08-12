import { Alert, AlertDescription, Icon } from "@lucent/ui";
import { For, Show, type JSX } from "solid-js";

export interface ScriptInputsDialogErrorField {
  readonly key: string;
  readonly label: string;
  readonly message: string;
}

export interface ScriptInputsDialogError {
  readonly fields: readonly ScriptInputsDialogErrorField[];
  readonly message: string;
}

/** Renders validation and persistence failures from the script inputs dialog. */
export function ScriptInputsErrorAlert(props: {
  readonly error: ScriptInputsDialogError;
  readonly onFocusField?: (key: string) => void;
}): JSX.Element {
  return (
    <Alert class="game-script-inputs-dialog__error" variant="error">
      <AlertDescription>
        <Icon
          aria-hidden="true"
          class="game-script-inputs-dialog__error-icon"
          icon="circle_alert"
        />
        <span class="game-script-inputs-dialog__error-message">
          <span>{props.error.message} </span>
          <Show when={props.error.fields.length > 0}>
            <span class="game-script-inputs-dialog__error-fields">
              <For each={props.error.fields}>
                {(field, index) => (
                  <>
                    <a
                      class="game-script-inputs-dialog__error-field-link"
                      href={`#script-input-${field.key}`}
                      onClick={(event) => {
                        event.preventDefault();
                        props.onFocusField?.(field.key);
                      }}
                    >
                      <Show
                        when={field.message !== ""}
                        fallback={
                          <span class="game-script-inputs-dialog__error-field-link-label">
                            {field.label}
                            <Show
                              when={index() < props.error.fields.length - 1}
                            >
                              ,
                            </Show>
                          </span>
                        }
                      >
                        <span>
                          <span class="game-script-inputs-dialog__error-field-link-label">
                            {field.label}
                          </span>
                          : {field.message}
                          <Show when={index() < props.error.fields.length - 1}>
                            ,
                          </Show>
                        </span>
                      </Show>
                    </a>{" "}
                  </>
                )}
              </For>
            </span>
          </Show>
        </span>
      </AlertDescription>
    </Alert>
  );
}
