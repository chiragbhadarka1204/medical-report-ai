"""
PDF Report Generator.
Generates a formatted medical summary PDF using reportlab.
"""
import io
from datetime import datetime


def generate_summary_pdf(patient_data: dict, summary_text: str, analysis: dict = None) -> bytes:
    """
    Generate a PDF from patient data + AI summary.
    Returns bytes of the PDF.
    """
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import cm
        from reportlab.lib import colors
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
        from reportlab.lib.enums import TA_CENTER, TA_LEFT
    except ImportError:
        raise RuntimeError("reportlab not installed. Run: pip install reportlab")

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=2 * cm,
        leftMargin=2 * cm,
        topMargin=2 * cm,
        bottomMargin=2 * cm,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "Title", parent=styles["Title"],
        fontSize=20, spaceAfter=6, textColor=colors.HexColor("#1a3a5c"),
        alignment=TA_CENTER,
    )
    heading_style = ParagraphStyle(
        "Heading", parent=styles["Heading2"],
        fontSize=13, spaceBefore=12, spaceAfter=4,
        textColor=colors.HexColor("#1a3a5c"),
    )
    body_style = ParagraphStyle(
        "Body", parent=styles["Normal"],
        fontSize=10, spaceAfter=4, leading=14,
    )
    small_style = ParagraphStyle(
        "Small", parent=styles["Normal"],
        fontSize=8, textColor=colors.grey,
    )

    story = []

    # Header
    story.append(Paragraph("🏥 Medical Report AI", title_style))
    story.append(Paragraph("Medical Summary Report", heading_style))
    story.append(Paragraph(
        f"Generated: {datetime.now().strftime('%B %d, %Y at %H:%M')}",
        small_style,
    ))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#ccddee")))
    story.append(Spacer(1, 0.3 * cm))

    # Patient info
    profile = patient_data.get("profile", {})
    if profile:
        story.append(Paragraph("Patient Information", heading_style))
        info_data = [
            ["Name", profile.get("full_name") or "—"],
            ["Date of Birth", profile.get("date_of_birth") or "—"],
            ["Gender", profile.get("gender") or "—"],
            ["Blood Group", profile.get("blood_group") or "—"],
        ]
        t = Table(info_data, colWidths=[4 * cm, 12 * cm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#e8f0fe")),
            ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 10),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cccccc")),
            ("PADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(t)
        story.append(Spacer(1, 0.3 * cm))

    # AI Summary
    story.append(Paragraph("Clinical Summary", heading_style))
    for line in summary_text.split("\n"):
        line = line.strip()
        if line:
            story.append(Paragraph(line, body_style))
    story.append(Spacer(1, 0.3 * cm))

    # Lab Results
    lab_results = patient_data.get("lab_results", [])
    if lab_results:
        story.append(Paragraph("Laboratory Results", heading_style))
        table_data = [["Test", "Value", "Unit", "Reference Range"]]
        for row in lab_results:
            table_data.append([
                row.get("field_name") or "—",
                row.get("field_value") or "—",
                row.get("unit") or "—",
                row.get("reference_range") or "—",
            ])
        t = Table(table_data, colWidths=[5 * cm, 3.5 * cm, 3 * cm, 5 * cm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a3a5c")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cccccc")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f0f4ff")]),
            ("PADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(t)
        story.append(Spacer(1, 0.3 * cm))

    # Medications
    medications = patient_data.get("medications", [])
    if medications:
        story.append(Paragraph("Medications", heading_style))
        table_data = [["Medication", "Dose", "Frequency", "Duration"]]
        for m in medications:
            table_data.append([
                m.get("field_name") or "—",
                m.get("field_value") or "—",
                m.get("unit") or "—",
                "—",
            ])
        t = Table(table_data, colWidths=[5 * cm, 3.5 * cm, 4 * cm, 4 * cm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a3a5c")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cccccc")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f0f4ff")]),
            ("PADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(t)
        story.append(Spacer(1, 0.3 * cm))

    # Analysis — timeline
    if analysis and analysis.get("timeline"):
        story.append(Paragraph("Medical Timeline", heading_style))
        for entry in analysis["timeline"]:
            line = f"<b>{entry.get('date', '—')}</b>: {entry.get('event', '')}"
            story.append(Paragraph(line, body_style))
        story.append(Spacer(1, 0.3 * cm))

    # Missing info
    if analysis and analysis.get("missing_info"):
        story.append(Paragraph("Missing Information", heading_style))
        for item in analysis["missing_info"]:
            story.append(Paragraph(f"• {item}", body_style))

    # Footer
    story.append(Spacer(1, 0.5 * cm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.grey))
    story.append(Paragraph(
        "This report was generated by Medical Report AI. It is based strictly on uploaded documents. "
        "Consult a qualified healthcare professional for medical advice.",
        small_style,
    ))

    doc.build(story)
    buffer.seek(0)
    return buffer.read()
