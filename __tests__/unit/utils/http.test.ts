import { extractHostAndPort } from '../../../src/utils/http';

describe('extractHostAndPort', () => {
    it('returns host and explicit port from URL', () => {
        const result = extractHostAndPort('https://example.com:8443/path');
        expect(result).toEqual({ host: 'example.com', port: 8443 });
    });

    it('defaults to port 443 for https URLs with no port', () => {
        const result = extractHostAndPort('https://example.com/some-path');
        expect(result).toEqual({ host: 'example.com', port: 443 });
    });

    it('defaults to port 443 for wss URLs with no port', () => {
        const result = extractHostAndPort('wss://socket.server.com/stream');
        expect(result).toEqual({ host: 'socket.server.com', port: 443 });
    });

    it('defaults to port 80 for http URLs with no port', () => {
        const result = extractHostAndPort('http://example.org');
        expect(result).toEqual({ host: 'example.org', port: 80 });
    });

    it('defaults to port 80 for ws URLs with no port', () => {
        const result = extractHostAndPort('ws://feed.example.net');
        expect(result).toEqual({ host: 'feed.example.net', port: 80 });
    });

    it('handles localhost with explicit port', () => {
        const result = extractHostAndPort('http://localhost:3000/api');
        expect(result).toEqual({ host: 'localhost', port: 3000 });
    });

    it('throws error for invalid URL', () => {
        expect(() => extractHostAndPort('not-a-valid-url')).toThrow();
    });
});
