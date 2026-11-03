import { expect, type Page } from '@playwright/test';

export type ReuiGridPresentation = {
  renderer: string | null;
  failures: number;
  grids: number;
  expectedRows: number;
  declaredRows: number;
  headers: string[];
  renderedRows: number;
  cellsPerRow: number[];
  nativeTitle: boolean;
  visible: boolean;
};
export function reuiGridRendered(f: ReuiGridPresentation): boolean {
  return f.renderer === 'reui' && f.failures === 0 && f.grids === 1 && f.visible && f.nativeTitle &&
    f.expectedRows > 0 && f.declaredRows === f.expectedRows + 1 && f.renderedRows > 0 && f.renderedRows <= f.expectedRows &&
    JSON.stringify(f.headers) === JSON.stringify(['待办', '状态', '到期日', '项目', '领域', '详情']) &&
    f.cellsPerRow.length === f.renderedRows && f.cellsPerRow.every(count => count === 6);
}
export const taskGridRoot = (page: Page) => page.locator('[data-task-grid="reui"]');
export const taskGridInput = (page: Page) => taskGridRoot(page).getByRole('textbox', { name: '编辑待办', exact: true });
export const taskGridTitleCell = (page: Page, title: string) => taskGridRoot(page).getByRole('gridcell', { name: title, exact: true });
export const taskGridViewport = (page: Page) => taskGridRoot(page).locator('[data-slot="data-grid-table-viewport"]');

/** Native virtual rows only: neither the old canvas nor any text fallback can satisfy this oracle. */
export async function requireTaskGrid(page: Page, title: string, expectedRows = 1): Promise<void> {
  await expect.poll(async () => reuiGridRendered(await page.evaluate(({ title, expectedRows }) => {
    const root = document.querySelector('[data-task-grid="reui"]');
    const grids = root?.querySelectorAll('table[data-slot="data-grid-table"][role="grid"]');
    const grid = grids?.[0];
    const viewport = root?.querySelector('[data-slot="data-grid-table-viewport"]');
    const rows = Array.from(grid?.querySelectorAll('[data-slot="data-grid-table-body"] tr[data-row-id]') ?? []);
    const hasBox = (node: Element | null | undefined) => {
      if (!node) return false;
      const box = node.getBoundingClientRect(), css = getComputedStyle(node);
      return box.width > 0 && box.height > 0 && css.visibility !== 'hidden' && css.display !== 'none';
    };
    return {
      renderer: root?.getAttribute('data-task-grid') ?? null,
      failures: root?.querySelectorAll('[role="alert"]').length ?? 1,
      grids: grids?.length ?? 0,
      expectedRows,
      declaredRows: Number(grid?.getAttribute('aria-rowcount') ?? 0),
      headers: Array.from(grid?.querySelectorAll('thead th') ?? []).map(node => node.textContent?.trim() ?? ''),
      renderedRows: rows.length,
      cellsPerRow: rows.map(row => row.querySelectorAll('td[aria-colindex]').length),
      nativeTitle: rows.some(row => row.querySelector('td[aria-colindex="1"]')?.textContent?.trim() === title),
      visible: hasBox(root) && hasBox(grid) && hasBox(viewport) && rows.every(hasBox),
    };
  }, { title, expectedRows })), { timeout: 5000, message: 'Selected ReUI grid must render the native six-column synthetic row model' }).toBe(true);
}
