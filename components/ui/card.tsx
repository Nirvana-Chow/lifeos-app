// Thin adaptation of shadcn Card, MIT copyright (c) 2023 shadcn.
// Source commit 30a58d4498f270af1c1e981a7d78a15cf5740841. See THIRD_PARTY_NOTICES.md.
import type { ComponentProps } from 'react';
export function Card({className='',...props}:ComponentProps<'div'>){return <div data-slot="card" className={`rounded-[var(--lo-radius-surface)] border border-[var(--border)] bg-[var(--card)] text-[var(--card-foreground)] py-6 ${className}`} {...props}/>;}
export function CardHeader({className='',...props}:ComponentProps<'div'>){return <div data-slot="card-header" className={`grid gap-2 px-6 ${className}`} {...props}/>;}
export function CardTitle({className='',...props}:ComponentProps<'div'>){return <div data-slot="card-title" className={`font-semibold ${className}`} {...props}/>;}
export function CardContent({className='',...props}:ComponentProps<'div'>){return <div data-slot="card-content" className={`px-6 ${className}`} {...props}/>;}
