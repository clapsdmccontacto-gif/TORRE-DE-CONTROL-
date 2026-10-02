import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const fieldClass =
  'h-9 w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none transition-[box-shadow] focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input data-slot="input" className={cn(fieldClass, className)} {...props} />;
}

/** Select nativo: en la pistola de picking y en móviles abre el selector del sistema. */
export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select data-slot="native-select" className={cn(fieldClass, 'pr-8', className)} {...props} />
  );
}
