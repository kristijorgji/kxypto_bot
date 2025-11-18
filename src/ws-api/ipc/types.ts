import { ProtoBacktestStrategyResultStatusResponseMessage } from '@src/protos/generated/backtests';

export const BACKTEST_COMMAND_CHANNEL = 'backtest.command';
export const BACKTEST_STATUS_RESPONSE_CHANNEL = 'backtest.status.response';

type BaseIpcMessage = {
    correlationId: string;
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

type BaseIcpResponse = BaseIpcMessage;

export type BacktestStrategyResultStatusResponseMessage = BaseIcpResponse &
    ProtoBacktestStrategyResultStatusResponseMessage;
