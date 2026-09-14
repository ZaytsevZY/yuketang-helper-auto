import { NetworkRecorder, type NetworkCaptureProfile } from '@ykt/routing';

const MEBIBYTE = 1024 * 1024;

const DEVELOPMENT_CAPTURE_PROFILE: NetworkCaptureProfile = Object.freeze({
  mode: 'development',
  deepCaptureByDefault: true,
  responseBodyLimitBytes: 32 * MEBIBYTE,
  resourceBufferLimitBytes: 32 * MEBIBYTE,
  totalBufferLimitBytes: 128 * MEBIBYTE,
  postDataLimitBytes: 32 * MEBIBYTE,
  captureBinaryBodies: true,
});

/**
 * Unsafe recorder used only by an unpackaged desktop started with --debug.
 * It intentionally keeps credentials and bodies unchanged for parser work.
 */
export class DevelopmentNetworkRecorder extends NetworkRecorder {
  constructor() {
    super({ maxEntries: 10_000, maxBytes: 256 * MEBIBYTE });
  }

  override get captureProfile(): NetworkCaptureProfile {
    return DEVELOPMENT_CAPTURE_PROFILE;
  }

  protected override prepareHeaders(
    headers: Readonly<Record<string, string>>,
  ): Readonly<Record<string, string>> {
    return headers;
  }

  protected override prepareUrl(value: string): string {
    return value;
  }

  protected override prepareText(value: string): string {
    return value;
  }

  protected override prepareUnknown(value: unknown): unknown {
    return value;
  }
}

export function createDevelopmentNetworkRecorder(): NetworkRecorder {
  return new DevelopmentNetworkRecorder();
}
