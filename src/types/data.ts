type PlainFilterValue = string | number | boolean | undefined;

export interface PlainFilters extends Record<string, PlainFilterValue | Array<PlainFilterValue>> {}
