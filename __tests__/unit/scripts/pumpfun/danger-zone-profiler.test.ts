import fs from 'fs';

import { LogEntry, format } from 'winston';

import { logger } from '../../../../src/logger';
import ArrayTransport from '../../../../src/logger/transports/ArrayTransport';
import { profileDangerZones } from '../../../../src/scripts/pumpfun/danger-zone-profiler';
import { readLocalFixture } from '../../../__utils/data';
import { mockFsReadFileSync } from '../../../__utils/data-mocks';
import { sanitizeLogs } from '../../../__utils/logs';

const realFs = jest.requireActual('fs');
jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    readFileSync: jest.fn(),
}));
const mockedFs = fs as jest.Mocked<typeof fs>;

describe('Danger Zone Profiler', () => {
    const mockReportPath = 'report.json';
    let logs: LogEntry[] = [];

    beforeEach(() => {
        logs = [];
        logger.level = 'silly';
        logger.clear().add(new ArrayTransport({ array: logs, json: false, format: format.splat() }));
        jest.clearAllMocks();
    });

    it('should return findings and verify leadTimeMs/intensity for RUG', async () => {
        const mockReportData = {
            processed: 1,
            events: {
                'mint123.json': {
                    '1700000000000': [
                        {
                            triggerIndex: 10,
                            data: {
                                type: 'RUG',
                                startTimestamp: 1699999995000,
                                endingPriceDiffPercentage: -95,
                            },
                        },
                        {
                            triggerIndex: 11,
                            data: {
                                type: 'RUG',
                                startTimestamp: 1699999995000,
                                endingPriceDiffPercentage: -95,
                            },
                        },
                    ],
                },
            },
        };

        mockFsReadFileSync(mockedFs, realFs, {
            [mockReportPath]: mockReportData,
        });

        const result = await profileDangerZones({
            reportPath: mockReportPath,
            exportSummaryOnly: false,
        });

        expect(result).toHaveProperty(['mint123.json']);
        const event = result['mint123.json'][0];

        expect(event).toEqual({
            timestamp: 1700000000000,
            mode: 'RUG',
            horizonIndex: 10,
            leadTimeMs: 5000,
            intensity: 2,
            indexSpan: 1,
            finalDelta: -95,
        });

        expect(sanitizeLogs(logs)).toEqual(sanitizeLogs(readLocalFixture('danger-zone-profiler/expected-logs-1')));
    });

    it('should correctly log WIN mode specific information', async () => {
        const mockReportData = {
            processed: 1,
            events: {
                'profit.json': {
                    '2000': [
                        {
                            triggerIndex: 50,
                            data: { type: 'WIN', startTimestamp: 1000, endingPriceDiffPercentage: 20 },
                        },
                    ],
                },
            },
        };

        mockFsReadFileSync(mockedFs, realFs, { [mockReportPath]: mockReportData });

        await profileDangerZones({ reportPath: mockReportPath, exportSummaryOnly: false });

        // Terminology check
        expect(logs.some(line => line.includes('Ideal Entry Index:              50'))).toBe(true);
        expect(logs.some(line => line.includes('Maturity Time (Time to Profit): 1000ms'))).toBe(true);
    });

    it('should respect exportSummaryOnly by suppressing detailed event logs', async () => {
        const mockReportData = {
            processed: 1,
            events: {
                'summary.json': {
                    '5000': [
                        {
                            triggerIndex: 1,
                            data: { type: 'RUG', startTimestamp: 4000, endingPriceDiffPercentage: -80 },
                        },
                    ],
                },
            },
        };

        mockFsReadFileSync(mockedFs, realFs, { [mockReportPath]: mockReportData });

        await profileDangerZones({ reportPath: mockReportPath, exportSummaryOnly: true });

        expect(logs.some(line => line.includes('FILE: summary.json'))).toBe(true);
        expect(logs.some(line => line.includes('Horizon Index'))).toBe(false);
    });

    it('should throw when readFileSync fails', async () => {
        mockedFs.readFileSync.mockImplementation(() => {
            throw new Error('FILE_NOT_FOUND');
        });

        await expect(profileDangerZones({ reportPath: 'missing.json', exportSummaryOnly: false })).rejects.toThrow(
            'FILE_NOT_FOUND',
        );
    });
});
