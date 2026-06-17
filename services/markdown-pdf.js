// services/markdown-pdf.js
// Render a knowbase markdown policy/procedure into a branded PDF, server-side,
// with no headless browser — pdfkit's built-in fonts only (Azure-safe).
// Used by /public/documents/:slug?download=1 so reviewers can hand the SSCC a
// PDF instead of the markdown source.
const PDFDocument = require('pdfkit');
const { marked } = require('marked');

const BRAND = '#5E3989';
const DARK = '#3c2556';
const INK = '#1f2937';
const MUTED = '#475569';
const HEAD_BG = '#f3e9fa';

// pdfkit's standard fonts are WinAnsi-encoded and can't draw box/check glyphs
// (☐ ☒ ✓ …). Map the common ones to ASCII so policy checklists survive.
function sanitize(s) {
    return String(s == null ? '' : s)
        .replace(/[☐]/g, '[ ]')
        .replace(/[☑☒✓✔]/g, '[x]')
        .replace(/[✗✘]/g, '[ ]')
        .replace(/•/g, '-')
        .replace(new RegExp('\\u00a0','g'), ' ');
}

// Flatten inline tokens into styled runs: {text, bold, italic, mono, link}.
function inlineRuns(tokens) {
    const runs = [];
    (function walk(toks, ctx) {
        for (const t of toks || []) {
            switch (t.type) {
                case 'strong': walk(t.tokens, { ...ctx, bold: true }); break;
                case 'em': walk(t.tokens, { ...ctx, italic: true }); break;
                case 'del': walk(t.tokens, ctx); break;
                case 'codespan': runs.push({ text: sanitize(t.text), ...ctx, mono: true }); break;
                case 'link': walk(t.tokens, { ...ctx, link: t.href }); break;
                case 'br': runs.push({ text: '\n', ...ctx }); break;
                default:
                    if (t.tokens) walk(t.tokens, ctx);
                    else if (t.text != null) runs.push({ text: sanitize(t.text), ...ctx });
            }
        }
    })(tokens, {});
    return runs.length ? runs : [{ text: '' }];
}

function fontFor(r) {
    if (r.mono) return r.bold ? 'Courier-Bold' : 'Courier';
    if (r.bold && r.italic) return 'Helvetica-BoldOblique';
    if (r.bold) return 'Helvetica-Bold';
    if (r.italic) return 'Helvetica-Oblique';
    return 'Helvetica';
}

