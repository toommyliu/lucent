import type { Meta, StoryObj } from "@storybook/react-vite";
import { Settings, UserPlus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { fn } from "storybook/test";
import { isolatedStory } from "../../stories/parameters";
import { Button } from "../button/Button";
import { Field, FieldDescription, FieldLabel } from "../field/Field";
import { Input } from "../input/Input";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  type DialogContentProps,
  type DialogSize,
} from "./Dialog";

const sizes = ["sm", "md", "lg"] as const satisfies ReadonlyArray<DialogSize>;

const onSave = fn();
const onInvite = fn();

const meta = {
  args: {
    closeLabel: "Close",
    showCloseButton: true,
    size: "md",
  },
  argTypes: {
    size: { control: "inline-radio", options: sizes },
  },
  component: DialogContent,
  parameters: isolatedStory(440),
  title: "Overlays/Dialog",
} satisfies Meta<typeof DialogContent>;

export default meta;

type Story = StoryObj<typeof meta>;

function EditProfileDialog(props: DialogContentProps) {
  return (
    <Dialog defaultOpen>
      <DialogTrigger render={<Button />}>Edit profile</DialogTrigger>
      <DialogContent {...props}>
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>
            Your name and email are visible to everyone in the workspace.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div style={{ display: "grid", gap: 16 }}>
            <Field>
              <FieldLabel>Display name</FieldLabel>
              <Input defaultValue="Ada Lovelace" />
            </Field>
            <Field>
              <FieldLabel>Email</FieldLabel>
              <Input defaultValue="ada@example.com" type="email" />
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <DialogClose onClick={onSave} render={<Button variant="primary" />}>
            Save changes
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const Playground: Story = {
  render: (args) => <EditProfileDialog {...args} />,
};

export const Small: Story = {
  args: { size: "sm" },
  render: (args) => <EditProfileDialog {...args} />,
};

export const Medium: Story = {
  args: { size: "md" },
  render: (args) => <EditProfileDialog {...args} />,
};

export const Large: Story = {
  args: { size: "lg" },
  render: (args) => <EditProfileDialog {...args} />,
};

export const WithoutCloseButton: Story = {
  args: { showCloseButton: false },
  render: (args) => (
    <Dialog defaultOpen>
      <DialogTrigger render={<Button />}>Continue session</DialogTrigger>
      <DialogContent {...args} size="sm">
        <DialogHeader>
          <DialogTitle>Session expired</DialogTitle>
          <DialogDescription>
            Sign in again to keep working. Unsaved changes are kept on this
            device.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="primary" />}>
            Sign in
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
  parameters: isolatedStory(320),
};

const sections = [
  {
    body: "These terms apply to every workspace you create or join. By using the service you agree to them on behalf of yourself and your organization.",
    title: "1. Accepting these terms",
  },
  {
    body: "You keep ownership of everything you upload. You grant us a limited license to store, process, and display it only to provide the service.",
    title: "2. Your content",
  },
  {
    body: "Keep your password private and turn on two-factor authentication. You're responsible for activity that happens under your account.",
    title: "3. Account security",
  },
  {
    body: "Paid plans renew automatically at the end of each billing period. You can cancel at any time, and cancellation takes effect at the end of the period.",
    title: "4. Billing",
  },
  {
    body: "Don't use the service to send spam, distribute malware, or access data you aren't authorized to see.",
    title: "5. Acceptable use",
  },
  {
    body: "We may update these terms. If a change is significant, we'll notify workspace owners by email at least 30 days in advance.",
    title: "6. Changes",
  },
  {
    body: "Either party can end this agreement. When an account is closed, its data is deleted after a 30-day grace period.",
    title: "7. Termination",
  },
];

export const ScrollingBody: Story = {
  render: (args) => (
    <Dialog defaultOpen>
      <DialogTrigger render={<Button />}>Review terms</DialogTrigger>
      <DialogContent {...args}>
        <DialogHeader>
          <DialogTitle>Terms of service</DialogTitle>
          <DialogDescription>Last updated March 4.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {sections.map((section) => (
            <section key={section.title} style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: "inherit", margin: "0 0 4px" }}>
                {section.title}
              </h3>
              <p style={{ color: "var(--color-text-secondary)", margin: 0 }}>
                {section.body}
              </p>
            </section>
          ))}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Decline</DialogClose>
          <DialogClose render={<Button variant="primary" />}>
            Accept
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
  parameters: isolatedStory(420),
};

function InviteTeammatesDemo(props: DialogContentProps) {
  const [open, setOpen] = useState(true);
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onInvite(data.get("emails"), data.get("note"));
    setOpen(false);
  };
  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger render={<Button variant="primary" />}>
        <UserPlus />
        Invite teammates
      </DialogTrigger>
      <DialogContent {...props}>
        <form onSubmit={handleSubmit} style={{ display: "contents" }}>
          <DialogHeader>
            <DialogTitle>Invite teammates</DialogTitle>
            <DialogDescription>
              Invited people join as members and can see every public project.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div style={{ display: "grid", gap: 16 }}>
              <Field>
                <FieldLabel>Email addresses</FieldLabel>
                <Input
                  name="emails"
                  placeholder="grace@example.com, alan@example.com"
                  required
                />
                <FieldDescription>
                  Separate addresses with commas.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel>Personal note</FieldLabel>
                <Input name="note" placeholder="Optional" />
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button />}>Cancel</DialogClose>
            <Button type="submit" variant="primary">
              Send invites
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export const InviteTeammates: Story = {
  render: (args) => <InviteTeammatesDemo {...args} />,
};

export const NestedDialogs: Story = {
  render: (args) => (
    <Dialog defaultOpen>
      <DialogTrigger render={<Button />}>
        <Settings />
        Workspace settings
      </DialogTrigger>
      <DialogContent {...args}>
        <DialogHeader>
          <DialogTitle>Workspace settings</DialogTitle>
          <DialogDescription>
            Manage the name and members of this workspace.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field>
            <FieldLabel>Workspace name</FieldLabel>
            <Input defaultValue="Acme Design" />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Dialog defaultOpen>
            <DialogTrigger
              render={<Button style={{ marginInlineEnd: "auto" }} />}
            >
              Invite teammates
            </DialogTrigger>
            <DialogContent size="sm">
              <DialogHeader>
                <DialogTitle>Invite teammates</DialogTitle>
                <DialogDescription>
                  They'll get an email with a link to join Acme Design.
                </DialogDescription>
              </DialogHeader>
              <DialogBody>
                <Field>
                  <FieldLabel>Email address</FieldLabel>
                  <Input placeholder="grace@example.com" type="email" />
                </Field>
              </DialogBody>
              <DialogFooter>
                <DialogClose render={<Button />}>Cancel</DialogClose>
                <DialogClose render={<Button variant="primary" />}>
                  Send invite
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <DialogClose render={<Button variant="primary" />}>Save</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
  parameters: isolatedStory(440),
};
