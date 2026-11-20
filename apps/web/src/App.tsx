import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackupSyncResult,
  BackupTargetConfig,
  NOTE_PALETTE_COLORS,
  Note,
  PersonalPcSyncProvider,
  SafeConfig,
  advanceHlcTimestamp,
  changeOrResetSafePin,
  createBackupProvider,
  createNewNote,
  decryptSafeNoteForSession,
  encryptSafeNoteForStorage,
  moveNoteToSafe,
  processSnoozeAndTrashLifecycle,
  recordNoteVersionAndCompact,
  removeNoteFromSafe,
  restoreDeletedNote,
  setupSafePin,
  snoozeDeleteNote,
  softDeleteNote,
  unlockSafeSessionWithBiometrics,
  unlockSafeSessionWithPin,
} from '@aoknotes/core';
import {
  Cloud,
  FileText,
  Laptop,
  Lock,
  Pin,
  Plus,
  Search,
  Settings,
  Shield,
  Sparkles,
  Timer,
  Trash2,
} from 'lucide-react';
import {
  DEFAULT_BACKUP_TARGETS,
  DEFAULT_SAFE_CONFIG,
  flushNotesOnAppExit,
  loadAllLocalNotes,
  loadMetaValue,
  saveAllLocalNotes,
  saveMetaValue,
} from './storage/db.js';
import { WebBiometricKeyringAdapter } from './security/webBiometrics.js';
import { VirtualizedNoteEditor } from './components/VirtualizedNoteEditor.js';
import { VersionHistoryDrawer } from './components/VersionHistoryDrawer.js';
import { SafeVaultView } from './components/SafeVaultView.js';
import { FirstTimePinModal } from './components/FirstTimePinModal.js';
import { SettingsModal } from './components/SettingsModal.js';
import { BackupAndSyncModal } from './components/BackupAndSyncModal.js';
import { TrashAndSnoozeView } from './components/TrashAndSnoozeView.js';

type ActiveTab = 'notes' | 'safe' | 'trash';

