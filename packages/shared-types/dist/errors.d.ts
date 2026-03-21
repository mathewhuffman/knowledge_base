export declare enum AppErrorCode {
    UNKNOWN_COMMAND = "UNKNOWN_COMMAND",
    INVALID_REQUEST = "INVALID_REQUEST",
    INTERNAL_ERROR = "INTERNAL_ERROR",
    VALIDATION_ERROR = "VALIDATION_ERROR",
    NOT_FOUND = "NOT_FOUND",
    NOT_AUTHORIZED = "NOT_AUTHORIZED"
}
export interface AppError {
    code: AppErrorCode;
    message: string;
    details?: unknown;
}
