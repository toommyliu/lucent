import type { Meta, StoryObj } from "@storybook/react-vite";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { fn } from "storybook/test";
import { isolatedStory } from "../../stories/parameters";
import { Button } from "../button/Button";
import { Field, FieldDescription, FieldLabel } from "../field/Field";
import { Input } from "../input/Input";
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  type AlertDialogContentProps,
  type AlertDialogSize,
} from "./AlertDialog";

const sizes = [
  "sm",
  "md",
  "lg",
] as const satisfies ReadonlyArray<AlertDialogSize>;

const onDiscard = fn();
const onDelete = fn();
const onRevoke = fn();

const meta = {
  args: {
    size: "sm",
  },
  argTypes: {
    size: { control: "inline-radio", options: sizes },
  },
  component: AlertDialogContent,
  parameters: isolatedStory(300),
  title: "Overlays/AlertDialog",
} satisfies Meta<typeof AlertDialogContent>;

export default meta;

type Story = StoryObj<typeof meta>;

function DiscardChangesDialog(props: AlertDialogContentProps) {
  return (
    <AlertDialog defaultOpen>
      <AlertDialogTrigger render={<Button />}>Close editor</AlertDialogTrigger>
      <AlertDialogContent {...props}>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
          <AlertDialogDescription>
            You edited this document since it was last saved. Discarded changes
            can't be recovered.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button />}>Keep editing</AlertDialogClose>
          <AlertDialogClose
            onClick={onDiscard}
            render={<Button variant="primary" />}
          >
            Discard
          </AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export const Playground: Story = {
  render: (args) => <DiscardChangesDialog {...args} />,
};

export const Small: Story = {
  args: { size: "sm" },
  render: (args) => <DiscardChangesDialog {...args} />,
};

export const Medium: Story = {
  args: { size: "md" },
  render: (args) => <DiscardChangesDialog {...args} />,
};

export const Destructive: Story = {
  render: (args) => (
    <AlertDialog defaultOpen>
      <AlertDialogTrigger render={<Button variant="danger-soft" />}>
        <Trash2 />
        Delete project
      </AlertDialogTrigger>
      <AlertDialogContent {...args}>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “Website redesign”?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the project, its 48 files, and all
            comments. You can't undo this.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button />}>Cancel</AlertDialogClose>
          <AlertDialogClose
            onClick={onDelete}
            render={<Button variant="danger" />}
          >
            Delete project
          </AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
};

const workspaceName = "acme-design";

function TypeToConfirmDemo(props: AlertDialogContentProps) {
  const [confirmation, setConfirmation] = useState("");
  const confirmed = confirmation === workspaceName;
  return (
    <AlertDialog
      defaultOpen
      onOpenChangeComplete={(open) => {
        if (!open) {
          setConfirmation("");
        }
      }}
    >
      <AlertDialogTrigger render={<Button variant="danger" />}>
        Delete workspace
      </AlertDialogTrigger>
      <AlertDialogContent {...props}>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this workspace?</AlertDialogTitle>
          <AlertDialogDescription>
            Every project, file, and member in this workspace will be removed
            for good.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogBody>
          <Field>
            <FieldLabel>Workspace name</FieldLabel>
            <Input
              autoComplete="off"
              onValueChange={setConfirmation}
              placeholder={workspaceName}
              value={confirmation}
            />
            <FieldDescription>
              Type <strong>{workspaceName}</strong> to confirm.
            </FieldDescription>
          </Field>
        </AlertDialogBody>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button />}>Cancel</AlertDialogClose>
          <AlertDialogClose
            disabled={!confirmed}
            onClick={onDelete}
            render={<Button variant="danger" />}
          >
            Delete workspace
          </AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export const TypeToConfirm: Story = {
  args: { size: "md" },
  render: (args) => <TypeToConfirmDemo {...args} />,
  parameters: isolatedStory(380),
};

export const SingleAction: Story = {
  render: (args) => (
    <AlertDialog defaultOpen>
      <AlertDialogTrigger render={<Button />}>Sync now</AlertDialogTrigger>
      <AlertDialogContent {...args}>
        <AlertDialogHeader>
          <AlertDialogTitle>Sync failed</AlertDialogTitle>
          <AlertDialogDescription>
            We couldn't reach the server. Your changes are saved locally and
            will sync when you're back online.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="primary" />}>
            OK
          </AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
};

export const RevokeAccess: Story = {
  name: "Destructive (soft)",
  render: (args) => (
    <AlertDialog defaultOpen>
      <AlertDialogTrigger render={<Button variant="ghost" />}>
        Revoke access
      </AlertDialogTrigger>
      <AlertDialogContent {...args}>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke access for Grace Hopper?</AlertDialogTitle>
          <AlertDialogDescription>
            She'll lose access to this project right away. You can invite her
            again later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button />}>Cancel</AlertDialogClose>
          <AlertDialogClose
            onClick={onRevoke}
            render={<Button variant="danger-soft" />}
          >
            Revoke access
          </AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
};
