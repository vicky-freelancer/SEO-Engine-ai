/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, Type } from "@google/genai";
import { marked } from "marked";

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  document.body.innerHTML = "<div style='padding: 2rem; color: white; background: #000; height: 100vh;'><h1>API Key Missing</h1><p>Please set your API_KEY environment variable.</p></div>";
  throw new Error("API key not found");
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

// --- DOM Selection ---
const form = document.getElementById('article-form') as HTMLFormElement;
const generateBtn = document.getElementById('generate-btn') as HTMLButtonElement;
const outputDiv = document.getElementById('output') as HTMLElement;
const loadingIndicator = document.getElementById('loading-indicator') as HTMLDivElement;
const loadingText = document.getElementById('loading-text') as HTMLParagraphElement;
const outputPlaceholder = document.getElementById('output-placeholder') as HTMLDivElement;
const outputActions = document.getElementById('output-actions') as HTMLDivElement;
const copyBtn = document.getElementById('copy-btn') as HTMLButtonElement;
const downloadBtn = document.getElementById('download-btn') as HTMLButtonElement;
const outputStats = document.getElementById('output-stats') as HTMLDivElement;
const readabilityScoreEl = document.getElementById('readability-score') as HTMLSpanElement;
const seoScoreEl = document.getElementById('seo-score') as HTMLSpanElement;

const metaDescriptionContainer = document.getElementById('meta-description-container') as HTMLDivElement;
const metaDescriptionTextEl = document.getElementById('meta-description-text') as HTMLParagraphElement;
const metaCharCountEl = document.getElementById('meta-char-count') as HTMLSpanElement;

const highContrastToggle = document.getElementById('high-contrast-toggle') as HTMLInputElement;
const summaryKeywordEl = document.getElementById('summary-keyword') as HTMLElement;
const summaryLangEl = document.getElementById('summary-lang') as HTMLElement;
const primaryKeywordInput = document.getElementById('primary-keyword') as HTMLInputElement;
const targetLangSelect = document.getElementById('target-language') as HTMLSelectElement;

const nlpEntitiesInput = document.getElementById('nlp-entities') as HTMLTextAreaElement;
const analyzeNlpBtn = document.getElementById('analyze-nlp-btn') as HTMLButtonElement;
const bulkGenerateBtn = document.getElementById('bulk-generate-keywords-btn') as HTMLButtonElement;

// --- State ---
let articleJsonLd: string | null = null;
let articleMetaDescription: string | null = null;

// --- Helper: Readability & SEO Logic ---

function calculateFleschKincaid(text: string): number {
    const words = text.trim().split(/\s+/).filter(w => w.length > 0);
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    if (words.length === 0 || sentences.length === 0) return 0;

    const syllableCount = words.reduce((acc, word) => {
        word = word.toLowerCase().replace(/[^a-z]/g, '');
        if (word.length <= 3) return acc + 1;
        const syllables = word.match(/[aeiouy]{1,2}/g);
        return acc + (syllables ? syllables.length : 1);
    }, 0);

    const grade = 0.39 * (words.length / sentences.length) + 11.8 * (syllableCount / words.length) - 15.59;
    return Math.max(0, Math.min(20, grade));
}

function calculateSEOScore(text: string, html: string, formData: FormData): number {
    let score = 0;
    const primary = (formData.get('primary-keyword') as string || '').toLowerCase();
    const secondary = (formData.get('secondary-keywords') as string || '').toLowerCase().split('\n').filter(k => k.trim());
    
    const lowerText = text.toLowerCase();
    const lowerHtml = html.toLowerCase();

    // 1. Primary keyword in H1
    const h1Match = lowerHtml.match(/<h1[^>]*>(.*?)<\/h1>/);
    if (h1Match && h1Match[1].includes(primary)) score += 25;

    // 2. Primary keyword in first 10% of text
    const firstPart = lowerText.substring(0, Math.floor(lowerText.length * 0.1));
    if (firstPart.includes(primary)) score += 15;

    // 3. Keyword density (target 1-2%)
    const wordCount = lowerText.split(/\s+/).length;
    const instances = (lowerText.match(new RegExp(primary, 'gi')) || []).length;
    const density = (instances / wordCount) * 100;
    if (density >= 0.5 && density <= 2.5) score += 20;
    else if (density > 0) score += 10;

    // 4. Presence of secondary keywords
    let secFound = 0;
    secondary.forEach(k => { if (lowerText.includes(k.trim())) secFound++; });
    if (secondary.length > 0) score += (secFound / secondary.length) * 20;
    else score += 20;

    // 5. Structure (H2, H3 tags)
    if (lowerHtml.includes('<h2')) score += 10;
    if (lowerHtml.includes('<h3')) score += 10;

    return Math.round(score);
}

