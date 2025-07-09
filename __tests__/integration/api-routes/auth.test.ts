import parse from 'parse-duration';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';

import { db } from '../../../src/db/knex';
import { Tables } from '../../../src/db/tables';
import configureExpressApp from '../../../src/http-api/configureExpressApp';
import { LoginResponse } from '../../../src/http-api/handlers/auth/loginHandler';
import { hashPassword } from '../../../src/services/auth';

const expressApp = configureExpressApp();

const aTestUser = {
    email: 'a@example.com',
    password: 'supersecret123',
};
const bTestUser = {
    email: 'b@example.com',
    password: 'bSupersecret123',
};
const userAgent = 'Kristi-Wolf';
const appVersion = 'v100';

let nowTimestamp = Date.now();
let bTestUserId: string;

beforeAll(async () => {
    await db(Tables.Users).insert([
        {
            id: uuidv4(),
            email: aTestUser.email,
            username: 'astar777',
            password: await hashPassword(aTestUser.password),
        },
        {
            id: uuidv4(),
            email: bTestUser.email,
            username: 'bstar777',
            password: await hashPassword(bTestUser.password),
        },
    ]);
});

beforeEach(async () => {
    await db(Tables.Sessions).delete();
    bTestUserId = (await db(Tables.Users).select('id').where('email', 'b@example.com').first()).id;
    nowTimestamp = Date.now();
});

describe('POST /login ', () => {
    it('should login and return tokens', async () => {
        const res = await request(expressApp)
            .post('/login')
            .set('User-Agent', userAgent)
            .set('X-Client-Version', 'v100')
            .send(aTestUser);

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            userId: expect.stringMatching(/^[0-9a-fA-F-]{36}$/),
            sessionId: expect.stringMatching(/^[0-9a-fA-F-]{36}$/),
            accessToken: expect.stringMatching(/^eyJ[a-zA-Z0-9-_]+\.[a-zA-Z0-9-_]+\.[a-zA-Z0-9-_]+$/), // JWT format
            accessTokenExpiresAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+\d{2}:\d{2}$/), // ISO 8601 w/ offset
            refreshToken: expect.stringMatching(/^eyJ[a-zA-Z0-9-_]+\.[a-zA-Z0-9-_]+\.[a-zA-Z0-9-_]+$/),
            refreshTokenExpiresAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+\d{2}:\d{2}$/),
        });

        const session = await db.table(Tables.Sessions).select().where('id', res.body.sessionId).first();
        expect(session).toMatchObject({
            id: res.body.sessionId,
            user_id: res.body.userId,
            refresh_token: res.body.refreshToken,
            user_agent: userAgent,
            client_ip: '::ffff:127.0.0.1',
            platform: 'web',
            app_version: appVersion,
            is_blocked: 0,
        });

        assertDateRange(
            new Date(res.body.accessTokenExpiresAt),
            parse(process.env.AUTH_ACCESS_TOKEN_EXPIRY as string)!,
        );
        assertDateRange(
            new Date(res.body.refreshTokenExpiresAt),
            parse(process.env.AUTH_REFRESH_TOKEN_EXPIRY as string)!,
        );
    });

    it('should return 401 for invalid credentials', async () => {
        let res = await request(expressApp).post('/login').send({
            email: aTestUser.email,
            password: 'wrongpassword',
        });

        expect(res.status).toBe(401);

        res = await request(expressApp).post('/login').send({
            email: 'ddd',
            password: aTestUser.password,
        });
        expect(res.status).toBe(401);
    });
});

describe('POST /tokens/renew_access ', () => {
    it('should renew access and refresh tokens when given a valid refresh token', async () => {
        const loginResponse = await login();
        const res = await request(expressApp).post('/tokens/renew_access').set('User-Agent', userAgent).send({
            refreshToken: loginResponse.refreshToken,
        });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            accessToken: expect.stringMatching(/^eyJ[a-zA-Z0-9-_]+\.[a-zA-Z0-9-_]+\.[a-zA-Z0-9-_]+$/), // JWT format
            accessTokenExpiresAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+\d{2}:\d{2}$/), // ISO 8601 w/ offset
        });
        assertDateRange(
            new Date(res.body.accessTokenExpiresAt),
            parse(process.env.AUTH_ACCESS_TOKEN_EXPIRY as string)!,
        );
    });

    it('should return error when the session is blocked', async () => {
        const loginResponse = await login();

        await db(Tables.Sessions).where('id', loginResponse.sessionId).update({
            is_blocked: true,
        });
        const res = await request(expressApp).post('/tokens/renew_access').set('User-Agent', userAgent).send({
            refreshToken: loginResponse.refreshToken,
        });
        expect(res.status).toBe(401);
        expect(res.body).toEqual({
            error: {
                code: 'blocked',
            },
        });
    });

    it('should return error when the session belongs to another user', async () => {
        const loginResponse = await login();

        await db(Tables.Sessions).where('id', loginResponse.sessionId).update({
            user_id: bTestUserId,
        });

        const res = await request(expressApp).post('/tokens/renew_access').set('User-Agent', userAgent).send({
            refreshToken: loginResponse.refreshToken,
        });
        expect(res.status).toBe(401);
        expect(res.body).toEqual({
            error: {
                code: 'incorrect_user',
            },
        });
    });

    it('should return error when the session is not found', async () => {
        const loginResponse = await login();

        await db(Tables.Sessions).where('id', loginResponse.sessionId).update({
            id: 'another-session-777',
        });
        const res = await request(expressApp).post('/tokens/renew_access').set('User-Agent', userAgent).send({
            refreshToken: loginResponse.refreshToken,
        });
        expect(res.status).toBe(404);
        expect(res.body).toEqual({});
    });

    it('should return error when the session is expired', async () => {
        const loginResponse = await login();

        await db(Tables.Sessions)
            .where('id', loginResponse.sessionId)
            .update({
                expires_at: Date.now() / 1000 - 3000,
            });
        const res = await request(expressApp).post('/tokens/renew_access').set('User-Agent', userAgent).send({
            refreshToken: loginResponse.refreshToken,
        });
        expect(res.status).toBe(401);
        expect(res.body).toEqual({
            error: {
                code: 'expired_session',
            },
        });
    });

    it('should return error when given invalid refresh token or it is missing', async () => {
        let res = await request(expressApp).post('/tokens/renew_access').set('User-Agent', userAgent).send({
            refreshToken: 'dandy',
        });
        expect(res.status).toBe(500);
        expect(res.body).toEqual({});

        res = await request(expressApp).post('/tokens/renew_access').set('User-Agent', userAgent).send();
        expect(res.status).toBe(500);
        expect(res.body).toEqual({});
    });
});

