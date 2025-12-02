/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, Type } from "@google/genai";
import { marked } from "marked";

// Ensure the API key is handled securely. For this example, it's assumed to be in the environment variables.
const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  document.body.innerHTML = "<h1>Error: API_KEY is not set.</h1> <p>Please configure your environment with the correct API key.</p>";
  throw new Error("API key not found");
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

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
let articleJsonLd: string | null = null; // To store the generated JSON-LD for the article

// --- Event Listeners ---

// High Contrast Mode Toggle
highContrastToggle.addEventListener('change', () => {
    document.body.classList.toggle('high-contrast', highContrastToggle.checked);
    localStorage.setItem('highContrastMode', String(highContrastToggle.checked));
});

// Dynamic Summary Card Updates
primaryKeywordInput.addEventListener('input', () => {
    summaryKeywordEl.textContent = primaryKeywordInput.value.trim() || 'Not Set';
});
articleLengthSelect.addEventListener('change', () => {
    summaryLengthEl.textContent = articleLengthSelect.options[articleLengthSelect.selectedIndex].text.split('(')[0].trim();
});

// External Links Checkbox
addExternalLinksCheckbox.addEventListener('change', () => {
    externalLinksCountContainer.classList.toggle('hidden', !addExternalLinksCheckbox.checked);
});

// Main Form Submission
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const formData = new FormData(form);
  const primaryKeyword = formData.get('primary-keyword') as string;

  if (!primaryKeyword.trim()) {
    alert('Please enter a primary keyword.');
    return;
  }

  // Reset state
  articleJsonLd = null;
  
  // UI state updates for generation start
  outputDiv.innerHTML = '';
  outputPlaceholder.classList.add('hidden');
  loadingIndicator.classList.remove('hidden');
  outputActions.classList.add('hidden');
  outputStats.classList.add('hidden');
  readabilityScoreEl.textContent = '--';
  generateBtn.disabled = true;
  generateBtn.textContent = 'Generating...';

  const prompt = constructPrompt(formData);

  try {
    const response = await ai.models.generateContentStream({
      model: 'gemini-2.5-pro',
      contents: prompt,
    });

    let firstChunk = true;
    let buffer = '';
    const jsonLdStartDelimiter = '%%JSON-LD-START%%';
    const jsonLdEndDelimiter = '%%JSON-LD-END%%';

    for await (const chunk of response) {
      if (firstChunk) {
        loadingIndicator.classList.add('hidden');
        firstChunk = false;
      }
      
      buffer += chunk.text;
      
      // Check if we have received the full JSON-LD block
      if (!articleJsonLd && buffer.includes(jsonLdEndDelimiter)) {
        const startIndex = buffer.indexOf(jsonLdStartDelimiter) + jsonLdStartDelimiter.length;
        const endIndex = buffer.indexOf(jsonLdEndDelimiter);
        
        articleJsonLd = buffer.substring(startIndex, endIndex).trim();
        
        // Remove the JSON-LD block (including delimiters) from the buffer
        buffer = buffer.substring(endIndex + jsonLdEndDelimiter.length);
      }
      
      // Render the markdown content, which is whatever is left in the buffer.
      // We only parse and render *after* the JSON-LD has been extracted.
      if (articleJsonLd || !buffer.includes(jsonLdStartDelimiter)) {
        outputDiv.innerHTML = await marked.parse(buffer);
      }
    }
    
    updateMetrics();

    // After text is generated, start generating images
    await generateAndPlaceImages(formData);

    // Show action buttons after everything is done
    outputStats.classList.remove('hidden');
    outputActions.classList.remove('hidden');

  } catch (error) {
    console.error('Error generating content:', error);
    outputDiv.innerHTML = `<p class="error">An error occurred while generating the article. Please check the console for details.</p>`;
    loadingIndicator.classList.add('hidden');
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = 'Generate Article';
  }
});

