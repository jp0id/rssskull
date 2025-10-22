import type { FeedFilter as PrismaFeedFilter } from '@prisma/client';
import Parser from 'rss-parser';

import { filterService } from '../utils/filters/filter.service.js';
import { logger } from '../utils/logger/logger.service.js';
import { rateLimiterService } from '../utils/rate-limiter.service.js';
import { userAgentService } from '../utils/user-agent.service.js';
import { cacheService } from '../utils/cache.service.js';
import { circuitBreakerService } from '../utils/circuit-breaker.service.js';
import { parseDate } from '../utils/date-parser.js';
import { FeedTypeDetector, FeedType } from '../utils/feed-type-detector.js';
import { JsonFeedParser } from '../utils/json-feed-parser.js';

export interface RSSItem {
  id: string;
  title: string;
  link: string;
  description?: string;
  pubDate?: Date;
  author?: string;
  categories?: string[];
  guid?: string;
}

export interface RSSFeed {
  title?: string;
  description?: string;
  link?: string;
  items: RSSItem[];
  feedType?: FeedType;
  detectedFeatures?: string[];
}

export interface ParseResult {
  success: boolean;
  feed?: RSSFeed;
  error?: string;
}

export class RSSService {
  private readonly maxRetries = 3;
  private readonly baseDelay = 1000; // 1 second
  private readonly maxDelay = 30000; // 30 seconds

  constructor() {
    logger.info('RSS Service initialized');
  }

  /**
   * Fetch and parse an RSS feed with retry logic, rate limiting, and caching
   */
  async fetchFeed(url: string): Promise<ParseResult> {
    // Try alternative URLs first if the original might have issues
    const alternativeUrls = this.getAlternativeUrls(url);
    const urlsToTry = [url, ...alternativeUrls];
    
    for (const tryUrl of urlsToTry) {
      const result = await this.fetchFeedFromUrl(tryUrl);
      if (result.success) {
        return result;
      }
      // If this URL failed but it's not the original, log it but continue
      if (tryUrl !== url) {
        // Try alternative URL silently
      }
    }
    
    // If all URLs failed, return the last error
    return await this.fetchFeedFromUrl(url);
  }

