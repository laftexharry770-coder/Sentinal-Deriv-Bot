import moment from 'moment';
import {
    formatLocalDate,
    formatLocalDateTime,
    formatLocalTime,
    localTimeZoneLabel,
    toLocalMoment,
} from '../local-time';

// 2026-08-13T16:07:52Z — an afternoon in UTC, so a timezone slip shows up as a
// different hour rather than a different minute.
const EPOCH_SECONDS = 1786651672;

describe('toLocalMoment', () => {
    it('reads a bare number as epoch seconds, like the rest of the API', () => {
        expect(toLocalMoment(EPOCH_SECONDS).valueOf()).toBe(EPOCH_SECONDS * 1000);
    });

    it('returns a local moment, not a UTC one', () => {
        expect(toLocalMoment(EPOCH_SECONDS).isUTC()).toBe(false);
    });

    it('clones a moment rather than converting the caller´s', () => {
        // The stores hand out a shared server-time object; converting it in
        // place would move every other reader's clock too.
        const serverTime = moment.unix(EPOCH_SECONDS).utc();
        toLocalMoment(serverTime);
        expect(serverTime.isUTC()).toBe(true);
    });

    it('falls back to now for empty or unparseable input', () => {
        for (const value of [undefined, null, '', 'not a date']) {
            expect(toLocalMoment(value as never).isValid()).toBe(true);
        }
    });
});

describe('twelve-hour formatting', () => {
    it('writes the time with AM/PM and no leading zero on the hour', () => {
        const formatted = formatLocalTime(EPOCH_SECONDS);
        expect(formatted).toMatch(/^\d{1,2}:\d{2}:\d{2} (AM|PM)$/);
        expect(formatted).toBe(moment.unix(EPOCH_SECONDS).local().format('h:mm:ss A'));
    });

    it('never prints a 24-hour hour', () => {
        // Every hour of a day, so a format string that only looks right in the
        // morning cannot pass.
        for (let hour = 0; hour < 24; hour++) {
            const at = moment().startOf('day').add(hour, 'hours');
            const [printedHour] = formatLocalTime(at).split(':');
            expect(Number(printedHour)).toBeGreaterThanOrEqual(1);
            expect(Number(printedHour)).toBeLessThanOrEqual(12);
        }
    });

    it('marks midday and midnight the way a person reads them', () => {
        const midnight = moment().startOf('day');
        const midday = moment().startOf('day').add(12, 'hours');
        expect(formatLocalTime(midnight)).toMatch(/^12:00:00 AM$/);
        expect(formatLocalTime(midday)).toMatch(/^12:00:00 PM$/);
    });

    it('stamps a record with the date alongside the time', () => {
        expect(formatLocalDateTime(EPOCH_SECONDS)).toMatch(/^\d{1,2} \w{3} \d{4}, \d{1,2}:\d{2}:\d{2} (AM|PM)$/);
    });

    it('dates on the local calendar, not the UTC one', () => {
        expect(formatLocalDate(EPOCH_SECONDS)).toBe(moment.unix(EPOCH_SECONDS).local().format('YYYY-MM-DD'));
    });
});

describe('localTimeZoneLabel', () => {
    it('names the zone and its offset', () => {
        expect(localTimeZoneLabel()).toMatch(/GMT[+-]\d{2}:\d{2}/);
    });
});
