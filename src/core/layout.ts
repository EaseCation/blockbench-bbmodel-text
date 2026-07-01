export type TextAlign = 'left' | 'center' | 'right';
export type TextLayoutMode = 'auto_width' | 'fixed_width';

export interface TextMeasurer {
  measure(text: string): number;
}

export interface TextLayoutOptions {
  text: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  layoutMode: TextLayoutMode;
  boxWidth: number;
  align: TextAlign;
}

export interface TextLayoutLine {
  text: string;
  width: number;
  x: number;
  y: number;
}

export interface TextLayoutResult {
  width: number;
  height: number;
  lineHeightUnits: number;
  lines: TextLayoutLine[];
}

const MIN_TEXT_BOX_SIZE = 1;

function codepoints(text: string): string[] {
  return Array.from(text || '');
}

export function measureWithLetterSpacing(text: string, measurer: TextMeasurer, letterSpacing: number): number {
  const chars = codepoints(text);
  if (chars.length === 0) return 0;
  return chars.reduce((sum, char) => sum + measurer.measure(char), 0) + Math.max(0, chars.length - 1) * letterSpacing;
}

function pushWrappedCharacters(
  output: string[],
  seed: string,
  token: string,
  maxWidth: number,
  measurer: TextMeasurer,
  letterSpacing: number,
): string {
  let current = seed;
  for (const char of codepoints(token)) {
    const candidate = current + char;
    if (current && measureWithLetterSpacing(candidate, measurer, letterSpacing) > maxWidth) {
      output.push(current.trimEnd());
      current = char.trimStart();
    } else {
      current = candidate;
    }
  }
  return current;
}

function wrapParagraph(paragraph: string, maxWidth: number, measurer: TextMeasurer, letterSpacing: number): string[] {
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) return [paragraph];
  if (paragraph.length === 0) return [''];

  const output: string[] = [];
  const tokens = paragraph.match(/\s+|[^\s]+/gu) || [''];
  let current = '';

  for (const token of tokens) {
    const tokenWidth = measureWithLetterSpacing(token, measurer, letterSpacing);
    if (!current) {
      current = tokenWidth > maxWidth && !/^\s+$/u.test(token)
        ? pushWrappedCharacters(output, '', token, maxWidth, measurer, letterSpacing)
        : token;
      continue;
    }

    const candidate = current + token;
    if (measureWithLetterSpacing(candidate, measurer, letterSpacing) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (tokenWidth > maxWidth && !/^\s+$/u.test(token)) {
      current = pushWrappedCharacters(output, current, token, maxWidth, measurer, letterSpacing);
    } else {
      output.push(current.trimEnd());
      current = token.trimStart();
    }
  }

  output.push(current.trimEnd());
  return output;
}

export function layoutText(options: TextLayoutOptions, measurer: TextMeasurer): TextLayoutResult {
  const fontSize = Math.max(0.1, Number(options.fontSize) || 1);
  const lineHeight = Math.max(0.1, Number(options.lineHeight) || 1);
  const lineHeightUnits = fontSize * lineHeight;
  const letterSpacing = Number(options.letterSpacing) || 0;
  const paragraphs = String(options.text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const fixedWidth = Math.max(MIN_TEXT_BOX_SIZE, Number(options.boxWidth) || MIN_TEXT_BOX_SIZE);
  const shouldWrap = options.layoutMode === 'fixed_width';

  const rawLines = paragraphs.flatMap(paragraph => shouldWrap
    ? wrapParagraph(paragraph, fixedWidth, measurer, letterSpacing)
    : [paragraph]
  );
  const measured = rawLines.length ? rawLines : [''];
  const lineWidths = measured.map(line => measureWithLetterSpacing(line, measurer, letterSpacing));
  const contentWidth = Math.max(MIN_TEXT_BOX_SIZE, ...lineWidths);
  const width = shouldWrap ? fixedWidth : contentWidth;
  const height = Math.max(lineHeightUnits, measured.length * lineHeightUnits);

  const lines = measured.map((line, index) => {
    const lineWidth = lineWidths[index];
    let x = 0;
    if (options.align === 'center') x = (width - lineWidth) / 2;
    if (options.align === 'right') x = width - lineWidth;
    return {
      text: line,
      width: lineWidth,
      x,
      y: index * lineHeightUnits,
    };
  });

  return { width, height, lineHeightUnits, lines };
}