// Keyword Generation Buttons
const generateSingleKeywordBtns = document.querySelectorAll('.generate-single-keyword-btn');
generateSingleKeywordBtns.forEach(button => {
    button.addEventListener('click', async () => {
        const btn = button as HTMLButtonElement;
        const keywordType = btn.dataset.type;
        const targetTextareaId = btn.dataset.target;
        
        if (!keywordType || !targetTextareaId) {
            console.error('Button is missing data-type or data-target attribute.');
            return;
        }

        const primaryKeyword = primaryKeywordInput.value.trim();
        if (!primaryKeyword) {
            alert('Please enter a primary keyword first.');
            return;
        }

        const targetTextarea = document.getElementById(targetTextareaId) as HTMLTextAreaElement;
        const btnText = btn.querySelector('.btn-text') as HTMLSpanElement;
        const spinner = btn.querySelector('.spinner-small') as HTMLDivElement;

        btn.disabled = true;
        btnText.textContent = '...';
        spinner.classList.remove('hidden');

        const prompt = `You are an expert SEO keyword strategist. Based on the primary keyword "${primaryKeyword}", generate a list of 5-7 relevant ${keywordType}. Provide the output as a clean JSON array of strings. Do not include any text before or after the JSON array.`;
        
        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
            });

            const keywords = JSON.parse(response.text.trim());
            targetTextarea.value = (keywords || []).join('\n');

        } catch (error) {
            console.error(`Error generating ${keywordType}:`, error);
            alert(`Could not generate ${keywordType}. Please check the console for details.`);
        } finally {
            btn.disabled = false;
            btnText.textContent = 'Generate';
            spinner.classList.add('hidden');
        }
    });
});

// NLP Analysis Button
analyzeNlpBtn.addEventListener('click', async () => {
    const primaryKeyword = primaryKeywordInput.value.trim();
    if (!primaryKeyword) {
        alert('Please enter a primary keyword to analyze.');
        return;
    }

    const btnText = analyzeNlpBtn.querySelector('.btn-text') as HTMLSpanElement;
    const spinner = analyzeNlpBtn.querySelector('.spinner-small') as HTMLDivElement;

    analyzeNlpBtn.disabled = true;
    btnText.textContent = 'Analyzing...';
    spinner.classList.remove('hidden');

    const prompt = `You are an advanced SEO NLP specialist. Analyze the keyword "${primaryKeyword}". 
    Identify:
    1. Salient Entities (Specific people, organizations, locations, or named concepts).
    2. LSI Keywords (Latent Semantic Indexing terms).
    3. Thematic relevance terms.

    Return ONLY a comma-separated list of the top 15-20 most important terms and entities that MUST be included in the content to establish topical authority.`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });

        nlpEntitiesInput.value = response.text.trim();

    } catch (error) {
        console.error('Error generating NLP entities:', error);
        alert('Could not generate NLP entities. Please check the console for details.');
    } finally {
        analyzeNlpBtn.disabled = false;
        btnText.textContent = 'Analyze & Suggest';
        spinner.classList.add('hidden');
    }
});

// Copy to Clipboard Button
copyBtn.addEventListener('click', () => {
    try {
        const outputHTML = outputDiv.innerHTML;
        const blob = new Blob([outputHTML], { type: 'text/html' });
        const clipboardItem = new ClipboardItem({ 'text/html': blob });

        navigator.clipboard.write([clipboardItem]).then(() => {
            const originalText = copyBtn.textContent;
            copyBtn.textContent = 'Copied!';
            copyBtn.disabled = true;
            setTimeout(() => {
                copyBtn.textContent = originalText;
                copyBtn.disabled = false;
            }, 2000);
        });
    } catch(e) {
        console.error("Copying failed", e);
        alert("Could not copy content to clipboard.");
    }
});

