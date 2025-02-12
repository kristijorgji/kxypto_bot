import { computeSimulatedLatencyNs } from '../../../src/utils/simulations';

describe('computeSimulatedLatencyNs', () => {
    const minTimeNs = 82_952_750;
    const maxTimeNs = 7_209_068_250;
    const avgTimeNs = 139_118_938;
    const medianTimeNs = 100_929_917;

    test('generates values within the expected range', () => {
        for (let i = 0; i < 1000; i++) {
            const result = computeSimulatedLatencyNs({
                minTimeNs,
                maxTimeNs,
                avgTimeNs,
                medianTimeNs,
            });

            expect(result).toBeGreaterThanOrEqual(minTimeNs);
            expect(result).toBeLessThanOrEqual(maxTimeNs);
        }
    });

    test('skews towards the lower range (minTimeNs → avgTimeNs) for ~25% of values', () => {
        let count = 0;
        for (let i = 0; i < 1000; i++) {
            const result = computeSimulatedLatencyNs({
                minTimeNs,
                maxTimeNs,
                avgTimeNs,
                medianTimeNs,
            });

            if (result >= minTimeNs && result < avgTimeNs) {
                count++;
            }
        }
        expect(count).toBeGreaterThanOrEqual(200); // At least ~20-25% should be in this range
    });

    test('skews towards the middle range (avgTimeNs → medianTimeNs) for ~50% of values', () => {
        let count = 0;
        for (let i = 0; i < 1000; i++) {
            const result = computeSimulatedLatencyNs({
                minTimeNs,
                maxTimeNs,
                avgTimeNs,
                medianTimeNs,
            });

            if ((result >= avgTimeNs && result < medianTimeNs) || (result >= medianTimeNs && result < avgTimeNs)) {
                count++;
            }
        }
        expect(count).toBeGreaterThanOrEqual(450); // At least ~45-50% should be in this range
    });

    test('skews towards the upper range (medianTimeNs → maxTimeNs) for ~25% of values', () => {
        let count = 0;
        for (let i = 0; i < 1000; i++) {
            const result = computeSimulatedLatencyNs({
                minTimeNs,
                maxTimeNs,
                avgTimeNs,
                medianTimeNs,
            });

            if (result >= medianTimeNs && result <= maxTimeNs) {
                count++;
            }
        }
        expect(count).toBeGreaterThanOrEqual(200); // At least ~20-25% should be in this range
    });
});
