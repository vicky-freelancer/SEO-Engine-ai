/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI } from "@google/genai";
import { marked } from "marked";

// Ensure the API key is handled securely. For this example, it's assumed to be in the environment variables.
const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  document.body.innerHTML = "<h1>Error: API_KEY is not set.</h1> <p>Please configure your environment with the correct API key.</p>";
  throw new Error("API key not found");
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

const form = document.getElementById('article-form') as HTMLFormElement;
const generateBtn = document.getElementById('generate-btn') as HTMLButtonElement;
const outputDiv = document.getElementById('output') as HTMLDivElement;
const loadingIndicator = document.getElementById('loading-indicator') as HTMLDivElement;
const outputPlaceholder = document.getElementById('output-placeholder') as HTMLDivElement;
const outputActions = document.getElementById('output-actions') as HTMLDivElement;
const copyBtn = document.getElementById('copy-btn') as HTMLButtonElement;
const downloadBtn = document.getElementById('download-btn') as HTMLButtonElement;
const addExternalLinksCheckbox = document.getElementById('add-external-links') as HTMLInputElement;
const externalLinksCountContainer = document.getElementById('external-links-count-container') as HTMLDivElement;
const outputStats = document.getElementById('output-stats') as HTMLDivElement;
const readabilityScoreEl = document.getElementById('readability-score') as HTMLSpanElement;

