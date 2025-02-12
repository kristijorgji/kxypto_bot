// example 2023-03-20 12:57:02
export type MySQLTimestamp = string;

export type ApmEntry = {
    id: string;
    name: string;
    start_timestamp_ms: number;
    execution_time_ns: number;
};
