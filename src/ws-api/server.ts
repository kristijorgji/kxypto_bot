import { logger } from '@src/logger';
import { backtestIpcPlugin } from '@src/ws-api/ipc/backtest';

import { configureWsApp } from './configureWsApp';

(async () => {
    const port = parseInt(process.env.APP_WS_PORT as string);
    const { server } = await configureWsApp([backtestIpcPlugin]);

    server.listen(port, () => {
        logger.info(`WebSocket server listening on port ${port}`);
    });
})();