// --- Event Handlers ---

highContrastToggle.addEventListener('change', () => {
    document.body.classList.toggle('high-contrast', highContrastToggle.checked);
});

primaryKeywordInput.addEventListener('input', () => {
    summaryKeywordEl.textContent = primaryKeywordInput.value.trim() || 'Not Set';
});

targetLangSelect.addEventListener('change', () => {
    summaryLangEl.textContent = targetLangSelect.options[targetLangSelect.selectedIndex].text.split('(')[0].trim();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(form);
  const primaryKeyword = (formData.get('primary-keyword') as string).trim();
  const analyzeCompetitors = formData.get('analyze-competitors') === 'on';
  const referenceUrl = (formData.get('reference-url') as string).trim();
  const sourceContent = (formData.get('source-content') as string).trim();

  if (!primaryKeyword) {
    alert('Primary Keyword is required.');
    return;
  }

  // Reset UI
  articleJsonLd = null;
  articleMetaDescription = null;
  outputDiv.innerHTML = '';
  outputPlaceholder.classList.add('hidden');
  loadingIndicator.classList.remove('hidden');
  outputActions.classList.add('hidden');
  outputStats.classList.add('hidden');
  metaDescriptionContainer.classList.add('hidden');
  generateBtn.disabled = true;
  loadingText.textContent = (analyzeCompetitors || referenceUrl || sourceContent) ? "Synthesizing Sources & Optimizing..." : "Crafting SEO Masterpiece...";

  const prompt = constructPrompt(formData);

  try {
    const config: any = { thinkingConfig: { thinkingBudget: 16384 } };
    if (analyzeCompetitors || referenceUrl) {
      config.tools = [{ googleSearch: {} }];
    }

    const response = await ai.models.generateContentStream({
      model: 'gemini-3-pro-preview',
      contents: prompt,
      config
    });

    let buffer = '';
    const jsonLdStart = '%%JSON-LD-START%%';
    const jsonLdEnd = '%%JSON-LD-END%%';
    const metaStart = '%%META-START%%';
    const metaEnd = '%%META-END%%';

    for await (const chunk of response) {
      loadingIndicator.classList.add('hidden');
      buffer += chunk.text;
      
      // Extract JSON-LD
      if (!articleJsonLd && buffer.includes(jsonLdEnd)) {
        const start = buffer.indexOf(jsonLdStart) + jsonLdStart.length;
        const end = buffer.indexOf(jsonLdEnd);
        articleJsonLd = buffer.substring(start, end).trim();
        buffer = buffer.substring(end + jsonLdEnd.length);
      }

      // Extract Meta
      if (!articleMetaDescription && buffer.includes(metaEnd)) {
        const start = buffer.indexOf(metaStart) + metaStart.length;
        const end = buffer.indexOf(metaEnd);
        articleMetaDescription = buffer.substring(start, end).trim();
        metaDescriptionTextEl.textContent = articleMetaDescription;
        metaCharCountEl.textContent = `${articleMetaDescription.length} / 160`;
        metaDescriptionContainer.classList.remove('hidden');
        buffer = buffer.substring(end + metaEnd.length);
      }

      if (articleJsonLd && articleMetaDescription) {
        // Continuous render for better UX
        outputDiv.innerHTML = marked.parse(buffer) as string;
      }
    }

    updateMetrics(formData);
    await generateAndPlaceImages(formData);
    
    outputStats.classList.remove('hidden');
    outputActions.classList.remove('hidden');
  } catch (err) {
    console.error(err);
    outputDiv.innerHTML = `<p class="error">An unexpected error occurred. Please verify your internet connection or API limits.</p>`;
  } finally {
    generateBtn.disabled = false;
    loadingIndicator.classList.add('hidden');
  }
});

