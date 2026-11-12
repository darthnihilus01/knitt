export type Support = "observed" | "documented" | "unverified" | "unsupported";

export interface ClientCapabilities {
  client: string;
  version: string | null;
  mcpTransport: Partial<Record<"stdio" | "streamableHttp", Support>>;
  automaticCapture: Support;
  automaticRecall: Support;
  evidence: readonly string[];
}
