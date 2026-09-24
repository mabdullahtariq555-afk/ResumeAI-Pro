require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const puppeteer = require('puppeteer');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const path = require('path');

const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle
} = require('docx');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '5mb' }));
app.use(rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false
}));
app.use(express.static(path.join(process.cwd(), 'public'), { extensions: ['html'] }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'text/plain',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    const allowedExtensions = ['.txt', '.pdf', '.docx'];
    const ext = path.extname(file.originalname || '').toLowerCase();

    if (allowedExtensions.includes(ext) &&
        (allowedMimeTypes.includes(file.mimetype) ||
         (ext === '.txt' && file.mimetype === 'application/octet-stream'))) {
      return cb(null, true);
    }
    cb(new Error('Only TXT, PDF, and DOCX files are supported.'));
  }
});

function cleanText(value) {
  return String(value ?? '').trim();
}

async function extractResumeText(file) {
  if (!file?.buffer) throw new Error('Resume file is required.');
  const ext = path.extname(file.originalname || '').toLowerCase();

  if (ext === '.txt') return file.buffer.toString('utf8').trim();

  if (ext === '.pdf') {
    const result = await pdfParse(file.buffer);
    return cleanText(result.text);
  }

  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return cleanText(result.value);
  }

  throw new Error('Unsupported resume file format.');
}

async function gemini(prompt, responseMimeType = 'text/plain') {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }

  const models = [
    GEMINI_MODEL,
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash'
  ].filter((model, index, arr) => model && arr.indexOf(model) === index);

  let lastError = null;

  for (let i = 0; i < models.length; i++) {
    const model = models[i];

    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(model) +
      ':generateContent';

    const generationConfig = {
      temperature: 0.35,
      maxOutputTokens: 3000
    };

    if (responseMimeType === 'application/json') {
      generationConfig.responseMimeType = 'application/json';
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig
        })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const message =
          data?.error?.message ||
          `Gemini request failed (${response.status})`;

        if (response.status === 401 || response.status === 403) {
          throw new Error(
            'Gemini API key is invalid or does not have API access.'
          );
        }

        if (
          response.status === 404 ||
          response.status === 429 ||
          response.status === 500 ||
          response.status === 503
        ) {
          lastError = new Error(
            `Gemini ${model} unavailable/busy (${response.status}): ${message}`
          );

          console.warn(lastError.message);

          if (i < models.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
            continue;
          }
        }

        throw new Error(message);
      }

      const text =
        data?.candidates?.[0]?.content?.parts
          ?.map(p => p?.text || '')
          .join('')
          .trim() || '';

      if (!text) {
        if (data?.promptFeedback?.blockReason) {
          throw new Error(
            `Gemini blocked the request: ${data.promptFeedback.blockReason}`
          );
        }

        throw new Error('Gemini returned an empty response.');
      }

      if (model !== GEMINI_MODEL) {
        console.log(`Gemini fallback succeeded with ${model}`);
      }

      return text;

    } catch (error) {
      lastError = error;

      if (
        i < models.length - 1 &&
        /unavailable\/busy|status 404|status 429|status 500|status 503/i
          .test(error?.message || '')
      ) {
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }

      throw error;
    }
  }

  throw lastError || new Error('Gemini request failed.');
}
function resumeRules(extra = '') {
  return `
You are ResumeAI, a professional resume assistant.

STRICT FACT-PRESERVATION RULES:
- Never invent employers, job titles, dates, degrees, certifications, skills, achievements, metrics, technologies, responsibilities, awards, or projects.
- Use only facts explicitly supplied by the user.
- If information is missing, identify it as missing or requiring user input.
- Do not convert a suggestion into a claimed fact.
- For a rewrite, preserve the factual meaning of the original text.
- Keep wording professional and ATS-friendly.
- This is a NO-LOGIN application.
${extra}
`.trim();
}

