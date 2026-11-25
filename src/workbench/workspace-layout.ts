export type WorkspaceLayout = 'auto' | 'mobile' | 'desktop';

export const workspaceLayoutKey = 'lifeos-ui-workspace-layout';
export const mobileWorkspaceQuery = '(max-width: 850px)';

export function readWorkspaceLayout(value: unknown): WorkspaceLayout {
  return value === 'mobile' || value === 'desktop' ? value : 'auto';
}

// Restore only the device's layout preference, before rendering the workspace.
export const workspaceLayoutInitializationScript = `(()=>{try{const value=localStorage.getItem(${JSON.stringify(workspaceLayoutKey)});if(value==='mobile'||value==='desktop')document.documentElement.dataset.lifeosWorkspaceLayout=value;}catch{}})();`;
