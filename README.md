# ResumeAI Pro — No Login

No-login ResumeAI Pro with:
- Gemini AI (server-side API key)
- ATS score and Job Fit
- Skill gap analysis
- Evidence-mapped AI suggestions
- User confirmation before applying changes
- Individual change history and revert
- Privacy-safe Draft Mode
- TXT/PDF/DOCX resume import
- Structured resume editor
- 12 professional templates
- Live professional preview
- PDF export with selected template
- DOCX export
- Cover letter and interview preparation
- Local resume versions and compare/restore
- Browser localStorage; no Supabase/login required

## Setup

Use Node.js 20+.

```powershell
npm.cmd install
npm.cmd start
```

Open http://localhost:3000

`.env`:

```env
PORT=3000
GEMINI_API_KEY=your_key
GEMINI_MODEL=gemini-3.1-flash-lite
```

Never put the Gemini key in frontend files.

## Data

This no-login version stores resume data locally in the browser using localStorage. There is no Supabase dependency or authentication flow.
