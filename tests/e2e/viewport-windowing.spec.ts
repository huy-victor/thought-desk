// Persistent viewport windowing: a full-page fixed-height table mounts only
// the visible band plus about one viewport of overscan, with exact-height
// spacers for the rest. These tests cover the bounded DOM, the full logical
// extent, jumps and anchors, editing/copy/calcs, and the legacy bypasses.
import type { Page } from '@playwright/test';
import { test, expect, open } from './fixtures';

const ROWS = 335;
const cell = (page: Page, r: number, c: number) => page.locator(`.td[data-r="${r}"][data-c="${c}"]`);
const body = (page: Page) => page.locator('.table .body');

async function seed(page: Page) {
  return page.evaluate(async (rows) => {
    const invoke = (window as any).__TAURI_INTERNALS__.invoke as (cmd: string, args?: unknown) => Promise<any>;
    const k = (i: number) => `a${i.toString(36).padStart(4, '0')}`;
    const properties: any[] = [{ id: 'title', name: 'Name', type: 'title', config: {}, sortKey: k(0) }];
    properties.push({ id: 'band', name: 'Band', type: 'text', config: {}, sortKey: k(1) });
    for (let i = 0; i < 8; i++) properties.push({ id: `p0${i}`, name: `Text ${i + 1}`, type: 'text', config: {}, sortKey: k(i + 2) });
    properties.push({ id: 'num', name: 'Number', type: 'number', config: {}, sortKey: k(20) });
    const made = await invoke('create_database', {
      parentId: null,
      title: 'Window probe',
      icon: '',
      input: {
        properties,
        views: [
          { id: 'table', name: 'Table', type: 'table', config: { calc: { num: 'sum' } }, sortKey: 'a0' },
          { id: 'wrapped', name: 'Wrapped', type: 'table', config: { wrap: true }, sortKey: 'a1' },
          { id: 'grouped', name: 'Grouped', type: 'table', config: { group: 'band' }, sortKey: 'a2' },
          { id: 'sorted', name: 'Sorted', type: 'table', config: { sorts: [{ prop: 'title', dir: 'desc' }] }, sortKey: 'a3' },
          {
            id: 'filtered',
            name: 'Filtered',
            type: 'table',
            config: { filters: [{ id: 'f1', prop: 'num', op: 'gt', value: 100 }, { id: 'f2', prop: 'num', op: 'lte', value: 250 }], match: 'all' },
            sortKey: 'a4',
          },
        ],
        rows: Array.from({ length: rows }, (_, i) => {
          const n = String(i + 1).padStart(3, '0');
          const cells: Record<string, string | number> = { band: `G${String(i % 12).padStart(2, '0')}`, num: i + 1 };
          for (let c = 0; c < 8; c++) cells[`p0${c}`] = `R${n} C${String(c + 2).padStart(2, '0')}`;
          return { title: `Row ${n}`, sortKey: k(i), cells };
        }),
      },
    });
    const host = await invoke('create_page', { parentId: null, title: 'Window host', icon: '' });
    await invoke('update_page', {
      id: host.id,
      patch: { content: JSON.stringify({ type: 'doc', content: [{ type: 'databaseBlock', attrs: { id: made.page.id, view: 'table' } }] }) },
    });
    // A second small table for cross-window copy/paste.
    await invoke('create_database', {
      parentId: null,
      title: 'Window target',
      icon: '',
      input: {
        properties: [
          { id: 'title', name: 'Name', type: 'title', config: {}, sortKey: 'a0' },
          { id: 'v', name: 'Value', type: 'text', config: {}, sortKey: 'a1' },
        ],
        views: [{ id: 'table', name: 'Table', type: 'table', config: {}, sortKey: 'a0' }],
        rows: Array.from({ length: 70 }, (_, i) => ({ title: `Target ${String(i + 1).padStart(3, '0')}`, sortKey: `a${i.toString(36).padStart(4, '0')}`, cells: { v: `T${i}` } })),
      },
    });
    return made.page.id as string;
  }, ROWS);
}

