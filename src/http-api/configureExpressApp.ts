import compression from 'compression';
import cors from 'cors';
import express, { Application, RequestHandler, json, urlencoded } from 'express';
import morgan from 'morgan';

import { getBacktestHandler, getBacktestRequestSchema } from '@src/http-api/handlers/backtests/backtests';
import getBacktestRuns, { getBacktestRunsRequestSchema } from '@src/http-api/handlers/backtests/getBacktestRuns';
import {
    deleteStrategyResultByIdHandler,
    deleteStrategyResultByIdRequestSchema,
} from '@src/http-api/handlers/backtests/strategyResults';
import { createTypedHandler, validateRequestMiddleware } from '@src/http-api/middlewares/validateRequestMiddleware';

import loginHandler from './handlers/auth/loginHandler';
import logoutHandler from './handlers/auth/logoutHandler';
import renewAccessTokenHandler from './handlers/auth/renewAccessTokenHandler';
import getLaunchpadTokenResultsHandler, {
    getLaunchpadTokenResultsRequestSchema,
} from './handlers/launchpad/getLaunchpadTokenResultsHandler';
import meHandler from './handlers/users/meHandler';
import verifyJwtTokenMiddleware from './middlewares/verifyJwtTokenMiddleware';

export default function configureExpressApp(requestHandlers: RequestHandler[] = []): Application {
    const app = express();

    app.use(
        compression({
            // filter: Decide if the answer should be compressed or not,
            // depending on the 'shouldCompress' function above
            filter: (req, res) => {
                if (req.headers['accept-encoding'] === undefined || !req.headers['accept-encoding'].includes('gzip')) {
                    return false;
                }

                return compression.filter(req, res);
            },
        }),
    );

    app.use(morgan('combined'));

    app.use(cors());

    // Middleware to parse JSON request bodies
    app.use(json());

    // Middleware to parse URL-encoded request bodies
    app.use(urlencoded({ extended: true }));

    requestHandlers.forEach(requestHandler => app.use(requestHandler));

    app.post('/login', loginHandler);
    app.post('/tokens/renew_access', renewAccessTokenHandler);
    app.post('/logout', logoutHandler);

    app.get('/user', verifyJwtTokenMiddleware, meHandler);

    app.get(
        '/launchpad-token-results',
        verifyJwtTokenMiddleware,
        validateRequestMiddleware(getLaunchpadTokenResultsRequestSchema),
        createTypedHandler(getLaunchpadTokenResultsHandler),
    );

    app.get(
        '/backtest-runs',
        verifyJwtTokenMiddleware,
        validateRequestMiddleware(getBacktestRunsRequestSchema),
        createTypedHandler(getBacktestRuns),
    );

    app.get(
        '/backtests/:id',
        verifyJwtTokenMiddleware,
        validateRequestMiddleware(getBacktestRequestSchema),
        createTypedHandler(getBacktestHandler),
    );

    app.delete(
        '/backtest-strategy-result/:id',
        verifyJwtTokenMiddleware,
        validateRequestMiddleware(deleteStrategyResultByIdRequestSchema),
        createTypedHandler(deleteStrategyResultByIdHandler),
    );

    return app;
}
