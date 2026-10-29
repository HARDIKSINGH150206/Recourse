import type { Hex } from "viem";
import { RecourseError, type LogEntry } from "@recourse/shared";
import type { EvidencePort } from "../ports.js";

/** HTTP client for the gateway (docs/04 section 2.2). */
export class HttpEvidenceClient implements EvidencePort {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 15_000,
    private readonly maxBlobBytes = 5_000_000,
  ) {}

  private async request(path: string, init?: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(new URL(path, this.baseUrl), {
        ...init,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new RecourseError("upstream_error", `gateway unreachable: ${(e as Error).message}`);
    }
  }

  async flush(): Promise<void> {
    const r = await this.request("/log/flush", { method: "POST" });
    if (!r.ok) throw new RecourseError("upstream_error", `gateway flush failed with ${r.status}`);
  }

  async getBundle(requestId: Hex): Promise<unknown> {
    const r = await this.request(`/evidence/${requestId}`);
    if (!r.ok)
      throw new RecourseError(
        "upstream_error",
        `gateway returned ${r.status} for the evidence bundle`,
      );
    return r.json();
  }

  async getBlob(bodyHash: Hex): Promise<Uint8Array | null> {
    const r = await this.request(`/evidence/blob/${bodyHash}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new RecourseError("upstream_error", `gateway returned ${r.status} for a blob`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length > this.maxBlobBytes)
      throw new RecourseError("upstream_error", "blob too large");
    return bytes;
  }

  async getBatchEntries(batchIndex: number): Promise<LogEntry[] | null> {
    const r = await this.request(`/log/batches/${batchIndex}`);
    if (r.status === 404) return null;
    if (!r.ok)
      throw new RecourseError("upstream_error", `gateway returned ${r.status} for a batch`);
    return ((await r.json()) as { entries: LogEntry[] }).entries;
  }
}