async function openProbe(page: Page, view = 'Table') {
  await open(page);
  await seed(page);
  await page.reload();
  await page.locator('.sidebar').waitFor();
  await page.waitForTimeout(300);
  await page.locator('.sidebar .db-row .nav-main', { hasText: 'Window probe' }).first().click();
  await expect(page.locator('.table .grid')).toBeVisible();
  await page.click(`.tab:has-text("${view}")`);
  await page.waitForTimeout(300);
}

const geom = () => {
  const b = document.querySelector('.table .body') as HTMLElement;
  const rows = [...document.querySelectorAll('.table .grid > .tr')] as HTMLElement[];
  // The header is its own strip above the rows' scrollport.
  const top = b.getBoundingClientRect().top;
  let first: { r: number; top: number; text: string; cellH: number } | null = null;
  for (const row of rows) {
    const box = row.getBoundingClientRect();
    if (box.bottom > top + 0.5) {
      const c = row.querySelector<HTMLElement>('.td[data-r]');
      first = { r: Number(c?.dataset.r ?? -1), top: +(box.top - top).toFixed(2), text: (c?.textContent ?? '').trim().slice(0, 24), cellH: +(c?.getBoundingClientRect().height ?? 0).toFixed(1) };
      break;
    }
  }
  const gridHeight = document.querySelector('.table .grid')?.getBoundingClientRect().height ?? 0;
  return {
    scrollHeight: b.scrollHeight,
    scrollTop: +b.scrollTop.toFixed(2),
    scrollLeft: b.scrollLeft,
    mounted: rows.length,
    spaces: document.querySelectorAll('.table .win-space').length,
    rowcount: document.querySelector('.table .grid')?.getAttribute('aria-rowcount'),
    first,
    gridHeight: +gridHeight.toFixed(1),
  };
};

async function jump(page: Page, y: number | 'mid' | 'bottom') {
  await body(page).evaluate((el, v) => {
    const b = el as HTMLElement;
    b.scrollTop = v === 'mid' ? Math.round((b.scrollHeight - b.clientHeight) / 2) : v === 'bottom' ? b.scrollHeight : (v as number);
  }, y);
  await page.waitForTimeout(250);
}

test('cold open is bounded but already covers all 335 logical rows', async ({ page }) => {
  await openProbe(page);
  const g = await page.evaluate(geom);
  expect(g.rowcount).toBe(String(ROWS));
  expect(g.mounted).toBeGreaterThan(20);
  expect(g.mounted).toBeLessThan(120);
  expect(g.spaces).toBeGreaterThan(0);
  expect(g.first?.r).toBe(0);
  // The bounded mounted band is laid out and painted, not skipped.
  expect(await page.locator('.tr').first().evaluate((el) => getComputedStyle(el).contentVisibility)).toBe('visible');

  const extent = await page.evaluate(() => {
    const b = document.querySelector('.table .body') as HTMLElement;
    const row = document.querySelector('.table .grid > .tr') as HTMLElement;
    const h = row.getBoundingClientRect().height;
    const add = (document.querySelector('.add-row') as HTMLElement).getBoundingClientRect().height;
    const calc = (document.querySelector('.calc') as HTMLElement).getBoundingClientRect().height;
    const pad = parseFloat(getComputedStyle(b).paddingBottom) || 0;
    return { scrollHeight: b.scrollHeight, expected: 335 * h + add + calc + pad, h };
  });
  expect(Math.abs(extent.scrollHeight - extent.expected)).toBeLessThan(2);
});

test('the mounted band follows jumps and keeps exact anchors', async ({ page }) => {
  await openProbe(page);
  const atTop = await page.evaluate(geom);
  await jump(page, 'mid');
  const mid = await page.evaluate(geom);
  const midTop = await page.evaluate(() => (document.querySelector('.table .body') as HTMLElement).scrollTop);
  expect(mid.first?.r).toBeGreaterThan(60);
  expect(mid.mounted).toBeLessThan(120);
  expect(mid.first?.cellH).toBeGreaterThan(20);
  await jump(page, 'bottom');
  const bottom = await page.evaluate(geom);
  expect(bottom.first?.r).toBeLessThan(ROWS);
  expect(bottom.mounted).toBeLessThan(120);
  expect(bottom.first?.text).not.toBe('');
  // Back to the same pixel and the same visible row/offset.
  await jump(page, 0);
  await body(page).evaluate((el, y) => ((el as HTMLElement).scrollTop = y as number), midTop);
  await page.waitForTimeout(250);
  const again = await page.evaluate(geom);
  expect(again.first?.r).toBe(mid.first?.r);
  expect(Math.abs((again.first?.top ?? 0) - (mid.first?.top ?? 0))).toBeLessThanOrEqual(1);
  expect(again.scrollHeight).toBe(atTop.scrollHeight);
});

