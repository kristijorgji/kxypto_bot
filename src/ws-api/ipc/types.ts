import {
    ProtoAbortBacktestRunResponseMessage,
    ProtoBacktestStrategyResultStatusResponseMessage,
} from '@src/protos/generated/backtests';

export const BACKTEST_COMMAND_REQUEST_CHANNEL = 'backtest.command.request';
export const BACKTEST_COMMAND_RESPONSE_CHANNEL = 'backtest.command.response';

export type BaseIpcMessage = {
    correlationId: string;
    type: string;
};

export type BacktestStrategyResultStatusRequestMessage = BaseIpcMessage & {
    type: 'STRATEGY_RESULT_STATUS_REQUEST';
    strategyResultId: number;
};

export type BacktestRunPauseRequestMessage = BaseIpcMessage & {
    type: 'BACKTEST_RUN_PAUSE';
    backtestRunId: number;
};

export type BacktestRunResumeRequestMessage = BaseIpcMessage & {
    type: 'BACKTEST_RUN_RESUME';
    backtestRunId: number;
};

export type BacktestRunAbortRequestMessage = BaseIpcMessage & {
    type: 'BACKTEST_RUN_ABORT';
    backtestRunId: number;
};

export type BacktestCommandMessage =
    | BacktestStrategyResultStatusRequestMessage
    | BacktestRunPauseRequestMessage
    | BacktestRunResumeRequestMessage
    | BacktestRunAbortRequestMessage;

export type BaseIcpResponse = Omit<BaseIpcMessage, 'type'>;

export type BacktestStrategyResultStatusResponseMessage = BaseIcpResponse &
    ProtoBacktestStrategyResultStatusResponseMessage;

export type AbortBacktestRunResponseMessage = BaseIcpResponse & ProtoAbortBacktestRunResponseMessage;
