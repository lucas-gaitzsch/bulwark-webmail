import { describe, it, expect, beforeEach } from 'vitest';

import { computeFitScale, fitEmailBodyWidth, FIT_MIN_SCALE } from '@/lib/email-fit-width';

/** jsdom does no layout, so the widths the fit reads are stubbed by hand. */
function stubWidths(opts: { viewport: number; content: number | (() => number) }) {
  Object.defineProperty(document.documentElement, 'clientWidth', {
    configurable: true,
    get: () => opts.viewport,
  });
  const content = typeof opts.content === 'function' ? opts.content : () => opts.content as number;
  // Only body carries the width: the helper reads both and takes the max, and a
  // shared getter would advance a scripted sequence twice per measurement.
  Object.defineProperty(document.body, 'scrollWidth', { configurable: true, get: content });
  Object.defineProperty(document.documentElement, 'scrollWidth', { configurable: true, get: () => 0 });
}

describe('computeFitScale', () => {
  it('shrinks desktop-width mail to a phone screen', () => {
    expect(computeFitScale(780, 390)).toBeCloseTo(0.5);
  });

  it('leaves content that already fits alone', () => {
    expect(computeFitScale(390, 390)).toBe(1);
    // Sub-pixel rounding routinely reports a scrollWidth a hair over the client
    // width on content that visually fits.
    expect(computeFitScale(390.5, 390)).toBe(1);
  });

  it('leaves a desktop reading pane at 1:1', () => {
    expect(computeFitScale(900, 720)).toBe(1);
  });

  it('keeps the horizontal scroll for content too wide to stay legible', () => {
    // 390 / 2000 is far below the floor: scaled, this is unreadable, so panning
    // at full size is the better of the two bad options.
    expect(computeFitScale(2000, 390)).toBe(1);
    expect(computeFitScale(390 / FIT_MIN_SCALE - 10, 390)).toBeGreaterThan(FIT_MIN_SCALE);
  });

  it('ignores nonsense measurements', () => {
    expect(computeFitScale(0, 390)).toBe(1);
    expect(computeFitScale(780, 0)).toBe(1);
  });
});

describe('fitEmailBodyWidth', () => {
  beforeEach(() => {
    document.body.removeAttribute('style');
    document.body.removeAttribute('dir');
  });

  it('lays the body out at its content width and scales it down', () => {
    stubWidths({ viewport: 390, content: 780 });
    const scale = fitEmailBodyWidth(document);

    expect(scale).toBeCloseTo(0.5);
    expect(document.body.style.width).toBe('780px');
    expect(document.body.style.boxSizing).toBe('border-box');
    expect(document.body.style.transform).toBe('scale(0.5)');
    expect(document.body.style.transformOrigin).toBe('top left');
  });

  it('anchors the shrink at the right edge in an RTL body', () => {
    stubWidths({ viewport: 390, content: 780 });
    document.body.style.direction = 'rtl';
    fitEmailBodyWidth(document);

    expect(document.body.style.transformOrigin).toBe('top right');
  });

  it('touches nothing when the mail already fits', () => {
    stubWidths({ viewport: 390, content: 380 });

    expect(fitEmailBodyWidth(document)).toBe(1);
    expect(document.body.getAttribute('style')).toBeFalsy();
  });

  it('undoes a previous fit when the mail reflows to fit', () => {
    stubWidths({ viewport: 390, content: 780 });
    fitEmailBodyWidth(document);
    expect(document.body.style.transform).toBe('scale(0.5)');

    // e.g. a blocked image was loaded and the layout collapsed to one column.
    stubWidths({ viewport: 390, content: 300 });

    expect(fitEmailBodyWidth(document)).toBe(1);
    expect(document.body.style.transform).toBe('');
    expect(document.body.style.width).toBe('');
    expect(document.body.style.boxSizing).toBe('');
  });

  it('undoes a previous fit when disabled', () => {
    stubWidths({ viewport: 390, content: 780 });
    fitEmailBodyWidth(document);

    expect(fitEmailBodyWidth(document, { enabled: false })).toBe(1);
    expect(document.body.style.transform).toBe('');
    expect(document.body.style.width).toBe('');
  });

  it('re-measures when widening the body reveals more width', () => {
    // Percentage-width children can grow with the body they were just given.
    const widths = [700, 900, 900];
    let call = 0;
    stubWidths({ viewport: 390, content: () => widths[Math.min(call++, widths.length - 1)] });

    const scale = fitEmailBodyWidth(document);

    expect(document.body.style.width).toBe('900px');
    expect(scale).toBeCloseTo(390 / 900);
  });

  it('backs out of a fit that settles past the shrink floor', () => {
    const widths = [700, 3000, 3000];
    let call = 0;
    stubWidths({ viewport: 390, content: () => widths[Math.min(call++, widths.length - 1)] });

    expect(fitEmailBodyWidth(document)).toBe(1);
    expect(document.body.style.width).toBe('');
    expect(document.body.style.transform).toBe('');
  });
});
