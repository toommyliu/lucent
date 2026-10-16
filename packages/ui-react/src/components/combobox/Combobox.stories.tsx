import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { Fragment } from "react";
import { isolatedStory } from "../../stories/parameters";
import { Field, FieldDescription, FieldLabel } from "../field/Field";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxClear,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxList,
  ComboboxSeparator,
  ComboboxTrigger,
  ComboboxValue,
  type ComboboxSize,
} from "./Combobox";

const sizes = ["sm", "md", "lg"] as const satisfies ReadonlyArray<ComboboxSize>;

type Option = {
  readonly disabled?: boolean;
  readonly label: string;
  readonly value: string;
};

const fruits: ReadonlyArray<Option> = [
  { label: "Apple", value: "apple" },
  { label: "Apricot", value: "apricot" },
  { label: "Banana", value: "banana" },
  { label: "Blackberry", value: "blackberry" },
  { label: "Blueberry", value: "blueberry" },
  { label: "Cherry", value: "cherry" },
  { label: "Grape", value: "grape" },
  { label: "Kiwi", value: "kiwi" },
  { label: "Mango", value: "mango" },
  { label: "Peach", value: "peach" },
  { label: "Pear", value: "pear" },
  { label: "Pineapple", value: "pineapple" },
  { label: "Raspberry", value: "raspberry" },
  { label: "Strawberry", value: "strawberry" },
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
      { label: "Parsley", value: "parsley" },
    ],
  },
];

type ProduceGroup = (typeof produce)[number];

const regions: ReadonlyArray<Option> = [
  { label: "US East (N. Virginia)", value: "us-east-1" },
  { label: "US West (Oregon)", value: "us-west-2" },
  { label: "Europe (Frankfurt)", value: "eu-central-1" },
  { disabled: true, label: "Europe (Paris), at capacity", value: "eu-west-3" },
  { label: "Asia Pacific (Tokyo)", value: "ap-northeast-1" },
  {
    disabled: true,
    label: "Asia Pacific (Seoul), at capacity",
    value: "ap-northeast-2",
  },
];

const labels: ReadonlyArray<Option> = [
  { label: "bug", value: "bug" },
  { label: "design", value: "design" },
  { label: "documentation", value: "documentation" },
  { label: "duplicate", value: "duplicate" },
  { label: "enhancement", value: "enhancement" },
  { label: "good first issue", value: "good-first-issue" },
  { label: "help wanted", value: "help-wanted" },
  { label: "performance", value: "performance" },
  { label: "question", value: "question" },
  { label: "security", value: "security" },
  { label: "wontfix", value: "wontfix" },
];

interface StoryArgs {
  readonly autoHighlight: boolean;
  readonly disabled: boolean;
  readonly onValueChange: (value: Option | null) => void;
  readonly placeholder: string;
  readonly readOnly: boolean;
  readonly size: ComboboxSize;
}

const meta = {
  args: {
    autoHighlight: false,
    disabled: false,
    onValueChange: fn(),
    placeholder: "Search fruits",
    readOnly: false,
    size: "md",
  },
  argTypes: {
    size: { control: "inline-radio", options: sizes },
  },
  decorators: [
    (Story) => (
      <div style={{ width: 280 }}>
        <Story />
      </div>
    ),
  ],
  parameters: isolatedStory(360),
  title: "Forms/Combobox",
} satisfies Meta<StoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

function OptionItems() {
  return (
    <ComboboxList>
      {(option: Option) => (
        <ComboboxItem
          disabled={option.disabled}
          key={option.value}
          value={option}
        >
          {option.label}
        </ComboboxItem>
      )}
    </ComboboxList>
  );
}

export const Playground: Story = {
  render: ({ placeholder, size, ...args }) => (
    <Combobox {...args} defaultOpen items={fruits}>
      <ComboboxInputGroup size={size}>
        <ComboboxInput aria-label="Fruit" placeholder={placeholder} />
        <ComboboxClear aria-label="Clear fruit" />
        <ComboboxTrigger aria-label="Show fruits" />
      </ComboboxInputGroup>
      <ComboboxContent>
        <ComboboxEmpty>No fruits found.</ComboboxEmpty>
        <OptionItems />
      </ComboboxContent>
    </Combobox>
  ),
};