addExternalLinksCheckbox.addEventListener('change', () => {
    externalLinksCountContainer.classList.toggle('hidden', !addExternalLinksCheckbox.checked);
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const formData = new FormData(form);
  const primaryKeyword = formData.get('primary-keyword') as string;

  if (!primaryKeyword.trim()) {
    alert('Please enter a primary keyword.');
    return;
  }

  // UI state updates
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
      model: 'gemini-2.5-pro', // Using a more powerful model for better article quality
      contents: prompt,
    });

    let firstChunk = true;
    let fullMarkdownText = '';
    for await (const chunk of response) {
      if (firstChunk) {
        loadingIndicator.classList.add('hidden');
        firstChunk = false;
      }
      fullMarkdownText += chunk.text;
      // Parse the accumulated markdown and update the DOM.
      outputDiv.innerHTML = await marked.parse(fullMarkdownText);
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

copyBtn.addEventListener('click', () => {
    try {
        const outputHTML = outputDiv.innerHTML;
        const blob = new Blob([outputHTML], { type: 'text/html' });
        // The ClipboardItem API is the modern way to write rich text to the clipboard.
        const clipboardItem = new ClipboardItem({ 'text/html': blob });

        navigator.clipboard.write([clipboardItem]).then(() => {
            const originalText = copyBtn.textContent;
            copyBtn.textContent = 'Copied!';
            copyBtn.disabled = true;
            setTimeout(() => {
                copyBtn.textContent = originalText;
                copyBtn.disabled = false;
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy using Clipboard API, falling back.', err);
            // Fallback for older browsers or if the API fails
            const listener = (e: ClipboardEvent) => {
                e.clipboardData?.setData('text/html', outputHTML);
                e.clipboardData?.setData('text/plain', outputDiv.innerText);
                e.preventDefault();
            };
            document.addEventListener('copy', listener);
            document.execCommand('copy');
            document.removeEventListener('copy', listener);
        });
    } catch(e) {
        console.error("Copying failed", e);
        alert("Could not copy content to clipboard.");
    }
});

downloadBtn.addEventListener('click', () => {
    const primaryKeyword = (document.getElementById('primary-keyword') as HTMLInputElement).value || 'generated-article';
    // Sanitize the filename
    const fileName = `${primaryKeyword.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.html`;
    
    // Create a full HTML document for download
    const fileContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${primaryKeyword}</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; max-width: 800px; margin: 2rem auto; padding: 0 1rem; color: #333; }
                img { max-width: 100%; height: auto; border-radius: 8px; margin: 1em 0; }
                h1, h2, h3, h4, h5, h6 { color: #111; }
                a { color: #007bff; text-decoration: none; }
                a:hover { text-decoration: underline; }
            </style>
        </head>
        <body>
            ${outputDiv.innerHTML}
        </body>
        </html>
    `;
    
    const blob = new Blob([fileContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    
    // Cleanup
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});


/**
 * Finds image placeholders in the generated text, generates images using Gemini,
 * and replaces the placeholders with the images.
 * @param formData The form data containing image prompts and styles.
 */
async function generateAndPlaceImages(formData: FormData): Promise<void> {
    const finalHtml = outputDiv.innerHTML;
    const imagePrompts = (formData.get('image-prompts') as string || '').trim().split('\n').filter(p => p.trim() !== '');
    const imageStyle = (formData.get('image-style') as string || '').trim();

    const placeholderRegex = /\[(Image|Infographic|Diagram): (.*?)\]/g;
    const placeholders = [...finalHtml.matchAll(placeholderRegex)];

    if (placeholders.length === 0) {
        return; // No images to generate
    }

    const imageGenerationTasks = placeholders.map((match, index) => {
        const type = match[1]; // e.g., "Image", "Infographic"
        const caption = match[2];

        // Use user-provided prompt if available, otherwise use the caption from the text
        let basePrompt = imagePrompts[index] || caption;
        
        // Craft a more specific prompt for infographics and diagrams
        let finalPrompt = basePrompt;
        if (type.toLowerCase() !== 'image') {
          finalPrompt = `An ${type.toLowerCase()} about: "${basePrompt}"`;
        }
        
        if (imageStyle) {
            finalPrompt = `${imageStyle}, ${finalPrompt}`;
        }
        
        return { caption, prompt: finalPrompt };
    });

    // Replace text placeholders with loading indicators
    let placeholderIndex = 0;
    const htmlWithLoaders = finalHtml.replace(placeholderRegex, () => {
        const task = imageGenerationTasks[placeholderIndex];
        const loaderId = `image-loader-${placeholderIndex}`;
        placeholderIndex++;
        return `<div id="${loaderId}" class="image-placeholder loading" role="status" aria-live="polite">
                    <div class="spinner"></div>
                    <p>Generating: <em>${task.caption}</em></p>
                </div>`;
    });
    outputDiv.innerHTML = htmlWithLoaders;

    // Start generating images and replace loaders when complete
    const imagePromises = imageGenerationTasks.map(async (task, index) => {
        const loaderId = `image-loader-${index}`;
        const loaderElement = document.getElementById(loaderId);
        
        try {
            const response = await ai.models.generateImages({
                model: 'imagen-4.0-generate-001',
                prompt: task.prompt,
                config: {
                    numberOfImages: 1,
                    outputMimeType: 'image/jpeg',
                    aspectRatio: '16:9',
                },
            });
            
            const base64ImageBytes = response.generatedImages[0].image.imageBytes;
            if (!base64ImageBytes) {
                throw new Error("API did not return image data.");
            }

            const imageUrl = `data:image/jpeg;base64,${base64ImageBytes}`;
            
            const imgElement = document.createElement('img');
            imgElement.src = imageUrl;
            imgElement.alt = task.caption;
            imgElement.classList.add('generated-image');
            
            loaderElement?.replaceWith(imgElement);
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

/**
 * Calculates a word's syllable count using a heuristic approach.
 * @param word The word to count syllables for.
 * @returns The estimated number of syllables.
 */
function countSyllables(word: string): number {
    if (!word) return 0;
    word = word.toLowerCase().replace(/[^a-z]/g, '');
    if (word.length <= 3) return 1;

    let count = word.match(/[aeiouy]+/g)?.length || 0;

    // Adjust for silent 'e' at the end of a word
    if (word.endsWith('e') && !word.endsWith('le')) {
        const stem = word.slice(0, -1);
        if (stem.match(/[aeiouy]/)) {
            count--;
        }
    }
    
    return Math.max(1, count); // Every word has at least one syllable
}

/**
 * Calculates the Flesch-Kincaid grade level for a given text.
 * @param text The text content to analyze.
 * @returns The calculated grade level.
 */
function calculateReadability(text: string): number {
    if (!text || text.trim().length < 20) {
        return 0;
    }
    
    const words = text.trim().split(/\s+/).filter(w => w.length > 0);
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
    
    const wordCount = words.length;
    // Avoid division by zero if no sentences are found
    const sentenceCount = sentences.length > 0 ? sentences.length : 1;

    if (wordCount < 10) return 0; // Not enough content to score accurately

    const syllableCount = words.reduce((acc, word) => acc + countSyllables(word), 0);
    
    // Flesch-Kincaid Grade Level formula
    const grade = 0.39 * (wordCount / sentenceCount) + 11.8 * (syllableCount / wordCount) - 15.59;
    
    return Math.round(grade * 10) / 10; // Round to one decimal place
}

/**
 * Updates all content metrics, like readability score.
 */
function updateMetrics() {
    const text = outputDiv.innerText;
    const score = calculateReadability(text);
    if (score > 0) {
        readabilityScoreEl.textContent = score.toFixed(1);
    } else {
        readabilityScoreEl.textContent = 'N/A';
    }
}


function constructPrompt(formData: FormData): string {
    const getVal = (id: string) => (formData.get(id) as string).trim();
    const getSerpFeatures = () => {
        const features = formData.getAll('serp-features') as string[];
        return features.length > 0 ? features.join(', ') : 'N/A';
    };
    const getMultimediaTypes = () => {
        const types = formData.getAll('multimedia-types') as string[];
        return types.length > 0 ? types.join(', ') : 'Image';
    };
    const addExternalLinks = formData.get('add-external-links') === 'on';
    const externalLinksCount = getVal('external-links-count');
    
    return `
      You are an expert SEO content writer and strategist. Your task is to write a high-quality, engaging, and SEO-optimized article based on the following detailed specifications.
      The article must be well-structured, easy to read, and provide real value to the reader. Use Markdown for formatting (headings, subheadings, lists, bold text, and links).

      ---
      **ARTICLE SPECIFICATIONS:**
      ---

      **1. Primary Keyword (Focus Topic):** ${getVal('primary-keyword')}
      
      **2. Secondary Keywords (Incorporate naturally):** 
      ${getVal('secondary-keywords') || 'N/A'}

      **3. Longtail Keywords (Address these specific queries):** 
      ${getVal('longtail-keywords') || 'N/A'}

      **4. Cluster Keywords (Use to build topical authority):** 
      ${getVal('cluster-keywords') || 'N/A'}

      **5. Related Searches (Cover these related topics):** 
      ${getVal('related-searches') || 'N/A'}
      
      **6. LSI Keywords (Include for semantic relevance):**
      ${getVal('lsi-keywords') || 'N/A'}

      **7. Target Audience Tone & Language:** 
      - **Country/Region Slang:** ${getVal('country-slang') || 'General / Global'}
      
      **8. E-E-A-T (Experience, Expertise, Authoritativeness, Trustworthiness):**
      - **Author Bio to reference for tone and expertise:** ${getVal('author-bio') || 'N/A'}
      ${getVal('author-bio') ? `
      - **E-E-A-T Instructions:**
        - **Show, Don't Just Tell:** Based on the provided author bio, weave in practical, first-hand experience examples. Use phrases that reflect personal experience (e.g., "In my experience...", "A common mistake I see is...", "I've found that...").
        - **Cite Credible Sources:** To build authority and trust, mention credible sources, studies, or experts to back up claims. For example, "According to a study by [Relevant Institution]..." or "As noted by expert [Expert's Name]...". This demonstrates a commitment to accuracy.` : ''}

      **9. Structure & Format:**
      - **Target SERP Features (Optimize for these):** ${getSerpFeatures()}
        - If "Featured snippet" is targeted, include a concise, clear paragraph (40-60 words) directly answering the primary keyword's query near the top of the article.
        - If "People also ask" is targeted, structure sections of the article in a Q&A format using the longtail keywords and related searches as questions.
        - If "Thumbnails", "Videos", or "Image pack" are targeted, ensure the multimedia placeholders are descriptive and relevant to the surrounding content.
        - If "Top stories" is targeted, adopt a slightly more news-oriented or timely tone if appropriate for the topic.
      - **Article Length:** ${getVal('article-length')}
      - **Multimedia:** Include exactly ${getVal('multimedia-count')} placeholders for multimedia. The allowed types are: ${getMultimediaTypes()}. Use the format [Type: A descriptive caption of the content]. For example: [Infographic: A chart showing the growth of sustainable gardening].
      - **Introduction:** Must have a strong hook. Specific instruction: "${getVal('intro-hook') || 'Grab the reader\'s attention immediately.'}"
      - **Conclusion:** Should provide a clear summary and call to action. Specific instruction: "${getVal('conclusion-style') || 'End with a memorable and impactful closing statement.'}"

      ---
      **WRITING INSTRUCTIONS:**
      ---
      - **CRITICAL NOTE ON TONE:** If a "Target Country Slang" is specified (i.e., not 'General / Global'), it is MANDATORY to incorporate relevant slang and colloquialisms naturally throughout the article to match that region's tone. This is a primary requirement.
      - **Title:** Create a compelling, SEO-friendly title that includes the primary keyword.
      - **Headings:** Use H2 and H3 headings to structure the article logically.
      - **Flow:** Ensure the article flows naturally from one section to the next.
      - **Keyword Integration:** Weave all provided keywords into the text organically. Do not "stuff" keywords.
      - **Formatting:** Use short paragraphs, bullet points, and bold text to improve readability.
      - **Placeholders:** Insert the multimedia placeholders at relevant points in the article, following the specified format and types.
      ${addExternalLinks ? `- **External Linking:** You MUST include exactly ${externalLinksCount} high-authority, non-competitive external links within the article. Identify relevant anchor text naturally within the content and hyperlink it to a credible external source. Use the correct Markdown format for links: \`[Anchor Text](https://www.example.com)\`.` : ''}

      Now, generate the complete article based on these specifications.
    `;
}