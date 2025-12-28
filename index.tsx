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
let articleJsonLd: string | null = null; // To store the generated JSON-LD for the article
let articleMetaDescription: string | null = null; // To store the generated Meta Description

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
  const analyzeCompetitors = formData.get('analyze-competitors') === 'on';
  const referenceUrl = formData.get('reference-url') as string;

  if (!primaryKeyword.trim()) {
    alert('Please enter a primary keyword.');
    return;
  }

  // Reset state
  articleJsonLd = null;
  articleMetaDescription = null;
  
  // UI state updates for generation start
  outputDiv.innerHTML = '';
  outputPlaceholder.classList.add('hidden');
  loadingIndicator.classList.remove('hidden');
  outputActions.classList.add('hidden');
  outputStats.classList.add('hidden');
  metaDescriptionContainer.classList.add('hidden');
  readabilityScoreEl.textContent = '--';
  seoScoreEl.textContent = '--';
  seoScoreEl.style.color = '';
  generateBtn.disabled = true;
  generateBtn.textContent = (analyzeCompetitors || referenceUrl) ? 'Researching & Generating...' : 'Generating...';

  const prompt = constructPrompt(formData);

  try {
    const requestConfig: any = {
        thinkingConfig: { thinkingBudget: 0 } // Standard speed for generation
    };
    
    // Always use search tool if reference URL is provided or competitor analysis is requested
    if (analyzeCompetitors || referenceUrl) {
      requestConfig.tools = [{googleSearch: {}}];
    }

    const response = await ai.models.generateContentStream({
      model: 'gemini-2.5-pro',
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
      
      // Capture grounding metadata if available (for Google Search sources)
      if (chunk.candidates?.[0]?.groundingMetadata?.groundingChunks) {
        collectedGroundingChunks = [
            ...collectedGroundingChunks, 
            ...chunk.candidates[0].groundingMetadata.groundingChunks
        ];
      }

      buffer += chunk.text;
      
      // Extract JSON-LD
      if (!articleJsonLd && buffer.includes(jsonLdEndDelimiter)) {
        const startIndex = buffer.indexOf(jsonLdStartDelimiter) + jsonLdStartDelimiter.length;
        const endIndex = buffer.indexOf(jsonLdEndDelimiter);
        articleJsonLd = buffer.substring(startIndex, endIndex).trim();
        buffer = buffer.substring(endIndex + jsonLdEndDelimiter.length);
      }

      // Extract Meta Description
      if (!articleMetaDescription && buffer.includes(metaEndDelimiter)) {
        const startIndex = buffer.indexOf(metaStartDelimiter) + metaStartDelimiter.length;
        const endIndex = buffer.indexOf(metaEndDelimiter);
        articleMetaDescription = buffer.substring(startIndex, endIndex).trim();
        
        // Update UI for meta description
        metaDescriptionTextEl.textContent = articleMetaDescription;
        metaCharCountEl.textContent = `${articleMetaDescription.length} / 160`;
        metaDescriptionContainer.classList.remove('hidden');
        
        buffer = buffer.substring(endIndex + metaEndDelimiter.length);
      }
      
      // Render markdown once delimiters are bypassed
      if ((articleJsonLd && articleMetaDescription) || (!buffer.includes(jsonLdStartDelimiter) && !buffer.includes(metaStartDelimiter))) {
        outputDiv.innerHTML = await marked.parse(buffer);
      }
    }

    // Append sources if available
    if (collectedGroundingChunks.length > 0) {
        const uniqueSources = new Map();
        collectedGroundingChunks.forEach((chunk: any) => {
            if (chunk.web?.uri && chunk.web?.title) {
                uniqueSources.set(chunk.web.uri, chunk.web.title);
            }
        });

        if (uniqueSources.size > 0) {
            let sourcesHtml = `<div class="sources-section" style="margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--border-color);"><h3>Sources & Research Citations</h3><ul style="list-style: none; padding-left: 0;">`;
            for (const [uri, title] of uniqueSources) {
                sourcesHtml += `<li style="margin-bottom: 0.5rem;"><a href="${uri}" target="_blank" rel="noopener noreferrer">🔗 ${title}</a></li>`;
            }
            sourcesHtml += `</ul></div>`;
            outputDiv.innerHTML += sourcesHtml;
        }
    }
    
    updateMetrics(formData);

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
        const metaInfo = articleMetaDescription ? `<p><strong>Meta Description:</strong> ${articleMetaDescription}</p><hr>` : '';
        const outputHTML = metaInfo + outputDiv.innerHTML;
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
    const metaTag = articleMetaDescription ? `<meta name="description" content="${articleMetaDescription.replace(/"/g, '&quot;')}">` : '';

    const fileContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${primaryKeyword}</title>
    ${metaTag}
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

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); 
}

