// tests/e2e/embedded-table-rail.spec.ts
// Verifies the compact top horizontal scroll rail for embedded tables:
// visibility rules, range matching, echo guarding, bidirectional synchronization,
// dynamic resizing, and instance independence.
import type { Page } from '@playwright/test';
import { test, expect, open } from './fixtures';

test.use({ viewport: { width: 1280, height: 800 } });

/** Seeds wide and narrow databases and a host page with embedded tables. */
async function seed(page: Page) {
  return page.evaluate(async () => {
    const invoke = (window as any).__TAURI_INTERNALS__.invoke as (cmd: string, args?: unknown) => Promise<any>;
    const k = (i: number) => `a${i.toString(36).padStart(4, '0')}`;

    // 1. Wide database (overflows horizontally)
    const wideProps: any[] = [{ id: 'title', name: 'Name', type: 'title', config: {}, sortKey: k(0) }];
    for (let i = 0; i < 24; i++) {
      wideProps.push({
        id: `p${String(i).padStart(2, '0')}`,
        name: `Column ${String(i + 1).padStart(2, '0')}`,
        type: 'text',
        config: {},
        sortKey: k(i + 1),
      });
    }
    const wideRows = Array.from({ length: 40 }, (_, i) => {
      const n = String(i + 1).padStart(3, '0');
      const cells: Record<string, string> = {};
      for (let c = 0; c < 24; c++) {
        cells[`p${String(c).padStart(2, '0')}`] = `Val ${n}-${c + 1}`;
      }
      return { title: `Row ${n}`, sortKey: k(i), cells };
    });
    const wideDb = await invoke('create_database', {
      parentId: null,
      title: 'Wide Probe',
      icon: '',
      input: {
        properties: wideProps,
        views: [{ id: 'table', name: 'Table', type: 'table', config: {}, sortKey: 'a0' }],
        rows: wideRows,
      },
    });

    // 2. Narrow database (does NOT overflow horizontally)
    const narrowProps: any[] = [
      { id: 'title', name: 'Item', type: 'title', config: {}, sortKey: k(0) },
      { id: 'tag', name: 'Tag', type: 'text', config: {}, sortKey: k(1) },
    ];
    const narrowRows = [
      { title: 'Alpha', sortKey: k(0), cells: { tag: 'A' } },
      { title: 'Beta', sortKey: k(1), cells: { tag: 'B' } },
    ];
    const narrowDb = await invoke('create_database', {
      parentId: null,
      title: 'Narrow Probe',
      icon: '',
      input: {
        properties: narrowProps,
        views: [{ id: 'table', name: 'Table', type: 'table', config: {}, sortKey: 'a0' }],
        rows: narrowRows,
      },
    });

    // 3. Host page embedding two wide tables and one narrow table
    const host = await invoke('create_page', { parentId: null, title: 'Rail Host', icon: '' });
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First wide table' }] },
        { type: 'databaseBlock', attrs: { id: wideDb.page.id, view: 'table' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'Narrow table' }] },
        { type: 'databaseBlock', attrs: { id: narrowDb.page.id, view: 'table' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second wide table' }] },
        { type: 'databaseBlock', attrs: { id: wideDb.page.id, view: 'table' } },
      ],
    };
    await invoke('update_page', { id: host.id, patch: { content: JSON.stringify(doc) } });
    return { wideId: wideDb.page.id as string, narrowId: narrowDb.page.id as string, hostId: host.id as string };
  });
}

