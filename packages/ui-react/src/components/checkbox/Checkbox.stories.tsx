import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ReactNode } from "react";
import { fn } from "storybook/test";
import { Button } from "../button/Button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "../field/Field";
import { Checkbox } from "./Checkbox";

const meta = {
  args: {
    defaultChecked: false,
    disabled: false,
    indeterminate: false,
    onCheckedChange: fn(),
    readOnly: false,
    required: false,
  },
  component: Checkbox,
  title: "Forms/Checkbox",
} satisfies Meta<typeof Checkbox>;

export default meta;

type Story = StoryObj<typeof meta>;

function Labeled({
  children,
  control,
}: {
  readonly children: ReactNode;
  readonly control: ReactNode;
}) {
  return (
    <Field>
      <FieldLabel>
        {control}
        {children}
      </FieldLabel>
    </Field>
  );
}

export const Playground: Story = {
  render: (args) => (
    <Labeled control={<Checkbox {...args} />}>Enable notifications</Labeled>
  ),
};

export const States: Story = {
  render: (args) => (
    <div style={{ display: "grid", gap: 12 }}>
      <Labeled control={<Checkbox {...args} />}>Unchecked</Labeled>
      <Labeled control={<Checkbox {...args} defaultChecked />}>Checked</Labeled>
      <Labeled control={<Checkbox {...args} indeterminate />}>
        Indeterminate
      </Labeled>
      <Labeled control={<Checkbox {...args} disabled />}>Disabled</Labeled>
      <Labeled control={<Checkbox {...args} defaultChecked disabled />}>
        Disabled and checked
      </Labeled>
      <Labeled control={<Checkbox {...args} defaultChecked readOnly />}>
        Read only
      </Labeled>
    </div>
  ),
};

export const WithoutLabel: Story = {
  args: { "aria-label": "Select row" },
};

export const WithDescription: Story = {
  render: (args) => (
    <Field style={{ width: 300 }}>
      <FieldLabel>
        <Checkbox {...args} defaultChecked />
        Send me a weekly digest
      </FieldLabel>
      <FieldDescription style={{ paddingInlineStart: 24 }}>
        A summary of activity in your workspaces, every Monday.
      </FieldDescription>
    </Field>
  ),
};

export const Invalid: Story = {
  render: (args) => (
    <Field invalid>
      <FieldLabel>
        <Checkbox {...args} />I agree to the terms of service
      </FieldLabel>
      <FieldError match>Accept the terms to continue.</FieldError>
    </Field>
  ),
};

export const DisabledField: Story = {
  render: (args) => (
    <Field disabled>
      <FieldLabel>
        <Checkbox {...args} defaultChecked />
        Sync settings across devices
      </FieldLabel>
      <FieldDescription style={{ paddingInlineStart: 24 }}>
        Managed by your organization.
      </FieldDescription>
    </Field>
  ),
};

const topics = [
  {
    description: "When someone mentions you or replies to your comment.",
    id: "mentions",
    label: "Mentions and replies",
  },
  {
    description: "When a task assigned to you changes status.",
    id: "tasks",
    label: "Task updates",
  },
  {
    description: "Billing receipts and plan changes.",
    id: "account",
    label: "Account activity",
  },
];

export const NotificationPreferences: Story = {
  render: function NotificationPreferencesStory() {
    const [enabled, setEnabled] = useState<ReadonlySet<string>>(
      () => new Set(["mentions"]),
    );
    const allEnabled = enabled.size === topics.length;
    const toggle = (id: string, checked: boolean) => {
      setEnabled((current) => {
        const next = new Set(current);
        if (checked) {
          next.add(id);
        } else {
          next.delete(id);
        }
        return next;
      });
    };
    return (
      <div style={{ display: "grid", gap: 16, width: 340 }}>
        <Labeled
          control={
            <Checkbox
              checked={allEnabled}
              indeterminate={enabled.size > 0 && !allEnabled}
              onCheckedChange={(checked) =>
                setEnabled(
                  checked
                    ? new Set(topics.map((topic) => topic.id))
                    : new Set(),
                )
              }
            />
          }
        >
          Email notifications
        </Labeled>
        <div style={{ display: "grid", gap: 12, paddingInlineStart: 24 }}>
          {topics.map((topic) => (
            <Field key={topic.id} name={topic.id}>
              <FieldLabel>
                <Checkbox
                  checked={enabled.has(topic.id)}
                  onCheckedChange={(checked) => toggle(topic.id, checked)}
                />
                {topic.label}
              </FieldLabel>
              <FieldDescription style={{ paddingInlineStart: 24 }}>
                {topic.description}
              </FieldDescription>
            </Field>
          ))}
        </div>
        <div>
          <Button variant="primary">Save preferences</Button>
        </div>
      </div>
    );
  },
};
