export class LintExecutionError extends Error {
  readonly exitCode = 2;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LintExecutionError";
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new LintExecutionError("Lint operation was aborted.", { cause: signal.reason });
}