  /**
   * Fetch feed from a specific URL
   */
  private async fetchFeedFromUrl(url: string): Promise<ParseResult> {
    // Check cache first
    const cachedEntry = cacheService.getEntry(url);
    if (cachedEntry) {
      // Using cached feed
      return {
        success: true,
        feed: cachedEntry.feed,
      };
    }

    // Check if URL is known to be problematic
    if (this.isProblematicUrl(url)) {
      logger.warn(`Skipping problematic URL: ${url}`);
      return {
        success: false,
        error: 'URL is known to be problematic and has been skipped',
      };
    }

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        // Fetching RSS feed

        // Check circuit breaker before making the request
        const domain = this.extractDomain(url);
        if (!(await circuitBreakerService.canExecute(domain))) {
          throw new Error(`Circuit breaker is open for ${domain}`);
        }

        // Apply rate limiting before making the request
        await rateLimiterService.waitIfNeeded(url);

        // Get realistic browser headers with User-Agent rotation
        const browserHeaders = userAgentService.getHeaders(url);
        
        // Add conditional headers if available (get fresh cache entry for this attempt)
        const currentCachedEntry = cacheService.getEntry(url);
        if (currentCachedEntry) {
          if (currentCachedEntry.etag) {
            browserHeaders['If-None-Match'] = currentCachedEntry.etag;
          }
          if (currentCachedEntry.lastModified) {
            browserHeaders['If-Modified-Since'] = currentCachedEntry.lastModified;
          }
        }
        
        // Use fetch API with connection pooling
        const response = await fetch(url, {
          headers: browserHeaders,
          signal: AbortSignal.timeout(30000), // 30 second timeout
        });

        // Check if we got a 304 Not Modified response
        if (response.status === 304) {
          // Received 304 Not Modified, using cached feed
          if (currentCachedEntry) {
            return {
              success: true,
              feed: currentCachedEntry.feed,
            };
          }
        }

        // Validate response status
        if (!response.ok) {
          // Record failure in circuit breaker
          circuitBreakerService.recordFailure(domain);
          
          // 🔥 LOG ESPECÍFICO PARA BLOQUEIOS DO REDDIT
          if (url.includes('reddit.com') && response.status === 403) {
            logger.error(`🚫 REDDIT BLOCKED - Chat: ${url} | Status: ${response.status} | Possible bot detection`);
          }
          
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Record success in circuit breaker
        circuitBreakerService.recordSuccess(domain);

        // Validate content type (support XML and JSON feeds)
        const contentType = response.headers.get('content-type') || '';
        const isXmlFeed = contentType.includes('application/atom+xml') || 
                         contentType.includes('application/rss+xml') || 
                         contentType.includes('text/xml') ||
                         contentType.includes('application/xml');
        const isJsonFeed = contentType.includes('application/json') ||
                          contentType.includes('application/feed+json');
        
        if (!isXmlFeed && !isJsonFeed) {
          logger.warn(`Unexpected content type for ${url}: ${contentType}`);
          // Don't throw error, let the content detection handle it
        }

        // Extract response headers for conditional caching
        const responseHeaders: { etag?: string; lastModified?: string } = {};
        const etag = response.headers.get('etag');
        const lastModified = response.headers.get('last-modified');
        
        if (etag) {
          responseHeaders.etag = etag;
        }
        if (lastModified) {
          responseHeaders.lastModified = lastModified;
        }

        // Parse the response text with rss-parser
        const responseText = await response.text();
        
        // Check if response is HTML (likely an error page)
        if (responseText.trim().startsWith('<!DOCTYPE html') || 
            responseText.trim().startsWith('<html')) {
          logger.warn(`Received HTML instead of XML feed for ${url}`);
          throw new Error('Received HTML page instead of XML feed. Possible redirect or error page.');
        }

        // Detect feed type and parse accordingly
        const feedTypeInfo = FeedTypeDetector.detectFeedType(responseText, contentType, url);
        
        logger.info(`Detected feed type: ${FeedTypeDetector.getFeedTypeDescription(feedTypeInfo.type)} (confidence: ${feedTypeInfo.confidence}) for ${url}`);
        
        if (feedTypeInfo.features.length > 0) {
        // Feed features detected
        }
        
        if (feedTypeInfo.issues && feedTypeInfo.issues.length > 0) {
          logger.warn(`Feed issues: ${feedTypeInfo.issues.join(', ')}`);
        }

        let processedFeed: RSSFeed;

        // Parse based on detected type
        if (feedTypeInfo.type === FeedType.JSON_FEED_1_1) {
          processedFeed = JsonFeedParser.parseJsonFeed(responseText, url);
        } else {
          // Use rss-parser for RSS 2.0 and Atom 1.0
          const domainParser = new Parser({
            timeout: 10000,
            headers: browserHeaders,
          });

          const feed = await domainParser.parseString(responseText);
          processedFeed = this.processFeed(feed);
        }

        // Add feed type information
        processedFeed.feedType = feedTypeInfo.type;
        processedFeed.detectedFeatures = feedTypeInfo.features;
        
        // Cache the successful result with conditional headers
        cacheService.setWithHeaders(url, processedFeed, responseHeaders);

        // Successfully parsed RSS feed

        return {
          success: true,
          feed: processedFeed,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Check if it's a rate limiting error (429)
        if (this.isRateLimitError(lastError)) {
          logger.warn(`Rate limit hit for ${url}, increasing delay for next attempt`);
          // For rate limit errors, wait longer before retry
          if (attempt < this.maxRetries) {
            const rateLimitDelay = this.getRateLimitDelay(url, attempt);
            // Waiting due to rate limiting
            await this.sleep(rateLimitDelay);
          }
        } else {
          logger.warn(`RSS fetch attempt ${attempt} failed for ${url}:`, lastError.message);
          
          // Don't retry on certain errors
          if (this.isNonRetryableError(lastError)) {
            // Only record failure in circuit breaker for non-retryable errors
            circuitBreakerService.recordFailure(this.extractDomain(url));
            break;
          }

          // Wait before retrying (exponential backoff)
          if (attempt < this.maxRetries) {
            const delay = Math.min(this.baseDelay * 2 ** (attempt - 1), this.maxDelay);
            // Waiting before retry
            await this.sleep(delay);
          }
        }
      }
    }

    const errorMessage = lastError?.message || 'Unknown error occurred';
    logger.error(
      `Failed to fetch RSS feed after ${this.maxRetries} attempts: ${url} - ${errorMessage}`
    );

    // Only record failure in circuit breaker after all retries failed
    // and it's not a non-retryable error (which was already recorded)
    if (!this.isNonRetryableError(lastError!)) {
      circuitBreakerService.recordFailure(this.extractDomain(url));
    }

    return {
      success: false,
      error: errorMessage,
    };
  }

