// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FirstArg<T> = T extends (arg1: infer U, ...args: any[]) => any ? U : never;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never;

// Utility type to allow creating partial mocks of complex Express types
export type DeepPartial<T> = {
    [P in keyof T]?: T[P] extends (infer U)[] ? DeepPartial<U>[] : T[P] extends object ? DeepPartial<T[P]> : T[P];
};
