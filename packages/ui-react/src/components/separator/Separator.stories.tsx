import type { Meta, StoryObj } from "@storybook/react-vite";
import { Bold, Italic, Link, Underline } from "lucide-react";
import { Button } from "../button/Button";
import { Separator } from "./Separator";

const meta = {
  args: {
    orientation: "horizontal",
  },
  argTypes: {
    orientation: {
      control: "inline-radio",
      options: ["horizontal", "vertical"],
    },
  },
  component: Separator,
  title: "Display/Separator",
} satisfies Meta<typeof Separator>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <div
      style={{
        alignItems: "center",
        display: "flex",
        flexDirection: args.orientation === "vertical" ? "row" : "column",
        gap: 12,
        height: args.orientation === "vertical" ? 40 : undefined,
        width: 280,
      }}
    >
      <span>Above or before</span>
      <Separator {...args} />
      <span>Below or after</span>
    </div>
  ),
};

export const Horizontal: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 12, width: 280 }}>
      <div>
        <div style={{ fontWeight: 500 }}>Account</div>
        <div style={{ color: "var(--color-text-secondary)" }}>
          Name, email, and password.
        </div>
      </div>
      <Separator />
      <div>
        <div style={{ fontWeight: 500 }}>Notifications</div>
        <div style={{ color: "var(--color-text-secondary)" }}>
          Email and desktop alerts.
        </div>
      </div>
    </div>
  ),
};

export const Vertical: Story = {
  render: () => (
    <div
      style={{
        alignItems: "center",
        color: "var(--color-text-secondary)",
        display: "flex",
        fontSize: "var(--font-size-small)",
        gap: 10,
      }}
    >
      <span>v2.4.0</span>
      <Separator orientation="vertical" />
      <span>Updated 3 days ago</span>
      <Separator orientation="vertical" />
      <span>MIT license</span>
    </div>
  ),
};

export const Toolbar: Story = {
  name: "Composition: toolbar",
  render: () => (
    <div
      style={{
        alignItems: "center",
        background: "var(--color-surface)",
        borderRadius: "calc(var(--radius-control) + 4px)",
        boxShadow: "var(--shadow-raised)",
        display: "flex",
        gap: 2,
        height: 36,
        padding: "0 4px",
      }}
    >
      <Button aria-label="Bold" size="sm" square variant="ghost">
        <Bold />
      </Button>
      <Button aria-label="Italic" size="sm" square variant="ghost">
        <Italic />
      </Button>
      <Button aria-label="Underline" size="sm" square variant="ghost">
        <Underline />
      </Button>
      <Separator orientation="vertical" style={{ margin: "8px 4px" }} />
      <Button aria-label="Insert link" size="sm" square variant="ghost">
        <Link />
      </Button>
    </div>
  ),
};
