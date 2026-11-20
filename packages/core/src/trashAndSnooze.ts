import { Note } from './types';

/**
 * Deleting, Recently Deleted (Trash), and Snooze Delete Engine.
 *
 * Supports:
 * 1. Standard Soft Delete (`softDeleteNote`) -> moves note to Recently Deleted (`trashed`),
 *    where it stays for 30 days before automatic purge.
 * 2. Snooze Delete (`snoozeDeleteNote`) -> deletes the note from the active view into a
 *    snooze-deleted state with a `snoozeUntil` timestamp. When `now >= note.snoozeUntil`,
 *    `processSnoozeAndTrashLifecycle` automatically brings the deleted note back to `active`!
 */

export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SnoozePreset {
  id: string;
  label: string;
  description: string;
  durationMs: number;
}

export const SNOOZE_DELETE_PRESETS: SnoozePreset[] = [
  {
    id: 'demo-15s',
    label: '15 Seconds (Demo)',
    description: 'Brings deleted note back in 15 seconds',
    durationMs: 15 * 1000,
  },
  {
    id: '1-hour',
    label: 'In 1 Hour',
    description: 'Temporarily delete for 1 hour',
    durationMs: 60 * 60 * 1000,
  },
  {
    id: 'tomorrow',
    label: 'Tomorrow (24h)',
    description: 'Bring back tomorrow at this time',
    durationMs: 24 * 60 * 60 * 1000,
  },
  {
    id: '3-days',
    label: 'In 3 Days',
    description: 'Bring back in 3 days',
    durationMs: 3 * 24 * 60 * 60 * 1000,
  },
  {
    id: 'next-week',
    label: 'In 1 Week',
    description: 'Bring back next week',
    durationMs: 7 * 24 * 60 * 60 * 1000,
  },
];

export function softDeleteNote(note: Note, now = Date.now()): Note {
  return {
    ...note,
    status: 'trashed',
    deletedAt: now,
    snoozeUntil: undefined,
    updatedAt: now,
  };
}

export function snoozeDeleteNote(
  note: Note,
  snoozeUntilTimestamp: number,
  now = Date.now()
): Note {
  return {
    ...note,
    status: 'snooze_deleted',
    deletedAt: now,
    snoozeUntil: snoozeUntilTimestamp,
    updatedAt: now,
  };
}

export function restoreDeletedNote(note: Note, now = Date.now()): Note {
  return {
    ...note,
    status: 'active',
    deletedAt: undefined,
    snoozeUntil: undefined,
    updatedAt: now,
  };
}

export interface LifecycleProcessReport {
  notes: Note[];
  restoredFromSnooze: Note[];
  purgedNoteIds: string[];
  changed: boolean;
}

/**
 * Evaluates all notes against `now`:
 * - Any `snooze_deleted` note whose `snoozeUntil <= now` is automatically restored to `active`
 *   and flagged with `restoredFromSnoozeAt = now`.
 * - Any `trashed` note whose `deletedAt` is older than 30 days is permanently purged.
 */
export function processSnoozeAndTrashLifecycle(
  notes: Note[],
  now = Date.now()
): LifecycleProcessReport {
  const nextNotes: Note[] = [];
  const restoredFromSnooze: Note[] = [];
  const purgedNoteIds: string[] = [];
  let changed = false;

  for (const note of notes) {
    if (
      note.status === 'snooze_deleted' &&
      typeof note.snoozeUntil === 'number' &&
      now >= note.snoozeUntil
    ) {
      const restored: Note = {
        ...note,
        status: 'active',
        deletedAt: undefined,
        snoozeUntil: undefined,
        restoredFromSnoozeAt: now,
        updatedAt: now,
      };
      nextNotes.push(restored);
      restoredFromSnooze.push(restored);
      changed = true;
      continue;
    }

    if (
      note.status === 'trashed' &&
      typeof note.deletedAt === 'number' &&
      now - note.deletedAt >= TRASH_RETENTION_MS
    ) {
      purgedNoteIds.push(note.id);
      changed = true;
      continue;
    }

    nextNotes.push(note);
  }

  return {
    notes: nextNotes,
    restoredFromSnooze,
    purgedNoteIds,
    changed,
  };
}

export function formatSnoozeRemaining(snoozeUntil: number, now = Date.now()): string {
  const remainingMs = Math.max(0, snoozeUntil - now);
  const totalSeconds = Math.ceil(remainingMs / 1000);
  if (totalSeconds <= 0) return 'Returning now...';
  if (totalSeconds < 60) return `${totalSeconds}s remaining`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    const secs = totalSeconds % 60;
    return `${totalMinutes}m ${secs}s remaining`;
  }
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    const mins = totalMinutes % 60;
    return `${totalHours}h ${mins}m remaining`;
  }
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return `${days}d ${hours}h remaining`;
}