  /**
   * Get new items from a feed based on the last known item ID
   */
  async getNewItems(url: string, lastItemId?: string, forceProcessAll = false): Promise<{items: RSSItem[], totalItemsCount: number}> {
    const result = await this.fetchFeed(url);

    if (!result.success || !result.feed) {
      return { items: [], totalItemsCount: 0 };
    }

    const items = result.feed.items;
    const totalItemsCount = items.length;

    // If no last item ID, this is the first time processing this feed
    // Return only items from bot startup time onwards to avoid processing old posts
    if (!lastItemId) {
      logger.info(`No lastItemId for ${url}, forceProcessAll: ${forceProcessAll}, BOT_STARTUP_TIME: ${process.env.BOT_STARTUP_TIME}`);
      
      if (forceProcessAll) {
        // When force processing, only process items from bot startup to now
        // This ensures we only catch items the bot missed while online
        const botStartupTime = process.env.BOT_STARTUP_TIME ? new Date(process.env.BOT_STARTUP_TIME) : new Date();
        const now = new Date();
        
        const missedItems = items.filter(item => {
          if (!item.pubDate) return false;
          // Only items published between bot startup and now
          return item.pubDate >= botStartupTime && item.pubDate <= now;
        });
        
        logger.info(`Force processing missed items for ${url}, returning ${missedItems.length} items from ${botStartupTime.toISOString()} to ${now.toISOString()} out of ${items.length} total`);
        return { items: missedItems, totalItemsCount };
      }
      
      // First time processing this feed - return only items from bot startup onwards
      // This prevents processing old posts when bot is restarted
      const botStartupTime = process.env.BOT_STARTUP_TIME ? new Date(process.env.BOT_STARTUP_TIME) : new Date();
      
      logger.info(`First time processing ${url}, filtering items from bot startup onwards (${botStartupTime.toISOString()})`);
      
      const newItems = items.filter(item => {
        if (!item.pubDate) return false;
        const isFromStartup = item.pubDate >= botStartupTime;
        // Item from startup period
        return isFromStartup;
      });
      
      logger.info(`First time processing ${url}, returning ${newItems.length} items from startup onwards out of ${items.length} total`);
      
      // Log first few items for debugging
      if (newItems.length > 0) {
        logger.info(`🔍 DEBUG: First 3 new items: ${newItems.slice(0, 3).map(item => item.id).join(', ')}`);
        logger.info(`🔍 DEBUG: Latest new item: ${newItems[0]?.id} - ${newItems[0]?.title}`);
      } else {
        logger.info(`🔍 DEBUG: No new items found since bot startup`);
      }
      
      return { items: newItems, totalItemsCount };
    }

    // Find the index of the last known item
    const lastItemIndex = items.findIndex((item) => item.id === lastItemId);

    // 🔍 DEBUG: Log first few items to understand the issue
    logger.info(`🔍 DEBUG: Feed ${url} - Looking for lastItemId: ${lastItemId}`);
    logger.info(`🔍 DEBUG: First 3 items in feed: ${items.slice(0, 3).map(item => item.id).join(', ')}`);

    if (lastItemIndex === -1) {
      // Last item not found, might be too old or feed changed
      // Check if there are newer items by comparing timestamps
      logger.warn(`Last item ID ${lastItemId} not found in feed ${url}`);
      
      // For Reddit, use more intelligent strategy
      if (url.includes('reddit.com')) {
        logger.info(`🔍 REDDIT DEBUG: lastItemId not found, using intelligent fallback for ${url}`);
        
        // Try to find items with timestamps newer than a reasonable threshold
        // For Reddit, assume items older than 1 hour are not "new"
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const recentItems = items.filter(item => {
          if (!item.pubDate) return false;
          return item.pubDate > oneHourAgo;
        });
        
        if (recentItems.length > 0) {
          logger.info(`🔍 REDDIT DEBUG: Found ${recentItems.length} items from last hour, returning those`);
          return { items: recentItems, totalItemsCount };
        }
        
        // If no recent items, return only the 3 most recent to avoid spam
        const safeItems = items.slice(0, Math.min(3, items.length));
        logger.info(`🔍 REDDIT DEBUG: No recent items, returning ${safeItems.length} most recent items`);
        return { items: safeItems, totalItemsCount };
      }
      
      // For non-Reddit feeds, use original logic
      const potentiallyNewItems = items.filter(() => {
        // If we can't find the exact ID, assume items at the top are newer
        // This handles cases where feeds change item IDs or remove old items
        return true; // For now, return all items to be safe
      });
      
      // Return only the most recent items to avoid spam
      const safeItems = potentiallyNewItems.slice(0, Math.min(5, potentiallyNewItems.length));
      
      logger.info(`🔍 DEBUG: Feed ${url} - lastItemId not found, returning ${safeItems.length} most recent items`);
      logger.info(`🔍 DEBUG: Returning items: ${safeItems.map(item => item.id).join(', ')}`);
      
      return { items: safeItems, totalItemsCount };
    }

    // Return only new items (items before the last known item in the array)
    const newItems = items.slice(0, lastItemIndex);
    logger.info(`🔍 DEBUG: Found ${newItems.length} new items in feed ${url} (lastItemIndex: ${lastItemIndex})`);
    logger.info(`🔍 DEBUG: New items IDs: ${newItems.map(item => item.id).join(', ')}`);

    // If lastItemIndex is 0, it means the lastItemId is the most recent item
    // Check if there are actually newer items by comparing timestamps
    if (lastItemIndex === 0 && items.length > 0) {
      const lastKnownItem = items[0];
      if (!lastKnownItem) return { items: newItems, totalItemsCount };
      
      const lastKnownTime = lastKnownItem.pubDate;
      
      // Check if there are items with more recent timestamps
      const potentiallyNewItems = items.filter(item => {
        if (!item.pubDate || !lastKnownTime) return false;
        return item.pubDate > lastKnownTime;
      });
      
      if (potentiallyNewItems.length > 0) {
        logger.info(`🔍 DEBUG: Found ${potentiallyNewItems.length} items with newer timestamps`);
        return { items: potentiallyNewItems, totalItemsCount };
      } else {
        logger.info(`🔍 DEBUG: No items with newer timestamps found`);
      }
    }

    return { items: newItems, totalItemsCount };
  }

