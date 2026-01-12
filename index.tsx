/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, Type } from "@google/genai";
import { marked } from "marked";

// API key is obtained exclusively from the environment variable.
const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  console.error("API_KEY environment variable is missing.");
}

const ai = new GoogleGenAI({ apiKey: API_KEY || "" });

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

// New elements for enhanced UI
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
  
  if (!API_KEY) {
      alert("Missing API Key. Please configure the API_KEY environment variable in your Vercel project settings.");
      return;
  }

  const formData = new FormData(form);
  const primaryKeyword = formData.get('primary-keyword') as string;
  const analyzeCompetitors = formData.get('analyze-competitors') === 'on';

  if (!primaryKeyword.trim()) {
    alert('Please enter a primary keyword.');
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
  generateBtn.textContent = analyzeCompetitors ? 'Deep Analyzing SERPs...' : 'Generating Content...';

  const prompt = constructPrompt(formData);

  try {
    const requestConfig: any = {
        thinkingConfig: { thinkingBudget: 32768 } 
    };
    if (analyzeCompetitors) {
      requestConfig.tools = [{googleSearch: {}}];
    }

    const response = await ai.models.generateContentStream({
      model: 'gemini-3-pro-preview',
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
      
      // Extract Hidden Metadata Blocks
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
      
      if ((articleJsonLd && articleMetaDescription) || (!buffer.includes(jsonLdStartDelimiter) && !buffer.includes(metaStartDelimiter))) {
        outputDiv.innerHTML = await marked.parse(buffer);
      }
    }

    // Process Grounding Sources
    if (collectedGroundingChunks.length > 0) {
        const uniqueSources = new Map();
        collectedGroundingChunks.forEach((chunk: any) => {
            if (chunk.web?.uri && chunk.web?.title) uniqueSources.set(chunk.web.uri, chunk.web.title);
        });

        if (uniqueSources.size > 0) {
            let sourcesHtml = `<div class="sources-section"><h3>Grounding Sources</h3><ul>`;
            uniqueSources.forEach((title, uri) => {
                sourcesHtml += `<li><a href="${uri}" target="_blank">🔗 ${title}</a></li>`;
            });
            sourcesHtml += `</ul></div>`;
            outputDiv.innerHTML += sourcesHtml;
        }
    }
    
    updateMetrics(formData);
    await generateAndPlaceImages(formData, primaryKeyword);

    outputStats.classList.remove('hidden');
    outputActions.classList.remove('hidden');

  } catch (error) {
    console.error('Generation Error:', error);
    outputDiv.innerHTML = `<p class="error">Generation failed. Please verify your Vercel Environment Variables and Project Quota.</p>`;
    loadingIndicator.classList.add('hidden');
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = 'Generate Article';
  }
});

// Helper: Image Generation with Retries
async function generateAndPlaceImages(formData: FormData, primaryKeyword: string): Promise<void> {
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
            ? `Cinematic editorial featured image for "${primaryKeyword}". The text "${primaryKeyword}" is integrated beautifully into the typography of the scene. Style: ${imageStyle || 'modern professional tech'}. 8k.`
            : `${imageStyle ? imageStyle + ', ' : ''}An professional ${type.toLowerCase()} of: "${prompt}"`;
        
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

        while (retries < 3 && !success) {
            try {
                if (retries > 0) await new Promise(r => setTimeout(r, retries * 3000));
                
                const response = await ai.models.generateImages({
                    model: 'imagen-4.0-generate-001',
                    prompt: task.prompt,
                    config: { numberOfImages: 1, outputMimeType: 'image/jpeg', aspectRatio: '16:9' },
                });
                
                const bytes = response.generatedImages[0].image.imageBytes;
                if (!bytes) throw new Error("No bytes");

                const url = `data:image/jpeg;base64,${bytes}`;
                el?.replaceWith(Object.assign(document.createElement('figure'), {
                    className: 'generated-image-container',
                    innerHTML: `<img src="${url}" alt="${task.caption}" class="generated-image"><figcaption>${task.caption}</figcaption>`
                }));
                success = true;
            } catch (err: any) {
                retries++;
                const isRateLimit = err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED');
                if (!isRateLimit) break;
            }
        }

        if (!success && el) {
            el.innerHTML = `<p class="error">Image Generation Limit Reached. (Wait 60s)</p>`;
            el.classList.remove('loading');
        }
    }
}

// Key Takeaways & SEO Metrics Logic
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

// Single Keyword Generator
const kBtns = document.querySelectorAll('.generate-single-keyword-btn');
kBtns.forEach(b => b.addEventListener('click', async () => {
    const btn = b as HTMLButtonElement;
    const kw = primaryKeywordInput.value.trim();
    const type = btn.dataset.type;
    const target = document.getElementById(btn.dataset.target!) as HTMLTextAreaElement;

    if (!kw) { alert("Enter Primary Keyword first."); return; }
    
    btn.disabled = true;
    const btnText = btn.querySelector('.btn-text') as HTMLSpanElement;
    const spinner = btn.querySelector('.spinner-small') as HTMLDivElement;
    
    btnText.classList.add('hidden');
    spinner.classList.remove('hidden');

    try {
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
        btnText.classList.remove('hidden');
        spinner.classList.add('hidden');
    }
}));

// NLP Suggester
analyzeNlpBtn.addEventListener('click', async () => {
    const kw = primaryKeywordInput.value.trim();
    if (!kw) return;
    
    analyzeNlpBtn.disabled = true;
    const btnText = analyzeNlpBtn.querySelector('.btn-text') as HTMLSpanElement;
    const spinner = analyzeNlpBtn.querySelector('.spinner-small') as HTMLDivElement;
    
    btnText.textContent = "Analyzing...";
    spinner.classList.remove('hidden');

    try {
        const res = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `Identify 15 high-authority NLP entities/concepts for an article about "${kw}". Comma separated list.`
        });
        nlpEntitiesInput.value = res.text;
    } finally {
        analyzeNlpBtn.disabled = false;
        btnText.textContent = "Analyze & Suggest";
        spinner.classList.add('hidden');
    }
});

