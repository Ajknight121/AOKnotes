import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Note, mergeNotesByHlc } from '@aoknotes/core';

export interface PcDaemonOptions {
  port?: number;
  vaultDir?: string;
  pairingToken?: string;
}

export interface SharedDesktopFileEntry {
  fileName: string;
  savedPath: string;
  sharedAt: number;
  title?: string;
}

export function getLocalLanAddresses(): string[] {
  const nets = os.networkInterfaces();
  const addresses: string[] = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses.length > 0 ? addresses : ['127.0.0.1'];
}

export function createPcDaemonServer(options: PcDaemonOptions = {}) {
  const vaultDir = options.vaultDir ?? path.join(os.homedir(), '.aoknotes-pc-vault');
  const snapshotsDir = path.join(vaultDir, 'snapshots');
  const sharedDir = path.join(vaultDir, 'shared-from-device');
  const notesFilePath = path.join(vaultDir, 'notes.json');

  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(snapshotsDir, { recursive: true });
  fs.mkdirSync(sharedDir, { recursive: true });

  const sseClients = new Set<http.ServerResponse>();
  const sharedHistory: SharedDesktopFileEntry[] = [];

  function readVaultNotes(): Note[] {
    if (!fs.existsSync(notesFilePath)) {
      return [];
    }
    try {
      const raw = fs.readFileSync(notesFilePath, 'utf8');
      return JSON.parse(raw) as Note[];
    } catch {
      return [];
    }
  }

  function writeVaultNotes(notes: Note[]): void {
    fs.writeFileSync(notesFilePath, JSON.stringify(notes, null, 2), 'utf8');
  }

  function broadcastEvent(eventName: string, payload: unknown): void {
    const data = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(data);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  function readJsonBody<T>(req: http.IncomingMessage): Promise<T> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve((text ? JSON.parse(text) : {}) as T);
        } catch (err) {
          reject(err);
        }
      });
      req.on('error', reject);
    });
  }

  const server = http.createServer(async (req, res) => {
    // Enable CORS for local Web & Mobile apps
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, DELETE, OPTIONS, PROPFIND'
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-AOK-Pairing-Token'
    );

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (options.pairingToken) {
      const provided = req.headers['x-aok-pairing-token'];
      if (provided !== options.pairingToken && req.url !== '/api/events') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid pairing token' }));
        return;
      }
    }

    const url = req.url?.split('?')[0] ?? '/';

    try {
      if (req.method === 'GET' && url === '/api/status') {
        const notes = readVaultNotes();
        const snapshots = fs.existsSync(snapshotsDir) ? fs.readdirSync(snapshotsDir) : [];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            online: true,
            hostname: os.hostname(),
            lanAddresses: getLocalLanAddresses(),
            vaultPath: vaultDir,
            noteCount: notes.length,
            snapshotCount: snapshots.length,
            sharedFiles: sharedHistory.slice(0, 10),
          })
        );
        return;
      }

      if (req.method === 'GET' && url === '/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write(`event: connected\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
      }

      if (req.method === 'POST' && (url === '/api/sync' || url === '/sync')) {
        const body = await readJsonBody<{ notes?: Note[]; cursor?: string }>(req);
        const incomingNotes = body.notes ?? [];
        const existingNotes = readVaultNotes();

        const { mergedNotes, pushedCount, pulledCount } = mergeNotesByHlc(
          incomingNotes,
          existingNotes
        );
        writeVaultNotes(mergedNotes);

        const syncedAt = Date.now();
        const cursor = `pc-cursor-${syncedAt}`;

        broadcastEvent('vault-synced', {
          syncedAt,
          noteCount: mergedNotes.length,
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            mergedNotes,
            cursor,
            pushedCount,
            pulledCount,
            syncedAt,
          })
        );
        return;
      }

      if (req.method === 'POST' && url === '/api/backup/snapshot') {
        const body = await readJsonBody<{ notes?: Note[]; requestedAt?: number }>(req);
        const notesToSave = body.notes ?? readVaultNotes();
        const now = Date.now();

        // Also update the live vault
        const { mergedNotes } = mergeNotesByHlc(notesToSave, readVaultNotes());
        writeVaultNotes(mergedNotes);

        const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
        const fileName = `backup-${stamp}.aok.json`;
        const snapshotPath = path.join(snapshotsDir, fileName);

        fs.writeFileSync(
          snapshotPath,
          JSON.stringify(
            {
              schema: 'aoknotes-pc-snapshot-v1',
              createdAt: now,
              hostname: os.hostname(),
              noteCount: notesToSave.length,
              notes: notesToSave,
            },
            null,
            2
          ),
          'utf8'
        );

        broadcastEvent('snapshot-created', { snapshotPath, syncedAt: now });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            syncedAt: now,
            snapshotPath,
            noteCount: notesToSave.length,
          })
        );
        return;
      }

      if (req.method === 'POST' && url === '/api/share-to-desktop') {
        const body = await readJsonBody<{
          fileName: string;
          content: string;
          noteId?: string;
          title?: string;
        }>(req);

        const safeFileName = path.basename(body.fileName || `shared-note-${Date.now()}.md`);
        const savedPath = path.join(sharedDir, safeFileName);
        fs.writeFileSync(savedPath, body.content ?? '', 'utf8');

        const entry: SharedDesktopFileEntry = {
          fileName: safeFileName,
          savedPath,
          sharedAt: Date.now(),
          title: body.title,
        };
        sharedHistory.unshift(entry);

        broadcastEvent('file-shared-to-desktop', entry);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ savedPath, fileName: safeFileName }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: err instanceof Error ? err.message : 'Internal server error',
        })
      );
    }
  });

  return {
    server,
    vaultDir,
    snapshotsDir,
    sharedDir,
    readVaultNotes,
  };
}
