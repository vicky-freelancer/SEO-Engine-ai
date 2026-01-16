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

const visualModelSelect = document.getElementById('visual-model') as HTMLSelectElement;
const proModelAuthDiv = document.getElementById('pro-model-auth') as HTMLDivElement;
const proQualitySettingsDiv = document.getElementById('pro-quality-settings') as HTMLDivElement;
const selectApiKeyBtn = document.getElementById('select-api-key-btn') as HTMLButtonElement;

// --- State Management ---
let articleJsonLd: string | null = null;
let articleMetaDescription: string | null = null;

// --- Helper Functions ---

/**
 * Translates branded terms into descriptive visual elements to avoid SAFETY finish reasons.
 */
function translateToVisualPrompt(caption: string): string {
    const brands: Record<string, string> = {
        'ktm': 'a high-performance orange and black street-naked motorcycle',
        'duke': 'a lightweight sports motorcycle',
        'apple': 'a sleek modern smartphone with a glass finish',
        'iphone': 'a high-end touchscreen mobile device',
        'tesla': 'a futuristic electric luxury sedan',
        'nike': 'premium athletic sneakers',
        'adidas': 'modern sporty footwear',
        'samsung': 'a flagship digital mobile phone'
    };

    let refined = caption.toLowerCase();
    Object.keys(brands).forEach(brand => {
        if (refined.includes(brand)) {
            refined = refined.replace(new RegExp(brand, 'gi'), brands[brand]);
        }
    });
    return refined;
}

// --- UI Logic for Model Selection ---

visualModelSelect.addEventListener('change', () => {
    const isPro = visualModelSelect.value === 'gemini-3-pro-image-preview';
    proModelAuthDiv.classList.toggle('hidden', !isPro);
    proQualitySettingsDiv.classList.toggle('hidden', !isPro);
});

selectApiKeyBtn.addEventListener('click', async () => {
    if (window.aistudio && typeof window.aistudio.openSelectKey === 'function') {
        await window.aistudio.openSelectKey();
    } else {
        alert("API Key selection is only available within the AI Studio environment.");
    }
});

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
    outputDiv.innerHTML = `<div class="error-box"><h3>Key Missing</h3><p>Ensure API_KEY is set in Environment Variables.</p></div>`;
    return;
  }

  // Check for Pro model API Key selection if needed
  const modelType = formData.get('visual-model') as string;
  if (modelType === 'gemini-3-pro-image-preview') {
    if (window.aistudio && typeof window.aistudio.hasSelectedApiKey === 'function') {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (!hasKey) {
            alert("You must select an API key to use the Gemini 3 Pro Image model.");
            await window.aistudio.openSelectKey();
            return;
        }
    }
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
  generateBtn.textContent = 'Generating...';

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
        generateBtn.textContent = 'Writing Content...';
      }
      
      const grounding = chunk.candidates?.[0]?.groundingMetadata;
      if (grounding?.groundingChunks) {
        grounding.groundingChunks.forEach(c => {
          if (c.web?.uri && c.web?.title) {
            uniqueSources.set(c.web.uri, c.web.title);
          }
        });
      }

      buffer += chunk.text || "";
      
      if (!articleJsonLd && buffer.includes(jsonLdEnd)) {
        const start = buffer.indexOf(jsonLdStart) + jsonLdStart.length;
        const end = buffer.indexOf(jsonLdEnd);
        articleJsonLd = buffer.substring(start, end).trim();
        buffer = buffer.replace(buffer.substring(buffer.indexOf(jsonLdStart), end + jsonLdEnd.length), "");
      }

      if (!articleMetaDescription && buffer.includes(metaEnd)) {
        const start = buffer.indexOf(metaStart) + metaStart.length;
        const end = buffer.indexOf(metaEnd);
        articleMetaDescription = buffer.substring(start, end).trim();
        metaDescriptionTextEl.textContent = articleMetaDescription;
        metaCharCountEl.textContent = `${articleMetaDescription.length} / 160`;
        metaDescriptionContainer.classList.remove('hidden');
        buffer = buffer.replace(buffer.substring(buffer.indexOf(metaStart), end + metaEnd.length), "");
      }
      
      const cleanText = buffer
        .replace(/%%JSON-LD-START%%[\s\S]*?%%JSON-LD-END%%/g, '')
        .replace(/%%META-START%%[\s\S]*?%%META-END%%/g, '')
        .replace(/%%JSON-LD-START%%[\s\S]*/g, '')
        .replace(/%%META-START%%[\s\S]*/g, '');

      outputDiv.innerHTML = await marked.parse(cleanText);
    }

    if (uniqueSources.size > 0) {
      const sourcesList = Array.from(uniqueSources.entries()).map(([url, title]) => 
        `<li style="margin-bottom: 0.8rem; display: flex; align-items: center; gap: 0.8rem;">
          <img src="https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32" style="width:18px; height:18px; border-radius: 4px;" alt="">
          <a href="${url}" target="_blank" style="color: var(--primary-color); text-decoration: none; font-size: 0.95rem; font-weight: 500;">${title}</a>
        </li>`
      ).join('');
      
      outputDiv.innerHTML += `
        <div class="grounding-sources" style="margin-top: 4rem; padding: 2rem; background: rgba(0,242,234,0.03); border: 1px solid var(--border-color); border-radius: 16px;">
          <h3 style="font-size: 1rem; margin-bottom: 1.5rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem;">Verified Research Sources</h3>
          <ul style="list-style: none; padding: 0; margin: 0;">${sourcesList}</ul>
        </div>
      `;
    }

    updateMetrics(formData);
    await generateAndPlaceImagesParallel(primaryKeyword, formData);

    outputStats.classList.remove('hidden');
    outputActions.classList.remove('hidden');

  } catch (error: any) {
    console.error('Generation Error:', error);
    outputDiv.innerHTML = `<div class="error-box">
        <h3>Generation Failed</h3>
        <p>${error.message || 'The Gemini API connection was interrupted.'}</p>
        <p><small>Check console for technical details.</small></p>
    </div>`;
    loadingIndicator.classList.add('hidden');
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = 'Generate Article';
  }
});

