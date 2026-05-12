/**
 * `BirthDateTime` — typed builder + validator for the (date, time, lat, lon, tz)
 * tuple that every chart-style endpoint takes. Reduces boilerplate when constructing
 * request bodies and catches malformed dates before the network round-trip.
 *
 * Tree-shakeable: import directly from `@astroway/sdk/helpers` so the helper
 * doesn't bloat the core bundle when you don't use it.
 *
 *   import { BirthDateTime } from '@astroway/sdk/helpers';
 *
 *   const birth = BirthDateTime.fromCoordinates({
 *     date: '1990-07-14', time: '14:30:00',
 *     latitude: 50.45, longitude: 30.52, timezoneOffset: 3,
 *   });
 *   const chart = await aw.chart.compute(birth.toBody());
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}:\d{2}$/;
const ISO_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)/;

export interface BirthDateTimeInit {
  /** ISO date `YYYY-MM-DD`. */
  date: string;
  /** Time `HH:MM:SS`. */
  time: string;
  /** UTC offset in hours. Defaults to 0 if omitted. */
  timezoneOffset?: number;
  /** Decimal latitude, north positive. Defaults to 0. */
  latitude?: number;
  /** Decimal longitude, east positive. Defaults to 0. */
  longitude?: number;
}

export interface BirthDateTimeBody {
  date: string;
  time: string;
  timezoneOffset: number;
  latitude: number;
  longitude: number;
}

export class BirthDateTime {
  readonly date: string;
  readonly time: string;
  readonly timezoneOffset: number;
  readonly latitude: number;
  readonly longitude: number;

  private constructor(init: Required<BirthDateTimeInit>) {
    this.date = init.date;
    this.time = init.time;
    this.timezoneOffset = init.timezoneOffset;
    this.latitude = init.latitude;
    this.longitude = init.longitude;
  }

  /**
   * Build from explicit `{ date, time, latitude, longitude, timezoneOffset }`.
   * Validates date / time format eagerly.
   */
  static fromCoordinates(init: BirthDateTimeInit): BirthDateTime {
    if (!DATE_RE.test(init.date)) {
      throw new Error(`BirthDateTime: date must be YYYY-MM-DD, got '${init.date}'`);
    }
    if (!TIME_RE.test(init.time)) {
      throw new Error(`BirthDateTime: time must be HH:MM:SS, got '${init.time}'`);
    }
    return new BirthDateTime({
      date: init.date,
      time: init.time,
      timezoneOffset: init.timezoneOffset ?? 0,
      latitude: init.latitude ?? 0,
      longitude: init.longitude ?? 0,
    });
  }

  /**
   * Build from a `Date` (assumed to be a "local birth moment in the user's
   * birth timezone") plus the corresponding `(lat, lon, tzOffset)`.
   *
   * The Date is split into `YYYY-MM-DD` + `HH:MM:SS` using its UTC components
   * — the caller is responsible for passing a Date that already represents the
   * birth-place local time (use `new Date(Date.UTC(year, month-1, day, hour, min, sec))`).
   */
  static fromDate(
    date: Date,
    geo: { latitude: number; longitude: number; timezoneOffset?: number },
  ): BirthDateTime {
    const yyyy = date.getUTCFullYear().toString().padStart(4, '0');
    const mm = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const dd = date.getUTCDate().toString().padStart(2, '0');
    const hh = date.getUTCHours().toString().padStart(2, '0');
    const mi = date.getUTCMinutes().toString().padStart(2, '0');
    const ss = date.getUTCSeconds().toString().padStart(2, '0');
    return BirthDateTime.fromCoordinates({
      date: `${yyyy}-${mm}-${dd}`,
      time: `${hh}:${mi}:${ss}`,
      latitude: geo.latitude,
      longitude: geo.longitude,
      timezoneOffset: geo.timezoneOffset ?? 0,
    });
  }

  /**
   * Build from a full ISO 8601 string (`1990-07-14T14:30:00`) plus geo data.
   * The trailing `Z` / `+HH:MM` offset, if present, is stripped — the API
   * separately tracks `timezoneOffset`.
   */
  static parse(
    iso: string,
    geo: { latitude: number; longitude: number; timezoneOffset?: number },
  ): BirthDateTime {
    const match = ISO_RE.exec(iso);
    if (!match) {
      throw new Error(`BirthDateTime: cannot parse ISO datetime '${iso}'`);
    }
    const [, date, timeRaw] = match;
    const time = (timeRaw as string).length === 5 ? `${timeRaw}:00` : (timeRaw as string);
    return BirthDateTime.fromCoordinates({
      date: date as string,
      time,
      latitude: geo.latitude,
      longitude: geo.longitude,
      timezoneOffset: geo.timezoneOffset ?? 0,
    });
  }

  /** Wire shape suitable for `aw.chart.compute(birth.toBody())` etc. */
  toBody(): BirthDateTimeBody {
    return {
      date: this.date,
      time: this.time,
      timezoneOffset: this.timezoneOffset,
      latitude: this.latitude,
      longitude: this.longitude,
    };
  }

  /** Same fields, but as a JS `Date` (constructed in UTC for determinism). */
  toDate(): Date {
    const [y, m, d] = this.date.split('-').map(Number) as [number, number, number];
    const [h, mi, s] = this.time.split(':').map(Number) as [number, number, number];
    return new Date(Date.UTC(y, m - 1, d, h, mi, s));
  }
}
