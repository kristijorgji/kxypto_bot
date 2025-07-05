import * as console from 'node:console';
import path from 'path';

import { Command } from 'commander';
import fs from 'fs-extra';
import { globSync } from 'glob';

import { shuffle } from '@src/utils/data/data';

const program = new Command();

program
    .name('split-dataset')
    .description('Split files from a source directory into training and backtest folders by trainingPercentage')
    .requiredOption('--source-dir <path>', 'Source directory containing files')
    .requiredOption('--training-dir <path>', 'Directory to store training files')
    .requiredOption('--backtest-dir <path>', 'Directory to store backtest files')
    .requiredOption('--training-percentage <number>', 'Percentage of files to go to training set (0-100)')
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
    extFilter: string;
    reportFile: string;
    dryRun: boolean;
    useMove: boolean;
    shuffleSeed: string | undefined;
};

async function splitFiles(p: SplitFilesParams) {
    console.log('Running splitFiles with params=', p);

    const files = globSync(`${p.sourceDir}/**/*${p.extFilter}`, { nodir: true });

    if (files.length === 0) {
        console.warn(`⚠️ No files with extension ${p.extFilter} found in ${p.sourceDir}`);
        return;
    }

    const report: SplitReport = { training: [], backtest: [] };
    const shuffled = shuffle(files, p.shuffleSeed);
    const splitIndex = Math.floor((p.trainingPercentage / 100) * shuffled.length);

    const trainingFiles = shuffled.slice(0, splitIndex);
    const backtestFiles = shuffled.slice(splitIndex);

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

    console.log(`${p.dryRun ? '🧪 Dry run complete' : '✅ Split complete'} — Report saved to ${p.reportFile}`);
    console.log(`📊 Total files: ${trainingFiles.length + backtestFiles.length}`);
    console.log(`📊 Training files: ${trainingFiles.length}`);
    console.log(`📊 Backtest files: ${backtestFiles.length}`);
}

const opts = program.opts();

const trainingPercentage = parseInt(opts.trainingPercentage, 10);
if (isNaN(trainingPercentage) || trainingPercentage < 0 || trainingPercentage > 100) {
    console.error('❌ training-percentage must be a number between 0 and 100');
    process.exit(1);
}

splitFiles({
    sourceDir: path.resolve(opts.sourceDir),
    trainingDir: path.resolve(opts.trainingDir),
    backtestDir: path.resolve(opts.backtestDir),
    trainingPercentage: trainingPercentage,
    extFilter: opts.ext.startsWith('.') ? opts.ext : `.${opts.ext}`,
    reportFile: opts.output,
    dryRun: Boolean(opts.dryRun),
    useMove: Boolean(opts.move),
    shuffleSeed: opts.shuffleSeed,
}).catch(err => {
    console.error('❌ Failed to split files:', err);
    process.exit(1);
});