function parseJson(text) {
  const cleaned = String(text || '').trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

function normalizeAnalysis(value) {
  const x = value && typeof value === 'object' ? value : {};
  const ats = x.ats_analysis && typeof x.ats_analysis === 'object' ? x.ats_analysis : {};
  const suggestions = Array.isArray(x.suggestions) ? x.suggestions : [];
  const interview = Array.isArray(x.interview_questions) ? x.interview_questions : [];

  return {
    ats_analysis: {
      overall_score: Math.max(0, Math.min(100, Number(ats.overall_score) || 0)),
      job_fit_score: Math.max(0, Math.min(100, Number(ats.job_fit_score) || 0)),
      missing_keywords: Array.isArray(ats.missing_keywords)
        ? ats.missing_keywords.map(String).filter(Boolean).slice(0, 30)
        : []
    },
    suggestions: suggestions.slice(0, 30).map((s, i) => ({
      id: cleanText(s?.id) || `suggestion-${i + 1}`,
      section: cleanText(s?.section) || 'Resume',
      evidence_mapping: cleanText(s?.evidence_mapping) || 'Source text supplied by user',
      impact: cleanText(s?.impact) || 'Medium',
      original_text: cleanText(s?.original_text),
      improved_text: cleanText(s?.improved_text),
      reason: cleanText(s?.reason),
      requires_user_input: Boolean(s?.requires_user_input),
      applied: Boolean(s?.applied)
    })),
    cover_letter: cleanText(x.cover_letter),
    interview_questions: interview.slice(0, 20).map(q => ({
      question: cleanText(q?.question),
      expected_answer: cleanText(q?.expected_answer)
    }))
  };
}

app.get('/api/config', (req, res) => {
  res.json({
    configured: Boolean(GEMINI_API_KEY),
    noLogin: true,
    provider: 'gemini'
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    geminiConfigured: Boolean(GEMINI_API_KEY),
    noLogin: true,
    provider: 'gemini'
  });
});

app.post('/api/upload-resume', upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'TXT, PDF, or DOCX resume file is required.' });
    const text = await extractResumeText(req.file);
    if (!text) return res.status(422).json({ error: 'Resume se readable text extract nahi hua.' });
    if (text.length > 100000) return res.status(413).json({ error: 'Extracted resume text is too large.' });

    res.json({
      text,
      filename: req.file.originalname,
      type: path.extname(req.file.originalname).toLowerCase()
    });
  } catch (error) {
    console.error('Resume upload error:', error);
    res.status(400).json({ error: error?.message || 'Resume file process nahi ho saki.' });
  }
});

app.post('/api/ai', async (req, res) => {
  const { prompt, responseMimeType = 'text/plain' } = req.body || {};
  if (typeof prompt !== 'string' || !prompt.trim()) return res.status(400).json({ error: 'Prompt is required.' });
  if (prompt.length > 30000) return res.status(413).json({ error: 'Prompt is too large.' });

  try {
    const text = await gemini(`${resumeRules()}\n\nUSER REQUEST:\n${prompt}`, responseMimeType);
    res.json({ text });
  } catch (error) {
    console.error('Gemini error:', error?.message || error);
    res.status(502).json({ error: error?.message || 'Gemini request failed.' });
  }
});

app.post('/api/analyze', async (req, res) => {
  const { resumeText, jd = '' } = req.body || {};
  if (typeof resumeText !== 'string' || !resumeText.trim()) {
    return res.status(400).json({ error: 'Resume text is required.' });
  }
  if (resumeText.length > 100000) return res.status(413).json({ error: 'Resume text is too large.' });
  if (typeof jd !== 'string') return res.status(400).json({ error: 'Job description must be text.' });

  const prompt = `${resumeRules(`
Return VALID JSON ONLY using exactly this shape:
{
  "ats_analysis": {
    "overall_score": 0,
    "job_fit_score": 0,
    "missing_keywords": []
  },
  "suggestions": [
    {
      "id": "suggestion-1",
      "section": "Experience",
      "evidence_mapping": "Exact resume evidence used",
      "impact": "High",
      "original_text": "Exact existing resume text",
      "improved_text": "Improved version without adding facts",
      "reason": "Why this improves ATS clarity",
      "requires_user_input": false
    }
  ],
  "cover_letter": "Tailored cover letter using only supplied facts",
  "interview_questions": [
    {
      "question": "Question",
      "expected_answer": "Answer guidance based only on supplied facts"
    }
  ]
}
Scores must be 0-100. original_text must be an exact substring of the supplied resume when a rewrite is proposed. missing_keywords are requirements not demonstrated by the supplied resume, not invented candidate facts. If a useful improvement requires missing information, set requires_user_input=true and do not invent it.
  `)}

RESUME:
${resumeText}

JOB DESCRIPTION:
${jd || '(No job description supplied. Analyze general ATS quality and leave job-fit contextual limitations clear.)'}`;

  try {
    const raw = await gemini(prompt, 'application/json');
    const normalized = normalizeAnalysis(parseJson(raw));
    res.json(normalized);
  } catch (error) {
    console.error('Analysis error:', error?.message || error);
    res.status(502).json({ error: error?.message || 'Resume analysis failed.' });
  }
});

function safeText(value) { return String(value ?? '').trim(); }

function docxHeading(text) {
  return new Paragraph({
    text: safeText(text),
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 100 },
    border: { bottom: { color: 'CBD5E1', style: BorderStyle.SINGLE, size: 6 } }
  });
}

function docxBullet(text) {
  return new Paragraph({
    text: safeText(text),
    bullet: { level: 0 },
    spacing: { after: 60 }
  });
}

