/**
 * Scale-to-fit for email bodies rendered inside the sandboxed viewer iframes.
 *
 * A lot of mail is authored at a fixed desktop width (the 600-800px table is
 * the newsletter default). On a phone that content is wider than the iframe,
 * so the reader has to swipe sideways through every message - or, where the
 * iframe clips instead of scrolling, never sees the right-hand half at all.
 *
 * Native mail clients solve this by shrinking the whole body to the screen
 * width, which is what these helpers do: lay the body out at its intrinsic
 * width and then `transform: scale()` it down. Layout is preserved exactly
 * (unlike forcing everything to `width: 100%`, which crushes wide data tables
 * into one-character columns - issue #409), and the reader can still pinch-zoom
 * to read the fine print.
 *
 * Only narrow viewports are scaled. On a desktop reading pane a wide table
 * still scrolls horizontally inside the body, which is the better trade-off
 * there: the content is legible at 1:1 and there is a mouse to scroll with.
 */

/** Widest iframe that still counts as "a phone" for scale-to-fit purposes. */
export const FIT_VIEWPORT_MAX = 640;

/**
 * Never shrink past this. An email that would need more (a 2000px data table
 * on a 390px screen) is unreadable when scaled, so it keeps the horizontal
 * scroll instead and the reader pans through it at a legible size.
 */
export const FIT_MIN_SCALE = 0.4;

export interface FitOptions {
  /**
   * Set false on a desktop layout: a wide mail there is legible at 1:1 and the
   * reading pane can scroll. Any fit already applied is undone.
   */
  enabled?: boolean;
  /** Iframes at least this wide are left at 1:1. */
  viewportMax?: number;
  /** Lower bound on the scale factor. */
  minScale?: number;
}

/**
 * The factor a body of `contentWidth` must be scaled by to fit `viewportWidth`,
 * or 1 when it should be left alone (already fits, not a narrow viewport, or
 * would have to shrink past `minScale`).
 */
export function computeFitScale(
  contentWidth: number,
  viewportWidth: number,
  { viewportMax = FIT_VIEWPORT_MAX, minScale = FIT_MIN_SCALE }: FitOptions = {},
): number {
  if (!(contentWidth > 0) || !(viewportWidth > 0)) return 1;
  if (viewportWidth > viewportMax) return 1;
  // 1px of slack: sub-pixel layout rounding routinely reports a scrollWidth a
  // hair over clientWidth on content that visually fits.
  if (contentWidth <= viewportWidth + 1) return 1;
  const scale = viewportWidth / contentWidth;
  return scale < minScale ? 1 : scale;
}

/** Undo a fit, leaving the body laid out at the iframe's own width. */
function clearFit(body: HTMLElement): void {
  body.style.transform = '';
  body.style.width = '';
  body.style.boxSizing = '';
}

/** Widest thing in the document. */
function measureContentWidth(doc: Document): number {
  return Math.max(doc.body.scrollWidth, doc.documentElement.scrollWidth);
}

/**
 * Fit the document body into its iframe, returning the scale that was applied
 * (1 = untouched). Idempotent: every call re-measures from the unscaled layout,
 * so it can be re-run as images load and the content reflows.
 *
 * The caller owns the iframe height - multiply the measured (unscaled) content
 * height by the returned scale, since a transform does not change layout size.
 */
export function fitEmailBodyWidth(doc: Document, options: FitOptions = {}): number {
  const body = doc.body;
  if (!body) return 1;

  // Measure the intrinsic layout, not the one a previous call left behind.
  clearFit(body);
  if (options.enabled === false) return 1;

  const viewport = doc.documentElement.clientWidth;
  let content = measureContentWidth(doc);
  let scale = computeFitScale(content, viewport, options);
  if (scale === 1) return 1;

  // border-box, so the width we set (measured as a scrollWidth, which already
  // covers the body's own padding) doesn't add that padding a second time on
  // every pass and creep wider - which scales the mail down further than it
  // needs to be and leaves a gap down the side.
  body.style.boxSizing = 'border-box';

  // Widening the body to its content width can reveal more width: percentage-
  // sized children re-lay out against the new containing block, and a table
  // with `width: 100%` next to a fixed-width sibling grows with it. Settle over
  // a couple of passes rather than scaling against a stale measurement.
  for (let pass = 0; pass < 3; pass++) {
    body.style.width = `${content}px`;
    const grown = measureContentWidth(doc);
    if (grown <= content + 1) break;
    content = grown;
    scale = computeFitScale(content, viewport, options);
    if (scale === 1) {
      // Grew past the shrink floor - back out and leave it scrolling.
      clearFit(body);
      return 1;
    }
  }

  // Anchor the shrink at the inline start so the content stays flush with the
  // edge the reader's eye starts from.
  const rtl = doc.defaultView?.getComputedStyle(body).direction === 'rtl';
  body.style.transformOrigin = rtl ? 'top right' : 'top left';
  body.style.transform = `scale(${scale})`;
  return scale;
}
