/**
 * The base class for all custom errors thrown by mapping functions.
 * It provides a common type for catching all mapper-related issues.
 */
export class MapperError extends Error {
    constructor(message?: string) {
        super(message);
        this.name = 'MapperError';
    }
}

/**
 * Specific error thrown when the 'Any' mapper fails to determine
 * the required typeUrl for a Protobuf class.
 */
export class AnyMapperTypeResolutionError extends MapperError {
    constructor() {
        super('Cannot determine typeUrl. Pass typeUrl explicitly or register the protoClass.');
        this.name = 'AnyMapperTypeResolutionError';
    }
}
