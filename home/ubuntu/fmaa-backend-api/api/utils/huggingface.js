/**
 * Hugging Face API utility functions for FMAA ecosystem
 */
class HuggingFaceUtils {
  constructor() {
    this.apiKey = process.env.HUGGINGFACE_API_KEY;
    this.baseUrl = 'https://api-inference.huggingface.co';
    this.defaultTimeout = 30000; // 30 seconds
    
    if (!this.apiKey) {
      console.warn('HUGGINGFACE_API_KEY not found in environment variables');
    }
  }

  /**
   * Make a request to Hugging Face API
   */
  async makeRequest(endpoint, data, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const timeout = options.timeout || this.defaultTimeout;
    
    const requestOptions = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers
      },
      body: JSON.stringify(data)
    };

    try {
      // Create timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout')), timeout);
      });

      // Make the request
      const fetchPromise = fetch(url, requestOptions);
      const response = await Promise.race([fetchPromise, timeoutPromise]);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      return result;
    } catch (error) {
      console.error(`Hugging Face API error for ${endpoint}:`, error);
      throw new Error(`Hugging Face API request failed: ${error.message}`);
    }
  }

  /**
   * Sentiment Analysis
   */
  async analyzeSentiment(text, options = {}) {
    const model = options.model || 'cardiffnlp/twitter-roberta-base-sentiment-latest';
    const endpoint = `/models/${model}`;
    
    const data = {
      inputs: text,
      options: {
        wait_for_model: true,
        use_cache: options.use_cache !== false
      }
    };

    try {
      const result = await this.makeRequest(endpoint, data, options);
      return this.normalizeSentimentResult(result, model);
    } catch (error) {
      throw new Error(`Sentiment analysis failed: ${error.message}`);
    }
  }

  /**
   * Text Classification
   */
  async classifyText(text, options = {}) {
    const model = options.model || 'facebook/bart-large-mnli';
    const endpoint = `/models/${model}`;
    
    const data = {
      inputs: text,
      parameters: {
        candidate_labels: options.labels || ['positive', 'negative', 'neutral']
      },
      options: {
        wait_for_model: true,
        use_cache: options.use_cache !== false
      }
    };

    try {
      const result = await this.makeRequest(endpoint, data, options);
      return this.normalizeClassificationResult(result, model);
    } catch (error) {
      throw new Error(`Text classification failed: ${error.message}`);
    }
  }

  /**
   * Text Similarity
   */
  async calculateSimilarity(sourceText, targetTexts, options = {}) {
    const model = options.model || 'sentence-transformers/all-MiniLM-L6-v2';
    const endpoint = `/models/${model}`;
    
    const data = {
      inputs: {
        source_sentence: sourceText,
        sentences: Array.isArray(targetTexts) ? targetTexts : [targetTexts]
      },
      options: {
        wait_for_model: true,
        use_cache: options.use_cache !== false
      }
    };

    try {
      const result = await this.makeRequest(endpoint, data, options);
      return this.normalizeSimilarityResult(result, model, sourceText, targetTexts);
    } catch (error) {
      throw new Error(`Similarity calculation failed: ${error.message}`);
    }
  }

  /**
   * Text Generation
   */
  async generateText(prompt, options = {}) {
    const model = options.model || 'gpt2';
    const endpoint = `/models/${model}`;
    
    const data = {
      inputs: prompt,
      parameters: {
        max_length: options.max_length || 100,
        temperature: options.temperature || 0.7,
        top_p: options.top_p || 0.9,
        do_sample: options.do_sample !== false,
        num_return_sequences: options.num_return_sequences || 1
      },
      options: {
        wait_for_model: true,
        use_cache: options.use_cache !== false
      }
    };

    try {
      const result = await this.makeRequest(endpoint, data, options);
      return this.normalizeGenerationResult(result, model, prompt);
    } catch (error) {
      throw new Error(`Text generation failed: ${error.message}`);
    }
  }

  /**
   * Question Answering
   */
  async answerQuestion(question, context, options = {}) {
    const model = options.model || 'deepset/roberta-base-squad2';
    const endpoint = `/models/${model}`;
    
    const data = {
      inputs: {
        question: question,
        context: context
      },
      options: {
        wait_for_model: true,
        use_cache: options.use_cache !== false
      }
    };

    try {
      const result = await this.makeRequest(endpoint, data, options);
      return this.normalizeQAResult(result, model, question, context);
    } catch (error) {
      throw new Error(`Question answering failed: ${error.message}`);
    }
  }

  /**
   * Named Entity Recognition
   */
  async extractEntities(text, options = {}) {
    const model = options.model || 'dbmdz/bert-large-cased-finetuned-conll03-english';
    const endpoint = `/models/${model}`;
    
    const data = {
      inputs: text,
      options: {
        wait_for_model: true,
        use_cache: options.use_cache !== false
      }
    };

    try {
      const result = await this.makeRequest(endpoint, data, options);
      return this.normalizeNERResult(result, model, text);
    } catch (error) {
      throw new Error(`Named entity recognition failed: ${error.message}`);
    }
  }

  /**
   * Text Summarization
   */
  async summarizeText(text, options = {}) {
    const model = options.model || 'facebook/bart-large-cnn';
    const endpoint = `/models/${model}`;
    
    const data = {
      inputs: text,
      parameters: {
        max_length: options.max_length || 150,
        min_length: options.min_length || 30,
        do_sample: options.do_sample || false
      },
      options: {
        wait_for_model: true,
        use_cache: options.use_cache !== false
      }
    };

    try {
      const result = await this.makeRequest(endpoint, data, options);
      return this.normalizeSummarizationResult(result, model, text);
    } catch (error) {
      throw new Error(`Text summarization failed: ${error.message}`);
    }
  }

  /**
   * Language Detection
   */
  async detectLanguage(text, options = {}) {
    const model = options.model || 'papluca/xlm-roberta-base-language-detection';
    const endpoint = `/models/${model}`;
    
    const data = {
      inputs: text,
      options: {
        wait_for_model: true,
        use_cache: options.use_cache !== false
      }
    };

    try {
      const result = await this.makeRequest(endpoint, data, options);
      return this.normalizeLanguageDetectionResult(result, model, text);
    } catch (error) {
      throw new Error(`Language detection failed: ${error.message}`);
    }
  }

  /**
   * Embedding Generation
   */
  async generateEmbeddings(texts, options = {}) {
    const model = options.model || 'sentence-transformers/all-MiniLM-L6-v2';
    const endpoint = `/models/${model}`;
    
    const inputs = Array.isArray(texts) ? texts : [texts];
    
    const data = {
      inputs: inputs,
      options: {
        wait_for_model: true,
        use_cache: options.use_cache !== false
      }
    };

    try {
      const result = await this.makeRequest(endpoint, data, options);
      return this.normalizeEmbeddingResult(result, model, inputs);
    } catch (error) {
      throw new Error(`Embedding generation failed: ${error.message}`);
    }
  }

  /**
   * Model Health Check
   */
  async checkModelHealth(model) {
    try {
      const endpoint = `/models/${model}`;
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      return {
        model,
        status: response.ok ? 'healthy' : 'unhealthy',
        status_code: response.status,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        model,
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Batch Processing
   */
  async processBatch(requests, options = {}) {
    const batchSize = options.batchSize || 5;
    const delay = options.delay || 1000; // 1 second delay between batches
    const results = [];

    for (let i = 0; i < requests.length; i += batchSize) {
      const batch = requests.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (request) => {
        try {
          const result = await this[request.method](...request.args);
          return { success: true, result, request };
        } catch (error) {
          return { success: false, error: error.message, request };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Add delay between batches to avoid rate limiting
      if (i + batchSize < requests.length) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    return results;
  }

  /**
   * Result normalization functions
   */
  normalizeSentimentResult(result, model) {
    let sentimentData;
    
    if (Array.isArray(result) && result.length > 0) {
      sentimentData = result[0];
    } else if (result.label && result.score) {
      sentimentData = result;
    } else {
      throw new Error('Unexpected sentiment analysis result format');
    }

    return {
      label: this.normalizeSentimentLabel(sentimentData.label),
      score: sentimentData.score,
      confidence: sentimentData.score,
      raw_result: sentimentData,
      model_used: model,
      timestamp: new Date().toISOString()
    };
  }

  normalizeClassificationResult(result, model) {
    return {
      labels: result.labels || [],
      scores: result.scores || [],
      predictions: (result.labels || []).map((label, index) => ({
        label,
        score: (result.scores || [])[index] || 0
      })),
      model_used: model,
      timestamp: new Date().toISOString()
    };
  }

  normalizeSimilarityResult(result, model, sourceText, targetTexts) {
    const similarities = Array.isArray(result) ? result : [result];
    const targets = Array.isArray(targetTexts) ? targetTexts : [targetTexts];
    
    return {
      source_text: sourceText,
      similarities: similarities.map((score, index) => ({
        target_text: targets[index] || '',
        similarity_score: score,
        similarity_percentage: Math.round(score * 100)
      })),
      model_used: model,
      timestamp: new Date().toISOString()
    };
  }

  normalizeGenerationResult(result, model, prompt) {
    const generations = Array.isArray(result) ? result : [result];
    
    return {
      prompt,
      generated_texts: generations.map(gen => gen.generated_text || gen),
      model_used: model,
      timestamp: new Date().toISOString()
    };
  }

  normalizeQAResult(result, model, question, context) {
    return {
      question,
      context,
      answer: result.answer || '',
      confidence: result.score || 0,
      start_position: result.start || 0,
      end_position: result.end || 0,
      model_used: model,
      timestamp: new Date().toISOString()
    };
  }

  normalizeNERResult(result, model, text) {
    const entities = Array.isArray(result) ? result : [];
    
    return {
      text,
      entities: entities.map(entity => ({
        entity: entity.entity_group || entity.entity,
        word: entity.word,
        confidence: entity.score,
        start: entity.start,
        end: entity.end
      })),
      model_used: model,
      timestamp: new Date().toISOString()
    };
  }

  normalizeSummarizationResult(result, model, originalText) {
    const summaries = Array.isArray(result) ? result : [result];
    
    return {
      original_text: originalText,
      original_length: originalText.length,
      summaries: summaries.map(summary => summary.summary_text || summary),
      summary_length: summaries[0] ? (summaries[0].summary_text || summaries[0]).length : 0,
      compression_ratio: originalText.length > 0 ? 
        (summaries[0] ? (summaries[0].summary_text || summaries[0]).length / originalText.length : 0) : 0,
      model_used: model,
      timestamp: new Date().toISOString()
    };
  }

  normalizeLanguageDetectionResult(result, model, text) {
    const predictions = Array.isArray(result) ? result : [result];
    
    return {
      text,
      detected_language: predictions[0]?.label || 'unknown',
      confidence: predictions[0]?.score || 0,
      all_predictions: predictions.map(pred => ({
        language: pred.label,
        confidence: pred.score
      })),
      model_used: model,
      timestamp: new Date().toISOString()
    };
  }

  normalizeEmbeddingResult(result, model, texts) {
    return {
      texts,
      embeddings: result,
      embedding_dimension: Array.isArray(result[0]) ? result[0].length : 0,
      model_used: model,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Utility functions
   */
  normalizeSentimentLabel(label) {
    const labelLower = label.toLowerCase();
    
    if (labelLower.includes('pos') || labelLower === 'positive') {
      return 'positive';
    } else if (labelLower.includes('neg') || labelLower === 'negative') {
      return 'negative';
    } else if (labelLower.includes('neu') || labelLower === 'neutral') {
      return 'neutral';
    }
    
    return label; // Return original if no match
  }

  /**
   * Get available models for different tasks
   */
  getRecommendedModels() {
    return {
      sentiment_analysis: [
        'cardiffnlp/twitter-roberta-base-sentiment-latest',
        'nlptown/bert-base-multilingual-uncased-sentiment',
        'cardiffnlp/twitter-roberta-base-sentiment'
      ],
      text_classification: [
        'facebook/bart-large-mnli',
        'microsoft/DialoGPT-medium',
        'distilbert-base-uncased-finetuned-sst-2-english'
      ],
      similarity: [
        'sentence-transformers/all-MiniLM-L6-v2',
        'sentence-transformers/all-mpnet-base-v2',
        'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2'
      ],
      text_generation: [
        'gpt2',
        'microsoft/DialoGPT-medium',
        'facebook/blenderbot-400M-distill'
      ],
      question_answering: [
        'deepset/roberta-base-squad2',
        'distilbert-base-cased-distilled-squad',
        'bert-large-uncased-whole-word-masking-finetuned-squad'
      ],
      ner: [
        'dbmdz/bert-large-cased-finetuned-conll03-english',
        'dslim/bert-base-NER',
        'Jean-Baptiste/roberta-large-ner-english'
      ],
      summarization: [
        'facebook/bart-large-cnn',
        'sshleifer/distilbart-cnn-12-6',
        'google/pegasus-xsum'
      ],
      language_detection: [
        'papluca/xlm-roberta-base-language-detection',
        'facebook/fasttext-language-identification'
      ]
    };
  }

  /**
   * Validate API key
   */
  async validateApiKey() {
    if (!this.apiKey) {
      throw new Error('Hugging Face API key is not configured');
    }

    try {
      // Test with a simple model
      const result = await this.checkModelHealth('gpt2');
      return result.status === 'healthy';
    } catch (error) {
      console.error('API key validation failed:', error);
      return false;
    }
  }

  /**
   * Get API usage statistics (if available)
   */
  async getUsageStats() {
    // This would require additional API endpoints from Hugging Face
    // For now, return placeholder data
    return {
      requests_today: 0,
      requests_this_month: 0,
      rate_limit_remaining: 1000,
      rate_limit_reset: new Date(Date.now() + 3600000).toISOString()
    };
  }
}

// Export singleton instance
const hfUtils = new HuggingFaceUtils();

module.exports = {
  HuggingFaceUtils,
  hfUtils
};

