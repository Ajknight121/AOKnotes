import React, { useEffect, useState } from 'react';
import { Note, formatSnoozeRemaining } from '@aoknotes/core';
import { RotateCcw, Timer, Trash2 } from 'lucide-react';

interface TrashAndSnoozeViewProps {
  snoozedNotes: Note[];
  trashedNotes: Note[];
  onRestoreNote: (note: Note) => void;
  onPermanentDelete: (noteId: string) => void;
  onEmptyTrash: () => void;
}

export const TrashAndSnoozeView: React.FC<TrashAndSnoozeViewProps> = ({
  snoozedNotes,
  trashedNotes,
  onRestoreNote,
  onPermanentDelete,
  onEmptyTrash,
}) => {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="trash-snooze-container">
      {/* 1. Snooze-Deleted Notes Section */}
      <div className="trash-section">
        <div className="section-banner snooze-banner">
          <div className="banner-left">
            <Timer size={20} />
            <div>
              <strong>Snooze-Deleted Notes ({snoozedNotes.length})</strong>
              <span>
                These deleted files are temporarily hidden and will automatically return to your
                active notes board when their timer finishes.
              </span>
            </div>
          </div>
        </div>

        {snoozedNotes.length === 0 ? (
          <div className="empty-inline-box">
            No snooze-deleted notes right now. Use <strong>Snooze Delete</strong> inside any note to
            temporarily delete a file and have it come back automatically later.
          </div>
        ) : (
          <div className="notes-grid">
            {snoozedNotes.map((note) => (
              <div
                key={note.id}
                className="note-card snoozed-card"
                style={{ backgroundColor: note.color || '#ffffff' }}
              >
                <div className="note-card-header">
                  <h4>{note.title || 'Untitled Note'}</h4>
                  <span className="snooze-countdown-badge">
                    <Timer size={12} />
                    {note.snoozeUntil
                      ? formatSnoozeRemaining(note.snoozeUntil, now)
                      : 'Snoozed'}
                  </span>
                </div>
                <p className="note-card-preview">
                  {note.lock.inSafe
                    ? '🔒 Protected Safe Note'
                    : note.content.slice(0, 180) || 'Empty note'}
                </p>
                <div className="note-card-footer">
                  <button
                    type="button"
                    className="btn-primary btn-xs"
                    onClick={() => onRestoreNote(note)}
                  >
                    <RotateCcw size={12} /> Bring Back Now
                  </button>
                  <button
                    type="button"
                    className="btn-danger btn-xs"
                    onClick={() => onPermanentDelete(note.id)}
                  >
                    <Trash2 size={12} /> Delete Forever
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 2. Standard Recently Deleted (Trash) Section */}
      <div className="trash-section">
        <div className="section-banner trash-banner">
          <div className="banner-left">
            <Trash2 size={20} />
            <div>
              <strong>Recently Deleted ({trashedNotes.length})</strong>
              <span>Notes in Trash are retained locally for 30 days before permanent removal.</span>
            </div>
          </div>
          {trashedNotes.length > 0 && (
            <button type="button" className="btn-danger btn-sm" onClick={onEmptyTrash}>
              <Trash2 size={14} /> Empty Trash
            </button>
          )}
        </div>

        {trashedNotes.length === 0 ? (
          <div className="empty-inline-box">Recently Deleted is empty.</div>
        ) : (
          <div className="notes-grid">
            {trashedNotes.map((note) => (
              <div
                key={note.id}
                className="note-card trashed-card"
                style={{ backgroundColor: note.color || '#ffffff' }}
              >
                <div className="note-card-header">
                  <h4>{note.title || 'Untitled Note'}</h4>
                  <span className="trashed-badge">Deleted</span>
                </div>
                <p className="note-card-preview">
                  {note.lock.inSafe
                    ? '🔒 Protected Safe Note'
                    : note.content.slice(0, 180) || 'Empty note'}
                </p>
                <div className="note-card-footer">
                  <button
                    type="button"
                    className="btn-secondary btn-xs"
                    onClick={() => onRestoreNote(note)}
                  >
                    <RotateCcw size={12} /> Restore
                  </button>
                  <button
                    type="button"
                    className="btn-danger btn-xs"
                    onClick={() => onPermanentDelete(note.id)}
                  >
                    <Trash2 size={12} /> Delete Forever
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