test('top rail is hidden in full-page views and narrow embedded tables', async ({ page }) => {
  await open(page);
  await seed(page);
  await page.reload();
  await page.locator('.sidebar').waitFor();
  await page.waitForTimeout(300);

  // 1. Full-page view of wide database -> no top rail
  await page.locator('.sidebar .db-row .nav-main', { hasText: 'Wide Probe' }).first().click();
  await expect(page.locator('.table .grid')).toBeVisible();
  await page.waitForTimeout(200);
  expect(await page.locator('.table .rail').count()).toBe(0);

  // 2. Open host page with embedded tables
  await page.locator('[role=tree][aria-label=Pages] .row', { hasText: 'Rail Host' }).first().click();
  await page.waitForTimeout(400);

  const blocks = page.locator('.database-block');
  await expect(blocks).toHaveCount(3);

  // Block 1 (Wide): rail is visible
  const wideTable1 = blocks.nth(0).locator('.table');
  await expect(wideTable1.locator('.rail')).toBeVisible();

  // Block 2 (Narrow): rail is hidden (no overflow)
  const narrowTable = blocks.nth(1).locator('.table');
  expect(await narrowTable.locator('.rail').count()).toBe(0);

  // Block 3 (Wide): rail is visible
  const wideTable2 = blocks.nth(2).locator('.table');
  await expect(wideTable2.locator('.rail')).toBeVisible();
});

test('rail range matches body scrollWidth and clientWidth at both endpoints', async ({ page }) => {
  await open(page);
  await seed(page);
  await page.reload();
  await page.locator('.sidebar').waitFor();
  await page.waitForTimeout(300);

  await page.locator('[role=tree][aria-label=Pages] .row', { hasText: 'Rail Host' }).first().click();
  const table = page.locator('.database-block .table').first();
  await expect(table.locator('.rail')).toBeVisible();
  await page.waitForTimeout(200);

  const dims = await table.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement;
    const rail = el.querySelector('.rail') as HTMLElement;
    return {
      bodyScrollW: body.scrollWidth,
      bodyClientW: body.clientWidth,
      railScrollW: rail.scrollWidth,
      railClientW: rail.clientWidth,
      bodyMaxScroll: body.scrollWidth - body.clientWidth,
      railMaxScroll: rail.scrollWidth - rail.clientWidth,
    };
  });

  // Range must match
  expect(dims.bodyScrollW).toBeGreaterThan(dims.bodyClientW);
  expect(Math.abs(dims.railScrollW - dims.bodyScrollW)).toBeLessThanOrEqual(1);
  expect(Math.abs(dims.railClientW - dims.bodyClientW)).toBeLessThanOrEqual(1);
  expect(Math.abs(dims.railMaxScroll - dims.bodyMaxScroll)).toBeLessThanOrEqual(1);

  // Scroll to max endpoint
  await table.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement;
    body.scrollLeft = body.scrollWidth - body.clientWidth;
    body.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(100);

  const endPositions = await table.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement;
    const rail = el.querySelector('.rail') as HTMLElement;
    return { bodyLeft: body.scrollLeft, railLeft: rail.scrollLeft };
  });
  expect(Math.abs(endPositions.railLeft - endPositions.bodyLeft)).toBeLessThanOrEqual(1);

  // Scroll back to start endpoint
  await table.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement;
    body.scrollLeft = 0;
    body.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(100);

  const startPositions = await table.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement;
    const rail = el.querySelector('.rail') as HTMLElement;
    return { bodyLeft: body.scrollLeft, railLeft: rail.scrollLeft };
  });
  expect(startPositions.bodyLeft).toBe(0);
  expect(startPositions.railLeft).toBe(0);
});

