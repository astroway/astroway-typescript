import { describe, it, expect } from 'vitest';
import { BirthDateTime } from '../src/helpers/birth-date-time.js';

describe('BirthDateTime.fromCoordinates', () => {
  it('builds a valid instance from the canonical wire shape', () => {
    const b = BirthDateTime.fromCoordinates({
      date: '1990-07-14', time: '14:30:00', latitude: 50.45, longitude: 30.52, timezoneOffset: 3,
    });
    expect(b.date).toBe('1990-07-14');
    expect(b.time).toBe('14:30:00');
    expect(b.latitude).toBe(50.45);
    expect(b.longitude).toBe(30.52);
    expect(b.timezoneOffset).toBe(3);
  });

  it('defaults timezoneOffset / latitude / longitude to 0', () => {
    const b = BirthDateTime.fromCoordinates({ date: '1990-07-14', time: '14:30:00' });
    expect(b.timezoneOffset).toBe(0);
    expect(b.latitude).toBe(0);
    expect(b.longitude).toBe(0);
  });

  it('throws on bad date format', () => {
    expect(() => BirthDateTime.fromCoordinates({ date: 'not-a-date', time: '14:30:00' })).toThrow();
  });

  it('throws on bad time format', () => {
    expect(() => BirthDateTime.fromCoordinates({ date: '1990-07-14', time: '14:30' })).toThrow();
  });
});

describe('BirthDateTime.fromDate', () => {
  it('builds from a UTC Date plus geo data', () => {
    const date = new Date(Date.UTC(1990, 6, 14, 14, 30, 0));
    const b = BirthDateTime.fromDate(date, { latitude: 50.45, longitude: 30.52, timezoneOffset: 3 });
    expect(b.date).toBe('1990-07-14');
    expect(b.time).toBe('14:30:00');
    expect(b.timezoneOffset).toBe(3);
  });

  it('zero-pads single-digit components', () => {
    const date = new Date(Date.UTC(2002, 0, 5, 6, 7, 8));
    const b = BirthDateTime.fromDate(date, { latitude: 0, longitude: 0 });
    expect(b.date).toBe('2002-01-05');
    expect(b.time).toBe('06:07:08');
  });
});

describe('BirthDateTime.parse', () => {
  it('parses a full ISO 8601 string', () => {
    const b = BirthDateTime.parse('1990-07-14T14:30:00', { latitude: 50.45, longitude: 30.52, timezoneOffset: 3 });
    expect(b.date).toBe('1990-07-14');
    expect(b.time).toBe('14:30:00');
  });

  it('parses ISO without seconds, defaulting to :00', () => {
    const b = BirthDateTime.parse('1990-07-14T14:30', { latitude: 0, longitude: 0 });
    expect(b.time).toBe('14:30:00');
  });

  it('strips trailing Z / offset', () => {
    const b = BirthDateTime.parse('1990-07-14T14:30:00Z', { latitude: 0, longitude: 0 });
    expect(b.date).toBe('1990-07-14');
    expect(b.time).toBe('14:30:00');
  });

  it('throws on garbage input', () => {
    expect(() => BirthDateTime.parse('not-an-iso', { latitude: 0, longitude: 0 })).toThrow();
  });
});

describe('BirthDateTime.toBody / toDate', () => {
  it('toBody returns the wire shape with all fields', () => {
    const b = BirthDateTime.fromCoordinates({
      date: '1990-07-14', time: '14:30:00', latitude: 50.45, longitude: 30.52, timezoneOffset: 3,
    });
    expect(b.toBody()).toEqual({
      date: '1990-07-14',
      time: '14:30:00',
      timezoneOffset: 3,
      latitude: 50.45,
      longitude: 30.52,
    });
  });

  it('toDate roundtrips via UTC components', () => {
    const b = BirthDateTime.fromCoordinates({ date: '1990-07-14', time: '14:30:00' });
    const d = b.toDate();
    expect(d.getUTCFullYear()).toBe(1990);
    expect(d.getUTCMonth()).toBe(6);
    expect(d.getUTCDate()).toBe(14);
    expect(d.getUTCHours()).toBe(14);
    expect(d.getUTCMinutes()).toBe(30);
  });
});
