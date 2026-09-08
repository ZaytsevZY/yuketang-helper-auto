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
  readonly #observers = new Map<number, ElectronNetworkObserver>();
  readonly #lessonCollector: BrowserLessonCollector | undefined;
  #lastDroppedEntries = 0;
  #started = false;
  #deepCapture = false;
  #sessionObserverId: number | null = null;

  constructor(
    contents: WebContents,
    private readonly onEntry: (entry: NetworkEntry) => void,
    private readonly onStateChanged: (state: NetworkCaptureState) => void,
    lessonCollector?: BrowserLessonCollector,
  ) {
    this.#lessonCollector = lessonCollector;
    this.attach(contents);
    this.recorder.subscribe((entry) => this.handleEntry(entry));
  }

  async start(): Promise<void> {
    this.#started = true;
    await Promise.all(
      [...this.#observers.values()].map((observer) => observer.start()),
    );
  }

  attach(contents: WebContents): void {
    if (this.#observers.has(contents.id)) return;
    const capturesSession = this.#sessionObserverId === null;
    if (capturesSession) this.#sessionObserverId = contents.id;
    const observer = new ElectronNetworkObserver(
      contents,
      this.recorder,
      () => this.emitState(),
      this.#lessonCollector,
      capturesSession,
    );
    this.#observers.set(contents.id, observer);
    contents.once('destroyed', () => {
      if (contents.id !== this.#sessionObserverId) {
        this.#observers.delete(contents.id);
      }
    });
    if (this.#started) {
      void observer
        .start()
        .then(async () => {
          if (this.#deepCapture) await observer.setDeepCapture(true);
          this.emitState();
        })
        .catch(() => this.emitState());
    }
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
    this.#deepCapture = enabled;
    await Promise.all(
      [...this.#observers.values()].map((observer) =>
        observer.setDeepCapture(enabled),
      ),
    );
    this.emitState();
  }

  clear(): void {
    this.recorder.clear();
    this.#lastDroppedEntries = 0;
    this.emitState();
  }

  destroy(): void {
    for (const observer of this.#observers.values()) observer.destroy();
    this.#observers.clear();
  }

  private getState(): NetworkCaptureState {
    return {
      paused: this.recorder.paused,
      deepCapture: this.#deepCapture,
      deepCaptureAvailable: true,
      deepCaptureError:
        [...this.#observers.values()]
          .map((observer) => observer.deepCaptureError)
          .find((error) => error !== null) ?? null,
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
