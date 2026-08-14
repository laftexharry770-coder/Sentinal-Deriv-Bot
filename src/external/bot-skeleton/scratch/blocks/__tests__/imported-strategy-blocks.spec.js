import fs from 'fs';
import path from 'path';

/**
 * A strategy only loads if every block in it is registered — one unknown type
 * rejects the whole file. Strategies exported from other bot builders use two
 * blocks Deriv does not ship, and this is the guard that they stay registered:
 * losing either one silently makes those files unloadable again, with an error
 * that names the block but not the reason it went missing.
 *
 * The block types below are the full set used by such a strategy.
 */
const BLOCKS_DIR = path.join(__dirname, '..');

const IMPORTED_STRATEGY_BLOCKS = [
    // The two that Deriv itself does not define.
    'last_digits_condition',
    'apollo_purchase2',
    // ...alongside the stock blocks the same file leans on.
    'trade_definition',
    'trade_definition_market',
    'trade_definition_tradetype',
    'trade_definition_contracttype',
    'trade_definition_candleinterval',
    'trade_definition_restartbuysell',
    'trade_definition_restartonerror',
    'trade_definition_tradeoptions',
    'before_purchase',
    'after_purchase',
    'contract_check_result',
    'total_profit',
    'trade_again',
    'timeout',
];

const registeredBlockTypes = () => {
    const types = new Set();
    const walk = dir => {
        fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) return walk(full);
            if (!entry.name.endsWith('.js')) return;
            const source = fs.readFileSync(full, 'utf8');
            [...source.matchAll(/Blockly\.Blocks\.([A-Za-z0-9_]+)\s*=/g)].forEach(m => types.add(m[1]));
            [...source.matchAll(/Blockly\.Blocks\['([A-Za-z0-9_]+)'\]\s*=/g)].forEach(m => types.add(m[1]));
        });
    };
    walk(BLOCKS_DIR);
    return types;
};

describe('blocks an imported strategy needs', () => {
    const types = registeredBlockTypes();

    it.each(IMPORTED_STRATEGY_BLOCKS)('defines %s', block_type => {
        expect(types.has(block_type)).toBe(true);
    });

    it('reaches those definitions through the folder index files', () => {
        // A block file that nothing imports is never registered at runtime, so
        // the definition existing is not on its own enough.
        const digits_index = fs.readFileSync(path.join(BLOCKS_DIR, 'Binary/Tick Analysis/index.js'), 'utf8');
        const purchase_index = fs.readFileSync(path.join(BLOCKS_DIR, 'Binary/Before Purchase/index.js'), 'utf8');

        expect(digits_index).toContain("import './last_digits_condition'");
        expect(purchase_index).toContain("import './apollo_purchase2'");
    });
});
