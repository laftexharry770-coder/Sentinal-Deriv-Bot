/**
 * The predicate behind the `last_digits_condition` block.
 *
 * Strategies exported from third-party bot builders use a block that asks a
 * question about the most recent N last-digits: are they all odd, all even, all
 * at or below a value, all at or above one. The block does not exist here, so
 * those files would not load at all; this is the behaviour it describes,
 * written where it can be tested without a socket, a workspace or a browser.
 *
 * The reading is the literal one: take the last N digits and require every one
 * of them to satisfy the condition. A window that cannot be filled — fewer
 * digits than asked for, or a non-positive N — is not a match, because
 * "the last four digits are all odd" is not true of three digits.
 */

export const LAST_DIGITS_CONDITIONS = ['ALL_ODD', 'ALL_EVEN', 'LESS_OR_EQUAL', 'GREATER_OR_EQUAL'];

export const lastDigitsCondition = (digits, condition, count, compare_value) => {
    const window_size = Number(count);
    if (!Array.isArray(digits) || !Number.isFinite(window_size) || window_size <= 0) return false;

    const window_digits = digits.slice(-window_size);
    if (window_digits.length < window_size) return false;

    const threshold = Number(compare_value);

    switch (condition) {
        case 'ALL_ODD':
            return window_digits.every(digit => Number(digit) % 2 === 1);
        case 'ALL_EVEN':
            return window_digits.every(digit => Number(digit) % 2 === 0);
        case 'LESS_OR_EQUAL':
            if (!Number.isFinite(threshold)) return false;
            return window_digits.every(digit => Number(digit) <= threshold);
        case 'GREATER_OR_EQUAL':
            if (!Number.isFinite(threshold)) return false;
            return window_digits.every(digit => Number(digit) >= threshold);
        default:
            // An unknown condition is not silently true: this decides whether
            // money is staked.
            return false;
    }
};

export default lastDigitsCondition;
