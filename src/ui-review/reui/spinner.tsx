import type { ComponentProps } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../ui/utils';

export function Spinner({ className, ...props }: ComponentProps<'svg'>) {
  return <Loader2 role="status" aria-label="正在加载" className={cn('size-4 animate-spin', className)} {...props} />;
}
