import { Request } from 'express';

import { Platform } from '../../../src/http-api/constants/system';
import { extractBearerToken, getClientVersion, getPlatform } from '../../../src/http-api/utils/req_utils';

describe('getPlatform', () => {
    test.each([
        ['web_fallback', 'd', Platform.Web],
        [
            'web_1',
            'Mozilla/5.0 (iPhone; CPU iPhone OS 13_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/280.0.0.47.116;FBBV/233064450;FBDV/iPhone10,5;FBMD/iPhone;FBSN/iOS;FBSV/13.5.1;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5;FBRV/235741005]',
            Platform.Web,
        ],
        ['empty_user_agent', '', Platform.Web],
        ['android', 'android_com.app.debug_1_1.0.0', Platform.Android],
        ['ios', 'ios_com.app.debug_1_1.0.0', Platform.Ios],
    ])('%s', (_, userAgent: string, expectedPlatform: Platform) => {
        expect(getPlatform(userAgent)).toBe(expectedPlatform);
    });
});

describe('getClientVersion', () => {
    test.each([
        [
            'should return client version from X-Client-Version header if present',
            'nw_b68528db001e628be16d8ce7376e3ce3cd2ff3e0',
            'ios_com.app.debug_41_2.3.1',
            'nw_b68528db001e628be16d8ce7376e3ce3cd2ff3e0',
        ],
        [
            'should return client version from User-Agent header if X-Client-Version header is missing',
            undefined,
            'ios_com.app.debug_41_2.3.1',
            '2.3.1',
        ],
        [
            'should return "unknown" if both X-Client-Version and User-Agent headers are missing',
            undefined,
            undefined,
            'unknown',
        ],
    ])('%s', (_, xClientVersion: string | undefined, userAgent: string | undefined, expected: string) => {
        const req = {
            header: jest.fn((name: string) =>
                name === 'X-Client-Version' ? xClientVersion : name === 'User-Agent' ? userAgent : undefined,
            ),
        } as unknown as Request;
        expect(getClientVersion(req as unknown as Request)).toBe(expected);
    });
});

describe('extractBearerToken', () => {
    it('should extract Bearer token from Authorization header', () => {
        const req: Partial<Request> = {
            headers: {
                authorization: 'Bearer myAccessToken123',
            },
        };
        expect(extractBearerToken(req as Request)).toEqual('myAccessToken123');
    });

    it('should return null if Authorization header is missing', () => {
        const req: Partial<Request> = {
            headers: {},
        };
        expect(extractBearerToken(req as Request)).toBeNull();
    });

    it('should return null if Authorization header does not have Bearer token', () => {
        const req: Partial<Request> = {
            headers: {
                authorization: 'Basic myCredentials123',
            },
        };
        expect(extractBearerToken(req as Request)).toBeNull();
    });

    it('should return null if Authorization header has invalid format', () => {
        const req: Partial<Request> = {
            headers: {
                authorization: 'Bearer',
            },
        };
        expect(extractBearerToken(req as Request)).toBeNull();
    });
});