bulkGenerateBtn.addEventListener('click', async () => {
    const keyword = primaryKeywordInput.value.trim();
    if (!keyword) return alert("Enter a primary keyword first.");

    bulkGenerateBtn.disabled = true;
    bulkGenerateBtn.textContent = "...";

    const prompt = `Based on the SEO keyword "${keyword}", generate a comprehensive semantic cluster. 
    Return a JSON object with keys: secondary, lsi, longtail, cluster, related. 
    Include 5 high-intent strings per category. Focus on terms that would help rank for the primary keyword.`;
    
    try {
        const res = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt,
            config: {
                thinkingConfig: { thinkingBudget: 0 },
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        secondary: { type: Type.ARRAY, items: { type: Type.STRING } },
                        lsi: { type: Type.ARRAY, items: { type: Type.STRING } },
                        longtail: { type: Type.ARRAY, items: { type: Type.STRING } },
                        cluster: { type: Type.ARRAY, items: { type: Type.STRING } },
                        related: { type: Type.ARRAY, items: { type: Type.STRING } },
                    }
                }
            }
        });
        const data = JSON.parse(res.text);
        (document.getElementById('secondary-keywords') as HTMLTextAreaElement).value = data.secondary.join('\n');
        (document.getElementById('lsi-keywords') as HTMLTextAreaElement).value = data.lsi.join('\n');
        (document.getElementById('longtail-keywords') as HTMLTextAreaElement).value = data.longtail.join('\n');
        (document.getElementById('cluster-keywords') as HTMLTextAreaElement).value = data.cluster.join('\n');
        (document.getElementById('related-searches') as HTMLTextAreaElement).value = data.related.join('\n');
    } catch (e) {
        console.error(e);
        alert("Keyword generation failed. Try again.");
    } finally {
        bulkGenerateBtn.disabled = false;
        bulkGenerateBtn.textContent = "Generate All";
    }
});

analyzeNlpBtn.addEventListener('click', async () => {
    const keyword = primaryKeywordInput.value.trim();
    if (!keyword) return;
    analyzeNlpBtn.disabled = true;
    analyzeNlpBtn.textContent = "Analyzing...";
    try {
        const res = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `Identify 15 salient entities (named entities) and specialized NLP concepts essential for establishing topical authority on "${keyword}". Return as a comma-separated list.`,
            config: { thinkingConfig: { thinkingBudget: 0 } }
        });
        nlpEntitiesInput.value = res.text;
    } finally {
        analyzeNlpBtn.disabled = false;
        analyzeNlpBtn.textContent = "Analyze Semantic Entities";
    }
});

copyBtn.addEventListener('click', () => {
    const meta = articleMetaDescription ? `<p><strong>Meta:</strong> ${articleMetaDescription}</p><hr>` : '';
    const fullHtml = `
      <div class="article-meta">
        ${meta}
        ${articleJsonLd ? `<script type="application/ld+json">${articleJsonLd}</script>` : ''}
      </div>
      <div class="article-body">
        ${outputDiv.innerHTML}
      </div>
    `;
    const blob = new Blob([fullHtml], { type: 'text/html' });
    const item = new ClipboardItem({ 'text/html': blob });
    navigator.clipboard.write([item]).then(() => {
        const originalText = copyBtn.textContent;
        copyBtn.textContent = "Copied!";
        setTimeout(() => copyBtn.textContent = originalText, 2000);
    });
});

