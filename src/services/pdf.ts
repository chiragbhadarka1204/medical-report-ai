import PDFDocument from 'pdfkit';

export function generateSummaryPdf(
  patientData: any,
  summaryText: string,
  analysis: any = null
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const buffers: Buffer[] = [];

      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      const primaryColor = '#1a3a5c';
      const textColor = '#1e2a3b';
      const mutedColor = '#5a6a7e';
      const borderColor = '#ccddee';

      // Header
      doc
        .fillColor(primaryColor)
        .fontSize(22)
        .text('Medical Report AI', { align: 'center' });
      doc
        .fontSize(14)
        .fillColor(primaryColor)
        .text('Medical Summary Report', { align: 'center' });
      doc
        .fontSize(9)
        .fillColor(mutedColor)
        .text(`Generated: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`, { align: 'center' });

      doc.moveDown(0.5);
      doc
        .strokeColor(borderColor)
        .lineWidth(1)
        .moveTo(40, doc.y)
        .lineTo(555, doc.y)
        .stroke();
      doc.moveDown(1);

      // Patient Information
      const profile = patientData.profile || {};
      if (profile && (profile.full_name || profile.date_of_birth || profile.blood_group)) {
        doc.fillColor(primaryColor).fontSize(13).text('Patient Information');
        doc.moveDown(0.3);

        const info = [
          ['Name', profile.full_name || '—'],
          ['Date of Birth', profile.date_of_birth || '—'],
          ['Gender', profile.gender || '—'],
          ['Blood Group', profile.blood_group || '—'],
        ];

        for (const [k, v] of info) {
          doc
            .fontSize(10)
            .fillColor(primaryColor)
            .text(`${k.padEnd(16, ' ')}: `, { continued: true })
            .fillColor(textColor)
            .text(v);
        }
        doc.moveDown(0.8);
      }

      // Clinical Summary
      doc.fillColor(primaryColor).fontSize(13).text('Clinical Summary');
      doc.moveDown(0.3);
      doc.fillColor(textColor).fontSize(10).text(summaryText, { lineGap: 3 });
      doc.moveDown(1);

      // Lab Results
      const labs = patientData.lab_results || [];
      if (labs.length) {
        doc.fillColor(primaryColor).fontSize(13).text('Laboratory Results');
        doc.moveDown(0.3);

        // Header
        const startX = 40;
        let y = doc.y;
        doc.rect(startX, y, 515, 20).fill('#1a3a5c');
        doc.fillColor('#ffffff').fontSize(9);
        doc.text('Test', startX + 6, y + 5, { width: 180 });
        doc.text('Value', startX + 190, y + 5, { width: 80 });
        doc.text('Unit', startX + 275, y + 5, { width: 80 });
        doc.text('Reference Range', startX + 360, y + 5, { width: 145 });

        y += 20;
        for (let i = 0; i < labs.length; i++) {
          const l = labs[i];
          const rowBg = i % 2 === 0 ? '#ffffff' : '#f0f4ff';
          doc.rect(startX, y, 515, 18).fill(rowBg);
          doc.fillColor(textColor).fontSize(9);
          doc.text(l.field_name || l.test || '—', startX + 6, y + 4, { width: 180 });
          doc.text(String(l.field_value || l.value || '—'), startX + 190, y + 4, { width: 80 });
          doc.text(l.unit || '—', startX + 275, y + 4, { width: 80 });
          doc.text(l.reference_range || '—', startX + 360, y + 4, { width: 145 });
          y += 18;

          // Check page break
          if (y > 750) {
            doc.addPage();
            y = 40;
          }
        }
        doc.y = y + 10;
        doc.moveDown(0.5);
      }

      // Medications
      const meds = patientData.medications || [];
      if (meds.length) {
        if (doc.y > 700) doc.addPage();
        doc.fillColor(primaryColor).fontSize(13).text('Medications');
        doc.moveDown(0.3);

        const startX = 40;
        let y = doc.y;
        doc.rect(startX, y, 515, 20).fill('#1a3a5c');
        doc.fillColor('#ffffff').fontSize(9);
        doc.text('Medication', startX + 6, y + 5, { width: 180 });
        doc.text('Dose / Value', startX + 190, y + 5, { width: 150 });
        doc.text('Frequency', startX + 345, y + 5, { width: 160 });

        y += 20;
        for (let i = 0; i < meds.length; i++) {
          const m = meds[i];
          const rowBg = i % 2 === 0 ? '#ffffff' : '#f0f4ff';
          doc.rect(startX, y, 515, 18).fill(rowBg);
          doc.fillColor(textColor).fontSize(9);
          doc.text(m.field_name || m.name || '—', startX + 6, y + 4, { width: 180 });
          doc.text(String(m.field_value || m.dose || '—'), startX + 190, y + 4, { width: 150 });
          doc.text(m.unit || m.frequency || '—', startX + 345, y + 4, { width: 160 });
          y += 18;

          if (y > 750) {
            doc.addPage();
            y = 40;
          }
        }
        doc.y = y + 10;
        doc.moveDown(0.5);
      }

      // Timeline from analysis
      if (analysis && analysis.timeline && analysis.timeline.length) {
        if (doc.y > 680) doc.addPage();
        doc.fillColor(primaryColor).fontSize(13).text('Medical Timeline');
        doc.moveDown(0.3);
        for (const item of analysis.timeline) {
          doc
            .fontSize(9)
            .fillColor(primaryColor)
            .text(`${item.date || '—'}: `, { continued: true })
            .fillColor(textColor)
            .text(item.event || '');
        }
        doc.moveDown(0.8);
      }

      // Missing info
      if (analysis && analysis.missing_info && analysis.missing_info.length) {
        if (doc.y > 700) doc.addPage();
        doc.fillColor(primaryColor).fontSize(13).text('Missing Information');
        doc.moveDown(0.3);
        for (const item of analysis.missing_info) {
          doc.fontSize(9).fillColor(mutedColor).text(`• ${item}`);
        }
        doc.moveDown(0.8);
      }

      // Footer
      if (doc.y > 720) doc.addPage();
      doc.moveDown(1);
      doc
        .strokeColor(borderColor)
        .lineWidth(0.5)
        .moveTo(40, doc.y)
        .lineTo(555, doc.y)
        .stroke();
      doc.moveDown(0.4);
      doc
        .fontSize(8)
        .fillColor(mutedColor)
        .text(
          'This report was generated by Medical Report AI. It is based strictly on uploaded documents. Consult a qualified healthcare professional for medical advice.',
          { align: 'center' }
        );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
