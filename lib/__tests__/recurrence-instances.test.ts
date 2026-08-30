import { describe, it, expect } from 'vitest';
import type { CalendarEvent } from '@/lib/jmap/types';
import {
  SYNTHETIC_ID_PROBE,
  baseEventStoreId,
  buildFallbackExcludePatch,
  buildFallbackOverridePatch,
  buildOccurrencePatch,
  hydrateRecurrenceInstances,
  isServerRecurrenceInstance,
  isSyntheticIdMutationUnsupported,
  resolveOverrideKey,
} from '../recurrence-instances';

// Shapes below mirror what Stalwart 0.16.19 returned for
// CalendarEvent/query?expandRecurrences=true + CalendarEvent/get: the
// occurrence carries baseEventId/recurrenceId but no recurrence rule or
// overrides, all-day occurrences lose showWithoutTime and get the request
// time zone, and a moved override reports its new start as recurrenceId.

function instance(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'maaaaab',
    baseEventId: 'b',
    uid: 'series@example.com',
    title: 'Daily standup',
    start: '2026-09-08T10:00:00',
    duration: 'PT1H',
    timeZone: 'Europe/Berlin',
    utcStart: '2026-09-08T08:00:00Z',
    utcEnd: '2026-09-08T09:00:00Z',
    recurrenceId: '2026-09-08T10:00:00',
    recurrenceIdTimeZone: 'Europe/Berlin',
    recurrenceRules: null,
    recurrenceOverrides: null,
    excludedRecurrenceRules: null,
    showWithoutTime: false,
    calendarIds: { f: true },
    ...overrides,
  } as CalendarEvent;
}

const dailyRule = [{ '@type': 'RecurrenceRule', frequency: 'daily', count: 5 }] as unknown as CalendarEvent['recurrenceRules'];

describe('isServerRecurrenceInstance', () => {
  it('is true for a synthetic occurrence id that differs from its base', () => {
    expect(isServerRecurrenceInstance({ id: 'maaaaab', baseEventId: 'b' })).toBe(true);
  });

  it('is false for a base event, which reports itself as its own base', () => {
    expect(isServerRecurrenceInstance({ id: 'b', baseEventId: 'b' })).toBe(false);
  });

  it('compares the raw id when the store namespaced it', () => {
    expect(isServerRecurrenceInstance({ id: 'acct:maaaaab', originalId: 'maaaaab', baseEventId: 'b' })).toBe(true);
    expect(isServerRecurrenceInstance({ id: 'acct:b', originalId: 'b', baseEventId: 'b' })).toBe(false);
  });

  it('is false without a baseEventId (older servers, demo data, client-side occurrences)', () => {
    expect(isServerRecurrenceInstance({ id: 'b:2026-09-08T10:00:00', originalId: 'b' })).toBe(false);
    expect(isServerRecurrenceInstance({ id: 'x', baseEventId: null })).toBe(false);
    expect(isServerRecurrenceInstance(null)).toBe(false);
  });
});

describe('baseEventStoreId', () => {
  it('keeps the namespace prefix and swaps in the base id', () => {
    expect(baseEventStoreId({ id: 'acct:maaaaab', originalId: 'maaaaab', baseEventId: 'b' })).toBe('acct:b');
    expect(baseEventStoreId({ id: 'A@h::maaaaab', originalId: 'maaaaab', baseEventId: 'b' })).toBe('A@h::b');
    expect(baseEventStoreId({ id: 'maaaaab', originalId: 'maaaaab', baseEventId: 'b' })).toBe('b');
  });

  it('is null for anything that is not an expanded occurrence', () => {
    expect(baseEventStoreId({ id: 'b', baseEventId: 'b' })).toBeNull();
    expect(baseEventStoreId({ id: 'b:2026-09-08T10:00:00', originalId: 'b' })).toBeNull();
  });
});

describe('isSyntheticIdMutationUnsupported', () => {
  it('recognises the pre-0.16.20 rejections for update and destroy', () => {
    expect(isSyntheticIdMutationUnsupported(new Error('Updating synthetic ids is not yet supported.'))).toBe(true);
    expect(isSyntheticIdMutationUnsupported(new Error('Deleting synthetic ids is not yet supported.'))).toBe(true);
    expect(isSyntheticIdMutationUnsupported('Updating synthetic ids is not yet supported.')).toBe(true);
  });

  it('does not match other failures', () => {
    expect(isSyntheticIdMutationUnsupported(new Error('Failed to update calendar event'))).toBe(false);
    expect(isSyntheticIdMutationUnsupported(new Error('This property cannot be modified on a single occurrence.'))).toBe(false);
    expect(isSyntheticIdMutationUnsupported(undefined)).toBe(false);
    expect(isSyntheticIdMutationUnsupported({ message: 'synthetic ids not supported' })).toBe(false);
  });
});

