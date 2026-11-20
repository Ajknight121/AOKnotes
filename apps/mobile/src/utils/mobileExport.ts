import { Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  BackupTargetConfig,
  ExportFileFormat,
  Note,
  PersonalPcSyncProvider,
  exportNoteToFileArtifact,
  formatNoteForClipboard,
} from '@aoknotes/core';

export async function copyNoteToPhoneClipboard(note: Note): Promise<void> {
  const formatted = formatNoteForClipboard(note);
  await Clipboard.setStringAsync(formatted);
}

export async function exportAndShareNoteFileOnPhone(
  note: Note,
  format: ExportFileFormat
): Promise<string> {
  const artifact = exportNoteToFileArtifact(note, format);

  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const blob = new Blob([artifact.content], { type: artifact.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = artifact.fileName;
    a.click();
    URL.revokeObjectURL(url);
    return artifact.fileName;
  }

  const baseDir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? '';
  const targetUri = `${baseDir}${artifact.fileName}`;

  await FileSystem.writeAsStringAsync(targetUri, artifact.content, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(targetUri, {
      mimeType: artifact.mimeType,
      dialogTitle: `Export ${note.title || 'Note'}`,
    });
  }

  return targetUri;
}

export async function shareNoteFromPhoneToDesktop(
  note: Note,
  pcTarget: BackupTargetConfig,
  format: 'md' | 'txt' | 'json' = 'md'
): Promise<{ savedPath: string; fileName: string }> {
  const provider = new PersonalPcSyncProvider(pcTarget);
  return provider.shareNoteToDesktop(note, format);
}
