import Redis from 'ioredis';

export const redis = new Redis({
    host: process.env.REDIS_HOST as string,
    port: parseInt(process.env.REDIS_PORT as string),
});
