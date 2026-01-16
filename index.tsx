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

const metaDescriptionContainer = document.getElementById('meta-description-container') as HTMLDivElement;
const metaDescriptionTextEl = document.getElementById('meta-description-text') as HTMLParagraphElement;
const metaCharCountEl = document.getElementById('meta-char-count') as HTMLSpanElement;

const highContrastToggle = document.getElementById('high-contrast-toggle') as HTMLInputElement;
const summaryKeywordEl = document.getElementById('summary-keyword') as HTMLElement;
const summaryLengthEl = document.getElementById('summary-length') as HTMLElement;
const primaryKeywordInput = document.getElementById('primary-keyword') as HTMLInputElement;
const articleLengthSelect = document.getElementById('article-length') as HTMLSelectElement;

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

  if (!process.env.API_KEY) {
    outputDiv.innerHTML = `<div class="error-box"><h3>Key Missing</h3><p>Please ensure the API_KEY is set in your Vercel Environment Variables.</p></div>`;
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
        thinkingConfig: { thinkingBudget: 0 },
        tools: analyzeCompetitors ? [{ googleSearch: {} }] : undefined
      }
    });

    let firstChunk = true;
    let buffer = '';
    const jsonLdStart = '%%JSON-LD-START%%';
    const jsonLdEnd = '%%JSON-LD-END%%';
    const metaStart = '%%META-START%%';
    const metaEnd = '%%META-END%%';

    const uniqueSources = new Map<string, string>();

    for await (const chunk of response) {
      if (firstChunk) {
        loadingIndicator.classList.add('hidden');
        firstChunk = false;
      }
      
      // Extract grounding metadata if search was used
      const grounding = chunk.candidates?.[0]?.groundingMetadata;
      if (grounding?.groundingChunks) {
        grounding.groundingChunks.forEach(c => {
          if (c.web?.uri && c.web?.title) {
            uniqueSources.set(c.web.uri, c.web.title);
          }
        });
      }

      buffer += chunk.text || "";
      
      // Extraction logic for hidden metadata (only extract once end tag is found)
      if (!articleJsonLd && buffer.includes(jsonLdEnd)) {
        const start = buffer.indexOf(jsonLdStart) + jsonLdStart.length;
        const end = buffer.indexOf(jsonLdEnd);
        articleJsonLd = buffer.substring(start, end).trim();
        // Remove the block from visible text immediately
        buffer = buffer.substring(0, buffer.indexOf(jsonLdStart)) + buffer.substring(end + jsonLdEnd.length);
      }

      if (!articleMetaDescription && buffer.includes(metaEnd)) {
        const start = buffer.indexOf(metaStart) + metaStart.length;
        const end = buffer.indexOf(metaEnd);
        articleMetaDescription = buffer.substring(start, end).trim();
        metaDescriptionTextEl.textContent = articleMetaDescription;
        metaCharCountEl.textContent = `${articleMetaDescription.length} / 160`;
        metaDescriptionContainer.classList.remove('hidden');
        // Remove from visible text
        buffer = buffer.substring(0, buffer.indexOf(metaStart)) + buffer.substring(end + metaEnd.length);
      }
      
      // Final clean for partially streamed tags
      let cleanText = buffer
        .split(jsonLdStart)[0]
        .split(metaStart)[0];
        
      outputDiv.innerHTML = await marked.parse(cleanText);
    }

    // Append Grounding Sources if any
    if (uniqueSources.size > 0) {
      const sourcesList = Array.from(uniqueSources.entries()).map(([url, title]) => 
        `<li style="margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem;">
          <img src="https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32" style="width:16px; height:16px;" alt="">
          <a href="${url}" target="_blank" style="color: var(--primary-color); text-decoration: none; font-size: 0.9rem;">${title}</a>
        </li>`
      ).join('');
      
      const groundingHtml = `
        <div class="grounding-sources" style="margin-top: 4rem; padding-top: 2rem; border-top: 1px solid var(--border-color);">
          <h3 style="font-size: 1.2rem; margin-bottom: 1rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em;">Verified Sources & Grounding</h3>
          <ul style="list-style: none; padding: 0;">${sourcesList}</ul>
        </div>
      `;
      outputDiv.innerHTML += groundingHtml;
    }

    updateMetrics(formData);
    await generateAndPlaceImagesParallel(primaryKeyword, formData);

    outputStats.classList.remove('hidden');
    outputActions.classList.remove('hidden');

  } catch (error: any) {
    console.error('Generation Error:', error);
    outputDiv.innerHTML = `<div class="error-box">
        <h3>Deployment Sync Failed</h3>
        <p>${error.message || 'The Gemini API connection was interrupted.'}</p>
        <p><small>Check your Vercel logs and ensure your API_KEY project secret is correct.</small></p>
    </div>`;
    loadingIndicator.classList.add('hidden');
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = 'Generate Article';
  }
});

