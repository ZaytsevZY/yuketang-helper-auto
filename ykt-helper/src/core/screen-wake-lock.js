function defaultNavigator() {
  if (typeof window !== 'undefined') return window.navigator;
  return typeof globalThis !== 'undefined' ? globalThis.navigator : null;
}

function defaultDocument() {
  return typeof document !== 'undefined' ? document : null;
}

function defaultLocation() {
  return typeof window !== 'undefined' ? window.location : null;
}

export function isClassroomPath(pathname = '') {
  return /\/lesson\/fullscreen\/v3(?:\/|$)|\/v2\/web\/lesson(?:\/|$)|\/m\/v2(?:\/|$)/.test(pathname);
}

export function createScreenWakeLock({
  getNavigator = defaultNavigator,
  getDocument = defaultDocument,
  getLocation = defaultLocation,
  onStatus = () => {},
} = {}) {
  let enabled = false;
  let sentinel = null;
  let pendingRequest = null;
  let observedDocument = null;

  const report = (active, reason, error) => {
    const status = { active, reason };
    if (error) status.error = error;
    try { onStatus(status); } catch {}
    return status;
  };

  const getPathname = () => getLocation()?.pathname || '';
  const isVisible = () => {
    const doc = getDocument();
    return !!doc && doc.hidden !== true && doc.visibilityState !== 'hidden';
  };

  const inactiveReason = () => {
    if (!enabled) return 'disabled';
    if (!isClassroomPath(getPathname())) return 'not-classroom';
    if (!isVisible()) return 'hidden';
    const wakeLock = getNavigator()?.wakeLock;
    if (!wakeLock || typeof wakeLock.request !== 'function') return 'unsupported';
    return 'released';
  };

  const releaseSentinel = async () => {
    const current = sentinel;
    sentinel = null;
    if (!current || typeof current.release !== 'function') return;
    try {
      await current.release();
    } catch {}
  };

  const onVisibilityChange = () => {
    void sync();
  };

  const observeVisibility = () => {
    const doc = getDocument();
    if (!doc || doc === observedDocument || typeof doc.addEventListener !== 'function') return;
    if (observedDocument && typeof observedDocument.removeEventListener === 'function') {
      observedDocument.removeEventListener('visibilitychange', onVisibilityChange);
    }
    observedDocument = doc;
    doc.addEventListener('visibilitychange', onVisibilityChange);
  };

  const attachSentinel = current => {
    if (!current || typeof current.addEventListener !== 'function') return;
    current.addEventListener('release', () => {
      if (sentinel === current) {
        sentinel = null;
        report(false, 'released');
      }
    });
  };

  async function sync() {
    observeVisibility();

    const reason = inactiveReason();
    if (reason !== 'released') {
      await releaseSentinel();
      return report(false, reason);
    }

    if (sentinel && sentinel.released !== true) return report(true, 'active');
    sentinel = null;
    if (pendingRequest) return pendingRequest;

    const requestPromise = Promise.resolve().then(async () => {
      try {
        let requested;
        try {
          requested = await getNavigator().wakeLock.request('screen');
        } catch (error) {
          return report(false, 'request-failed', error);
        }

        // Settings, route, or visibility may change while the browser shows its
        // permission prompt. Never retain a sentinel that is no longer eligible.
        const afterRequestReason = inactiveReason();
        if (afterRequestReason !== 'released') {
          try { await requested?.release?.(); } catch {}
          return report(false, afterRequestReason);
        }

        sentinel = requested;
        attachSentinel(requested);
        return report(true, 'active');
      } finally {
        // Clear before callers observe completion, so an immediately released
        // sentinel can always be reacquired by the next sync().
        if (pendingRequest === requestPromise) pendingRequest = null;
      }
    });

    pendingRequest = requestPromise;
    return requestPromise;
  }

  async function setEnabled(nextEnabled) {
    enabled = !!nextEnabled;
    return sync();
  }

  async function dispose() {
    enabled = false;
    if (observedDocument && typeof observedDocument.removeEventListener === 'function') {
      observedDocument.removeEventListener('visibilitychange', onVisibilityChange);
    }
    observedDocument = null;
    await releaseSentinel();
  }

  return {
    setEnabled,
    sync,
    dispose,
    getState() {
      return { enabled, active: !!sentinel && sentinel.released !== true };
    },
  };
}

export const screenWakeLock = createScreenWakeLock();
