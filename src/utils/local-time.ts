import moment from 'moment';

/**
 * Times shown to the person using the app, on their own clock.
 *
 * The codebase's own `toMoment` pins everything to UTC and the display formats
 * carried a literal [GMT], which is right for a log you intend to compare
 * across timezones and wrong for someone watching their own trades: a contract
 * bought at half past four in the afternoon read 13:30 GMT. Everything a person
 * reads goes through here instead — their timezone, and a twelve-hour clock.
 *
 * Anything sent to Deriv keeps using the UTC helpers; this is display only.
 */

/** 4:07:52 PM */
export const LOCAL_TIME_12H = 'h:mm:ss A';

/** 4:07 PM */
export const LOCAL_TIME_12H_SHORT = 'h:mm A';

/** 13 Aug 2026, 4:07:52 PM */
export const LOCAL_DATE_TIME_12H = 'D MMM YYYY, h:mm:ss A';

/** 2026-08-13 — sorts correctly, and no ambiguity between day and month. */
export const LOCAL_DATE = 'YYYY-MM-DD';

/**
 * A moment on the viewer's clock.
 *
 * Bare numbers are epoch *seconds* here, matching the API and this codebase's
 * `epochToMoment`; a Moment is cloned rather than mutated, since the stores
 * hand out shared server-time objects.
 */
export const toLocalMoment = (value?: moment.MomentInput): moment.Moment => {
    if (typeof value === 'number') return moment.unix(value).local();
    if (value === null || value === undefined || value === '') return moment();
    // Strings are parsed as ISO 8601 rather than left to moment's fallback,
    // which guesses at unrecognised input and warns about it on the console.
    const parsed = typeof value === 'string' ? moment(value, moment.ISO_8601) : moment(value);
    return parsed.isValid() ? parsed.local() : moment();
};

/** 4:07:52 PM — for a running log, where the date is already established. */
export const formatLocalTime = (value?: moment.MomentInput, format: string = LOCAL_TIME_12H): string =>
    toLocalMoment(value).format(format);

/** 13 Aug 2026, 4:07:52 PM — for a record that outlives the session. */
export const formatLocalDateTime = (value?: moment.MomentInput): string =>
    toLocalMoment(value).format(LOCAL_DATE_TIME_12H);

/** 2026-08-13, on the viewer's clock rather than UTC. */
export const formatLocalDate = (value?: moment.MomentInput): string => toLocalMoment(value).format(LOCAL_DATE);

/**
 * Names the timezone the times are in — "Africa/Nairobi (GMT+03:00)" — so a
 * clock that disagrees with the exchange is explainable rather than alarming.
 * Falls back to the offset alone where the browser will not name the zone.
 */
export const localTimeZoneLabel = (): string => {
    const offset = moment().format('Z');
    try {
        const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        return zone ? `${zone} (GMT${offset})` : `GMT${offset}`;
    } catch {
        return `GMT${offset}`;
    }
};
