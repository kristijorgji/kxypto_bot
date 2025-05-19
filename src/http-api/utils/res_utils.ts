type CodeValidationError = {
    code: string;
};

export function errorResponse(err: CodeValidationError): {
    error: CodeValidationError;
} {
    return {
        error: err,
    };
}
