import type { Meta, StoryObj } from "@storybook/react-vite";
import styles from "./Foundations.module.css";
import { composite, contrastRatio, toHex } from "./resolveColor";
import { createThemeMeasurement } from "./themeMeasurement";

interface Token {
  readonly name: string;
  readonly role: string;
}

interface TokenGroup {
  readonly title: string;
  readonly tokens: ReadonlyArray<Token>;
}

const groups: ReadonlyArray<TokenGroup> = [
  {
    title: "Surfaces",
    tokens: [
      { name: "--color-bg", role: "Window and page background" },
      { name: "--color-surface", role: "Cards, raised buttons, kbd" },
      { name: "--color-surface-overlay", role: "Menus, popovers, dialogs" },
      { name: "--color-field", role: "Input and select backgrounds" },
      { name: "--color-backdrop", role: "Scrim behind modal dialogs" },
    ],
  },
  {
    title: "Text",
    tokens: [
      { name: "--color-text", role: "Primary text and icons" },
      { name: "--color-text-secondary", role: "Descriptions, inactive tabs" },
      { name: "--color-text-tertiary", role: "Placeholders, hints, shortcuts" },
    ],
  },
  {
    title: "Lines",
    tokens: [
      { name: "--color-separator", role: "Dividers and table rules" },
      { name: "--color-border", role: "Field borders" },
      { name: "--color-border-hover", role: "Hovered field borders" },
      { name: "--color-border-strong", role: "Checkbox and radio outlines" },
      { name: "--color-focus-ring", role: "Keyboard focus outline" },
    ],
  },
  {
    title: "Fills (alpha of text)",
    tokens: [
      { name: "--color-fill", role: "Soft buttons, segmented tracks" },
      { name: "--color-fill-hover", role: "Hover and highlighted items" },
      { name: "--color-fill-active", role: "Pressed and selected states" },
    ],
  },
  {
    title: "Accent",
    tokens: [
      { name: "--color-accent", role: "Primary actions, checked controls" },
      { name: "--color-accent-hover", role: "Hovered primary actions" },
      { name: "--color-on-accent", role: "Text and glyphs on accent" },
      { name: "--color-selection", role: "Selected text background" },
    ],
  },
  {
    title: "Status",
    tokens: [
      { name: "--color-danger-solid", role: "Destructive buttons" },
      { name: "--color-danger-text", role: "Error text" },
      { name: "--color-danger-bg", role: "Error callout background" },
      { name: "--color-danger-border", role: "Error callout border" },
      { name: "--color-danger-fill", role: "Error tint on any surface" },
      { name: "--color-success-text", role: "Success text" },
      { name: "--color-success-bg", role: "Success callout background" },
      { name: "--color-success-fill", role: "Success tint on any surface" },
      { name: "--color-warning-text", role: "Warning text" },
      { name: "--color-warning-bg", role: "Warning callout background" },
      { name: "--color-warning-fill", role: "Warning tint on any surface" },
      { name: "--color-info-text", role: "Info text" },
      { name: "--color-info-bg", role: "Info callout background" },
      { name: "--color-info-fill", role: "Info tint on any surface" },
    ],
  },
];

const ramps = [
  { name: "gray", steps: [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12] },
  { name: "red", steps: [3, 6, 9, 10, 11] },
  { name: "green", steps: [3, 6, 11] },
  { name: "amber", steps: [3, 6, 11] },
  { name: "blue", steps: [3, 6, 11] },
] as const;

interface ContrastPair {
  readonly foreground: string;
  readonly background: ReadonlyArray<string>;
  readonly label: string;
  readonly minimum: number;
}

const pairs: ReadonlyArray<ContrastPair> = [
  {
    background: ["--color-bg"],
    foreground: "--color-text",
    label: "Text on background",
    minimum: 4.5,
  },
  {
    background: ["--color-bg"],
    foreground: "--color-text-secondary",
    label: "Secondary text on background",
    minimum: 4.5,
  },
  {
    background: ["--color-surface-overlay"],
    foreground: "--color-text-secondary",
    label: "Secondary text on overlay",
    minimum: 4.5,
  },
  {
    background: ["--color-bg"],
    foreground: "--color-text-tertiary",
    label: "Tertiary text on background",
    minimum: 4.5,
  },
  {
    background: ["--color-surface-overlay"],
    foreground: "--color-text-tertiary",
    label: "Tertiary text on overlay",
    minimum: 4.5,
  },
  {
    background: ["--color-surface-overlay", "--color-fill-hover"],
    foreground: "--color-text",
    label: "Text on highlighted menu item",
    minimum: 4.5,
  },
  {
    background: ["--color-bg", "--color-fill-active"],
    foreground: "--color-text-secondary",
    label: "Secondary text on selected fill",
    minimum: 4.5,
  },
  {
    background: ["--color-bg", "--color-selection"],
    foreground: "--color-text",
    label: "Selected text",
    minimum: 4.5,
  },
  {
    background: ["--color-bg", "--color-info-fill"],
    foreground: "--color-info-text",
    label: "Info text on info tint",
    minimum: 4.5,
  },
  {
    background: ["--color-accent"],
    foreground: "--color-on-accent",
    label: "On-accent text on accent",
    minimum: 4.5,
  },
  {
    background: ["--color-danger-solid"],
    foreground: "--color-on-danger",
    label: "On-danger text on danger",
    minimum: 4.5,
  },
  {
    background: ["--color-bg"],
    foreground: "--color-danger-text",
    label: "Danger text on background",
    minimum: 4.5,
  },
  {
    background: ["--color-danger-bg"],
    foreground: "--color-danger-text",
    label: "Danger text on danger callout",
    minimum: 4.5,
  },
  {
    background: ["--color-success-bg"],
    foreground: "--color-success-text",
    label: "Success text on success callout",
    minimum: 4.5,
  },
  {
    background: ["--color-warning-bg"],
    foreground: "--color-warning-text",
    label: "Warning text on warning callout",
    minimum: 4.5,
  },
  {
    background: ["--color-info-bg"],
    foreground: "--color-info-text",
    label: "Info text on info callout",
    minimum: 4.5,
  },
  {
    background: ["--color-tooltip-bg"],
    foreground: "--color-tooltip-text",
    label: "Tooltip text",
    minimum: 4.5,
  },
  {
    background: ["--color-bg"],
    foreground: "--color-border-strong",
    label: "Checkbox outline on background",
    minimum: 3,
  },
  {
    background: ["--color-bg"],
    foreground: "--color-focus-ring",
    label: "Focus ring on background",
    minimum: 3,
  },
];

