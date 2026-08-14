import { localize } from '@deriv-com/translations';
import { excludeOptionFromContextMenu, modifyContextMenu } from '../../../utils';

/**
 * Buys a digit contract named at purchase time, with its own barrier.
 *
 * Strategies exported from other bot builders use this in place of the stock
 * purchase block, because it can decide between even/odd and over/under while
 * running — something the stock block cannot do, since that one may only buy
 * the contract types the strategy declared up front. Files containing it could
 * not be loaded at all, a block at a time being enough to reject the whole
 * strategy.
 *
 * The barrier travels with the purchase, which is how the API's parameterised
 * buy works; see purchaseDigit in the trade engine.
 */
window.Blockly.Blocks.apollo_purchase2 = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('Buy %1 %2'),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'PURCHASE_LIST',
                    options: [
                        [localize('Even'), 'DIGITEVEN'],
                        [localize('Odd'), 'DIGITODD'],
                        [localize('Over'), 'DIGITOVER'],
                        [localize('Under'), 'DIGITUNDER'],
                        [localize('Matches'), 'DIGITMATCH'],
                        [localize('Differs'), 'DIGITDIFF'],
                    ],
                },
                {
                    type: 'input_value',
                    name: 'PREDICTION',
                    check: 'Number',
                },
            ],
            previousStatement: null,
            nextStatement: null,
            inputsInline: true,
            colour: window.Blockly.Colours.Special1.colour,
            colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
            tooltip: localize(
                'Buys the chosen digit contract. The prediction is the barrier, and is used by Over, Under, Matches and Differs.'
            ),
            category: window.Blockly.Categories.Before_Purchase,
        };
    },
    meta() {
        return {
            display_name: localize('Buy digit contract'),
            description: localize(
                'Buys a digit contract chosen while the strategy runs, with the barrier given here. Even and Odd ignore the prediction.'
            ),
        };
    },
    customContextMenu(menu) {
        const menu_items = [localize('Enable Block'), localize('Disable Block')];
        excludeOptionFromContextMenu(menu, menu_items);
        modifyContextMenu(menu);
    },
    restricted_parents: ['before_purchase'],
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.apollo_purchase2 = block => {
    const generator = window.Blockly.JavaScript.javascriptGenerator;
    const purchase_list = block.getFieldValue('PURCHASE_LIST');
    // Even and Odd carry no barrier; the engine leaves it off the buy when the
    // value is empty rather than sending a barrier the contract cannot take.
    const prediction = generator.valueToCode(block, 'PREDICTION', generator.ORDER_NONE) || "''";

    return `Bot.purchaseDigit('${purchase_list}', ${prediction});\n`;
};