describe('SYNTHETIC_ID_PROBE', () => {
  it('is Id::from_parts(1, u32::MAX) in Stalwart base32 (a-z then 792013)', () => {
    // 0x1_FFFF_FFFF in 7 groups of 5 bits: 00111 then six times 11111.
    const alphabet = 'abcdefghijklmnopqrstuvwxyz792013';
    const value = 2 ** 32 + 0xffffffff; // fits in a double exactly
    let encoded = '';
    for (let shift = 30; shift >= 0; shift -= 5) {
      encoded += alphabet[Math.floor(value / 2 ** shift) % 32];
    }
    expect(SYNTHETIC_ID_PROBE).toBe(encoded);
  });
});

describe('buildOccurrencePatch', () => {
  it('drops identity, whole-series and per-event keys, keeps the rest', () => {
    const patch = buildOccurrencePatch({
      id: 'maaaaab',
      uid: 'series@example.com',
      '@type': 'Event',
      baseEventId: 'b',
      calendarIds: { f: true },
      recurrenceRules: dailyRule,
      recurrenceOverrides: {},
      excludedRecurrenceRules: null,
      recurrenceId: '2026-09-08T10:00:00',
      recurrenceIdTimeZone: 'Europe/Berlin',
      isDraft: false,
      isOrigin: true,
      utcStart: '2026-09-08T08:00:00Z',
      utcEnd: '2026-09-08T09:00:00Z',
      useDefaultAlerts: true,
      mayInviteSelf: true,
      mayInviteOthers: false,
      hideAttendees: false,
      title: 'Renamed',
      start: '2026-09-08T11:00:00',
      duration: 'PT2H',
      timeZone: 'Europe/Berlin',
      showWithoutTime: false,
      locations: { loc1: { '@type': 'Location', name: 'Room B' } },
    } as unknown as Partial<CalendarEvent>);
    expect(patch).toEqual({
      title: 'Renamed',
      start: '2026-09-08T11:00:00',
      duration: 'PT2H',
      timeZone: 'Europe/Berlin',
      showWithoutTime: false,
      locations: { loc1: { '@type': 'Location', name: 'Room B' } },
    });
  });

  it('applies the same rule to JSON-pointer patches by their first segment', () => {
    const patch = buildOccurrencePatch({
      'locations/loc1/name': 'Room B',
      'participants/p1/participationStatus': 'accepted',
      'calendarIds/f': true,
      'recurrenceOverrides/2026-09-09T10:00:00': { excluded: true },
    } as unknown as Partial<CalendarEvent>);
    expect(patch).toEqual({
      'locations/loc1/name': 'Room B',
      'participants/p1/participationStatus': 'accepted',
    });
  });
});

describe('resolveOverrideKey', () => {
  it('uses recurrenceId when the base event has an override under it (or none at all)', () => {
    const occ = { start: '2026-09-08T10:00:00', recurrenceId: '2026-09-08T10:00:00' };
    expect(resolveOverrideKey(occ, null)).toBe('2026-09-08T10:00:00');
    expect(resolveOverrideKey(occ, { '2026-09-08T10:00:00': { title: 'x' } })).toBe('2026-09-08T10:00:00');
    expect(resolveOverrideKey(occ, { '2026-09-07T10:00:00': { title: 'x' } })).toBe('2026-09-08T10:00:00');
  });

  it('finds a moved override by its start when the server reported the new start as recurrenceId', () => {
    const moved = { start: '2026-09-09T14:00:00', recurrenceId: '2026-09-09T14:00:00' };
    const overrides = { '2026-09-09T10:00:00': { start: '2026-09-09T14:00:00', title: 'Moved' } };
    expect(resolveOverrideKey(moved, overrides)).toBe('2026-09-09T10:00:00');
  });

  it('is null without a recurrenceId', () => {
    expect(resolveOverrideKey({ start: '2026-09-08T09:00:00', recurrenceId: null }, null)).toBeNull();
  });
});

