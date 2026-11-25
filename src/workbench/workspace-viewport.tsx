'use client';

import {useEffect} from 'react';

/** Keep the active editor usable when iOS shrinks only its visual viewport. */
export function WorkspaceViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const style = document.body.style;
    let frame = 0;
    const clear = () => {
      style.removeProperty('--lo-keyboard-height');
      style.removeProperty('--lo-keyboard-top');
    };
    const update = () => {
      const target = document.activeElement;
      if (Math.abs(viewport.scale - 1) > 0.01 || root.clientHeight - viewport.height < 100 ||
        !target?.matches('textarea, [contenteditable="true"], input:not([type]), input:is([type="text"], [type="search"], [type="email"], [type="password"], [type="number"], [type="url"], [type="tel"])')) {
        clear();
        return;
      }
      style.setProperty('--lo-keyboard-height', `${Math.floor(viewport.height)}px`);
      style.setProperty('--lo-keyboard-top', `${Math.round(viewport.offsetTop)}px`);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    viewport.addEventListener('resize', schedule);
    viewport.addEventListener('scroll', schedule);
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', schedule);
      viewport.removeEventListener('scroll', schedule);
      document.removeEventListener('focusin', schedule);
      document.removeEventListener('focusout', schedule);
      clear();
    };
  }, []);
  return null;
}