async function generateAndPlaceImagesParallel(primaryKeyword: string, formData: FormData): Promise<void> {
    const finalHtml = outputDiv.innerHTML;
    const imageStyle = (formData.get('image-style') as string || '').trim();
    const placeholderRegex = /\[(Featured Image|Image|Infographic|Diagram): (.*?)\]/g;
    const matches = [...finalHtml.matchAll(placeholderRegex)];

    if (matches.length === 0) return;

    let pIdx = 0;
    outputDiv.innerHTML = finalHtml.replace(placeholderRegex, () => {
        const id = `img-gen-${pIdx++}`;
        return `<figure id="${id}" class="image-placeholder loading"><div class="spinner"></div><figcaption>Synthesizing Visual Context...</figcaption></figure>`;
    });

    const tasks = matches.map(async (match, i) => {
        const type = match[1];
        const caption = match[2];
        const el = document.getElementById(`img-gen-${i}`);

        const visualDescription = translateToVisualPrompt(caption);
        const model = formData.get('visual-model') as string;
        const imageSize = (formData.get('image-size') as "1K" | "2K" | "4K") || "1K";

        const prompt = (type === 'Featured Image') 
            ? `High-end editorial photography of ${visualDescription}. Professional lighting, sharp focus, ${imageStyle || 'photorealistic style'}. No text.`
            : `A professional ${type.toLowerCase()} illustration showing: ${visualDescription}. Style: ${imageStyle || 'clean, modern, minimalist'}.`;

        try {
            await new Promise(r => setTimeout(r, i * 300));
            // Always create a new instance to pick up potentially updated keys from environment
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || "" });

            let base64: string | undefined;

            if (model === 'imagen-4.0-generate-001') {
                const response = await ai.models.generateImages({
                    model: 'imagen-4.0-generate-001',
                    prompt: prompt,
                    config: {
                        numberOfImages: 1,
                        outputMimeType: 'image/jpeg',
                        aspectRatio: '16:9',
                    },
                });
                base64 = response.generatedImages?.[0]?.image?.imageBytes;
            } else {
                // Gemini Flash or Gemini Pro
                const config: any = { imageConfig: { aspectRatio: "16:9" } };
                if (model === 'gemini-3-pro-image-preview') {
                    config.imageConfig.imageSize = imageSize;
                }

                const response = await ai.models.generateContent({
                    model: model as any,
                    contents: { parts: [{ text: prompt }] },
                    config: config
                });
                
                const candidate = response.candidates?.[0];
                if (candidate?.finishReason === 'SAFETY') {
                    throw new Error("Content safety block.");
                }

                base64 = candidate?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
            }

            if (base64) {
                el?.replaceWith(renderImage(base64, caption));
            } else {
                throw new Error("No visual data returned.");
            }

        } catch (err: any) {
            console.error(`Visual error [${caption}]:`, err);
            if (el) {
                el.classList.remove('loading');
                el.innerHTML = `<div style="padding: 1.5rem; border: 1px dashed var(--error-color); border-radius: 12px; text-align: center;">
                    <p style="margin: 0; font-size: 0.85rem; color: var(--error-color); font-weight: 600;">Visual Unavailable</p>
                    <p style="margin: 0.2rem 0 0; font-size: 0.75rem; color: var(--text-muted);">${err.message || 'Safety Filter'}</p>
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
    if (html.includes('href="http')) s += 30;
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
            contents: `Generate 5 expert ${btn.dataset.type} for "${kw}". JSON array of strings only.`,
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
    const addExternal = formData.get('add-external-links') === 'on';
    const linkCount = get('external-links-count') || "3";
    const sitemap = get('internal-sitemap');
    
    return `
      You are an Elite SEO Strategist. 
      Deliver your response in three distinct blocks:
      1. %%JSON-LD-START%% [Schema.org Article JSON] %%JSON-LD-END%%
      2. %%META-START%% [Meta Description (155 chars max)] %%META-END%%
      3. [Full Article in Markdown]

      LINKING REQUIREMENTS:
      ${addExternal ? `- MANDATORY: Include exactly ${linkCount} external hyperlinks from authoritative sources (Wiki, Forbes, NYT, etc.). 
      - FORMAT: [Anchor Text](URL)` : "- No external links required."}
      
      ${sitemap ? `- INTERNAL LINKING: Integrate these URLs if relevant: ${sitemap}` : ""}

      CONTENT STRATEGY:
      - Topic: "${kw}"
      ${slang ? `- Tone Override: Use natural "${slang}" slang.` : ""}
      - Author Bio: ${get('author-bio')}

      OPTIMIZATION:
      - Use H1, H2, and H3 headers.
      - Place exactly ${get('multimedia-count')} visual placeholders: [Featured Image: ${kw}] or [Image: descriptive scene].
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

const isHigh = localStorage.getItem('highContrastMode') === 'true';
highContrastToggle.checked = isHigh;
document.body.classList.toggle('high-contrast', isHigh);
