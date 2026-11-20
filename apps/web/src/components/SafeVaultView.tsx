import React, { useState } from 'react';
import { Note, SafeConfig } from '@aoknotes/core';
import {
  Fingerprint,
  KeyRound,
  Lock,
  Plus,
  Shield,
  Unlock,
} from 'lucide-react';

interface SafeVaultViewProps {
  safeConfig: SafeConfig;
  isSafeUnlocked: boolean;
  safeNotes: Note[];
  onUnlockWithPin: (pin: string) => Promise<void>;
  onUnlockWithBiometrics: () => Promise<void>;
  onLockSafeSession: () => void;
  onOpenSetupSafeModal: () => void;
  onSelectNote: (note: Note) => void;
  onCreateNoteInSafe: () => void;
  onRemoveFromSafe: (note: Note) => void;
  onOpenSettingsPinReset: () => void;
}

export const SafeVaultView: React.FC<SafeVaultViewProps> = ({
  safeConfig,
  isSafeUnlocked,
  safeNotes,
  onUnlockWithPin,
  onUnlockWithBiometrics,
  onLockSafeSession,
  onOpenSetupSafeModal,
  onSelectNote,
  onCreateNoteInSafe,
  onRemoveFromSafe,
  onOpenSettingsPinReset,
}) => {
  const [pinInput, setPinInput] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setUnlocking(true);
    try {
      await onUnlockWithPin(pinInput);
      setPinInput('');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Incorrect Safe PIN.');
    } finally {
      setUnlocking(false);
    }
  };

  const handleBiometricClick = async () => {
    setAuthError(null);
    setUnlocking(true);
    try {
      await onUnlockWithBiometrics();
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Biometric unlock failed; please use your PIN.'
      );
    } finally {
      setUnlocking(false);
    }
  };

  if (!safeConfig.isConfigured) {
    return (
      <div className="safe-gate-container">
        <div className="safe-gate-card">
          <div className="safe-icon-circle">
            <Shield size={32} />
          </div>
          <h2>Set Up Your Encrypted Safe</h2>
          <p>
            All locked notes are grouped together inside your <strong>Safe</strong>. You only need to
            authenticate once per session with your PIN or device biometrics to view and edit all
            notes inside the Safe.
          </p>
          <button type="button" className="btn-primary" onClick={onOpenSetupSafeModal}>
            <KeyRound size={16} /> Create Safe PIN Now
          </button>
        </div>
      </div>
    );
  }

  if (!isSafeUnlocked) {
    return (
      <div className="safe-gate-container">
        <div className="safe-gate-card">
          <div className="safe-icon-circle locked">
            <Lock size={32} />
          </div>
          <h2>Safe Locked ({safeNotes.length} Protected Notes)</h2>
          <p>
            Enter your Safe PIN or use device biometrics once to unlock and view all notes in your
            Safe.
          </p>

          <form onSubmit={handlePinSubmit} className="safe-unlock-form">
            <input
              type="password"
              autoFocus
              placeholder="Enter Safe PIN..."
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
            />
            <button type="submit" className="btn-primary" disabled={unlocking}>
              <Unlock size={16} /> {unlocking ? 'Unlocking...' : 'Unlock Safe'}
            </button>
          </form>

          {safeConfig.biometricsEnabled && (
            <button
              type="button"
              className="btn-secondary biometric-unlock-btn"
              onClick={handleBiometricClick}
              disabled={unlocking}
            >
              <Fingerprint size={18} />
              Unlock with Device Biometrics
            </button>
          )}

          {authError && <div className="error-banner">{authError}</div>}

          <div className="safe-gate-footer">
            <button type="button" className="text-link-btn" onClick={onOpenSettingsPinReset}>
              Forgot or need to reset your PIN? Open Settings
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="safe-unlocked-view">
      <div className="section-banner safe-banner">
        <div className="banner-left">
          <Shield size={20} />
          <div>
            <strong>Safe Unlocked for Session</strong>
            <span>
              All {safeNotes.length} locked notes are accessible with this single login. Leaving the
              app automatically locks the Safe.
            </span>
          </div>
        </div>
        <div className="banner-actions">
          <button type="button" className="btn-primary btn-sm" onClick={onCreateNoteInSafe}>
            <Plus size={15} /> New Safe Note
          </button>
          <button type="button" className="btn-secondary btn-sm" onClick={onLockSafeSession}>
            <Lock size={15} /> Lock Safe Now
          </button>
        </div>
      </div>

      {safeNotes.length === 0 ? (
        <div className="empty-board-state">
          <Lock size={36} />
          <h3>Your Safe is empty</h3>
          <p>
            Click <strong>"Move to Safe"</strong> on any note or create a new Safe note above to
            protect sensitive pages with AES-256-GCM encryption.
          </p>
        </div>
      ) : (
        <div className="notes-grid">
          {safeNotes.map((note) => (
            <div
              key={note.id}
              className="note-card safe-note-card"
              style={{ backgroundColor: note.color || '#ffffff' }}
              onClick={() => onSelectNote(note)}
            >
              <div className="note-card-header">
                <h4>{note.title || 'Untitled Safe Note'}</h4>
                <span className="safe-pill">
                  <Lock size={11} /> Safe
                </span>
              </div>
              <p className="note-card-preview">
                {note.content.slice(0, 220) || 'Empty note...'}
              </p>
              <div className="note-card-footer" onClick={(e) => e.stopPropagation()}>
                <span className="char-count-meta">
                  {note.content.length.toLocaleString()} chars
                </span>
                <button
                  type="button"
                  className="btn-chip"
                  onClick={() => onRemoveFromSafe(note)}
                  title="Decrypt and move back to main Notes board"
                >
                  <Unlock size={12} /> Move Out of Safe
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
