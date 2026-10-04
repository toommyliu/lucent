import { Input as BaseInput } from "@base-ui/react/input";
import {
  createContext,
  memo,
  use,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { HexColorPicker } from "react-colorful";
import { cn, type WithClassName } from "../../lib/cn";
import { Popover, PopoverContent, PopoverTrigger } from "../popover/Popover";
import styles from "./ColorPicker.module.css";

export type ColorPickerSize = "sm" | "md" | "lg";

export interface ColorPickerProps extends WithClassName<
  Omit<
    BaseInput.Props,
    "defaultValue" | "onValueChange" | "size" | "type" | "value"
  >
> {
  readonly defaultValue?: string;
  readonly onValueChange?: (value: string) => void;
  readonly onValueCommitted?: (value: string) => void;
  readonly size?: ColorPickerSize;
  readonly triggerLabel?: string;
  readonly value?: string;
}

const hexPattern = /^#?([0-9a-f]{6})$/i;

function parseHex(text: string): string | null {
  const digits = hexPattern.exec(text.trim())?.[1];
  return digits === undefined ? null : `#${digits.toLowerCase()}`;
}

function linearChannel(hex: string, offset: number): number {
  const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function isDark(color: string): boolean {
  const hex = parseHex(color);
  if (hex === null) {
    return false;
  }
  const luminance =
    0.2126 * linearChannel(hex, 1) +
    0.7152 * linearChannel(hex, 3) +
    0.0722 * linearChannel(hex, 5);
  return luminance <= 0.179;
}

type BlurEvent = Parameters<NonNullable<ColorPickerProps["onBlur"]>>[0];

const ColorContext = createContext("#000000");

interface PickerPanelProps {
  readonly onChange: (value: string) => void;
  readonly onChangeEnd: (value: string) => void;
}

const PickerPanel = memo(function PickerPanel({
  onChange,
  onChangeEnd,
}: PickerPanelProps) {
  return (
    <HexColorPicker
      className={styles.picker}
      color={use(ColorContext)}
      onChange={onChange}
      onChangeEnd={onChangeEnd}
    />
  );
});

export const ColorPicker = memo(function ColorPicker({
  className,
  defaultValue = "#000000",
  disabled,
  onBlur,
  onValueChange,
  onValueCommitted,
  readOnly,
  size = "md",
  triggerLabel = "Choose color",
  value,
  ...props
}: ColorPickerProps) {
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const [draft, setDraft] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ onBlur, onValueChange, onValueCommitted, value });
  useLayoutEffect(() => {
    latest.current = { onBlur, onValueChange, onValueCommitted, value };
  });
  const color = value ?? uncontrolledValue;

  const change = useCallback((next: string) => {
    if (latest.current.value === undefined) {
      setUncontrolledValue(next);
    }
    latest.current.onValueChange?.(next);
  }, []);

  const commit = useCallback((next: string) => {
    latest.current.onValueCommitted?.(next);
  }, []);

  const handleBlur = useCallback((event: BlurEvent) => {
    setDraft(null);
    latest.current.onBlur?.(event);
  }, []);

  const handleTextChange = useCallback(
    (text: string) => {
      const next = parseHex(text);
      if (next === null) {
        setDraft(text);
        return;
      }
      setDraft(null);
      change(next);
      commit(next);
    },
    [change, commit],
  );

  const locked = disabled === true || readOnly === true;
  const popover = useMemo(
    () => (
      <Popover>
        <PopoverTrigger
          aria-label={triggerLabel}
          className={styles.swatch}
          disabled={locked}
        />
        <PopoverContent align="start" anchor={rootRef} className={styles.popup}>
          <PickerPanel onChange={change} onChangeEnd={commit} />
        </PopoverContent>
      </Popover>
    ),
    [change, commit, locked, triggerLabel],
  );

  const fill = useMemo(() => (isDark(color) ? "dark" : "light"), [color]);
  const style = useMemo(() => ({ backgroundColor: color }), [color]);

  return (
    <div
      className={cn(styles.root, className)}
      data-disabled={disabled ? "" : undefined}
      data-fill={fill}
      data-size={size}
      ref={rootRef}
      style={style}
    >
      <ColorContext value={color}>{popover}</ColorContext>
      <BaseInput
        {...props}
        className={styles.input}
        disabled={disabled}
        maxLength={7}
        onBlur={handleBlur}
        onValueChange={handleTextChange}
        readOnly={readOnly}
        spellCheck={false}
        value={draft ?? color}
      />
    </div>
  );
});
