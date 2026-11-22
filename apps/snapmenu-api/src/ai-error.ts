/** Stable app error codes; provider response bodies and credentials never reach logs or clients. */
export class AiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message)
  }
}
