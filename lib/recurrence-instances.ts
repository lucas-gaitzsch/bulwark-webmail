/**
 * Server-side recurrence instances ("synthetic ids").
 *
 * `CalendarEvent/query` with `expandRecurrences: true` returns one synthetic
 * id per occurrence in the range instead of the stored base event. Since
 * Stalwart 0.16.20 those ids are also accepted by `CalendarEvent/set`: an
 * update on a synthetic id writes a `recurrenceOverrides` entry for that one
 * occurrence, a destroy excludes it. Older servers reject both with
 * `invalidProperties` ("… synthetic ids is not yet supported."), in which
 * case Bulwark keeps expanding recurrences in the browser
 * (lib/recurrence-expansion.ts) and patches the base event itself.
 *
 * What an expanded occurrence looks like (verified against 0.16.19):
 * - `id` is synthetic, `baseEventId` is the stored event's id; a
 *   non-recurring event in the range gets a synthetic id too.
 * - `recurrenceId` / `recurrenceIdTimeZone` are set for occurrences of a
 *   series, `recurrenceRule` / `recurrenceOverrides` are stripped.
 * - all-day occurrences lose `showWithoutTime` and are stamped with the
 *   request time zone.
 * - the ids are positional and reshuffle whenever the series' overrides
 *   change, so the visible range has to be refetched after mutating one.
 */

import type { CalendarEvent } from '@/lib/jmap/types';
import { parseDurationSeconds } from '@/lib/calendar-event-normalization';
import { RECURRENCE_OVERRIDE_IMMUTABLE_KEYS } from '@/lib/recurrence-overrides';

/**
 * A synthetic id whose event can never exist: expansion 0 of document
 * `u32::MAX` (`Id::from_parts(1, u32::MAX)` in Stalwart's base32 alphabet).
 * A pre-0.16.20 server rejects an update on it as `invalidProperties`
 * before looking anything up; a server that supports synthetic ids answers
 * `notFound`. Either way nothing is written, which makes it a safe probe.
 */
export const SYNTHETIC_ID_PROBE = 'h333333';

/** Base-event properties an expanded occurrence needs back (see `hydrateRecurrenceInstances`). */
export const RECURRENCE_BASE_PROPERTIES = [
  'id',
  'recurrenceRule',
  'excludedRecurrenceRule',
  'recurrenceOverrides',
  'showWithoutTime',
  'timeZone',
  'duration',
] as const;

/**
 * Properties Stalwart refuses on a single occurrence ("This property cannot
 * be modified on a single occurrence."). They describe the stored event, not
 * one of its instances.
 */
export const OCCURRENCE_REJECTED_KEYS = [
  'baseEventId',
  'calendarIds',
  'isDraft',
  'isOrigin',
  'utcStart',
  'utcEnd',
  'useDefaultAlerts',
  'mayInviteSelf',
  'mayInviteOthers',
  'hideAttendees',
] as const;

type EventIdentity = Pick<CalendarEvent, 'id'> & Partial<Pick<CalendarEvent, 'originalId' | 'baseEventId'>>;

/**
 * True for an occurrence handed out by server-side expansion, i.e. an event
 * whose (raw) id is synthetic and differs from its base event's id. A base
 * event fetched directly also carries `baseEventId`, equal to its own id.
 */
export function isServerRecurrenceInstance(event: EventIdentity | null | undefined): boolean {
  if (!event?.baseEventId) return false;
  return event.baseEventId !== (event.originalId ?? event.id);
}

/**
 * The store id under which the base event of `instance` would be addressed.
 * Store ids end with the raw JMAP id (`<accountId>:<raw>`,
 * `<localAccountId>::<raw>` or just `<raw>`), so swap the trailing raw
 * synthetic id for the base id and keep whatever namespace prefix is there.
 */
export function baseEventStoreId(instance: EventIdentity): string | null {
  if (!isServerRecurrenceInstance(instance) || !instance.baseEventId) return null;
  const raw = instance.originalId ?? instance.id;
  if (!instance.id.endsWith(raw)) return instance.baseEventId;
  return instance.id.slice(0, instance.id.length - raw.length) + instance.baseEventId;
}

/**
 * Whether a `CalendarEvent/set` failure is a pre-0.16.20 server refusing a
 * synthetic id ("Updating/Deleting synthetic ids is not yet supported.").
 */
export function isSyntheticIdMutationUnsupported(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string' ? error : '';
  return /synthetic ids?\b.*\bnot (?:yet )?supported/i.test(message);
}

function firstPointerSegment(key: string): string {
  const slash = key.indexOf('/');
  return slash === -1 ? key : key.slice(0, slash);
}

/**
 * Reduce an event patch to what may be written to a single occurrence
 * through its synthetic id: identity / whole-series keys and the per-event
 * keys the server rejects are dropped (also when addressed through a JSON
 * pointer such as `calendarIds/x`). Everything else - including pointer
 * patches like `locations/loc1/name` - passes through unchanged.
 */
