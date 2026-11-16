/** Base error that maps 1:1 to an OpenAI-style error response. */
export class PaiError extends Error {
  constructor(
    message: string,
    readonly status: number = 500,
    readonly type: string = "api_error",
    readonly code: string | null = null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class UnauthorizedError extends PaiError {
  constructor() {
    super(
      "Invalid or missing API key.",
      401,
      "authentication_error",
      "invalid_api_key",
    );
  }
}

export class BadRequestError extends PaiError {
  constructor(message: string, code = "invalid_request") {
    super(message, 400, "invalid_request_error", code);
  }
}

export class ModelNotFoundError extends PaiError {
  constructor(model: string, available: readonly string[]) {
    super(
      `The model '${model}' does not exist. Available providers: ${available.join(", ") || "none"}.`,
      404,
      "invalid_request_error",
      "model_not_found",
    );
  }
}

export class AccountNotFoundError extends PaiError {
  constructor(provider: string, account: string, available: readonly string[]) {
    super(
      `Account '${account}' does not exist for '${provider}' (known: ${available.join(", ")}). ` +
        `Create it with: pnpm auth ${provider} --account ${account}`,
      404,
      "invalid_request_error",
      "account_not_found",
    );
  }
}

export class ProviderTimeoutError extends PaiError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 504, "api_error", "provider_timeout", options);
  }
}

export class ProviderAutomationError extends PaiError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 502, "api_error", "provider_error", options);
  }
}

export function normalizeError(error: unknown): PaiError {
  if (error instanceof PaiError) return error;

  // body-parser and friends attach a 4xx `status` to their errors.
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status: unknown }).status;
    if (typeof status === "number" && status >= 400 && status < 500) {
      const message = error instanceof Error ? error.message : "Bad request";
      return new PaiError(
        message,
        status,
        "invalid_request_error",
        "bad_request",
      );
    }
  }
  return new PaiError(
    "Internal server error",
    500,
    "api_error",
    "internal_error",
    { cause: error },
  );
}

export function toErrorBody(error: PaiError): {
  error: { message: string; type: string; param: null; code: string | null };
} {
  return {
    error: {
      message: error.message,
      type: error.type,
      param: null,
      code: error.code,
    },
  };
}
