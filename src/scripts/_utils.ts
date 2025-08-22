import fs from 'fs';
import path from 'path';

const scriptsDir = __dirname;

export function getScriptEnvConfig(scriptPath: string): Record<string, unknown> {
    const relPath = scriptPath.replace(scriptsDir, '');
    const scriptFileName = path.basename(relPath);
    const scriptName = scriptFileName.replace('.ts', '');
    const relScriptDir = relPath.replace(scriptFileName, '');

    const file = path.join(__dirname, relScriptDir, `config/${scriptName}.json`);
    const defaultsFile = path.join(__dirname, `config/${scriptName}.defaults.json`);

    if (fs.existsSync(file)) {
        return JSON.parse(fs.readFileSync(file, 'utf-8').toString());
    }

    if (fs.existsSync(defaultsFile)) {
        return JSON.parse(fs.readFileSync(defaultsFile, 'utf-8'));
    }

    throw new Error(`No config found: please create ${file} or ${defaultsFile}`);
}
