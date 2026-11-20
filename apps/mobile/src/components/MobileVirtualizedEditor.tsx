import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  AppStateStatus,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  AutosaveController,
  DocumentBlock,
  Note,
  SNOOZE_DELETE_PRESETS,
  buildDocumentBlocks,
  computeDocumentStats,
  generateLargeNoteBenchmarkContent,
  updateDocumentBlock,
} from '@aoknotes/core';

interface MobileVirtualizedEditorProps {
  note: Note;
  onSaveNote: (
    noteId: string,
    title: string,
    content: string,
    flushedOnExit: boolean
  ) => void;
  onToggleSafe: (note: Note) => void;
  onSnoozeDelete: (note: Note, snoozeUntil: number) => void;
  onSoftDelete: (note: Note) => void;
  onShareToDesktop: (note: Note) => void;
  onClose: () => void;
}

export const MobileVirtualizedEditor: React.FC<MobileVirtualizedEditorProps> = ({
  note,
  onSaveNote,
  onToggleSafe,
  onSnoozeDelete,
  onSoftDelete,
  onShareToDesktop,
  onClose,
}) => {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [blocks, setBlocks] = useState<DocumentBlock[]>(() =>
    buildDocumentBlocks(note.content, 44)
  );
  const [activeBlockIndex, setActiveBlockIndex] = useState<number | null>(null);

  const onSaveRef = useRef(onSaveNote);
  onSaveRef.current = onSaveNote;

  const autosaveRef = useRef<AutosaveController | null>(null);
  if (!autosaveRef.current) {
    autosaveRef.current = new AutosaveController((payload) => {
      onSaveRef.current(
        payload.noteId,
        payload.title,
        payload.content,
        payload.flushedOnExit
      );
    }, 400);
  }

  // Immediately flush and save contents when the user leaves or backgrounds the phone app!
  useEffect(() => {
    const controller = autosaveRef.current;
    const subscription = AppState.addEventListener(
      'change',
      (nextAppState: AppStateStatus) => {
        if (nextAppState === 'background' || nextAppState === 'inactive') {
          controller?.flushNow();
        }
      }
    );

    return () => {
      subscription.remove();
      controller?.flushNow();
    };
  }, []);

  const stats = useMemo(
    () => computeDocumentStats(content, blocks.length),
    [content, blocks.length]
  );

  const handleBlockChange = (index: number, nextLine: string) => {
    const updated = updateDocumentBlock(blocks, index, nextLine, 44);
    setBlocks(updated.blocks);
    setContent(updated.content);
    autosaveRef.current?.scheduleSave(note.id, title, updated.content);
  };

  const handleAddStressTest = () => {
    const large = generateLargeNoteBenchmarkContent(250_000);
    const merged = content ? `${content}\n\n${large}` : large;
    setContent(merged);
    setBlocks(buildDocumentBlocks(merged, 44));
    autosaveRef.current?.scheduleSave(note.id, title, merged);
    autosaveRef.current?.flushNow();
  };

  return (
    <View style={[styles.container, { backgroundColor: note.color || '#ffffff' }]}>
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.barBtn}
          onPress={() => {
            autosaveRef.current?.flushNow();
            onClose();
          }}
        >
          <Text style={styles.barBtnText}>← Done</Text>
        </TouchableOpacity>

        <View style={styles.barActions}>
          <TouchableOpacity
            style={styles.barBtn}
            onPress={() => {
              autosaveRef.current?.flushNow();
              onToggleSafe({ ...note, title, content });
            }}
          >
            <Text style={styles.barBtnText}>
              {note.lock.inSafe ? '🔓 Out of Safe' : '🔒 Move to Safe'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.barBtn}
            onPress={() => {
              autosaveRef.current?.flushNow();
              onShareToDesktop({ ...note, title, content });
            }}
          >
            <Text style={styles.barBtnText}>💻 To PC</Text>
          </TouchableOpacity>
        </View>
      </View>

      <TextInput
        style={styles.titleInput}
        placeholder="Note Title..."
        value={title}
        onChangeText={(nextTitle) => {
          setTitle(nextTitle);
          autosaveRef.current?.scheduleSave(note.id, nextTitle, content);
        }}
      />

      <View style={styles.statsStrip}>
        <Text style={styles.statsText}>
          {stats.totalChars.toLocaleString()} chars • {stats.totalBlocks.toLocaleString()} blocks •
          Auto-saves on app exit
        </Text>
        <TouchableOpacity style={styles.stressChip} onPress={handleAddStressTest}>
          <Text style={styles.stressChipText}>+250K Chars</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={blocks}
        keyExtractor={(item) => item.id}
        initialNumToRender={20}
        maxToRenderPerBatch={24}
        windowSize={7}
        removeClippedSubviews
        renderItem={({ item, index }) => (
          <TouchableOpacity
            activeOpacity={0.9}
            style={styles.blockRow}
            onPress={() => setActiveBlockIndex(index)}
          >
            <Text style={styles.lineNum}>{index + 1}</Text>
            {activeBlockIndex === index ? (
              <TextInput
                autoFocus
                multiline
                style={styles.blockInput}
                value={item.text}
                onChangeText={(txt) => handleBlockChange(index, txt)}
              />
            ) : (
              <Text style={styles.blockText}>{item.text || ' '}</Text>
            )}
          </TouchableOpacity>
        )}
      />

      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={styles.snoozeBtn}
          onPress={() => {
            autosaveRef.current?.flushNow();
            onSnoozeDelete(
              { ...note, title, content },
              Date.now() + SNOOZE_DELETE_PRESETS[0].durationMs
            );
            onClose();
          }}
        >
          <Text style={styles.snoozeBtnText}>⏰ Snooze Delete (15s Demo)</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={() => {
            autosaveRef.current?.flushNow();
            onSoftDelete({ ...note, title, content });
            onClose();
          }}
        >
          <Text style={styles.deleteBtnText}>🗑️ Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderColor: '#e2e8f0',
  },
  barActions: { flexDirection: 'row', gap: 8 },
  barBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
  },
  barBtnText: { fontSize: 13, fontWeight: '600', color: '#0f172a' },
  titleInput: {
    fontSize: 20,
    fontWeight: '700',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  statsStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: '#f8fafc',
  },
  statsText: { fontSize: 11, color: '#64748b' },
  stressChip: {
    backgroundColor: '#dbeafe',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  stressChipText: { fontSize: 11, fontWeight: '600', color: '#1d4ed8' },
  blockRow: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 4,
    alignItems: 'flex-start',
  },
  lineNum: { width: 36, fontSize: 11, color: '#94a3b8', paddingTop: 3 },
  blockText: { flex: 1, fontSize: 15, lineHeight: 22, color: '#0f172a' },
  blockInput: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#2563eb',
    borderRadius: 6,
    padding: 4,
  },
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 12,
    borderTopWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
  },
  snoozeBtn: {
    backgroundColor: '#fef3c7',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  snoozeBtnText: { color: '#92400e', fontWeight: '600', fontSize: 13 },
  deleteBtn: {
    backgroundColor: '#fee2e2',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  deleteBtnText: { color: '#b91c1c', fontWeight: '600', fontSize: 13 },
});
