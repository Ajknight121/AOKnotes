import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { PersonalPcSyncProvider, createNewNote } from '@aoknotes/core';
import { createPcDaemonServer } from './server.js';

describe('@aoknotes/pc-daemon — Personal PC Auto Sync, Manual Backup & Desktop Share', () => {
  let tempVaultDir: string;
  let daemon: ReturnType<typeof createPcDaemonServer>;
  let baseUrl: string;

  beforeEach(async () => {
    tempVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoknotes-pc-test-'));
    daemon = createPcDaemonServer({ vaultDir: tempVaultDir });
    await new Promise<void>((resolve) => {
      daemon.server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = daemon.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => daemon.server.close(() => resolve()));
    fs.rmSync(tempVaultDir, { recursive: true, force: true });
  });

  it('syncs notes automatically via PersonalPcSyncProvider, creates one-time snapshots, and shares files to desktop', async () => {
    const provider = new PersonalPcSyncProvider({
      id: 'pc-local-1',
      type: 'pc-local',
      displayName: 'My Personal PC',
      enabled: true,
      autoSyncWhenAvailable: true,
      endpointUrl: baseUrl,
      encryptBeforeUpload: false,
    });

    const status = await provider.testConnection();
    expect(status.online).toBe(true);

    const phoneNote = createNewNote({
      id: 'phone-note-1',
      title: 'Grocery & Hardware List',
      content: '- AA Batteries\n- Espresso beans',
      deviceId: 'phone-device',
    });

    // 1. Automatic delta sync while PC is on
    const syncOutcome = await provider.syncDelta([phoneNote]);
    expect(syncOutcome.result.pushedCount).toBe(1);
    expect(daemon.readVaultNotes()).toHaveLength(1);
    expect(daemon.readVaultNotes()[0].title).toBe('Grocery & Hardware List');

    // 2. Manual one-time snapshot backup
    const backupRes = await provider.manualOneTimeBackup([phoneNote]);
    expect(backupRes.mode).toBe('manual-onetime');
    expect(backupRes.snapshotPath).toBeDefined();
    expect(fs.existsSync(backupRes.snapshotPath!)).toBe(true);

    // 3. Direct Share with Desktop
    const shareRes = await provider.shareNoteToDesktop(phoneNote, 'md');
    expect(shareRes.fileName).toBe('grocery-hardware-list.md');
    expect(fs.existsSync(shareRes.savedPath)).toBe(true);
    const sharedFileContent = fs.readFileSync(shareRes.savedPath, 'utf8');
    expect(sharedFileContent).toContain('# Grocery & Hardware List');
  });
});
