# AOKnotes — Local-First Cross-Platform Notes App

A privacy-first, local-first notes application built with **TypeScript** and **React** across **Web (`apps/web`)**, **Phone (`apps/mobile`)**, and a **Personal PC Companion Daemon (`apps/pc-daemon`)**, powered by a shared core engine (`packages/core`).

## Key Features

1. **Local-First on All Devices**
   - Web app stores all notes locally in **IndexedDB** (`apps/web/src/storage/db.ts`).
   - Mobile app stores notes locally on the phone (`apps/mobile`).
   - Personal PC daemon stores local vault files and snapshots in `~/.aoknotes-pc-vault`.

2. **Unlimited Character Limit & 60fps Virtualized Scrolling**
   - Uses `@aoknotes/core` chunked block indexing (`chunkedDocument.ts`) paired with `@tanstack/react-virtual` on Web and `FlatList` windowing on Mobile so notes with 500,000+ or 1,000,000+ characters scroll smoothly.
   - Includes a built-in **+500K Chars Stress Test** button and fast line scrubber inside the editor.

3. **Unified "Safe" Vault, Biometric Lock & Custom PIN Setup/Reset**
   - All locked notes are grouped together in the **Safe** (`note.lock.inSafe = true`) and encrypted at rest using `AES-256-GCM` + `PBKDF2-HMAC-SHA256`.
   - **Single Login per Session**: Entering the Safe requires only **one login** (via your Safe PIN or phone/device biometrics) to view and edit all notes inside the Safe.
   - **First-Time PIN Setup**: Locking a page for the first time prompts you to type a new Safe PIN (and optionally link hardware biometrics).
   - **Reset / Change PIN in Settings**: Change or reset your Safe PIN anytime in the **Settings** panel (`SettingsModal.tsx`).

4. **Autosaving (with App-Exit Flush) & Space-Conscious Version History**
   - **Debounced + Exit Flush**: Saves automatically after 400ms of idle typing **and immediately flushes pending changes when leaving the app** (`visibilitychange`, `pagehide`, `beforeunload` on Web, and `AppState` `background`/`inactive` on Mobile).
   - **Never Limits File Size or Drops History**: Stores compact line-level reverse diffs (`versioning.ts`), always guarantees at least the 5 most recent checkpoints regardless of file/edit size, and compacts older deltas into `recent`, `daily`, and `weekly` buckets.

5. **Deleting, Recently Deleted & Snooze Delete**
   - **Recently Deleted**: Soft-deleted notes remain recoverable for 30 days.
   - **Snooze Delete**: Temporarily delete a note (*15s Demo*, *1 Hour*, *Tomorrow*, *3 Days*, *1 Week*, or custom minutes) and have it **automatically return** to your active notes board when the timer expires.

6. **Exporting & Sharing with Desktop**
   - One-click **Copy to Clipboard**, export as `.md`, `.txt`, `.html`, or `.aok.json`, and **Send to Personal PC Desktop** over LAN.

7. **Selectable Backup Locations**
   - **Personal PC (Local Wi-Fi / LAN)**: Automatically syncs while your PC is on (`apps/pc-daemon`), or trigger a **One-Time Full Backup Snapshot** on demand.
   - **Pluggable Cloud Providers**: Connect **User's Own Cloud Storage** (WebDAV / S3 / Google Drive) or a **Self-Hostable Backend** (REST / Supabase) via the `BackupProvider` interface.

## Getting Started

```bash
# Install dependencies (supports npm workspaces or pnpm)
npm install

# Run unit & integration tests
npm test

# Start the Personal PC Companion Daemon (port 4545)
npm run dev:daemon

# Start the React Web App (port 5173)
npm run dev:web

# Start the Expo React Native Mobile App
npm run dev:mobile
```
