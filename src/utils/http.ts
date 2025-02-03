export function extractHostAndPort(url: string): {
    host: string;
    port: number;
} {
    const parsedUrl = new URL(url);

    const host = parsedUrl.hostname;
    let port: string;

    if (parsedUrl.port) {
        port = parsedUrl.port;
    } else {
        if (['wss:', 'https:'].includes(parsedUrl.protocol)) {
            port = '443';
        } else {
            port = '80';
        }
    }

    return { host: host, port: parseInt(port) };
}
