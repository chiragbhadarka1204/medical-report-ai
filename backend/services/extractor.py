"""
Document text extraction service.
Handles PDF, images (OCR), TXT, DOC, DOCX.
"""
import os
import io


def extract_text(filepath: str, file_type: str) -> str:
    """
    Extract raw text from a file based on its type.
    Returns a string. Raises on unrecoverable errors.
    """
    ext = file_type.lower().lstrip(".")
    
    if ext == "txt":
        return _extract_txt(filepath)
    elif ext == "pdf":
        return _extract_pdf(filepath)
    elif ext in ("doc", "docx"):
        return _extract_docx(filepath)
    elif ext in ("png", "jpg", "jpeg", "gif", "tiff", "bmp", "webp"):
        return _extract_image_ocr(filepath)
    else:
        # Attempt generic text read as fallback
        return _extract_txt(filepath)


def _extract_txt(filepath: str) -> str:
    with open(filepath, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def _extract_pdf(filepath: str) -> str:
    try:
        import pdfplumber
        pages = []
        with pdfplumber.open(filepath) as pdf:
            for page in pdf.pages:
                text = page.extract_text()
                if text:
                    pages.append(text)
        if pages:
            return "\n\n".join(pages)
    except ImportError:
        pass

    # Fallback: PyPDF2
    try:
        import PyPDF2
        text_parts = []
        with open(filepath, "rb") as f:
            reader = PyPDF2.PdfReader(f)
            for page in reader.pages:
                t = page.extract_text()
                if t:
                    text_parts.append(t)
        return "\n\n".join(text_parts)
    except ImportError:
        pass

    raise RuntimeError("No PDF extraction library available. Install pdfplumber or PyPDF2.")


def _extract_docx(filepath: str) -> str:
    try:
        import docx
        doc = docx.Document(filepath)
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        return "\n".join(paragraphs)
    except ImportError:
        raise RuntimeError("python-docx not installed. Run: pip install python-docx")


def _extract_image_ocr(filepath: str) -> str:
    try:
        import pytesseract
        from PIL import Image
        img = Image.open(filepath)
        text = pytesseract.image_to_string(img)
        return text
    except ImportError:
        raise RuntimeError(
            "OCR dependencies not installed. Run: pip install pytesseract Pillow\n"
            "Also ensure Tesseract OCR engine is installed on your system."
        )
