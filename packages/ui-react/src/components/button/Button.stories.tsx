import type { Meta, StoryObj } from "@storybook/react-vite";
import { Download, ExternalLink, Plus, Settings } from "lucide-react";
import { Button, type ButtonSize, type ButtonVariant } from "./Button";

const variants = [
  "primary",
  "secondary",
  "soft",
  "ghost",
  "danger",
  "danger-soft",
] as const satisfies ReadonlyArray<ButtonVariant>;

const sizes = ["sm", "md", "lg"] as const satisfies ReadonlyArray<ButtonSize>;

const meta = {
  args: {
    children: "Save changes",
    disabled: false,
    loading: false,
    size: "md",
    variant: "secondary",
  },
  argTypes: {
    size: { control: "inline-radio", options: sizes },
    variant: { control: "select", options: variants },
  },
  component: Button,
  title: "Actions/Button",
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Variants: Story = {
  render: (args) => (
    <div style={{ display: "grid", gap: 12 }}>
      {sizes.map((size) => (
        <div key={size} style={{ display: "flex", gap: 8 }}>
          {variants.map((variant) => (
            <Button {...args} key={variant} size={size} variant={variant}>
              {variant}
            </Button>
          ))}
        </div>
      ))}
    </div>
  ),
};

export const WithIcons: Story = {
  render: (args) => (
    <div style={{ display: "flex", gap: 8 }}>
      <Button {...args} variant="primary">
        <Plus />
        New project
      </Button>
      <Button {...args}>
        <Download />
        Export
      </Button>
      <Button {...args} variant="ghost">
        Open docs
        <ExternalLink />
      </Button>
      <Button {...args} aria-label="Settings" square variant="ghost">
        <Settings />
      </Button>
    </div>
  ),
};

export const States: Story = {
  render: (args) => (
    <div style={{ display: "flex", gap: 8 }}>
      <Button {...args} disabled>
        Disabled
      </Button>
      <Button {...args} loading variant="primary">
        Saving
      </Button>
      <Button {...args} loading>
        Loading
      </Button>
    </div>
  ),
};
