import React, { useState } from 'react';
import { Fingerprint, KeyRound, Lock, ShieldCheck, X } from 'lucide-react';

interface FirstTimePinModalProps {
  noteTitle?: string;
  onConfirmSetup: (newPin: string, enableBiometrics: boolean) => Promise<void>;
  onCancel: () => void;
}

export const FirstTimePinModal: React.FC<FirstTimePinModalProps> = ({
  noteTitle,
  onConfirmSetup,
  onCancel,
}) => {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [enableBiometrics, setEnableBiometrics] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (pin.trim().length < 4) {
      setError('Please enter a PIN with at least 4 characters.');
      return;
    }
    if (pin !== confirmPin) {
      setError('PIN confirmation does not match.');
      return;
    }

    setSubmitting(true);
    try {
      await onConfirmSetup(pin, enableBiometrics);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to configure Safe PIN');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <div className="dialog-title">
            <Lock size={20} className="accent-icon" />
            <div>
              <h3>Create Your Safe PIN</h3>
              <p>
                {noteTitle
                  ? `Set up a PIN to lock "${noteTitle || 'Untitled'}" into your Safe.`
                  : 'All locked notes are grouped in your Safe and unlocked with one login.'}
              </p>
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="dialog-form">
          <div className="form-group">
            <label htmlFor="first-pin-input">
              <KeyRound size={14} /> New Safe PIN (4+ digits or passphrase)
            </label>
            <input
              id="first-pin-input"
              type="password"
              autoFocus
              placeholder="Enter new PIN..."
              value={pin}
              onChange={(e) => setPin(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="confirm-pin-input">Confirm Safe PIN</label>
            <input
              id="confirm-pin-input"
              type="password"
              placeholder="Re-enter PIN..."
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value)}
            />
          </div>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={enableBiometrics}
              onChange={(e) => setEnableBiometrics(e.target.checked)}
            />
            <Fingerprint size={16} />
            <span>
              Also enable Device Biometric Unlock (FaceID / TouchID / Windows Hello / Passkey)
            </span>
          </label>

          <div className="info-callout">
            <ShieldCheck size={16} />
            <span>
              You can reset or change this PIN anytime in the <strong>Settings</strong> panel.
            </span>
          </div>

          {error && <div className="error-banner">{error}</div>}

          <div className="dialog-actions">
            <button type="button" className="btn-secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Encrypting...' : 'Set PIN & Lock to Safe'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
