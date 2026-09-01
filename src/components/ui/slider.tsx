import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";

type SliderProps = React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>;

export const Slider = React.forwardRef<
  React.ComponentRef<typeof SliderPrimitive.Root>,
  SliderProps
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex h-11 w-full touch-none select-none items-center data-disabled:opacity-40",
      className,
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-border">
      <SliderPrimitive.Range className="absolute h-full bg-active" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      className="block size-4 rounded-full bg-fg shadow-border transition-[box-shadow,transform] duration-150 ease-out hover:shadow-border-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/50 active:scale-95"
      aria-label={props["aria-label"]}
      aria-valuetext={props["aria-valuetext"]}
    />
  </SliderPrimitive.Root>
));
Slider.displayName = "Slider";
