import React, { useState } from 'react';
import { SafeConfig } from '@aoknotes/core';
import {
  Fingerprint,
  HardDrive,
  KeyRound,
  RotateCcw,
  Settings,
  ShieldAlert,
  X,
} from 'lucide-react';

interface SettingsModalProps {
  safeConfig: SafeConfig;
  isSafeUnlocked: boolean;
  totalNotesCount: number;
  totalCharsAcrossAllNotes: number;
  onChangeOrResetPin: (params: {
    currentPin?: string;
    newPin: string;
    enableBiometrics: boolean;
    forceResetVault: boolean;
  }) => Promise<void>;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  safeConfig,
  isSafeUnlocked,
  totalNotesCount,
  totalCharsAcrossAllNotes,
  onChangeOrResetPin,
  onClose,
}) => {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmNewPin, setConfirmNewPin] = useState('');
  const [enableBiometrics, setEnableBiometrics] = useState(
    safeConfig.isConfigured ? safeConfig.biometricsEnabled : true
  );
  const [forceResetVault, setForceResetVault] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handlePinResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMessage(null);
    setErrorMessage(null);

    if (newPin.trim().length < 4) {
      setErrorMessage('New Safe PIN must be at least 4 characters.');
      return;
    }
    if (newPin !== confirmNewPin) {
      setErrorMessage('New PIN and confirmation do not match.');
      return;
    }

    setSaving(true);
    try {
      await onChangeOrResetPin({
        currentPin: currentPin || undefined,
        newPin,
        enableBiometrics,
        forceResetVault,
      });
      setCurrentPin('');
      setNewPin('');
      setConfirmNewPin('');
      setForceResetVault(false);
      setStatusMessage('Safe PIN has been updated!');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to update Safe PIN.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="dialog-card settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <div className="dialog-title">
            <Settings size={20} />
            <div>
              <h3>Settings & Safe Security</h3>
              <p>Manage your Safe PIN, biometric privacy lock, and local storage preferences.</p>
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="settings-section">
          <h4>
            <KeyRound size={16} /> {safeConfig.isConfigured ? 'Change or Reset Safe PIN' : 'Set Up Safe PIN'}
          </h4>
          <p className="settings-desc">
            {safeConfig.isConfigured
              ? 'Update the PIN used to unlock your Safe. If your Safe is currently unlocked or you enter your current PIN, all existing Safe notes are preserved automatically.'
              : 'Configure a PIN for locking sensitive pages into your Safe.'}
          </p>

          <form onSubmit={handlePinResetSubmit} className="dialog-form">
            {safeConfig.isConfigured && !isSafeUnlocked && !forceResetVault && (
              <div className="form-group">
                <label htmlFor="settings-current-pin">Current Safe PIN</label>
                <input
                  id="settings-current-pin"
                  type="password"
                  placeholder="Enter current PIN..."
                  value={currentPin}
                  onChange={(e) => setCurrentPin(e.target.value)}
                />
              </div>
            )}

            <div className="form-row-2">
              <div className="form-group">
                <label htmlFor="settings-new-pin">New Safe PIN</label>
                <input
                  id="settings-new-pin"
                  type="password"
                  placeholder="New PIN (4+ chars)..."
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label htmlFor="settings-confirm-pin">Confirm New PIN</label>
                <input
                  id="settings-confirm-pin"
                  type="password"
                  placeholder="Re-enter new PIN..."
                  value={confirmNewPin}
                  onChange={(e) => setConfirmNewPin(e.target.value)}
                />
              </div>
            </div>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={enableBiometrics}
                onChange={(e) => setEnableBiometrics(e.target.checked)}
              />
              <Fingerprint size={16} />
              <span>Enable Phone / Device Biometric Privacy Unlock</span>
            </label>

            {safeConfig.isConfigured && !isSafeUnlocked && (
              <label className="checkbox-row warning-checkbox">
                <input
                  type="checkbox"
                  checked={forceResetVault}
                  onChange={(e) => setForceResetVault(e.target.checked)}
                />
                <ShieldAlert size={16} />
                <span>
                  Forgot current PIN? Force reset Safe PIN (creates a fresh Safe key)
                </span>
              </label>
            )}

            {statusMessage && <div className="success-banner">{statusMessage}</div>}
            {errorMessage && <div className="error-banner">{errorMessage}</div>}

            <button type="submit" className="btn-primary" disabled={saving}>
              <RotateCcw size={15} />
              {saving
                ? 'Updating PIN...'
                : safeConfig.isConfigured
                ? 'Save New Safe PIN'
                : 'Create Safe PIN'}
            </button>
          </form>
        </div>

        <div className="settings-divider" />

        <div className="settings-section">
          <h4>
            <HardDrive size={16} /> Local-First Storage & Versioning Guarantees
          </h4>
          <ul className="settings-guarantees-list">
            <li>
              <strong>Total Local Notes:</strong> {totalNotesCount} notes (
              {totalCharsAcrossAllNotes.toLocaleString()} total characters stored on device)
            </li>
            <li>
              <strong>Unlimited File Size:</strong> Note content has no character limit and version
              compaction never restricts file size or drops recent history on large files.
            </li>
            <li>
              <strong>Save on App Exit:</strong> Leaving the tab, closing the window, or
              backgrounding the phone app immediately flushes pending edits to local storage.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};