describe('POST /logout ', () => {
    it('should logout with correct refresh token and access in header', async () => {
        const loginResponse = await login();
        const res = await request(expressApp)
            .post('/logout')
            .set('User-Agent', userAgent)
            .set('Authorization', `Bearer ${loginResponse.accessToken}`)
            .send({
                refreshToken: loginResponse.refreshToken,
            });

        expect(res.status).toBe(200);
        const session = await db.table(Tables.Sessions).select().where('id', loginResponse.sessionId).first();
        expect(session.is_blocked).toBe(1);
    });

    it('should get 400 when access token is missing', async () => {
        const loginResponse = await login();
        const res = await request(expressApp).post('/logout').send({
            refreshToken: loginResponse.refreshToken,
        });

        expect(res.status).toBe(400);
        expect(res.body).toEqual({
            error: {
                code: 'no_token',
            },
        });
    });

    it('should get error when providing wrong refresh token', async () => {
        const loginResponse = await login();
        const res = await request(expressApp)
            .post('/logout')
            .set('Authorization', `Bearer ${loginResponse.accessToken}`)
            .send({
                refreshToken: 'dandy',
            });

        expect(res.status).toBe(500);
        expect(res.body).toEqual({});
    });

    it('should get error when sending access instead of refresh token', async () => {
        const loginResponse = await login();
        const res = await request(expressApp)
            .post('/logout')
            .set('Authorization', `Bearer ${loginResponse.accessToken}`)
            .send({
                refreshToken: loginResponse.accessToken,
            });

        expect(res.status).toBe(401);
        expect(res.body).toEqual({
            error: {
                code: 'wrong_token_type',
            },
        });
    });
});

describe('GET /user ', () => {
    it('should fetch the user belonging to the access token', async () => {
        const loginResponse = await login();

        const res = await request(expressApp)
            .get('/user')
            .set('Authorization', `Bearer ${loginResponse.accessToken}`)
            .send();

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            id: expect.stringMatching(/^[0-9a-fA-F-]{36}$/),
            name: null,
            email: aTestUser.email,
            config: {
                permissions: [],
            },
        });
    });

    it('should return 404 if the user is not found', async () => {
        const loginResponse = await login();
        await db(Tables.Sessions).delete();
        await db(Tables.Users).where('email', aTestUser.email).delete();

        const res = await request(expressApp)
            .get('/user')
            .set('Authorization', `Bearer ${loginResponse.accessToken}`)
            .send();

        expect(res.status).toBe(404);
        expect(res.body).toEqual({});
    });

    it('should get authorization error when providing invalid jwt or missing jwt', async () => {
        let res = await request(expressApp).get('/user').set('Authorization', 'Bearer zzzz').send();
        expect(res.status).toBe(401);
        expect(res.body).toEqual({
            message: 'Failed to authenticate token',
        });

        res = await request(expressApp).get('/user').send();
        expect(res.status).toBe(401);
        expect(res.body).toEqual({
            message: 'No token provided',
        });
    });
});

async function login(): Promise<LoginResponse> {
    const res = await request(expressApp).post('/login').set('User-Agent', userAgent).send(aTestUser);
    expect(res.status).toBe(200);

    return res.body;
}

function assertDateRange(date: Date, expiresInMs: number): void {
    const leewayMs = 6e3; // some time from test start or end
    expect(date.getTime()).toBeGreaterThan(nowTimestamp + expiresInMs - leewayMs);
    expect(date.getTime()).toBeLessThan(nowTimestamp + expiresInMs + leewayMs);
}
