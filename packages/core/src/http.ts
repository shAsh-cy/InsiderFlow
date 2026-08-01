/**
 * Minimal structural HTTP types shared by adapters and runtimes.
 * Real fetch (Workers/Node), cached fetch wrappers, and test mocks all
 * satisfy these shapes.
 */
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<FetchLikeResponse>;

export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type Logger = (event: string, data?: Record<string, unknown>) => void;
