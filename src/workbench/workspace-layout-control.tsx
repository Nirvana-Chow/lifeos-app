'use client';

import {useSyncExternalStore} from 'react';
import {MonitorSmartphone} from 'lucide-react';
import {Button} from '../ui-review/ui/button';
import {mobileWorkspaceQuery, readWorkspaceLayout, workspaceLayoutKey, type WorkspaceLayout} from './workspace-layout';

const changeEvent = 'lifeos-workspace-layout-change';

function getPreference() {
  return readWorkspaceLayout(document.documentElement.dataset.lifeosWorkspaceLayout);
}

function setPreference(value: WorkspaceLayout) {
  applyPreference(value);
  try {
    if (value === 'auto') localStorage.removeItem(workspaceLayoutKey);
    else localStorage.setItem(workspaceLayoutKey, value);
  } catch {
    // The current document can still switch when browser storage is unavailable.
  }
}

function applyPreference(value: WorkspaceLayout) {
  const {dataset} = document.documentElement;
  if (value === 'auto') delete dataset.lifeosWorkspaceLayout;
  else dataset.lifeosWorkspaceLayout = value;
  window.dispatchEvent(new Event(changeEvent));
}

function getActiveLayout() {
  const preference = getPreference();
  if (preference !== 'auto') return preference;
  return window.matchMedia(mobileWorkspaceQuery).matches ? 'mobile' : 'desktop';
}

function subscribe(onChange: () => void) {
  const media = window.matchMedia(mobileWorkspaceQuery);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== workspaceLayoutKey && event.key !== null) return;
    const value = readWorkspaceLayout(event.newValue);
    if (getPreference() !== value) applyPreference(value);
  };
  media.addEventListener('change', onChange);
  window.addEventListener(changeEvent, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    media.removeEventListener('change', onChange);
    window.removeEventListener(changeEvent, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function WorkspaceLayoutToggle({className}: {className: string}) {
  const activeLayout = useSyncExternalStore(subscribe, getActiveLayout, () => null);
  const label = activeLayout === 'mobile' ? '切换到桌面版' : activeLayout === 'desktop' ? '切换到手机版' : '切换布局';
  return <Button type="button" variant="ghost" size="icon" className={className} data-workspace-nav aria-label={label} title={label}
    onClick={() => setPreference(getActiveLayout() === 'mobile' ? 'desktop' : 'mobile')}>
    <MonitorSmartphone size={19} aria-hidden="true"/>
  </Button>;
}

export function WorkspaceLayoutSettings({className}: {className: string}) {
  const preference = useSyncExternalStore(subscribe, getPreference, () => 'auto' as WorkspaceLayout);
  return <label className={className}>
    <span>显示布局</span>
    <select value={preference} onChange={event => setPreference(readWorkspaceLayout(event.target.value))}>
      <option value="auto">跟随屏幕</option>
      <option value="mobile">手机版</option>
      <option value="desktop">桌面版</option>
    </select>
  </label>;
}
