import { Slider as BaseSlider } from "@base-ui/react/slider";
import { cn, type WithClassName } from "../../lib/cn";
import label from "../label/Label.module.css";
import styles from "./Slider.module.css";

export type SliderProps<
  Value extends number | readonly number[] = number | readonly number[],
> = WithClassName<BaseSlider.Root.Props<Value>>;

export function Slider<Value extends number | readonly number[]>({
  className,
  thumbAlignment = "edge",
  ...props
}: SliderProps<Value>) {
  return (
    <BaseSlider.Root
      {...props}
      className={cn(styles.root, className)}
      thumbAlignment={thumbAlignment}
    />
  );
}

export type SliderLabelProps = WithClassName<BaseSlider.Label.Props>;

export function SliderLabel({ className, ...props }: SliderLabelProps) {
  return <BaseSlider.Label {...props} className={cn(label.root, className)} />;
}

export type SliderValueProps = WithClassName<BaseSlider.Value.Props>;

export function SliderValue({ className, ...props }: SliderValueProps) {
  return (
    <BaseSlider.Value {...props} className={cn(styles.value, className)} />
  );
}

export type SliderControlProps = WithClassName<BaseSlider.Control.Props>;

export function SliderControl({
  children,
  className,
  ...props
}: SliderControlProps) {
  return (
    <BaseSlider.Control {...props} className={cn(styles.control, className)}>
      <BaseSlider.Track className={styles.track}>
        <BaseSlider.Indicator className={styles.indicator} />
        {children}
      </BaseSlider.Track>
    </BaseSlider.Control>
  );
}

export type SliderThumbProps = WithClassName<BaseSlider.Thumb.Props>;

export function SliderThumb({ className, ...props }: SliderThumbProps) {
  return (
    <BaseSlider.Thumb {...props} className={cn(styles.thumb, className)} />
  );
}