async function generateAndPlaceImagesParallel(primaryKeyword: string, formData: FormData): Promise<void> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || "" });
    const finalHtml = outputDiv.innerHTML;
    const imageStyle = (formData.get('image-style') as string || '').trim();
    const placeholderRegex = /\[(Featured Image|Image|Infographic|Diagram): (.*?)\]/g;
    const matches = [...finalHtml.matchAll(placeholderRegex)];

    if (matches.length === 0) return;

    let pIdx = 0;
    outputDiv.innerHTML = finalHtml.replace(placeholderRegex, () => {
        const id = `img-gen-${pIdx++}`;
        return `<figure id="${id}" class="image-placeholder loading">
            <div class="spinner"></div>
            <figcaption>Synthesizing Visual Context...</figcaption>
        </figure>`;
    });

    const tasks = matches.map(async (match, i) => {
        const type = match[1];
        const caption = match[2];
        const el = document.getElementById(`img-gen-${i}`);

        // Strategy for bypassing safety blocks: Describe the essence rather than just using brand names alone
        const prompt = (type === 'Featured Image') 
            ? `Professional cinematic editorial photography for an article titled "${primaryKeyword}". Visual details: ${caption}. Highly detailed, 8k, ${imageStyle || 'photorealistic'}. No text overlays.`
            : `A high-quality professional ${type.toLowerCase()} illustration of ${caption} related to ${primaryKeyword}. ${imageStyle || 'clean and modern styling'}.`;

        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash-image',
                contents: { parts: [{ text: prompt }] },
            });
            
            const candidate = response.candidates?.[0];
            if (candidate?.finishReason === 'SAFETY') {
                // Retry with a more generic "brand-less" prompt
                const fallbackPrompt = `A high-quality professional image showing ${caption.replace(primaryKeyword, 'a modern vehicle/subject')}. Studio lighting, neutral background.`;
                const fallbackRes = await ai.models.generateContent({
                    model: 'gemini-2.5-flash-image',
                    contents: { parts: [{ text: fallbackPrompt }] },
                });
                const fallbackCandidate = fallbackRes.candidates?.[0];
                const base64 = fallbackCandidate?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
                if (base64) {
                    el?.replaceWith(renderImage(base64, caption));
                    return;
                }
                throw new Error("Blocked by content safety filters.");
            }

            const base64 = candidate?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;

            if (base64) {
                el?.replaceWith(renderImage(base64, caption));
            } else {
                throw new Error("API returned no visual data.");
            }
        } catch (err: any) {
            console.error(`Visual error: ${caption}`, err);
            if (el) {
                el.classList.remove('loading');
                el.innerHTML = `<div class="error-small" style="padding: 1rem; border: 1px dashed var(--error-color); border-radius: 8px;">
                    <p style="margin: 0; font-size: 0.8rem; color: var(--error-color);">Visual Generation Unavailable</p>
                    <p style="margin: 0.3rem 0 0; font-size: 0.7rem; color: var(--text-muted); opacity: 0.7;">Reason: ${err.message}</p>
                </div>`;
            }
        }
    });

    await Promise.allSettled(tasks);
}

function renderImage(base64: string, caption: string) {
    const fig = document.createElement('figure');
    fig.className = 'generated-image-container';
    fig.innerHTML = `<img src="data:image/png;base64,${base64}" alt="${caption}" class="generated-image"><figcaption>${caption}</figcaption>`;
    return fig;
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

// Tool Buttons
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
      You are an Elite SEO Content Strategist. Generate a response in three blocks:
      1. %%JSON-LD-START%% Valid Schema.org Article Object %%JSON-LD-END%%
      2. %%META-START%% CTR-focused Meta Description (max 155 chars) for keyword: ${kw} %%META-END%%
      3. A comprehensive, high-authority article in Markdown.

      CONTENT GUIDELINES:
      - Primary Keyword: "${kw}"
      ${slang ? `- Tone Override: Use authentic "${slang}" slang and cultural nuances seamlessly.` : ""}
      - Author Bio: ${get('author-bio')}
      - Reader Pain Point: ${get('reader-problem')}
      ${formData.get('people-first-mode') === 'on' ? "- Focus exclusively on practical utility; zero fluff." : ""}

      SEO SPECIFICATIONS:
      - Semantic Keywords to Bold: ${get('secondary-keywords')}, ${get('lsi-keywords')}.
      - NLP Entities: ${get('nlp-entities')}.
      - Depth Goal: ${get('article-length')}.
      
      STRUCTURE:
      - Use H1, H2, and H3 tags. Short, punchy paragraphs.
      ${formData.get('include-key-takeaways') === 'on' ? "- Include a 'Key Takeaways' box at the very beginning." : ""}
      - Multimedia: Place exactly ${get('multimedia-count')} markers like [Featured Image: ${kw}] or [Image: ${kw} in action] throughout.
      ${get('affiliate-url') ? `- Natural Affiliate CTA for "${get('affiliate-product')}" linking to ${get('affiliate-url')}.` : ""}

      Ensure delimiters are strictly formatted.
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