test('rapid large scrolls settle populated and bounded', async ({ page }) => {
  await openProbe(page);
  const marks = [0, 0.9, 0.2, 0.75, 0.05, 1, 0.45];
  for (const m of marks) {
    await body(page).evaluate((el, v) => {
      const b = el as HTMLElement;
      b.scrollTop = Math.round((b.scrollHeight - b.clientHeight) * (v as number));
    }, m);
  }
  await page.waitForTimeout(500);
  const g = await page.evaluate(geom);
  expect(g.mounted).toBeLessThan(120);
  expect(g.first?.cellH).toBeGreaterThan(20);
  expect(g.first?.text).not.toBe('');
  expect(g.first?.r).not.toBe(-1);
  expect(g.rowcount).toBe(String(ROWS));
});

test('keyboard reaches the last row and edits it with a bounded DOM', async ({ page }) => {
  await openProbe(page);
  await cell(page, 0, 0).click();
  await page.keyboard.press('Control+ArrowDown');
  await page.waitForTimeout(250);
  await expect(cell(page, ROWS - 1, 0)).toBeVisible();
  await expect(cell(page, ROWS - 1, 0)).toContainText('Row 335');
  expect(await page.locator('.tr').count()).toBeLessThan(120);
  await page.keyboard.press('Enter');
  const box = page.locator('textarea.cell-edit');
  await expect(box).toBeVisible();
  await box.fill('last row draft');
  await page.keyboard.press('Enter');
  await expect(cell(page, ROWS - 1, 0)).toContainText('last row draft');
});

test('a text draft survives the sidebar motion and commits on scroll-out', async ({ page }) => {
  await openProbe(page);
  const target = cell(page, 10, 2);
  await target.dblclick();
  const box = page.locator('textarea.cell-edit');
  await box.fill('viewport draft');
  await page.keyboard.press('Control+Backslash');
  await page.waitForTimeout(500);
  await expect(box).toHaveValue('viewport draft');
  await page.keyboard.press('Enter');
  await expect(target).toContainText('viewport draft');
  if ((await page.locator('.sidebar').count()) === 0) {
    await page.keyboard.press('Control+Backslash');
    await page.waitForTimeout(400);
  }

  await jump(page, 'bottom');
  await expect(page.locator('textarea.cell-edit')).toHaveCount(0);
  await jump(page, 0);
  await expect(target).toContainText('viewport draft');
});

test('copy and calculations use all logical rows, not the mounted band', async ({ page }) => {
  await openProbe(page);
  await cell(page, 0, 0).click();
  await page.keyboard.press('Control+a');
  const tsv = await page.evaluate(() => {
    const grid = document.querySelector('.table .grid') as HTMLElement;
    const ev = new ClipboardEvent('copy', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true });
    grid.dispatchEvent(ev);
    return ev.clipboardData?.getData('text/plain') ?? '';
  });
  const lines = tsv.split('\n');
  expect(lines.length).toBeGreaterThanOrEqual(ROWS);
  expect(lines[0]).toContain('Row 001');
  expect(lines[ROWS - 1]).toContain('Row 335');
  const calc = await page.locator('.calc-cell').nth(10).textContent();
  expect((calc ?? '').replace(/[^0-9]/g, '')).toContain('56280');
});

test('sort works over the whole list', async ({ page }) => {
  await openProbe(page, 'Sorted');
  await expect(cell(page, 0, 0)).toContainText('Row 335');
  await expect(page.locator('.table .grid')).toHaveAttribute('aria-rowcount', String(ROWS));
  await jump(page, 'bottom');
  await expect(cell(page, ROWS - 1, 0)).toContainText('Row 001');
});