// Download HTML Button
downloadBtn.addEventListener('click', () => {
    const primaryKeyword = (document.getElementById('primary-keyword') as HTMLInputElement).value || 'generated-article';
    const fileName = `${primaryKeyword.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.html`;
    
    const jsonLdScript = articleJsonLd ? `<script type="application/ld+json">${articleJsonLd}</script>` : '';

    const fileContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${primaryKeyword}</title>
    ${jsonLdScript}
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; max-width: 800px; margin: 2rem auto; padding: 0 1rem; color: #333; }
        img { max-width: 100%; height: auto; border-radius: 8px; margin: 1em 0; }
        h1, h2, h3, h4, h5, h6 { color: #111; }
        a { color: #007bff; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <article>
        ${outputDiv.innerHTML}
    </article>
</body>
</html>`;
    
    const blob = new Blob([fileContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

// --- Helper Functions ---

/** Initializes the application state from localStorage. */
function initialize() {
    const highContrastSaved = localStorage.getItem('highContrastMode') === 'true';
    highContrastToggle.checked = highContrastSaved;
    document.body.classList.toggle('high-contrast', highContrastSaved);

    // Initialize summary card
    summaryKeywordEl.textContent = primaryKeywordInput.value.trim() || 'Not Set';
    summaryLengthEl.textContent = articleLengthSelect.options[articleLengthSelect.selectedIndex].text.split('(')[0].trim();
}

/**
 * Finds image placeholders, generates images, and replaces the placeholders.
 */
async function generateAndPlaceImages(formData: FormData): Promise<void> {
    const finalHtml = outputDiv.innerHTML;
    const imagePrompts = (formData.get('image-prompts') as string || '').trim().split('\n').filter(p => p.trim() !== '');
    const imageStyle = (formData.get('image-style') as string || '').trim();

    const placeholderRegex = /\[(Image|Infographic|Diagram): (.*?)\]/g;
    const placeholders = [...finalHtml.matchAll(placeholderRegex)];

    if (placeholders.length === 0) return;

    const imageGenerationTasks = placeholders.map((match, index) => {
        const type = match[1];
        const caption = match[2]; // This caption will double as good alt text.
        let basePrompt = imagePrompts[index] || caption;
        let finalPrompt = `${imageStyle ? imageStyle + ', ' : ''}An ${type.toLowerCase()} about: "${basePrompt}"`;
        return { caption, prompt: finalPrompt };
    });

    let placeholderIndex = 0;
    const htmlWithLoaders = finalHtml.replace(placeholderRegex, () => {
        const task = imageGenerationTasks[placeholderIndex];
        const loaderId = `image-loader-${placeholderIndex}`;
        placeholderIndex++;
        return `<figure id="${loaderId}" class="image-placeholder loading" role="status" aria-live="polite">
                    <div class="spinner"></div>
                    <figcaption>Generating: <em>${task.caption}</em></figcaption>
                </figure>`;
    });
    outputDiv.innerHTML = htmlWithLoaders;

    const imagePromises = imageGenerationTasks.map(async (task, index) => {
        const loaderId = `image-loader-${index}`;
        const loaderElement = document.getElementById(loaderId);
        
        try {
            const response = await ai.models.generateImages({
                model: 'imagen-4.0-generate-001',
                prompt: task.prompt,
                config: { numberOfImages: 1, outputMimeType: 'image/jpeg', aspectRatio: '16:9' },
            });
            
            const base64ImageBytes = response.generatedImages[0].image.imageBytes;
            if (!base64ImageBytes) throw new Error("API did not return image data.");

            const imageUrl = `data:image/jpeg;base64,${base64ImageBytes}`;
            const figureElement = document.createElement('figure');
            figureElement.classList.add('generated-image-container');
            figureElement.innerHTML = `<img src="${imageUrl}" alt="${task.caption}" class="generated-image"><figcaption>${task.caption}</figcaption>`;
            loaderElement?.replaceWith(figureElement);
        } catch (error) {
            console.error(`Error generating image for prompt "${task.prompt}":`, error);
            if (loaderElement) {
                loaderElement.innerHTML = `<p class="error">Failed to generate image for: <em>${task.caption}</em></p>`;
                loaderElement.classList.remove('loading');
                loaderElement.classList.add('error-state');
            }
        }
    });

    await Promise.all(imagePromises);
}

function countSyllables(word: string): number {
    if (!word) return 0;
    word = word.toLowerCase().replace(/[^a-z]/g, '');
    if (word.length <= 3) return 1;
    let count = word.match(/[aeiouy]+/g)?.length || 0;
    if (word.endsWith('e') && !word.endsWith('le')) {
        const stem = word.slice(0, -1);
        if (stem.match(/[aeiouy]/)) count--;
    }
    return Math.max(1, count);
}

function calculateReadability(text: string): number {
    if (!text || text.trim().length < 20) return 0;
    
    const words = text.trim().split(/\s+/).filter(w => w.length > 0);
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
    const wordCount = words.length;
    const sentenceCount = sentences.length > 0 ? sentences.length : 1;

    if (wordCount < 10) return 0;

    const syllableCount = words.reduce((acc, word) => acc + countSyllables(word), 0);
    const grade = 0.39 * (wordCount / sentenceCount) + 11.8 * (syllableCount / wordCount) - 15.59;
    return Math.round(grade * 10) / 10;
}

function updateMetrics() {
    const text = outputDiv.innerText;
    const score = calculateReadability(text);
    readabilityScoreEl.textContent = score > 0 ? score.toFixed(1) : 'N/A';
}

function constructPrompt(formData: FormData): string {
    const getVal = (id: string) => (formData.get(id) as string).trim();
    const getSerpFeatures = () => (formData.getAll('serp-features') as string[]).join(', ') || 'N/A';
    const getMultimediaTypes = () => (formData.getAll('multimedia-types') as string[]).join(', ') || 'Image';
    const addExternalLinks = formData.get('add-external-links') === 'on';
    const externalLinksCount = getVal('external-links-count');
    const allKeywords = [
        getVal('primary-keyword'),
        getVal('secondary-keywords'),
        getVal('longtail-keywords'),
        getVal('cluster-keywords'),
        getVal('related-searches'),
        getVal('lsi-keywords')
    ].join('\n').split('\n').filter(k => k.trim() !== '').join(', ');

    // NLP Values
    const nlpEntities = getVal('nlp-entities');
    const nlpTone = getVal('nlp-tone');

    // Affiliate Values
    const affiliateUrl = getVal('affiliate-url');
    const affiliateProduct = getVal('affiliate-product');
    const affiliateAnchor = getVal('affiliate-anchor');

    return `
      You are an expert SEO content writer and strategist. Your task is to generate a complete response containing two parts: a JSON-LD schema and a full article.

      **PART 1: JSON-LD SCHEMA**
      - First, create a valid JSON-LD \`Article\` schema.
      - The schema must include: \`@context\`, \`@type\`, \`headline\`, \`author\` (using the bio if provided, otherwise a generic name), \`datePublished\` (use today's date in YYYY-MM-DD format), and \`keywords\` (a comma-separated string of all provided keywords).
      - Enclose the entire JSON-LD object within these exact delimiters: %%JSON-LD-START%% and %%JSON-LD-END%%. Do not include any other text before or after the JSON-LD within these delimiters.

      **PART 2: SEO-OPTIMIZED ARTICLE**
      - Immediately after the JSON-LD block, write a high-quality, engaging article based on the following specifications.
      - Use Markdown for formatting (headings, lists, bold, links).

      ---
      **ARTICLE SPECIFICATIONS:**
      ---

      **1. Primary Keyword:** ${getVal('primary-keyword')}
      **2. All Keywords to Incorporate:** ${allKeywords}
      **3. Author Bio (for tone/expertise):** ${getVal('author-bio') || 'An expert in the field.'}
      **4. Target Audience Tone & Language (Slang):** ${getVal('country-slang') || 'General / Global'}
      **5. NLP & Semantic Instructions:**
         - **Salient Entities to Cover:** ${nlpEntities || 'Focus on standard relevant terms.'}
         - **Semantic Tone:** ${nlpTone}
         - **Instruction:** Ensure high entity density for the listed concepts without keyword stuffing. Use natural language patterns that align with the specified tone.
      **6. Structure & Format:**
         - **Target SERP Features:** ${getSerpFeatures()}
         - **Article Length:** ${getVal('article-length')}
         - **Multimedia:** Include exactly ${getVal('multimedia-count')} placeholders for [${getMultimediaTypes()}] using the format [Type: A descriptive caption].
         - **Intro Hook:** "${getVal('intro-hook') || 'Grab the reader\'s attention immediately.'}"
         - **Conclusion Style:** "${getVal('conclusion-style') || 'End with a memorable closing statement.'}"
      ${addExternalLinks ? `- **External Linking:** Include exactly ${externalLinksCount} high-authority external links using Markdown format: \`[Anchor Text](https://www.example.com)\`.` : ''}

      ---
      **WRITING INSTRUCTIONS:**
      ---
      - Create a compelling, SEO-friendly title.
      - Weave all keywords naturally into the text. Do not "stuff" them.
      - Use H2 and H3 headings for logical structure.
      - Before the final conclusion, include a "People Also Ask" (PAA) section with 4-5 relevant questions and their concise answers. Use an H2 heading for this section.
      - Use short paragraphs, bullet points, and bold text for readability.
      - Adhere to the specified tone and slang if a country is provided.
      - If an author bio is provided, write in a first-person perspective that reflects that experience.
      ${affiliateUrl ? `
      - **AFFILIATE LINK STRATEGY (CRITICAL):**
        - **Product:** ${affiliateProduct || 'Recommended Product'}
        - **Link:** ${affiliateUrl}
        - **Anchor Text:** ${affiliateAnchor || 'Check price'}
        - **Placement:** You MUST insert this affiliate link in **two specific locations**:
          1. **Introduction:** Naturally weave the link into the first 150 words. It must feel like a helpful resource, not an ad.
          2. **Dedicated CTA Section:** Create a distinct "Recommended Product" or "Editor's Choice" section just before the Conclusion. This section should highlight the product's benefits and use the provided anchor text.
        - **Tone:** The recommendation must be **value-driven**. Explain *why* this product helps the reader achieve their goals.
      ` : ''}
      
      Begin the response now, starting with the JSON-LD block.
    `;
}

// --- App Initialization ---
initialize();