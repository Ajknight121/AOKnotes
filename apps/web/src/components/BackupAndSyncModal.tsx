import React, { useEffect, useState } from 'react';
import {
  BackupSyncResult,
  BackupTargetConfig,
  BackupTargetType,
  Note,
  createBackupProvider,
} from '@aoknotes/core';
import {
  CheckCircle2,
  Cloud,
  HardDrive,
  Laptop,
  RefreshCw,
  Server,
  Shield,
  Wifi,
  X,
} from 'lucide-react';

interface BackupAndSyncModalProps {
  targets: BackupTargetConfig[];
  notes: Note[];
  onUpdateTargets: (nextTargets: BackupTargetConfig[]) => void;
  onApplySyncedNotes: (mergedNotes: Note[], result: BackupSyncResult) => void;
  onClose: () => void;
  notify: (msg: string) => void;
}

export const BackupAndSyncModal: React.FC<BackupAndSyncModalProps> = ({
  targets,
  notes,
  onUpdateTargets,
  onApplySyncedNotes,
  onClose,
  notify,
}) => {
  const [pcOnlineStatus, setPcOnlineStatus] = useState<{
    online: boolean;
    details?: string;
  } | null>(null);
  const [busyTargetId, setBusyTargetId] = useState<string | null>(null);
  const [lastResults, setLastResults] = useState<Record<string, BackupSyncResult>>({});

  const pcTarget = targets.find((t) => t.type === 'pc-local') ?? targets[0];
  const cloudTargets = targets.filter((t) => t.type !== 'pc-local');

  const checkPcStatus = async (target: BackupTargetConfig) => {
    const provider = createBackupProvider(target);
    const status = await provider.testConnection();
    setPcOnlineStatus(status);
  };

  useEffect(() => {
    if (pcTarget) {
      void checkPcStatus(pcTarget);
    }
  }, [pcTarget?.endpointUrl]);

  const updateTargetField = (id: string, patch: Partial<BackupTargetConfig>) => {
    const next = targets.map((t) => (t.id === id ? { ...t, ...patch } : t));
    onUpdateTargets(next);
  };

  const handleRunDeltaSync = async (target: BackupTargetConfig) => {
    setBusyTargetId(target.id);
    try {
      const provider = createBackupProvider(target);
      const outcome = await provider.syncDelta(notes, target.lastSyncCursor);
      setLastResults((prev) => ({ ...prev, [target.id]: outcome.result }));
      updateTargetField(target.id, {
        lastSyncedAt: outcome.result.syncedAt,
        lastSyncCursor: outcome.newCursor,
      });
      onApplySyncedNotes(outcome.mergedNotes, outcome.result);
      notify(
        `Synced with ${target.displayName} (${outcome.result.pushedCount} pushed, ${outcome.result.pulledCount} pulled)`
      );
    } catch (err) {
      notify(
        `Sync failed for ${target.displayName}: ${
          err instanceof Error ? err.message : 'Unreachable'
        }`
      );
    } finally {
      setBusyTargetId(null);
    }
  };

  const handleRunManualOneTimeBackup = async (target: BackupTargetConfig) => {
    setBusyTargetId(`${target.id}-snapshot`);
    try {
      const provider = createBackupProvider(target);
      const result = await provider.manualOneTimeBackup(notes);
      setLastResults((prev) => ({ ...prev, [target.id]: result }));
      updateTargetField(target.id, { lastSyncedAt: result.syncedAt });
      notify(
        `One-time backup completed (${
          result.snapshotPath ? `Saved to ${result.snapshotPath}` : `${notes.length} notes backed up`
        })`
      );
    } catch (err) {
      notify(
        `One-time backup failed: ${
          err instanceof Error ? err.message : 'Make sure Personal PC daemon is running'
        }`
      );
    } finally {
      setBusyTargetId(null);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="dialog-card backup-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <div className="dialog-title">
            <Laptop size={20} />
            <div>
              <h3>Selectable Backup & Sync Locations</h3>
              <p>
                Keep data 100% local with automatic Personal PC sync while your PC is on, trigger
                manual one-time backups, or enable an optional pluggable Cloud provider.
              </p>
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* 1. Personal PC Local Backup & Sync */}
        {pcTarget && (
          <div className="backup-card primary-pc-card">
            <div className="backup-card-top">
              <div className="backup-card-title">
                <Laptop size={20} />
                <div>
                  <h4>Personal PC — Completely Local Backup & Sync</h4>
                  <span
                    className={`status-pill ${
                      pcOnlineStatus?.online ? 'online' : 'offline'
                    }`}
                  >
                    <Wifi size={12} />
                    {pcOnlineStatus?.online
                      ? pcOnlineStatus.details || 'PC Online on Local Network'
                      : 'PC Daemon Offline (Start apps/pc-daemon to sync over LAN)'}
                  </span>
                </div>
              </div>

              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={pcTarget.autoSyncWhenAvailable}
                  onChange={(e) =>
                    updateTargetField(pcTarget.id, {
                      autoSyncWhenAvailable: e.target.checked,
                    })
                  }
                />
                <span>Auto-sync while PC is on</span>
              </label>
            </div>

            <div className="form-row-2">
              <div className="form-group">
                <label>Personal PC LAN Endpoint URL</label>
                <div className="input-with-btn">
                  <input
                    type="text"
                    value={pcTarget.endpointUrl}
                    placeholder="http://192.168.1.x:4545"
                    onChange={(e) =>
                      updateTargetField(pcTarget.id, { endpointUrl: e.target.value })
                    }
                  />
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => checkPcStatus(pcTarget)}
                  >
                    Test PC
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label>Optional Pairing Token</label>
                <input
                  type="password"
                  value={pcTarget.pairingTokenOrApiKey ?? ''}
                  placeholder="Leave blank or enter LAN token"
                  onChange={(e) =>
                    updateTargetField(pcTarget.id, {
                      pairingTokenOrApiKey: e.target.value,
                    })
                  }
                />
              </div>
            </div>

            <div className="backup-card-actions">
              <button
                type="button"
                className="btn-primary btn-sm"
                disabled={busyTargetId === pcTarget.id}
                onClick={() => handleRunDeltaSync(pcTarget)}
              >
                <RefreshCw size={14} />
                {busyTargetId === pcTarget.id ? 'Syncing with PC...' : 'Sync Now with PC'}
              </button>

              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={busyTargetId === `${pcTarget.id}-snapshot`}
                onClick={() => handleRunManualOneTimeBackup(pcTarget)}
              >
                <HardDrive size={14} />
                {busyTargetId === `${pcTarget.id}-snapshot`
                  ? 'Creating Snapshot...'
                  : 'One-Time Full Backup Snapshot'}
              </button>

              {lastResults[pcTarget.id]?.snapshotPath && (
                <span className="snapshot-saved-note">
                  <CheckCircle2 size={13} /> Saved: {lastResults[pcTarget.id].snapshotPath}
                </span>
              )}
            </div>
          </div>
        )}

        {/* 2. Pluggable Optional Cloud Providers */}
        <div className="cloud-section-header">
          <h4>
            <Cloud size={16} /> Optional Cloud Backup (Pluggable Providers)
          </h4>
          <p>
            For users who want off-site cloud backup: connect your own cloud storage (WebDAV / S3 /
            Google Drive) or a self-hostable backend.
          </p>
        </div>

        <div className="cloud-providers-grid">
          {cloudTargets.map((target) => (
            <div key={target.id} className="backup-card">
              <div className="backup-card-top">
                <div className="backup-card-title">
                  {target.type === 'self-hosted-rest' ? (
                    <Server size={18} />
                  ) : (
                    <Cloud size={18} />
                  )}
                  <div>
                    <h4>{target.displayName}</h4>
                    <small>
                      Provider Adapter:{' '}
                      <code>
                        {target.type === 'self-hosted-rest'
                          ? 'SelfHostedRestProvider'
                          : 'UserOwnCloudProvider'}
                      </code>
                    </small>
                  </div>
                </div>

                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={target.enabled}
                    onChange={(e) =>
                      updateTargetField(target.id, { enabled: e.target.checked })
                    }
                  />
                  <span>{target.enabled ? 'Enabled' : 'Optional (Off)'}</span>
                </label>
              </div>

              {target.enabled && (
                <>
                  <div className="form-row-2">
                    <div className="form-group">
                      <label>Adapter Type</label>
                      <select
                        value={target.type}
                        onChange={(e) =>
                          updateTargetField(target.id, {
                            type: e.target.value as BackupTargetType,
                          })
                        }
                      >
                        <option value="user-cloud-webdav">
                          User Cloud — WebDAV / Nextcloud
                        </option>
                        <option value="user-cloud-s3">
                          User Cloud — S3 / Cloudflare R2 / MinIO
                        </option>
                        <option value="user-cloud-gdrive">
                          User Cloud — Google Drive AppFolder
                        </option>
                        <option value="self-hosted-rest">
                          Self-Hosted Backend (REST / Supabase)
                        </option>
                      </select>
                    </div>

                    <div className="form-group">
                      <label>Endpoint / Bucket URL</label>
                      <input
                        type="text"
                        value={target.endpointUrl}
                        onChange={(e) =>
                          updateTargetField(target.id, { endpointUrl: e.target.value })
                        }
                      />
                    </div>
                  </div>

                  <div className="backup-card-actions">
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={target.encryptBeforeUpload}
                        onChange={(e) =>
                          updateTargetField(target.id, {
                            encryptBeforeUpload: e.target.checked,
                          })
                        }
                      />
                      <Shield size={14} />
                      <span>Encrypt client-side before upload</span>
                    </label>

                    <div className="action-btn-group">
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        onClick={() => handleRunDeltaSync(target)}
                      >
                        <RefreshCw size={13} /> Sync Cloud
                      </button>
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => handleRunManualOneTimeBackup(target)}
                      >
                        One-Time Cloud Snapshot
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
