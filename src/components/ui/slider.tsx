import * as SliderPrimitive from "@radix-ui/react-slider";
export function Slider({
  value,
  onChange,
  min = 100,
  max = 2000,
  step = 50,
  label = "Monthly investment",
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
}) {
  return (
    <SliderPrimitive.Root
      className="slider"
      min={min}
      max={max}
      step={step}
      value={[value]}
      onValueChange={(values) => onChange(values[0])}
    >
      <SliderPrimitive.Track className="slider-track">
        <SliderPrimitive.Range className="slider-range" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        className="slider-thumb"
        aria-label={label}
        aria-valuetext={`${value} ${label === "Monthly investment" ? "lei per month" : "years"}`}
      />
    </SliderPrimitive.Root>
  );
}