downloadBtn.addEventListener('click', () => {
    const keyword = primaryKeywordInput.value.trim() || 'article';
    const fileName = `${keyword.toLowerCase().replace(/\s+/g, '-')}.html`;
    const content = `
<!DOCTYPE html>
<html lang="${targetLangSelect.value.toLowerCase().substring(0, 2)}">
<head>
    <meta charset="UTF-8">
    <title>${keyword}</title>
    <meta name="description" content="${articleMetaDescription || ''}">
    ${articleJsonLd ? `<script type="application/ld+json">${articleJsonLd}</script>` : ''}
    <style>
        body { font-family: sans-serif; line-height: 1.6; max-width: 800px; margin: 40px auto; padding: 20px; color: #333; }
        img { max-width: 100%; height: auto; border-radius: 8px; }
        h1, h2, h3 { color: #111; }
        .key-takeaways { background: #f9f9f9; padding: 20px; border-left: 5px solid #00f2ea; border-radius: 4px; }
        figure { margin: 2em 0; }
        figcaption { font-size: 0.9em; color: #666; text-align: center; }
    </style>
</head>
<body>
    <article>
        ${outputDiv.innerHTML}
    </article>
</body>
</html>`;
    const blob = new Blob([content], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
});

// --- Helpers ---

function constructPrompt(formData: FormData): string {
    const get = (id: string) => (formData.get(id) as string || '').trim();
    const lang = get('target-language');
    const primary = get('primary-keyword');
    const sourceContent = get('source-content');
    const refUrl = get('reference-url');
    const author = get('author-bio');
    const length = get('article-length');
    const humanize = formData.get('humanize-mode') === 'on';

    const imageCount = get('image-count');
    const infographicCount = get('infographic-count');
    const diagramCount = get('diagram-count');
    const otherMediaCount = get('multimedia-count');

    const addExternalLinks = formData.get('add-external-links') === 'on';
    const externalLinksCount = get('external-links-count');
    const addInternalLinks = formData.get('add-internal-links') === 'on';
    const internalLinksCount = get('internal-links-count');
    const internalSitemap = get('internal-sitemap');

    let humanizationInstructions = '';
    if (humanize) {
        humanizationInstructions = `
      **HUMANIZATION & ANTI-AI DETECTION CONSTRAINTS**:
      - **Burstiness**: Vary sentence length significantly. Mix short, punchy statements with longer, descriptive sentences.
      - **Perplexity**: Use a rich, varied vocabulary. Avoid predictable AI transitions.
      - **Conversational Elements**: Use occasional first-person ("I" or "We") or second-person ("You") perspectives.
      - **Asymmetry**: Avoid rigid, perfectly balanced lists of three. Use uneven structures.
      - **Contractions**: Use natural contractions (e.g., "don't," "it's").
        `;
    }

    let linkInstructions = '';
    if (addExternalLinks || addInternalLinks) {
        linkInstructions = `
      **LINKING STRATEGY**:
      ${addExternalLinks ? `- **External Linking**: Include exactly ${externalLinksCount} relevant external links to high-authority resources. Format: [Anchor](Placeholder URL).` : ''}
      ${addInternalLinks ? `- **Internal Linking**: Include exactly ${internalLinksCount} internal links. 
        ${internalSitemap ? `CRITICAL: Choose the most relevant URLs from this Sitemap/URL list: """${internalSitemap}""".` : 'Use relevant placeholder internal URLs if none provided.'}
        Ensure anchor text is descriptive and contextually appropriate.` : ''}
        `;
    }

    return `
      You are a World-Class SEO Strategist and Professional Content Writer. 
      Your mission is to produce a high-performance, human-centric article in **${lang}**.

      **INPUT DATA SOURCES**:
      ${refUrl ? `- **Reference URL**: ${refUrl}` : ''}
      ${sourceContent ? `- **Reference Source Text**: """${sourceContent}"""` : ''}
      - **Primary Keyword**: "${primary}"
      - **Secondary Keywords**: ${get('secondary-keywords').replace(/\n/g, ', ')}
      - **LSI & Cluster Keywords**: ${get('lsi-keywords').replace(/\n/g, ', ')}, ${get('cluster-keywords').replace(/\n/g, ', ')}
      - **Author Bio (E-E-A-T)**: ${author}

      **STRICT EDITORIAL GUIDELINES**:
      1. **Formatting**: Paragraphs MUST NOT exceed 3 lines. 
      2. **Keyword Optimization**: You MUST **bold** every instance of the primary, secondary, and LSI keywords.
      3. **Voice**: Use Active Voice. 
      4. **E-E-A-T Depth**: Incorporate "Unique Insights" and solve the "Reader's Core Problem" directly.
      5. **Structure**: 
         - H1: Compelling title.
         - "Key Takeaways" section.
         - Use H2 and H3 subheadings frequently.
         - **MULTIMEDIA ASSETS**:
           - Include exactly ${imageCount} image placeholders: [Image: Descriptive caption for AI image generation].
           - Include exactly ${infographicCount} infographic placeholders: [Infographic: Descriptive caption].
           - Include exactly ${diagramCount} diagram placeholders: [Diagram: Descriptive caption].
           - Include exactly ${otherMediaCount} media placeholders: [Media: Description].
         - A "Common FAQs" section.
         - A "References" section.

      ${linkInstructions}
      ${humanizationInstructions}

      **TECHNICAL RESPONSE FORMAT**:
      Part 1: %%JSON-LD-START%% [Valid Article Schema JSON] %%JSON-LD-END%%
      Part 2: %%META-START%% [155-character meta description in ${lang}] %%META-END%%
      Part 3: [Full Markdown Article]

      Target length is ${length}.
    `;
}

async function generateAndPlaceImages(formData: FormData): Promise<void> {
    const html = outputDiv.innerHTML;
    const regex = /\[(Image|Infographic|Diagram|Media): (.*?)\]/g;
    const matches = [...html.matchAll(regex)];
    if (matches.length === 0) return;

    let currentHtml = outputDiv.innerHTML;

    for (const match of matches) {
        const placeholder = match[0];
        const type = match[1];
        const caption = match[2];
        try {
            const res = await ai.models.generateImages({
                model: 'imagen-4.0-generate-001',
                prompt: `A professional, high-quality ${type.toLowerCase()} for a blog post showing: ${caption}. Cinematic lighting, 8k resolution, modern corporate aesthetic.`,
                config: { 
                    numberOfImages: 1, 
                    aspectRatio: '16:9' 
                }
            });
            const url = `data:image/jpeg;base64,${res.generatedImages[0].image.imageBytes}`;
            currentHtml = currentHtml.replace(placeholder, `
              <figure class="gen-img">
                <img src="${url}" alt="${caption}" loading="lazy">
                <figcaption>${caption}</figcaption>
              </figure>`);
            outputDiv.innerHTML = currentHtml;
        } catch (e) {
            console.error("Image generation failed", e);
            currentHtml = currentHtml.replace(placeholder, `<div class="img-err">Media Placeholder: ${caption} (Limit Reached)</div>`);
            outputDiv.innerHTML = currentHtml;
        }
    }
}

function updateMetrics(formData: FormData) {
    const text = outputDiv.innerText;
    const html = outputDiv.innerHTML;
    
    // SEO Score calculation
    const seoScore = calculateSEOScore(text, html, formData);
    seoScoreEl.textContent = seoScore.toString();
    
    // Color indicators for score
    if (seoScore > 85) seoScoreEl.style.color = "var(--primary-color)";
    else if (seoScore > 60) seoScoreEl.style.color = "#ffa502";
    else seoScoreEl.style.color = "#ff4757";

    // Readability
    const grade = calculateFleschKincaid(text);
    readabilityScoreEl.textContent = grade.toFixed(1);
}

function initialize() {
    const highContrastSaved = localStorage.getItem('highContrastMode') === 'true';
    highContrastToggle.checked = highContrastSaved;
    document.body.classList.toggle('high-contrast', highContrastSaved);
}

initialize();