function calculateSeoScore(text: string, html: string, formData: FormData): number {
    let score = 0;
    const primaryKeyword = (formData.get('primary-keyword') as string).toLowerCase().trim();
    const articleLength = formData.get('article-length') as string;
    
    if (!primaryKeyword) return 0;
    
    const lowerText = text.toLowerCase();
    const lowerHtml = html.toLowerCase();

    // 1. Primary Keyword in Title (H1) - 20 pts
    if (lowerHtml.match(new RegExp(`<h1[^>]*>.*?${escapeRegExp(primaryKeyword)}.*?</h1>`))) {
        score += 20;
    }

    // 2. Primary Keyword in First 100 Words - 15 pts
    const first100Words = lowerText.split(/\s+/).slice(0, 100).join(' ');
    if (first100Words.includes(primaryKeyword)) {
        score += 15;
    }

    // 3. Keyword Density (0.5% - 2.5% is good) - 15 pts
    const wordCount = text.split(/\s+/).length;
    const keywordCount = (lowerText.match(new RegExp(escapeRegExp(primaryKeyword), 'g')) || []).length;
    const density = (keywordCount / wordCount) * 100;
    
    if (density >= 0.5 && density <= 3) {
        score += 15;
    } else if (density > 0) {
        score += 5; // Partial points for presence
    }

    // 4. Word Count Targets - 15 pts
    let targetWords = 1000;
    if (articleLength.includes('short')) targetWords = 500;
    if (articleLength.includes('long')) targetWords = 2000;
    
    if (wordCount >= targetWords * 0.8) {
        score += 15;
    } else if (wordCount >= targetWords * 0.5) {
        score += 8;
    }

    // 5. Structure (H2/H3) - 10 pts
    const h2Count = (lowerHtml.match(/<h2/g) || []).length;
    if (h2Count >= 2) score += 10;

    // 6. Secondary Keywords Presence - 15 pts
    const secondaryKeywords = (formData.get('secondary-keywords') as string)
        .split(',')
        .map(k => k.trim().toLowerCase())
        .filter(k => k);
    
    if (secondaryKeywords.length > 0) {
        const presentCount = secondaryKeywords.filter(k => lowerText.includes(k)).length;
        const ratio = presentCount / secondaryKeywords.length;
        score += Math.round(ratio * 15);
    } else {
        score += 15; // Give full points if no secondary keywords were provided to check against
    }

    // 7. Multimedia/Images - 10 pts
    if (lowerHtml.includes('<img') || lowerHtml.includes('<figure')) {
        score += 10;
    }

    return Math.min(100, score);
}

function updateMetrics(formData: FormData) {
    const text = outputDiv.innerText;
    const html = outputDiv.innerHTML;
    
    // Readability
    const rScore = calculateReadability(text);
    readabilityScoreEl.textContent = rScore > 0 ? rScore.toFixed(1) : 'N/A';

    // SEO Score
    const seoScore = calculateSeoScore(text, html, formData);
    seoScoreEl.textContent = seoScore.toString();
    
    // Color coding for SEO Score
    if (seoScore >= 80) seoScoreEl.style.color = '#00f2ea'; // Primary (Green/Cyan)
    else if (seoScore >= 50) seoScoreEl.style.color = '#ffd700'; // Warning (Yellow)
    else seoScoreEl.style.color = '#ff4757'; // Error (Red)
}

