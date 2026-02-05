import request from 'supertest';

import { LaunchpadTokenFullResult, insertLaunchpadTokenResult } from '../../../../src/db/repositories/launchpad_tokens';
import { LaunchpadTokenResult } from '../../../../src/db/types';
import configureExpressApp from '../../../../src/http-api/configureExpressApp';
import { CursorPaginatedResponse } from '../../../../src/http-api/types';
import {
    BotExitResponse,
    BotTradeResponse,
    HandlePumpTokenReport,
} from '../../../../src/trading/bots/blockchains/solana/types';
import { readLocalFixture } from '../../../__utils/data';
import { login } from '../../../__utils/integration/login';

const expressApp = configureExpressApp();

const rowsCountToSeed = 5;

const seededResults: LaunchpadTokenResult[] = [];
const seededReports: HandlePumpTokenReport[] = [];
const baseReport: HandlePumpTokenReport = {
    $schema: {
        version: 777,
    },
    simulation: true,
    rpcProvider: {
        domain: 'test',
    },
    mint: 'AWMPpoCPFYhabRzTVVyd8q2V8pLo8V1ad6Lc9LMrpump',
    name: 'Justice For Clyde',
    url: 'https://pump.fun/coin/AWMPpoCPFYhabRzTVVyd8q2V8pLo8V1ad6Lc9LMrpump',
    bullXUrl: 'https://neo.bullx.io/terminal?chainId=1399811149&address=AWMPpoCPFYhabRzTVVyd8q2V8pLo8V1ad6Lc9LMrpump',
    creator: 'aW3M1tWd4DXeZmsk4kaJxv5Y7xknBeHzW5xaMdS1Kg3',
    startedAt: new Date('2025-07-09T11:05:51.500Z'),
    endedAt: new Date('2025-07-09T11:05:52.747Z'),
    elapsedSeconds: 1.247,
    exitCode: 'BAD_CREATOR',
    exitReason: 'Skipping this token because its creator is not detected as safe, reason=already_flagged',
};

const startDate = new Date('2025-07-09T11:00:00.000Z');
for (let i = 0; i < rowsCountToSeed; i++) {
    const report = baseReport;
    const result = reportToLaunchpadResult(report, rowsCountToSeed - i, startDate);
    seededResults.push(result);
    seededReports.push(report);
}

beforeAll(async () => {
    for (let i = 0; i < rowsCountToSeed; i++) {
        await insertLaunchpadTokenResult(seededResults[i], seededReports[i]);
    }
});

describe('GET /launchpad-token-results ', () => {
    /**
     * Validates that:
     *  - cursor-based pagination works correctly when multiple rows have the same `created_at` timestamp
     *  - limit and cursor parameters are respected
     *  - no row is returned more than once across paginated responses
     */
    it('paginates correctly with cursor when multiple rows share the same created_at timestamp', async () => {
        const loginResponse = await login(expressApp);

        let seenIndex = -1;
        const expectedIdsOrder = [5, 4, 3, 2, 1];
        const limit = 2;
        const qp = new URLSearchParams({
            limit: limit.toString(),
        });

        let prevNextCursor: string | null | undefined = undefined;
        let nextCursor: string | null | undefined = undefined;
        const allIds: Set<number> = new Set();
        do {
            qp.delete('cursor', prevNextCursor);
            if (nextCursor) {
                qp.append('cursor', nextCursor);
            }

            const res = await request(expressApp)
                .get(`/launchpad-token-results?${qp.toString()}`)
                .set('Authorization', `Bearer ${loginResponse.accessToken}`)
                .send();

            const body: CursorPaginatedResponse<LaunchpadTokenFullResult> = res.body;

            if (res.status !== 200) {
                throw new Error(`Status code: ${res.status}, body: ${JSON.stringify(body)}`);
            }

            prevNextCursor = nextCursor;
            nextCursor = body.nextCursor;

            if (body.nextCursor) {
                expect(body.count).toBe(limit);
            } else {
                expect(body.count).toBe(rowsCountToSeed - allIds.size);
            }

            for (const el of body.data) {
                if (allIds.has(el.id)) {
                    throw new Error(`Wrong cursor pagination: the id ${el.id} was already received`);
                }
                allIds.add(el.id);
                seenIndex++;

                expect(el).toEqual({
                    ...seededResults[seenIndex],
                    simulation: seededResults[seenIndex].simulation,
                    chain: 'solana',
                    platform: 'pumpfun',
                    report: {
                        ...seededReports[seenIndex],
                        startedAt: seededReports[seenIndex].startedAt.toISOString(),
                        endedAt: seededReports[seenIndex].endedAt.toISOString(),
                    },
                    // @ts-ignore
                    created_at: seededResults[seenIndex].created_at.toISOString(),
                    // @ts-ignore
                    updated_at: seededResults[seenIndex].updated_at.toISOString(),
                });
                expect(el.id).toBe(expectedIdsOrder[seenIndex]);
            }
        } while (nextCursor !== null && nextCursor !== undefined);

        expect(allIds.size).toBe(rowsCountToSeed);
    });

    it('receives bad request when query parameters are invalid', async () => {
        const loginResponse = await login(expressApp);

        const qp = new URLSearchParams({
            mode: 'real',
            chain: 'banana',
            platform: 'pumpfun',
            minSchemaVersion: 'b',
            tradesOnly: 'true',
            exitCodes: 'd',
            excludeExitCodes: 'bbbbbb',
            includeTrades: 'true',
            limit: 'a',
        });

        const res = await request(expressApp)
            .get(`/launchpad-token-results?${qp.toString()}`)
            .set('Authorization', `Bearer ${loginResponse.accessToken}`)
            .send();

        expect(res.status).toBe(400);
        expect(res.body).toEqual(readLocalFixture('bad-request-query-params-response'));
    });
});

function reportToLaunchpadResult(
    report: HandlePumpTokenReport,
    id: number,
    createdUpdatedDate: Date,
): LaunchpadTokenResult {
    return {
        id: id,
        simulation: report.simulation,
        chain: 'solana',
        platform: 'pumpfun',
        mint: report.mint,
        creator: report.creator,
        net_pnl: (report as unknown as BotTradeResponse)?.netPnl?.inSol ?? null,
        exit_code: (report as unknown as BotExitResponse)?.exitCode ?? null,
        exit_reason: (report as unknown as BotExitResponse)?.exitReason ?? null,
        created_at: createdUpdatedDate,
        updated_at: createdUpdatedDate,
    };
}
