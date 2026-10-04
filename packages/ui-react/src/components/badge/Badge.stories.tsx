import type { Meta, StoryObj } from "@storybook/react-vite";
import { GitPullRequest, Lock, ShieldCheck, Tag } from "lucide-react";
import { Badge, type BadgeSize, type BadgeVariant } from "./Badge";

const variants = [
  "neutral",
  "outline",
  "accent",
  "success",
  "warning",
  "danger",
  "info",
] as const satisfies ReadonlyArray<BadgeVariant>;

const sizes = ["sm", "md"] as const satisfies ReadonlyArray<BadgeSize>;

const services = [
  { name: "api-gateway", status: "Healthy", variant: "success" },
  { name: "billing-worker", status: "Degraded", variant: "warning" },
  { name: "search-indexer", status: "Failing", variant: "danger" },
  { name: "legacy-export", status: "Paused", variant: "neutral" },
] as const satisfies ReadonlyArray<{
  name: string;
  status: string;
  variant: BadgeVariant;
}>;

const meta = {
  args: {
    children: "Badge",
    dot: false,
    size: "md",
    variant: "neutral",
  },
  argTypes: {
    render: { control: false },
    size: { control: "inline-radio", options: sizes },
    variant: { control: "select", options: variants },
  },
  component: Badge,
  title: "Display/Badge",
} satisfies Meta<typeof Badge>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Variants: Story = {
  render: (args) => (
    <div style={{ display: "grid", gap: 12 }}>
      {sizes.map((size) => (
        <div
          key={size}
          style={{ alignItems: "center", display: "flex", gap: 8 }}
        >
          {variants.map((variant) => (
            <Badge {...args} key={variant} size={size} variant={variant}>
              {variant}
            </Badge>
          ))}
        </div>
      ))}
    </div>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
      <Badge {...args} size="sm">
        Small
      </Badge>
      <Badge {...args} size="md">
        Medium
      </Badge>
    </div>
  ),
};

export const WithDot: Story = {
  args: { dot: true },
  render: (args) => (
    <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
      <Badge {...args} variant="success">
        Online
      </Badge>
      <Badge {...args} variant="warning">
        Degraded
      </Badge>
      <Badge {...args} variant="danger">
        Down
      </Badge>
      <Badge {...args} variant="outline">
        Offline
      </Badge>
      <Badge {...args}>Idle</Badge>
    </div>
  ),
};

export const WithIcon: Story = {
  render: (args) => (
    <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
      <Badge {...args} variant="success">
        <ShieldCheck />
        Verified
      </Badge>
      <Badge {...args} variant="info">
        <GitPullRequest />
        Open
      </Badge>
      <Badge {...args} variant="outline">
        <Lock />
        Private
      </Badge>
      <Badge {...args}>
        <Tag />
        v2.4.0
      </Badge>
    </div>
  ),
};

export const Counts: Story = {
  render: (args) => (
    <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
      <Badge {...args} variant="accent">
        3
      </Badge>
      <Badge {...args} variant="danger">
        12
      </Badge>
      <Badge {...args}>128</Badge>
      <Badge {...args} size="sm" variant="accent">
        99+
      </Badge>
    </div>
  ),
};

export const AsLink: Story = {
  render: (args) => (
    <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
      <Badge {...args} render={<a href="#design" />} variant="outline">
        design
      </Badge>
      <Badge {...args} render={<a href="#frontend" />} variant="outline">
        frontend
      </Badge>
      <Badge {...args} render={<a href="#release" />} variant="accent">
        release
      </Badge>
    </div>
  ),
};

export const InContext: Story = {
  name: "Composition: list rows",
  render: (args) => (
    <div
      style={{
        background: "var(--color-surface)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-raised)",
        display: "grid",
        width: 360,
      }}
    >
      {services.map(({ name, status, variant }, index) => (
        <div
          key={name}
          style={{
            alignItems: "center",
            borderTop:
              index === 0 ? undefined : "1px solid var(--color-separator)",
            display: "flex",
            justifyContent: "space-between",
            padding: "10px 16px",
          }}
        >
          <span style={{ fontFamily: "var(--font-mono)" }}>{name}</span>
          <Badge {...args} dot size="sm" variant={variant}>
            {status}
          </Badge>
        </div>
      ))}
    </div>
  ),
};
