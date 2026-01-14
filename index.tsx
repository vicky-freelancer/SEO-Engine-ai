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

// UI Enhancement elements
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
  const primaryKeyword = formData.get('primary-keyword') as string;
  const analyzeCompetitors = formData.get('analyze-competitors') === 'on';

  if (!primaryKeyword.trim()) return;

  // Initialize AI client per request for stability
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || "" });

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
    const requestConfig: any = {
        thinkingConfig: { thinkingBudget: 12000 } // Balanced budget for Flash
    };
    if (analyzeCompetitors) {
      requestConfig.tools = [{googleSearch: {}}];
    }

    const response = await ai.models.generateContentStream({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: requestConfig
    });

    let firstChunk = true;
    let buffer = '';
    const jsonLdStartDelimiter = '%%JSON-LD-START%%';
    const jsonLdEndDelimiter = '%%JSON-LD-END%%';
    const metaStartDelimiter = '%%META-START%%';
    const metaEndDelimiter = '%%META-END%%';
    let collectedGroundingChunks: any[] = [];

    for await (const chunk of response) {
      if (firstChunk) {
        loadingIndicator.classList.add('hidden');
        firstChunk = false;
      }
      
      if (chunk.candidates?.[0]?.groundingMetadata?.groundingChunks) {
        collectedGroundingChunks = [
            ...collectedGroundingChunks, 
            ...chunk.candidates[0].groundingMetadata.groundingChunks
        ];
      }

      buffer += chunk.text || "";
      
      // Attempt to extract hidden metadata if delimiters are present
      if (!articleJsonLd && buffer.includes(jsonLdEndDelimiter)) {
        const startIndex = buffer.indexOf(jsonLdStartDelimiter) + jsonLdStartDelimiter.length;
        const endIndex = buffer.indexOf(jsonLdEndDelimiter);
        articleJsonLd = buffer.substring(startIndex, endIndex).trim();
        buffer = buffer.substring(endIndex + jsonLdEndDelimiter.length);
      }

      if (!articleMetaDescription && buffer.includes(metaEndDelimiter)) {
        const startIndex = buffer.indexOf(metaStartDelimiter) + metaStartDelimiter.length;
        const endIndex = buffer.indexOf(metaEndDelimiter);
        articleMetaDescription = buffer.substring(startIndex, endIndex).trim();
        metaDescriptionTextEl.textContent = articleMetaDescription;
        metaCharCountEl.textContent = `${articleMetaDescription.length} / 160`;
        metaDescriptionContainer.classList.remove('hidden');
        buffer = buffer.substring(endIndex + metaEndDelimiter.length);
      }
      
      // Update output display
      const displayBuffer = buffer
        .replace(jsonLdStartDelimiter, '')
        .replace(jsonLdEndDelimiter, '')
        .replace(metaStartDelimiter, '')
        .replace(metaEndDelimiter, '');
        
      outputDiv.innerHTML = await marked.parse(displayBuffer);
    }

    // Process Grounding Sources
    if (collectedGroundingChunks.length > 0) {
        const uniqueSources = new Map();
        collectedGroundingChunks.forEach((chunk: any) => {
            if (chunk.web?.uri && chunk.web?.title) uniqueSources.set(chunk.web.uri, chunk.web.title);
        });

        if (uniqueSources.size > 0) {
            let sourcesHtml = `<div class="sources-section"><h3>Grounding & Fact-Check Sources</h3><ul>`;
            uniqueSources.forEach((title, uri) => {
                sourcesHtml += `<li><a href="${uri}" target="_blank">🔗 ${title}</a></li>`;
            });
            sourcesHtml += `</ul></div>`;
            outputDiv.innerHTML += sourcesHtml;
        }
    }
    
    updateMetrics(formData);
    await generateAndPlaceImages(ai, formData, primaryKeyword);

    outputStats.classList.remove('hidden');
    outputActions.classList.remove('hidden');

  } catch (error: any) {
    console.error('Generation Error:', error);
    outputDiv.innerHTML = `<div class="error-box">
        <h3>Generation Error</h3>
        <p>${error.message || 'An unexpected error occurred.'}</p>
        <p><small>Please check your API key status and project quota.</small></p>
    </div>`;
    loadingIndicator.classList.add('hidden');
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = 'Generate Article';
  }
});

