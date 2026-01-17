/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, Type } from "@google/genai";
import { marked } from "marked";

// --- DOM Element Selection ---
const form = document.getElementById('article-form') as HTMLFormElement;
const generateBtn = document.getElementById('generate-btn') as HTMLButtonElement;
const outputDiv = document.getElementById('output') as HTMLElement;
const loadingIndicator = document.getElementById('loading-indicator') as HTMLDivElement;
const outputPlaceholder = document.getElementById('output-placeholder') as HTMLDivElement;
const outputActions = document.getElementById('output-actions') as HTMLDivElement;
const copyBtn = document.getElementById('copy-btn') as HTMLButtonElement;
const downloadBtn = document.getElementById('download-btn') as HTMLButtonElement;
const addExternalLinksCheckbox = document.getElementById('add-external-links') as HTMLInputElement;
const externalLinksCountContainer = document.getElementById('external-links-count-container') as HTMLDivElement;
const outputStats = document.getElementById('output-stats') as HTMLDivElement;
const readabilityScoreEl = document.getElementById('readability-score') as HTMLSpanElement;
const seoScoreEl = document.getElementById('seo-score') as HTMLSpanElement;

// Meta Description Elements
const metaDescriptionContainer = document.getElementById('meta-description-container') as HTMLDivElement;
const metaDescriptionTextEl = document.getElementById('meta-description-text') as HTMLParagraphElement;
const metaCharCountEl = document.getElementById('meta-char-count') as HTMLSpanElement;

// UI elements
const highContrastToggle = document.getElementById('high-contrast-toggle') as HTMLInputElement;
const summaryKeywordEl = document.getElementById('summary-keyword') as HTMLElement;
const summaryLengthEl = document.getElementById('summary-length') as HTMLElement;
const primaryKeywordInput = document.getElementById('primary-keyword') as HTMLInputElement;
const articleLengthSelect = document.getElementById('article-length') as HTMLSelectElement;

// NLP Elements
const analyzeNlpBtn = document.getElementById('analyze-nlp-btn') as HTMLButtonElement;
const nlpEntitiesInput = document.getElementById('nlp-entities') as HTMLTextAreaElement;

// --- State Management ---
let articleJsonLd: string | null = null;
let articleMetaDescription: string | null = null;

// --- Event Listeners ---
highContrastToggle.addEventListener('change', () => {
    document.body.classList.toggle('high-contrast', highContrastToggle.checked);
    localStorage.setItem('highContrastMode', String(highContrastToggle.checked));
});

primaryKeywordInput.addEventListener('input', () => {
    summaryKeywordEl.textContent = primaryKeywordInput.value.trim() || 'Not Set';
});

articleLengthSelect.addEventListener('change', () => {
    summaryLengthEl.textContent = articleLengthSelect.options[articleLengthSelect.selectedIndex].text.split('(')[0].trim();
});

