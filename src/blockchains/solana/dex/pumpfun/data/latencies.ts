import { ExecutionLatencyData } from '../../../types';

export const pumpfunBuyLatencies: ExecutionLatencyData = {
    rpc: {
        default: {
            minTimeNs: 2265385250,
            maxTimeNs: 2645449583,
            avgTimeNs: 2455417416.5,
            medianTimeNs: 2645449583,
        },
        priorityFee: {
            0.005: {
                minTimeNs: 2265385250,
                maxTimeNs: 2645449583,
                avgTimeNs: 2455417416.5,
                medianTimeNs: 2645449583,
            },
        },
    },
    jito: {
        default: {
            minTimeNs: 1549232875,
            maxTimeNs: 8000264750,
            avgTimeNs: 3223903639.77,
            medianTimeNs: 2895500583,
        },
        tip: {
            0.00015: {
                minTimeNs: 1549232875,
                maxTimeNs: 8000264750,
                avgTimeNs: 3223903639.77,
                medianTimeNs: 2895500583,
            },
        },
    },
};

export const pumpfunSellLatencies: ExecutionLatencyData = {
    rpc: {
        default: {
            minTimeNs: 1762302125,
            maxTimeNs: 2120724750,
            avgTimeNs: 1941513437.5,
            medianTimeNs: 2120724750,
        },
        priorityFee: {},
    },
    jito: {
        default: {
            minTimeNs: 1334819291,
            maxTimeNs: 9549916292,
            avgTimeNs: 3006956258.09,
            medianTimeNs: 2918996084,
        },
        tip: {
            0.00015: {
                minTimeNs: 1334819291,
                maxTimeNs: 9549916292,
                avgTimeNs: 3006956258.09,
                medianTimeNs: 2918996084,
            },
        },
    },
};
