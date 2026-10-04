import type { Meta, StoryObj } from "@storybook/react-vite";
import { Copy, Pencil, Share2, Star, Trash2 } from "lucide-react";
import { fn } from "storybook/test";
import { TooltipProvider } from "../tooltip/Tooltip";
import { IconButton } from "./IconButton";

const meta = {
  args: {
    children: <Pencil />,
    disabled: false,
    label: "Rename",
    loading: false,
    onClick: fn(),
    size: "md",
    tooltip: true,
    variant: "ghost",
  },
  argTypes: {
    children: { control: false },
    size: { control: "inline-radio", options: ["sm", "md", "lg"] },
    variant: {
      control: "select",
      options: [
        "primary",
        "secondary",
        "soft",
        "ghost",
        "danger",
        "danger-soft",
      ],
    },
  },
  component: IconButton,
  title: "Actions/IconButton",
} satisfies Meta<typeof IconButton>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Variants: Story = {
  render: (args) => (
    <div style={{ display: "flex", gap: 8 }}>
      <IconButton {...args} label="Favorite" variant="primary">
        <Star />
      </IconButton>
      <IconButton {...args} label="Copy" variant="secondary">
        <Copy />
      </IconButton>
      <IconButton {...args} label="Share" variant="soft">
        <Share2 />
      </IconButton>
      <IconButton {...args} label="Rename" variant="ghost">
        <Pencil />
      </IconButton>
      <IconButton {...args} label="Delete" variant="danger-soft">
        <Trash2 />
      </IconButton>
    </div>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
      <IconButton {...args} size="sm" variant="secondary" />
      <IconButton {...args} size="md" variant="secondary" />
      <IconButton {...args} size="lg" variant="secondary" />
    </div>
  ),
};

export const Toolbar: Story = {
  render: (args) => (
    <TooltipProvider>
      <div
        style={{
          borderRadius: "calc(var(--radius-control) + 4px)",
          boxShadow: "var(--shadow-raised)",
          display: "flex",
          gap: 2,
          padding: 4,
        }}
      >
        <IconButton {...args} label="Rename">
          <Pencil />
        </IconButton>
        <IconButton {...args} label="Duplicate">
          <Copy />
        </IconButton>
        <IconButton {...args} label="Share">
          <Share2 />
        </IconButton>
        <IconButton {...args} label="Delete">
          <Trash2 />
        </IconButton>
      </div>
    </TooltipProvider>
  ),
};

export const WithoutTooltip: Story = {
  args: { tooltip: false },
};