  /**
   * Get new items from a feed and apply filters
   */
  async getNewItemsWithFilters(
    url: string,
    filters: PrismaFeedFilter[],
    lastItemId?: string
  ): Promise<RSSItem[]> {
    const result = await this.getNewItems(url, lastItemId);
    const newItems = result.items;

    if (newItems.length === 0 || filters.length === 0) {
      return newItems;
    }

    // Convert Prisma FeedFilter to our filter type
    const filterObjects = filters.map((f) => ({
      id: f.id,
      feedId: f.feedId,
      type: f.type as 'include' | 'exclude',
      pattern: f.pattern,
      isRegex: f.isRegex,
    }));

    // Applying filters to new items
    const filteredItems = filterService.applyFilters(newItems, filterObjects);

    return filteredItems;
  }

  /**
   * Validate if a URL is a valid RSS feed
   */
  async validateFeedUrl(url: string): Promise<boolean> {
    try {
      const result = await this.fetchFeed(url);
      return result.success;
    } catch {
      return false;
    }
  }

  /**
   * Process raw feed data into our standardized format
   * Handles both RSS 2.0 and Atom 1.0 formats
   */
  private processFeed(rawFeed: any): RSSFeed {
    const items: RSSItem[] = (rawFeed.items || []).map((item: any) => {
      // Generate a unique ID for the item
      const id = this.generateItemId(item);

      // Extract original link from Reddit posts
      const originalLink = this.extractOriginalLink(item);

      // Handle Atom 1.0 vs RSS 2.0 date fields
      const pubDate = this.extractItemDate(item);

      // Handle Atom 1.0 vs RSS 2.0 author fields
      const author = this.extractItemAuthor(item);

      // Handle Atom 1.0 vs RSS 2.0 content fields
      const description = this.extractItemContent(item);

      return {
        id,
        title: this.sanitizeText(item.title || 'Untitled'),
        link: originalLink || item.link || '',
        description: description,
        pubDate: pubDate,
        author: author,
        categories: item.categories || [],
        guid: item.guid || item.id,
      };
    });

    return {
      title: this.sanitizeText(rawFeed.title || ''),
      description: this.sanitizeText(rawFeed.description || rawFeed.subtitle || ''),
      link: rawFeed.link || '',
      items,
    };
  }

