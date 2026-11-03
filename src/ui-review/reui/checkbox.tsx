"use client";
import type { ComponentProps } from 'react';
import { Checkbox as Primitive } from 'radix-ui';
import { Check } from 'lucide-react';
import { cn } from '../ui/utils';

// Local Radix primitive used by the fixed ReUI table. Row selection is not enabled.
export function Checkbox({ className, ...props }: ComponentProps<typeof Primitive.Root>) {
  return (
    <Primitive.Root
      data-slot="checkbox"
      className={cn('size-5 shrink-0 rounded border border-input outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50', className)}
      {...props}
    >
      <Primitive.Indicator><Check className="size-4" aria-hidden="true" /></Primitive.Indicator>
    </Primitive.Root>
  );
}
