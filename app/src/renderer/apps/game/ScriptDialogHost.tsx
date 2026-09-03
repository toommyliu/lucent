import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@lucent/ui";
import { createSignal, Show, type Accessor, type JSX } from "solid-js";

import type {
  ScriptDialogRequest,
  ScriptDialogResponse,
} from "./scripting/ScriptDialogs";

interface ScriptDialogHostProps {
  readonly request: Accessor<ScriptDialogRequest | null>;
  readonly respond: (response: ScriptDialogResponse) => void;
}

interface ScriptDialogProps {
  readonly request: ScriptDialogRequest;
  readonly respond: (response: ScriptDialogResponse) => void;
}

const dialogTitle = (request: ScriptDialogRequest): string => {
  switch (request.kind) {
    case "alert":
      return "Script message";
    case "confirm":
      return "Script needs confirmation";
    case "prompt":
      return "Script needs input";
  }
};

function ScriptDialog(props: ScriptDialogProps): JSX.Element {
  const [settled, setSettled] = createSignal(false);
  const [value, setValue] = createSignal("");
  const inputId = `script-dialog-response-${props.request.id}`;
  let cancelButton: HTMLButtonElement | undefined;
  let dismissButton: HTMLButtonElement | undefined;
  let promptInput: HTMLInputElement | undefined;

  const respond = (response: ScriptDialogResponse): void => {
    if (settled()) return;
    setSettled(true);
    props.respond(response);
  };

  const cancel = (): void => {
    switch (props.request.kind) {
      case "alert":
        respond({ id: props.request.id, kind: "alert" });
        return;
      case "confirm":
        respond({
          confirmed: false,
          id: props.request.id,
          kind: "confirm",
        });
        return;
      case "prompt":
        respond({ id: props.request.id, kind: "prompt", value: null });
    }
  };

  const description = () => (
    <>
      <span class="game-script-dialog__source">{props.request.sourceName}</span>
      <span class="game-script-dialog__message">{props.request.message}</span>
    </>
  );

  if (props.request.kind === "prompt") {
    return (
      <Dialog
        closeOnInteractOutside={false}
        initialFocusEl={() => promptInput ?? null}
        onOpenChange={(details) => {
          if (!details.open) cancel();
        }}
        open
      >
        <DialogContent class="game-script-dialog" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{dialogTitle(props.request)}</DialogTitle>
            <DialogDescription class="game-script-dialog__description">
              {description()}
            </DialogDescription>
          </DialogHeader>
          <form
            class="game-script-dialog__form"
            onSubmit={(event) => {
              event.preventDefault();
              respond({
                id: props.request.id,
                kind: "prompt",
                value: value(),
              });
            }}
          >
            <div class="form-field game-script-dialog__field">
              <Label for={inputId}>Response</Label>
              <Input
                autocomplete="off"
                disabled={settled()}
                fullWidth
                id={inputId}
                onInput={(event) => setValue(event.currentTarget.value)}
                placeholder={props.request.defaultValue}
                ref={(element) => {
                  promptInput = element;
                }}
                value={value()}
              />
            </div>
            <DialogFooter>
              <Button
                disabled={settled()}
                onClick={cancel}
                size="sm"
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button disabled={settled()} size="sm" type="submit">
                Submit
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <AlertDialog
      closeOnInteractOutside={false}
      initialFocusEl={() =>
        props.request.kind === "confirm"
          ? (cancelButton ?? null)
          : (dismissButton ?? null)
      }
      onOpenChange={(details) => {
        if (!details.open) cancel();
      }}
      open
    >
      <AlertDialogContent
        class="game-script-dialog"
        closeProps={{
          "aria-label": "Dismiss",
          disabled: settled(),
          ref: (element: HTMLButtonElement) => {
            dismissButton = element;
          },
        }}
        showCloseButton={props.request.kind === "alert"}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{dialogTitle(props.request)}</AlertDialogTitle>
          <AlertDialogDescription class="game-script-dialog__description">
            {description()}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Show when={props.request.kind === "confirm"}>
          <AlertDialogFooter>
            <Button
              disabled={settled()}
              onClick={cancel}
              ref={(element) => {
                cancelButton = element;
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={settled()}
              onClick={() => {
                if (props.request.kind !== "confirm") return;
                respond({
                  confirmed: true,
                  id: props.request.id,
                  kind: "confirm",
                });
              }}
              size="sm"
              type="button"
            >
              Confirm
            </Button>
          </AlertDialogFooter>
        </Show>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ScriptDialogHost(props: ScriptDialogHostProps): JSX.Element {
  return (
    <Show when={props.request()} keyed>
      {(request) => <ScriptDialog request={request} respond={props.respond} />}
    </Show>
  );
}
