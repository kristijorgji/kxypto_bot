import * as fs from 'fs';
import * as path from 'path';

export const readFixture = <T>(name: string): T => {
    return JSON.parse(rawFixture(name)) as unknown as T;
};

export const fixturesPath = (name: string, ext = '.json'): string => {
    const _ext = getExt(name);
    return path.resolve(__dirname, `../data/fixtures/${name}${_ext.length !== 0 ? '' : ext}`);
};

function getExt(filename: string): string {
    const t = path.extname(filename || '').split('.');
    return t[t.length - 1];
}

export const rawFixture = (name: string): string => {
    return fs.readFileSync(fixturesPath(name)).toString();
};
