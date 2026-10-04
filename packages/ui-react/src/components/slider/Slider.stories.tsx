import type { Meta, StoryObj } from "@storybook/react-vite";
import { Volume1, Volume2 } from "lucide-react";
import { useState } from "react";
import { fn } from "storybook/test";
import { Button } from "../button/Button";
import {
  Slider,
  SliderControl,
  SliderLabel,
  SliderThumb,
  SliderValue,
} from "./Slider";

const meta = {
  args: {
    defaultValue: 40,
    disabled: false,
    largeStep: 10,
    max: 100,
    min: 0,
    onValueChange: fn(),
    onValueCommitted: fn(),
    orientation: "horizontal",
    step: 1,
  },
  argTypes: {
    orientation: {
      control: "inline-radio",
      options: ["horizontal", "vertical"],
    },
    thumbAlignment: {
      control: "inline-radio",
      options: ["edge", "center"],
    },
  },
  component: Slider,
  decorators: [
    (Story) => (
      <div style={{ width: 280 }}>
        <Story />
      </div>
    ),
  ],
  title: "Forms/Slider",
} satisfies Meta<typeof Slider>;

export default meta;

type Story = StoryObj<typeof meta>;

type Render = NonNullable<Story["render"]>;

const renderLabeled: Render = (args) => (
  <Slider {...args}>
    <SliderLabel>Opacity</SliderLabel>
    <SliderValue />
    <SliderControl>
      <SliderThumb />
    </SliderControl>
  </Slider>
);

const renderRange: Render = (args) => (
  <Slider {...args}>
    <SliderLabel>Price range</SliderLabel>
    <SliderValue />
    <SliderControl>
      <SliderThumb aria-label="Minimum price" index={0} />
      <SliderThumb aria-label="Maximum price" index={1} />
    </SliderControl>
  </Slider>
);

export const Playground: Story = {
  render: renderLabeled,
};

export const WithoutLabel: Story = {
  render: (args) => (
    <Slider {...args}>
      <SliderControl>
        <SliderThumb aria-label="Volume" />
      </SliderControl>
    </Slider>
  ),
};

export const Range: Story = {
  args: { defaultValue: [20, 70], minStepsBetweenValues: 5 },
  render: renderRange,
};

export const Steps: Story = {
  args: { defaultValue: 50, step: 10 },
  render: renderLabeled,
};

export const Formatted: Story = {
  args: {
    defaultValue: [200, 650],
    format: { currency: "USD", maximumFractionDigits: 0, style: "currency" },
    largeStep: 100,
    max: 1000,
    step: 10,
  },
  render: renderRange,
};

export const Vertical: Story = {
  args: { orientation: "vertical" },
  render: (args) => (
    <div style={{ display: "flex", gap: 24, height: 180 }}>
      <Slider {...args}>
        <SliderValue />
        <SliderControl>
          <SliderThumb aria-label="Bass" />
        </SliderControl>
      </Slider>
      <Slider {...args} defaultValue={65}>
        <SliderValue />
        <SliderControl>
          <SliderThumb aria-label="Mid" />
        </SliderControl>
      </Slider>
      <Slider {...args} defaultValue={[20, 80]}>
        <SliderValue />
        <SliderControl>
          <SliderThumb aria-label="Low cutoff" index={0} />
          <SliderThumb aria-label="High cutoff" index={1} />
        </SliderControl>
      </Slider>
    </div>
  ),
};

export const ThumbAlignment: Story = {
  render: (args) => (
    <div style={{ display: "grid", gap: 16 }}>
      <Slider {...args} defaultValue={0} thumbAlignment="edge">
        <SliderLabel>Edge (default)</SliderLabel>
        <SliderControl>
          <SliderThumb />
        </SliderControl>
      </Slider>
      <Slider {...args} defaultValue={0} thumbAlignment="center">
        <SliderLabel>Center</SliderLabel>
        <SliderControl>
          <SliderThumb />
        </SliderControl>
      </Slider>
    </div>
  ),
};

export const Disabled: Story = {
  args: { disabled: true },
  render: renderLabeled,
};

export const AudioSettings: Story = {
  render: function AudioSettingsStory() {
    const [volume, setVolume] = useState(60);
    return (
      <div
        style={{
          backgroundColor: "var(--color-surface)",
          borderRadius: "var(--radius-card)",
          boxShadow: "var(--shadow-raised)",
          display: "grid",
          gap: 20,
          padding: 16,
          width: 300,
        }}
      >
        <Slider onValueChange={setVolume} value={volume}>
          <SliderLabel>Output volume</SliderLabel>
          <SliderValue>{(formatted) => `${formatted.join("")}%`}</SliderValue>
          <div
            style={{
              alignItems: "center",
              color: "var(--color-text-secondary)",
              display: "flex",
              gap: 8,
              gridColumn: "1 / -1",
            }}
          >
            <Volume1 size={16} />
            <SliderControl>
              <SliderThumb />
            </SliderControl>
            <Volume2 size={16} />
          </div>
        </Slider>
        <Slider defaultValue={0} max={50} min={-50}>
          <SliderLabel>Balance</SliderLabel>
          <SliderValue />
          <SliderControl>
            <SliderThumb
              getAriaValueText={(formatted, value) =>
                value === 0
                  ? "Centered"
                  : `${formatted} ${value < 0 ? "left" : "right"}`
              }
            />
          </SliderControl>
        </Slider>
        <Slider defaultValue={[30, 90]}>
          <SliderLabel>Noise gate</SliderLabel>
          <SliderValue />
          <SliderControl>
            <SliderThumb aria-label="Threshold" index={0} />
            <SliderThumb aria-label="Ceiling" index={1} />
          </SliderControl>
        </Slider>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button onClick={() => setVolume(60)} variant="ghost">
            Reset
          </Button>
          <Button variant="primary">Apply</Button>
        </div>
      </div>
    );
  },
};
