import { logger } from '@src/logger';
import { server } from '@src/ws-api/configureWsApp';

const port = parseInt(process.env.APP_WS_PORT as string);
server.listen(port, () => {
    logger.info(`WebSocket server listening on port ${port}`);
});
