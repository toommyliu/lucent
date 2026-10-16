import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArrowRight, Command } from "lucide-react";
import { Kbd, KbdGroup } from "./Kbd";

const meta = {
  args: {
    children: "K",
  },
  component: Kbd,
  title: "Display/Kbd",
} satisfies Meta<typeof Kbd>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Keys: Story = {
  render: (args) => (
    <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
      {["⌘", "⌥", "⇧", "⌃", "↵", "⌫", "Esc", "Tab", "Space", "F6", "1"].map(
        (key) => (
          <Kbd {...args} key={key}>
            {key}
          </Kbd>
        ),
      )}
    </div>
  ),
};

export const WithIcon: Story = {
  render: (args) => (
    <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
      <Kbd {...args} aria-label="Command">
        <Command />
      </Kbd>
      <Kbd {...args} aria-label="Right arrow">
        <ArrowRight />
      </Kbd>
    </div>
  ),
};

export const Group: Story = {
  render: (args) => (
    <div style={{ display: "grid", gap: 12, justifyItems: "start" }}>
      <KbdGroup>
        <Kbd {...args}>⌘</Kbd>
        <Kbd {...args}>K</Kbd>
      </KbdGroup>
      <KbdGroup>
        <Kbd {...args}>⌃</Kbd>
        <Kbd {...args}>⇧</Kbd>
        <Kbd {...args}>P</Kbd>
      </KbdGroup>
      <KbdGroup>
        <Kbd {...args}>Ctrl</Kbd>+<Kbd {...args}>Alt</Kbd>+
        <Kbd {...args}>Del</Kbd>
      </KbdGroup>
      <KbdGroup>
        <Kbd {...args}>G</Kbd>
        then
        <Kbd {...args}>I</Kbd>
      </KbdGroup>
    </div>
  ),
};

export const InText: Story = {
  render: (args) => (
    <p
      style={{
        color: "var(--color-text-secondary)",
        lineHeight: 1.6,
        margin: 0,
        maxWidth: 320,
      }}
    >
      Press{" "}
      <KbdGroup>
        <Kbd {...args}>⌘</Kbd>
        <Kbd {...args}>K</Kbd>
      </KbdGroup>{" "}
      to open the command palette, or <Kbd {...args}>?</Kbd> to see every
      shortcut.
    </p>
  ),
};

const shortcuts = [
  { keys: ["⌘", "K"], label: "Open command palette" },
  { keys: ["⌘", "P"], label: "Go to file" },
  { keys: ["⌘", "⇧", "F"], label: "Search in workspace" },
  { keys: ["⌘", ","], label: "Open settings" },
  { keys: ["Esc"], label: "Close panel" },
];

export const ShortcutList: Story = {
  name: "Composition: shortcut list",
  render: (args) => (
    <div
      style={{
        background: "var(--color-surface)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-raised)",
        padding: "6px 0",
        width: 300,
      }}
    >
      {shortcuts.map(({ keys, label }) => (
        <div
          key={label}
          style={{
            alignItems: "center",
            display: "flex",
            justifyContent: "space-between",
            padding: "6px 14px",
          }}
        >
          <span>{label}</span>
          <KbdGroup>
            {keys.map((key) => (
              <Kbd {...args} key={key}>
                {key}
              </Kbd>
            ))}
          </KbdGroup>
        </div>
      ))}
    </div>
  ),
};
