import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { isolatedStory } from "../../stories/parameters";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "../field/Field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  type SelectSize,
} from "./Select";

const sizes = ["sm", "md", "lg"] as const satisfies ReadonlyArray<SelectSize>;

const fruits = [
  { label: "Apple", value: "apple" },
  { label: "Banana", value: "banana" },
  { label: "Blueberry", value: "blueberry" },
  { label: "Cherry", value: "cherry" },
  { label: "Grape", value: "grape" },
  { label: "Mango", value: "mango" },
  { label: "Pineapple", value: "pineapple" },
];

const themes = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

const produce = [
  {
    label: "Fruits",
    items: [
      { label: "Apple", value: "apple" },
      { label: "Banana", value: "banana" },
      { label: "Orange", value: "orange" },
    ],
  },
  {
    label: "Vegetables",
    items: [
      { label: "Carrot", value: "carrot" },
      { label: "Lettuce", value: "lettuce" },
      { label: "Spinach", value: "spinach" },
    ],
  },
  {
    label: "Herbs",
    items: [
      { label: "Basil", value: "basil" },
      { label: "Mint", value: "mint" },
    ],
  },
];

const regions = [
  {
    label: "Americas",
    items: [
      { label: "Pacific Time (Los Angeles)", value: "America/Los_Angeles" },
      { label: "Mountain Time (Denver)", value: "America/Denver" },
      { label: "Central Time (Chicago)", value: "America/Chicago" },
      { label: "Eastern Time (New York)", value: "America/New_York" },
      { label: "Brasília Time (São Paulo)", value: "America/Sao_Paulo" },
    ],
  },
  {
    label: "Europe and Africa",
    items: [
      { label: "Greenwich Mean Time (London)", value: "Europe/London" },
      { label: "Central European Time (Berlin)", value: "Europe/Berlin" },
      { label: "Eastern European Time (Athens)", value: "Europe/Athens" },
      {
        label: "South Africa Time (Johannesburg)",
        value: "Africa/Johannesburg",
      },
    ],
  },
  {
    label: "Asia and Pacific",
    items: [
      { label: "India Time (Kolkata)", value: "Asia/Kolkata" },
      { label: "China Time (Shanghai)", value: "Asia/Shanghai" },
      { label: "Japan Time (Tokyo)", value: "Asia/Tokyo" },
      { label: "Australian Eastern Time (Sydney)", value: "Australia/Sydney" },
    ],
  },
];

const shippingOptions = [
  { disabled: false, label: "Standard (5–7 days)", value: "standard" },
  { disabled: false, label: "Express (2–3 days)", value: "express" },
  { disabled: true, label: "Overnight (unavailable)", value: "overnight" },
  { disabled: true, label: "Same day (unavailable)", value: "same-day" },
];

const fonts = Array.from({ length: 40 }, (_, index) => {
  const size = 8 + index;
  return { label: `${size} pt`, value: String(size) };
});

