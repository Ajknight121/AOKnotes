# AOKnotes — Local-First Cross-Platform Notes App

A privacy-first, local-first notes application built with **TypeScript** and **React** across **Web (`apps/web`)**, **Phone (`apps/mobile`)**, and a **Personal PC Companion Daemon (`apps/pc-daemon`)**, powered by a shared core engine (`packages/core`).

---

## Project Folder Structure

```text
AOKnotes/
├── package.json                  # Root monorepo scripts & npm workspace definitions
├── pnpm-workspace.yaml           # Workspace configuration for pnpm compatibility
├── tsconfig.base.json            # Shared strict TypeScript compiler configuration
├── .gitignore                    # Git ignore rules for node_modules, builds, Expo & local vaults
│
├── packages/
│   └── core/                     # @aoknotes/core — Shared platform-agnostic TypeScript engine
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts          # Barrel exports & createNewNote() factory
│           ├── types.ts          # Domain models (Note, SafeConfig, NoteVersionDelta, BackupProvider)
│           ├── chunkedDocument.ts# Unlimited character line/block chunking & 60fps virtualizer indexing
│           ├── versioning.ts     # 400ms AutosaveController + exit flush & reverse-delta history compaction
│           ├── cryptoLock.ts     # Unified "Safe" AES-256-GCM encryption, single-login session, PIN setup/reset
│           ├── trashAndSnooze.ts # Soft delete (Trash), Snooze Delete presets & automatic return watchdog
│           ├── exportEngine.ts   # Clipboard copy & file exporters (.md, .txt, .html, .aok.json)
│           ├── backupProviders.ts# HLC delta merge, PersonalPcSyncProvider & PluggableCloudBackupProvider
│           └── core.test.ts      # Vitest unit test suite for all core engines
│
└── apps/
    ├── web/                      # @aoknotes/web — React + Vite Web & Desktop Browser Application
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── vite.config.ts
    │   ├── index.html
    │   └── src/
    │       ├── main.tsx          # React DOM entry point
    │       ├── App.tsx           # Main workspace board, tabs (Notes, Safe, Trash), PC auto-sync & exit flush
    │       ├── styles.css        # Responsive Google Keep-inspired styling
    │       ├── storage/
    │       │   └── db.ts         # Local IndexedDB persistence + synchronous beforeunload/pagehide exit flush
    │       ├── security/
    │       │   └── webBiometrics.ts # WebAuthn platform authenticator (TouchID / Windows Hello / Passkey)
    │       └── components/
    │           ├── VirtualizedNoteEditor.tsx # @tanstack/react-virtual editor for unlimited-length notes
    │           ├── VersionHistoryDrawer.tsx  # Delta version timeline, storage savings & 1-click restore
    │           ├── SafeVaultView.tsx         # Unified "Safe" view unlocked once per session via PIN/Biometrics
    │           ├── FirstTimePinModal.tsx     # Prompt to create a new Safe PIN on first page lock
    │           ├── SettingsModal.tsx         # Safe PIN change/reset panel & local storage diagnostics
    │           ├── BackupAndSyncModal.tsx    # Selectable Personal PC & pluggable Cloud backup configuration
    │           └── TrashAndSnoozeView.tsx    # Recently Deleted & Snooze-Deleted live countdown cards
    │
    ├── mobile/                   # @aoknotes/mobile — Expo (SDK 58) + React Native Phone App (iOS & Android)
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── app.json              # Expo app manifest (FaceID / Biometric permissions & bundle identifiers)
    │   ├── metro.config.js       # Monorepo Metro bundler config watching packages/core
    │   ├── index.ts              # Expo root component registration entry point
    │   ├── App.tsx               # Global safe-area shell, mobile tabs (Notes, Safe, Trash, Settings)
    │   └── src/
    │       ├── components/
    │       │   └── MobileVirtualizedEditor.tsx # FlatList virtualized block editor + AppState exit flush
    │       ├── security/
    │       │   └── biometricAuth.ts # expo-local-authentication (FaceID/TouchID/Biometrics) + expo-secure-store
    │       └── utils/
    │           └── mobileExport.ts  # Native phone clipboard, file sharing & "Send to Personal PC" over LAN
    │
    └── pc-daemon/                # @aoknotes/pc-daemon — Personal PC Local Sync & Backup Companion Server
        ├── package.json
        ├── tsconfig.json
        └── src/
            ├── cli.ts            # CLI launcher printing LAN IP endpoints & local vault path
            ├── server.ts         # HTTP + SSE server for auto LAN sync, manual snapshots & desktop file drops
            └── server.test.ts    # Integration tests for PC delta sync, snapshots & share-to-desktop
```