addExternalLinksCheckbox.addEventListener('change', () => {
    externalLinksCountContainer.classList.toggle('hidden', !addExternalLinksCheckbox.checked);
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const formData = new FormData(form);
  const primaryKeyword = (formData.get('primary-keyword') as string).trim();
  const analyzeCompetitors = formData.get('analyze-competitors') === 'on';

  if (!primaryKeyword) return;

  // Verify API Key existence before starting
  if (!process.env.API_KEY) {
    outputDiv.innerHTML = `<div class="error-box"><h3>Configuration Error</h3><p>API_KEY is missing. Please set it in your Vercel Environment Variables.</p></div>`;
    return;
  }

  // UI Reset
  articleJsonLd = null;
  articleMetaDescription = null;
  outputDiv.innerHTML = '';
  outputPlaceholder.classList.add('hidden');
  loadingIndicator.classList.remove('hidden');
  outputActions.classList.add('hidden');
  outputStats.classList.add('hidden');
  metaDescriptionContainer.classList.add('hidden');
  readabilityScoreEl.textContent = '--';
  seoScoreEl.textContent = '--';
  generateBtn.disabled = true;
  generateBtn.textContent = 'Analyzing...';

  const prompt = constructPrompt(formData);

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContentStream({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        thinkingConfig: { thinkingBudget: 0 }, // Disable thinking for maximum speed on Vercel
        tools: analyzeCompetitors ? [{ googleSearch: {} }] : undefined
      }
    });

    let firstChunk = true;
    let buffer = '';
    const jsonLdStart = '%%JSON-LD-START%%';
    const jsonLdEnd = '%%JSON-LD-END%%';
    const metaStart = '%%META-START%%';
    const metaEnd = '%%META-END%%';

    for await (const chunk of response) {
      if (firstChunk) {
        loadingIndicator.classList.add('hidden');
        firstChunk = false;
      }
      
      buffer += chunk.text || "";
      
      // Extraction logic for hidden metadata
      if (!articleJsonLd && buffer.includes(jsonLdEnd)) {
        const start = buffer.indexOf(jsonLdStart) + jsonLdStart.length;
        const end = buffer.indexOf(jsonLdEnd);
        articleJsonLd = buffer.substring(start, end).trim();
        buffer = buffer.substring(end + jsonLdEnd.length);
      }

      if (!articleMetaDescription && buffer.includes(metaEnd)) {
        const start = buffer.indexOf(metaStart) + metaStart.length;
        const end = buffer.indexOf(metaEnd);
        articleMetaDescription = buffer.substring(start, end).trim();
        metaDescriptionTextEl.textContent = articleMetaDescription;
        metaCharCountEl.textContent = `${articleMetaDescription.length} / 160`;
        metaDescriptionContainer.classList.remove('hidden');
        buffer = buffer.substring(end + metaEnd.length);
      }
      
      // Render text part
      const cleanText = buffer
        .replace(jsonLdStart, '').replace(jsonLdEnd, '')
        .replace(metaStart, '').replace(metaEnd, '');
        
      outputDiv.innerHTML = await marked.parse(cleanText);
    }

    updateMetrics(formData);
    await generateAndPlaceImages(primaryKeyword, formData);

    outputStats.classList.remove('hidden');
    outputActions.classList.remove('hidden');

  } catch (error: any) {
    console.error('Generation Error:', error);
    let errorMsg = error.message || 'An unexpected error occurred.';
    if (errorMsg.includes('quota')) errorMsg = 'API Quota reached. Please try again later.';
    if (errorMsg.includes('deadline')) errorMsg = 'The request timed out. Try shorter content or check Vercel limits.';
    
    outputDiv.innerHTML = `<div class="error-box">
        <h3>Generation Failed</h3>
        <p>${errorMsg}</p>
        <small>Tip: Ensure your API key is correctly set in Vercel Settings > Environment Variables.</small>
    </div>`;
    loadingIndicator.classList.add('hidden');
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = 'Generate Article';
  }
});

async function generateAndPlaceImages(primaryKeyword: string, formData: FormData): Promise<void> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || "" });
    const finalHtml = outputDiv.innerHTML;
    const imageStyle = (formData.get('image-style') as string || '').trim();

    const placeholderRegex = /\[(Featured Image|Image|Infographic|Diagram): (.*?)\]/g;
    const placeholders = [...finalHtml.matchAll(placeholderRegex)];

    if (placeholders.length === 0) return;

    // Replace placeholders with loading UI immediately
    let pIdx = 0;
    outputDiv.innerHTML = finalHtml.replace(placeholderRegex, () => {
        const id = `img-gen-${pIdx++}`;
        return `<figure id="${id}" class="image-placeholder loading"><div class="spinner"></div><figcaption>Synthesizing Visual...</figcaption></figure>`;
    });

    for (let i = 0; i < placeholders.length; i++) {
        const match = placeholders[i];
        const type = match[1];
        const caption = match[2];
        const el = document.getElementById(`img-gen-${i}`);
        
        const prompt = (type === 'Featured Image') 
            ? `High-quality cinematic editorial image for an article about "${primaryKeyword}". Professional lighting, ${imageStyle || 'photorealistic'}.`
            : `A professional ${type.toLowerCase()} of: "${caption}". Style: ${imageStyle || 'modern clean'}.`;

        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash-image',
                contents: { parts: [{ text: prompt }] },
            });
            
            let base64: string | undefined;
            for (const part of response.candidates?.[0]?.content?.parts || []) {
                if (part.inlineData) {
                    base64 = part.inlineData.data;
                    break;
                }
            }

            if (base64) {
                el?.replaceWith(Object.assign(document.createElement('figure'), {
                    className: 'generated-image-container',
                    innerHTML: `<img src="data:image/png;base64,${base64}" alt="${caption}" class="generated-image"><figcaption>${caption}</figcaption>`
                }));
            } else {
                throw new Error("No image data in response");
            }
        } catch (err) {
            console.error(`Image failure for ${caption}:`, err);
            if (el) {
                el.innerHTML = `<div class="error-small">Visual generation unavailable for: ${caption}</div>`;
                el.classList.remove('loading');
            }
        }
    }
}

function updateMetrics(formData: FormData) {
    const text = outputDiv.innerText;
    const readability = calculateReadability(text);
    const seo = calculateSeoScore(text, outputDiv.innerHTML, formData);
    
    readabilityScoreEl.textContent = readability > 0 ? readability.toFixed(1) : 'N/A';
    seoScoreEl.textContent = seo.toString();
    seoScoreEl.style.color = seo > 80 ? 'var(--primary-color)' : (seo > 50 ? '#ffd700' : 'var(--error-color)');
}