export const WithValue: Story = {
  render: ({ placeholder, size, ...args }) => (
    <Combobox {...args} defaultOpen defaultValue={fruits[5]} items={fruits}>
      <ComboboxInputGroup size={size}>
        <ComboboxInput aria-label="Fruit" placeholder={placeholder} />
        <ComboboxClear aria-label="Clear fruit" />
        <ComboboxTrigger aria-label="Show fruits" />
      </ComboboxInputGroup>
      <ComboboxContent>
        <ComboboxEmpty>No fruits found.</ComboboxEmpty>
        <OptionItems />
      </ComboboxContent>
    </Combobox>
  ),
};

export const Sizes: Story = {
  render: ({ placeholder, ...args }) => (
    <div style={{ display: "grid", gap: 12 }}>
      {sizes.map((size) => (
        <Combobox {...args} defaultValue={fruits[0]} items={fruits} key={size}>
          <ComboboxInputGroup size={size}>
            <ComboboxInput
              aria-label={`Fruit (${size})`}
              placeholder={placeholder}
            />
            <ComboboxClear aria-label="Clear fruit" />
            <ComboboxTrigger aria-label="Show fruits" />
          </ComboboxInputGroup>
          <ComboboxContent>
            <ComboboxEmpty>No fruits found.</ComboboxEmpty>
            <OptionItems />
          </ComboboxContent>
        </Combobox>
      ))}
    </div>
  ),
  parameters: isolatedStory(180),
};

export const States: Story = {
  render: ({ placeholder, size, ...args }) => (
    <div style={{ display: "grid", gap: 12 }}>
      <Combobox {...args} items={fruits}>
        <ComboboxInputGroup size={size}>
          <ComboboxInput aria-label="Empty" placeholder={placeholder} />
          <ComboboxTrigger aria-label="Show fruits" />
        </ComboboxInputGroup>
        <ComboboxContent>
          <OptionItems />
        </ComboboxContent>
      </Combobox>
      <Combobox {...args} defaultValue={fruits[2]} items={fruits} readOnly>
        <ComboboxInputGroup size={size}>
          <ComboboxInput aria-label="Read only" placeholder={placeholder} />
          <ComboboxTrigger aria-label="Show fruits" />
        </ComboboxInputGroup>
        <ComboboxContent>
          <OptionItems />
        </ComboboxContent>
      </Combobox>
      <Combobox {...args} defaultValue={fruits[2]} disabled items={fruits}>
        <ComboboxInputGroup size={size}>
          <ComboboxInput aria-label="Disabled" placeholder={placeholder} />
          <ComboboxClear aria-label="Clear fruit" />
          <ComboboxTrigger aria-label="Show fruits" />
        </ComboboxInputGroup>
        <ComboboxContent>
          <OptionItems />
        </ComboboxContent>
      </Combobox>
      <Field invalid>
        <Combobox {...args} items={fruits}>
          <ComboboxInputGroup size={size}>
            <ComboboxInput aria-label="Invalid" placeholder={placeholder} />
            <ComboboxTrigger aria-label="Show fruits" />
          </ComboboxInputGroup>
          <ComboboxContent>
            <OptionItems />
          </ComboboxContent>
        </Combobox>
      </Field>
    </div>
  ),
  parameters: isolatedStory(220),
};

export const Empty: Story = {
  name: "Empty state",
  render: ({ size, ...args }) => (
    <Combobox {...args} defaultInputValue="durian" defaultOpen items={fruits}>
      <ComboboxInputGroup size={size}>
        <ComboboxInput aria-label="Fruit" />
        <ComboboxClear aria-label="Clear search" />
        <ComboboxTrigger aria-label="Show fruits" />
      </ComboboxInputGroup>
      <ComboboxContent>
        <ComboboxEmpty>No fruits found.</ComboboxEmpty>
        <OptionItems />
      </ComboboxContent>
    </Combobox>
  ),
  parameters: isolatedStory(200),
};

