import type { Meta, StoryObj } from "@storybook/react-vite";
import { Icon, iconNames } from "./Icon";

const meta = {
  args: {
    icon: "settings",
    size: "xl",
    strokeWidth: 2,
  },
  argTypes: {
    icon: { control: "select", options: iconNames },
    size: { control: "inline-radio", options: ["xs", "sm", "md", "lg", "xl"] },
    strokeWidth: { control: { max: 3, min: 1, step: 0.25, type: "range" } },
  },
  component: Icon,
  title: "Foundations/Icon",
} satisfies Meta<typeof Icon>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Sizes: Story = {
  render: (args) => (
    <div style={{ alignItems: "center", display: "flex", gap: 16 }}>
      {(["xs", "sm", "md", "lg", "xl"] as const).map((size) => (
        <Icon {...args} key={size} size={size} />
      ))}
    </div>
  ),
};

export const Catalog: Story = {
  render: (args) => (
    <div
      style={{
        display: "grid",
        gap: 8,
        gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))",
        maxWidth: "100%",
        width: 760,
      }}
    >
      {iconNames.map((name) => (
        <div
          key={name}
          style={{
            alignItems: "center",
            backgroundColor: "var(--color-fill)",
            borderRadius: "var(--radius-control)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: "14px 8px 10px",
          }}
        >
          <Icon {...args} icon={name} size="lg" />
          <code
            style={{
              color: "var(--color-text-secondary)",
              fontSize: "var(--font-size-caption)",
            }}
          >
            {name}
          </code>
        </div>
      ))}
    </div>
  ),
};