async function generateAndPlaceImages(ai: GoogleGenAI, formData: FormData, primaryKeyword: string): Promise<void> {
    const finalHtml = outputDiv.innerHTML;
    const imagePrompts = (formData.get('image-prompts') as string || '').trim().split('\n').filter(p => p.trim() !== '');
    const imageStyle = (formData.get('image-style') as string || '').trim();

    const placeholderRegex = /\[(Featured Image|Image|Infographic|Diagram): (.*?)\]/g;
    const placeholders = [...finalHtml.matchAll(placeholderRegex)];

    if (placeholders.length === 0) return;

    const imageTasks = placeholders.map((match, index) => {
        const type = match[1];
        const caption = match[2]; 
        let prompt = imagePrompts[index] || caption;
        
        let finalPrompt = (type === 'Featured Image') 
            ? `Cinematic editorial featured image for an article about "${primaryKeyword}". Style: ${imageStyle || 'professional photography'}. 8k.`
            : `Professional ${type.toLowerCase()} about: "${prompt}". Style: ${imageStyle || 'clean and modern'}`;
        
        return { caption, prompt: finalPrompt, type };
    });

    let pIdx = 0;
    outputDiv.innerHTML = finalHtml.replace(placeholderRegex, () => {
        const id = `img-gen-${pIdx++}`;
        return `<figure id="${id}" class="image-placeholder loading"><div class="spinner"></div><figcaption>Generating Visual Content...</figcaption></figure>`;
    });

    for (let i = 0; i < imageTasks.length; i++) {
        const task = imageTasks[i];
        const el = document.getElementById(`img-gen-${i}`);
        let success = false;
        let retries = 0;

        while (retries < 2 && !success) {
            try {
                // Use default image model for better compatibility
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash-image',
                    contents: { parts: [{ text: task.prompt }] },
                });
                
                let bytes: string | undefined;
                for (const part of response.candidates[0].content.parts) {
                    if (part.inlineData) {
                        bytes = part.inlineData.data;
                        break;
                    }
                }

                if (!bytes) throw new Error("No image data returned");

                const url = `data:image/png;base64,${bytes}`;
                el?.replaceWith(Object.assign(document.createElement('figure'), {
                    className: 'generated-image-container',
                    innerHTML: `<img src="${url}" alt="${task.caption}" class="generated-image"><figcaption>${task.caption}</figcaption>`
                }));
                success = true;
            } catch (err) {
                retries++;
                console.warn("Image generation retry:", retries, err);
            }
        }

        if (!success && el) {
            el.innerHTML = `<p class="error-small">Visual generated failed for: ${task.caption}</p>`;
            el.classList.remove('loading');
        }
    }
}

function updateMetrics(formData: FormData) {
    const text = outputDiv.innerText;
    const html = outputDiv.innerHTML;
    const readability = calculateReadability(text);
    const seo = calculateSeoScore(text, html, formData);
    
    readabilityScoreEl.textContent = readability > 0 ? readability.toFixed(1) : 'N/A';
    seoScoreEl.textContent = seo.toString();
    seoScoreEl.style.color = seo > 80 ? 'var(--primary-color)' : (seo > 50 ? '#ffd700' : 'var(--error-color)');
}

