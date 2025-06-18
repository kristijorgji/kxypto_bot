/**
 * Normalizes a stack trace by removing the absolute project root path,
 * making it more readable and environment-agnostic.
 *
 * @param error The Error object whose stack trace needs to be normalized.
 * @param projectRoot Optional. The absolute path to the project root. Defaults to process.cwd().
 * @returns The normalized stack trace string.
 */
export default function normalizeStackTrace(error: Error, projectRoot?: string): string | undefined {
    if (!error.stack) {
        return undefined;
    }

    const root = projectRoot || process.cwd();

    // 1. Define a regex pattern for a path separator that matches both '\' and '/'
    const pathSeparatorRegexPattern = '[\\\\/]'; // This literal string in JS becomes `[\\/]` in the regex

    // 2. Clean the root path: remove any trailing slashes.
    //    This ensures that `regexRoot` represents just the folder name(s) of the root,
    //    and doesn't implicitly consume the final separator that connects it to the file path.
    const cleanRoot = root.replace(/[\\/]$/, '');

    // 3. Build a regex-escaped root path that is flexible with path separators.
    //    - Split the cleaned root by any path separator.
    //    - For each part, escape any regex special characters (e.g., if a folder name contains a dot).
    //    - Join the parts back together using the flexible `pathSeparatorRegexPattern`.
    const rootParts = cleanRoot.split(/[\\/]/);
    const regexRoot = rootParts
        .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) // Escape each segment
        .join(pathSeparatorRegexPattern); // Join with the flexible separator

    let normalizedStack = error.stack;

    // Regex 1: Matches the project root path immediately after an opening parenthesis.
    // It captures the opening parenthesis, matches `regexRoot`, and then *one* required path separator.
    // This ensures we replace the absolute root AND the connecting slash.
    const inParenthesesRegex = new RegExp(`\\(${regexRoot}${pathSeparatorRegexPattern}`, 'g');
    normalizedStack = normalizedStack.replace(inParenthesesRegex, '(./');

    // Regex 2: Matches the project root path at the beginning of a line that starts with "at "
    // and does NOT contain an opening parenthesis later on the same line.
    // It captures "at " ($1), matches `regexRoot`, and then *one* required path separator.
    const directAtPathRegex = new RegExp(`(^\\s*at\\s)(?!.*\\()${regexRoot}${pathSeparatorRegexPattern}`, 'gm');
    normalizedStack = normalizedStack.replace(directAtPathRegex, '$1./');

    // Finally, normalize all remaining backslashes in the entire stack trace to forward slashes.
    normalizedStack = normalizedStack.replace(/\\/g, '/');

    return normalizedStack;
}