export const App: React.FC = () => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [safeConfig, setSafeConfig] = useState<SafeConfig>(DEFAULT_SAFE_CONFIG);
  const [backupTargets, setBackupTargets] = useState<BackupTargetConfig[]>(DEFAULT_BACKUP_TARGETS);
  const [activeTab, setActiveTab] = useState<ActiveTab>('notes');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  // Quick Note Capture Bar State
  const [quickTitle, setQuickTitle] = useState('');
  const [quickContent, setQuickContent] = useState('');
  const [quickExpanded, setQuickExpanded] = useState(false);
  const [quickColor, setQuickColor] = useState(NOTE_PALETTE_COLORS[0]);

  // Active Modals & Drawers
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [historyNoteId, setHistoryNoteId] = useState<string | null>(null);
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [pendingFirstLockNote, setPendingFirstLockNote] = useState<Note | null>(null);
  const [showFirstPinModal, setShowFirstPinModal] = useState(false);

  // Unified Safe Session Key (Unlocked once per session to view all notes in Safe)
  const [safeSessionKey, setSafeSessionKey] = useState<CryptoKey | null>(null);
  const [decryptedSafeCache, setDecryptedSafeCache] = useState<Record<string, Note>>({});

  // Toast Notification
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [pcAutoSyncOnline, setPcAutoSyncOnline] = useState(false);

  const biometricAdapter = useMemo(() => new WebBiometricKeyringAdapter(), []);
  const notesRef = useRef<Note[]>(notes);
  notesRef.current = notes;

  const notify = useCallback((message: string) => {
    setToastMsg(message);
  }, []);

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 4000);
    return () => clearTimeout(t);
  }, [toastMsg]);

  // Initial Load from Local IndexedDB
  useEffect(() => {
    void (async () => {
      const [loadedNotes, loadedSafe, loadedTargets] = await Promise.all([
        loadAllLocalNotes(),
        loadMetaValue<SafeConfig>('safeConfig'),
        loadMetaValue<BackupTargetConfig[]>('backupTargets'),
      ]);
      setNotes(loadedNotes);
      if (loadedSafe) setSafeConfig(loadedSafe);
      if (loadedTargets && loadedTargets.length > 0) setBackupTargets(loadedTargets);
    })();
  }, []);

  // Persist notes locally whenever they change
  const persistNotes = useCallback((nextNotes: Note[]) => {
    setNotes(nextNotes);
    notesRef.current = nextNotes;
    void saveAllLocalNotes(nextNotes);
  }, []);

  // Guarantee saving contents when leaving the app (visibilitychange / pagehide / beforeunload)
  useEffect(() => {
    const handleLeaveApp = () => {
      if (quickTitle.trim() || quickContent.trim()) {
        const autoSavedQuick = createNewNote({
          title: quickTitle.trim() || 'Quick Note',
          content: quickContent,
          color: quickColor,
        });
        const merged = [autoSavedQuick, ...notesRef.current];
        flushNotesOnAppExit(merged);
        setQuickTitle('');
        setQuickContent('');
      } else {
        flushNotesOnAppExit(notesRef.current);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        handleLeaveApp();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handleLeaveApp);
    window.addEventListener('beforeunload', handleLeaveApp);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handleLeaveApp);
      window.removeEventListener('beforeunload', handleLeaveApp);
    };
  }, [quickTitle, quickContent, quickColor]);

  // Snooze-Delete & Trash Watchdog (checks every 1s to bring back snooze-deleted notes automatically)
  useEffect(() => {
    const interval = setInterval(() => {
      const report = processSnoozeAndTrashLifecycle(notesRef.current, Date.now());
      if (report.changed) {
        persistNotes(report.notes);
        if (report.restoredFromSnooze.length > 0) {
          const titles = report.restoredFromSnooze
            .map((n) => n.title || 'Untitled Note')
            .join(', ');
          notify(`⏰ Snooze finished! Restored back to Notes: ${titles}`);
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [persistNotes, notify]);

  // Automatic Background Sync with Personal PC while PC Daemon is running
  useEffect(() => {
    const pcTarget = backupTargets.find((t) => t.type === 'pc-local');
    if (!pcTarget || !pcTarget.autoSyncWhenAvailable) {
      setPcAutoSyncOnline(false);
      return;
    }

    let cancelled = false;
    const provider = createBackupProvider(pcTarget);

    const pollAutoSync = async () => {
      const status = await provider.testConnection();
      if (cancelled) return;
      setPcAutoSyncOnline(status.online);
      if (status.online) {
        try {
          const outcome = await provider.syncDelta(notesRef.current, pcTarget.lastSyncCursor);
          if (!cancelled && outcome.result.pulledCount > 0) {
            persistNotes(outcome.mergedNotes);
          }
        } catch {
          // ignore transient LAN hiccup
        }
      }
    };

    void pollAutoSync();
    const timer = setInterval(pollAutoSync, 12_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [backupTargets, persistNotes]);

  // Decrypt all Safe notes in memory whenever `safeSessionKey` is unlocked
  useEffect(() => {
    if (!safeSessionKey) {
      setDecryptedSafeCache({});
      return;
    }

    let active = true;
    void (async () => {
      const cache: Record<string, Note> = {};
      for (const n of notes) {
        if (n.lock.inSafe && n.status === 'active') {
          try {
            cache[n.id] = await decryptSafeNoteForSession(n, safeSessionKey);
          } catch {
            cache[n.id] = n;
          }
        }
      }
      if (active) {
        setDecryptedSafeCache(cache);
      }
    })();

    return () => {
      active = false;
    };
  }, [safeSessionKey, notes]);

  const handleCreateQuickNote = async (inSafe = false) => {
    if (!quickTitle.trim() && !quickContent.trim() && !inSafe) {
      setQuickExpanded(false);
      return;
    }

    let newNote = createNewNote({
      title: quickTitle.trim(),
      content: quickContent,
      color: quickColor,
      inSafe,
    });

    if (inSafe && safeSessionKey) {
      newNote = await encryptSafeNoteForStorage(newNote, safeSessionKey);
    }

    const next = [newNote, ...notesRef.current];
    persistNotes(next);
    setQuickTitle('');
    setQuickContent('');
    setQuickColor(NOTE_PALETTE_COLORS[0]);
    setQuickExpanded(false);

    if (inSafe) {
      setEditingNoteId(newNote.id);
    }
  };

  const handleUpdateNote = useCallback(
    (
      noteId: string,
      updates: {
        title?: string;
        content?: string;
        color?: string;
        pinned?: boolean;
        tags?: string[];
      },
      options?: { forceVersionCheckpoint?: boolean }
    ) => {
      void (async () => {
        const currentList = notesRef.current;
        const idx = currentList.findIndex((n) => n.id === noteId);
        if (idx === -1) return;

        const existing = currentList[idx];
        const plainExisting =
          existing.lock.inSafe && decryptedSafeCache[noteId]
            ? decryptedSafeCache[noteId]
            : existing;

        const now = Date.now();
        const nextTitle = updates.title ?? plainExisting.title;
        const nextPlainContent = updates.content ?? plainExisting.content;

        const nextVersions =
          updates.content !== undefined && updates.content !== plainExisting.content
            ? recordNoteVersionAndCompact(
                plainExisting,
                plainExisting.content,
                nextPlainContent,
                now,
                options?.forceVersionCheckpoint ?? false
              )
            : plainExisting.versions;

        let updatedNote: Note = {
          ...plainExisting,
          title: nextTitle,
          content: nextPlainContent,
          preview: existing.lock.inSafe
            ? '🔒 Protected in Safe'
            : nextPlainContent.slice(0, 140),
          color: updates.color ?? existing.color,
          pinned: updates.pinned ?? existing.pinned,
          tags: updates.tags ?? existing.tags,
          updatedAt: now,
          hlcTimestamp: advanceHlcTimestamp(existing.deviceId, existing.hlcTimestamp, now),
          versions: nextVersions,
        };

        if (existing.lock.inSafe && safeSessionKey) {
          setDecryptedSafeCache((prev) => ({ ...prev, [noteId]: updatedNote }));
          updatedNote = await encryptSafeNoteForStorage(updatedNote, safeSessionKey);
        }

        const nextList = currentList.slice();
        nextList[idx] = updatedNote;
        persistNotes(nextList);
      })();
    },
    [decryptedSafeCache, persistNotes, safeSessionKey]
  );

  // Move note to/from Safe (with First-Time PIN prompt if Safe isn't configured yet!)
  const handleToggleSafeLock = async (note: Note) => {
    if (!safeConfig.isConfigured) {
      setPendingFirstLockNote(note);
      setShowFirstPinModal(true);
      return;
    }

    if (note.lock.inSafe) {
      if (!safeSessionKey) {
        notify('Please unlock the Safe first.');
        setActiveTab('safe');
        return;
      }
      const unlockedNote = await removeNoteFromSafe(note, safeSessionKey);
      const next = notesRef.current.map((n) => (n.id === note.id ? unlockedNote : n));
      persistNotes(next);
      notify(`Moved "${unlockedNote.title || 'Note'}" out of Safe to main board.`);
      return;
    }

    // Moving an active note INTO the Safe
    if (!safeSessionKey) {
      setPendingFirstLockNote(note);
      setEditingNoteId(null);
      setActiveTab('safe');
      notify('Enter your Safe PIN once to move this note into the Safe.');
      return;
    }

    const encrypted = await moveNoteToSafe(note, safeSessionKey);
    const next = notesRef.current.map((n) => (n.id === note.id ? encrypted : n));
    persistNotes(next);
    setEditingNoteId(null);
    notify(`🔒 Moved "${note.title || 'Note'}" to your Safe!`);
  };

  const handleFirstTimePinSetup = async (newPin: string, enableBiometrics: boolean) => {
    const { config, sessionMasterKey } = await setupSafePin(newPin, {
      enableBiometrics,
      biometricAdapter,
    });
    setSafeConfig(config);
    await saveMetaValue('safeConfig', config);
    setSafeSessionKey(sessionMasterKey);
    setShowFirstPinModal(false);

    if (pendingFirstLockNote) {
      const encrypted = await moveNoteToSafe(pendingFirstLockNote, sessionMasterKey);
      const next = notesRef.current.map((n) =>
        n.id === pendingFirstLockNote.id ? encrypted : n
      );
      persistNotes(next);
      setPendingFirstLockNote(null);
      setEditingNoteId(null);
      setActiveTab('safe');
      notify('Safe PIN created and note locked in your Safe!');
    } else {
      notify('Safe PIN created! Your Safe is now unlocked for this session.');
    }
  };

  const handleUnlockSafeWithPin = async (pin: string) => {
    const { sessionMasterKey } = await unlockSafeSessionWithPin(pin, safeConfig);
    setSafeSessionKey(sessionMasterKey);

    if (pendingFirstLockNote) {
      const encrypted = await moveNoteToSafe(pendingFirstLockNote, sessionMasterKey);
      const next = notesRef.current.map((n) =>
        n.id === pendingFirstLockNote.id ? encrypted : n
      );
      persistNotes(next);
      setPendingFirstLockNote(null);
      notify('Note moved into your Safe!');
    } else {
      notify('Safe unlocked for this session.');
    }
  };

  const handleUnlockSafeWithBiometrics = async () => {
    const { sessionMasterKey } = await unlockSafeSessionWithBiometrics(
      safeConfig,
      biometricAdapter
    );
    setSafeSessionKey(sessionMasterKey);
    notify('Safe unlocked with biometrics!');
  };

  const handleChangeOrResetPinInSettings = async (params: {
    currentPin?: string;
    newPin: string;
    enableBiometrics: boolean;
    forceResetVault: boolean;
  }) => {
    const { config, sessionMasterKey } = await changeOrResetSafePin(
      params.newPin,
      safeConfig,
      {
        currentPin: params.currentPin,
        unlockedSessionMasterKey: safeSessionKey ?? undefined,
        forceResetVault: params.forceResetVault,
        enableBiometrics: params.enableBiometrics,
        biometricAdapter,
      }
    );
    setSafeConfig(config);
    await saveMetaValue('safeConfig', config);
    setSafeSessionKey(sessionMasterKey);
    notify('Safe PIN updated in Settings.');
  };

  const handleSoftDelete = (note: Note) => {
    const trashed = softDeleteNote(note);
    persistNotes(notesRef.current.map((n) => (n.id === note.id ? trashed : n)));
    notify(`Moved "${note.title || 'Note'}" to Recently Deleted.`);
  };

  const handleSnoozeDelete = (note: Note, snoozeUntil: number) => {
    const snoozed = snoozeDeleteNote(note, snoozeUntil);
    persistNotes(notesRef.current.map((n) => (n.id === note.id ? snoozed : n)));
    const seconds = Math.round((snoozeUntil - Date.now()) / 1000);
    notify(
      `⏰ Snooze-deleted "${note.title || 'Note'}"! It will automatically return in ${
        seconds < 90 ? `${seconds}s` : `${Math.round(seconds / 60)}m`
      }.`
    );
  };

  const handleRestoreNote = (note: Note) => {
    const restored = restoreDeletedNote(note);
    persistNotes(notesRef.current.map((n) => (n.id === note.id ? restored : n)));
    notify(`Restored "${note.title || 'Note'}".`);
  };

  const handlePermanentDelete = (noteId: string) => {
    persistNotes(notesRef.current.filter((n) => n.id !== noteId));
    notify('Note permanently deleted.');
  };

  const handleEmptyTrash = () => {
    persistNotes(notesRef.current.filter((n) => n.status !== 'trashed'));
    notify('Emptied Recently Deleted.');
  };

  const handleShareToDesktop = async (note: Note, format: 'md' | 'txt' | 'json') => {
    const pcTarget = backupTargets.find((t) => t.type === 'pc-local') ?? DEFAULT_BACKUP_TARGETS[0];
    const provider = new PersonalPcSyncProvider(pcTarget);
    try {
      const res = await provider.shareNoteToDesktop(note, format);
      notify(`Shared "${res.fileName}" directly to Personal PC (${res.savedPath})`);
    } catch {
      notify(
        'Personal PC daemon is offline — start `pnpm dev:daemon` to receive direct desktop shares.'
      );
    }
  };

  // Filtered Views
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const n of notes) {
      if (n.status === 'active' && !n.lock.inSafe) {
        for (const t of n.tags) set.add(t);
      }
    }
    return Array.from(set);
  }, [notes]);

  const activeBoardNotes = useMemo(() => {
    return notes.filter((n) => {
      if (n.status !== 'active' || n.lock.inSafe) return false;
      if (selectedTag && !n.tags.includes(selectedTag)) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          n.title.toLowerCase().includes(q) ||
          n.content.toLowerCase().includes(q) ||
          n.tags.some((t) => t.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [notes, searchQuery, selectedTag]);

  const pinnedNotes = useMemo(
    () => activeBoardNotes.filter((n) => n.pinned),
    [activeBoardNotes]
  );
  const unpinnedNotes = useMemo(
    () => activeBoardNotes.filter((n) => !n.pinned),
    [activeBoardNotes]
  );

  const safeNotesForView = useMemo(() => {
    return notes
      .filter((n) => n.status === 'active' && n.lock.inSafe)
      .map((n) => decryptedSafeCache[n.id] ?? n);
  }, [notes, decryptedSafeCache]);

  const snoozedNotes = useMemo(
    () => notes.filter((n) => n.status === 'snooze_deleted'),
    [notes]
  );
  const trashedNotes = useMemo(
    () => notes.filter((n) => n.status === 'trashed'),
    [notes]
  );

  const activeEditingNote = useMemo(() => {
    if (!editingNoteId) return null;
    const raw = notes.find((n) => n.id === editingNoteId);
    if (!raw) return null;
    if (raw.lock.inSafe && decryptedSafeCache[raw.id]) {
      return decryptedSafeCache[raw.id];
    }
    return raw;
  }, [editingNoteId, notes, decryptedSafeCache]);

  const activeHistoryNote = useMemo(() => {
    if (!historyNoteId) return null;
    const raw = notes.find((n) => n.id === historyNoteId);
    if (!raw) return null;
    if (raw.lock.inSafe && decryptedSafeCache[raw.id]) {
      return decryptedSafeCache[raw.id];
    }
    return raw;
  }, [historyNoteId, notes, decryptedSafeCache]);

  const totalCharsAcrossAllNotes = useMemo(
    () => notes.reduce((sum, n) => sum + n.content.length, 0),
    [notes]
  );

  return (
    <div className="app-shell">
      {/* Top Navigation Header */}
      <header className="top-navbar">
        <div className="brand-area">
          <div className="brand-logo">
            <FileText size={22} />
          </div>
          <div>
            <h1>AOKnotes</h1>
            <span className="brand-subtitle">Local-First • Unlimited Size • Safe Vault</span>
          </div>
        </div>

        <div className="search-bar">
          <Search size={17} />
          <input
            type="text"
            placeholder="Search local notes, tags, or content..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="top-actions">
          <button
            type="button"
            className={`pc-sync-status-btn ${pcAutoSyncOnline ? 'online' : ''}`}
            onClick={() => setShowBackupModal(true)}
            title="Configure Personal PC Sync & Optional Cloud Backup"
          >
            <Laptop size={16} />
            <span>{pcAutoSyncOnline ? 'PC Auto-Sync Active' : 'Backup & PC Sync'}</span>
            <Cloud size={15} />
          </button>

          <button
            type="button"
            className="icon-btn"
            onClick={() => setShowSettingsModal(true)}
            title="Settings & Safe PIN Reset"
          >
            <Settings size={20} />
          </button>
        </div>
      </header>

      <div className="main-workspace">
        {/* Left Navigation Sidebar */}
        <aside className="sidebar-nav">
          <button
            type="button"
            className={`nav-item ${activeTab === 'notes' && !selectedTag ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('notes');
              setSelectedTag(null);
            }}
          >
            <FileText size={18} />
            <span>Notes</span>
            <span className="nav-count">
              {notes.filter((n) => n.status === 'active' && !n.lock.inSafe).length}
            </span>
          </button>

          <button
            type="button"
            className={`nav-item ${activeTab === 'safe' ? 'active safe-nav' : ''}`}
            onClick={() => setActiveTab('safe')}
          >
            <Shield size={18} />
            <span>Safe (Locked)</span>
            <span className="nav-count">
              {notes.filter((n) => n.status === 'active' && n.lock.inSafe).length}
            </span>
          </button>

          <button
            type="button"
            className={`nav-item ${activeTab === 'trash' ? 'active' : ''}`}
            onClick={() => setActiveTab('trash')}
          >
            <Trash2 size={18} />
            <span>Trash & Snoozed</span>
            <span className="nav-count">{snoozedNotes.length + trashedNotes.length}</span>
          </button>

          {allTags.length > 0 && (
            <div className="sidebar-tags-section">
              <div className="sidebar-section-label">TAGS</div>
              {allTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={`nav-item tag-nav ${
                    activeTab === 'notes' && selectedTag === tag ? 'active' : ''
                  }`}
                  onClick={() => {
                    setActiveTab('notes');
                    setSelectedTag(tag === selectedTag ? null : tag);
                  }}
                >
                  <span>#{tag}</span>
                </button>
              ))}
            </div>
          )}
        </aside>

        {/* Center Content Area */}
        <main className="content-board">
          {activeTab === 'notes' && (
            <>
              {/* Google Keep Style Quick Capture Bar */}
              <div
                className="quick-capture-card"
                style={{ backgroundColor: quickColor }}
              >
                {quickExpanded && (
                  <input
                    type="text"
                    className="quick-title-input"
                    placeholder="Title"
                    value={quickTitle}
                    onChange={(e) => setQuickTitle(e.target.value)}
                  />
                )}
                <textarea
                  className="quick-body-input"
                  rows={quickExpanded ? 3 : 1}
                  placeholder="Take a local note... (Unlimited length, auto-saves on exit)"
                  value={quickContent}
                  onFocus={() => setQuickExpanded(true)}
                  onChange={(e) => setQuickContent(e.target.value)}
                />
                {quickExpanded && (
                  <div className="quick-capture-footer">
                    <div className="color-picker-row">
                      {NOTE_PALETTE_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          className={`color-dot ${quickColor === c ? 'selected' : ''}`}
                          style={{ backgroundColor: c }}
                          onClick={() => setQuickColor(c)}
                        />
                      ))}
                    </div>
                    <div className="quick-actions">
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        onClick={() => void handleCreateQuickNote(false)}
                      >
                        <Plus size={14} /> Add Note
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Pinned Notes Section */}
              {pinnedNotes.length > 0 && (
                <section className="board-group">
                  <h3 className="group-label">PINNED</h3>
                  <div className="notes-grid">
                    {pinnedNotes.map((note) => (
                      <NoteCard
                        key={note.id}
                        note={note}
                        onSelect={() => setEditingNoteId(note.id)}
                        onTogglePin={() =>
                          handleUpdateNote(note.id, { pinned: !note.pinned })
                        }
                        onMoveToSafe={() => void handleToggleSafeLock(note)}
                        onSnooze15s={() =>
                          handleSnoozeDelete(note, Date.now() + 15_000)
                        }
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Other Active Notes Section */}
              <section className="board-group">
                {pinnedNotes.length > 0 && unpinnedNotes.length > 0 && (
                  <h3 className="group-label">OTHERS</h3>
                )}
                {activeBoardNotes.length === 0 ? (
                  <div className="empty-board-state">
                    <Sparkles size={32} />
                    <h3>No notes match your view</h3>
                    <p>Create a note above or check your Safe and Snoozed tabs.</p>
                  </div>
                ) : (
                  <div className="notes-grid">
                    {unpinnedNotes.map((note) => (
                      <NoteCard
                        key={note.id}
                        note={note}
                        onSelect={() => setEditingNoteId(note.id)}
                        onTogglePin={() =>
                          handleUpdateNote(note.id, { pinned: !note.pinned })
                        }
                        onMoveToSafe={() => void handleToggleSafeLock(note)}
                        onSnooze15s={() =>
                          handleSnoozeDelete(note, Date.now() + 15_000)
                        }
                      />
                    ))}
                  </div>
                )}
              </section>
            </>
          )}

          {activeTab === 'safe' && (
            <SafeVaultView
              safeConfig={safeConfig}
              isSafeUnlocked={safeSessionKey !== null}
              safeNotes={safeNotesForView}
              onUnlockWithPin={handleUnlockSafeWithPin}
              onUnlockWithBiometrics={handleUnlockSafeWithBiometrics}
              onLockSafeSession={() => {
                setSafeSessionKey(null);
                notify('Safe locked.');
              }}
              onOpenSetupSafeModal={() => setShowFirstPinModal(true)}
              onSelectNote={(n) => setEditingNoteId(n.id)}
              onCreateNoteInSafe={() => void handleCreateQuickNote(true)}
              onRemoveFromSafe={(n) => void handleToggleSafeLock(n)}
              onOpenSettingsPinReset={() => setShowSettingsModal(true)}
            />
          )}

          {activeTab === 'trash' && (
            <TrashAndSnoozeView
              snoozedNotes={snoozedNotes}
              trashedNotes={trashedNotes}
              onRestoreNote={handleRestoreNote}
              onPermanentDelete={handlePermanentDelete}
              onEmptyTrash={handleEmptyTrash}
            />
          )}
        </main>
      </div>

      {/* Virtualized Unlimited-Length Note Editor Modal */}
      {activeEditingNote && (
        <VirtualizedNoteEditor
          note={activeEditingNote}
          onUpdateNote={handleUpdateNote}
          onClose={() => setEditingNoteId(null)}
          onOpenVersionHistory={() => setHistoryNoteId(activeEditingNote.id)}
          onToggleSafeLock={(n) => void handleToggleSafeLock(n)}
          onSoftDelete={handleSoftDelete}
          onSnoozeDelete={handleSnoozeDelete}
          onShareToDesktop={handleShareToDesktop}
          notify={notify}
        />
      )}

      {/* Space-Saving Delta Version History Drawer */}
      {activeHistoryNote && (
        <VersionHistoryDrawer
          note={activeHistoryNote}
          onRestoreVersion={(noteId, restoredContent) => {
            handleUpdateNote(
              noteId,
              { content: restoredContent },
              { forceVersionCheckpoint: true }
            );
            notify('Restored note to selected historical version!');
          }}
          onClose={() => setHistoryNoteId(null)}
        />
      )}

      {/* First-Time Safe PIN Setup Modal (Triggered when locking a page for the first time) */}
      {showFirstPinModal && (
        <FirstTimePinModal
          noteTitle={pendingFirstLockNote?.title}
          onConfirmSetup={handleFirstTimePinSetup}
          onCancel={() => {
            setShowFirstPinModal(false);
            setPendingFirstLockNote(null);
          }}
        />
      )}

      {/* Backup & PC Sync Modal */}
      {showBackupModal && (
        <BackupAndSyncModal
          targets={backupTargets}
          notes={notes}
          onUpdateTargets={(next) => {
            setBackupTargets(next);
            void saveMetaValue('backupTargets', next);
          }}
          onApplySyncedNotes={(mergedNotes: Note[], _res: BackupSyncResult) => {
            persistNotes(mergedNotes);
          }}
          onClose={() => setShowBackupModal(false)}
          notify={notify}
        />
      )}

      {/* Settings & Safe PIN Reset Modal */}
      {showSettingsModal && (
        <SettingsModal
          safeConfig={safeConfig}
          isSafeUnlocked={safeSessionKey !== null}
          totalNotesCount={notes.length}
          totalCharsAcrossAllNotes={totalCharsAcrossAllNotes}
          onChangeOrResetPin={handleChangeOrResetPinInSettings}
          onClose={() => setShowSettingsModal(false)}
        />
      )}

      {/* Toast Notification */}
      {toastMsg && <div className="toast-notification">{toastMsg}</div>}
    </div>
  );
};

interface NoteCardProps {
  note: Note;
  onSelect: () => void;
  onTogglePin: () => void;
  onMoveToSafe: () => void;
  onSnooze15s: () => void;
}

const NoteCard: React.FC<NoteCardProps> = ({
  note,
  onSelect,
  onTogglePin,
  onMoveToSafe,
  onSnooze15s,
}) => {
  return (
    <div
      className="note-card"
      style={{ backgroundColor: note.color || '#ffffff' }}
      onClick={onSelect}
    >
      <div className="note-card-header">
        <h4>{note.title || 'Untitled'}</h4>
        <button
          type="button"
          className={`icon-btn pin-btn ${note.pinned ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin();
          }}
          title={note.pinned ? 'Unpin' : 'Pin'}
        >
          <Pin size={15} />
        </button>
      </div>

      {note.restoredFromSnoozeAt && (
        <div className="restored-snooze-pill">
          <Timer size={11} /> Restored from Snooze Delete
        </div>
      )}

      <p className="note-card-preview">
        {note.content.slice(0, 220) || 'Empty note...'}
      </p>

      {note.tags.length > 0 && (
        <div className="card-tags">
          {note.tags.map((t) => (
            <span key={t} className="tag-pill-sm">
              #{t}
            </span>
          ))}
        </div>
      )}

      <div className="note-card-footer" onClick={(e) => e.stopPropagation()}>
        <span className="char-count-meta">
          {note.content.length.toLocaleString()} chars • {note.versions.length} versions
        </span>
        <div className="card-quick-btns">
          <button
            type="button"
            className="icon-btn-sm"
            title="Lock & Move to Safe"
            onClick={onMoveToSafe}
          >
            <Lock size={13} />
          </button>
          <button
            type="button"
            className="icon-btn-sm"
            title="Snooze Delete (Demo 15s return)"
            onClick={onSnooze15s}
          >
            <Timer size={13} />
          </button>
        </div>
      </div>
    </div>
  );
};
