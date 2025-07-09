import { Application } from 'express';
import request from 'supertest';

import { LoginResponse } from '../../../src/http-api/handlers/auth/loginHandler';

/**
 * Logs in a test user that must be pre-seeded via the test seeds.
 * Assumes the user data already exists in the database before calling this function.
 */
export async function login(expressApp: Application): Promise<LoginResponse> {
    const res = await request(expressApp).post('/login').set('User-Agent', 'test').send({
        email: 'k@kxypto.com',
        password: 'magic7@!_Z',
    });
    expect(res.status).toBe(200);

    return res.body;
}
