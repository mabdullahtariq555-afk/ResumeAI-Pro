const site = document.getElementById('site');
let config = {};
let resumes = [];
let current = null;
let currentAnalysis = null;
let aiBusy = false;

const esc = x => String(x ?? '').replace(/[&<>"']/g, m => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[m]));

const uid = () => crypto.randomUUID();
const $ = id => document.getElementById(id);
const APP_VERSION = '3.1.0-fixed';

const templates = [
  ['modern','Modern'],['classic','Classic'],['minimal','Minimal'],
  ['executive','Executive'],['corporate','Corporate'],['creative','Creative'],
  ['academic','Academic'],['compact','Compact'],['technical','Technical'],
  ['elegant','Elegant'],['bold','Bold'],['clean','Clean']
];

function blankResume() {
  return {
    id: uid(),
    name: 'My Resume',
    template: 'modern',
    accent: '#4f46e5',
    personal: {name:'',headline:'',email:'',phone:'',location:'',linkedin:'',website:''},
    summary:'',
    experience:[],
    education:[],
    skills:[],
    projects:[],
    certifications:[],
    languages:[],
    hobbies:[],
    rawText:'',
    jd:'',
    analysis:null,
    versions:[],
    changeHistory:[],
    _updated_at: Date.now()
  };
}

function saveResumes() {
  localStorage.setItem('resumeai_resumes', JSON.stringify(resumes));
}

function loadResumes() {
  try { resumes = JSON.parse(localStorage.getItem('resumeai_resumes') || '[]'); }
  catch { resumes = []; }
}

function toast(message) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

function score(r) {
  let s=0,p=r.personal||{};
  if(p.name)s+=10;if(p.email)s+=5;if(p.phone)s+=5;
  if((r.summary||'').length>60)s+=15;else if(r.summary)s+=7;
  if(r.experience?.length)s+=15;if(r.education?.length)s+=10;
  if((r.skills||[]).length>=5)s+=15;else if(r.skills?.length)s+=8;
  if(r.projects?.length)s+=8;if(r.certifications?.length)s+=5;
  return Math.min(100,s);
}

function renderList(items) {
  return items.filter(Boolean).map(x => `<li>${esc(x)}</li>`).join('');
}

function resumeHTML(r) {
  r=r||{};
  const p=(r.personal&&typeof r.personal==='object')?r.personal:{};
  const e=Array.isArray(r.experience)?r.experience:[];
  const ed=Array.isArray(r.education)?r.education:[];
  const sk=Array.isArray(r.skills)?r.skills:[];
  const pr=Array.isArray(r.projects)?r.projects:[];
  const ce=Array.isArray(r.certifications)?r.certifications:[];
  const template=['modern','classic','minimal','executive','corporate','creative','academic','compact','technical','elegant','bold','clean'].includes(r.template)?r.template:'modern';
  const accent=(typeof r.accent==='string' && /^#[0-9a-fA-F]{6}$/.test(r.accent))?r.accent:'#4f46e5';
  let h=`<div class="professional-resume ${template}" style="--accent:${accent}">
    <header class="resume-header">
      <h1>${esc(p.name||'Your Name')}</h1>
      ${p.headline?`<div class="resume-headline">${esc(p.headline)}</div>`:''}
      ${[p.email,p.phone,p.location,p.linkedin,p.website].filter(Boolean).length?`<div class="resume-contact">${[p.email,p.phone,p.location,p.linkedin,p.website].filter(Boolean).map(esc).join(' • ')}</div>`:''}
    </header>`;
  if(r.summary) h+=`<section class="resume-section"><h2>Professional Summary</h2><p>${esc(r.summary).replace(/\n/g,'<br>')}</p></section>`;
  if(e.length) h+=`<section class="resume-section"><h2>Experience</h2>${e.map(x=>{x=x||{};const desc=String(x.desc??x.description??'');return `<div class="resume-entry"><div class="entry-top"><strong>${esc(x.title||'Position')}</strong><span>${esc(x.dates??`${x.start||''} – ${x.end||''}`)}</span></div><div class="entry-company">${esc(x.company||'')}</div>${desc?`<ul>${renderList(desc.split(/\r?\n/))}</ul>`:''}</div>`}).join('')}</section>`;
  if(sk.filter(Boolean).length) h+=`<section class="resume-section"><h2>Skills</h2><div class="skill-list">${sk.filter(Boolean).map(x=>`<span>${esc(x)}</span>`).join('')}</div></section>`;
  if(pr.length) h+=`<section class="resume-section"><h2>Projects</h2>${pr.map(x=>{x=x||{};const d=String(x.desc??x.description??'');return `<div class="resume-entry"><strong>${esc(x.name||'Project')}</strong>${x.link?`<div class="entry-link">${esc(x.link)}</div>`:''}${d?`<p>${esc(d).replace(/\n/g,'<br>')}</p>`:''}</div>`}).join('')}</section>`;
  if(ed.length) h+=`<section class="resume-section"><h2>Education</h2>${ed.map(x=>{x=x||{};return `<div class="resume-entry"><div class="entry-top"><strong>${esc(x.degree||'Degree')}</strong><span>${esc(x.year||'')}</span></div><div class="entry-company">${esc(x.school||'')}</div></div>`}).join('')}</section>`;
  if(ce.length) h+=`<section class="resume-section"><h2>Certifications</h2>${ce.map(x=>{x=x||{};return `<div class="resume-entry"><strong>${esc(x.name||'Certification')}</strong>${x.issuer?`<span> — ${esc(x.issuer)}</span>`:''}${x.year?` <span>(${esc(x.year)})</span>`:''}</div>`}).join('')}</section>`;
  return h+'</div>';
}

function render() {
  if (!current) return dashboard();
  builder();
}

function dashboard() {
  const total=resumes.length, avg=total?Math.round(resumes.reduce((a,r)=>a+score(r),0)/total):0, best=total?Math.max(...resumes.map(score)):0;
  site.innerHTML=`<header class="nav"><div class="logo">ResumeAI Pro</div><div class="actions"><span class="status ${config.configured?'':'off'}">${config.configured?'Gemini connected':'Gemini not configured'}</span><button class="btn primary" onclick="newResume()">+ New Resume</button></div></header>
  <main class="app">
    <div class="topbar"><div><h1>Resume Dashboard</h1><p class="muted">No-login mode · data stays in this browser.</p></div></div>
    <div class="stats"><div class="stat"><span>Resumes</span><br><b>${total}</b></div><div class="stat"><span>Average ATS</span><br><b>${avg}%</b></div><div class="stat"><span>Best Profile</span><br><b>${best}%</b></div><div class="stat"><span>AI Status</span><br><b style="font-size:14px">${config.configured?'Ready':'Not configured'}</b></div></div>
    <div class="actions" style="margin-bottom:14px"><button class="btn primary" onclick="newResume()">Create Resume</button></div>
    <div class="cards" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px">
      ${total?resumes.map(r=>`<div class="card" style="padding:18px"><h3>${esc(r.name)}</h3><p class="muted">${esc(r.personal?.name||'Untitled candidate')}</p><div class="score">ATS profile: ${score(r)}%</div><small class="muted">Updated ${new Date(r._updated_at||Date.now()).toLocaleString()}</small><div class="actions" style="margin-top:13px"><button class="btn primary" onclick="editResume('${r.id}')">Edit</button><button class="btn" onclick="previewResume('${r.id}')">Preview</button><button class="btn" onclick="duplicateResume('${r.id}')">Duplicate</button><button class="btn danger" onclick="deleteResume('${r.id}')">Delete</button></div></div>`).join(''):`<div class="panel"><h2>No resumes yet</h2><p class="muted">Create your first resume.</p></div>`}
    </div>
  </main>`;
}

function newResume(){ current=blankResume(); currentAnalysis=null; render(); }
function editResume(id){ const r=resumes.find(x=>x.id===id); if(!r)return; current=structuredClone(r); currentAnalysis=current.analysis||null; render(); }
function previewResume(id){ const r=resumes.find(x=>x.id===id); if(r) openPreview(r); }
function duplicateResume(id){ const r=structuredClone(resumes.find(x=>x.id===id)); if(!r)return; r.id=uid(); r.name+=' Copy'; r._updated_at=Date.now(); resumes.unshift(r); saveResumes(); toast('Resume duplicated.'); dashboard(); }
function deleteResume(id){ if(!confirm('Delete this resume?'))return; resumes=resumes.filter(x=>x.id!==id); saveResumes(); dashboard(); }
function persistCurrent(){ if(!current)return; current._updated_at=Date.now(); const copy=structuredClone(current); const i=resumes.findIndex(x=>x.id===copy.id); if(i>=0)resumes[i]=copy;else resumes.unshift(copy); saveResumes(); }

function input(path,value){
  const parts=path.split('.'); let o=current;
  for(let i=0;i<parts.length-1;i++) o=o[parts[i]];
  o[parts.at(-1)]=value; persistCurrent(); updatePreview();
}
function add(arr){ current[arr].push(['skills','languages','hobbies'].includes(arr)?'':{}); persistCurrent(); builder(); }
function del(arr,i){ current[arr].splice(i,1); persistCurrent(); builder(); }
function setArr(arr,i,key,val){ if(['skills','languages','hobbies'].includes(arr)) current[arr][i]=val; else current[arr][i][key]=val; persistCurrent(); updatePreview(); }

function personalSection(r){
  const fields=[['name','Full Name'],['headline','Professional Headline'],['email','Email'],['phone','Phone'],['location','Location'],['linkedin','LinkedIn'],['website','Website']];
  return `<div class="section"><h3>Personal Information</h3><div class="grid2">${fields.map(([k,l])=>`<div class="field"><label>${l}</label><input value="${esc(r.personal?.[k]||'')}" oninput="input('personal.${k}',this.value)"></div>`).join('')}</div></div>`;
}
function summarySection(r){return `<div class="section"><div class="section-head"><h3>Professional Summary</h3><button class="btn" onclick="aiSummary()">Improve Summary</button></div><div class="field"><textarea oninput="input('summary',this.value)">${esc(r.summary||'')}</textarea></div></div>`;}
function experienceSection(r){return `<div class="section"><div class="section-head"><h3>Work Experience</h3><button class="btn" onclick="add('experience')">+ Add</button></div>${(r.experience||[]).map((x,i)=>`<div class="item"><div class="grid2"><div class="field"><label>Job Title</label><input value="${esc(x.title||'')}" oninput="setArr('experience',${i},'title',this.value)"></div><div class="field"><label>Company</label><input value="${esc(x.company||'')}" oninput="setArr('experience',${i},'company',this.value)"></div><div class="field"><label>Start</label><input value="${esc(x.start||'')}" oninput="setArr('experience',${i},'start',this.value)"></div><div class="field"><label>End</label><input value="${esc(x.end||'')}" oninput="setArr('experience',${i},'end',this.value)"></div></div><div class="field"><label>Achievements / responsibilities</label><textarea oninput="setArr('experience',${i},'description',this.value)">${esc(x.description??x.desc??'')}</textarea></div><button class="btn danger" onclick="del('experience',${i})">Remove</button><button class="btn" onclick="aiExperience(${i})">Enhance with AI</button></div>`).join('')}</div>`;}
function educationSection(r){return `<div class="section"><div class="section-head"><h3>Education</h3><button class="btn" onclick="add('education')">+ Add</button></div>${(r.education||[]).map((x,i)=>`<div class="item"><div class="grid2"><div class="field"><input placeholder="Degree" value="${esc(x.degree||'')}" oninput="setArr('education',${i},'degree',this.value)"></div><div class="field"><input placeholder="School / University" value="${esc(x.school||'')}" oninput="setArr('education',${i},'school',this.value)"></div></div><div class="field"><input placeholder="Year" value="${esc(x.year||'')}" oninput="setArr('education',${i},'year',this.value)"></div><button class="btn danger" onclick="del('education',${i})">Remove</button></div>`).join('')}</div>`;}
function skillsSection(r){return `<div class="section"><div class="section-head"><h3>Skills</h3><button class="btn" onclick="add('skills')">+ Add</button></div>${(r.skills||[]).map((x,i)=>`<span style="display:inline-flex;gap:4px;margin:4px"><input style="width:150px;border:1px solid var(--border);border-radius:7px;padding:8px" value="${esc(x)}" oninput="setArr('skills',${i},'',this.value)"><button class="btn danger" onclick="del('skills',${i})">×</button></span>`).join('')}</div>`;}
function projectsSection(r){return `<div class="section"><div class="section-head"><h3>Projects</h3><button class="btn" onclick="add('projects')">+ Add</button></div>${(r.projects||[]).map((x,i)=>`<div class="item"><div class="field"><input placeholder="Project name" value="${esc(x.name||'')}" oninput="setArr('projects',${i},'name',this.value)"></div><div class="field"><input placeholder="Project URL" value="${esc(x.link||'')}" oninput="setArr('projects',${i},'link',this.value)"></div><div class="field"><textarea placeholder="Description" oninput="setArr('projects',${i},'description',this.value)">${esc(x.description??x.desc??'')}</textarea></div><button class="btn danger" onclick="del('projects',${i})">Remove</button></div>`).join('')}</div>`;}
function certSection(r){return `<div class="section"><div class="section-head"><h3>Certifications</h3><button class="btn" onclick="add('certifications')">+ Add</button></div>${(r.certifications||[]).map((x,i)=>`<div class="item"><div class="grid2"><input placeholder="Certification" value="${esc(x.name||'')}" oninput="setArr('certifications',${i},'name',this.value)"><input placeholder="Issuer" value="${esc(x.issuer||'')}" oninput="setArr('certifications',${i},'issuer',this.value)"></div><div class="field"><input placeholder="Year" value="${esc(x.year||'')}" oninput="setArr('certifications',${i},'year',this.value)"></div><button class="btn danger" onclick="del('certifications',${i})">Remove</button></div>`).join('')}</div>`;}
function simpleSection(r,arr,title){return `<div class="section"><div class="section-head"><h3>${title}</h3><button class="btn" onclick="add('${arr}')">+ Add</button></div>${(r[arr]||[]).map((x,i)=>`<div class="item"><input style="width:80%;border:1px solid var(--border);border-radius:7px;padding:8px" value="${esc(x)}" oninput="setArr('${arr}',${i},'',this.value)"><button class="btn danger" onclick="del('${arr}',${i})">Remove</button></div>`).join('')}</div>`;}

function templateSection(r){
  return `<div class="section"><div class="section-head"><h3>Templates & Style</h3><span class="status">12 templates</span></div><div class="field"><label>Template</label><select onchange="input('template',this.value)">${templates.map(([v,l])=>`<option value="${v}" ${r.template===v?'selected':''}>${l}</option>`).join('')}</select></div><div class="field"><label>Accent</label><input type="color" value="${esc(r.accent||'#4f46e5')}" oninput="input('accent',this.value)"></div></div>`;
}

function builder(){
  const r=current;
  site.innerHTML=`<header class="nav"><div class="logo">ResumeAI Pro</div><div class="actions"><button class="btn ghost" onclick="current=null;render()">Dashboard</button><button class="btn" onclick="openPreview(current)">Preview</button><button class="btn" onclick="downloadPDF()">Export PDF</button><button class="btn" onclick="downloadDOCX()">Export DOCX</button><button class="btn primary" onclick="saveNow()">Save</button></div></header>
  <main class="app">
    <div class="topbar"><div><h1><input style="font-size:25px;font-weight:800;border:0;background:transparent;width:min(430px,90vw)" value="${esc(r.name)}" oninput="input('name',this.value)"></h1><p class="muted">No-login · local browser storage · ATS profile ${score(r)}%</p></div><div class="actions"><button class="btn" onclick="openVersions()">Versions</button><button class="btn" onclick="compareVersions()">Compare</button><button class="btn" onclick="jdMatcher()">JD Match</button><button class="btn" onclick="coverLetter()">Cover Letter</button><button class="btn" onclick="runAnalysis()">AI Analysis</button></div></div>
    <div class="stats"><div class="stat"><span>ATS</span><br><b>${currentAnalysis?.ats_analysis?.overall_score??score(r)}%</b></div><div class="stat"><span>Job Fit</span><br><b>${currentAnalysis?.ats_analysis?.job_fit_score??'—'}%</b></div><div class="stat"><span>Changes</span><br><b>${(r.changeHistory||[]).length}</b></div><div class="stat"><span>Draft Mode</span><br><b>${r.draftMode?'ON':'OFF'}</b></div></div>
    <div class="builder"><div class="panel">
      <div class="section"><h3>Resume Import</h3><div class="field"><label>Upload Resume</label><input id="resumeUpload" type="file" accept=".txt,.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"><small class="muted">TXT, PDF, DOCX · maximum 5 MB</small></div><div class="field"><label>Extracted / Raw Resume Text</label><textarea id="rawResume" rows="8" placeholder="Paste resume text or upload a file...">${esc(r.rawText||'')}</textarea></div><div class="field"><label>Job Description</label><textarea id="jdInput" rows="7" placeholder="Paste the job description here...">${esc(r.jd||'')}</textarea></div><label style="font-size:12px"><input id="draftMode" type="checkbox" ${r.draftMode?'checked':''}> Privacy-safe Draft Mode: AI suggestions stay drafts until you approve them</label><div class="actions" style="margin-top:10px"><button class="btn" onclick="uploadResume()">Import File</button><button class="btn primary" onclick="runAnalysis()">Analyze Resume</button></div></div>
      ${personalSection(r)}${summarySection(r)}${experienceSection(r)}${educationSection(r)}${skillsSection(r)}${projectsSection(r)}${certSection(r)}${simpleSection(r,'languages','Languages')}${simpleSection(r,'hobbies','Interests')}${templateSection(r)}
    </div>
    <div class="preview-wrap"><div class="panel"><div class="section-head"><h3>Professional Preview</h3><span class="muted">${esc(r.template)}</span></div><div id="preview">${resumeHTML(r)}</div></div>${analysisPanel()}</div></div>
  </main>`;
  $('rawResume').addEventListener('input',e=>{r.rawText=e.target.value;persistCurrent()});
  $('jdInput').addEventListener('input',e=>{r.jd=e.target.value;persistCurrent()});
  $('draftMode').addEventListener('change',e=>{r.draftMode=e.target.checked;persistCurrent();builder()});
}

function analysisPanel(){
  const a=currentAnalysis;
  if(!a)return `<div class="panel" style="margin-top:14px"><h3>AI Analysis</h3><p class="muted">AI Analysis to get scores, evidence mapping, gaps, rewrites, cover letter and interview questions.</p></div>`;
  const gaps=a.ats_analysis?.missing_keywords||[];
  return `<div class="panel" style="margin-top:14px"><h3>AI Analysis</h3><p><b>ATS:</b> ${a.ats_analysis.overall_score}% · <b>Job Fit:</b> ${a.ats_analysis.job_fit_score}%</p><p><b>Missing keywords:</b> ${gaps.map(esc).join(' · ')||'None identified'}</p><h4>Evidence-mapped suggestions</h4>${(a.suggestions||[]).map((s,i)=>`<div class="item"><b>${esc(s.section)} · ${esc(s.impact)}</b><p class="muted">${esc(s.evidence_mapping)}</p><div class="diff"><div class="before"><b>Before</b><br>${esc(s.original_text||'—')}</div><div class="after"><b>After</b><br>${esc(s.improved_text||'—')}</div></div><p>${esc(s.reason||'')}</p>${s.requires_user_input?'<p style="color:#9a3412"><b>Needs your input before applying.</b></p>':''}<button class="btn primary" onclick="applyChange(${i})" ${s.applied?'disabled':''}>${s.applied?'Applied':'Review & Apply'}</button>${s.applied?`<button class="btn danger" onclick="revertChange(${i})">Revert</button>`:''}</div>`).join('')||'<p class="muted">No rewrite suggestions.</p>'}</div>`;
}

function updatePreview(){const el=$('preview');if(el)el.innerHTML=resumeHTML(current);}
function saveNow(){persistCurrent();toast('Saved locally.');}

async function uploadResume(){
  const file=$('resumeUpload')?.files?.[0];
  if(!file)return toast('Select a TXT, PDF or DOCX file first.');
  if(file.size>5*1024*1024)return toast('Maximum file size is 5 MB.');
  const fd=new FormData();fd.append('resume',file);
  try{
    const res=await fetch('/api/upload-resume',{method:'POST',body:fd});
    const j=await res.json();if(!res.ok)throw new Error(j.error||'Upload failed.');
    current.rawText=j.text;persistCurrent();builder();toast(`Imported ${j.filename}`);
  }catch(e){toast('Upload: '+e.message);}
}

async function runAnalysis(){
  const resumeText=(current.rawText||'').trim() || buildPlainText(current);
  const jd=(current.jd||'').trim();
  if(!resumeText)return toast('Paste or import a resume first.');
  if(aiBusy)return;
  aiBusy=true;toast('Gemini is analyzing...');
  try{
    const res=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({resumeText,jd})});
    const j=await res.json();if(!res.ok)throw new Error(j.error||'Analysis failed.');
    currentAnalysis=j;current.analysis=j;current.rawText=resumeText;persistCurrent();builder();toast('Analysis complete.');
  }catch(e){toast('AI: '+e.message);}
  finally{aiBusy=false;}
}

function buildPlainText(r){
  const p=r.personal||{};let lines=[p.name,p.headline,[p.email,p.phone,p.location].filter(Boolean).join(' | '),r.summary].filter(Boolean);
  for(const x of r.experience||[])lines.push(`${x.title||''} - ${x.company||''} ${x.dates||`${x.start||''} ${x.end||''}`}\n${x.description||x.desc||''}`);
  if(r.skills?.length)lines.push('Skills: '+r.skills.join(', '));
  for(const x of r.projects||[])lines.push(`Project: ${x.name||''}\n${x.description||x.desc||''}`);
  for(const x of r.education||[])lines.push(`Education: ${x.degree||''} - ${x.school||''} ${x.year||''}`);
  return lines.join('\n\n');
}

async function callAI(prompt,type='text/plain'){
  if(aiBusy)return '';
  aiBusy=true;
  try{const res=await fetch('/api/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,responseMimeType:type})});const j=await res.json();if(!res.ok)throw new Error(j.error||'AI request failed');return j.text||''}
  finally{aiBusy=false;}
}
function cleanJSON(s){return JSON.parse(String(s).trim().replace(/^```(?:json)?/i,'').replace(/```$/,'').trim());}

async function aiSummary(){
  try{const out=await callAI(`Rewrite this professional summary using ONLY the supplied facts. Do not add facts. Return only the summary.\nSUMMARY:${current.summary}\nRESUME:${buildPlainText(current)}`);if(out){current.summary=out;persistCurrent();builder();toast('Summary improved.')}}catch(e){toast('AI: '+e.message);}
}
async function aiExperience(i){
  try{const x=current.experience[i];const out=await callAI(`Rewrite this experience description into concise ATS-friendly bullet points. Preserve only facts in the original. Never invent metrics, tools, employers or achievements. Return plain text.\nORIGINAL:${x.description||x.desc||''}\nROLE:${x.title}\nCOMPANY:${x.company}`);if(out){current.experience[i].description=out;persistCurrent();builder();toast('Experience enhanced.')}}catch(e){toast('AI: '+e.message);}
}

function applyChange(index){
  const s=currentAnalysis?.suggestions?.[index];if(!s)return;
  if(current.draftMode){toast('Draft Mode is ON. Turn it off to apply changes.');return;}
  if(s.requires_user_input){
    const info=prompt('Enter the missing information required for this change:');
    if(!info?.trim())return;
    s.improved_text=s.improved_text.replace(/\[.*?\]/g,info.trim());
  }
  const confirmed=confirm(`Apply this change?\n\nBEFORE:\n${s.original_text}\n\nAFTER:\n${s.improved_text}`);
  if(!confirmed)return;
  const currentText=current.rawText||buildPlainText(current);
  if(!s.original_text||!currentText.includes(s.original_text)){alert('Original text was not found in the current resume. No change was applied.');return;}
  const updated=currentText.replace(s.original_text,s.improved_text);
  current.changeHistory=current.changeHistory||[];
  current.changeHistory.push({id:uid(),suggestionId:s.id,timestamp:new Date().toISOString(),before:currentText,after:updated,originalText:s.original_text,improvedText:s.improved_text});
  current.rawText=updated;s.applied=true;persistCurrent();builder();
}

function revertChange(index){
  const s=currentAnalysis?.suggestions?.[index];if(!s)return;
  const history=current.changeHistory||[];
  const idx=history.map(x=>x.suggestionId).lastIndexOf(s.id);
  if(idx<0)return toast('Change history not found.');
  if(!confirm('Revert this individual change?'))return;
  const change=history[idx];
  current.rawText=change.before;history.splice(idx,1);s.applied=false;persistCurrent();builder();
}

function openVersions(){
  const modal=document.createElement('div');modal.className='modal';
  const versions=current.versions||[];
  modal.innerHTML=`<div class="modalbox"><div class="section-head"><h2>Saved Versions</h2><button class="btn" onclick="this.closest('.modal').remove()">Close</button></div><button class="btn primary" onclick="saveVersion();this.closest('.modal').remove()">Save Current Version</button><div style="margin-top:15px">${versions.length?versions.map((v,i)=>`<div class="item"><b>Version ${versions.length-i}</b><p class="muted">${new Date(v.timestamp).toLocaleString()}</p><button class="btn" onclick="restoreVersion(${i});this.closest('.modal').remove()">Restore</button><button class="btn" onclick="compareVersion(${i})">Compare</button></div>`).join(''):'<p class="muted">No saved versions.</p>'}</div></div>`;
  document.body.appendChild(modal);
}
function saveVersion(){current.versions=current.versions||[];current.versions.push({id:uid(),timestamp:new Date().toISOString(),resume:structuredClone(current),analysis:structuredClone(currentAnalysis)});if(current.versions.length>20)current.versions.shift();persistCurrent();toast('Version saved.');}
function restoreVersion(i){const v=current.versions?.[i];if(!v)return;const restored=structuredClone(v.resume);restored.versions=current.versions;restored.id=current.id;current=restored;currentAnalysis=structuredClone(v.analysis||null);persistCurrent();render();toast('Version restored.');}
function compareVersion(i){const v=current.versions?.[i];if(!v)return;const before=buildPlainText(v.resume),after=current.rawText||buildPlainText(current);showDiff('Version Compare',before,after);}
function compareVersions(){if(!current.versions?.length)return toast('Save a version first.');compareVersion(current.versions.length-1);}

function showDiff(title,before,after){
  const m=document.createElement('div');m.className='modal';m.innerHTML=`<div class="modalbox"><div class="section-head"><h2>${esc(title)}</h2><button class="btn" onclick="this.closest('.modal').remove()">Close</button></div><div class="diff"><div class="before"><b>Saved / Before</b><br>${esc(before)}</div><div class="after"><b>Current / After</b><br>${esc(after)}</div></div></div>`;document.body.appendChild(m);
}

function coverLetter(){
  const m=document.createElement('div');m.className='modal';m.innerHTML=`<div class="modalbox"><div class="section-head"><h2>Cover Letter</h2><button class="btn" onclick="this.closest('.modal').remove()">Close</button></div><div class="field"><label>Job Title</label><input id="cljob" value="${esc(current.personal?.headline||'Professional')}"></div><div class="field"><label>Tone</label><select id="tone"><option>Professional</option><option>Confident</option><option>Enthusiastic</option><option>Humble</option></select></div><button class="btn primary" onclick="makeCover()">Generate</button><div id="coverout" class="cover" style="margin-top:14px"></div></div>`;document.body.appendChild(m);
}
async function makeCover(){
  const out=$('coverout');out.textContent='AI is writing...';
  try{const text=await callAI(`Write a concise cover letter for ${$('cljob').value} in a ${$('tone').value.toLowerCase()} tone. Use ONLY supplied candidate facts. Never invent anything. Return plain text.\n${buildPlainText(current)}`);out.innerHTML=esc(text).replace(/\n/g,'<br>');}
  catch(e){out.textContent='AI: '+e.message;}
}

function jdMatcher(){
  const m=document.createElement('div');m.className='modal';m.innerHTML=`<div class="modalbox"><div class="section-head"><h2>Job Description Matcher</h2><button class="btn" onclick="this.closest('.modal').remove()">Close</button></div><div class="field"><label>Job Description</label><textarea id="jdtext" rows="10">${esc(current.jd||'')}</textarea></div><button class="btn primary" onclick="runJDMatch()">Analyze Match</button><div id="jdout" class="cover" style="margin-top:14px"></div></div>`;document.body.appendChild(m);
}
async function runJDMatch(){
  const jd=$('jdtext').value.trim(),out=$('jdout');if(!jd)return toast('Paste a job description first.');
  current.jd=jd;persistCurrent();out.textContent='AI is analyzing...';
  try{const raw=await callAI(`Compare this resume with this job description. Do not invent candidate facts. Return valid JSON exactly {"matchScore":0,"summary":"","matchingSkills":[],"missingKeywords":[],"improvements":[]}. Resume: ${buildPlainText(current)}\nJob Description:${jd}`,'application/json');const j=cleanJSON(raw);out.innerHTML=`<h3>Match Score: ${Math.max(0,Math.min(100,Number(j.matchScore)||0))}%</h3><p>${esc(j.summary||'')}</p><b>Matching skills</b><p>${(j.matchingSkills||[]).map(esc).join(' · ')||'None identified'}</p><b>Missing requirements</b><p>${(j.missingKeywords||[]).map(esc).join(' · ')||'None identified'}</p><b>Improvements</b><ul>${(j.improvements||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`;}catch(e){out.textContent='AI: '+e.message;}
}

function openPreview(r){
  try{
    if(!r || typeof r !== 'object') throw new Error('No resume data is available for preview.');
    const safe = JSON.parse(JSON.stringify(r));
    const html = resumeHTML(safe);
    if(!html || !html.includes('professional-resume')) throw new Error('Resume preview could not be rendered.');
    const m=document.createElement('div');
    m.className='modal preview-overlay';
    m.innerHTML=`<div class="modalbox preview-modal"><div class="section-head"><div><h2>Full Resume Preview</h2><small class="muted">Live preview · ${esc(safe.template||'Modern')} template</small></div><button class="btn" type="button" onclick="this.closest('.modal').remove()">Close</button></div><div class="full-preview">${html}</div></div>`;
    document.body.appendChild(m);
  }catch(e){ console.error('Full preview error:',e); toast('Full Preview: '+(e?.message||'Unable to render preview.')); }
}

async function downloadPDF(){
  if(aiBusy)return;aiBusy=true;toast('Generating PDF...');
  try{const res=await fetch('/api/pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({html:resumeHTML(current),filename:(current.name||'resume')+'.pdf'})});const j=res.ok?null:await res.json().catch(()=>({}));if(!res.ok)throw new Error(j?.error||'PDF export failed.');const blob=await res.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=(current.name||'resume')+'.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('PDF ready.');}catch(e){toast('PDF: '+e.message)}finally{aiBusy=false;}
}

async function downloadDOCX(){
  persistCurrent();toast('Generating DOCX...');
  try{const res=await fetch('/api/docx',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({resume:current})});const j=res.ok?null:await res.json().catch(()=>({}));if(!res.ok)throw new Error(j?.error||'DOCX export failed.');const blob=await res.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=(current.name||'resume')+'.docx';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('DOCX ready.');}catch(e){toast('DOCX: '+e.message);}
}

async function aiSettings(){
  const m=document.createElement('div');m.className='modal';m.innerHTML=`<div class="modalbox"><div class="section-head"><h2>AI Settings</h2><button class="btn" onclick="this.closest('.modal').remove()">Close</button></div><p>Gemini API key stays on the server. This version has no login and stores resumes in localStorage.</p><p><b>Server:</b> ${config.configured?'Configured':'Not configured'}</p></div>`;document.body.appendChild(m);
}

async function init(){
  try{
    const res=await fetch('/api/config');config=await res.json();loadResumes();render();
  }catch(e){site.innerHTML=`<main class="app"><div class="panel"><h2>Configuration error</h2><p>${esc(e.message)}</p></div></main>`;}
}
init();
