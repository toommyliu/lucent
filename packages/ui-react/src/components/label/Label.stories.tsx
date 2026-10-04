import type { Meta, StoryObj } from "@storybook/react-vite";
import { Checkbox } from "../checkbox/Checkbox";
import { Input } from "../input/Input";
import { Switch } from "../switch/Switch";
import { Label } from "./Label";

const meta = {
  args: {
    children: "Email",
  },
  component: Label,
  title: "Forms/Label",
} satisfies Meta<typeof Label>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <div style={{ display: "grid", gap: 6, width: 280 }}>
      <Label {...args} htmlFor="label-playground" />
      <Input id="label-playground" placeholder="you@example.com" />
    </div>
  ),
};

export const WrappingControls: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 12 }}>
      <Label>
        <Checkbox defaultChecked />
        Remember this device
      </Label>
      <Label>
        <Switch />
        Start minimized
      </Label>
    </div>
  ),
};
