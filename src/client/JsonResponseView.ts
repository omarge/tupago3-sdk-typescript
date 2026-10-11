import {
  JsonResponse,
} from "../generated/tupago/api/v1/payment.js";

/**
 * Convenience view over the raw Banxico {@link JsonResponse} returned by status/create RPCs.
 * The SDK never assumes a fixed JSON shape (contract: lossless passthrough); callers may read
 * the raw string, parse to a tree, or bind to their own DTO.
 */
export class JsonResponseView {
  private readonly response: JsonResponse;

  constructor(response: JsonResponse) {
    this.response = response;
  }

  /** The raw JSON payload, exactly as returned by the backend. */
  json(): string {
    return this.response.json;
  }

  /** Parsed JSON value (throws if the payload is not valid JSON). */
  parsed(): unknown {
    return JSON.parse(this.response.json);
  }

  /** Bind the raw JSON to a caller-supplied type via JSON.parse + cast. */
  as<T>(): T {
    return JSON.parse(this.response.json) as T;
  }

  /** The underlying generated protobuf message. */
  raw(): JsonResponse {
    return this.response;
  }
}
