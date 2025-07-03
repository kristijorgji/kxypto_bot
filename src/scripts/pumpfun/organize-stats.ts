import { Command } from 'commander';

import { organizePumpfunFiles } from '@src/trading/backtesting/data/pumpfun/utils';

const organizeStatsProgram = new Command();
organizeStatsProgram
    .name('organize-files')
    .description(
        `It will organize the files in the provided path and move them into proper folders 
        based on the bot version, strategy, variant and  handling result`,
    )
    .version('0.0.0')
    .requiredOption('--path <string>', 'Path to the folder containing the JSON result files.')
    .option('--dry-run', 'Perform a dry run without making any changes')
    .action(async args => {
        await organizePumpfunFiles({
            path: args.path,
            dryRun: args.dryRun,
        });
    });

if (require.main === module) {
    organizeStatsProgram.parse(process.argv);
}
