import React, { useEffect, useMemo, useRef, useState } from 'react';
import { registerRootComponent } from 'expo';
import { StatusBar } from 'expo-status-bar';
import {
  FlatList,
  Platform,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import {
  BackupTargetConfig,
  Note,
  SafeConfig,
  changeOrResetSafePin,
  createNewNote,
  decryptSafeNoteForSession,
  encryptSafeNoteForStorage,
  formatSnoozeRemaining,
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
import { PhoneBiometricKeyringAdapter } from './src/security/biometricAuth';
import { MobileVirtualizedEditor } from './src/components/MobileVirtualizedEditor';
import { shareNoteFromPhoneToDesktop } from './src/utils/mobileExport';

type MobileTab = 'notes' | 'safe' | 'trash' | 'settings';

/**
 * Global Safe Shell that wraps the entire application so every screen and modal
 * automatically respects the device's top camera cutout / notch / status bar and bottom gesture bar.
 */
const GlobalAppSafeShell: React.FC<{
  backgroundColor?: string;
  children: React.ReactNode;
}> = ({ backgroundColor = '#ffffff', children }) => {
  const insets = useSafeAreaInsets();
  const fallbackAndroidTop =
    Platform.OS === 'android' ? RNStatusBar.currentHeight ?? 28 : 0;
  const safeTopPadding = Math.max(insets.top, fallbackAndroidTop);

  return (
    <View
      style={[
        styles.globalSafeShell,
        {
          backgroundColor,
          paddingTop: safeTopPadding,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
    >
      {children}
    </View>
  );
};

export default function App() {
  const [notes, setNotes] = useState<Note[]>(() => [
    createNewNote({
      id: 'mobile-welcome',
      title: 'AOKnotes Phone App',
      content:
        '# Local-First Mobile Notes\n- Unlimited character length\n- Locked notes grouped in Safe (1 login unlocks all)\n- Snooze Delete brings back deleted notes automatically',
      color: '#fef3c7',
      pinned: true,
    }),
  ]);
  const [safeConfig, setSafeConfig] = useState<SafeConfig>({
    isConfigured: false,
    pinSalt: '',
    wrappedMasterKeyIv: '',
    wrappedMasterKey: '',
    verificationCipher: '',
    verificationIv: '',
    biometricsEnabled: true,
    updatedAt: 0,
  });
  const [pcTarget] = useState<BackupTargetConfig>({
    id: 'pc-lan',
    type: 'pc-local',
    displayName: 'Personal PC',
    enabled: true,
    autoSyncWhenAvailable: true,
    endpointUrl: 'http://192.168.1.32:4545',
    encryptBeforeUpload: false,
  });

  const [activeTab, setActiveTab] = useState<MobileTab>('notes');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [safeSessionKey, setSafeSessionKey] = useState<CryptoKey | null>(null);
  const [decryptedSafeMap, setDecryptedSafeMap] = useState<Record<string, Note>>({});
  const [pinInput, setPinInput] = useState('');
  const [newPinInput, setNewPinInput] = useState('');
  const [pendingNoteToLock, setPendingNoteToLock] = useState<Note | null>(null);
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);

  const biometricAdapter = useMemo(() => new PhoneBiometricKeyringAdapter(), []);
  const notesRef = useRef(notes);
  notesRef.current = notes;

  // Watchdog for Snooze-Delete automatic restoration
  useEffect(() => {
    const timer = setInterval(() => {
      const report = processSnoozeAndTrashLifecycle(notesRef.current, Date.now());
      if (report.changed) {
        setNotes(report.notes);
        if (report.restoredFromSnooze.length > 0) {
          setBannerMsg(
            `⏰ Restored from Snooze: ${report.restoredFromSnooze[0].title || 'Note'}`
          );
        }
      }
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Decrypt Safe notes when Safe session is unlocked
  useEffect(() => {
    if (!safeSessionKey) {
      setDecryptedSafeMap({});
      return;
    }
    void (async () => {
      const map: Record<string, Note> = {};
      for (const n of notes) {
        if (n.lock.inSafe) {
          map[n.id] = await decryptSafeNoteForSession(n, safeSessionKey);
        }
      }
      setDecryptedSafeMap(map);
    })();
  }, [safeSessionKey, notes]);

  const handleSaveNote = async (
    noteId: string,
    title: string,
    content: string,
    flushedOnExit: boolean
  ) => {
    const idx = notesRef.current.findIndex((n) => n.id === noteId);
    if (idx === -1) return;
    const existing = notesRef.current[idx];
    const plainPrev = decryptedSafeMap[noteId] ?? existing;
    const versions = recordNoteVersionAndCompact(
      plainPrev,
      plainPrev.content,
      content,
      Date.now(),
      flushedOnExit
    );

    let updated: Note = {
      ...plainPrev,
      title,
      content,
      preview: existing.lock.inSafe ? '🔒 Protected in Safe' : content.slice(0, 140),
      updatedAt: Date.now(),
      versions,
    };

    if (existing.lock.inSafe && safeSessionKey) {
      setDecryptedSafeMap((prev) => ({ ...prev, [noteId]: updated }));
      updated = await encryptSafeNoteForStorage(updated, safeSessionKey);
    }

    const next = notesRef.current.slice();
    next[idx] = updated;
    setNotes(next);
  };

  const handleToggleSafe = async (note: Note) => {
    if (!safeConfig.isConfigured) {
      setPendingNoteToLock(note);
      setEditingNoteId(null);
      setActiveTab('safe');
      setBannerMsg('Create a new Safe PIN to lock this page into your Safe.');
      return;
    }

    if (!safeSessionKey) {
      setPendingNoteToLock(note);
      setEditingNoteId(null);
      setActiveTab('safe');
      return;
    }

    if (note.lock.inSafe) {
      const unlocked = await removeNoteFromSafe(note, safeSessionKey);
      setNotes((prev) => prev.map((n) => (n.id === note.id ? unlocked : n)));
    } else {
      const locked = await moveNoteToSafe(note, safeSessionKey);
      setNotes((prev) => prev.map((n) => (n.id === note.id ? locked : n)));
      setEditingNoteId(null);
      setActiveTab('safe');
    }
  };

  const activeNote = editingNoteId
    ? decryptedSafeMap[editingNoteId] ?? notes.find((n) => n.id === editingNoteId) ?? null
    : null;

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" translucent backgroundColor="transparent" />
      <GlobalAppSafeShell
        backgroundColor={activeNote ? activeNote.color || '#ffffff' : '#ffffff'}
      >
        {activeNote ? (
          <MobileVirtualizedEditor
            note={activeNote}
            onSaveNote={(id, t, c, exit) => void handleSaveNote(id, t, c, exit)}
            onToggleSafe={(n) => void handleToggleSafe(n)}
            onSnoozeDelete={(n, until) =>
              setNotes((prev) =>
                prev.map((item) =>
                  item.id === n.id ? snoozeDeleteNote(n, until) : item
                )
              )
            }
            onSoftDelete={(n) =>
              setNotes((prev) =>
                prev.map((item) => (item.id === n.id ? softDeleteNote(n) : item))
              )
            }
            onShareToDesktop={(n) => void shareNoteFromPhoneToDesktop(n, pcTarget, 'md')}
            onClose={() => setEditingNoteId(null)}
          />
        ) : (
          <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>AOKnotes</Text>
        <TouchableOpacity
          style={styles.newBtn}
          onPress={() => {
            const created = createNewNote({ title: 'New Note', content: '' });
            setNotes((prev) => [created, ...prev]);
            setEditingNoteId(created.id);
          }}
        >
          <Text style={styles.newBtnText}>+ New Note</Text>
        </TouchableOpacity>
      </View>

      {bannerMsg && (
        <TouchableOpacity style={styles.banner} onPress={() => setBannerMsg(null)}>
          <Text style={styles.bannerText}>{bannerMsg}</Text>
        </TouchableOpacity>
      )}

      <View style={styles.body}>
        {activeTab === 'notes' && (
          <FlatList
            data={notes.filter((n) => n.status === 'active' && !n.lock.inSafe)}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.card, { backgroundColor: item.color || '#ffffff' }]}
                onPress={() => setEditingNoteId(item.id)}
              >
                <Text style={styles.cardTitle}>{item.title || 'Untitled'}</Text>
                <Text style={styles.cardPreview} numberOfLines={3}>
                  {item.content || 'Empty note'}
                </Text>
              </TouchableOpacity>
            )}
          />
        )}

        {activeTab === 'safe' && (
          <View style={styles.sectionBox}>
            {!safeConfig.isConfigured ? (
              <View>
                <Text style={styles.sectionTitle}>Create Your Safe PIN</Text>
                <TextInput
                  style={styles.input}
                  secureTextEntry
                  placeholder="Enter new 4+ digit Safe PIN..."
                  value={newPinInput}
                  onChangeText={setNewPinInput}
                />
                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={async () => {
                    const { config, sessionMasterKey } = await setupSafePin(newPinInput, {
                      enableBiometrics: true,
                      biometricAdapter,
                    });
                    setSafeConfig(config);
                    setSafeSessionKey(sessionMasterKey);
                    setNewPinInput('');
                    if (pendingNoteToLock) {
                      const locked = await moveNoteToSafe(pendingNoteToLock, sessionMasterKey);
                      setNotes((prev) =>
                        prev.map((n) => (n.id === locked.id ? locked : n))
                      );
                      setPendingNoteToLock(null);
                    }
                  }}
                >
                  <Text style={styles.primaryBtnText}>Set Safe PIN & Unlock Safe</Text>
                </TouchableOpacity>
              </View>
            ) : !safeSessionKey ? (
              <View>
                <Text style={styles.sectionTitle}>🔒 Safe Locked (1 Login Unlocks All)</Text>
                <TextInput
                  style={styles.input}
                  secureTextEntry
                  placeholder="Enter Safe PIN..."
                  value={pinInput}
                  onChangeText={setPinInput}
                />
                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={async () => {
                    const { sessionMasterKey } = await unlockSafeSessionWithPin(
                      pinInput,
                      safeConfig
                    );
                    setSafeSessionKey(sessionMasterKey);
                    setPinInput('');
                  }}
                >
                  <Text style={styles.primaryBtnText}>Unlock Safe with PIN</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.primaryBtn, { marginTop: 10, backgroundColor: '#0d9488' }]}
                  onPress={async () => {
                    const { sessionMasterKey } = await unlockSafeSessionWithBiometrics(
                      safeConfig,
                      biometricAdapter
                    );
                    setSafeSessionKey(sessionMasterKey);
                  }}
                >
                  <Text style={styles.primaryBtnText}>Unlock with Phone Biometrics</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <FlatList
                data={notes
                  .filter((n) => n.status === 'active' && n.lock.inSafe)
                  .map((n) => decryptedSafeMap[n.id] ?? n)}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.card}
                    onPress={() => setEditingNoteId(item.id)}
                  >
                    <Text style={styles.cardTitle}>🔒 {item.title || 'Safe Note'}</Text>
                    <Text style={styles.cardPreview} numberOfLines={3}>
                      {item.content}
                    </Text>
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        )}

        {activeTab === 'trash' && (
          <FlatList
            data={notes.filter(
              (n) => n.status === 'snooze_deleted' || n.status === 'trashed'
            )}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>
                  {item.status === 'snooze_deleted' && item.snoozeUntil
                    ? `⏰ ${item.title} (${formatSnoozeRemaining(item.snoozeUntil)})`
                    : `🗑️ ${item.title}`}
                </Text>
                <TouchableOpacity
                  onPress={() =>
                    setNotes((prev) =>
                      prev.map((n) => (n.id === item.id ? restoreDeletedNote(n) : n))
                    )
                  }
                >
                  <Text style={{ color: '#2563eb', fontWeight: '600', marginTop: 6 }}>
                    Restore Note Now
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          />
        )}

        {activeTab === 'settings' && (
          <View style={styles.sectionBox}>
            <Text style={styles.sectionTitle}>Reset or Change Safe PIN</Text>
            <TextInput
              style={styles.input}
              secureTextEntry
              placeholder="Enter new Safe PIN (4+ chars)..."
              value={newPinInput}
              onChangeText={setNewPinInput}
            />
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={async () => {
                const { config, sessionMasterKey } = await changeOrResetSafePin(
                  newPinInput,
                  safeConfig,
                  {
                    unlockedSessionMasterKey: safeSessionKey ?? undefined,
                    forceResetVault: true,
                    enableBiometrics: true,
                    biometricAdapter,
                  }
                );
                setSafeConfig(config);
                setSafeSessionKey(sessionMasterKey);
                setNewPinInput('');
                setBannerMsg('Safe PIN updated in Settings!');
              }}
            >
              <Text style={styles.primaryBtnText}>Save New Safe PIN</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={styles.tabBar}>
        {(['notes', 'safe', 'trash', 'settings'] as MobileTab[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={styles.tabItem}
            onPress={() => setActiveTab(tab)}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === tab ? styles.tabTextActive : undefined,
              ]}
            >
              {tab.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
          </View>
        )}
      </GlobalAppSafeShell>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  globalSafeShell: { flex: 1 },
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderColor: '#e2e8f0',
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  newBtn: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  newBtnText: { color: '#ffffff', fontWeight: '600' },
  banner: { backgroundColor: '#fef3c7', padding: 10 },
  bannerText: { color: '#92400e', fontWeight: '600', textAlign: 'center' },
  body: { flex: 1, padding: 14 },
  card: {
    backgroundColor: '#ffffff',
    padding: 14,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  cardPreview: { fontSize: 14, color: '#475569' },
  sectionBox: { backgroundColor: '#ffffff', padding: 16, borderRadius: 12 },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  primaryBtn: {
    backgroundColor: '#2563eb',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#ffffff', fontWeight: '600' },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
  },
  tabItem: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  tabText: { fontSize: 12, fontWeight: '600', color: '#64748b' },
  tabTextActive: { color: '#2563eb' },
});

registerRootComponent(App);

