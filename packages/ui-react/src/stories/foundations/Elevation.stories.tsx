import type { Meta, StoryObj } from "@storybook/react-vite";
import styles from "./Foundations.module.css";

const surfaces = [
  {
    background: "--color-bg",
    radius: "--radius-card",
    shadow: "none",
    title: "Background",
    use: "Window and page",
  },
  {
    background: "--color-surface",
    radius: "--radius-card",
    shadow: "--shadow-raised",
    title: "Raised",
    use: "Cards, secondary buttons, kbd",
  },
  {
    background: "--color-field",
    radius: "--radius-control",
    shadow: "--shadow-field",
    title: "Field",
    use: "Inputs and select triggers (1px border)",
  },
  {
    background: "--color-surface-overlay",
    radius: "--radius-popup",
    shadow: "--shadow-overlay",
    title: "Overlay",
    use: "Menus, popovers, toasts",
  },
  {
    background: "--color-surface-overlay",
    radius: "--radius-dialog",
    shadow: "--shadow-dialog",
    title: "Dialog",
    use: "Modal dialogs and drawers",
  },
] as const;

const radii = [
  { token: "--radius-tag", use: "Badges, keycaps, checkboxes" },
  { token: "--radius-control", use: "Buttons, inputs, tooltips" },
  { token: "--radius-card", use: "Cards" },
  { token: "--radius-popup", use: "Menus, popovers, toasts" },
  { token: "--radius-dialog", use: "Dialogs" },
] as const;

function Surfaces() {
  return (
    <div className={styles.page}>
      <section className={styles.section}>
        <h2 className={styles.heading}>Surfaces</h2>
        <p className={styles.lede}>
          Elevation comes from layered shadows whose first layer is a 1px ring,
          so raised surfaces read clearly on any background. Fields keep a real
          border because it marks an editable boundary.
        </p>
        <div className={styles.surfaceRow}>
          {surfaces.map((surface) => (
            <div
              className={styles.surface}
              key={surface.title}
              style={{
                background: `var(${surface.background})`,
                border:
                  surface.title === "Field"
                    ? "1px solid var(--color-border)"
                    : undefined,
                borderRadius: `var(${surface.radius})`,
                boxShadow:
                  surface.shadow === "none" ? "none" : `var(${surface.shadow})`,
              }}
            >
              <strong>{surface.title}</strong>
              <span className={styles.note}>{surface.use}</span>
              <span className={styles.value}>{surface.shadow}</span>
            </div>
          ))}
        </div>
      </section>
      <section className={styles.section}>
        <h2 className={styles.heading}>Radii</h2>
        <p className={styles.lede}>
          Radii scale with --radius-scale. Items inside a padded popup use the
          popup radius minus the padding so the corners stay concentric.
        </p>
        <div className={styles.grid}>
          {radii.map((radius) => (
            <div className={styles.swatch} key={radius.token}>
              <div style={{ padding: 16 }}>
                <div
                  style={{
                    background: "var(--color-fill-active)",
                    borderRadius: `var(${radius.token})`,
                    height: 48,
                  }}
                />
              </div>
              <div className={styles.meta}>
                <span className={styles.name}>{radius.token}</span>
                <span className={styles.note}>{radius.use}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const meta = {
  parameters: { layout: "fullscreen" },
  title: "Foundations/Elevation",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const SurfacesAndRadii: Story = {
  name: "Surfaces and radii",
  render: () => <Surfaces />,
};