function contentWidth(doc) {
    return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

// Write a paragraph of inline runs, honoring bold/italic/mono/link, with wrap.
function writeRuns(doc, runs, { size = 10.5, color = INK, indent = 0 } = {}) {
    const x = doc.page.margins.left + indent;
    const w = contentWidth(doc) - indent;
    doc.fontSize(size);
    for (let i = 0; i < runs.length; i++) {
        const r = runs[i];
        doc.font(fontFor(r)).fillColor(r.link ? BRAND : color);
        const opt = { continued: i < runs.length - 1, width: w };
        if (r.link) { opt.link = r.link; opt.underline = true; }
        if (i === 0) doc.text(r.text, x, doc.y, opt);
        else doc.text(r.text, opt);
    }
    doc.fillColor(INK).underline = false;
}

function heading(doc, depth, runs) {
    const sizes = { 1: 17, 2: 13.5, 3: 11.5, 4: 11, 5: 10.5, 6: 10.5 };
    doc.moveDown(depth <= 2 ? 0.5 : 0.35);
    writeRuns(doc, runs.map((r) => ({ ...r, bold: true })), {
        size: sizes[depth] || 11,
        color: depth <= 2 ? DARK : INK
    });
    if (depth === 1) {
        const x = doc.page.margins.left;
        const y = doc.y + 1;
        doc.moveTo(x, y).lineTo(x + contentWidth(doc), y).lineWidth(1).strokeColor(BRAND).stroke();
        doc.moveDown(0.3);
    } else {
        doc.moveDown(0.15);
    }
}

function renderList(doc, token, depth = 0) {
    const indent = 16 + depth * 16;
    token.items.forEach((item, idx) => {
        const marker = token.ordered ? `${(token.start || 1) + idx}.` : '•';
        const inline = [];
        const nested = [];
        for (const t of item.tokens || []) {
            if (t.type === 'list') nested.push(t);
            else if (t.tokens) inline.push(...t.tokens);
            else if (t.text != null) inline.push({ type: 'text', text: t.text });
        }
        const runs = [{ text: marker + '  ', bold: token.ordered }, ...inlineRuns(inline)];
        writeRuns(doc, runs, { size: 10.5, indent });
        doc.moveDown(0.1);
        nested.forEach((n) => renderList(doc, n, depth + 1));
    });
}

function cellDef(cell, isHeader) {
    const runs = inlineRuns(cell.tokens && cell.tokens.length ? cell.tokens : [{ type: 'text', text: cell.text }]);
    const text = sanitize(runs.map((r) => r.text).join(''));
    const allBold = runs.some((r) => r.text.trim()) && runs.every((r) => !r.text.trim() || r.bold);
    return {
        text,
        font: (isHeader || allBold) ? 'Helvetica-Bold' : 'Helvetica',
        fontSize: 9,
        textColor: isHeader ? DARK : INK,
        backgroundColor: isHeader ? HEAD_BG : null,
        padding: 5
    };
}

function renderTable(doc, token) {
    const data = [token.header.map((c) => cellDef(c, true))];
    token.rows.forEach((row) => data.push(row.map((c) => cellDef(c, false))));
    doc.moveDown(0.25);
    try {
        doc.table({
            columnStyles: token.header.map(() => '*'),
            rowStyles: { border: 0.5, borderColor: '#d9d2e6' },
            data
        });
    } catch (err) {
        // Fallback: render rows as plain lines if the table API rejects input.
        data.forEach((row) => writeRuns(doc, [{ text: row.map((c) => c.text).join('  |  ') }], { size: 9 }));
    }
    doc.moveDown(0.5);
}

function renderTokens(doc, tokens) {
    for (const t of tokens) {
        switch (t.type) {
            case 'heading': heading(doc, t.depth, inlineRuns(t.tokens)); break;
            case 'paragraph': writeRuns(doc, inlineRuns(t.tokens)); doc.moveDown(0.5); break;
            case 'list': renderList(doc, t); doc.moveDown(0.4); break;
            case 'table': renderTable(doc, t); break;
            case 'blockquote': {
                const y0 = doc.y;
                writeRuns(doc, inlineRuns(t.tokens), { size: 10.5, color: MUTED, indent: 14 });
                doc.moveTo(doc.page.margins.left + 4, y0).lineTo(doc.page.margins.left + 4, doc.y)
                    .lineWidth(2).strokeColor('#c9a8e0').stroke();
                doc.moveDown(0.5);
                break;
            }
            case 'code': {
                doc.font('Courier').fontSize(9).fillColor(INK)
                    .text(sanitize(t.text), { width: contentWidth(doc) });
                doc.font('Helvetica').moveDown(0.5);
                break;
            }
            case 'hr': {
                const x = doc.page.margins.left;
                doc.moveDown(0.2).moveTo(x, doc.y).lineTo(x + contentWidth(doc), doc.y)
                    .lineWidth(0.5).strokeColor('#e2e8f0').stroke();
                doc.moveDown(0.5);
                break;
            }
            case 'space': doc.moveDown(0.3); break;
            default:
                if (t.tokens) renderTokens(doc, t.tokens);
                else if (t.text) { writeRuns(doc, [{ text: sanitize(t.text) }]); doc.moveDown(0.4); }
        }
    }
}

/**
 * Render markdown to a branded PDF Buffer.
 * @param {string} title - document title (shown in the header band)
 * @param {string} markdown - the markdown source
 * @param {object} [opts] - { sourcePath }
 * @returns {Promise<Buffer>}
 */
function renderMarkdownToPdf(title, markdown, opts = {}) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({
                size: 'LETTER',
                margins: { top: 92, bottom: 58, left: 54, right: 54 },
                info: { Title: title, Author: 'Refuge House, Inc.' },
                bufferPages: true
            });
            const chunks = [];
            doc.on('data', (c) => chunks.push(c));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            // Strip a leading H1 that just repeats the org name / title.
            let tokens = marked.lexer(String(markdown || ''));
            if (tokens[0] && tokens[0].type === 'heading' && tokens[0].depth === 1) {
                const h = sanitize(tokens[0].text || '').trim().toLowerCase();
                if (h === 'refuge house, inc.' || h === sanitize(title).trim().toLowerCase()) {
                    tokens = tokens.slice(1);
                }
            }

            renderHeaderBand(doc, title);
            doc.y = doc.page.margins.top;
            renderTokens(doc, tokens);
            addFooters(doc, opts.sourcePath);
            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

function renderHeaderBand(doc, title) {
    const w = doc.page.width;
    doc.save();
    doc.rect(0, 0, w, 70).fill(BRAND);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8)
        .text('REFUGE HOUSE, INC. · COMPLIANCE', 54, 18, { characterSpacing: 1 });
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(15)
        .text(sanitize(title), 54, 32, { width: w - 108, lineBreak: false, ellipsis: true });
    doc.restore();
    doc.fillColor(INK);
}

function addFooters(doc, sourcePath) {
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        const y = doc.page.height - 42;
        const x = doc.page.margins.left;
        const w = contentWidth(doc);
        doc.moveTo(x, y).lineTo(x + w, y).lineWidth(0.5).strokeColor('#e2e8f0').stroke();
        doc.font('Helvetica').fontSize(7.5).fillColor(MUTED);
        const left = sourcePath ? `Source: ${sanitize(sourcePath)}` : 'Refuge House, Inc.';
        doc.text(left, x, y + 6, { width: w * 0.7, lineBreak: false, ellipsis: true });
        doc.text(`Page ${i + 1} of ${range.count}`, x + w * 0.7, y + 6, { width: w * 0.3, align: 'right' });
    }
}

module.exports = { renderMarkdownToPdf };
