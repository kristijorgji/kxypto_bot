import { Command } from 'commander';

export function runCommand(command: Command, args: string[]): void {
    assignCommandArgv(args);
    command.parse(process.argv);
}

export async function runCommandAsync(command: Command, args: string[]): Promise<void> {
    assignCommandArgv(args);
    await command.parseAsync(process.argv);
}

function assignCommandArgv(args: string[]): void {
    process.argv = ['node', 'command', ...args];
}
