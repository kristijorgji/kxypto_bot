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
            minTimeNs: 1157826625,
            maxTimeNs: 3742123167,
            avgTimeNs: 2189585292.820513,
            medianTimeNs: 1988424791,
        },
        tip: {
            0.00015: {
                minTimeNs: 1157826625,
                maxTimeNs: 3742123167,
                avgTimeNs: 2189585292.820513,
                medianTimeNs: 1988424791,
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
            minTimeNs: 1011567167,
            maxTimeNs: 4110722458,
            avgTimeNs: 1965935294.9473684,
            medianTimeNs: 1801843834,
        },
        tip: {
            0.00015: {
                minTimeNs: 1011567167,
                maxTimeNs: 4110722458,
                avgTimeNs: 1965935294.9473684,
                medianTimeNs: 1801843834,
            },
        },
    },
};
