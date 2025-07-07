// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FirstArg<T> = T extends (arg1: infer U, ...args: any[]) => any ? U : never;
