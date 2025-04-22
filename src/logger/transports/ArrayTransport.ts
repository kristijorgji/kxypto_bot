/* eslint-disable @typescript-eslint/no-explicit-any */

import os from 'os';

import * as logform from 'logform';
import TransportStreamOptions from 'winston-transport';

const MESSAGE = Symbol.for('message');

function defaultParser<T>(data: T): T {
    return data;
}

function defaultParserJSON(data: string): unknown {
    return JSON.parse(data);
}

const defaultMaxListeners = 30;

interface ArrayTransportOptions {
    name?: string;
    eol?: string;
    array?: any[];
    levels?: Record<string, string>;
    parser?: (message: any) => any;
    format?: logform.Format;
    json?: boolean;
    limit?: number;
    maxListeners?: number;
}

export default class ArrayTransport extends TransportStreamOptions {
    private array: any[];
    private eol: string;
    private levels: Record<string, string>;
    public format?: logform.Format;
    private parser: (message: any) => any;
    private limit?: number;

    constructor(options: ArrayTransportOptions = {}) {
        super(options as TransportStreamOptions);
        const maxListeners = Number.isInteger(options.maxListeners) ? options.maxListeners : defaultMaxListeners;

        // @ts-ignore
        this.name = options.name || this.constructor.name;
        this.eol = options.eol || os.EOL;
        this.array = options.array || [];
        this.levels = options.levels || {};
        this.parser = options.parser || (options.json ? defaultParserJSON : defaultParser);
        this.format = options.format;
        this.limit = options.limit;
        this.setMaxListeners(maxListeners as number);
    }

    log(info: { [key: string]: any }, callback: () => void): void {
        setImmediate(() => {
            this.emit('logged', info);
        });

        // @ts-ignore
        const message = info[MESSAGE];

        const parsedMessage = this.parser(message);
        if (parsedMessage.message) {
            parsedMessage.message = info.message;
        }

        this.array.push(parsedMessage);
        if (this.limit && this.array.length > this.limit) {
            this.array.shift();
        }
        callback();
    }
}
