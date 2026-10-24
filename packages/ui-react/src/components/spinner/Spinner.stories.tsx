import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../button/Button";
import { Spinner } from "./Spinner";

const meta = {
  args: {
    label: "Loading",
    size: 16,
  },
  argTypes: {
    size: { control: { max: 48, min: 12, step: 2, type: "range" } },
  },
  component: Spinner,
  title: "Feedback/Spinner",
} satisfies Meta<typeof Spinner>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Sizes: Story = {
  render: (args) => (
    <div style={{ alignItems: "center", display: "flex", gap: 16 }}>
      {[12, 14, 16, 20, 24, 32].map((size) => (
        <Spinner {...args} key={size} size={size} />
      ))}
    </div>
  ),
};

export const InheritsColor: Story = {
  render: (args) => (
    <div style={{ alignItems: "center", display: "flex", gap: 16 }}>
      <span style={{ color: "var(--color-text-secondary)" }}>
        <Spinner {...args} />
      </span>
      <span style={{ color: "var(--color-danger-text)" }}>
        <Spinner {...args} />
      </span>
      <span style={{ color: "var(--color-info-text)" }}>
        <Spinner {...args} />
      </span>
    </div>
  ),
};

export const InContext: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 16 }}>
      <div
        style={{
          alignItems: "center",
          color: "var(--color-text-secondary)",
          display: "flex",
          gap: 8,
        }}
      >
        <Spinner />
        Syncing 24 files…
      </div>
      <Button loading variant="primary">
        Publishing
      </Button>
    </div>
  ),
};
