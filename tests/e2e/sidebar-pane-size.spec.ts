// The sidebar's slide must resize the page exactly once, on its first frame,
// instead of interpolating the page's width: that width change recalculates
// the style of every cell in a full table, so doing it per frame is what made
// the motion stutter. The panel still slides, the endpoints still land, and
// rapid toggles, viewport changes and reduced motion still behave.
import { test, expect, open } from './fixtures';

const pane = () => {
  const sc = document.querySelector('.scroller') as HTMLElement;
  return {
    width: sc.clientWidth,
    paneW: getComputedStyle(sc).getPropertyValue('--pane-w').trim(),
    below: [820, 720, 640, 560].map((n) => sc.hasAttribute(`data-below-${n}`)),
  };
};

/** Watches style writes on the pane, with the time each one happened. */
const watch = () => {
  const sc = document.querySelector('.scroller') as HTMLElement;
  const w = window as any;
  w.__writes = [] as number[];
  w.__t0 = performance.now();
  w.__watch?.disconnect();
  w.__watch = new MutationObserver(() => w.__writes.push(performance.now() - w.__t0));
  w.__watch.observe(sc, { attributes: true, attributeFilter: ['style'] });
  return true;
};

const writes = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as any).__writes as number[]);

const layout = () => {
  const slot = document.querySelector('.sidebar-slot') as HTMLElement | null;
  const main = document.querySelector('main.main') as HTMLElement;
  const sc = document.querySelector('.scroller') as HTMLElement;
  return {
    slot: slot ? +slot.getBoundingClientRect().width.toFixed(1) : 0,
    slotPosition: slot ? getComputedStyle(slot).position : null,
    mainX: +main.getBoundingClientRect().x.toFixed(1),
    pane: sc.clientWidth,
  };
};

test('a slide sizes the page once, on its first frame', async ({ page }) => {
  await open(page);
  await page.evaluate(watch);
  await page.keyboard.press('Control+Backslash'); // close

  await test.step('closing writes the resting size right away', async () => {
    await page.waitForTimeout(150);
    const all = await writes(page);
    expect(all.length).toBeGreaterThan(0);
    expect(all.length).toBeLessThanOrEqual(2);
    const p = await page.evaluate(pane);
    expect(p.paneW).toBe(`${p.width}px`);
    expect(p.below).toEqual([820, 720, 640, 560].map((n) => p.width < n));
  });

  await test.step('nothing is written while the panel slides out', async () => {
    const early = (await writes(page)).length;
    await page.waitForTimeout(300);
    expect((await writes(page)).length).toBe(early);
    await expect(page.locator('.sidebar-slot')).toHaveCount(0);
  });

  await test.step('opening writes it once too, and lands', async () => {
    await page.evaluate(watch);
    await page.keyboard.press('Control+Backslash');
    await page.waitForTimeout(150);
    const all = await writes(page);
    expect(all.length).toBeGreaterThan(0);
    expect(all.length).toBeLessThanOrEqual(2);
    const p = await page.evaluate(pane);
    expect(p.paneW).toBe(`${p.width}px`);
    const early = all.length;
    await page.waitForTimeout(300);
    expect((await writes(page)).length).toBe(early);
  });
});

test('the page and slot keep the resting width for the whole slide', async ({ page }) => {
  await open(page);
  const openWidth = (await page.evaluate(layout)).slot;
  await page.keyboard.press('Control+Backslash'); // close
  await page.waitForTimeout(400);

  const closed = await page.evaluate(layout);
  expect(closed.mainX).toBe(0);

  await page.keyboard.press('Control+Backslash'); // open
  const frames = [];
  for (let i = 0; i < 3; i++) {
    frames.push(await page.evaluate(layout));
    await page.waitForTimeout(60);
  }
  for (const f of frames) {
    expect(f.slot).toBe(openWidth);
    expect(f.mainX).toBe(openWidth);
    expect(f.pane).toBe(frames[0].pane);
  }

  await page.waitForTimeout(400);
  const settled = await page.evaluate(layout);
  expect(settled.slot).toBe(openWidth);
  expect(settled.mainX).toBe(openWidth);
});

test('closing takes the slot out of the row on the first frame', async ({ page }) => {
  await open(page);
  const openWidth = (await page.evaluate(layout)).slot;
  await page.keyboard.press('Control+Backslash');
  await expect
    .poll(() => page.evaluate(() => document.querySelector('main.main')!.getBoundingClientRect().x))
    .toBe(0);
  const f = await page.evaluate(layout);
  expect(f.slotPosition).toBe('fixed');
  expect(f.pane).toBeGreaterThan(openWidth);
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.waitForTimeout(400);
  await expect(page.locator('.sidebar-slot')).toHaveCount(0);
  expect((await page.evaluate(layout)).slot).toBe(0);
  expect(openWidth).toBeGreaterThan(200);
});

test('rapid toggles settle on a correct pane', async ({ page }) => {
  await open(page);
  // Open, closed, open, closed: three toggles leave the sidebar hidden.
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+Backslash');
  await page.waitForTimeout(900);
  let p = await page.evaluate(pane);
  expect(p.paneW).toBe(`${p.width}px`);
  await expect(page.locator('.sidebar-slot')).toHaveCount(0);

  await page.keyboard.press('Control+Backslash');
  await expect(page.locator('.sidebar-slot')).toHaveCount(1);
  await page.waitForTimeout(700);
  p = await page.evaluate(pane);
  expect(p.paneW).toBe(`${p.width}px`);
  await expect(page.locator('.sidebar')).toBeVisible();
  const f = await page.evaluate(layout);
  expect(f.slotPosition).toBe('static');
  expect(f.mainX).toBe(f.slot);
});

test('a real viewport change still applies at once', async ({ page }) => {
  await open(page);
  await page.setViewportSize({ width: 1100, height: 820 });
  await page.waitForTimeout(150);
  const p = await page.evaluate(pane);
  expect(p.paneW).toBe(`${p.width}px`);
  expect(p.below).toEqual([820, 720, 640, 560].map((n) => p.width < n));
});

test.describe('with reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('the sidebar changes at once and the pane is right', async ({ page }) => {
    await open(page);
    await page.keyboard.press('Control+Backslash');
    await expect(page.locator('.sidebar-slot')).toHaveCount(0);
    await page.waitForTimeout(200);
    let p = await page.evaluate(pane);
    expect(p.paneW).toBe(`${p.width}px`);
    await page.keyboard.press('Control+Backslash');
    await expect(page.locator('.sidebar-slot')).toHaveCount(1);
    await page.waitForTimeout(200);
    p = await page.evaluate(pane);
    expect(p.paneW).toBe(`${p.width}px`);
    const f = await page.evaluate(layout);
    expect(f.slotPosition).toBe('static');
    expect(f.mainX).toBe(f.slot);
  });
});