function calculateReadability(text: string): number {
    const words = text.split(/\s+/).filter(w => w.length > 0).length;
    const sentences = (text.match(/[.!?]+/g) || []).length || 1;
    const syllables = text.split(/\s+/).reduce((acc, w) => acc + (w.match(/[aeiouy]+/gi)?.length || 1), 0);
    return 0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59;
}

function calculateSeoScore(text: string, html: string, formData: FormData): number {
    let s = 0;
    const kw = (formData.get('primary-keyword') as string).toLowerCase();
    if (html.toLowerCase().includes(`<h1`)) s += 20;
    if (text.toLowerCase().includes(kw)) s += 30;
    if (html.includes('<img')) s += 20;
    if (text.split(' ').length > 800) s += 30;
    return Math.min(100, s);
}

// Tool Buttons (Keywords, NLP)
const kBtns = document.querySelectorAll('.generate-single-keyword-btn');
kBtns.forEach(b => b.addEventListener('click', async () => {
    const btn = b as HTMLButtonElement;
    const kw = primaryKeywordInput.value.trim();
    if (!kw) return;
    
    btn.disabled = true;
    const spinner = btn.querySelector('.spinner-small') as HTMLDivElement;
    spinner.classList.remove('hidden');

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || "" });
        const res = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `Generate 5 expert ${btn.dataset.type} for "${kw}". Return as JSON array of strings.`,
            config: { responseMimeType: "application/json", responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } } }
        });
        const target = document.getElementById(btn.dataset.target!) as HTMLTextAreaElement;
        target.value = JSON.parse(res.text).join('\n');
    } catch (e) {
        console.error(e);
    } finally {
        btn.disabled = false;
        spinner.classList.add('hidden');
    }
}));

analyzeNlpBtn.addEventListener('click', async () => {
    const kw = primaryKeywordInput.value.trim();
    if (!kw) return;
    
    analyzeNlpBtn.disabled = true;
    const spinner = analyzeNlpBtn.querySelector('.spinner-small') as HTMLDivElement;
    spinner.classList.remove('hidden');

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || "" });
        const res = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `List 15 high-authority NLP entities for an article about "${kw}". Comma separated.`
        });
        nlpEntitiesInput.value = res.text;
    } catch (e) {
        console.error(e);
    } finally {
        analyzeNlpBtn.disabled = false;
        spinner.classList.add('hidden');
    }
});

function constructPrompt(formData: FormData): string {
    const get = (id: string) => (formData.get(id) as string || "").trim();
    const kw = get('primary-keyword');
    const slang = get('country-slang');
    
    return `
      You are an Elite SEO Strategist. Generate:
      1. %%JSON-LD-START%% Valid Article Schema %%JSON-LD-END%%
      2. %%META-START%% Meta Description for "${kw}" (max 155 chars) %%META-END%%
      3. A full SEO article in Markdown.

      CONTEXT:
      - Primary Keyword: "${kw}"
      ${slang ? `- TONE REQUIREMENT: Use authentic "${slang}" slang and idioms naturally.` : ""}
      - Reader Problem: ${get('reader-problem')}
      - Unique Insight: ${get('unique-insights')}
      - Author: ${get('author-bio')}
      ${formData.get('people-first-mode') === 'on' ? "- Focus on high utility, no fluff." : ""}

      OPTIMIZATION:
      - Keywords to Bold: ${get('secondary-keywords')}, ${get('lsi-keywords')}.
      - NLP Concepts: ${get('nlp-entities')}.
      - Depth: ${get('article-length')}.
      
      STRUCTURE:
      - Use H1, H2, H3. Short paragraphs.
      ${formData.get('include-key-takeaways') === 'on' ? "- Include 'Key Takeaways' box." : ""}
      - Place exactly ${get('multimedia-count')} markers like [Featured Image: ${kw}] or [Image: Describing scene].
      ${get('affiliate-url') ? `- Affiliate CTA for "${get('affiliate-product')}" at ${get('affiliate-url')} using "${get('affiliate-anchor')}".` : ""}
    `;
}

copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(outputDiv.innerText).then(() => {
        const old = copyBtn.textContent;
        copyBtn.textContent = "Copied!";
        setTimeout(() => copyBtn.textContent = old, 2000);
    });
});

downloadBtn.addEventListener('click', () => {
    const blob = new Blob([outputDiv.innerHTML], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `seo-content-${Date.now()}.html`;
    a.click();
});

// Init
const isHigh = localStorage.getItem('highContrastMode') === 'true';
highContrastToggle.checked = isHigh;
document.body.classList.toggle('high-contrast', isHigh);
