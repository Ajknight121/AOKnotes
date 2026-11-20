import { LinePatchOp, Note, NoteVersionDelta, VersionBucket } from './types';

/**
 * Space-Conscious Delta Versioning & Autosave Controller.
 *
 * Key Guarantees:
 * 1. NEVER limits the size of a note (`note.content` has zero size cap).
 * 2. NEVER fails to save version history on large files:
 *    - Stores compact line-level reverse diffs (only the changed lines between versions).
 *    - ALWAYS preserves a guaranteed minimum number of recent versions (`MIN_GUARANTEED_VERSIONS = 5`)
 *      regardless of how large the file or edit delta is.
 *    - Compacts older versions beyond the minimum into time buckets (`recent`, `daily`, `weekly`).
 * 3. Supports both 400ms debounced autosave AND immediate lifecycle flush (`flushNow()`)
 *    when the user leaves the app, switches tabs, closes the window, or backgrounds the mobile app.
 */

export const MIN_GUARANTEED_VERSIONS = 5;
export const MAX_RECENT_BUCKET_VERSIONS = 8;
export const MAX_DAILY_BUCKET_VERSIONS = 7;
export const MAX_WEEKLY_BUCKET_VERSIONS = 4;

/**
 * Computes a compact reverse patch that transforms `newerText` back into `olderText`.
 * Finds common prefix and suffix lines in O(N) time and records only the changed interior slice,
 * so editing a few lines inside a 2MB file produces a tiny ~100-byte patch!
 */
export function computeReverseLinePatch(olderText: string, newerText: string): LinePatchOp[] {
  if (olderText === newerText) {
    return [];
  }

  const oldLines = olderText.split('\n');
  const newLines = newerText.split('\n');

  let prefixLen = 0;
  const minLen = Math.min(oldLines.length, newLines.length);
  while (prefixLen < minLen && oldLines[prefixLen] === newLines[prefixLen]) {
    prefixLen++;
  }

  let oldSuffixIdx = oldLines.length - 1;
  let newSuffixIdx = newLines.length - 1;
  while (
    oldSuffixIdx >= prefixLen &&
    newSuffixIdx >= prefixLen &&
    oldLines[oldSuffixIdx] === newLines[newSuffixIdx]
  ) {
    oldSuffixIdx--;
    newSuffixIdx--;
  }

  const deletedFromNewerCount = Math.max(0, newSuffixIdx - prefixLen + 1);
  const restoredOlderLines = oldLines.slice(prefixLen, oldSuffixIdx + 1);

  const ops: LinePatchOp[] = [];
  if (deletedFromNewerCount > 0 || restoredOlderLines.length > 0) {
    ops.push({
      type: restoredOlderLines.length > 0 ? 'insert' : 'delete',
      lineIndex: prefixLen,
      deletedCount: deletedFromNewerCount,
      lines: restoredOlderLines,
    });
  }

  return ops;
}

/**
 * Applies a reverse patch to `newerText` to reconstruct `olderText`.
 */
export function applyReverseLinePatch(newerText: string, serializedPatch: string): string {
  const ops: LinePatchOp[] = JSON.parse(serializedPatch);
  if (ops.length === 0) return newerText;

  const lines = newerText.split('\n');
  // Apply in reverse order of lineIndex if multiple ops exist
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i];
    const deleteCount = op.deletedCount ?? 0;
    const insertLines = op.lines ?? [];
    lines.splice(op.lineIndex, deleteCount, ...insertLines);
  }
  return lines.join('\n');
}

export function classifyVersionBucket(timestamp: number, now: number): VersionBucket {
  const ageMs = Math.max(0, now - timestamp);
  const ONE_HOUR = 60 * 60 * 1000;
  const ONE_DAY = 24 * ONE_HOUR;
  if (ageMs <= ONE_HOUR) return 'recent';
  if (ageMs <= 7 * ONE_DAY) return 'daily';
  return 'weekly';
}

/**
 * Reconstructs the full note content at any historical version ID by walking reverse patches
 * from the current head (`note.content`) back to `targetVersionId`.
 */
export function reconstructVersionContent(note: Note, targetVersionId: string): string | null {
  let workingText = note.content;
  // Versions are ordered newest-first (index 0 is the state right before current note.content)
  for (const version of note.versions) {
    workingText = applyReverseLinePatch(workingText, version.patch);
    if (version.id === targetVersionId) {
      return workingText;
    }
  }
  return null;
}

