export type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "not_found"
  | "conflict"
  | "payment_required"
  | "upstream_error"
  | "evidence_invalid"
  | "internal";

export interface ApiErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

const HTTP_STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  payment_required: 402,
  not_found: 404,
  conflict: 409,
  evidence_invalid: 422,
  upstream_error: 502,
  internal: 500,
};

export class RecourseError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "RecourseError";
  }

  get status(): number {
    return HTTP_STATUS[this.code];
  }

  toBody(): ApiErrorBody {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}