describe('hydrateRecurrenceInstances', () => {
  const base: Partial<CalendarEvent> = {
    id: 'b',
    duration: 'PT1H',
    timeZone: 'Europe/Berlin',
    recurrenceRules: dailyRule,
    excludedRecurrenceRules: null,
    recurrenceOverrides: {
      '2026-09-09T10:00:00': { start: '2026-09-09T14:00:00', title: 'Moved' },
      '2026-09-10T10:00:00': { start: '2026-09-10T10:00:00', duration: 'PT3H', title: 'Long one' },
    },
  };
  const bases = new Map<string, Partial<CalendarEvent>>([[ 'b', base ]]);

  it('copies the series context from the base event', () => {
    const [out] = hydrateRecurrenceInstances([instance()], bases);
    expect(out.recurrenceRules).toEqual(dailyRule);
    expect(out.recurrenceOverrides).toEqual(base.recurrenceOverrides);
    expect(out.excludedRecurrenceRules).toBeNull();
    // Own occurrence data is untouched.
    expect(out.id).toBe('maaaaab');
    expect(out.baseEventId).toBe('b');
    expect(out.start).toBe('2026-09-08T10:00:00');
    expect(out.recurrenceId).toBe('2026-09-08T10:00:00');
    expect(out.duration).toBe('PT1H');
  });

  it('restores showWithoutTime and the floating time zone of an all-day series', () => {
    const allDayBase = new Map([['c', { id: 'c', duration: 'P1D', timeZone: null, showWithoutTime: true, recurrenceRules: dailyRule }]]);
    const [out] = hydrateRecurrenceInstances([instance({
      id: 'maaaaac', baseEventId: 'c', start: '2026-09-08T00:00:00', duration: 'P1D',
      timeZone: 'Europe/Berlin', recurrenceId: '2026-09-08T00:00:00',
    })], allDayBase);
    expect(out.showWithoutTime).toBe(true);
    expect(out.timeZone).toBeNull();
  });

  it('repairs the recurrenceId of a moved override reported under its new start', () => {
    const [out] = hydrateRecurrenceInstances([instance({
      id: 'eaaaaab', start: '2026-09-09T14:00:00', recurrenceId: '2026-09-09T14:00:00', title: 'Moved',
      utcStart: '2026-09-09T12:00:00Z', utcEnd: '2026-09-09T21:59:59Z', duration: 'PT9H59M59S',
    })], bases);
    expect(out.recurrenceId).toBe('2026-09-09T10:00:00');
    // The override sets no duration: the occurrence inherits the base's.
    expect(out.duration).toBe('PT1H');
    expect(out.utcEnd).toBe('2026-09-09T13:00:00.000Z');
  });

  it('keeps a duration the override sets itself', () => {
    const [out] = hydrateRecurrenceInstances([instance({
      id: 'qaaaaab', start: '2026-09-10T10:00:00', recurrenceId: '2026-09-10T10:00:00', duration: 'PT3H',
      utcEnd: '2026-09-10T11:00:00Z',
    })], bases);
    expect(out.duration).toBe('PT3H');
    expect(out.utcEnd).toBe('2026-09-10T11:00:00Z');
  });

  it('leaves non-recurring occurrences and occurrences of unknown bases alone', () => {
    const single = instance({ id: 'eaaaaad', baseEventId: 'd', recurrenceId: null });
    const orphan = instance({ id: 'maaaaaz', baseEventId: 'z' });
    const base = instance({ id: 'b', baseEventId: 'b', recurrenceId: null });
    expect(hydrateRecurrenceInstances([single, orphan, base], bases)).toEqual([single, orphan, base]);
  });
});

describe('buildFallbackOverridePatch', () => {
  it('writes the whole override object, pinning start/duration and keeping existing override fields', () => {
    const occ = instance({
      start: '2026-09-09T14:00:00', recurrenceId: '2026-09-09T10:00:00', duration: 'PT1H',
      recurrenceOverrides: { '2026-09-09T10:00:00': { start: '2026-09-09T14:00:00', title: 'Moved', updated: '2026-08-01T00:00:00Z' } },
    });
    expect(buildFallbackOverridePatch(occ, { title: 'Moved, renamed', calendarIds: { g: true } } as Partial<CalendarEvent>)).toEqual({
      'recurrenceOverrides/2026-09-09T10:00:00': {
        start: '2026-09-09T14:00:00',
        duration: 'PT1H',
        title: 'Moved, renamed',
      },
    });
  });

  it('lets the patch override the pinned start (a drag) and creates a fresh override otherwise', () => {
    expect(buildFallbackOverridePatch(instance(), { start: '2026-09-08T12:00:00' })).toEqual({
      'recurrenceOverrides/2026-09-08T10:00:00': { start: '2026-09-08T12:00:00', duration: 'PT1H' },
    });
  });

  it('is null for something that is not an occurrence of a series', () => {
    expect(buildFallbackOverridePatch(instance({ recurrenceId: null }), { title: 'x' })).toBeNull();
  });
});

describe('buildFallbackExcludePatch', () => {
  it('excludes the occurrence under its override key', () => {
    expect(buildFallbackExcludePatch(instance())).toEqual({
      'recurrenceOverrides/2026-09-08T10:00:00': { excluded: true },
    });
    expect(buildFallbackExcludePatch(instance({ recurrenceId: null }))).toBeNull();
  });
});
