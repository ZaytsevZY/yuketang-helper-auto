export function deadlineFromLimit(startTime, limit) {
  const start = Number(startTime);
  const seconds = Number(limit);
  if (!Number.isFinite(start) || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return start + seconds * 1000;
}

export function isDeadlineReached(endTime, now = Date.now()) {
  return Number.isFinite(endTime) && now >= endTime;
}

export function remainingSeconds(endTime, now = Date.now()) {
  return Number.isFinite(endTime)
    ? Math.max(0, Math.floor((endTime - now) / 1000))
    : null;
}
