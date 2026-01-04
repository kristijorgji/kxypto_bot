import path from 'path';

import { Command, Option } from 'commander';
import fs, { readFile } from 'fs-extra';
import { globSync } from 'glob';

import { logger } from '@src/logger';
import { HandlePumpTokenReport } from '@src/trading/bots/blockchains/solana/types';
import { shuffle } from '@src/utils/data/data';
import { reviveDates } from '@src/utils/json';

const program = new Command();

enum SplitMode {
    Random = 'random',
    Chronological = 'chronological',
}

program
    .name('split-dataset')
    .description('Split files from a source directory into training and backtest folders by trainingPercentage')
    .requiredOption('--source-dir <path>', 'Source directory containing files')
    .requiredOption('--training-dir <path>', 'Directory to store training files')
    .requiredOption('--backtest-dir <path>', 'Directory to store backtest files')
    .requiredOption('--training-percentage <number>', 'Percentage of files to go to training set (0-100)')
    .addOption(
        new Option('--mode <name>', 'specify a split mode').choices(Object.values(SplitMode)).makeOptionMandatory(),
    )
    .option('--ext <ext>', 'File extension to include (e.g., .json, .jpg)', '.json')
    .option('--move', 'Move files instead of copying', false)
    .option('--dry-run', 'Simulate file operations without modifying anything', false)
    .option('--output <file>', 'Output JSON report path', 'data/split-report.json')
    .option('--shuffle-seed <seed>', 'Seed for deterministic shuffling');

program.parse();

type FileOperation = { source: string; dest: string };
type SplitReport = { training: FileOperation[]; backtest: FileOperation[] };

type SplitFilesParams = {
    sourceDir: string;
    trainingDir: string;
    backtestDir: string;
    trainingPercentage: number;
    splitMode: SplitMode;
    extFilter: string;
    reportFile: string;
    dryRun: boolean;
    useMove: boolean;
    shuffleSeed: string | undefined;
};

async function splitFiles(p: SplitFilesParams) {
    logger.info('Running splitFiles with params=%o', p);

    const files = globSync(`${p.sourceDir}/**/*${p.extFilter}`, { nodir: true });

    if (files.length === 0) {
        logger.warn(`⚠️ No files with extension ${p.extFilter} found in ${p.sourceDir}`);
        return;
    }

    const report: SplitReport = { training: [], backtest: [] };
    const ordered =
        p.splitMode === SplitMode.Chronological
            ? await getOrderedPathsByStartedAt(files)
            : shuffle(files, p.shuffleSeed);
    const splitIndex = Math.floor((p.trainingPercentage / 100) * ordered.length);

    const trainingFiles = ordered.slice(0, splitIndex);
    const backtestFiles = ordered.slice(splitIndex);

    for (const file of trainingFiles) {
        const relPath = path.relative(p.sourceDir, file);
        const destPath = path.join(p.trainingDir, relPath);
        report.training.push({ source: file, dest: destPath });

        if (!p.dryRun) {
            await fs.ensureDir(path.dirname(destPath));
            p.useMove ? await fs.move(file, destPath, { overwrite: true }) : await fs.copy(file, destPath);
        }
    }

    for (const file of backtestFiles) {
        const relPath = path.relative(p.sourceDir, file);
        const destPath = path.join(p.backtestDir, relPath);
        report.backtest.push({ source: file, dest: destPath });

        if (!p.dryRun) {
            await fs.ensureDir(path.dirname(destPath));
            p.useMove ? await fs.move(file, destPath, { overwrite: true }) : await fs.copy(file, destPath);
        }
    }

    await fs.writeJson(p.reportFile, report, { spaces: 2 });

    logger.info(`${p.dryRun ? '🧪 Dry run complete' : '✅ Split complete'} — Report saved to ${p.reportFile}`);
    logger.info(`📊 Total files: ${ordered.length}`);
    logger.info(`📊 Training files: ${trainingFiles.length}`);
    logger.info(`📊 Backtest files: ${backtestFiles.length}`);
}

const opts = program.opts();

const trainingPercentage = parseInt(opts.trainingPercentage, 10);
if (isNaN(trainingPercentage) || trainingPercentage < 0 || trainingPercentage > 100) {
    logger.error('❌ training-percentage must be a number between 0 and 100');
    process.exit(1);
}

splitFiles({
    sourceDir: path.resolve(opts.sourceDir),
    trainingDir: path.resolve(opts.trainingDir),
    backtestDir: path.resolve(opts.backtestDir),
    trainingPercentage: trainingPercentage,
    splitMode: opts.mode,
    extFilter: opts.ext.startsWith('.') ? opts.ext : `.${opts.ext}`,
    reportFile: opts.output,
    dryRun: Boolean(opts.dryRun),
    useMove: Boolean(opts.move),
    shuffleSeed: opts.shuffleSeed,
}).catch(err => {
    logger.error('❌ Failed to split files:', err);
    process.exit(1);
});

async function getOrderedPathsByStartedAt(files: string[]): Promise<string[]> {
    // Process in batches to avoid "Too many open files" errors
    const CONCURRENCY = 100;
    const results: { path: string; startedAt: number }[] = [];

    for (let i = 0; i < files.length; i += CONCURRENCY) {
        const batch = files.slice(i, i + CONCURRENCY);

        const batchResults = await Promise.all(
            batch.map(async path => {
                try {
                    const data = await readFile(path, 'utf8');
                    // parse and revive only what you need
                    const content = JSON.parse(data, reviveDates) as HandlePumpTokenReport;

                    return {
                        path,
                        startedAt:
                            content.startedAt instanceof Date
                                ? content.startedAt.getTime()
                                : new Date(content.startedAt).getTime(),
                    };
                } catch (err) {
                    logger.error(`Skipping file ${path}:`, err);
                    return null;
                }
            }),
        );

        // Filter out any nulls from failed reads
        for (const res of batchResults) {
            if (res) results.push(res);
        }
    }

    // Sort ascending (2026 V8 engine is highly optimized for numeric sorts)
    return results.sort((a, b) => a.startedAt - b.startedAt).map(r => r.path);
}
