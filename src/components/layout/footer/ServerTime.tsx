import { observer } from 'mobx-react-lite';
import moment from 'moment';
import { useStore } from '@/hooks/useStore';
import { formatLocalDateTime, localTimeZoneLabel } from '@/utils/local-time';
import { Text, Tooltip } from '@deriv-com/ui';
import { useDevice } from '@deriv-com/ui';

/**
 * The clock in the footer.
 *
 * It still reads Deriv's server time — that is the clock trades are stamped
 * with — but it shows it on the viewer's own, in twelve-hour form. The tooltip
 * names the timezone, so a clock that disagrees with someone else's screen has
 * an explanation attached.
 */
const ServerTime = observer(() => {
    const { isDesktop } = useDevice();
    const { common } = useStore() ?? {
        common: {
            server_time: moment(),
        },
    };

    return (
        <Tooltip
            as='div'
            className='app-footer__icon'
            data-testid='dt_server_time'
            tooltipContent={localTimeZoneLabel()}
        >
            <Text size={isDesktop ? 'xs' : 'sm'}>{formatLocalDateTime(common.server_time)}</Text>
        </Tooltip>
    );
});

export default ServerTime;