function constructPrompt(formData: FormData): string {
    const getVal = (id: string) => (formData.get(id) as string).trim();
    const getSerpFeatures = () => (formData.getAll('serp-features') as string[]).join(', ') || 'N/A';
    const getMultimediaTypes = () => (formData.getAll('multimedia-types') as string[]).join(', ') || 'Image';
    const addExternalLinks = formData.get('add-external-links') === 'on';
    const analyzeCompetitors = formData.get('analyze-competitors') === 'on';
    const externalLinksCount = getVal('external-links-count');
    const targetLanguage = formData.get('target-language') as string || 'English';
    const referenceUrl = getVal('reference-url');
    
    // Get specific keyword lists for strict inclusion
    const secondaryKeywords = getVal('secondary-keywords');
    const longTailKeywords = getVal('longtail-keywords');
    const clusterKeywords = getVal('cluster-keywords');
    const relatedKeywords = getVal('related-searches');
    const lsiKeywords = getVal('lsi-keywords');

    // NLP Values
    const nlpEntities = getVal('nlp-entities');
    const nlpTone = getVal('nlp-tone');

    // Helpful Content / E-E-A-T Values
    const readerProblem = getVal('reader-problem');
    const uniqueInsights = getVal('unique-insights');
    const peopleFirstMode = formData.get('people-first-mode') === 'on';

    // Affiliate Values
    const affiliateUrl = getVal('affiliate-url');
    const affiliateProduct = getVal('affiliate-product');
    const affiliateAnchor = getVal('affiliate-anchor');
    
    // Ranking Signals
    const optimizePassageRanking = formData.get('optimize-passage-ranking') === 'on';
    const includeKeyTakeaways = formData.get('include-key-takeaways') === 'on';
    const addMythBusting = formData.get('add-myth-busting') === 'on';

    return `
      You are an expert SEO content writer and strategist proficient in multiple languages. 
      
      **TARGET LANGUAGE:** You MUST write the Meta Description and the full Article in **${targetLanguage}**.
      
      ${referenceUrl ? `**PRIMARY SOURCE:** You MUST analyze and base the content, structure, and facts of the article primarily on the following reference URL: ${referenceUrl}. Ensure you capture its key points while optimizing for SEO.` : ''}

      Your task is to generate a complete response containing three specific parts: a JSON-LD schema, a Meta Description, and a full article.

      **PART 1: JSON-LD SCHEMA**
      - Create a valid JSON-LD \`Article\` schema (JSON keys should be in English).
      - Include: \`headline\` (in ${targetLanguage}), \`author\` (using bio or generic), \`datePublished\` (today), and \`keywords\` (in ${targetLanguage}).
      - Enclose within %%JSON-LD-START%% and %%JSON-LD-END%%.

      **PART 2: META DESCRIPTION**
      - Create a highly effective, SEO-friendly meta description (150-160 characters) in **${targetLanguage}**.
      - It MUST include the primary keyword: "${getVal('primary-keyword')}".
      - It MUST be compelling and encourage high Click-Through Rates (CTR).
      - Enclose within %%META-START%% and %%META-END%%.

      **PART 3: SEO-OPTIMIZED ARTICLE**
      - Immediately after the meta block, write the full article in **${targetLanguage}**.
      - Use Markdown for formatting.

      ---
      **STRICT CONTENT & STYLE GUIDELINES (MUST FOLLOW):**
      ---
      
      **1. KEYWORD INTEGRATION & FORMATTING:**
      - You MUST include ALL of the following keywords at least once within the article sections:
        - **Secondary Keywords:** ${secondaryKeywords || 'None'}
        - **Long Tail Keywords:** ${longTailKeywords || 'None'}
        - **Cluster Keywords:** ${clusterKeywords || 'None'}
        - **Related Searches:** ${relatedKeywords || 'None'}
        - **LSI Keywords:** ${lsiKeywords || 'None'}
      - **CRITICAL FORMATTING RULE:** You MUST **bold** every instance of these specific keywords when they appear in the text (e.g., "**organic soil**"). This is non-negotiable.

      **2. READABILITY & HUMAN TONE:**
      - **Paragraph Length:** STRICTLY keep every paragraph under 3 lines of text. Long blocks of text are forbidden.
      - **Voice:** Write in the **Active Voice** (aim for >90%). Passive voice is limited to max 10%.
      - **Transition Words:** Use transition words in **${targetLanguage}** (e.g., equivalent of "However," "Additionally," "Therefore") in approximately 30% of sentences.
      - **Audience:** Write for **Human Readers**, not AI. Be engaging, empathetic, and direct. Avoid corporate jargon.

      **3. CITATIONS & E-E-A-T:**
      - **Citations:** Add proper citations/references below every major section or after key claims to honor original creators.
      - **Format:** Use do-follow Markdown link format: \`[Source Name](URL)\`. Use \`[Citation Needed]\` if a specific URL isn't found.

      ---
      **ARTICLE SPECIFICATIONS:**
      ---

      **1. Primary Keyword:** ${getVal('primary-keyword')}
      **2. Author Bio:** ${getVal('author-bio') || 'An expert in the field.'}
      **3. Target Audience Tone:** ${getVal('country-slang') || 'General / Global'}
      **4. NLP & Semantic Instructions:**
         - **Salient Entities:** ${nlpEntities || 'Focus on relevant thematic entities.'}
         - **Semantic Tone:** ${nlpTone}
      **5. Structure & Format:**
         - **Target SERP Features:** ${getSerpFeatures()}
         - **Article Length:** ${getVal('article-length')}
         - **Multimedia:** Include exactly ${getVal('multimedia-count')} placeholders like [Type: Caption].
         - **Intro Hook:** "${getVal('intro-hook') || 'Hook the reader immediately.'}"
         - **Conclusion Style:** "${getVal('conclusion-style') || 'Memorable closing statement.'}"
      ${addExternalLinks ? `- **External Linking:** Include exactly ${externalLinksCount} high-authority links.` : ''}

      **6. GOOGLE HELPFUL CONTENT (E-E-A-T) COMPLIANCE:**
         - **People-First Focus:** Solve: "${readerProblem || 'Provide comprehensive depth'}".
         - **Experience:** Use insights: "${uniqueInsights || 'Simulate expert anecdotes.'}".
         ${peopleFirstMode ? `- **Anti-Fluff:** No repetitive filler. High signal-to-noise ratio.` : ''}

      ${analyzeCompetitors ? `
      **7. COMPETITOR ANALYSIS (SERP GROUNDING):**
      - Analyze the top 10 search results for "${getVal('primary-keyword')}".
      - Insert "## ⚡ Competitor Strategy & Gap Analysis" BEFORE the main H1.
      - List 3 gaps and 1 USP.
      ` : ''}

      **8. GOOGLE RANKING SYSTEMS OPTIMIZATION:**
      ${includeKeyTakeaways ? `- **UX:** Include "**Key Takeaways**" bullet points after the H1.` : ''}
      ${optimizePassageRanking ? `- **Passage Ranking:** For H2 questions, provide a **bolded, direct 40-60 word answer** immediately.` : ''}
      ${addMythBusting ? `- **Originality:** Include a "**Common Myths vs. Facts**" table.` : ''}

      ${affiliateUrl ? `
      - **AFFILIATE LINK STRATEGY:**
        - **Product:** ${affiliateProduct || 'Recommended Choice'}
        - **Link:** ${affiliateUrl}
        - **Anchor:** ${affiliateAnchor || 'Check price'}
        - **Locations:** Insert in Introduction and a dedicated CTA section.
        - **Compliance:** Include Pros/Cons table and qualitative data.
      ` : ''}
      
      Begin with the JSON-LD block, then the Meta Description, then the Article.
    `;
}

// --- App Initialization ---
initialize();