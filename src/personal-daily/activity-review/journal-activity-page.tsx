'use client';

import { useEffect, useRef } from 'react';
import { readJournalActivity } from './journal-source';
import { mountActivity, type ActivitySelection } from './view.mjs';

export function JournalActivityPage({ markup, styles, initialDate, serverDay, mergeReceipts }: {
  markup: string; styles: string; initialDate?: string; serverDay: string;
  mergeReceipts: { label: string; href: string; at: string }[];
}) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const shadow = node.shadowRoot ?? node.attachShadow({ mode: 'open' });
    let pending: AbortController | undefined;
    let selection: ActivitySelection | undefined = initialDate ? { date: initialDate, period: 'day', category: 'records' } : undefined;

    function clear() {
      pending?.abort();
      pending = undefined;
      shadow.replaceChildren();
    }

    async function refresh() {
      clear();
      if (document.visibilityState === 'hidden') return;
      const controller = new AbortController();
      pending = controller;
      const mapping = await readJournalActivity((input, init) => fetch(input, { ...init, signal: controller.signal }));
      if (controller.signal.aborted || document.visibilityState !== 'visible') return;

      const stylesheet = document.createElement('style');
      stylesheet.textContent = styles;
      const layout = document.createElement('div');
      layout.className = 'activity-document';
      // Only the repository's static layout is markup. Journal fields are mounted as text.
      layout.innerHTML = markup;
      shadow.replaceChildren(stylesheet, layout);
      mountActivity(layout, mapping, {
        serverDay,
        mergeReceipts,
        selection,
        onSelectionChange: next => { selection = next; },
      });
    }

    function visibility() {
      if (document.visibilityState === 'hidden') clear();
      else void refresh();
    }

    window.addEventListener('pagehide', clear);
    window.addEventListener('pageshow', visibility);
    document.addEventListener('visibilitychange', visibility);
    void refresh();
    return () => {
      clear();
      window.removeEventListener('pagehide', clear);
      window.removeEventListener('pageshow', visibility);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [markup, styles, initialDate, serverDay, mergeReceipts]);

  return <div ref={container} />;
}
