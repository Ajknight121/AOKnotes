import { describe, expect, it } from 'vitest';
import {
  AutosaveController,
  BiometricKeyringAdapter,
  PluggableCloudBackupProvider,
  buildDocumentBlocks,
  changeOrResetSafePin,
  computeDocumentStats,
  createNewNote,
  decryptSafeNoteForSession,
  exportNoteToFileArtifact,
  generateLargeNoteBenchmarkContent,
  mergeNotesByHlc,
  moveNoteToSafe,
  processSnoozeAndTrashLifecycle,
  reconstructVersionContent,
  recordNoteVersionAndCompact,
  removeNoteFromSafe,
  setupSafePin,
  snoozeDeleteNote,
  softDeleteNote,
  unlockSafeSessionWithBiometrics,
  unlockSafeSessionWithPin,
  updateDocumentBlock,
} from './index';

describe('@aoknotes/core — Unlimited Character Chunking & Virtualization Engine', () => {
  it('handles 1,000,000+ character notes with fast block indexing and incremental updates', () => {
    const massiveContent = generateLargeNoteBenchmarkContent(1_050_000);
    expect(massiveContent.length).toBeGreaterThan(1_000_000);

    const blocks = buildDocumentBlocks(massiveContent);
    expect(blocks.length).toBeGreaterThan(5_000);

    const updated = updateDocumentBlock(
      blocks,
      10,
      '## Edited Heading Inside 1M+ Char Note\nInserted second line smoothly'
    );
    expect(updated.blocks.length).toBe(blocks.length + 1);
    expect(updated.blocks[10].text).toBe('## Edited Heading Inside 1M+ Char Note');
    expect(updated.blocks[11].text).toBe('Inserted second line smoothly');

    const stats = computeDocumentStats(updated.content, updated.blocks.length);
    expect(stats.totalChars).toBeGreaterThan(1_000_000);
    expect(stats.totalWords).toBeGreaterThan(100_000);
  });
});

describe('@aoknotes/core — Autosave (including App Exit Flush) & Space-Saving Delta Versioning', () => {
  it('flushes pending edits immediately when leaving the app via flushNow()', () => {
    const committed: Array<{ noteId: string; title: string; content: string; flushedOnExit: boolean }> = [];
    const controller = new AutosaveController((payload) => {
      committed.push(payload);
    }, 5_000); // long debounce to prove flushNow commits immediately

    controller.scheduleSave('note-1', 'Draft Title', 'Unsaved body before closing app');
    expect(controller.hasPendingChanges()).toBe(true);
    expect(committed.length).toBe(0);

    const didFlush = controller.flushNow();
    expect(didFlush).toBe(true);
    expect(controller.hasPendingChanges()).toBe(false);
    expect(committed).toHaveLength(1);
    expect(committed[0].flushedOnExit).toBe(true);
    expect(committed[0].content).toBe('Unsaved body before closing app');
  });

  it('stores compact line-level reverse deltas and never limits file size or drops recent history on huge notes', () => {
    const baseHuge = generateLargeNoteBenchmarkContent(300_000);
    let note = createNewNote({
      id: 'huge-note',
      title: 'Huge Engineering Log',
      content: baseHuge,
      now: 1_000_000,
    });

    // Perform 8 consecutive edits on a 300KB file
    for (let step = 1; step <= 8; step++) {
      const prev = note.content;
      const next = prev + `\nLine added at step ${step}: additional notes and observations.`;
      const nextTime = 1_000_000 + step * 60_000;
      const versions = recordNoteVersionAndCompact(note, prev, next, nextTime, true);
      note = {
        ...note,
        content: next,
        updatedAt: nextTime,
        versions,
      };
    }

    // Verify all 8 versions are preserved and their total delta size is tiny (< 5KB vs 2.4MB of full snapshots!)
    expect(note.versions.length).toBe(8);
    const totalDeltaBytes = note.versions.reduce((sum, v) => sum + v.byteSize, 0);
    expect(totalDeltaBytes).toBeLessThan(5_000);

    // Reconstruct the exact initial 300KB content from the oldest version delta
    const oldestVersion = note.versions[note.versions.length - 1];
    const reconstructedOldest = reconstructVersionContent(note, oldestVersion.id);
    expect(reconstructedOldest).toBe(baseHuge);
  });
});