  /**
   * Extract date from item, handling both Atom 1.0 and RSS 2.0 formats
   */
  private extractItemDate(item: any): Date | undefined {
    // Atom 1.0: <updated> or <published> (ISO 8601)
    // RSS 2.0: <pubDate> (RFC 2822)
    const dateFields = [
      item.isoDate,        // rss-parser normalized field
      item.updated,        // Atom 1.0 <updated>
      item.published,       // Atom 1.0 <published>
      item.pubDate,        // RSS 2.0 <pubDate>
    ];

    for (const dateField of dateFields) {
      if (dateField) {
        const parsedDate = parseDate(dateField);
        if (parsedDate) {
          return parsedDate;
        }
      }
    }

    return undefined;
  }

  /**
   * Extract author from item, handling both Atom 1.0 and RSS 2.0 formats
   */
  private extractItemAuthor(item: any): string {
    // Atom 1.0: <author><name> or <author><email>
    // RSS 2.0: <author> (email format) or <dc:creator>
    if (item.author && typeof item.author === 'object') {
      // Atom 1.0 author object
      return this.sanitizeText(item.author.name || item.author.email || '');
    } else if (item.creator) {
      // RSS 2.0 dc:creator
      return this.sanitizeText(item.creator);
    } else if (item.author) {
      // RSS 2.0 author or Atom 1.0 author as string
      return this.sanitizeText(item.author);
    }

    return '';
  }

  /**
   * Extract content from item, handling both Atom 1.0 and RSS 2.0 formats
   */
  private extractItemContent(item: any): string {
    // Atom 1.0: <content> or <summary>
    // RSS 2.0: <description> or <content:encoded>
    const contentFields = [
      item.content,         // Atom 1.0 <content>
      item.summary,         // Atom 1.0 <summary>
      item.contentSnippet, // rss-parser processed content
      item.description,     // RSS 2.0 <description>
    ];

    for (const contentField of contentFields) {
      if (contentField && typeof contentField === 'string' && contentField.trim()) {
        return this.extractRedditContent({ ...item, content: contentField });
      }
    }

    return '';
  }


