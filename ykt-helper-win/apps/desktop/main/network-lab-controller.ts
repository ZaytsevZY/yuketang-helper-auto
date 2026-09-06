import type { WebContents } from 'electron';
import type {
  NetworkCaptureState,
  NetworkEntry,
  NetworkFixture,
  NetworkSnapshot,
} from '@ykt/contracts';
import {
  type BrowserLessonCollector,
  createNetworkFixture,
  isRawNetworkEntry,
  NetworkRecorder,
  NormalizerPipeline,
} from '@ykt/routing';

import { ElectronNetworkObserver } from './electron-network-observer.js';

export class NetworkLabController {
  readonly recorder = new NetworkRecorder();
  readonly #normalizers = new NormalizerPipeline();
  readonly #observer: ElectronNetworkObserver;
  #lastDroppedEntries = 0;

  constructor(
    contents: WebContents,
    private readonly onEntry: (entry: NetworkEntry) => void,
    private readonly onStateChanged: (state: NetworkCaptureState) => void,
    lessonCollector?: BrowserLessonCollector,
  ) {
    this.#observer = new ElectronNetworkObserver(
      contents,
      this.recorder,
      () => this.emitState(),
      lessonCollector,
    );
    this.recorder.subscribe((entry) => this.handleEntry(entry));
  }

  async start(): Promise<void> {
    await this.#observer.start();
  }

  getSnapshot(): NetworkSnapshot {
    return { state: this.getState(), entries: this.recorder.entries };
  }

  getFixture(): NetworkFixture {
    return createNetworkFixture(this.recorder.entries);
  }

  setPaused(paused: boolean): void {
    this.recorder.setPaused(paused);
    this.emitState();
  }

  async setDeepCapture(enabled: boolean): Promise<void> {
    await this.#observer.setDeepCapture(enabled);
  }

  clear(): void {
    this.recorder.clear();
    this.#lastDroppedEntries = 0;
    this.emitState();
  }

  destroy(): void {
    this.#observer.destroy();
  }

  private getState(): NetworkCaptureState {
    return {
      paused: this.recorder.paused,
      deepCapture: this.#observer.deepCapture,
      deepCaptureAvailable: true,
      deepCaptureError: this.#observer.deepCaptureError,
      entryCount: this.recorder.entries.length,
      droppedEntries: this.recorder.droppedEntries,
    };
  }

  private handleEntry(entry: NetworkEntry): void {
    this.onEntry(entry);
    if (isRawNetworkEntry(entry)) {
      for (const event of this.#normalizers.normalize(entry)) {
        this.recorder.addDomain({
          source: entry.source,
          eventType: event.eventType,
          summary: event.summary,
          normalizerId: event.normalizerId,
          sourceEntryId: event.sourceEntryId,
          data: event.data,
          timestamp: entry.timestamp,
        });
      }
    }
    if (this.#lastDroppedEntries !== this.recorder.droppedEntries) {
      this.#lastDroppedEntries = this.recorder.droppedEntries;
      this.emitState();
    }
  }

  private emitState(): void {
    this.onStateChanged(this.getState());
  }
}