/**
 * Merges two adjacent reverse patches (where `newerDelta` transforms V2 -> V1
 * and `olderDelta` transforms V1 -> V0) into a single combined reverse patch (V2 -> V0)
 * given the intermediate text at V2 (`textAtNewerAfter`).
 */
function combineAdjacentDeltas(
  textAfterNewer: string,
  newerDelta: NoteVersionDelta,
  olderDelta: NoteVersionDelta,
  now: number
): NoteVersionDelta {
  const textAtV1 = applyReverseLinePatch(textAfterNewer, newerDelta.patch);
  const textAtV0 = applyReverseLinePatch(textAtV1, olderDelta.patch);
  const combinedOps = computeReverseLinePatch(textAtV0, textAfterNewer);
  const serialized = JSON.stringify(combinedOps);

  return {
    id: olderDelta.id,
    timestamp: olderDelta.timestamp,
    summary: olderDelta.summary,
    patch: serialized,
    byteSize: serialized.length,
    charCountAtVersion: olderDelta.charCountAtVersion,
    bucket: classifyVersionBucket(olderDelta.timestamp, now),
  };
}

/**
 * Records a new version delta when `previousContent` changes to `newContent` and compacts
 * older history so storage stays lean without EVER limiting file size or failing on huge notes.
 */