export function buildOccurrencePatch(updates: Partial<CalendarEvent>): Partial<CalendarEvent> {
  const dropped = new Set<string>([
    ...RECURRENCE_OVERRIDE_IMMUTABLE_KEYS,
    ...OCCURRENCE_REJECTED_KEYS,
    'recurrenceId',
    'recurrenceIdTimeZone',
  ]);
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (dropped.has(firstPointerSegment(key))) continue;
    patch[key] = value;
  }
  return patch as Partial<CalendarEvent>;
}

type OverrideMap = NonNullable<CalendarEvent['recurrenceOverrides']>;

/**
 * Given an expanded occurrence, find the key of its entry in the base
 * event's `recurrenceOverrides`. Normally that is `recurrenceId`; a
 * pre-0.16.20 server reports a moved occurrence's *new* start as its
 * recurrenceId, in which case the entry is found by that start instead.
 */
export function resolveOverrideKey(
  instance: Pick<CalendarEvent, 'start' | 'recurrenceId'>,
  overrides: OverrideMap | null | undefined,
): string | null {
  if (!instance.recurrenceId) return null;
  if (!overrides || instance.recurrenceId in overrides) return instance.recurrenceId;
  for (const [key, override] of Object.entries(overrides)) {
    if (override && override.start === instance.start) return key;
  }
  return instance.recurrenceId;
}

function shiftIso(from: string | null | undefined, seconds: number): string | null {
  if (!from) return null;
  const ms = Date.parse(from);
  if (Number.isNaN(ms)) return null;
  return new Date(ms + seconds * 1000).toISOString();
}

/**
 * Give expanded occurrences the base-event context the rest of the app
 * expects from an occurrence (and that the client-side expansion used to
 * copy from the master): the recurrence rules and overrides, the all-day
 * flag, and - for an override that does not set its own duration - the
 * inherited duration (RFC 8984 §4.3.4: an override is a patch on the base
 * event; the server's own computed duration for such overrides has been seen
 * to be wrong). Occurrences whose base event is not in `bases` are returned
 * unchanged.
 */
export function hydrateRecurrenceInstances(
  instances: CalendarEvent[],
  bases: ReadonlyMap<string, Partial<CalendarEvent>>,
): CalendarEvent[] {
  return instances.map((instance) => {
    if (!isServerRecurrenceInstance(instance) || !instance.recurrenceId) return instance;
    const base = instance.baseEventId ? bases.get(instance.baseEventId) : undefined;
    if (!base) return instance;

    const hydrated: CalendarEvent = {
      ...instance,
      recurrenceRules: base.recurrenceRules ?? null,
      excludedRecurrenceRules: base.excludedRecurrenceRules ?? null,
      recurrenceOverrides: base.recurrenceOverrides ?? null,
    };
    if (base.showWithoutTime) {
      hydrated.showWithoutTime = true;
      hydrated.timeZone = base.timeZone ?? null;
    }

    const overrideKey = resolveOverrideKey(instance, base.recurrenceOverrides);
    if (overrideKey) hydrated.recurrenceId = overrideKey;
    const override = overrideKey ? base.recurrenceOverrides?.[overrideKey] : undefined;
    if (override && override.duration == null && base.duration && hydrated.duration !== base.duration) {
      hydrated.duration = base.duration;
      const seconds = parseDurationSeconds(base.duration);
      if (seconds !== null && !hydrated.showWithoutTime) {
        hydrated.utcEnd = shiftIso(hydrated.utcStart, seconds) ?? hydrated.utcEnd;
      }
    }
    return hydrated;
  });
}

/**
 * The fallback for servers that reject synthetic ids: the same change
 * expressed as a whole-object `recurrenceOverrides/<recurrenceId>` patch on
 * the base event. The existing override (if any) is kept underneath so a
 * partial patch (a drag that only sets `start`) does not wipe fields the
 * occurrence already overrides, and `start`/`duration` are pinned the way
 * the server does it for synthetic-id updates.
 */
export function buildFallbackOverridePatch(
  instance: Pick<CalendarEvent, 'start' | 'duration' | 'recurrenceId' | 'recurrenceOverrides'>,
  patch: Partial<CalendarEvent>,
): Partial<CalendarEvent> | null {
  const key = resolveOverrideKey(instance, instance.recurrenceOverrides);
  if (!key) return null;
  const existing = (instance.recurrenceOverrides?.[key] ?? {}) as Record<string, unknown>;
  const { updated: _updated, ...kept } = existing;
  const override: Record<string, unknown> = {
    ...kept,
    start: instance.start,
    duration: instance.duration,
    ...buildOccurrencePatch(patch),
  };
  return { [`recurrenceOverrides/${key}`]: override } as Partial<CalendarEvent>;
}

/** The fallback for destroying one occurrence: exclude it on the base event. */
export function buildFallbackExcludePatch(
  instance: Pick<CalendarEvent, 'start' | 'recurrenceId' | 'recurrenceOverrides'>,
): Partial<CalendarEvent> | null {
  const key = resolveOverrideKey(instance, instance.recurrenceOverrides);
  if (!key) return null;
  return { [`recurrenceOverrides/${key}`]: { excluded: true } } as Partial<CalendarEvent>;
}