function calculateReadability(text: string): number {
    const words = text.split(/\s+/).filter(w => w.length > 0).length;
    const sentences = (text.match(/[.!?]+/g) || []).length || 1;
    const syllables = text.split(/\s+/).reduce((acc, w) => acc + (w.match(/[aeiouy]+/gi)?.length || 1), 0);
    const score = 0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59;
    return Math.max(0, score);
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

const kBtns = document.querySelectorAll('.generate-single-keyword-btn');
kBtns.forEach(b => b.addEventListener('click', async () => {
    const btn = b as HTMLButtonElement;
    const kw = primaryKeywordInput.value.trim();
    const type = btn.dataset.type;
    const target = document.getElementById(btn.dataset.target!) as HTMLTextAreaElement;

    if (!kw) return;
    
    btn.disabled = true;
    const spinner = btn.querySelector('.spinner-small') as HTMLDivElement;
    spinner.classList.remove('hidden');

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || "" });
        const res = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `Generate 5 expert ${type} for "${kw}". Return as JSON array of strings only.`,
            config: { responseMimeType: "application/json", responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } } }
        });
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
            contents: `Identify 15 high-authority NLP entities/concepts for an article about "${kw}". Comma separated list.`
        });
        nlpEntitiesInput.value = res.text;
    } finally {
        analyzeNlpBtn.disabled = false;
        spinner.classList.add('hidden');
    }
});

function constructPrompt(formData: FormData): string {
    const get = (id: string) => (formData.get(id) as string || "").trim();
    const kw = get('primary-keyword');
    const countrySlang = get('country-slang');
    const addExternalLinks = formData.get('add-external-links') === 'on';
    const externalLinksCount = get('external-links-count') || "3";
    
    return `
      You are a World-Class SEO Strategist. Generate a three-part response:
      1. %%JSON-LD-START%% Valid Schema %%JSON-LD-END%%
      2. %%META-START%% CTR optimized Meta Description for "${kw}" (max 155 chars) %%META-END%%
      3. A full SEO-optimized article in Markdown.

      ---
      CORE REQUIREMENTS:
      ---
      - Focus Keyword: "${kw}"
      ${countrySlang ? `- MANDATORY: You must write this entire article using authentic "${countrySlang}" slang, localisms, and cultural nuances. Do not just state them; integrate them into the narrative.` : ""}
      ${addExternalLinks ? `- MANDATORY: You must include exactly ${externalLinksCount} relevant external links to high-authority websites (use real links if searching, otherwise use placeholder markers).` : ""}
      
      E-E-A-T & HELPFUL CONTENT:
      - Reader Problem: ${get('reader-problem')}
      - Unique Expertise: ${get('unique-insights')}
      - Author Authority: ${get('author-bio')}
      ${formData.get('people-first-mode') === 'on' ? "- Strictly follow 'People-First' guidelines: avoid generic introductions and AI-isms." : ""}

      SEMANTIC OPTIMIZATION:
      - Keywords to Bold: ${get('secondary-keywords')}, ${get('longtail-keywords')}, ${get('lsi-keywords')}.
      - Salient Entities: ${get('nlp-entities')}.
      
      STRUCTURE:
      - Scope: ${get('article-length')}.
      - Use short, punchy paragraphs and H1, H2, H3 headers.
      - Hook: ${get('intro-hook')}
      ${formData.get('include-key-takeaways') === 'on' ? "- Include a 'Key Takeaways' summary box at the start." : ""}
      ${formData.get('optimize-passage-ranking') === 'on' ? "- Structure headers as questions with concise 40-word answers beneath them." : ""}
      - Multimedia: Include ${get('multimedia-count')} placeholders like [Featured Image: ${kw}] logically throughout.
      ${get('affiliate-url') ? `- Integrate a conversion link for "${get('affiliate-product')}" at ${get('affiliate-url')} with anchor text "${get('affiliate-anchor')}".` : ""}

      Ensure strictly formatted delimiters for metadata sections.
    `;
}

copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(outputDiv.innerText).then(() => {
        const oldText = copyBtn.textContent;
        copyBtn.textContent = "Copied!";
        setTimeout(() => copyBtn.textContent = oldText, 2000);
    });
});

downloadBtn.addEventListener('click', () => {
    const blob = new Blob([outputDiv.innerHTML], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `article-${Date.now()}.html`;
    a.click();
});

// Init Accessibility
const saved = localStorage.getItem('highContrastMode') === 'true';
highContrastToggle.checked = saved;
document.body.classList.toggle('high-contrast', saved);