export function recordNoteVersionAndCompact(
  note: Note,
  previousContent: string,
  newContent: string,
  now = Date.now(),
  forceCheckpoint = false
): NoteVersionDelta[] {
  if (previousContent === newContent) {
    return note.versions;
  }

  const charDiff = Math.abs(newContent.length - previousContent.length);
  const newestExisting = note.versions[0];
  const timeSinceLastMs = newestExisting ? now - newestExisting.timestamp : Infinity;

  // Create a new version checkpoint if forced (e.g. on leaving app / manual save),
  // or if at least 20 seconds elapsed, or if >= 40 chars changed, or no versions exist yet.
  const shouldCreateNewDelta =
    forceCheckpoint ||
    !newestExisting ||
    timeSinceLastMs >= 20_000 ||
    charDiff >= 40;

  let updatedVersions: NoteVersionDelta[];

  if (shouldCreateNewDelta) {
    const ops = computeReverseLinePatch(previousContent, newContent);
    const patchStr = JSON.stringify(ops);
    const deltaCharSign = newContent.length >= previousContent.length ? '+' : '';
    const diffLen = newContent.length - previousContent.length;

    const newDelta: NoteVersionDelta = {
      id: `ver-${now}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: now,
      summary: `Edited (${deltaCharSign}${diffLen} chars)`,
      patch: patchStr,
      byteSize: patchStr.length,
      charCountAtVersion: previousContent.length,
      bucket: 'recent',
    };
    updatedVersions = [newDelta, ...note.versions];
  } else {
    // Coalesce into the top delta so rapid typing within 20 seconds updates the head delta cleanly
    const textBeforeTopDelta = applyReverseLinePatch(previousContent, newestExisting.patch);
    const ops = computeReverseLinePatch(textBeforeTopDelta, newContent);
    const patchStr = JSON.stringify(ops);
    const mergedTop: NoteVersionDelta = {
      ...newestExisting,
      patch: patchStr,
      byteSize: patchStr.length,
    };
    updatedVersions = [mergedTop, ...note.versions.slice(1)];
  }

  return compactVersionHistory(newContent, updatedVersions, now);
}

/**
 * Compacts version history by time buckets while ALWAYS keeping at least `MIN_GUARANTEED_VERSIONS`
 * recent versions regardless of file or delta size.
 */
export function compactVersionHistory(
  currentHeadContent: string,
  versions: NoteVersionDelta[],
  now = Date.now()
): NoteVersionDelta[] {
  if (versions.length <= MIN_GUARANTEED_VERSIONS) {
    return versions.map((v) => ({
      ...v,
      bucket: classifyVersionBucket(v.timestamp, now),
    }));
  }

  // Re-classify buckets based on current timestamp
  const classified = versions.map((v) => ({
    ...v,
    bucket: classifyVersionBucket(v.timestamp, now),
  }));

  // Walk from newest to oldest, tracking reconstructed text at each step so if we merge two
  // older versions in the same daily/weekly bucket, the reverse patch chain remains 100% exact.
  const result: NoteVersionDelta[] = [];
  let runningText = currentHeadContent;

  const seenDayKeys = new Set<string>();
  const seenWeekKeys = new Set<string>();
  let recentCount = 0;

  for (let i = 0; i < classified.length; i++) {
    const currentDelta = classified[i];
    const isGuaranteed = result.length < MIN_GUARANTEED_VERSIONS;

    if (isGuaranteed) {
      result.push(currentDelta);
      runningText = applyReverseLinePatch(runningText, currentDelta.patch);
      if (currentDelta.bucket === 'recent') recentCount++;
      continue;
    }

    const dateObj = new Date(currentDelta.timestamp);
    const dayKey = `${dateObj.getUTCFullYear()}-${dateObj.getUTCMonth()}-${dateObj.getUTCDate()}`;
    const weekKey = `${dateObj.getUTCFullYear()}-W${Math.floor(dateObj.getUTCDate() / 7)}`;

    let shouldFoldIntoPrevious = false;
    if (currentDelta.bucket === 'recent') {
      recentCount++;
      if (recentCount > MAX_RECENT_BUCKET_VERSIONS) {
        shouldFoldIntoPrevious = true;
      }
    } else if (currentDelta.bucket === 'daily') {
      if (seenDayKeys.has(dayKey) || seenDayKeys.size >= MAX_DAILY_BUCKET_VERSIONS) {
        shouldFoldIntoPrevious = true;
      } else {
        seenDayKeys.add(dayKey);
      }
    } else {
      if (seenWeekKeys.has(weekKey) || seenWeekKeys.size >= MAX_WEEKLY_BUCKET_VERSIONS) {
        shouldFoldIntoPrevious = true;
      } else {
        seenWeekKeys.add(weekKey);
      }
    }

    if (shouldFoldIntoPrevious && result.length > 0) {
      // Combine `result[result.length - 1]` and `currentDelta`
      const prevDelta = result[result.length - 1];
      // We need the text BEFORE `prevDelta` was applied; let's reconstruct from head up to result.length - 2
      let textBeforePrev = currentHeadContent;
      for (let k = 0; k < result.length - 1; k++) {
        textBeforePrev = applyReverseLinePatch(textBeforePrev, result[k].patch);
      }
      const combined = combineAdjacentDeltas(textBeforePrev, prevDelta, currentDelta, now);
      result[result.length - 1] = combined;
      runningText = applyReverseLinePatch(textBeforePrev, combined.patch);
    } else {
      result.push(currentDelta);
      runningText = applyReverseLinePatch(runningText, currentDelta.patch);
    }
  }

  return result;
}

/**
 * Autosave Controller with 400ms idle debounce AND immediate `flushNow()`
 * for app exit (`visibilitychange`, `pagehide`, `beforeunload`, Mobile `AppState`).
 */
export class AutosaveController {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pendingPayload: { noteId: string; title: string; content: string } | null = null;
  private readonly debounceMs: number;
  private readonly onCommit: (payload: {
    noteId: string;
    title: string;
    content: string;
    flushedOnExit: boolean;
  }) => void;

  constructor(
    onCommit: (payload: {
      noteId: string;
      title: string;
      content: string;
      flushedOnExit: boolean;
    }) => void,
    debounceMs = 400
  ) {
    this.onCommit = onCommit;
    this.debounceMs = debounceMs;
  }

  scheduleSave(noteId: string, title: string, content: string): void {
    this.pendingPayload = { noteId, title, content };
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.pendingPayload) {
        const toSave = this.pendingPayload;
        this.pendingPayload = null;
        this.onCommit({ ...toSave, flushedOnExit: false });
      }
    }, this.debounceMs);
  }

  /**
   * Immediately commits any pending edits (called when leaving the app, closing a tab,
   * switching notes, or backgrounding the mobile app).
   */
  flushNow(): boolean {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.pendingPayload) {
      return false;
    }
    const toSave = this.pendingPayload;
    this.pendingPayload = null;
    this.onCommit({ ...toSave, flushedOnExit: true });
    return true;
  }

  hasPendingChanges(): boolean {
    return this.pendingPayload !== null;
  }
}
