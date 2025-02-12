import UniqueRandomIntGenerator from '../../../../src/utils/data/UniqueRandomIntGenerator';

describe(UniqueRandomIntGenerator.name, () => {
    describe('Finite Mode (min and max provided)', () => {
        test('generates unique numbers within range', () => {
            const generator = new UniqueRandomIntGenerator(1, 5);
            const numbers = new Set();

            for (let i = 0; i < 5; i++) {
                const num = generator.next();
                expect(num).toBeGreaterThanOrEqual(1);
                expect(num).toBeLessThanOrEqual(5);
                expect(numbers.has(num)).toBe(false); // Ensure uniqueness
                numbers.add(num);
            }
        });

        test('throws error when no numbers are left', () => {
            const generator = new UniqueRandomIntGenerator(1, 3);

            generator.next(); // 1
            generator.next(); // 2
            generator.next(); // 3

            expect(() => generator.next()).toThrow('No more unique numbers available');
        });

        test('reset() allows reusing numbers', () => {
            const generator = new UniqueRandomIntGenerator(1, 3);

            const firstRun = [generator.next(), generator.next(), generator.next()];
            expect(() => generator.next()).toThrow('No more unique numbers available');

            generator.reset();

            const secondRun = [generator.next(), generator.next(), generator.next()];
            expect(firstRun.sort()).toEqual(secondRun.sort()); // Should match after reset
        });

        test('throws error when min > max', () => {
            expect(() => new UniqueRandomIntGenerator(5, 1)).toThrow('min must be less than or equal to max');
        });
    });

    describe('Infinite Mode (no min or max)', () => {
        test('generates unique numbers infinitely', () => {
            const generator = new UniqueRandomIntGenerator();
            const numbers = new Set();

            for (let i = 0; i < 100; i++) {
                const num = generator.next();
                expect(numbers.has(num)).toBe(false); // Ensure uniqueness
                numbers.add(num);
            }
        });

        test('starts at 0 if no min is given', () => {
            const generator = new UniqueRandomIntGenerator();
            expect(generator.next()).toBe(0);
            expect(generator.next()).toBe(1);
            expect(generator.next()).toBe(2);
        });

        test('reset() restarts from 0', () => {
            const generator = new UniqueRandomIntGenerator();
            generator.next(); // 0
            generator.next(); // 1
            generator.next(); // 2

            generator.reset();

            expect(generator.next()).toBe(0);
            expect(generator.next()).toBe(1);
            expect(generator.next()).toBe(2);
        });
    });
});
