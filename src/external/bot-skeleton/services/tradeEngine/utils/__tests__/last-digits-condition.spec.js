import { lastDigitsCondition } from '../last-digits-condition';

// Oldest first, newest last — the order getLastDigitList returns.
const DIGITS = [8, 1, 3, 5, 7, 9];

describe('lastDigitsCondition', () => {
    it('matches when the last N digits are all odd', () => {
        expect(lastDigitsCondition(DIGITS, 'ALL_ODD', 4)).toBe(true);
        // Reaching one digit further back includes an 8.
        expect(lastDigitsCondition(DIGITS, 'ALL_ODD', 6)).toBe(false);
    });

    it('matches when the last N digits are all even', () => {
        expect(lastDigitsCondition([1, 2, 4, 6], 'ALL_EVEN', 3)).toBe(true);
        expect(lastDigitsCondition([2, 4, 6, 7], 'ALL_EVEN', 3)).toBe(false);
    });

    it('compares every digit in the window against the threshold', () => {
        expect(lastDigitsCondition([9, 0, 1, 2, 3], 'LESS_OR_EQUAL', 4, 3)).toBe(true);
        expect(lastDigitsCondition([9, 0, 1, 2, 4], 'LESS_OR_EQUAL', 4, 3)).toBe(false);
        expect(lastDigitsCondition([0, 6, 7, 8, 9], 'GREATER_OR_EQUAL', 4, 6)).toBe(true);
        expect(lastDigitsCondition([0, 5, 7, 8, 9], 'GREATER_OR_EQUAL', 4, 6)).toBe(false);
    });

    it('does not match a window it cannot fill', () => {
        // "The last four digits are all odd" is not true of three digits.
        expect(lastDigitsCondition([1, 3, 5], 'ALL_ODD', 4)).toBe(false);
        expect(lastDigitsCondition([], 'ALL_ODD', 1)).toBe(false);
        expect(lastDigitsCondition([1, 3], 'ALL_ODD', 0)).toBe(false);
        expect(lastDigitsCondition([1, 3], 'ALL_ODD', -2)).toBe(false);
    });

    it('refuses anything it does not understand rather than passing it', () => {
        // This decides whether money is staked, so unknown means no.
        expect(lastDigitsCondition(DIGITS, 'SOMETHING_ELSE', 2)).toBe(false);
        expect(lastDigitsCondition(null, 'ALL_ODD', 2)).toBe(false);
        expect(lastDigitsCondition(DIGITS, 'LESS_OR_EQUAL', 2)).toBe(false);
    });
});
