import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RSSService } from './rss.service.js';

// Create a mock parser instance that will be reused
const mockParseURL = vi.fn();
const mockParser = {
  parseURL: mockParseURL,
};

// Mock rss-parser to return our mock parser
vi.mock('rss-parser', () => {
  return {
    default: vi.fn().mockImplementation(() => mockParser),
  };
});

// Mock rate limiter service
vi.mock('../utils/rate-limiter.service.js', () => ({
  rateLimiterService: {
    waitIfNeeded: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock user agent service
vi.mock('../utils/user-agent.service.js', () => ({
  userAgentService: {
    getHeaders: vi.fn().mockReturnValue({
      'User-Agent': 'RSS-Skull-Bot/0.01 (+https://github.com/runawaydevil/rssskull)',
      'Accept': 'application/rss+xml, application/xml, text/xml, application/atom+xml',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
    }),
  },
}));

// Mock cache service
vi.mock('../utils/cache.service.js', () => ({
  cacheService: {
    get: vi.fn().mockReturnValue(null), // Always return cache miss for tests
    set: vi.fn(),
  },
}));

// Mock logger service
vi.mock('../utils/logger/logger.service.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('RSSService', () => {
  let rssService: RSSService;

  beforeEach(() => {
    vi.clearAllMocks();
    rssService = new RSSService();
  });

  describe('fetchFeed', () => {
    it('should successfully parse a valid RSS feed', async () => {
      const mockFeedData = {
        title: 'Test Feed',
        description: 'Test Description',
        link: 'https://example.com',
        items: [
          {
            title: 'Test Item 1',
            link: 'https://example.com/item1',
            guid: 'item1',
            pubDate: '2023-01-01T00:00:00Z',
            contentSnippet: 'Test content 1',
          },
          {
            title: 'Test Item 2',
            link: 'https://example.com/item2',
            guid: 'item2',
            pubDate: '2023-01-02T00:00:00Z',
            contentSnippet: 'Test content 2',
          },
        ],
      };

      mockParseURL.mockResolvedValue(mockFeedData);

      const result = await rssService.fetchFeed('https://example.com/feed.xml');

      expect(result.success).toBe(true);
      expect(result.feed).toBeDefined();
      expect(result.feed!.title).toBe('Test Feed');
      expect(result.feed!.items).toHaveLength(2);
      expect(result.feed!.items[0].id).toBe('item1');
      expect(result.feed!.items[0].title).toBe('Test Item 1');
    });

    it('should handle parsing errors with retry logic', async () => {
      mockParseURL
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValue({
          title: 'Test Feed',
          items: [],
        });

      const result = await rssService.fetchFeed('https://example.com/feed.xml');

      expect(result.success).toBe(true);
      expect(mockParseURL).toHaveBeenCalledTimes(3);
    });

    it('should fail after max retries', async () => {
      mockParseURL.mockRejectedValue(new Error('Persistent error'));

      const result = await rssService.fetchFeed('https://example.com/feed.xml');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Persistent error');
      expect(mockParseURL).toHaveBeenCalledTimes(3);
    });

    it('should not retry on non-retryable errors', async () => {
      mockParseURL.mockRejectedValue(new Error('Not found'));

      const result = await rssService.fetchFeed('https://example.com/feed.xml');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not found');
      expect(mockParseURL).toHaveBeenCalledTimes(1);
    });
  });

  describe('getNewItems', () => {
    beforeEach(() => {
      const mockFeedData = {
        title: 'Test Feed',
        items: [
          {
            title: 'New Item',
            link: 'https://example.com/new',
            guid: 'new-item',
            pubDate: '2023-01-03T00:00:00Z',
          },
          {
            title: 'Old Item',
            link: 'https://example.com/old',
            guid: 'old-item',
            pubDate: '2023-01-01T00:00:00Z',
          },
        ],
      };

      mockParseURL.mockResolvedValue(mockFeedData);
    });

    it('should return items from bot startup onwards when no lastItemId is provided', async () => {
      // Set bot startup time to before the test items
      process.env.BOT_STARTUP_TIME = '2022-12-31T00:00:00Z';
      
      const items = await rssService.getNewItems('https://example.com/feed.xml');

      expect(items).toHaveLength(2);
      expect(items[0].id).toBe('new-item');
      expect(items[1].id).toBe('old-item');
    });

    it('should return empty array when all items are older than bot startup', async () => {
      // Set bot startup time to after all test items
      process.env.BOT_STARTUP_TIME = '2023-01-04T00:00:00Z';
      
      const items = await rssService.getNewItems('https://example.com/feed.xml');

      expect(items).toHaveLength(0);
    });

    it('should return only new items when lastItemId is provided', async () => {
      const items = await rssService.getNewItems('https://example.com/feed.xml', 'old-item');

      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('new-item');
    });

    it('should return only the most recent item when lastItemId is not found', async () => {
      const items = await rssService.getNewItems('https://example.com/feed.xml', 'non-existent');

      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('new-item');
    });

    it('should return empty array when feed fetch fails', async () => {
      mockParseURL.mockRejectedValue(new Error('Feed error'));

      const items = await rssService.getNewItems('https://example.com/feed.xml');

      expect(items).toHaveLength(0);
    });
  });

  describe('validateFeedUrl', () => {
    it('should return true for valid feed URL', async () => {
      mockParseURL.mockResolvedValue({ items: [] });

      const isValid = await rssService.validateFeedUrl('https://example.com/feed.xml');

      expect(isValid).toBe(true);
    });

    it('should return false for invalid feed URL', async () => {
      mockParseURL.mockRejectedValue(new Error('Invalid feed'));

      const isValid = await rssService.validateFeedUrl('https://example.com/invalid');

      expect(isValid).toBe(false);
    });
  });
});