app.post('/api/docx', async (req, res) => {
  try {
    const resume = req.body?.resume;
    if (!resume || !resume.personal) return res.status(400).json({ error: 'Structured resume data is required.' });

    const p = resume.personal || {};
    const children = [];
    const name = safeText(p.name) || 'Your Name';

    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [new TextRun({ text: name, bold: true, size: 34, color: '172033' })]
    }));

    if (p.headline) children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: safeText(p.headline), size: 22, color: '475569' })]
    }));

    const contact = [p.email,p.phone,p.location,p.linkedin,p.website].filter(Boolean).map(safeText).join(' â€¢ ');
    if (contact) children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 260 },
      children: [new TextRun({ text: contact, size: 17, color: '64748B' })]
    }));

    if (resume.summary) {
      children.push(docxHeading('Professional Summary'));
      children.push(new Paragraph({ text: safeText(resume.summary), spacing: { after: 120 } }));
    }

    const experience = Array.isArray(resume.experience) ? resume.experience.filter(x => x.title || x.company || x.description || x.desc) : [];
    if (experience.length) {
      children.push(docxHeading('Experience'));
      experience.forEach(item => {
        const description = item.description ?? item.desc ?? '';
        children.push(new Paragraph({
          children: [
            new TextRun({ text: safeText(item.title), bold: true }),
            new TextRun({ text: item.company ? ` â€” ${safeText(item.company)}` : '', color: '475569' }),
            new TextRun({ text: item.start || item.end ? `    ${safeText(item.start || item.dates)} â€“ ${safeText(item.end || '')}` : item.dates ? `    ${safeText(item.dates)}` : '', color: '64748B' })
          ],
          spacing: { before: 120 }
        }));
        safeText(description).split(/\r?\n/).filter(Boolean).forEach(line => children.push(docxBullet(line)));
      });
    }

    if (Array.isArray(resume.skills) && resume.skills.length) {
      children.push(docxHeading('Skills'));
      children.push(new Paragraph({ text: resume.skills.map(safeText).filter(Boolean).join(' â€¢ ') }));
    }

    const projects = Array.isArray(resume.projects) ? resume.projects.filter(x => x.name || x.description || x.desc) : [];
    if (projects.length) {
      children.push(docxHeading('Projects'));
      projects.forEach(item => {
        children.push(new Paragraph({
          children: [
            new TextRun({ text: safeText(item.name), bold: true }),
            new TextRun({ text: item.link ? ` â€” ${safeText(item.link)}` : '' })
          ]
        }));
        const desc = item.description ?? item.desc ?? '';
        if (desc) children.push(new Paragraph({ text: safeText(desc) }));
      });
    }

    const education = Array.isArray(resume.education) ? resume.education.filter(x => x.degree || x.school) : [];
    if (education.length) {
      children.push(docxHeading('Education'));
      education.forEach(item => children.push(new Paragraph({
        children: [
          new TextRun({ text: safeText(item.degree), bold: true }),
          new TextRun({ text: item.school ? ` â€” ${safeText(item.school)}` : '' }),
          new TextRun({ text: item.year ? ` (${safeText(item.year)})` : '', color: '64748B' })
        ]
      })));
    }

    const certifications = Array.isArray(resume.certifications) ? resume.certifications.filter(x => x.name || x.issuer) : [];
    if (certifications.length) {
      children.push(docxHeading('Certifications'));
      certifications.forEach(item => children.push(new Paragraph({
        text: [item.name, item.issuer, item.year].filter(Boolean).map(safeText).join(' â€” ')
      })));
    }

    const doc = new Document({
      sections: [{
        properties: { page: { margin: { top: 720, right: 850, bottom: 720, left: 850 } } },
        children
      }]
    });

    const buffer = await Packer.toBuffer(doc);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename="optimized-resume.docx"');
    res.send(buffer);
  } catch (error) {
    console.error('DOCX error:', error);
    res.status(500).json({ error: error?.message || 'DOCX export failed.' });
  }
});

