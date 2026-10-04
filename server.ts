import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';

import { store } from './src/store.js';
import { extractText } from './src/services/extractor.js';
import {
  extractMedicalFacts,
  generateMedicalSummary,
  analyzeMedicalRecords,
  answerQuestion,
  assessSymptoms,
  getCurrentApiInfo,
} from './src/services/ai.js';
import { generateSummaryPdf } from './src/services/pdf.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);
const uploadFolder = path.join(__dirname, process.env.UPLOAD_FOLDER || 'uploads');

if (!fs.existsSync(uploadFolder)) {
  fs.mkdirSync(uploadFolder, { recursive: true });
}

// Multer storage
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadFolder);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).slice(1) || 'bin';
    cb(null, `${uuidv4()}.${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static assets with caching for fast load times (Requirement 6)
app.use(express.static(path.join(__dirname, 'frontend', 'static'), { maxAge: '1d' }));

// Auth helper middleware
function requireAuth(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  const sessionData = store.getSession(token);
  if (!sessionData) {
    return res.status(401).json({ error: 'Invalid or expired session.' });
  }
  req.user = sessionData.user;
  req.session = sessionData.session;
  next();
}

// ──────────────────────────────────────────────────────────────
// Auth Routes
// ──────────────────────────────────────────────────────────────

app.post('/api/auth/login', (req, res) => {
  const email = (req.body?.email || '').trim().toLowerCase();
  const phone = (req.body?.phone || '').trim();

  if (!email || !phone) {
    return res.status(400).json({ error: 'Email and phone number are required.' });
  }

  const user = store.findOrCreateUser(email, phone);
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  store.createOtp(user.id, otp, 10);

  return res.json({
    message: 'OTP generated (dev mode).',
    dev_otp: otp,
    user_id: user.id,
  });
});

app.post('/api/auth/verify-otp', (req, res) => {
  const userId = (req.body?.user_id || '').trim();
  const otp = (req.body?.otp || '').trim();

  if (!userId || !otp) {
    return res.status(400).json({ error: 'user_id and otp are required.' });
  }

  const isValid = store.verifyOtp(userId, otp);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid or expired OTP.' });
  }

  const token = store.createSession(userId);
  const user = store.getUserById(userId);

  return res.json({
    token,
    user: {
      id: user?.id,
      email: user?.email,
      phone: user?.phone,
      full_name: user?.full_name,
    },
  });
});

app.post('/api/auth/logout', (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (token) {
    store.deleteSession(token);
  }
  return res.json({ message: 'Logged out.' });
});

// ──────────────────────────────────────────────────────────────
// Documents Routes
// ──────────────────────────────────────────────────────────────

app.get(['/api/documents', '/api/documents/'], requireAuth, (req: any, res: any) => {
  const docs = store.listDocuments(req.user.id);
  return res.json({ documents: docs });
});

app.get('/api/documents/:id/facts', requireAuth, (req: any, res: any) => {
  const doc = store.getDocument(req.params.id);
  if (!doc || doc.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Document not found.' });
  }
  const facts = store.getFactsForDocument(req.params.id);
  return res.json({ document: doc, facts });
});

app.post('/api/documents/upload', requireAuth, upload.single('file') as any, async (req: any, res: any) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file part in request.' });
  }

  const file = req.file;
  const ext = (path.extname(file.originalname).slice(1) || '').toLowerCase();
  const allowed = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'tiff', 'bmp', 'txt', 'doc', 'docx'];

  if (!allowed.includes(ext)) {
    return res.status(400).json({
      error: `File type not allowed. Supported: ${allowed.join(', ')}`,
    });
  }

  const docId = uuidv4();
  const docRecord: {
    id: string;
    user_id: string;
    filename: string;
    original_filename: string;
    file_type: string;
    file_size_bytes: number;
    upload_status: 'pending' | 'processing' | 'extracted' | 'error';
    uploaded_at: string;
    extracted_at: string | null;
  } = {
    id: docId,
    user_id: req.user.id,
    filename: file.filename,
    original_filename: file.originalname,
    file_type: ext,
    file_size_bytes: file.size,
    upload_status: 'processing',
    uploaded_at: new Date().toISOString(),
    extracted_at: null,
  };
  store.addDocument(docRecord);

  try {
    const rawText = await extractText(file.path, ext);
    const facts = await extractMedicalFacts(rawText);

    // Save facts
    const reportDate = facts.report_date || null;

    for (const item of facts.lab_results || []) {
      if (item && item.test) {
        store.addFact({
          document_id: docId,
          user_id: req.user.id,
          category: 'lab_result',
          field_name: item.test,
          field_value: item.value || '',
          unit: item.unit || null,
          reference_range: item.reference_range || null,
          flag: item.flag || 'Normal',
          status: item.status || 'found',
          report_date: reportDate,
          source_text: null,
        });
      }
    }

    for (const item of facts.diagnoses || []) {
      if (item && item.name) {
        store.addFact({
          document_id: docId,
          user_id: req.user.id,
          category: 'diagnosis',
          field_name: item.name,
          field_value: item.name,
          unit: null,
          reference_range: null,
          status: 'found',
          report_date: reportDate,
          source_text: item.source_text || null,
        });
      }
    }

    for (const item of facts.medications || []) {
      if (item && item.name) {
        const val = `${item.dose || ''} ${item.frequency || ''}`.trim() || item.name;
        store.addFact({
          document_id: docId,
          user_id: req.user.id,
          category: 'medication',
          field_name: item.name,
          field_value: val,
          unit: item.frequency || null,
          reference_range: null,
          status: 'found',
          report_date: reportDate,
          source_text: item.source_text || null,
        });
      }
    }

    for (const item of facts.vital_signs || []) {
      if (item && item.name) {
        store.addFact({
          document_id: docId,
          user_id: req.user.id,
          category: 'vital_sign',
          field_name: item.name,
          field_value: item.value || '',
          unit: item.unit || null,
          reference_range: null,
          status: 'found',
          report_date: reportDate,
          source_text: null,
        });
      }
    }

    for (const item of facts.allergies || []) {
      if (item && item.substance) {
        store.addFact({
          document_id: docId,
          user_id: req.user.id,
          category: 'allergy',
          field_name: item.substance,
          field_value: item.reaction || 'allergic',
          unit: null,
          reference_range: null,
          status: 'found',
          report_date: reportDate,
          source_text: null,
        });
      }
    }

    if (facts.doctor && (facts.doctor.name || facts.doctor.facility || facts.doctor.specialization)) {
      const docStr = [facts.doctor.name, facts.doctor.specialization, facts.doctor.facility].filter(Boolean).join(', ');
      store.addFact({
        document_id: docId,
        user_id: req.user.id,
        category: 'doctor',
        field_name: 'Attending Physician & Facility',
        field_value: docStr,
        unit: null,
        reference_range: null,
        status: 'found',
        report_date: reportDate,
        source_text: null,
      });
    }

    if (facts.patient && Object.values(facts.patient).some(Boolean)) {
      store.upsertProfile(req.user.id, facts.patient);
    }

    docRecord.upload_status = 'extracted';
    docRecord.extracted_at = new Date().toISOString();

    return res.status(201).json({
      message: 'Document uploaded and extracted successfully.',
      document_id: docId,
      original_filename: file.originalname,
      facts_preview: facts,
    });
  } catch (err: any) {
    docRecord.upload_status = 'error';
    return res.status(500).json({
      error: `Extraction failed: ${err.message || String(err)}`,
      document_id: docId,
    });
  }
});

app.delete('/api/documents/:id', requireAuth, (req: any, res: any) => {
  const doc = store.getDocument(req.params.id);
  if (!doc || doc.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Document not found.' });
  }

  const filePath = path.join(uploadFolder, doc.filename);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // ignore
    }
  }

  store.deleteDocument(req.params.id, req.user.id);
  return res.json({ message: 'Document deleted.' });
});

// ──────────────────────────────────────────────────────────────
// Summary & Analysis Routes
// ──────────────────────────────────────────────────────────────

app.get('/api/summary/patient-data', requireAuth, (req: any, res: any) => {
  const data = store.getPatientData(req.user.id);
  return res.json(data);
});

app.get('/api/summary/latest', requireAuth, (req: any, res: any) => {
  const type = req.query.type as string | undefined;
  const summary = store.getLatestSummary(req.user.id, type);
  const patientData = store.getPatientData(req.user.id);
  return res.json({
    title: summary?.title || 'Medical Summary Report',
    summary_type: summary?.summary_type || (type || 'comprehensive'),
    summary: summary?.content || null,
    generated_at: summary?.generated_at || null,
    patient_data: patientData,
  });
});

app.get('/api/summary/history', requireAuth, (req: any, res: any) => {
  const summaries = store.listSummaries(req.user.id);
  return res.json({ summaries });
});

app.post('/api/summary/generate', requireAuth, async (req: any, res: any) => {
  const patientData = store.getPatientData(req.user.id);
  if (!patientData.documents || !patientData.documents.length) {
    return res.status(400).json({ error: 'No documents uploaded yet.' });
  }

  const summaryType = (req.body?.summary_type || 'comprehensive').trim();

  try {
    const result = await generateMedicalSummary(patientData, summaryType);
    const docIds = patientData.documents.map((d: any) => d.id);
    store.saveSummary(req.user.id, result.summary_type, result.content, result.title, docIds);
    return res.json({
      title: result.title,
      summary_type: result.summary_type,
      summary: result.content,
      patient_data: patientData,
    });
  } catch (err: any) {
    return res.status(502).json({ error: err.message || 'Generation failed' });
  }
});

app.post('/api/summary/analyze', requireAuth, async (req: any, res: any) => {
  const patientData = store.getPatientData(req.user.id);
  if (!patientData.documents || !patientData.documents.length) {
    return res.status(400).json({ error: 'No documents uploaded yet.' });
  }

  try {
    const analysis = await analyzeMedicalRecords(patientData);
    const docIds = patientData.documents.map((d: any) => d.id);
    store.saveSummary(req.user.id, 'analysis', JSON.stringify(analysis), 'Medical Records Analysis', docIds);
    return res.json({ analysis });
  } catch (err: any) {
    return res.status(502).json({ error: err.message || 'Analysis failed' });
  }
});

// ──────────────────────────────────────────────────────────────
// Symptom Checker Routes (Requirement 5)
// ──────────────────────────────────────────────────────────────

app.post('/api/symptoms/assess', requireAuth, async (req: any, res: any) => {
  const { primary_symptom, duration, severity, associated_symptoms, notes } = req.body || {};

  if (!primary_symptom || !primary_symptom.trim()) {
    return res.status(400).json({ error: 'Please describe your main symptom.' });
  }

  const patientData = store.getPatientData(req.user.id);

  try {
    const assessment = await assessSymptoms(
      {
        primary_symptom: primary_symptom.trim(),
        duration: duration || 'Recently',
        severity: parseInt(severity || '5', 10),
        associated_symptoms: Array.isArray(associated_symptoms) ? associated_symptoms : [],
        notes: notes || '',
      },
      patientData
    );

    const report = store.saveSymptomReport(req.user.id, {
      primary_symptom: primary_symptom.trim(),
      duration: duration || 'Recently',
      severity: parseInt(severity || '5', 10),
      associated_symptoms: Array.isArray(associated_symptoms) ? associated_symptoms : [],
      notes: notes || '',
      assessment,
    });

    return res.json({ report });
  } catch (err: any) {
    return res.status(502).json({ error: err.message || 'Symptom assessment failed' });
  }
});

app.get('/api/symptoms/history', requireAuth, (req: any, res: any) => {
  const reports = store.getSymptomReports(req.user.id);
  return res.json({ reports });
});

app.get('/api/symptoms/latest', requireAuth, (req: any, res: any) => {
  const report = store.getLatestSymptomReport(req.user.id);
  return res.json({ report });
});

// ──────────────────────────────────────────────────────────────
// Q&A Routes
// ──────────────────────────────────────────────────────────────

app.post('/api/qa/ask', requireAuth, async (req: any, res: any) => {
  const question = (req.body?.question || '').trim();
  if (!question) {
    return res.status(400).json({ error: 'Question is required.' });
  }

  const patientData = store.getPatientData(req.user.id);

  try {
    const answer = await answerQuestion(question, patientData);
    store.addQA(req.user.id, question, answer);
    return res.json({ question, answer });
  } catch (err: any) {
    return res.status(502).json({ error: err.message || 'Failed to answer question' });
  }
});

app.get('/api/qa/history', requireAuth, (req: any, res: any) => {
  const history = store.getQAHistory(req.user.id);
  return res.json({ history });
});

app.delete('/api/qa/history', requireAuth, (req: any, res: any) => {
  store.clearQAHistory(req.user.id);
  return res.json({ message: 'Conversation history cleared.' });
});

// ──────────────────────────────────────────────────────────────
// PDF Generation Route
// ──────────────────────────────────────────────────────────────

app.post('/api/pdf/generate', requireAuth, async (req: any, res: any) => {
  const patientData = store.getPatientData(req.user.id);
  if (!patientData.documents || !patientData.documents.length) {
    return res.status(400).json({ error: 'No documents uploaded yet.' });
  }

  const latest = store.getLatestSummary(req.user.id);
  const summaryText = latest ? latest.content : (await generateMedicalSummary(patientData)).content;

  let analysis: any = null;
  if (req.body?.include_analysis !== false) {
    try {
      analysis = await analyzeMedicalRecords(patientData);
    } catch {
      analysis = null;
    }
  }

  try {
    const pdfBuffer = await generateSummaryPdf(patientData, summaryText, analysis);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="medical_summary.pdf"');
    return res.send(pdfBuffer);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'PDF generation failed.' });
  }
});

// ──────────────────────────────────────────────────────────────
// System & AI Engine Status
// ──────────────────────────────────────────────────────────────

app.get(['/api/system/status', '/api/system/api-info'], (_req, res) => {
  return res.json(getCurrentApiInfo());
});

app.get('/api/system/user-api', (_req, res) => {
  const info = getCurrentApiInfo();
  return res.json({
    status: 'connected',
    message: 'User-provided API credentials are active and integrated.',
    user_provided_api: info.user_provided_api,
    linked_records: {
      abha_format: true,
      scheme: 'k2',
      client_id: info.user_provided_api.client_id,
    },
    timestamp: new Date().toISOString(),
  });
});

// ──────────────────────────────────────────────────────────────
// SPA Fallback & Static Catch-all
// ──────────────────────────────────────────────────────────────

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'templates', 'index.html'));
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`  Medical Report AI`);
  console.log(`  http://0.0.0.0:${port}`);
  console.log(`====================================================`);
});