describe('@aoknotes/core — Unified "Safe" Vault, Single-Login Unlock, Biometrics & PIN Reset', () => {
  it('sets up a new PIN on first lock, unlocks multiple Safe notes with one login, and supports PIN reset in Settings', async () => {
    let savedBiometricKey: string | undefined;
    const mockBiometrics: BiometricKeyringAdapter = {
      isAvailable: async () => true,
      saveMasterKeyForBiometrics: async (rawKey) => {
        savedBiometricKey = rawKey;
        return 'bio-key-1';
      },
      unlockMasterKeyWithBiometrics: async () => savedBiometricKey ?? null,
      clearBiometricKey: async () => {
        savedBiometricKey = undefined;
      },
    };

    // 1. User first locks a page -> creates Safe PIN "4829" + enables biometrics
    const { config: initialSafeConfig, sessionMasterKey } = await setupSafePin('4829', {
      enableBiometrics: true,
      biometricAdapter: mockBiometrics,
    });
    expect(initialSafeConfig.isConfigured).toBe(true);
    expect(initialSafeConfig.biometricsEnabled).toBe(true);

    // 2. Move two notes into the Safe
    const noteA = createNewNote({ title: 'Passport & Recovery Codes', content: 'Secret code 111' });
    const noteB = createNewNote({ title: 'Bank Vault Info', content: 'Account 999' });

    const lockedA = await moveNoteToSafe(noteA, sessionMasterKey);
    const lockedB = await moveNoteToSafe(noteB, sessionMasterKey);

    expect(lockedA.lock.inSafe).toBe(true);
    expect(lockedA.lock.isEncryptedAtRest).toBe(true);
    expect(lockedA.content).not.toContain('Secret code 111');
    expect(lockedB.content).not.toContain('Account 999');

    // 3. Wrong PIN is rejected
    await expect(unlockSafeSessionWithPin('0000', initialSafeConfig)).rejects.toThrow(
      'Incorrect Safe PIN.'
    );

    // 4. Single PIN login unlocks the Safe session and decrypts all notes in the Safe
    const unlockedByPin = await unlockSafeSessionWithPin('4829', initialSafeConfig);
    const viewA = await decryptSafeNoteForSession(lockedA, unlockedByPin.sessionMasterKey);
    const viewB = await decryptSafeNoteForSession(lockedB, unlockedByPin.sessionMasterKey);
    expect(viewA.content).toBe('Secret code 111');
    expect(viewB.content).toBe('Account 999');

    // 5. Biometric login also unlocks the Safe session in one tap
    const unlockedByBio = await unlockSafeSessionWithBiometrics(initialSafeConfig, mockBiometrics);
    const viewABio = await decryptSafeNoteForSession(lockedA, unlockedByBio.sessionMasterKey);
    expect(viewABio.content).toBe('Secret code 111');

    // 6. Reset / Change PIN in Settings to "9988" -> existing Safe notes remain accessible under new PIN!
    const { config: updatedSafeConfig } = await changeOrResetSafePin('9988', initialSafeConfig, {
      currentPin: '4829',
    });
    await expect(unlockSafeSessionWithPin('4829', updatedSafeConfig)).rejects.toThrow();

    const unlockedWithNewPin = await unlockSafeSessionWithPin('9988', updatedSafeConfig);
    const viewAAfterPinChange = await decryptSafeNoteForSession(
      lockedA,
      unlockedWithNewPin.sessionMasterKey
    );
    expect(viewAAfterPinChange.content).toBe('Secret code 111');

    // 7. Removing a note from the Safe restores it to the main board unencrypted
    const removedA = await removeNoteFromSafe(lockedA, unlockedWithNewPin.sessionMasterKey);
    expect(removedA.lock.inSafe).toBe(false);
    expect(removedA.lock.isEncryptedAtRest).toBe(false);
    expect(removedA.content).toBe('Secret code 111');
  });
});

describe('@aoknotes/core — Deleting, Recently Deleted & Snooze Delete', () => {
  it('temporarily deletes a note with Snooze Delete and automatically restores it when the timer expires', () => {
    const now = 1_700_000_000_000;
    const activeNote = createNewNote({
      id: 'snooze-1',
      title: 'Check Seasonal Insurance Renewal',
      content: 'Bring this back in 3 days',
      now,
    });
    const trashedNote = softDeleteNote(
      createNewNote({ id: 'trash-1', title: 'Old Scratchpad', content: 'Delete me', now }),
      now
    );

    const snoozeUntil = now + 60_000; // 1 minute snooze delete
    const snoozed = snoozeDeleteNote(activeNote, snoozeUntil, now);
    expect(snoozed.status).toBe('snooze_deleted');

    // Halfway through snooze window -> still snooze_deleted
    const midCheck = processSnoozeAndTrashLifecycle([snoozed, trashedNote], now + 30_000);
    expect(midCheck.changed).toBe(false);
    expect(midCheck.restoredFromSnooze).toHaveLength(0);

    // After snoozeUntil expires -> automatically restored to active!
    const afterCheck = processSnoozeAndTrashLifecycle([snoozed, trashedNote], now + 61_000);
    expect(afterCheck.changed).toBe(true);
    expect(afterCheck.restoredFromSnooze).toHaveLength(1);
    expect(afterCheck.restoredFromSnooze[0].id).toBe('snooze-1');
    expect(afterCheck.restoredFromSnooze[0].status).toBe('active');
    expect(afterCheck.restoredFromSnooze[0].restoredFromSnoozeAt).toBe(now + 61_000);
  });
});

describe('@aoknotes/core — Exporting & Pluggable Backup / HLC Sync', () => {
  it('exports notes to Markdown, Plain Text, HTML, and AOK JSON and merges HLC sync deltas', async () => {
    const note = createNewNote({
      id: 'sync-1',
      title: 'Project Architecture',
      content: '- Local first\n- PC sync',
      tags: ['dev', 'local'],
      deviceId: 'phone-1',
      now: 1000,
    });

    const mdExport = exportNoteToFileArtifact(note, 'md');
    expect(mdExport.fileName).toBe('project-architecture.md');
    expect(mdExport.content).toContain('# Project Architecture');

    const newerRemote = {
      ...note,
      content: '- Local first\n- PC sync\n- Updated on PC',
      updatedAt: 2000,
      hlcTimestamp: '000000000002000-0000-pc-1',
    };

    const merged = mergeNotesByHlc([note], [newerRemote]);
    expect(merged.pulledCount).toBe(1);
    expect(merged.mergedNotes[0].content).toContain('Updated on PC');

    const cloudProvider = new PluggableCloudBackupProvider({
      id: 'cloud-1',
      type: 'user-cloud-webdav',
      displayName: 'User Own Cloud (WebDAV)',
      enabled: true,
      autoSyncWhenAvailable: false,
      endpointUrl: 'local-cloud-sim://webdav',
      encryptBeforeUpload: true,
    });

    const syncRes = await cloudProvider.syncDelta(merged.mergedNotes);
    expect(syncRes.result.pushedCount).toBe(1);
  });
});