test('filter works over the whole list', async ({ page }) => {
  await openProbe(page, 'Filtered');
  await expect(cell(page, 0, 0)).toContainText('Row 101');
  await expect(page.locator('.table .grid')).toHaveAttribute('aria-rowcount', '150');
  await jump(page, 'bottom');
  await expect(cell(page, 149, 0)).toContainText('Row 250');
});

test('wrap, grouped and embedded tables keep the legacy path without stale spacers', async ({ page }) => {
  await openProbe(page, 'Wrapped');
  expect(await page.locator('.table .win-space').count()).toBe(0);
  expect(await page.locator('.table .tr').count()).toBeGreaterThan(20);
  await page.click('.tab:has-text("Table")');
  await page.waitForTimeout(300);
  expect(await page.locator('.table .win-space').count()).toBeGreaterThan(0);
  await page.click('.tab:has-text("Grouped")');
  await page.waitForTimeout(300);
  expect(await page.locator('.table .win-space').count()).toBe(0);
  expect(await page.locator('.table .group-row').count()).toBeGreaterThan(0);

  await open(page);
  await page.locator('[role=tree][aria-label=Pages] .row', { hasText: 'Window host' }).first().click();
  await expect(page.locator('.database-block .table')).toBeVisible();
  expect(await page.locator('.database-block .win-space').count()).toBe(0);
});

test('the mounted window and the horizontal position survive a sidebar motion', async ({ page }) => {
  await openProbe(page);
  await body(page).evaluate((el) => ((el as HTMLElement).scrollLeft = 900));
  await page.waitForTimeout(200);
  const align = async () => {
    return page.evaluate(() => {
      const b = document.querySelector('.table .body') as HTMLElement;
      const th = document.querySelectorAll('.head .th[data-prop]')[4] as HTMLElement;
      const td = document.querySelector('.td[data-r="5"][data-c="4"]') as HTMLElement;
      return { left: b.scrollLeft, th: +th.getBoundingClientRect().left.toFixed(1), td: +td.getBoundingClientRect().left.toFixed(1), mounted: document.querySelectorAll('.table .tr').length };
    });
  };
  const before = await align();
  await page.keyboard.press('Control+Backslash');
  await page.waitForTimeout(400);
  const closed = await align();
  expect(closed.left).toBe(before.left);
  expect(Math.abs(closed.th - closed.td)).toBeLessThan(1);
  expect(closed.mounted).toBeLessThan(120);
  await page.keyboard.press('Control+Backslash');
  await page.waitForTimeout(500);
  const reopened = await align();
  expect(reopened.left).toBe(before.left);
  expect(Math.abs(reopened.th - reopened.td)).toBeLessThan(1);
  expect(reopened.mounted).toBeLessThan(120);
});

async function injectTallRow(page: Page, r: number, px: number) {
  await page.evaluate(
    ({ r, px }) => {
      const old = document.getElementById('tall-row');
      old?.remove();
      const s = document.createElement('style');
      s.id = 'tall-row';
      s.textContent = `.table .tr:has(.td[data-r="${r}"]) { min-height: ${px}px !important; }`;
      document.head.append(s);
    },
    { r, px },
  );
}

async function removeTallRow(page: Page) {
  await page.evaluate(() => document.getElementById('tall-row')?.remove());
}

test('a taller off-band row falls back to all rows and keeps the place', async ({ page }) => {
  await openProbe(page);
  await jump(page, 'mid');
  const mid = await page.evaluate(geom);
  await injectTallRow(page, 10, 68);
  await page.waitForTimeout(400);
  // Row 10 is far above the mid window, so the window is still valid here.
  let g = await page.evaluate(geom);
  expect(g.spaces).toBeGreaterThan(0);
  expect(g.mounted).toBeLessThan(120);

  await jump(page, 0);
  await page.waitForTimeout(600);
  g = await page.evaluate(geom);
  expect(g.spaces).toBe(0);
  expect(g.mounted).toBe(ROWS);
  expect(g.rowcount).toBe(String(ROWS));
  const extent = await page.evaluate(() => (document.querySelector('.table .body') as HTMLElement).scrollHeight);
  expect(extent).toBeGreaterThan(mid.scrollHeight);
  // The whole list stays reachable and populated after the switch.
  await jump(page, 'mid');
  await expect(cell(page, 162, 0)).toBeVisible();
  await jump(page, 'bottom');
  await expect(cell(page, ROWS - 1, 0)).toBeVisible();

  // A different view is a fresh chance; returning resumes windowing.
  await removeTallRow(page);
  await page.click('.tab:has-text("Wrapped")');
  await page.waitForTimeout(300);
  await page.click('.tab:has-text("Table")');
  await page.waitForTimeout(600);
  const back = await page.evaluate(geom);
  expect(back.spaces).toBe(1);
  expect(back.mounted).toBeLessThan(120);
});