export const Groups: Story = {
  render: ({ size, ...args }) => (
    <Combobox {...args} defaultOpen items={produce}>
      <ComboboxInputGroup size={size}>
        <ComboboxInput aria-label="Produce" placeholder="Search produce" />
        <ComboboxTrigger aria-label="Show produce" />
      </ComboboxInputGroup>
      <ComboboxContent>
        <ComboboxEmpty>No produce found.</ComboboxEmpty>
        <ComboboxList>
          {(group: ProduceGroup) => (
            <Fragment key={group.label}>
              <ComboboxGroup items={group.items}>
                <ComboboxGroupLabel>{group.label}</ComboboxGroupLabel>
                <ComboboxCollection>
                  {(item: Option) => (
                    <ComboboxItem key={item.value} value={item}>
                      {item.label}
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
              </ComboboxGroup>
              <ComboboxSeparator />
            </Fragment>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  ),
  parameters: isolatedStory(440),
};

export const DisabledItems: Story = {
  render: ({ size, ...args }) => (
    <Combobox {...args} defaultOpen defaultValue={regions[0]} items={regions}>
      <ComboboxInputGroup size={size}>
        <ComboboxInput aria-label="Region" placeholder="Search regions" />
        <ComboboxTrigger aria-label="Show regions" />
      </ComboboxInputGroup>
      <ComboboxContent>
        <ComboboxEmpty>No regions found.</ComboboxEmpty>
        <OptionItems />
      </ComboboxContent>
    </Combobox>
  ),
  parameters: isolatedStory(300),
};

export const Multiple: Story = {
  render: ({ size, ...args }) => (
    <Combobox
      autoHighlight={args.autoHighlight}
      defaultOpen
      defaultValue={fruits.slice(2, 5)}
      disabled={args.disabled}
      items={fruits}
      multiple
      readOnly={args.readOnly}
    >
      <ComboboxInputGroup size={size}>
        <ComboboxValue>
          {(selected: ReadonlyArray<Option>) => (
            <ComboboxChips
              aria-label={selected.length > 0 ? "Selected fruits" : undefined}
            >
              {selected.map((fruit) => (
                <ComboboxChip
                  aria-description="Press Backspace or Delete to remove"
                  key={fruit.value}
                  removeLabel={`Remove ${fruit.label}`}
                >
                  {fruit.label}
                </ComboboxChip>
              ))}
              <ComboboxInput
                aria-label="Fruits"
                placeholder={selected.length > 0 ? "" : "Add fruits"}
              />
            </ComboboxChips>
          )}
        </ComboboxValue>
      </ComboboxInputGroup>
      <ComboboxContent>
        <ComboboxEmpty>No fruits found.</ComboboxEmpty>
        <OptionItems />
      </ComboboxContent>
    </Combobox>
  ),
};

export const LabelPicker: Story = {
  name: "Label picker (in a field)",
  render: ({ size }) => (
    <Field>
      <FieldLabel>Labels</FieldLabel>
      <Combobox
        defaultOpen
        defaultValue={labels.slice(0, 2)}
        items={labels}
        multiple
        onOpenChange={(open, eventDetails) => {
          if (!open && eventDetails.reason === "item-press") {
            eventDetails.cancel();
          }
        }}
      >
        <ComboboxInputGroup size={size}>
          <ComboboxValue>
            {(selected: ReadonlyArray<Option>) => (
              <ComboboxChips
                aria-label={selected.length > 0 ? "Selected labels" : undefined}
              >
                {selected.map((label) => (
                  <ComboboxChip
                    aria-description="Press Backspace or Delete to remove"
                    key={label.value}
                    removeLabel={`Remove ${label.label}`}
                  >
                    {label.label}
                  </ComboboxChip>
                ))}
                <ComboboxInput
                  placeholder={selected.length > 0 ? "" : "Add labels"}
                />
              </ComboboxChips>
            )}
          </ComboboxValue>
        </ComboboxInputGroup>
        <ComboboxContent>
          <ComboboxEmpty>No matching labels.</ComboboxEmpty>
          <OptionItems />
        </ComboboxContent>
      </Combobox>
      <FieldDescription>
        Labels help others find and triage issues.
      </FieldDescription>
    </Field>
  ),
  parameters: isolatedStory(460),
};