  /**
   * Extract enhanced content from Reddit posts
   */
  private extractRedditContent(item: any): string {
    const link = item.link || '';
    
    // If not a Reddit post, use standard extraction
    if (!link.includes('reddit.com')) {
      return this.sanitizeText(item.contentSnippet || item.content || item.summary || '');
    }

    // Extract Reddit-specific content
    const content = item.content || item.contentSnippet || item.summary || '';
    let extractedContent = '';

    // Extract text content (remove HTML tags and decode entities)
    const textContent = content
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#32;/g, ' ') // Space entity
      .replace(/&#160;/g, ' ') // Non-breaking space
      .replace(/&#8217;/g, "'") // Right single quotation mark
      .replace(/&#8216;/g, "'") // Left single quotation mark
      .replace(/&#8220;/g, '"') // Left double quotation mark
      .replace(/&#8221;/g, '"') // Right double quotation mark
      .replace(/&#8211;/g, '–') // En dash
      .replace(/&#8212;/g, '—') // Em dash
      .replace(/&#8230;/g, '…') // Horizontal ellipsis
      .replace(/&hellip;/g, '…') // Horizontal ellipsis
      .replace(/&mdash;/g, '—') // Em dash
      .replace(/&ndash;/g, '–') // En dash
      .replace(/\s+/g, ' ') // Normalize multiple spaces
      .trim();

    // Extract images from Reddit content
    const imageRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]*\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s<>"{}|\\^`\[\]]*)?/gi;
    const images = content.match(imageRegex) || [];
    
    // Extract videos from Reddit content
    const videoRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]*\.(?:mp4|webm|mov|avi)(?:\?[^\s<>"{}|\\^`\[\]]*)?/gi;
    const videos = content.match(videoRegex) || [];

    // Build enhanced content
    if (textContent && textContent.length > 10) {
      // Clean up Reddit-specific formatting
      let cleanContent = textContent
        .replace(/submitted by\s+\/u\/\w+\s+\[link\]\s+\[comments\]/gi, '') // Remove Reddit footer
        .replace(/submitted by\s+\/u\/\w+/gi, '') // Remove author info
        .replace(/\[link\]\s*\[comments\]/gi, '') // Remove link/comments
        .replace(/\s+/g, ' ') // Normalize spaces
        .trim();
      
      if (cleanContent && cleanContent.length > 5) {
        extractedContent += cleanContent;
      }
    }

    // Add images
    if (images.length > 0) {
      if (extractedContent) extractedContent += '\n\n';
      extractedContent += '🖼️ **Imagens:**\n';
      images.slice(0, 3).forEach((img: string) => {
        extractedContent += `• ${img}\n`;
      });
    }

    // Add videos
    if (videos.length > 0) {
      if (extractedContent) extractedContent += '\n\n';
      extractedContent += '🎥 **Vídeos:**\n';
      videos.slice(0, 2).forEach((video: string) => {
        extractedContent += `• ${video}\n`;
      });
    }

    return this.sanitizeText(extractedContent);
  }

  /**
   * Extract original link from Reddit posts
   */
  private extractOriginalLink(item: any): string | null {
    // Check if this is a Reddit post
    const link = item.link || '';
    if (!link.includes('reddit.com')) {
      return null; // Not a Reddit post
    }

    // Try to extract original link from content
    const content = item.content || item.contentSnippet || item.summary || '';
    
    // Look for URLs in the content
    const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;
    const urls = content.match(urlRegex);
    
    if (urls && urls.length > 0) {
      // Filter out Reddit URLs and return the first external URL
      const externalUrls = urls.filter((url: string) => 
        !url.includes('reddit.com') && 
        !url.includes('redd.it') &&
        !url.includes('i.redd.it') &&
        !url.includes('v.redd.it')
      );
      
      if (externalUrls.length > 0) {
        return externalUrls[0];
      }
    }

    return null;
  }

  /**
   * Generate a unique ID for an RSS item
   */
  private generateItemId(item: any): string {
    // For Reddit posts, extract the post ID from the link with multiple patterns
    if (item.link && item.link.includes('reddit.com')) {
      // Try multiple patterns for Reddit post IDs
      const patterns = [
        /\/comments\/([a-zA-Z0-9]+)/, // Standard pattern: /comments/abc123
        /\/r\/\w+\/comments\/([a-zA-Z0-9]+)/, // With subreddit: /r/programming/comments/abc123
        /\/user\/\w+\/comments\/([a-zA-Z0-9]+)/, // User posts: /user/username/comments/abc123
        /\/u\/\w+\/comments\/([a-zA-Z0-9]+)/, // Short user: /u/username/comments/abc123
      ];
      
      for (const pattern of patterns) {
        const match = item.link.match(pattern);
        if (match) {
          return `reddit_${match[1]}`;
        }
      }
      
      // If no pattern matches, try to extract from GUID
      if (item.guid) {
        // Reddit GUIDs often contain the post ID
        const guidMatch = item.guid.match(/([a-zA-Z0-9]+)$/);
        if (guidMatch) {
          return `reddit_guid_${guidMatch[1]}`;
        }
        return `reddit_guid_${item.guid}`;
      }
      
      // Fallback: use link hash for Reddit
      return `reddit_link_${this.hashString(item.link)}`;
    }

    // Try to use GUID first, then link, then title + pubDate
    if (item.guid) {
      return String(item.guid);
    }

    if (item.link) {
      return String(item.link);
    }

    // Fallback: create hash from title and pubDate
    const title = item.title || 'untitled';
    const pubDate = item.pubDate || new Date().toISOString();
    return `${title}-${pubDate}`.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
  }

  /**
   * Simple hash function for generating consistent IDs
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }


  /**
   * Sanitize text content for Telegram
   */
  private sanitizeText(text: string): string {
    if (!text) return '';

    return text
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/&nbsp;/g, ' ') // Replace &nbsp; with space
      .replace(/&amp;/g, '&') // Replace &amp; with &
      .replace(/&lt;/g, '<') // Replace &lt; with <
      .replace(/&gt;/g, '>') // Replace &gt; with >
      .replace(/&quot;/g, '"') // Replace &quot; with "
      .replace(/&#39;/g, "'") // Replace &#39; with '
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .replace(/\n\s*\n/g, '\n') // Remove empty lines
      .trim();
  }

  /**
   * Check if an error should not be retried
   */
  private isNonRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();

    // Don't retry on these types of errors
    const nonRetryablePatterns = [
      'not found', // 404 errors
      'unauthorized', // 401 errors
      'forbidden', // 403 errors
      'invalid url',
      'invalid feed',
      'parse error',
      // Removido 'timeout' - agora tratamos timeouts como retryable
      // Removido 'request timed out' - agora tratamos timeouts como retryable
    ];

    return nonRetryablePatterns.some((pattern) => message.includes(pattern));
  }

  /**
   * Check if an error is a rate limiting error
   */
  private isRateLimitError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return message.includes('status code 429') || 
           message.includes('too many requests') ||
           message.includes('rate limit');
  }

  /**
   * Get appropriate delay for rate limiting errors
   */
  private getRateLimitDelay(url: string, attempt: number): number {
    const domain = this.extractDomain(url);
    
    // Special handling for Reddit
    if (domain.includes('reddit.com')) {
      // Progressive delays for Reddit: 5s, 15s, 30s
      const redditDelays = [5000, 15000, 30000];
      const delayIndex = Math.min(attempt - 1, redditDelays.length - 1);
      return redditDelays[delayIndex] || 30000; // Fallback to 30s
    }
    
    // Default rate limit delay with exponential backoff
    return Math.min(5000 * 2 ** (attempt - 1), 60000); // Max 1 minute
  }

  /**
   * Extract domain from URL
   */
  private extractDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.toLowerCase();
    } catch {
      return 'unknown';
    }
  }

  /**
   * Check if a URL is known to be problematic
   */
  private isProblematicUrl(url: string): boolean {
    const problematicPatterns = [
      'reddit.com.br', // Known problematic domain
      'reddit.com.br/r/', // Specific pattern
    ];

    return problematicPatterns.some((pattern) => url.includes(pattern));
  }

  /**
   * Generate alternative URLs to try if the original fails
   */
  private getAlternativeUrls(originalUrl: string): string[] {
    const alternatives: string[] = [];
    
    try {
      const url = new URL(originalUrl);
      const hostname = url.hostname.toLowerCase();
      
      // For domains without www, try with www
      if (!hostname.startsWith('www.')) {
        const wwwUrl = new URL(originalUrl);
        wwwUrl.hostname = `www.${hostname}`;
        alternatives.push(wwwUrl.toString());
      }
      
      // For domains with www, try without www
      if (hostname.startsWith('www.')) {
        const noWwwUrl = new URL(originalUrl);
        noWwwUrl.hostname = hostname.substring(4);
        alternatives.push(noWwwUrl.toString());
      }
      
      // For Blogger feeds, try common variations
      if (hostname.includes('blogspot.com') || hostname.includes('blogger.com')) {
        // Try /feeds/posts/default if not already present
        if (!originalUrl.includes('/feeds/posts/default')) {
          const feedUrl = new URL(originalUrl);
          feedUrl.pathname = '/feeds/posts/default';
          alternatives.push(feedUrl.toString());
        }
        
        // Try /feeds/posts/default?alt=rss
        const rssUrl = new URL(originalUrl);
        rssUrl.pathname = '/feeds/posts/default';
        rssUrl.searchParams.set('alt', 'rss');
        alternatives.push(rssUrl.toString());
      }
      
      // For WordPress sites, try common feed URLs
      if (hostname.includes('wordpress.com') || hostname.includes('wp.com')) {
        const wpFeedUrl = new URL(originalUrl);
        wpFeedUrl.pathname = '/feed/';
        alternatives.push(wpFeedUrl.toString());
      }
      
    } catch (error) {
      // If URL parsing fails, don't add alternatives
      // Failed to parse URL for alternatives
    }
    
    return alternatives;
  }

  /**
   * Sleep for a given number of milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Singleton instance
export const rssService = new RSSService();