function cssVar(name: string): string {
  return `var(${name})`;
}

function layeredBackground(layers: ReadonlyArray<string>): string {
  const [base, ...overlays] = layers.map(cssVar);
  return [
    ...overlays
      .toReversed()
      .map((overlay) => `linear-gradient(${overlay}, ${overlay})`),
    base,
  ].join(", ");
}

function measureTokens(): Record<string, string> {
  const entries = groups.flatMap((group) =>
    group.tokens.map((token) => [
      token.name,
      toHex(composite([cssVar(token.name)])),
    ]),
  );
  return Object.fromEntries(entries);
}

const useTokenValues = createThemeMeasurement(measureTokens);

function TokenSwatches() {
  const values = useTokenValues();
  return (
    <div className={styles.page}>
      {groups.map((group) => (
        <section className={styles.section} key={group.title}>
          <h2 className={styles.heading}>{group.title}</h2>
          <div className={styles.grid}>
            {group.tokens.map((token) => (
              <div className={styles.swatch} key={token.name}>
                <div
                  className={styles.chip}
                  style={{ background: cssVar(token.name) }}
                />
                <div className={styles.meta}>
                  <span className={styles.name}>{token.name}</span>
                  <span className={styles.note}>{token.role}</span>
                  <span className={styles.value}>
                    {values[token.name] ?? ""}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

interface MeasuredPair {
  readonly label: string;
  readonly minimum: number;
  readonly ratio: number;
}

function measurePairs(): ReadonlyArray<MeasuredPair> {
  return pairs.map((pair) => {
    const background = composite(pair.background.map(cssVar));
    const foreground = composite([
      ...pair.background.map(cssVar),
      cssVar(pair.foreground),
    ]);
    return {
      label: pair.label,
      minimum: pair.minimum,
      ratio: contrastRatio(foreground, background),
    };
  });
}

const useMeasuredPairs = createThemeMeasurement(measurePairs);

function ContrastTable() {
  const measured = useMeasuredPairs();
  return (
    <div className={styles.page}>
      <section className={styles.section}>
        <h2 className={styles.heading}>Measured contrast</h2>
        <p className={styles.lede}>
          Ratios are measured in the browser from the rendered tokens, so they
          follow the active theme and any overrides set on the root element.
          Text pairs need 4.5:1. Control outlines and focus rings need 3:1.
        </p>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Pair</th>
              <th>Sample</th>
              <th>Ratio</th>
              <th>Minimum</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((pair, index) => {
              const row = measured[index];
              const passes = row !== undefined && row.ratio >= pair.minimum;
              return (
                <tr key={pair.label}>
                  <td>{pair.label}</td>
                  <td>
                    <span
                      className={styles.sample}
                      style={{
                        background: layeredBackground(pair.background),
                        color: cssVar(pair.foreground),
                      }}
                    >
                      Aa 123
                    </span>
                  </td>
                  <td>
                    {row === undefined ? "" : `${row.ratio.toFixed(2)}:1`}
                  </td>
                  <td>{pair.minimum}:1</td>
                  <td className={passes ? styles.pass : styles.fail}>
                    {row === undefined ? "" : passes ? "Pass" : "Fail"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function measureDefinedSteps(): ReadonlyArray<string> {
  const root = getComputedStyle(document.documentElement);
  return ramps.flatMap((ramp) =>
    ramp.steps
      .map((step) => `--${ramp.name}-${step}`)
      .filter((name) => root.getPropertyValue(name).trim() !== ""),
  );
}

const useDefinedSteps = createThemeMeasurement(measureDefinedSteps);

function Ramps() {
  const defined = useDefinedSteps();
  return (
    <div className={styles.page}>
      <section className={styles.section}>
        <h2 className={styles.heading}>Primitive ramps</h2>
        <p className={styles.lede}>
          Components never use these directly. Each theme defines its own
          values, and semantic tokens point at the steps that fill a role.
        </p>
        {ramps.map((ramp) => (
          <div className={styles.ramp} key={ramp.name}>
            {ramp.steps
              .filter((step) => defined.includes(`--${ramp.name}-${step}`))
              .map((step) => (
                <div
                  className={styles.rampStep}
                  key={step}
                  style={{
                    background: cssVar(`--${ramp.name}-${step}`),
                    color:
                      ramp.name === "gray" && step < 9
                        ? "var(--gray-12)"
                        : "var(--gray-1)",
                  }}
                >
                  {ramp.name}-{step}
                </div>
              ))}
          </div>
        ))}
      </section>
    </div>
  );
}

const meta = {
  parameters: { layout: "fullscreen" },
  title: "Foundations/Colors",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const SemanticTokens: Story = {
  render: () => <TokenSwatches />,
};

export const Contrast: Story = {
  render: () => <ContrastTable />,
};

export const PrimitiveRamps: Story = {
  render: () => <Ramps />,
};
