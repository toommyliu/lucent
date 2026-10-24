import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { Field, FieldDescription, FieldLabel } from "../field/Field";
import { Switch, type SwitchSize } from "./Switch";

const sizes = ["sm", "md"] as const satisfies ReadonlyArray<SwitchSize>;

const meta = {
  args: {
    defaultChecked: false,
    disabled: false,
    onCheckedChange: fn(),
    readOnly: false,
    size: "md",
  },
  argTypes: {
    size: { control: "inline-radio", options: sizes },
  },
  component: Switch,
  title: "Forms/Switch",
} satisfies Meta<typeof Switch>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <Field>
      <FieldLabel>
        <Switch {...args} />
        Airplane mode
      </FieldLabel>
    </Field>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <div style={{ display: "grid", gap: 12 }}>
      {sizes.map((size) => (
        <Field key={size}>
          <FieldLabel>
            <Switch {...args} defaultChecked size={size} />
            Size {size}
          </FieldLabel>
        </Field>
      ))}
    </div>
  ),
};

export const States: Story = {
  render: (args) => (
    <div style={{ display: "grid", gap: 12 }}>
      {[
        { label: "Off", props: {} },
        { label: "On", props: { defaultChecked: true } },
        { label: "Disabled", props: { disabled: true } },
        {
          label: "Disabled and on",
          props: { defaultChecked: true, disabled: true },
        },
        { label: "Read only", props: { defaultChecked: true, readOnly: true } },
      ].map(({ label, props }) => (
        <Field key={label}>
          <FieldLabel>
            <Switch {...args} {...props} />
            {label}
          </FieldLabel>
        </Field>
      ))}
    </div>
  ),
};

export const WithoutLabel: Story = {
  args: { "aria-label": "Show hidden files" },
};

export const WithDescription: Story = {
  render: (args) => (
    <Field style={{ width: 300 }}>
      <FieldLabel>
        <Switch {...args} defaultChecked />
        Install updates automatically
      </FieldLabel>
      <FieldDescription style={{ paddingInlineStart: 36 }}>
        Updates download in the background and apply on restart.
      </FieldDescription>
    </Field>
  ),
};

export const DisabledField: Story = {
  render: (args) => (
    <Field disabled>
      <FieldLabel>
        <Switch {...args} defaultChecked />
        Share usage data
      </FieldLabel>
    </Field>
  ),
};

const settings = [
  {
    defaultChecked: true,
    description: "Play a sound when a message arrives.",
    label: "Sound effects",
    name: "sounds",
  },
  {
    defaultChecked: true,
    description: "Show a badge with the number of unread items.",
    label: "Unread badge",
    name: "badge",
  },
  {
    defaultChecked: false,
    description: "Hold notifications while you're presenting or sharing.",
    label: "Pause while presenting",
    name: "presenting",
  },
  {
    defaultChecked: false,
    description: "Requires the desktop app to stay open.",
    disabled: true,
    label: "Background sync",
    name: "sync",
  },
];

export const SettingsPanel: Story = {
  render: (args) => (
    <div
      style={{
        backgroundColor: "var(--color-surface)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-raised)",
        display: "grid",
        width: 380,
      }}
    >
      {settings.map((setting, index) => (
        <div
          key={setting.name}
          style={{
            alignItems: "center",
            borderBlockStart:
              index === 0 ? undefined : "1px solid var(--color-separator)",
            display: "flex",
            gap: 16,
            justifyContent: "space-between",
            padding: "12px 16px",
          }}
        >
          <div style={{ display: "grid", gap: 2 }}>
            <span id={`${setting.name}-label`}>{setting.label}</span>
            <span
              id={`${setting.name}-description`}
              style={{
                color: "var(--color-text-secondary)",
                fontSize: "var(--font-size-small)",
              }}
            >
              {setting.description}
            </span>
          </div>
          <Switch
            aria-describedby={`${setting.name}-description`}
            aria-labelledby={`${setting.name}-label`}
            defaultChecked={setting.defaultChecked}
            disabled={setting.disabled ?? false}
            name={setting.name}
            onCheckedChange={args.onCheckedChange}
            size="sm"
          />
        </div>
      ))}
    </div>
  ),
};
