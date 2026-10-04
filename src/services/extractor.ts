import fs from 'fs';
import pdfParse from 'pdf-parse';

// Custom pagerender to preserve spatial spacing between columns and fields
function customPagerender(pageData: any): Promise<string> {
  return pageData.getTextContent({ normalizeWhitespace: true }).then(function (textContent: any) {
    let lastY: number | null = null;
    let text = '';
    for (const item of textContent.items) {
      if (lastY === null) {
        text += item.str;
      } else if (Math.abs(lastY - item.transform[5]) < 4) {
        // Same line: add space between text elements
        text += ' ' + item.str;
      } else {
        // New line
        text += '\n' + item.str;
      }
      lastY = item.transform[5];
    }
    return text;
  });
}

export async function extractText(filepath: string, fileType: string): Promise<string> {
  const ext = fileType.toLowerCase().replace(/^\./, '');

  if (ext === 'txt') {
    return fs.readFileSync(filepath, 'utf-8');
  }

  if (ext === 'pdf') {
    try {
      const dataBuffer = fs.readFileSync(filepath);
      const parsed = await pdfParse(dataBuffer, { pagerender: customPagerender });
      if (parsed && parsed.text && parsed.text.trim()) {
        return parsed.text;
      }
    } catch (err) {
      console.warn('pdf-parse custom pagerender failed, falling back to standard extraction:', err);
    }

    try {
      const dataBuffer = fs.readFileSync(filepath);
      const parsed = await pdfParse(dataBuffer);
      if (parsed && parsed.text && parsed.text.trim()) {
        return parsed.text;
      }
    } catch (err) {
      console.warn('standard pdf-parse failed:', err);
    }

    // Fallback: extract printable strings from PDF buffer
    try {
      const raw = fs.readFileSync(filepath, 'utf-8');
      const textMatches = raw.match(/\(([^()]{2,})\)/g);
      if (textMatches) {
        return textMatches.map((m) => m.slice(1, -1)).join(' ');
      }
    } catch {
      // ignore
    }
    return '';
  }

  if (ext === 'doc' || ext === 'docx') {
    try {
      const content = fs.readFileSync(filepath, 'utf-8');
      const text = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (text.length > 20) return text;
    } catch {
      // ignore
    }
  }

  // Generic fallback
  try {
    return fs.readFileSync(filepath, 'utf-8');
  } catch {
    return '';
  }
}