---

## Architecture Breakdown by Package

### 1. `packages/core` (`@aoknotes/core`)
The shared TypeScript brain imported by the Web App, Mobile App, and PC Daemon:
- **Unlimited-Length Document Chunking (`chunkedDocument.ts`)**: Splits multi-megabyte notes into indexed `DocumentBlock` rows so virtualized UI lists only mount visible lines.
- **Autosave & Space-Saving Versioning (`versioning.ts`)**: Debounces keystrokes (`400ms`), flushes immediately on app exit (`flushNow()`), computes compact line-level reverse diffs, guarantees at least 5 recent versions on files of any size, and compacts older checkpoints into `recent`, `daily`, and `weekly` time buckets.
- **Unified "Safe" Encryption (`cryptoLock.ts`)**: Encrypts locked notes with a single 256-bit Safe Master Key (`AES-256-GCM` + `PBKDF2-HMAC-SHA256`), unlocking all Safe notes for the active session with one PIN or biometric login.
- **Trash & Snooze Delete (`trashAndSnooze.ts`)**: Manages soft-deleted notes (`trashed`) and temporarily deleted notes (`snooze_deleted`) that automatically return to `active` once `Date.now() >= snoozeUntil`.
- **Pluggable Backup & Sync (`backupProviders.ts`)**: Provides deterministic Hybrid Logical Clock (`HLC`) merging across devices, `PersonalPcSyncProvider` for local LAN sync, and `PluggableCloudBackupProvider` for user-owned cloud storage (WebDAV/S3/Drive) or self-hostable REST backends.

### 2. `apps/web` (`@aoknotes/web`)
Vite + React 19 web application designed for desktop and mobile browsers:
- Persists all notes locally in **IndexedDB** (`storage/db.ts`) with automatic emergency flush on tab hide or window close.
- Renders massive notes at 60fps with `@tanstack/react-virtual` (`VirtualizedNoteEditor.tsx`) and includes a built-in **+500K Chars Stress Test** generator.

### 3. `apps/mobile` (`@aoknotes/mobile`)
Expo SDK 58 + React Native mobile application for iOS and Android:
- Wraps the entire app in `<GlobalAppSafeShell>` (`react-native-safe-area-context`) so no content renders under the phone's front camera, notch, Dynamic Island, or bottom gesture bar.
- Uses `expo-local-authentication` and `expo-secure-store` for hardware biometric Safe unlocking plus custom PIN setup and reset in Settings.
- Listens to React Native `AppState` (`background` / `inactive`) to flush unsaved note edits immediately when leaving the app.

### 4. `apps/pc-daemon` (`@aoknotes/pc-daemon`)
Lightweight Node.js service that runs on the user's Personal PC (default port `4545`):
- Automatically syncs with the Web and Mobile apps over local Wi-Fi/LAN while the PC is powered on (`POST /api/sync`).
- Creates timestamped one-time full backup snapshots (`POST /api/backup/snapshot` -> `~/.aoknotes-pc-vault/snapshots/`).
- Receives exported notes sent directly from the phone or browser (`POST /api/share-to-desktop` -> `~/.aoknotes-pc-vault/shared-from-device/`).

---

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

---

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
