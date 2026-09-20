export interface WebProbeEvidence {
  readonly sourceUrl: string;
  readonly line: number;
  readonly column: number;
  readonly offset: number;
  readonly snippet: string;
}

export interface WebProbeFinding {
  readonly kind: 'route' | 'api' | 'path';
  readonly path: string;
  readonly name: string | null;
  readonly method: string | null;
  readonly parameters: readonly string[];
  readonly parent: string | null;
  readonly evidence: WebProbeEvidence;
}

export interface WebProbeAsset {
  readonly url: string;
  readonly discoveredBy: 'page' | 'loaded' | 'import' | 'webpack';
  readonly status: 'pending' | 'analyzed' | 'error';
  readonly bytes: number | null;
  readonly sha256: string | null;
  readonly error: string | null;
}

export interface WebProbeReport {
  readonly version: 1;
  readonly pageUrl: string;
  readonly analyzedAt: string;
  readonly assets: readonly WebProbeAsset[];
  readonly findings: readonly WebProbeFinding[];
  readonly observed: readonly {
    method: string;
    url: string;
    statusCode: number | null;
    parameters: readonly string[];
  }[];
  readonly warnings: readonly string[];
  readonly probes: readonly WebProbeResponse[];
}

export interface WebProbeResponse {
  readonly url: string;
  readonly timestamp: string;
  readonly statusCode: number;
  readonly durationMs: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly truncated: boolean;
}

export interface WebProbeRequest {
  readonly url: string;
  /** Optional environment-specific header; cookies stay in the browser session. */
  readonly xtbz?: string;
}
