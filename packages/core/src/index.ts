export * from './types';
export * from './chunkedDocument';
export * from './versioning';
export * from './cryptoLock';
export * from './trashAndSnooze';
export * from './exportEngine';
export * from './backupProviders';

import { Note } from './types';
import { advanceHlcTimestamp } from './backupProviders';

export const NOTE_PALETTE_COLORS = [
  '#ffffff', // Default Slate White
  '#fef3c7', // Warm Amber
  '#dcfce7', // Mint Green
  '#dbeafe', // Sky Blue
  '#f3e8ff', // Soft Lavender
  '#ffe4e6', // Rose Pink
];

export function createNewNote(params: {
  id?: string;
  title?: string;
  content?: string;
  color?: string;
  tags?: string[];
  pinned?: boolean;
  deviceId?: string;
  inSafe?: boolean;
  now?: number;
}): Note {
  const now = params.now ?? Date.now();
  const deviceId = params.deviceId ?? 'dev-local';
  const content = params.content ?? '';
  const id = params.id ?? `note-${now}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id,
    title: params.title ?? '',
    content,
    preview: params.inSafe ? '🔒 Protected in Safe' : content.slice(0, 140),
    color: params.color ?? NOTE_PALETTE_COLORS[0],
    pinned: params.pinned ?? false,
    tags: params.tags ?? [],
    status: 'active',
    createdAt: now,
    updatedAt: now,
    hlcTimestamp: advanceHlcTimestamp(deviceId, undefined, now),
    deviceId,
    lock: {
      inSafe: params.inSafe ?? false,
      isEncryptedAtRest: false,
    },
    versions: [],
  };
}
