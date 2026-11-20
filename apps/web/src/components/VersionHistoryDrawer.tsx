import React, { useMemo, useState } from 'react';
import {
  MIN_GUARANTEED_VERSIONS,
  Note,
  reconstructVersionContent,
} from '@aoknotes/core';
import { CheckCircle2, History, RotateCcw, ShieldCheck, X } from 'lucide-react';

interface VersionHistoryDrawerProps {
  note: Note;
  onRestoreVersion: (noteId: string, restoredContent: string) => void;
  onClose: () => void;
}

export const VersionHistoryDrawer: React.FC<VersionHistoryDrawerProps> = ({
  note,
  onRestoreVersion,
  onClose,
}) => {
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    note.versions[0]?.id ?? null
  );

  const storageMetrics = useMemo(() => {
    const totalDeltaBytes = note.versions.reduce((sum, v) => sum + v.byteSize, 0);
    const hypotheticalFullCopiesBytes = note.versions.reduce(
      (sum, v) => sum + Math.max(v.charCountAtVersion, note.content.length),
      0
    );
    const savingsPercent =
      hypotheticalFullCopiesBytes > 0
        ? Math.max(
            0,
            Math.round(
              ((hypotheticalFullCopiesBytes - totalDeltaBytes) / hypotheticalFullCopiesBytes) * 100
            )
          )
        : 100;
    return {
      totalDeltaBytes,
      hypotheticalFullCopiesBytes,
      savingsPercent,
    };
  }, [note]);

  const previewContent = useMemo(() => {
    if (!selectedVersionId) return null;
    return reconstructVersionContent(note, selectedVersionId);
  }, [note, selectedVersionId]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="history-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div className="drawer-title">
            <History size={20} />
            <div>
              <h3>Space-Saving Version History</h3>
              <p>
                Reverse line-deltas + time-bucket compaction (Guaranteed min{' '}
                {MIN_GUARANTEED_VERSIONS} checkpoints on any file size)
              </p>
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="storage-efficiency-banner">
          <ShieldCheck size={18} />
          <div>
            <strong>{storageMetrics.savingsPercent}% storage saved</strong> — Storing{' '}
            {note.versions.length} versions in{' '}
            <strong>{(storageMetrics.totalDeltaBytes / 1024).toFixed(2)} KB</strong> instead of{' '}
            {(storageMetrics.hypotheticalFullCopiesBytes / 1024).toFixed(2)} KB of full copies.
            Never limits note size.
          </div>
        </div>

        {note.versions.length === 0 ? (
          <div className="empty-state">
            <p>No prior versions recorded yet. Edit this note to generate delta history.</p>
          </div>
        ) : (
          <div className="history-split-layout">
            <div className="version-timeline-list">
              {note.versions.map((ver, idx) => (
                <button
                  key={ver.id}
                  type="button"
                  className={`version-item ${selectedVersionId === ver.id ? 'active' : ''}`}
                  onClick={() => setSelectedVersionId(ver.id)}
                >
                  <div className="version-item-top">
                    <span className={`bucket-badge bucket-${ver.bucket}`}>{ver.bucket}</span>
                    <span className="version-time">
                      {new Date(ver.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  </div>
                  <div className="version-summary">
                    {idx === 0 ? 'Latest Checkpoint: ' : ''}
                    {ver.summary}
                  </div>
                  <div className="version-meta">
                    Delta patch: {ver.byteSize} B • Doc length:{' '}
                    {ver.charCountAtVersion.toLocaleString()} chars
                  </div>
                </button>
              ))}
            </div>

            <div className="version-preview-pane">
              {selectedVersionId && previewContent !== null ? (
                <>
                  <div className="preview-pane-header">
                    <span>Historical Snapshot Preview ({previewContent.length.toLocaleString()} chars)</span>
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      onClick={() => {
                        onRestoreVersion(note.id, previewContent);
                        onClose();
                      }}
                    >
                      <RotateCcw size={14} />
                      Restore This Version
                    </button>
                  </div>
                  <pre className="version-preview-content">{previewContent}</pre>
                </>
              ) : (
                <div className="empty-state">
                  <CheckCircle2 size={24} />
                  <p>Select a version checkpoint on the left to inspect and restore.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
