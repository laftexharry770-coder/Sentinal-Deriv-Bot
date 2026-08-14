import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

/**
 * Asks a question about the most recent run of last-digits: are the last N of
 * them all odd, all even, all at or below a value, all at or above one.
 *
 * Strategies exported from other bot builders use this block, so files that
 * contain it could not be loaded at all — a strategy only loads if every block
 * in it is registered. The behaviour is the literal reading of the block's own
 * fields, and lives in last-digits-condition.js where it is tested.
 */
window.Blockly.Blocks.last_digits_condition = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('Last %1 digits are %2 %3'),
            args0: [
                {
                    type: 'input_value',
                    name: 'N',
                    check: 'Number',
                },
                {
                    type: 'field_dropdown',
                    name: 'CONDITION',
                    options: [
                        [localize('all odd'), 'ALL_ODD'],
                        [localize('all even'), 'ALL_EVEN'],
                        [localize('all less than or equal to'), 'LESS_OR_EQUAL'],
                        [localize('all greater than or equal to'), 'GREATER_OR_EQUAL'],
                    ],
                },
                {
                    type: 'input_value',
                    name: 'COMPARE_VALUE',
                    check: 'Number',
                },
            ],
            output: 'Boolean',
            outputShape: window.Blockly.OUTPUT_SHAPE_ROUND,
            inputsInline: true,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            tooltip: localize(
                'Returns true when every one of the last N digits satisfies the condition. The comparison value is used only by the two comparison conditions.'
            ),
            category: window.Blockly.Categories.Tick_Analysis,
        };
    },
    meta() {
        return {
            display_name: localize('Last digits condition'),
            description: localize(
                'Checks the most recent N last-digits together: all odd, all even, all at or below a value, or all at or above it. A window with fewer digits than asked for does not match.'
            ),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.last_digits_condition = block => {
    const generator = window.Blockly.JavaScript.javascriptGenerator;
    const condition = block.getFieldValue('CONDITION');
    const count = generator.valueToCode(block, 'N', generator.ORDER_NONE) || '0';
    const compare_value = generator.valueToCode(block, 'COMPARE_VALUE', generator.ORDER_NONE) || '0';

    return [
        `Bot.checkLastDigitsCondition('${condition}', ${count}, ${compare_value})`,
        generator.ORDER_FUNCTION_CALL,
    ];
};
