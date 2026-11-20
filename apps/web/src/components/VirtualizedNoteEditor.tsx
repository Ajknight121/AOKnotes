import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  AutosaveController,
  DocumentBlock,
  ExportFileFormat,
  NOTE_PALETTE_COLORS,
  Note,
  SNOOZE_DELETE_PRESETS,
  buildDocumentBlocks,
  computeDocumentStats,
  exportNoteToFileArtifact,
  formatNoteForClipboard,
  generateLargeNoteBenchmarkContent,
  updateDocumentBlock,
} from '@aoknotes/core';
import {
  Clock,
  Copy,
  Download,
  History,
  Laptop,
  Lock,
  Pin,
  Sparkles,
  Timer,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';

interface VirtualizedNoteEditorProps {
  note: Note;
  onUpdateNote: (
    noteId: string,
    updates: {
      title?: string;
      content?: string;
      color?: string;
      pinned?: boolean;
      tags?: string[];
    },
    options?: { forceVersionCheckpoint?: boolean }
  ) => void;
  onClose: () => void;
  onOpenVersionHistory: () => void;
  onToggleSafeLock: (note: Note) => void;
  onSoftDelete: (note: Note) => void;
  onSnoozeDelete: (note: Note, snoozeUntil: number) => void;
  onShareToDesktop: (note: Note, format: 'md' | 'txt' | 'json') => Promise<void>;
  notify: (message: string) => void;
}

export const VirtualizedNoteEditor: React.FC<VirtualizedNoteEditorProps> = ({
  note,
  onUpdateNote,
  onClose,
  onOpenVersionHistory,
  onToggleSafeLock,
  onSoftDelete,
  onSnoozeDelete,
  onShareToDesktop,
  notify,
}) => {
  const [title, setTitle] = useState(note.title);
  const [blocks, setBlocks] = useState<DocumentBlock[]>(() => buildDocumentBlocks(note.content));
  const [fullContent, setFullContent] = useState(note.content);
  const [activeBlockIdx, setActiveBlockIdx] = useState<number | null>(null);
  const [editorMode, setEditorMode] = useState<'virtual-blocks' | 'raw-stream'>('virtual-blocks');
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved');
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false);
  const [customSnoozeMinutes, setCustomSnoozeMinutes] = useState('5');
  const [tagInput, setTagInput] = useState('');

  const parentScrollRef = useRef<HTMLDivElement | null>(null);

  // Keep latest callback ref for AutosaveController
  const onUpdateRef = useRef(onUpdateNote);
  onUpdateRef.current = onUpdateNote;

  const autosaveRef = useRef<AutosaveController | null>(null);
  if (!autosaveRef.current) {
    autosaveRef.current = new AutosaveController((payload) => {
      onUpdateRef.current(
        payload.noteId,
        { title: payload.title, content: payload.content },
        { forceVersionCheckpoint: payload.flushedOnExit }
      );
      setSaveState('saved');
    }, 400);
  }

  // Synchronize when switching to another note or restoring a version
  useEffect(() => {
    setTitle(note.title);
    setFullContent(note.content);
    setBlocks(buildDocumentBlocks(note.content));
  }, [note.id, note.versions.length]);

  // Flush any pending unsaved edits on unmount OR when leaving/hiding the app/tab
  useEffect(() => {
    const controller = autosaveRef.current;
    const handleVisibilityOrExit = () => {
      if (document.visibilityState === 'hidden') {
        controller?.flushNow();
      }
    };
    const handlePageHide = () => {
      controller?.flushNow();
    };

    document.addEventListener('visibilitychange', handleVisibilityOrExit);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handlePageHide);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityOrExit);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handlePageHide);
      controller?.flushNow();
    };
  }, []);

  const rowVirtualizer = useVirtualizer({
    count: blocks.length,
    getScrollElement: () => parentScrollRef.current,
    estimateSize: (idx) => blocks[idx]?.estimatedHeight ?? 34,
    overscan: 18,
  });

  const docStats = useMemo(
    () => computeDocumentStats(fullContent, blocks.length),
    [fullContent, blocks.length]
  );

  const handleTitleChange = (nextTitle: string) => {
    setTitle(nextTitle);
    setSaveState('saving');
    autosaveRef.current?.scheduleSave(note.id, nextTitle, fullContent);
  };

  const handleBlockEdit = (blockIndex: number, nextText: string) => {
    const updated = updateDocumentBlock(blocks, blockIndex, nextText);
    setBlocks(updated.blocks);
    setFullContent(updated.content);
    setSaveState('saving');
    autosaveRef.current?.scheduleSave(note.id, title, updated.content);
  };

  const handleRawContentChange = (nextRaw: string) => {
    setFullContent(nextRaw);
    setBlocks(buildDocumentBlocks(nextRaw));
    setSaveState('saving');
    autosaveRef.current?.scheduleSave(note.id, title, nextRaw);
  };

  const handleAppendStressTest = (targetChars: number) => {
    const generated = generateLargeNoteBenchmarkContent(targetChars);
    const combined = fullContent ? `${fullContent}\n\n${generated}` : generated;
    setFullContent(combined);
    setBlocks(buildDocumentBlocks(combined));
    setSaveState('saving');
    autosaveRef.current?.scheduleSave(note.id, title, combined);
    autosaveRef.current?.flushNow();
    notify(
      `Added ${generated.length.toLocaleString()} characters! Scroll to test 60fps virtualized rendering.`
    );
  };

  const handleCopyNote = async () => {
    const text = formatNoteForClipboard({ ...note, title, content: fullContent });
    await navigator.clipboard.writeText(text);
    notify('Copied note to clipboard!');
    setShowExportMenu(false);
  };

  const handleDownloadFile = (format: ExportFileFormat) => {
    const artifact = exportNoteToFileArtifact({ ...note, title, content: fullContent }, format);
    const blob = new Blob([artifact.content], { type: artifact.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = artifact.fileName;
    a.click();
    URL.revokeObjectURL(url);
    notify(`Exported ${artifact.fileName}`);
    setShowExportMenu(false);
  };

  const handleCloseWithFlush = () => {
    autosaveRef.current?.flushNow();
    onClose();
  };

  const handleAddTag = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = tagInput.trim().toLowerCase();
    if (!cleaned || note.tags.includes(cleaned)) {
      setTagInput('');
      return;
    }
    onUpdateNote(note.id, { tags: [...note.tags, cleaned] });
    setTagInput('');
  };

  const handleRemoveTag = (tagToRemove: string) => {
    onUpdateNote(note.id, { tags: note.tags.filter((t) => t !== tagToRemove) });
  };

  return (
    <div className="modal-backdrop" onClick={handleCloseWithFlush}>
      <div
        className="editor-modal"
        style={{ backgroundColor: note.color || '#ffffff' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header Bar */}
        <div className="editor-header">
          <input
            type="text"
            className="editor-title-input"
            placeholder="Note title..."
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
          />

          <div className="editor-header-actions">
            <span className={`autosave-badge ${saveState}`}>
              <Clock size={13} />
              {saveState === 'saving' ? 'Saving...' : 'Saved locally'}
            </span>

            <button
              type="button"
              className={`icon-btn ${note.pinned ? 'active' : ''}`}
              title={note.pinned ? 'Unpin note' : 'Pin note'}
              onClick={() => onUpdateNote(note.id, { pinned: !note.pinned })}
            >
              <Pin size={17} />
            </button>

            <button
              type="button"
              className={`btn-secondary btn-sm ${note.lock.inSafe ? 'safe-active-badge' : ''}`}
              onClick={() => {
                autosaveRef.current?.flushNow();
                onToggleSafeLock({ ...note, title, content: fullContent });
              }}
              title={
                note.lock.inSafe
                  ? 'Remove note from Safe back to main board'
                  : 'Lock and move note into the Safe'
              }
            >
              {note.lock.inSafe ? <Unlock size={14} /> : <Lock size={14} />}
              {note.lock.inSafe ? 'Remove from Safe' : 'Move to Safe'}
            </button>

            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => {
                autosaveRef.current?.flushNow();
                onOpenVersionHistory();
              }}
              title="Space-saving Delta Version History"
            >
              <History size={14} />
              History ({note.versions.length})
            </button>

            <button
              type="button"
              className="icon-btn"
              onClick={handleCloseWithFlush}
              title="Save & Close"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Sub-toolbar: Unlimited Char Stats, Fast Jump Scrubber, 500K Stress Test & Mode Toggle */}
        <div className="editor-stats-bar">
          <div className="stats-pills">
            <span>
              <strong>{docStats.totalChars.toLocaleString()}</strong> chars (No limit)
            </span>
            <span>•</span>
            <span>
              <strong>{docStats.totalBlocks.toLocaleString()}</strong> virtual blocks
            </span>
            <span>•</span>
            <span>
              <strong>{docStats.totalWords.toLocaleString()}</strong> words
            </span>
          </div>

          <div className="editor-mode-controls">
            <div className="jump-scrubber">
              <label htmlFor="line-scrubber">Fast Scroll:</label>
              <input
                id="line-scrubber"
                type="range"
                min={0}
                max={Math.max(0, blocks.length - 1)}
                defaultValue={0}
                onChange={(e) => {
                  const targetIdx = Number(e.target.value);
                  rowVirtualizer.scrollToIndex(targetIdx, { align: 'start' });
                }}
              />
            </div>

            <button
              type="button"
              className="btn-chip"
              onClick={() => handleAppendStressTest(500_000)}
              title="Generate +500,000 characters to test unlimited length & fast virtualized scrolling"
            >
              <Sparkles size={13} />
              +500K Chars Stress Test
            </button>

            <button
              type="button"
              className="btn-chip"
              onClick={() =>
                setEditorMode((m) => (m === 'virtual-blocks' ? 'raw-stream' : 'virtual-blocks'))
              }
            >
              {editorMode === 'virtual-blocks' ? 'Raw Text View' : 'Virtualized Blocks View'}
            </button>
          </div>
        </div>

        {/* Virtualized Viewport Container */}
        {editorMode === 'virtual-blocks' ? (
          <div ref={parentScrollRef} className="virtual-editor-viewport">
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const block = blocks[virtualRow.index];
                if (!block) return null;
                const isEditingThisRow = activeBlockIdx === virtualRow.index;

                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    className={`virtual-block-row kind-${block.kind} ${
                      isEditingThisRow ? 'editing' : ''
                    }`}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    onClick={() => setActiveBlockIdx(virtualRow.index)}
                  >
                    <span className="line-gutter">{virtualRow.index + 1}</span>
                    {isEditingThisRow ? (
                      <textarea
                        autoFocus
                        className="block-textarea"
                        value={block.text}
                        rows={Math.max(1, Math.ceil((block.text.length || 1) / 76))}
                        onChange={(e) => handleBlockEdit(virtualRow.index, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowDown' && e.currentTarget.selectionStart === block.text.length) {
                            if (virtualRow.index + 1 < blocks.length) {
                              e.preventDefault();
                              setActiveBlockIdx(virtualRow.index + 1);
                            }
                          } else if (e.key === 'ArrowUp' && e.currentTarget.selectionStart === 0) {
                            if (virtualRow.index > 0) {
                              e.preventDefault();
                              setActiveBlockIdx(virtualRow.index - 1);
                            }
                          } else if (
                            e.key === 'Backspace' &&
                            block.text.length === 0 &&
                            blocks.length > 1
                          ) {
                            e.preventDefault();
                            const nextBlocks = blocks.filter((_, idx) => idx !== virtualRow.index);
                            const nextContent = nextBlocks.map((b) => b.text).join('\n');
                            setBlocks(buildDocumentBlocks(nextContent));
                            setFullContent(nextContent);
                            setSaveState('saving');
                            autosaveRef.current?.scheduleSave(note.id, title, nextContent);
                            setActiveBlockIdx(Math.max(0, virtualRow.index - 1));
                          }
                        }}
                      />
                    ) : (
                      <div className="block-rendered-line">
                        {block.kind === 'checkbox-unchecked' || block.kind === 'checkbox-checked' ? (
                          <label
                            className="inline-checkbox"
                            onClick={(e) => {
                              e.stopPropagation();
                              const toggled =
                                block.kind === 'checkbox-checked'
                                  ? block.text.replace(/^([*-]\s*)\[[xX]\]/, '$1[ ]')
                                  : block.text.replace(/^([*-]\s*)\[\s\]/, '$1[x]');
                              handleBlockEdit(virtualRow.index, toggled);
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={block.kind === 'checkbox-checked'}
                              readOnly
                            />
                            <span
                              className={
                                block.kind === 'checkbox-checked' ? 'checked-line-text' : ''
                              }
                            >
                              {block.text.replace(/^[*-]\s*\[[ xX]\]\s*/, '')}
                            </span>
                          </label>
                        ) : (
                          <span>{block.text || '\u00A0'}</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="raw-stream-container">
            <textarea
              className="raw-stream-textarea"
              value={fullContent}
              placeholder="Write your note in Markdown or plain text (unlimited length)..."
              onChange={(e) => handleRawContentChange(e.target.value)}
            />
          </div>
        )}

        {/* Tags & Color Picker Footer */}
        <div className="editor-footer">
          <div className="footer-left">
            {/* Color Palette */}
            <div className="color-picker-row">
              {NOTE_PALETTE_COLORS.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  className={`color-dot ${note.color === swatch ? 'selected' : ''}`}
                  style={{ backgroundColor: swatch }}
                  onClick={() => onUpdateNote(note.id, { color: swatch })}
                  title={`Color ${swatch}`}
                />
              ))}
            </div>

            {/* Tags */}
            <div className="tags-row">
              {note.tags.map((tag) => (
                <span key={tag} className="tag-pill">
                  #{tag}
                  <button type="button" onClick={() => handleRemoveTag(tag)}>
                    ×
                  </button>
                </span>
              ))}
              <form onSubmit={handleAddTag} className="tag-form">
                <input
                  type="text"
                  placeholder="+ Add tag"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                />
              </form>
            </div>
          </div>

          <div className="footer-right">
            {/* Export & Desktop Share Menu */}
            <div className="dropdown-wrapper">
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => {
                  setShowExportMenu((v) => !v);
                  setShowSnoozeMenu(false);
                }}
              >
                <Download size={14} />
                Export & Share
              </button>
              {showExportMenu && (
                <div className="popover-menu">
                  <div className="popover-section-title">Copy & Local Files</div>
                  <button type="button" className="popover-item" onClick={handleCopyNote}>
                    <Copy size={14} /> Copy to Clipboard
                  </button>
                  <button
                    type="button"
                    className="popover-item"
                    onClick={() => handleDownloadFile('md')}
                  >
                    <Download size={14} /> Export Markdown (.md)
                  </button>
                  <button
                    type="button"
                    className="popover-item"
                    onClick={() => handleDownloadFile('txt')}
                  >
                    <Download size={14} /> Export Plain Text (.txt)
                  </button>
                  <button
                    type="button"
                    className="popover-item"
                    onClick={() => handleDownloadFile('html')}
                  >
                    <Download size={14} /> Export Web Page (.html)
                  </button>
                  <button
                    type="button"
                    className="popover-item"
                    onClick={() => handleDownloadFile('json')}
                  >
                    <Download size={14} /> Export AOK Bundle (.aok.json)
                  </button>

                  <div className="popover-divider" />
                  <div className="popover-section-title">Share with Personal PC Desktop</div>
                  <button
                    type="button"
                    className="popover-item highlight"
                    onClick={async () => {
                      setShowExportMenu(false);
                      await onShareToDesktop({ ...note, title, content: fullContent }, 'md');
                    }}
                  >
                    <Laptop size={14} /> Send .md to Personal PC
                  </button>
                  <button
                    type="button"
                    className="popover-item"
                    onClick={async () => {
                      setShowExportMenu(false);
                      await onShareToDesktop({ ...note, title, content: fullContent }, 'txt');
                    }}
                  >
                    <Laptop size={14} /> Send .txt to Personal PC
                  </button>
                </div>
              )}
            </div>

            {/* Snooze Delete Menu */}
            <div className="dropdown-wrapper">
              <button
                type="button"
                className="btn-secondary btn-sm snooze-btn"
                onClick={() => {
                  setShowSnoozeMenu((v) => !v);
                  setShowExportMenu(false);
                }}
              >
                <Timer size={14} />
                Snooze Delete
              </button>
              {showSnoozeMenu && (
                <div className="popover-menu">
                  <div className="popover-section-title">
                    Temporarily delete & bring back after:
                  </div>
                  {SNOOZE_DELETE_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className="popover-item"
                      onClick={() => {
                        autosaveRef.current?.flushNow();
                        onSnoozeDelete(
                          { ...note, title, content: fullContent },
                          Date.now() + preset.durationMs
                        );
                        setShowSnoozeMenu(false);
                        onClose();
                      }}
                    >
                      <Timer size={14} />
                      <div>
                        <div>{preset.label}</div>
                        <small>{preset.description}</small>
                      </div>
                    </button>
                  ))}
                  <div className="popover-divider" />
                  <div className="custom-snooze-row">
                    <input
                      type="number"
                      min={1}
                      value={customSnoozeMinutes}
                      onChange={(e) => setCustomSnoozeMinutes(e.target.value)}
                    />
                    <span>mins</span>
                    <button
                      type="button"
                      className="btn-primary btn-xs"
                      onClick={() => {
                        const mins = Math.max(1, Number(customSnoozeMinutes) || 5);
                        autosaveRef.current?.flushNow();
                        onSnoozeDelete(
                          { ...note, title, content: fullContent },
                          Date.now() + mins * 60_000
                        );
                        setShowSnoozeMenu(false);
                        onClose();
                      }}
                    >
                      Snooze
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Standard Delete */}
            <button
              type="button"
              className="btn-danger btn-sm"
              onClick={() => {
                autosaveRef.current?.flushNow();
                onSoftDelete({ ...note, title, content: fullContent });
                onClose();
              }}
            >
              <Trash2 size={14} />
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
