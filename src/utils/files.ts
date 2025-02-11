import * as fs from 'fs';

import * as bigJson from 'big-json';

/**
 * For big files
 */
export function readStreamAsBuffer(filePath: string): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
        const stream = fs.createReadStream(filePath);
        const chunks: Buffer[] = [];

        stream.on('data', chunk => {
            chunks.push(chunk as Buffer);
        });

        stream.on('end', () => {
            const completeBuffer = Buffer.concat(chunks);
            resolve(completeBuffer);
        });

        stream.on('error', err => {
            reject(err);
        });
    });
}

/**
 * NodeJS max string length is 512mb so for bigger parsing we need streams
 */
export function readBigJson<T>(filePath: string): Promise<T> {
    const readStream = fs.createReadStream(filePath);
    const parseStream = bigJson.createParseStream();

    return new Promise((resolve, reject) => {
        parseStream.on('data', function (pojo) {
            resolve(pojo);
        });

        parseStream.on('error', function (err) {
            reject(err);
        });

        readStream.pipe(parseStream);
    });
}