const meta = {
  args: {
    disabled: false,
    size: "md",
  },
  argTypes: {
    size: { control: "inline-radio", options: sizes },
  },
  component: SelectTrigger,
  decorators: [
    (Story) => (
      <div style={{ width: 260 }}>
        <Story />
      </div>
    ),
  ],
  parameters: isolatedStory(320),
  title: "Forms/Select",
} satisfies Meta<typeof SelectTrigger>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <Select defaultOpen items={fruits} onValueChange={fn()}>
      <SelectTrigger {...args} aria-label="Fruit">
        <SelectValue placeholder="Choose a fruit" />
      </SelectTrigger>
      <SelectContent>
        {fruits.map((fruit) => (
          <SelectItem key={fruit.value} value={fruit.value}>
            {fruit.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ),
};

export const AlignedToSelection: Story = {
  name: "Aligned to selection",
  render: (args) => (
    <Select defaultOpen defaultValue="cherry" items={fruits}>
      <SelectTrigger {...args} aria-label="Fruit">
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger>
        {fruits.map((fruit) => (
          <SelectItem key={fruit.value} value={fruit.value}>
            {fruit.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ),
};

export const PositionedBelow: Story = {
  name: "Positioned below trigger",
  render: (args) => (
    <Select defaultOpen defaultValue="cherry" items={fruits}>
      <SelectTrigger {...args} aria-label="Fruit">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {fruits.map((fruit) => (
          <SelectItem key={fruit.value} value={fruit.value}>
            {fruit.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ),
  parameters: isolatedStory(340),
};

export const Sizes: Story = {
  render: (args) => (
    <div style={{ display: "grid", gap: 12 }}>
      {sizes.map((size) => (
        <Select defaultValue="system" items={themes} key={size}>
          <SelectTrigger {...args} aria-label={`Theme (${size})`} size={size}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {themes.map((theme) => (
              <SelectItem key={theme.value} value={theme.value}>
                {theme.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}
    </div>
  ),
  parameters: isolatedStory(180),
};

export const States: Story = {
  render: (args) => (
    <div style={{ display: "grid", gap: 12 }}>
      <Select items={themes}>
        <SelectTrigger {...args} aria-label="Placeholder">
          <SelectValue placeholder="Select a theme" />
        </SelectTrigger>
        <SelectContent>
          {themes.map((theme) => (
            <SelectItem key={theme.value} value={theme.value}>
              {theme.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select defaultValue="dark" items={themes}>
        <SelectTrigger {...args} aria-label="With value">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {themes.map((theme) => (
            <SelectItem key={theme.value} value={theme.value}>
              {theme.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select defaultValue="light" items={themes} readOnly>
        <SelectTrigger {...args} aria-label="Read only">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {themes.map((theme) => (
            <SelectItem key={theme.value} value={theme.value}>
              {theme.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select defaultValue="system" disabled items={themes}>
        <SelectTrigger {...args} aria-label="Disabled">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {themes.map((theme) => (
            <SelectItem key={theme.value} value={theme.value}>
              {theme.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Field invalid>
        <Select items={themes}>
          <SelectTrigger {...args} aria-label="Invalid">
            <SelectValue placeholder="Select a theme" />
          </SelectTrigger>
          <SelectContent>
            {themes.map((theme) => (
              <SelectItem key={theme.value} value={theme.value}>
                {theme.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  ),
  parameters: isolatedStory(260),
};

export const Groups: Story = {
  render: (args) => (
    <Select defaultOpen defaultValue="carrot" items={produce}>
      <SelectTrigger {...args} aria-label="Produce">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {produce.map((group, index) => (
          <SelectGroup key={group.label}>
            {index > 0 ? <SelectSeparator /> : null}
            <SelectGroupLabel>{group.label}</SelectGroupLabel>
            {group.items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  ),
  parameters: isolatedStory(420),
};

export const DisabledItems: Story = {
  render: (args) => (
    <Select defaultOpen defaultValue="standard" items={shippingOptions}>
      <SelectTrigger {...args} aria-label="Shipping">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {shippingOptions.map((option) => (
          <SelectItem
            disabled={option.disabled}
            key={option.value}
            value={option.value}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ),
};

export const Multiple: Story = {
  render: (args) => (
    <Select
      defaultOpen
      defaultValue={["apple", "mango"]}
      items={fruits}
      multiple
      onValueChange={fn()}
    >
      <SelectTrigger {...args} aria-label="Fruits">
        <SelectValue placeholder="Choose fruits" />
      </SelectTrigger>
      <SelectContent>
        {fruits.map((fruit) => (
          <SelectItem key={fruit.value} value={fruit.value}>
            {fruit.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ),
};

export const LongList: Story = {
  render: (args) => (
    <Select defaultOpen defaultValue="24" items={fonts}>
      <SelectTrigger {...args} aria-label="Font size">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {fonts.map((font) => (
          <SelectItem key={font.value} value={font.value}>
            {font.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ),
  parameters: isolatedStory(360),
};

export const TimeZone: Story = {
  name: "Time zone (in a field)",
  render: (args) => (
    <Field>
      <FieldLabel nativeLabel={false} render={<div />}>
        Time zone
      </FieldLabel>
      <Select defaultOpen items={regions} name="timeZone" required>
        <SelectTrigger {...args}>
          <SelectValue placeholder="Select a time zone" />
        </SelectTrigger>
        <SelectContent>
          {regions.map((region, index) => (
            <SelectGroup key={region.label}>
              {index > 0 ? <SelectSeparator /> : null}
              <SelectGroupLabel>{region.label}</SelectGroupLabel>
              {region.items.map((zone) => (
                <SelectItem key={zone.value} value={zone.value}>
                  {zone.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription>
        Used for reminders and scheduled reports.
      </FieldDescription>
      <FieldError match="valueMissing">Choose a time zone.</FieldError>
    </Field>
  ),
  parameters: isolatedStory(480),
};
