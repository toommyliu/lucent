import type { Meta, StoryObj } from "@storybook/react-vite";
import { Bold, Italic, Underline } from "lucide-react";
import { isolatedStory } from "../../stories/parameters";
import { Button } from "../button/Button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  type TooltipContentProps,
} from "./Tooltip";

const sides = [
  "top",
  "right",
  "bottom",
  "left",
] as const satisfies ReadonlyArray<TooltipContentProps["side"]>;

const meta = {
  component: TooltipContent,
  parameters: isolatedStory(200),
  title: "Overlays/Tooltip",
} satisfies Meta<typeof TooltipContent>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: {
    children: "Copy link",
    side: "top",
    sideOffset: 6,
  },
  argTypes: {
    side: { control: "inline-radio", options: sides },
  },
  render: (args) => (
    <Tooltip defaultOpen>
      <TooltipTrigger render={<Button />}>Hover me</TooltipTrigger>
      <TooltipContent {...args} />
    </Tooltip>
  ),
};

export const Sides: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 48 }}>
      {sides.map((side) => (
        <Tooltip defaultOpen key={side}>
          <TooltipTrigger render={<Button variant="soft" />}>
            {side}
          </TooltipTrigger>
          <TooltipContent side={side}>Opens {side}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  ),
  parameters: isolatedStory(240),
};

export const LongContent: Story = {
  render: () => (
    <Tooltip defaultOpen>
      <TooltipTrigger render={<Button variant="ghost" />}>
        What is this?
      </TooltipTrigger>
      <TooltipContent>
        Shared links stay active for 7 days. Anyone with the link can view the
        file, but only members can edit it.
      </TooltipContent>
    </Tooltip>
  ),
  parameters: isolatedStory(220),
};

export const SharedDelayGroup: Story = {
  name: "Provider (instant between triggers)",
  render: () => (
    <TooltipProvider delay={300}>
      <div style={{ display: "flex", gap: 4 }}>
        {[
          { icon: <Bold />, label: "Bold" },
          { icon: <Italic />, label: "Italic" },
          { icon: <Underline />, label: "Underline" },
        ].map(({ icon, label }) => (
          <Tooltip key={label}>
            <TooltipTrigger
              render={<Button aria-label={label} square variant="ghost" />}
            >
              {icon}
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  ),
};
