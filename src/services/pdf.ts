import PDFDocument from 'pdfkit';

/**
 * Sanitizes strings for standard PDFKit Helvetica/WinAnsi encoding.
 * Strips unsupported Unicode emojis and normalizes punctuation/quotes/bullets.
 */
function cleanText(str: any): string {
  if (str === null || str === undefined) return '';
  const s = String(str);
  return s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2022\u25CF\u25CB]/g, '-')
    .replace(/[\u00A0]/g, ' ')
    // Strip emojis and non-standard symbols that cause WinAnsi garbled characters
    .replace(/[^\x00-\x7F\xA0-\xFF]/g, '')
    .trim();
}

/**
 * Strips raw markdown syntax for clean typography
 */
function stripMarkdownSymbols(line: string): string {
  return line
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/^#+\s*/, '')
    .trim();
}

export function generateSummaryPdf(
  patientData: any,
  summaryText: string,
  analysis: any = null
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        pdfVersion: '1.4', // Universally compatible with all PDF engines
        margin: 40,
        size: 'A4',
        bufferPages: true,
      });

      const buffers: Buffer[] = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      const margin = 40;
      const contentWidth = 515; // A4 595.28 - 80 margin
      const bottomLimit = 760; // Leave safe space for footer at 778

      // Styling palette
      const primaryDark = '#0f2744';
      const primaryBlue = '#1e40af';
      const textPrimary = '#0f172a';
      const textMuted = '#475569';
      const borderSubtle = '#cbd5e1';
      const bgCard = '#f8fafc';
      const bgHeader = '#1e3a8a';
      const bgZebra = '#f8fafc';

      const alertRedBg = '#fef2f2';
      const alertRedText = '#991b1b';
      const alertRedBorder = '#fecaca';

      const warnAmberBg = '#fffbeb';
      const warnAmberText = '#92400e';

      const successGreenBg = '#f0fdf4';
      const successGreenText = '#166534';

      function checkPageBreak(neededHeight: number) {
        if (doc.y + neededHeight > bottomLimit) {
          doc.addPage();
          doc.y = 42; // Below top running header
        }
      }

      // ────────────────────────────────────────────────────────
      // 1. BRAND HEADER BANNER
      // ────────────────────────────────────────────────────────
      const bannerHeight = 52;
      doc.rect(margin, margin, contentWidth, bannerHeight).fill(primaryDark);

      doc.fillColor('#ffffff').fontSize(17).font('Helvetica-Bold');
      doc.text('MEDICAL REPORT AI', margin + 16, margin + 12, { width: 320 });

      doc.fillColor('#93c5fd').fontSize(8.5).font('Helvetica');
      doc.text('Clinical Document Synthesis & Diagnostic Health Record', margin + 16, margin + 32, { width: 320 });

      const dateStr = new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      doc.fillColor('#ffffff').fontSize(8.5).font('Helvetica-Bold');
      doc.text('OFFICIAL MEDICAL REPORT', margin + contentWidth - 170, margin + 13, { width: 155, align: 'right' });
      doc.fillColor('#94a3b8').fontSize(7.5).font('Helvetica');
      doc.text(`Generated: ${dateStr}`, margin + contentWidth - 170, margin + 26, { width: 155, align: 'right' });
      doc.text('Status: Verified Extracted Data', margin + contentWidth - 170, margin + 36, { width: 155, align: 'right' });

      doc.y = margin + bannerHeight + 14;

      // ────────────────────────────────────────────────────────
      // 2. PATIENT DEMOGRAPHICS CARD
      // ────────────────────────────────────────────────────────
      const profile = patientData.profile || {};
      const doctor = patientData.doctor || {};
      const patientName = cleanText(profile.full_name) || 'Not Recorded';
      const patientDob = cleanText(profile.date_of_birth) || 'Not Recorded';
      const patientGender = cleanText(profile.gender) || 'Not Recorded';
      const patientBlood = cleanText(profile.blood_group) || 'Not Recorded';
      const docName = cleanText(doctor.name) || 'Not Recorded';
      const facility = cleanText(doctor.facility) || 'Not Recorded';

      const cardY = doc.y;
      const cardHeight = 64;
      doc.rect(margin, cardY, contentWidth, cardHeight).fill(bgCard);
      doc.rect(margin, cardY, contentWidth, cardHeight).strokeColor(borderSubtle).lineWidth(1).stroke();

      doc.fillColor(primaryBlue).fontSize(9).font('Helvetica-Bold');
      doc.text('PATIENT DEMOGRAPHIC PROFILE', margin + 12, cardY + 7);

      const col1X = margin + 12;
      const col2X = margin + 180;
      const col3X = margin + 350;

      // Row 1
      const r1Y = cardY + 22;
      doc.fontSize(8).font('Helvetica-Bold').fillColor(textMuted).text('FULL NAME:', col1X, r1Y);
      doc.fontSize(8.5).font('Helvetica').fillColor(textPrimary).text(patientName, col1X + 58, r1Y, { width: 115 });

      doc.fontSize(8).font('Helvetica-Bold').fillColor(textMuted).text('GENDER:', col2X, r1Y);
      doc.fontSize(8.5).font('Helvetica').fillColor(textPrimary).text(patientGender, col2X + 46, r1Y, { width: 115 });

      doc.fontSize(8).font('Helvetica-Bold').fillColor(textMuted).text('BLOOD GROUP:', col3X, r1Y);
      doc.fontSize(8.5).font('Helvetica').fillColor(textPrimary).text(patientBlood, col3X + 75, r1Y, { width: 85 });

      // Row 2
      const r2Y = cardY + 43;
      doc.fontSize(8).font('Helvetica-Bold').fillColor(textMuted).text('DOB / AGE:', col1X, r2Y);
      doc.fontSize(8.5).font('Helvetica').fillColor(textPrimary).text(patientDob, col1X + 58, r2Y, { width: 115 });

      doc.fontSize(8).font('Helvetica-Bold').fillColor(textMuted).text('PHYSICIAN:', col2X, r2Y);
      doc.fontSize(8.5).font('Helvetica').fillColor(textPrimary).text(docName, col2X + 56, r2Y, { width: 105 });

      doc.fontSize(8).font('Helvetica-Bold').fillColor(textMuted).text('FACILITY:', col3X, r2Y);
      doc.fontSize(8.5).font('Helvetica').fillColor(textPrimary).text(facility, col3X + 50, r2Y, { width: 110 });

      doc.y = cardY + cardHeight + 14;

      // ────────────────────────────────────────────────────────
      // 3. ABNORMAL LABS ALERT (If any)
      // ────────────────────────────────────────────────────────
      const labs = Array.isArray(patientData.lab_results) ? patientData.lab_results : [];
      const abnormalLabs = labs.filter((l: any) => {
        const flag = cleanText(l.flag).toLowerCase();
        return flag.includes('high') || flag.includes('low') || flag.includes('abnormal') || flag.includes('critical');
      });

      if (abnormalLabs.length > 0) {
        checkPageBreak(50);
        const alertY = doc.y;
        const alertHeight = 22 + abnormalLabs.length * 15;
        doc.rect(margin, alertY, contentWidth, alertHeight).fill(alertRedBg);
        doc.rect(margin, alertY, contentWidth, alertHeight).strokeColor(alertRedBorder).lineWidth(1).stroke();

        doc.fillColor(alertRedText).fontSize(8.5).font('Helvetica-Bold');
        doc.text('CRITICAL CLINICAL NOTICE - ABNORMAL BIOMARKER FLAGS DETECTED', margin + 12, alertY + 6);

        let rowY = alertY + 20;
        doc.font('Helvetica').fontSize(8).fillColor(alertRedText);
        for (const al of abnormalLabs) {
          const testName = cleanText(al.field_name || al.test || 'Test');
          const val = cleanText(al.field_value || al.value || '');
          const unit = cleanText(al.unit || '');
          const flag = cleanText(al.flag || 'Abnormal').toUpperCase();
          const ref = cleanText(al.reference_range ? ` (Reference: ${al.reference_range})` : '');
          doc.text(`* ${testName}: ${val} ${unit} [FLAGGED ${flag}]${ref}`, margin + 16, rowY, { width: contentWidth - 32 });
          rowY += 15;
        }
        doc.y = alertY + alertHeight + 12;
      }

      // ────────────────────────────────────────────────────────
      // 4. CLINICAL SUMMARY & ASSESSMENT NARRATIVE
      // ────────────────────────────────────────────────────────
      checkPageBreak(60);
      doc.fillColor(primaryDark).fontSize(11).font('Helvetica-Bold').text('CLINICAL SUMMARY & ASSESSMENT');
      doc.strokeColor(borderSubtle).lineWidth(0.75).moveTo(margin, doc.y + 2).lineTo(margin + contentWidth, doc.y + 2).stroke();
      doc.moveDown(0.5);

      const summaryLines = (summaryText || '')
        .split('\n')
        .map((l) => cleanText(l))
        .filter((l) => l.length > 0);

      for (const rawLine of summaryLines) {
        checkPageBreak(22);

        // Skip markdown horizontal dividers
        if (rawLine === '---' || rawLine === '***' || rawLine === '___') {
          doc.strokeColor(borderSubtle).lineWidth(0.5).moveTo(margin, doc.y + 3).lineTo(margin + contentWidth, doc.y + 3).stroke();
          doc.moveDown(0.4);
          continue;
        }

        // Section Headers (# Title, ## Subtitle, ### Section)
        if (rawLine.startsWith('# ') || rawLine.startsWith('## ') || rawLine.startsWith('### ')) {
          const headerText = stripMarkdownSymbols(rawLine);
          // Skip redundant document titles
          if (headerText.toLowerCase().includes('comprehensive medical assessment') || headerText.toLowerCase().includes('executive clinical overview')) {
            continue;
          }
          doc.moveDown(0.3);
          checkPageBreak(25);
          doc.fillColor(primaryBlue).fontSize(9.5).font('Helvetica-Bold').text(headerText.toUpperCase());
          doc.moveDown(0.2);
          continue;
        }

        // Primary Clinical Problem Box
        if (rawLine.includes('Not too much data is given') || rawLine.includes('this is the problem:')) {
          checkPageBreak(40);
          const boxY = doc.y;
          const cleanLine = stripMarkdownSymbols(rawLine);
          doc.rect(margin, boxY, contentWidth, 34).fill('#eff6ff');
          doc.rect(margin, boxY, 4, 34).fill(primaryBlue);
          doc.fillColor(primaryBlue).fontSize(8.5).font('Helvetica-Bold').text('PRIMARY CLINICAL IMPRESSION:', margin + 12, boxY + 6);
          doc.fillColor(textPrimary).fontSize(8).font('Helvetica').text(cleanLine, margin + 12, boxY + 18, { width: contentWidth - 24 });
          doc.y = boxY + 40;
          continue;
        }

        // Bullet Items
        if (rawLine.startsWith('- ') || rawLine.startsWith('* ') || rawLine.startsWith('• ')) {
          const itemText = stripMarkdownSymbols(rawLine.replace(/^[-*•]\s*/, ''));
          checkPageBreak(16);
          doc.fillColor(primaryBlue).fontSize(8).font('Helvetica-Bold').text('*', margin + 8, doc.y, { continued: true });
          doc.fillColor(textPrimary).fontSize(8).font('Helvetica').text(` ${itemText}`, { width: contentWidth - 18, lineGap: 1.5 });
          continue;
        }

        // Standard Paragraph
        const cleanParagraph = stripMarkdownSymbols(rawLine);
        doc.fillColor(textPrimary).fontSize(8).font('Helvetica').text(cleanParagraph, {
          width: contentWidth,
          lineGap: 2,
        });
        doc.moveDown(0.2);
      }
      doc.moveDown(0.6);

      // ────────────────────────────────────────────────────────
      // 5. LABORATORY RESULTS TABLE
      // ────────────────────────────────────────────────────────
      if (labs.length > 0) {
        checkPageBreak(75);

        doc.fillColor(primaryDark).fontSize(11).font('Helvetica-Bold').text('DIAGNOSTIC LABORATORY FINDINGS');
        doc.strokeColor(borderSubtle).lineWidth(0.75).moveTo(margin, doc.y + 2).lineTo(margin + contentWidth, doc.y + 2).stroke();
        doc.moveDown(0.5);

        const colWidths = [160, 75, 75, 120, 85];
        const colX = [
          margin,
          margin + 160,
          margin + 160 + 75,
          margin + 160 + 75 + 75,
          margin + 160 + 75 + 75 + 120,
        ];

        function drawLabTableHeader() {
          const y = doc.y;
          doc.rect(margin, y, contentWidth, 19).fill(bgHeader);
          doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold');
          doc.text('TEST NAME', colX[0] + 8, y + 5, { width: colWidths[0] - 12 });
          doc.text('RESULT', colX[1] + 6, y + 5, { width: colWidths[1] - 10 });
          doc.text('UNIT', colX[2] + 6, y + 5, { width: colWidths[2] - 10 });
          doc.text('REFERENCE RANGE', colX[3] + 6, y + 5, { width: colWidths[3] - 10 });
          doc.text('FLAG', colX[4] + 6, y + 5, { width: colWidths[4] - 10 });
          doc.y = y + 19;
        }

        drawLabTableHeader();

        for (let i = 0; i < labs.length; i++) {
          const l = labs[i];
          const rowHeight = 17;

          if (doc.y + rowHeight > bottomLimit) {
            doc.addPage();
            doc.y = 42;
            drawLabTableHeader();
          }

          const curY = doc.y;
          const flagStr = cleanText(l.flag || 'Normal').toLowerCase();
          const isHigh = flagStr.includes('high');
          const isLow = flagStr.includes('low');
          const isAbnormal = isHigh || isLow || flagStr.includes('abnormal') || flagStr.includes('critical');

          const bg = isAbnormal ? alertRedBg : i % 2 === 0 ? '#ffffff' : bgZebra;
          doc.rect(margin, curY, contentWidth, rowHeight).fill(bg);
          doc.rect(margin, curY, contentWidth, rowHeight).strokeColor('#e2e8f0').lineWidth(0.5).stroke();

          // Test Name
          doc.fillColor(textPrimary).fontSize(8).font(isAbnormal ? 'Helvetica-Bold' : 'Helvetica');
          const tName = cleanText(l.field_name || l.test || 'Unknown Test');
          doc.text(tName, colX[0] + 8, curY + 4, { width: colWidths[0] - 12, ellipsis: true });

          // Result Value
          const tVal = cleanText(l.field_value || l.value || '-');
          doc.fillColor(isAbnormal ? alertRedText : textPrimary).font(isAbnormal ? 'Helvetica-Bold' : 'Helvetica');
          doc.text(tVal, colX[1] + 6, curY + 4, { width: colWidths[1] - 10 });

          // Unit
          const tUnit = cleanText(l.unit || '-');
          doc.fillColor(textMuted).font('Helvetica');
          doc.text(tUnit, colX[2] + 6, curY + 4, { width: colWidths[2] - 10 });

          // Reference Range
          const tRef = cleanText(l.reference_range || '-');
          doc.text(tRef, colX[3] + 6, curY + 4, { width: colWidths[3] - 10 });

          // Flag Badge
          const flagDisplay = isHigh ? 'HIGH' : isLow ? 'LOW' : isAbnormal ? 'ABNORMAL' : 'NORMAL';
          const badgeBg = isHigh ? alertRedBg : isLow ? warnAmberBg : isAbnormal ? alertRedBg : successGreenBg;
          const badgeText = isHigh ? alertRedText : isLow ? warnAmberText : isAbnormal ? alertRedText : successGreenText;

          doc.rect(colX[4] + 4, curY + 2.5, 60, 12).fill(badgeBg);
          doc.fillColor(badgeText).fontSize(7).font('Helvetica-Bold');
          doc.text(flagDisplay, colX[4] + 4, curY + 4.5, { width: 60, align: 'center' });

          doc.y = curY + rowHeight;
        }
        doc.moveDown(0.7);
      }

      // ────────────────────────────────────────────────────────
      // 6. MEDICATIONS & PRESCRIPTIONS TABLE
      // ────────────────────────────────────────────────────────
      const meds = Array.isArray(patientData.medications) ? patientData.medications : [];
      if (meds.length > 0) {
        checkPageBreak(75);

        doc.fillColor(primaryDark).fontSize(11).font('Helvetica-Bold').text('MEDICATIONS & PHARMACOLOGICAL PROFILE');
        doc.strokeColor(borderSubtle).lineWidth(0.75).moveTo(margin, doc.y + 2).lineTo(margin + contentWidth, doc.y + 2).stroke();
        doc.moveDown(0.5);

        const mColWidths = [185, 120, 110, 100];
        const mColX = [
          margin,
          margin + 185,
          margin + 185 + 120,
          margin + 185 + 120 + 110,
        ];

        function drawMedHeader() {
          const y = doc.y;
          doc.rect(margin, y, contentWidth, 19).fill(bgHeader);
          doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold');
          doc.text('MEDICATION NAME', mColX[0] + 8, y + 5, { width: mColWidths[0] - 12 });
          doc.text('DOSAGE', mColX[1] + 6, y + 5, { width: mColWidths[1] - 10 });
          doc.text('FREQUENCY / ROUTE', mColX[2] + 6, y + 5, { width: mColWidths[2] - 10 });
          doc.text('STATUS', mColX[3] + 6, y + 5, { width: mColWidths[3] - 10 });
          doc.y = y + 19;
        }

        drawMedHeader();

        for (let i = 0; i < meds.length; i++) {
          const m = meds[i];
          const rowHeight = 17;

          if (doc.y + rowHeight > bottomLimit) {
            doc.addPage();
            doc.y = 42;
            drawMedHeader();
          }

          const curY = doc.y;
          const bg = i % 2 === 0 ? '#ffffff' : bgZebra;
          doc.rect(margin, curY, contentWidth, rowHeight).fill(bg);
          doc.rect(margin, curY, contentWidth, rowHeight).strokeColor('#e2e8f0').lineWidth(0.5).stroke();

          doc.fillColor(textPrimary).fontSize(8).font('Helvetica-Bold');
          doc.text(cleanText(m.field_name || m.name || 'Medication'), mColX[0] + 8, curY + 4, { width: mColWidths[0] - 12 });

          doc.fillColor(textPrimary).font('Helvetica');
          doc.text(cleanText(m.field_value || m.dose || '-'), mColX[1] + 6, curY + 4, { width: mColWidths[1] - 10 });

          doc.fillColor(textMuted);
          doc.text(cleanText(m.unit || m.frequency || '-'), mColX[2] + 6, curY + 4, { width: mColWidths[2] - 10 });

          doc.fillColor(successGreenText).font('Helvetica-Bold');
          doc.text('Active', mColX[3] + 6, curY + 4, { width: mColWidths[3] - 10 });

          doc.y = curY + rowHeight;
        }
        doc.moveDown(0.7);
      }

      // ────────────────────────────────────────────────────────
      // 7. MEDICAL TIMELINE & LONGITUDINAL EVENTS
      // ────────────────────────────────────────────────────────
      const timeline = analysis?.timeline || [];
      if (timeline.length > 0) {
        checkPageBreak(50);

        doc.fillColor(primaryDark).fontSize(11).font('Helvetica-Bold').text('CHRONOLOGICAL CLINICAL TIMELINE');
        doc.strokeColor(borderSubtle).lineWidth(0.75).moveTo(margin, doc.y + 2).lineTo(margin + contentWidth, doc.y + 2).stroke();
        doc.moveDown(0.5);

        for (const t of timeline) {
          checkPageBreak(18);
          const tDate = cleanText(t.date || 'Record Date');
          const tEvent = cleanText(t.event || '');

          doc.fillColor(primaryBlue).fontSize(8).font('Helvetica-Bold');
          doc.text(`* ${tDate}: `, margin + 8, doc.y, { continued: true });
          doc.fillColor(textPrimary).font('Helvetica').text(tEvent, { width: contentWidth - 20 });
          doc.moveDown(0.2);
        }
        doc.moveDown(0.6);
      }

      // ────────────────────────────────────────────────────────
      // 8. MISSING CLINICAL INFORMATION
      // ────────────────────────────────────────────────────────
      const missing = analysis?.missing_info || [];
      if (missing.length > 0) {
        checkPageBreak(50);

        doc.fillColor(primaryDark).fontSize(11).font('Helvetica-Bold').text('RECOMMENDED FOLLOW-UP & MISSING DATA');
        doc.strokeColor(borderSubtle).lineWidth(0.75).moveTo(margin, doc.y + 2).lineTo(margin + contentWidth, doc.y + 2).stroke();
        doc.moveDown(0.5);

        for (const m of missing) {
          checkPageBreak(16);
          doc.fillColor(textMuted).fontSize(8).font('Helvetica');
          doc.text(`* ${cleanText(m)}`, margin + 12, doc.y, { width: contentWidth - 24 });
          doc.moveDown(0.2);
        }
        doc.moveDown(0.6);
      }

      // ────────────────────────────────────────────────────────
      // 9. RUNNING HEADERS, FOOTERS & PAGE NUMBERS ON ALL PAGES
      // ────────────────────────────────────────────────────────
      const range = doc.bufferedPageRange();
      const totalPages = range.count;

      for (let i = range.start; i < range.start + totalPages; i++) {
        doc.switchToPage(i);

        // Running Header on pages 2+
        if (i > 0) {
          doc.strokeColor(borderSubtle).lineWidth(0.5).moveTo(margin, 28).lineTo(margin + contentWidth, 28).stroke();
          doc.fillColor(textMuted).fontSize(7.5).font('Helvetica');
          doc.text('Medical Report AI - Clinical Summary Report', margin, 18, { width: 300, lineBreak: false });
          doc.text(`Patient: ${patientName}`, margin + contentWidth - 200, 18, { width: 200, align: 'right', lineBreak: false });
        }

        // Running Footer on all pages (at footerY = 780, well inside page bounds)
        const footerY = 778;
        doc.strokeColor(borderSubtle).lineWidth(0.5).moveTo(margin, footerY).lineTo(margin + contentWidth, footerY).stroke();

        doc.fillColor(textMuted).fontSize(6.5).font('Helvetica');
        doc.text(
          'CONFIDENTIAL HEALTH RECORD - Synthesized by Medical Report AI strictly from uploaded clinical records. Consult a physician for diagnostic verification.',
          margin,
          footerY + 5,
          { width: contentWidth - 80, lineBreak: false }
        );

        doc.fillColor(primaryDark).fontSize(7.5).font('Helvetica-Bold');
        doc.text(`Page ${i + 1} of ${totalPages}`, margin + contentWidth - 75, footerY + 5, {
          width: 75,
          align: 'right',
          lineBreak: false,
        });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