test('a row that becomes taller while mounted falls back', async ({ page }) => {
  await openProbe(page);
  await jump(page, 'bottom');
  const g0 = await page.evaluate(geom);
  const lastRow = g0.first?.r ?? ROWS - 1;
  await injectTallRow(page, lastRow, 68);
  await page.waitForTimeout(600);
  const g = await page.evaluate(geom);
  expect(g.spaces).toBe(0);
  expect(g.mounted).toBe(ROWS);
  await expect(cell(page, ROWS - 1, 0)).toBeVisible();
  await removeTallRow(page);
});

test('copy in one window and paste into another table', async ({ page }) => {
  await openProbe(page);
  const source = await cell(page, 10, 2).textContent();
  await cell(page, 10, 2).click();
  await page.keyboard.press('Control+c');
  await page.locator('.sidebar .db-row .nav-main', { hasText: 'Window target' }).first().click();
  await expect(page.locator('.table .grid')).toBeVisible();
  await page.waitForTimeout(300);
  await cell(page, 0, 1).click();
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(300);
  await expect(cell(page, 0, 1)).toContainText((source ?? '').trim());
});

test('adding and deleting a row keeps the logical count and window', async ({ page }) => {
  await openProbe(page);
  await page.click('.add-row');
  await expect(page.locator('.table .grid')).toHaveAttribute('aria-rowcount', String(ROWS + 1));
  await expect(page.locator('textarea.cell-edit')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const first = page.locator('.table .tr').first();
  await first.hover();
  await first.locator('.pick').click({ force: true });
  await page.click('.bulk button:has-text("Delete")');
  const confirm = page.locator('.dialog button:has-text("Delete"), .confirm button:has-text("Delete")');
  if (await confirm.count()) await confirm.first().click();
  await page.waitForTimeout(400);
  await expect(page.locator('.table .grid')).toHaveAttribute('aria-rowcount', String(ROWS));
  expect(await page.locator('.table .tr').count()).toBeLessThan(120);
  await jump(page, 'bottom');
  await expect(cell(page, ROWS - 1, 0)).toBeVisible();
});

test('fallback keeps the mid anchor within a pixel', async ({ page }) => {
  await openProbe(page);
  await jump(page, 'mid');
  const mid = await page.evaluate(geom);
  expect(mid.first?.r).toBeGreaterThan(20);
  const target = (mid.first?.r ?? 0) - 12;
  await expect(page.locator(`.td[data-r="${target}"][data-c="0"]`)).toHaveCount(1);
  const offsetOf = (r: number) =>
    page.evaluate((row) => {
      const b = document.querySelector('.table .body') as HTMLElement;
      const tr = (document.querySelector(`.td[data-r="${row}"][data-c="0"]`) as HTMLElement).closest('.tr') as HTMLElement;
      return +(tr.getBoundingClientRect().top - b.getBoundingClientRect().top).toFixed(2);
    }, r);
  const before = await offsetOf(mid.first!.r);
  await injectTallRow(page, target, 68);
  await page.waitForTimeout(700);
  const after = await page.evaluate(geom);
  expect(after.spaces).toBe(0);
  expect(after.mounted).toBe(ROWS);
  // The row the reader was looking at stays at the same pixel, even though a
  // row above it is now taller and every row is mounted.
  expect(Math.abs((await offsetOf(mid.first!.r)) - before)).toBeLessThanOrEqual(1);
});
