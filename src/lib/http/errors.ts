export class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function jsonError(error: unknown, fallbackStatus = 500) {
  if (error instanceof HttpError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.status });
  }

  return Response.json(
    { error: "internal_error", message: "An unexpected error occurred." },
    { status: fallbackStatus },
  );
}
