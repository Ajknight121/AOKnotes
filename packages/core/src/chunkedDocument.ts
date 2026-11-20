/**
 * Unlimited-length Chunked Document Manager.
 * Splits arbitrarily large notes (100K to 5M+ characters) into logical line/paragraph blocks
 * so virtualized list renderers (@tanstack/react-virtual on Web, FlatList on Mobile)
 * only mount the ~30-50 blocks visible in the viewport.
 */

export interface DocumentBlock {
  /** Stable block ID for virtualized rendering keys */
  id: string;
  /** 0-based index of this block */
  index: number;
  /** Raw text content of this line/paragraph block (without trailing newline) */
  text: string;
  /** Character offset from the start of the document */
  charOffset: number;
  /** Estimated visual height in pixels for virtualizer measurement */
  estimatedHeight: number;
  /** Detected Markdown block kind for instant syntax styling */
  kind: 'heading1' | 'heading2' | 'heading3' | 'checkbox-unchecked' | 'checkbox-checked' | 'bullet' | 'quote' | 'code' | 'paragraph';
}

export interface ChunkedDocumentStats {
  totalChars: number;
  totalBlocks: number;
  totalWords: number;
  estimatedReadMinutes: number;
}

export function detectBlockKind(line: string): DocumentBlock['kind'] {
  if (line.startsWith('# ')) return 'heading1';
  if (line.startsWith('## ')) return 'heading2';
  if (line.startsWith('### ')) return 'heading3';
  if (line.startsWith('- [ ] ') || line.startsWith('* [ ] ')) return 'checkbox-unchecked';
  if (line.startsWith('- [x] ') || line.startsWith('- [X] ') || line.startsWith('* [x] ')) return 'checkbox-checked';
  if (line.startsWith('- ') || line.startsWith('* ')) return 'bullet';
  if (line.startsWith('> ')) return 'quote';
  if (line.startsWith('```') || line.startsWith('    ')) return 'code';
  return 'paragraph';
}

export function estimateBlockHeight(line: string, kind: DocumentBlock['kind'], charsPerVisualRow = 78): number {
  const baseLineHeight =
    kind === 'heading1' ? 42 :
    kind === 'heading2' ? 36 :
    kind === 'heading3' ? 32 : 28;
  const wrappedRows = Math.max(1, Math.ceil((line.length || 1) / charsPerVisualRow));
  return wrappedRows * baseLineHeight + 6;
}

/**
 * Splits a raw string of any size (including 1,000,000+ characters) into indexed DocumentBlocks.
 */
export function buildDocumentBlocks(content: string, charsPerVisualRow = 78): DocumentBlock[] {
  const rawLines = content.split('\n');
  const blocks: DocumentBlock[] = new Array(rawLines.length);
  let charOffset = 0;

  for (let i = 0; i < rawLines.length; i++) {
    const text = rawLines[i];
    const kind = detectBlockKind(text);
    blocks[i] = {
      id: `blk-${i}`,
      index: i,
      text,
      charOffset,
      estimatedHeight: estimateBlockHeight(text, kind, charsPerVisualRow),
      kind,
    };
    charOffset += text.length + 1; // +1 for '\n'
  }

  return blocks;
}

/**
 * Updates a single block at `blockIndex` (including when the user presses Enter and inserts a newline
 * inside a block) and returns the updated blocks array and joined document string.
 */
export function updateDocumentBlock(
  blocks: DocumentBlock[],
  blockIndex: number,
  newBlockText: string,
  charsPerVisualRow = 78
): { blocks: DocumentBlock[]; content: string } {
  if (blockIndex < 0 || blockIndex >= blocks.length) {
    return { blocks, content: joinDocumentBlocks(blocks) };
  }

  const splitLines = newBlockText.split('\n');
  const nextBlocks = blocks.slice();

  const replacementBlocks: DocumentBlock[] = splitLines.map((lineText, subIdx) => {
    const kind = detectBlockKind(lineText);
    return {
      id: `blk-${blockIndex + subIdx}`,
      index: blockIndex + subIdx,
      text: lineText,
      charOffset: 0,
      estimatedHeight: estimateBlockHeight(lineText, kind, charsPerVisualRow),
      kind,
    };
  });

  nextBlocks.splice(blockIndex, 1, ...replacementBlocks);

  // Re-index from blockIndex onward
  let runningOffset = blockIndex > 0 ? nextBlocks[blockIndex - 1].charOffset + nextBlocks[blockIndex - 1].text.length + 1 : 0;
  for (let i = blockIndex; i < nextBlocks.length; i++) {
    nextBlocks[i] = {
      ...nextBlocks[i],
      id: `blk-${i}`,
      index: i,
      charOffset: runningOffset,
    };
    runningOffset += nextBlocks[i].text.length + 1;
  }

  return {
    blocks: nextBlocks,
    content: joinDocumentBlocks(nextBlocks),
  };
}

export function joinDocumentBlocks(blocks: DocumentBlock[]): string {
  const texts = new Array(blocks.length);
  for (let i = 0; i < blocks.length; i++) {
    texts[i] = blocks[i].text;
  }
  return texts.join('\n');
}

export function computeDocumentStats(content: string, blockCount?: number): ChunkedDocumentStats {
  const totalChars = content.length;
  const totalBlocks = blockCount ?? (totalChars === 0 ? 1 : content.split('\n').length);
  // Fast word count scan without allocating a massive regex match array on 1M+ char strings
  let totalWords = 0;
  let inWord = false;
  for (let i = 0; i < totalChars; i++) {
    const code = content.charCodeAt(i);
    const isSpace = code === 32 || code === 10 || code === 13 || code === 9;
    if (!isSpace && !inWord) {
      inWord = true;
      totalWords++;
    } else if (isSpace) {
      inWord = false;
    }
  }
  const estimatedReadMinutes = Math.max(1, Math.ceil(totalWords / 220));
  return {
    totalChars,
    totalBlocks,
    totalWords,
    estimatedReadMinutes,
  };
}

/**
 * Generates a realistic multi-hundred-thousand or million-character Markdown note
 * to benchmark and demonstrate unlimited character capacity & 60fps virtualized scrolling.
 */
export function generateLargeNoteBenchmarkContent(targetCharCount = 500_000): string {
  const sections: string[] = [
    '# Massive Local-First Note Benchmark',
    '> Generated to verify unlimited character capacity and 60fps virtualized block scrolling.',
    '',
  ];
  let currentLength = sections.join('\n').length;
  let sectionNum = 1;

  while (currentLength < targetCharCount) {
    const block = [
      `## Section ${sectionNum}: Architectural & Field Notes (Offset ~${currentLength.toLocaleString()} chars)`,
      `- [x] Verify zero lag when scrolling past line ${sectionNum * 8}`,
      `- [ ] Review local sync checkpoint #${sectionNum} and delta history compaction`,
      `Paragraph ${sectionNum}: AOKnotes splits large documents into virtualized line blocks so only the visible viewport rows are mounted in the DOM or React Native FlatList. Even with hundreds of thousands or millions of characters, typing and scrolling remain instantaneous.`,
      `\`\`\`ts\n// Code snippet inside section ${sectionNum}\nconst checkpoint = { section: ${sectionNum}, charsSoFar: ${currentLength} };\n\`\`\``,
      '',
    ].join('\n');
    sections.push(block);
    currentLength += block.length + 1;
    sectionNum++;
  }

  return sections.join('\n');
}