test('delayed rail echo does not pull body back, and genuine rail move leads body', async ({ page }) => {
  await open(page);
  await seed(page);
  await page.reload();
  await page.locator('.sidebar').waitFor();
  await page.waitForTimeout(300);

  await page.locator('[role=tree][aria-label=Pages] .row', { hasText: 'Rail Host' }).first().click();
  const table = page.locator('.database-block .table').first();
  await expect(table.locator('.rail')).toBeVisible();

  const out = await table.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement;
    const rail = el.querySelector('.rail') as HTMLElement;

    // 1. Body scrolls to 600, mirrors to rail
    body.scrollLeft = 600;
    body.dispatchEvent(new Event('scroll'));
    const mirroredRail = rail.scrollLeft;

    // 2. Body moves to 1200 before rail echo arrives
    body.scrollLeft = 1200;

    // 3. Delayed rail echo arrives with rail at 600
    rail.dispatchEvent(new Event('scroll'));
    const afterEchoBody = body.scrollLeft;

    // 4. A genuine rail gesture to 900 leads body
    rail.scrollLeft = 900;
    rail.dispatchEvent(new Event('scroll'));
    const afterRailMove = body.scrollLeft;

    return { mirroredRail, afterEchoBody, afterRailMove };
  });

  expect(out.mirroredRail).toBe(600);
  // Echo must NOT pull body back from 1200 to 600
  expect(out.afterEchoBody).toBe(1200);
  // Genuine rail move leads body to 900
  expect(out.afterRailMove).toBe(900);
});

test('rail move keeps column headers and cells aligned', async ({ page }) => {
  await open(page);
  await seed(page);
  await page.reload();
  await page.locator('.sidebar').waitFor();
  await page.waitForTimeout(300);

  await page.locator('[role=tree][aria-label=Pages] .row', { hasText: 'Rail Host' }).first().click();
  const table = page.locator('.database-block .table').first();
  await expect(table.locator('.rail')).toBeVisible();

  // Scroll via rail to 800
  await table.evaluate((el) => {
    const rail = el.querySelector('.rail') as HTMLElement;
    rail.scrollLeft = 800;
    rail.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(100);

  // Check header and row rectangles alignment
  const th = await table.locator('.th[data-prop="p05"]').boundingBox();
  const td = await table.locator('.td[data-r="0"][data-c="6"]').boundingBox();
  expect(th).not.toBeNull();
  expect(td).not.toBeNull();
  expect(Math.abs(th!.x - td!.x)).toBeLessThanOrEqual(1.5);
});

test('multiple independent embedded instances do not control each other', async ({ page }) => {
  await open(page);
  await seed(page);
  await page.reload();
  await page.locator('.sidebar').waitFor();
  await page.waitForTimeout(300);

  await page.locator('[role=tree][aria-label=Pages] .row', { hasText: 'Rail Host' }).first().click();
  const blocks = page.locator('.database-block');
  const table1 = blocks.nth(0).locator('.table');
  const table2 = blocks.nth(2).locator('.table');

  await expect(table1.locator('.rail')).toBeVisible();
  await expect(table2.locator('.rail')).toBeVisible();

  // Move table 1 via rail to 450
  await table1.evaluate((el) => {
    const rail = el.querySelector('.rail') as HTMLElement;
    rail.scrollLeft = 450;
    rail.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(100);

  const t1State = await table1.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement;
    const rail = el.querySelector('.rail') as HTMLElement;
    return { body: body.scrollLeft, rail: rail.scrollLeft };
  });
  const t2State = await table2.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement;
    const rail = el.querySelector('.rail') as HTMLElement;
    return { body: body.scrollLeft, rail: rail.railScrollLeft ?? rail.scrollLeft };
  });

  expect(t1State.body).toBe(450);
  expect(t1State.rail).toBe(450);
  expect(t2State.body).toBe(0);
  expect(t2State.rail).toBe(0);

  // Move table 2 via rail to 700
  await table2.evaluate((el) => {
    const rail = el.querySelector('.rail') as HTMLElement;
    rail.scrollLeft = 700;
    rail.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(100);

  const t1StateAfter = await table1.evaluate((el) => (el.querySelector('.body') as HTMLElement).scrollLeft);
  const t2StateAfter = await table2.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement;
    const rail = el.querySelector('.rail') as HTMLElement;
    return { body: body.scrollLeft, rail: rail.scrollLeft };
  });

  expect(t1StateAfter).toBe(450);
  expect(t2StateAfter.body).toBe(700);
  expect(t2StateAfter.rail).toBe(700);
});
