import { Note } from './types';

export type ExportFileFormat = 'md' | 'txt' | 'html' | 'json';

export interface ExportedNoteArtifact {
  fileName: string;
  mimeType: string;
  content: string;
}

export function sanitizeFileName(title: string): string {
  const base = (title || 'untitled-note')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return base || 'untitled-note';
}

export function formatNoteForClipboard(note: Note, includeTitle = true): string {
  if (!includeTitle || !note.title.trim()) {
    return note.content;
  }
  return `# ${note.title}\n\n${note.content}`;
}

export function exportNoteToFileArtifact(
  note: Note,
  format: ExportFileFormat
): ExportedNoteArtifact {
  const safeBase = sanitizeFileName(note.title);

  switch (format) {
    case 'md': {
      const yamlTags = note.tags.length > 0 ? `[${note.tags.map((t) => `"${t}"`).join(', ')}]` : '[]';
      const md = [
        '---',
        `title: "${note.title.replace(/"/g, '\\"')}"`,
        `id: "${note.id}"`,
        `updatedAt: "${new Date(note.updatedAt).toISOString()}"`,
        `tags: ${yamlTags}`,
        '---',
        '',
        `# ${note.title || 'Untitled Note'}`,
        '',
        note.content,
      ].join('\n');
      return {
        fileName: `${safeBase}.md`,
        mimeType: 'text/markdown;charset=utf-8',
        content: md,
      };
    }
    case 'txt': {
      const txt = `${note.title || 'Untitled Note'}\n${'='.repeat(
        Math.max(10, (note.title || 'Untitled Note').length)
      )}\n\n${note.content}\n`;
      return {
        fileName: `${safeBase}.txt`,
        mimeType: 'text/plain;charset=utf-8',
        content: txt,
      };
    }
    case 'html': {
      const escapedBody = note.content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      const escapedTitle = (note.title || 'Untitled Note')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapedTitle} — AOKnotes Export</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 820px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; color: #1e293b; }
    h1 { border-bottom: 1px solid #e2e8f0; padding-bottom: 0.5rem; }
    pre { white-space: pre-wrap; word-wrap: break-word; font-family: inherit; }
  </style>
</head>
<body>
  <h1>${escapedTitle}</h1>
  <pre>${escapedBody}</pre>
</body>
</html>`;
      return {
        fileName: `${safeBase}.html`,
        mimeType: 'text/html;charset=utf-8',
        content: html,
      };
    }
    case 'json': {
      const json = JSON.stringify(
        {
          schema: 'aoknotes-export-v1',
          exportedAt: Date.now(),
          note,
        },
        null,
        2
      );
      return {
        fileName: `${safeBase}.aok.json`,
        mimeType: 'application/json;charset=utf-8',
        content: json,
      };
    }
  }
}
