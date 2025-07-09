export default class CompositeCursor {
    constructor(
        private readonly _data: {
            lastPreviousId: string;
            lastDate: string;
        },
    ) {}

    public get lastPreviousId() {
        return this._data.lastPreviousId;
    }

    public get lastDate() {
        return this._data.lastDate;
    }
}
