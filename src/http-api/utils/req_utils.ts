import { Request } from 'express';

import { Platform } from '../constants/system';

export function getPlatform(userAgent: string): Platform {
    if (userAgent) {
        const re = /([a-zA-Z]+)_([^_]+)_([^_]+)_([^_]+)/;
        const matches = userAgent.match(re);
        if (matches && matches.length > 4) {
            if (matches[1].toLowerCase() === 'android') {
                return Platform.Android;
            } else {
                return Platform.Ios;
            }
        }
    }

    return Platform.Web;
}

export function getClientVersion(req: Request): string {
    const clientVersionHeader = req.header('X-Client-Version');
    if (clientVersionHeader) {
        return clientVersionHeader;
    }

    return getMobileAppClientVersionFromUserAgent(req.header('User-Agent') ?? '');
}

function getMobileAppClientVersionFromUserAgent(userAgent: string): string {
    const re = /([a-zA-Z]+)_([^_]+)_([^_]+)_([^_]+)/;
    const matches = userAgent.match(re);
    if (matches && matches.length > 4) {
        return matches[4];
    }

    return 'unknown';
}

export function extractBearerToken(req: Request): string | null {
    const authHeader = req.headers.authorization;

    if (authHeader) {
        const parts = authHeader.split(' ');
        if (parts.length === 2 && parts[0] === 'Bearer') {
            return parts[1];
        }
    }

    return null;
}
