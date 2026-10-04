import type { Meta, StoryObj } from "@storybook/react-vite";
import { isolatedStory } from "../../stories/parameters";
import { Button } from "../button/Button";
import { Field, FieldLabel } from "../field/Field";
import { Input } from "../input/Input";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
  type PopoverContentProps,
} from "./Popover";

const sides = [
  "top",
  "right",
  "bottom",
  "left",
] as const satisfies ReadonlyArray<PopoverContentProps["side"]>;

const meta = {
  component: PopoverContent,
  parameters: isolatedStory(220),
  title: "Overlays/Popover",
} satisfies Meta<typeof PopoverContent>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: {
    align: "center",
    side: "bottom",
    sideOffset: 4,
  },
  argTypes: {
    align: { control: "inline-radio", options: ["start", "center", "end"] },
    side: { control: "inline-radio", options: sides },
  },
  render: (args) => (
    <Popover defaultOpen>
      <PopoverTrigger render={<Button variant="secondary" />}>
        Notifications
      </PopoverTrigger>
      <PopoverContent {...args}>
        <PopoverTitle>Notifications</PopoverTitle>
        <PopoverDescription>
          You're all caught up. New alerts show up here.
        </PopoverDescription>
      </PopoverContent>
    </Popover>
  ),
};

export const Sides: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 120 }}>
      {sides.map((side) => (
        <Popover defaultOpen key={side}>
          <PopoverTrigger render={<Button variant="soft" />}>
            {side}
          </PopoverTrigger>
          <PopoverContent side={side}>Opens {side}</PopoverContent>
        </Popover>
      ))}
    </div>
  ),
  parameters: isolatedStory(260),
};

export const WithForm: Story = {
  render: () => (
    <Popover defaultOpen>
      <PopoverTrigger render={<Button variant="secondary" />}>
        Rename
      </PopoverTrigger>
      <PopoverContent align="start">
        <form
          onSubmit={(event) => event.preventDefault()}
          style={{ display: "grid", gap: 12, width: 240 }}
        >
          <Field>
            <FieldLabel>Name</FieldLabel>
            <Input autoFocus defaultValue="Untitled layout" />
          </Field>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <PopoverClose render={<Button size="sm" variant="ghost" />}>
              Cancel
            </PopoverClose>
            <Button size="sm" type="submit">
              Save
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  ),
  parameters: isolatedStory(260),
};