const PDF_CSS = `
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff}
body{font-family:Arial,Helvetica,sans-serif;color:#172033}
.resume-page{background:#fff;width:210mm;min-height:297mm;padding:45px}
.resume-page h1{margin:0 0 5px;font-size:34px}
.resume-page .contact{color:#667085;font-size:13px;margin-bottom:25px}
.resume-page h2{font-size:16px;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid #ddd;padding-bottom:5px;margin-top:24px}
.resume-page p{line-height:1.55}
.resume-page ul{padding-left:20px}
.resume-page.modern{border-top:10px solid var(--accent,#4f46e5)}
.resume-page.classic{font-family:Georgia,serif}
.resume-page.minimal{padding:55px 65px}
.resume-page.executive{border-left:8px solid var(--accent,#4f46e5);padding-left:38px}
.resume-page.creative{border-radius:16px;border-top:14px solid var(--accent,#4f46e5)}
.resume-page.corporate{font-family:Arial,sans-serif}
.resume-page.corporate h2{border-bottom:3px solid var(--accent,#4f46e5)}
.resume-page.elegant{font-family:Georgia,serif}
.resume-page.compact{padding:32px}
.resume-page.compact h2{margin-top:15px}
.resume-page.compact p{line-height:1.35}
.resume-page.tech{font-family:Consolas,monospace}
.resume-page.tech h2{color:var(--accent,#4f46e5);border-bottom:1px solid currentColor}
.resume-page.academic{font-family:Georgia,serif}
.resume-page.academic h2{text-transform:none;letter-spacing:0}
.resume-page.bold{border-top:16px solid var(--accent,#4f46e5)}
.resume-page.bold h1{font-size:40px;font-weight:900}
.resume-page.clean h2{border-bottom:1px solid #bbb}
.resume-page h3{margin:8px 0 3px;font-size:13px}
.resume-page .tag{display:inline-block;background:#eef0ff;color:#3730a3;padding:5px 8px;border-radius:6px;margin:3px;font-size:12px}
.professional-resume{width:210mm;min-height:297mm;padding:42px 50px;background:#fff;color:#172033;font-family:Arial,Helvetica,sans-serif}
.professional-resume .resume-header{padding-bottom:18px;border-bottom:2px solid #1e293b}
.professional-resume h1{font-size:32px;line-height:1.1}
.professional-resume .resume-headline{margin-top:7px;font-size:14px;color:#475569}
.professional-resume .resume-contact{margin-top:10px;font-size:10px;color:#64748b}
.professional-resume .resume-section{margin-top:18px}
.professional-resume .resume-section h2{font-size:12px;margin:0 0 8px;padding-bottom:4px}
.professional-resume .resume-entry{margin-bottom:12px}
.professional-resume .entry-top{display:flex;justify-content:space-between;gap:12px;font-size:12px}
.professional-resume .entry-company{font-size:11px;color:#475569;font-weight:600;margin-top:2px}
.professional-resume .resume-section p,.professional-resume .resume-section li{font-size:10.5px;line-height:1.45}
.professional-resume .resume-section ul{margin:5px 0 0;padding-left:16px}
.professional-resume .skill-list span{display:inline-block;padding:3px 6px;border:1px solid #cbd5e1;border-radius:3px;font-size:10px;margin:2px}
.professional-resume.modern{border-top:10px solid #1e293b}
.professional-resume.classic{font-family:Georgia,serif}
.professional-resume.minimal{border-left:6px solid #64748b}
.professional-resume.executive{border-top:12px solid #0f172a}
.professional-resume.corporate{border-top:8px solid #2563eb}
.professional-resume.creative{border-left:10px solid #7c3aed}
.professional-resume.academic{font-family:Georgia,serif;border:1px solid #334155}
.professional-resume.compact{padding:28px 36px}
.professional-resume.technical{border-top:8px solid #0891b2;font-family:Arial,sans-serif}
.professional-resume.elegant{border-top:4px solid #a16207;font-family:Georgia,serif}
@page{size:A4;margin:0}
`;

app.post('/api/pdf', async (req, res) => {
  const { html, filename = 'resume.pdf' } = req.body || {};
  if (typeof html !== 'string' || !html.trim()) return res.status(400).json({ error: 'Resume HTML is required.' });
  if (html.length > 500000) return res.status(413).json({ error: 'Resume is too large.' });

  let browser;
  try {
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${PDF_CSS}</style></head><body>${html}</body></html>`, { waitUntil: 'load' });
    const pdf = await page.pdf({ format:'A4', printBackground:true, preferCSSPageSize:true, margin:{top:0,right:0,bottom:0,left:0} });
    const clean = String(filename).replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,100) || 'resume.pdf';
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${clean.endsWith('.pdf') ? clean : clean+'.pdf'}"`);
    res.send(pdf);
  } catch (error) {
    console.error('PDF error:', error);
    res.status(500).json({ error:error?.message || 'PDF generation failed.' });
  } finally {
    if (browser) await browser.close().catch(()=>{});
  }
});

app.use((req,res,next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    return res.sendFile(path.join(process.cwd(),'public','index.html'));
  }
  next();
});

app.use((req,res) => res.status(404).json({ error:'Not found' }));

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`ResumeAI Pro running at http://127.0.0.1:${PORT}`);
  console.log(`Gemini configured: ${Boolean(GEMINI_API_KEY)}`);
  console.log(`Gemini model: ${GEMINI_MODEL}`);
});

server.on('error', (error) => {
  console.error('Server startup error:', error);

  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already being used.`);
  } else if (error.code === 'EACCES') {
    console.error(`Permission denied for port ${PORT}.`);
  }

  process.exit(1);
});