function constructPrompt(formData: FormData): string {
    const get = (id: string) => (formData.get(id) as string || "").trim();
    const kw = get('primary-keyword');
    const countrySlang = get('country-slang');
    const authorBio = get('author-bio');
    const externalLinksCount = get('external-links-count');
    const addExternalLinks = formData.get('add-external-links') === 'on';
    const internalSitemap = get('internal-sitemap');
    const readerProblem = get('reader-problem');
    const uniqueInsights = get('unique-insights');
    const peopleFirstMode = formData.get('people-first-mode') === 'on';
    
    const secondaryKeywords = get('secondary-keywords');
    const longtailKeywords = get('longtail-keywords');
    const clusterKeywords = get('cluster-keywords');
    const relatedSearches = get('related-searches');
    const lsiKeywords = get('lsi-keywords');
    
    const nlpEntities = get('nlp-entities');
    const nlpTone = get('nlp-tone');
    
    const optimizePassageRanking = formData.get('optimize-passage-ranking') === 'on';
    const includeKeyTakeaways = formData.get('include-key-takeaways') === 'on';
    const addMythBusting = formData.get('add-myth-busting') === 'on';
    
    const affiliateProduct = get('affiliate-product');
    const affiliateUrl = get('affiliate-url');
    const affiliateAnchor = get('affiliate-anchor');
    
    const multimediaCount = get('multimedia-count');
    const introHook = get('intro-hook');
    const conclusionStyle = get('conclusion-style');

    return `
      You are a World-Class SEO Strategist & Professional Content Creator. Your task is to generate a comprehensive, high-authority document in three distinct parts:
      
      1. %%JSON-LD-START%%
         A valid Article JSON-LD schema including the headline, author information, and keywords.
         %%JSON-LD-END%%
      
      2. %%META-START%%
         A CTR-optimized Meta Description (approx 155 characters) that includes the primary keyword "${kw}".
         %%META-END%%
      
      3. A full SEO-optimized article in Markdown.

      ---
      ARTICLE SPECIFICATIONS:
      ---
      - Primary Focus: "${kw}"
      ${countrySlang ? `- Target Audience/Slang: Please use local terminology and slang from "${countrySlang}" to make the content feel authentic and native.` : ""}
      - Author Authority: ${authorBio || "An industry expert."}
      
      CONTENT DEPTH & E-E-A-T:
      - Core Reader Problem: ${readerProblem || "Provide a comprehensive guide."}
      - Unique Insight/Experience: ${uniqueInsights || "Include expert-level depth and analysis."}
      ${peopleFirstMode ? "- People-First Filter: STRICTLY avoid generic AI fluff. Focus on actionable advice, utility, and factual accuracy." : ""}

      SEMANTIC OPTIMIZATION:
      - Include and BOLD these specific keywords where they fit naturally: 
        Secondary: ${secondaryKeywords}, 
        Long-tail: ${longtailKeywords}, 
        Cluster: ${clusterKeywords}, 
        Related: ${relatedSearches}, 
        LSI: ${lsiKeywords}.
      - Salient NLP Entities to cover: ${nlpEntities}.
      - Semantic Tone: ${nlpTone}.

      STRUCTURE & FORMATTING:
      - Length: ${get('article-length')}.
      - Formatting: Use short paragraphs (max 3 sentences), active voice, and bold headers (H1, H2, H3).
      - Hook: ${introHook || "Start with an engaging introduction."}
      ${includeKeyTakeaways ? "- Include a 'Key Takeaways' section immediately following the H1." : ""}
      ${optimizePassageRanking ? "- Optimize H2/H3 sections for Passage Ranking by providing direct, concise answers (40-60 words) to likely user questions." : ""}
      ${addMythBusting ? "- Include a 'Myths vs. Facts' section to establish unique value." : ""}
      - Multimedia: Include exactly ${multimediaCount} placeholders like [Featured Image: A professional shot of ${kw}] or [Infographic: Visual breakdown of ${kw}] distributed logically.
      
      ${addExternalLinks ? `- External Links: Please find and include exactly ${externalLinksCount} high-authority external citations or references (use placeholder links [Source](URL) if specific URLs aren't known, or use grounded data).` : ""}
      ${internalSitemap ? `- Internal Linking Strategy: Use the following URLs to suggest relevant internal links: ${internalSitemap}` : ""}
      
      ${affiliateUrl ? `- Affiliate Marketing: Strategically integrate a call-to-action for "${affiliateProduct}" using the anchor text "${affiliateAnchor}" pointing to ${affiliateUrl}. Ensure it feels like a natural recommendation.` : ""}
      
      - Conclusion: ${conclusionStyle || "Wrap up with a strong call to action."}

      Strictly use the %% delimiters for the metadata blocks.
    `;
}

// Clipboard & Download
copyBtn.addEventListener('click', () => {
    const html = outputDiv.innerHTML;
    navigator.clipboard.writeText(html).then(() => {
        copyBtn.textContent = "Copied!";
        setTimeout(() => copyBtn.textContent = "Copy to Clipboard", 2000);
    });
});

downloadBtn.addEventListener('click', () => {
    const blob = new Blob([outputDiv.innerHTML], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `seo-article-${Date.now()}.html`;
    a.click();
});

// Init theme
const saved = localStorage.getItem('highContrastMode') === 'true';
highContrastToggle.checked = saved;
document.body.classList.toggle('high-contrast', saved);
