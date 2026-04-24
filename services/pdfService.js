const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');
const db = require('../db');

async function renderPdf(html) {
    try {
        const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const buffer = await page.pdf({ format: 'A4', printBackground: true });
        await browser.close();
        return buffer;
    } catch (err) {
        // Fallback minimal PDF to ensure export still works when Chromium is unavailable.
        const safeText = String(html).replace(/[^\x20-\x7E]/g, ' ').slice(0, 1800);
        const stream = `BT /F1 11 Tf 40 800 Td (${safeText.replace(/[()\\]/g, '\\$&')}) Tj ET`;
        const fallback = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length ${stream.length} >> stream
${stream}
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000010 00000 n 
0000000062 00000 n 
0000000126 00000 n 
0000000279 00000 n 
0000000380 00000 n 
trailer << /Root 1 0 R /Size 6 >>
startxref
460
%%EOF`;
        return Buffer.from(fallback, 'utf8');
    }
}

async function generateSessionReport(sessionId, userId) {
    const session = db.prepare(`
        SELECT s.*, p.title AS project_title
        FROM sessions s JOIN projects p ON p.id = s.project_id
        WHERE s.id = ? AND s.user_id = ?
    `).get(sessionId, userId);
    if (!session) throw new Error('Session not found');
    const answers = db.prepare('SELECT * FROM answers WHERE session_id = ? ORDER BY id ASC').all(sessionId);
    const rows = answers.map((a, idx) => `
        <tr>
            <td>${idx + 1}</td>
            <td>${a.question || ''}</td>
            <td>${a.answer || ''}</td>
            <td>${Math.round(a.clarity_score || 0)}</td>
            <td>${Math.round(a.reasoning_score || 0)}</td>
            <td>${Math.round(a.depth_score || 0)}</td>
            <td>${Math.round(a.confidence_score || 0)}</td>
        </tr>
    `).join('');
    const html = `
        <html><body style="font-family:Arial,sans-serif;padding:24px;">
            <h1>PDRS Session Report</h1>
            <p><strong>Project:</strong> ${session.project_title}</p>
            <p><strong>Overall Score:</strong> ${Math.round(session.overall_score || 0)}</p>
            <table border="1" cellspacing="0" cellpadding="6" width="100%">
                <thead><tr><th>#</th><th>Question</th><th>Answer</th><th>C</th><th>R</th><th>D</th><th>F</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </body></html>
    `;
    return renderPdf(html);
}

async function generateStudentReport(userId) {
    const sessions = db.prepare("SELECT * FROM sessions WHERE user_id = ? AND status = 'completed' ORDER BY datetime(created_at) DESC").all(userId);
    const badges = db.prepare('SELECT * FROM badges WHERE user_id = ? ORDER BY datetime(earned_at) DESC').all(userId);
    const goals = db.prepare('SELECT * FROM user_goals WHERE user_id = ? ORDER BY datetime(created_at) DESC').all(userId);
    const avg = sessions.length ? Math.round(sessions.reduce((a, s) => a + Number(s.overall_score || 0), 0) / sessions.length) : 0;
    const html = `
        <html><body style="font-family:Arial,sans-serif;padding:24px;">
            <h1>PDRS Progress Report</h1>
            <p><strong>Completed Sessions:</strong> ${sessions.length}</p>
            <p><strong>Average Score:</strong> ${avg}</p>
            <h2>Badges</h2>
            <ul>${badges.map((b) => `<li>${b.badge_name} - ${b.description}</li>`).join('') || '<li>None</li>'}</ul>
            <h2>Goals</h2>
            <ul>${goals.map((g) => `<li>${g.dimension}: target ${g.target_score}, current ${g.current_score || 0}, achieved ${g.achieved ? 'yes' : 'no'}</li>`).join('') || '<li>None</li>'}</ul>
        </body></html>
    `;
    return renderPdf(html);
}

async function generateQuestionPaper(html) {
    const safe = String(html).replace(/<script/gi, '&lt;script');
    return renderPdf(
        `<html><head><meta charset="utf-8" /></head><body style="font-family:Arial,sans-serif;padding:24px;">${safe}</body></html>`
    );
}

async function generateSessionSummaryPdf(summary) {
    const s = summary || {};
    const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const list = (arr) => (Array.isArray(arr) ? arr : []).map((x) => `<li>${esc(x)}</li>`).join('');
    const html = `
        <html><head><meta charset="utf-8" /></head><body style="font-family:Arial,sans-serif;padding:24px;">
        <h1>PDRS Session Summary</h1>
        <h2>Overall</h2><p>${esc(s.overallParagraph)}</p>
        <h2>Per-dimension analysis</h2><p>${esc(s.dimensionAnalysis)}</p>
        <h2>Top strengths</h2><ul>${list(s.strengths)}</ul>
        <h2>Areas to improve</h2><ul>${list(s.improvements)}</ul>
        <h2>Recommended next steps</h2><ul>${list(s.nextSteps)}</ul>
        </body></html>
    `;
    return renderPdf(html);
}

function ensureSummaryDir() {
    const dir = path.join(__dirname, '..', 'public', 'uploads', 'summaries');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

async function writeSessionSummaryPdf(sessionId, buffer) {
    ensureSummaryDir();
    const filename = `session_${sessionId}.pdf`;
    const abs = path.join(__dirname, '..', 'public', 'uploads', 'summaries', filename);
    fs.writeFileSync(abs, buffer);
    return `/uploads/summaries/${filename}`;
}

async function cleanupOldPdfs() {
    const summaryDir = path.join(__dirname, '..', 'public', 'uploads', 'summaries');
    if (!fs.existsSync(summaryDir)) return;

    const files = fs.readdirSync(summaryDir);
    const now = Date.now();
    const expiry = 24 * 60 * 60 * 1000;

    files.forEach(file => {
        const filePath = path.join(summaryDir, file);
        if (file.endsWith('.pdf')) {
            const stats = fs.statSync(filePath);
            if (now - stats.mtimeMs > expiry) {
                fs.unlinkSync(filePath);
                console.log(`Deleted expired PDF: ${file}`);
            }
        }
    });
}

module.exports = {
    generateStudentReport,
    generateSessionReport,
    generateQuestionPaper,
    generateSessionSummaryPdf,
    writeSessionSummaryPdf,
    cleanupOldPdfs
};
