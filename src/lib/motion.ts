/** Svelte transitions shared by popovers, menus and dialogs. */

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Exponential ease-out: fast start, long gentle settle. */
const expoOut = (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

/** Scales and fades in from slightly smaller, like a macOS popover. */
export function pop(_node: Element, { duration = 220, scale = 0.96, y = -4 } = {}) {
  return {
    duration: reduced() ? 0 : duration,
    easing: expoOut,
    css: (t: number, u: number) =>
      `opacity: ${Math.min(1, t * 1.6)}; transform: translateY(${u * y}px) scale(${1 - u * (1 - scale)});`,
  };
}

/** Quick fade for exits; leaving should never feel slower than arriving. */
export function fadeOut(_node: Element, { duration = 120 } = {}) {
  return {
    duration: reduced() ? 0 : duration,
    css: (t: number) => `opacity: ${t};`,
  };
}

/** For modal sheets: a little more scale, and the backdrop fades with it. */
export function sheet(_node: Element, { duration = 300 } = {}) {
  return pop(_node, { duration, scale: 0.94, y: 8 });
}

const cubicOut = (t: number) => 1 - (1 - t) ** 3;

/**
 * Closing a sheet or dialog: it sinks a little and shrinks as it fades,
 * gently at first and then away (cubic-out on a reversed clock).
 */
export function sheetOut(_node: Element, { duration = 180 } = {}) {
  return {
    duration: reduced() ? 0 : duration,
    easing: cubicOut,
    css: (t: number, u: number) => `opacity: ${t}; transform: translateY(${u * 6}px) scale(${1 - u * 0.04});`,
  };
}

/**
 * The sidebar sliding in: the slot takes its resting width on the first
 * frame, so the page beside it is resized exactly once instead of on every
 * frame of the slide. Interpolating that width recalculates the style of
 * every cell in a full table each frame, which is what made the motion
 * stutter; the panel itself slides in on the compositor instead.
 */
export function sidebarSlide(node: HTMLElement, { duration = 280 } = {}) {
  const width = node.offsetWidth;
  return {
    duration: reduced() ? 0 : duration,
    easing: cubicOut,
    css: (t: number, u: number) =>
      `position: relative; overflow: hidden; width: ${width}px;` +
      ` background: var(--bg-sidebar); box-shadow: inset -1px 0 0 var(--separator);` +
      ` --slide: ${(-u * width).toFixed(2)}px; --slide-fade: ${(0.55 + 0.45 * t).toFixed(3)};`,
  };
}

/**
 * The sidebar sliding out: the slot leaves the row on the first frame, so
 * the page is already at its resting width while the panel slides away over
 * it. Clipping stays off the slot so the page is revealed from the right as
 * the panel moves left, instead of leaving an empty strip.
 */
export function sidebarSlideOut(node: HTMLElement, { duration = 220 } = {}) {
  const width = node.offsetWidth;
  return {
    duration: reduced() ? 0 : duration,
    easing: cubicOut,
    css: (t: number, u: number) =>
      `position: fixed; z-index: 3; left: 0; top: 0; height: 100%; width: ${width}px;` +
      ` --slide: ${(-u * width).toFixed(2)}px; --slide-fade: ${t.toFixed(3)};`,
  };
}

export function fade(_node: Element, { duration = 200 } = {}) {
  return {
    duration: reduced() ? 0 : duration,
    css: (t: number) => `opacity: ${t};`,
  };
}
