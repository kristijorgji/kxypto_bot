export function getRandomEnumValue<T extends Record<string, string | number>>(enumObj: T): T[keyof T] {
    const values = Object.values(enumObj) as T[keyof T][];
    return values[Math.floor(Math.random() * values.length)];
}

export function mapStringToEnum<T extends Record<string, string>>(value: string, enumType: T): T[keyof T] {
    const normalized = value.toLowerCase();

    const match = (Object.values(enumType) as string[]).find(e => e.toLowerCase() === normalized);

    if (!match) {
        throw new Error(`Unknown enum value: ${value}`);
    }

    return match as T[keyof T];
}
