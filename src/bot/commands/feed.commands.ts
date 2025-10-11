import { database } from '../../database/database.service.js';
import { FeedService } from '../../services/feed.service.js';
import { UrlNormalizer } from '../../utils/url-normalizer.js';
import {
  BaseCommandHandler,
  type CommandContext,
  type CommandHandler,
  CommandSchemas,
} from '../handlers/command.handler.js';

/**
 * Add feed command handler
 */
export class AddFeedCommand extends BaseCommandHandler {
  private feedService: FeedService;

  constructor() {
    super();
    this.feedService = new FeedService(database.client);
  }

  static create(): CommandHandler {
    const instance = new AddFeedCommand();
    return {
      name: 'add',
      aliases: ['adicionar'],
      description: 'Add a new RSS feed',
      schema: CommandSchemas.nameAndUrl,
      handler: instance.validateAndExecute.bind(instance),
    };
  }

  protected async execute(ctx: CommandContext, args: [string, string]): Promise<void> {
    const [name, url] = args;

    // Normalize URL first
    let normalizedUrl: string;
    try {
      normalizedUrl = UrlNormalizer.normalizeUrl(url);
    } catch (error) {
      await ctx.reply('❌ **URL inválida:** Por favor, forneça uma URL válida.\n\n**Exemplos:**\n• `pablo.space`\n• `www.pablo.space`\n• `https://pablo.space`', { parse_mode: 'Markdown' });
      return;
    }

    // Auto-fix Reddit URLs by adding .rss if missing
    const fixedUrl = this.fixRedditUrl(normalizedUrl);

    await ctx.reply(ctx.t('status.processing'));

    const result = await this.feedService.addFeed({
      chatId: ctx.chatIdString,
      name,
      url: fixedUrl,
    });

    if (result.success) {
      let message = `✅ **Feed adicionado com sucesso!**\n\n📝 **Nome:** ${name}`;
      
      // Add discovery/conversion info if available
      if (result.conversionInfo) {
        const { originalUrl, rssUrl, platform } = result.conversionInfo;
        
        if (platform?.startsWith('discovered-')) {
          message += `\n🔍 **Descoberta automática:** Encontrei feeds em ${originalUrl}`;
          message += `\n🔗 **Feed usado:** ${rssUrl}`;
          message += `\n📊 **Fonte:** ${platform.replace('discovered-', '')}`;
        } else if (platform) {
          message += `\n🔄 **Conversão:** ${originalUrl} → ${rssUrl}`;
          message += `\n🏷️ **Plataforma:** ${platform}`;
        }
      }
      
      message += `\n\n🎯 O feed será verificado automaticamente a cada 10 minutos.`;
      
      await ctx.reply(message, { parse_mode: 'Markdown' });
    } else {
      if (result.errors) {
        const errorMessages = result.errors.map(error => `• ${error.message}`).join('\n');
        await ctx.reply(`❌ **Falha ao adicionar feed:**\n${errorMessages}`, { parse_mode: 'Markdown' });
      } else {
        await ctx.reply(ctx.t('error.internal'));
      }
    }
  }

  private fixRedditUrl(url: string): string {
    // Auto-fix Reddit URLs by adding .rss if missing
    if (url.includes('reddit.com/r/') && !url.includes('.rss')) {
      return url.endsWith('/') ? url + '.rss' : url + '/.rss';
    }
    return url;
  }
}

/**
 * List feeds command handler
 */
export class ListFeedsCommand extends BaseCommandHandler {
  private feedService: FeedService;

  constructor() {
    super();
    this.feedService = new FeedService(database.client);
  }

  static create(): CommandHandler {
    const instance = new ListFeedsCommand();
    return {
      name: 'list',
      aliases: ['listar'],
      description: 'List all RSS feeds',
      schema: CommandSchemas.noArgs,
      handler: instance.validateAndExecute.bind(instance),
    };
  }

  protected async execute(ctx: CommandContext): Promise<void> {
    const feeds = await this.feedService.listFeeds(ctx.chatIdString);

    if (feeds.length === 0) {
      await ctx.reply(ctx.t('feed.empty'));
      return;
    }

    const feedList = feeds
      .map((feed, index) => {
        const status = feed.enabled ? '✅' : '❌';
        return `${index + 1}. ${status} **${feed.name}**\n   🔗 ${feed.url}`;
      })
      .join('\n\n');

    await ctx.reply(`📋 **Your RSS Feeds (${feeds.length}):**\n\n${feedList}`, {
      parse_mode: 'Markdown',
    });
  }
}

/**
 * Remove feed command handler
 */
export class RemoveFeedCommand extends BaseCommandHandler {
  private feedService: FeedService;

  constructor() {
    super();
    this.feedService = new FeedService(database.client);
  }

  static create(): CommandHandler {
    const instance = new RemoveFeedCommand();
    return {
      name: 'remove',
      aliases: ['remover'],
      description: 'Remove an RSS feed',
      schema: CommandSchemas.singleString,
      handler: instance.validateAndExecute.bind(instance),
    };
  }

  protected async execute(ctx: CommandContext, args: [string]): Promise<void> {
    const [name] = args;

    const result = await this.feedService.removeFeed(ctx.chatIdString, name);

    if (result.success) {
      await ctx.reply(ctx.t('feed.removed', { name }));
    } else {
      if (result.message === 'Feed not found') {
        await ctx.reply(ctx.t('feed.not_found', { name }));
      } else {
        await ctx.reply(ctx.t('error.internal'));
      }
    }
  }
}

/**
 * Enable feed command handler
 */
export class EnableFeedCommand extends BaseCommandHandler {
  private feedService: FeedService;

  constructor() {
    super();
    this.feedService = new FeedService(database.client);
  }

  static create(): CommandHandler {
    const instance = new EnableFeedCommand();
    return {
      name: 'enable',
      aliases: ['ativar'],
      description: 'Enable an RSS feed',
      schema: CommandSchemas.singleString,
      handler: instance.validateAndExecute.bind(instance),
    };
  }

  protected async execute(ctx: CommandContext, args: [string]): Promise<void> {
    const [name] = args;

    const result = await this.feedService.enableFeed(ctx.chatIdString, name);

    if (result.success) {
      await ctx.reply(ctx.t('feed.enabled', { name }));
    } else {
      if (result.message === 'Feed not found') {
        await ctx.reply(ctx.t('feed.not_found', { name }));
      } else if (result.message === 'Feed is already enabled') {
        await ctx.reply(ctx.t('feed.already_enabled', { name }));
      } else {
        await ctx.reply(ctx.t('error.internal'));
      }
    }
  }
}

/**
 * Disable feed command handler
 */
export class DisableFeedCommand extends BaseCommandHandler {
  private feedService: FeedService;

  constructor() {
    super();
    this.feedService = new FeedService(database.client);
  }

  static create(): CommandHandler {
    const instance = new DisableFeedCommand();
    return {
      name: 'disable',
      aliases: ['desativar'],
      description: 'Disable an RSS feed',
      schema: CommandSchemas.singleString,
      handler: instance.validateAndExecute.bind(instance),
    };
  }

  protected async execute(ctx: CommandContext, args: [string]): Promise<void> {
    const [name] = args;

    const result = await this.feedService.disableFeed(ctx.chatIdString, name);

    if (result.success) {
      await ctx.reply(ctx.t('feed.disabled', { name }));
    } else {
      if (result.message === 'Feed not found') {
        await ctx.reply(ctx.t('feed.not_found', { name }));
      } else if (result.message === 'Feed is already disabled') {
        await ctx.reply(ctx.t('feed.already_disabled', { name }));
      } else {
        await ctx.reply(ctx.t('error.internal'));
      }
    }
  }
}

/**
 * Discover feeds command handler
 */
export class DiscoverFeedsCommand extends BaseCommandHandler {
  private feedService: FeedService;

  constructor() {
    super();
    this.feedService = new FeedService(database.client);
  }

  static create(): CommandHandler {
    const instance = new DiscoverFeedsCommand();
    return {
      name: 'discover',
      aliases: ['descobrir', 'find'],
      description: 'Discover available feeds from a website',
      schema: CommandSchemas.singleString,
      handler: instance.validateAndExecute.bind(instance),
    };
  }

  protected async execute(ctx: CommandContext, args: string[]): Promise<void> {
    const [websiteUrl] = args;

    if (!websiteUrl) {
      await ctx.reply('❌ Please provide a website URL to discover feeds from.\n\n**Usage:** `/discover pablo.space` or `/discover https://pablo.space`');
      return;
    }

    // Normalize URL first
    let normalizedUrl: string;
    try {
      normalizedUrl = UrlNormalizer.normalizeUrl(websiteUrl);
    } catch (error) {
      await ctx.reply('❌ **URL inválida:** Por favor, forneça uma URL válida.\n\n**Exemplos:**\n• `pablo.space`\n• `www.pablo.space`\n• `https://pablo.space`', { parse_mode: 'Markdown' });
      return;
    }

    try {
      await ctx.reply('🔍 Discovering feeds... This may take a moment.');

      const result = await this.feedService.discoverFeeds(normalizedUrl);

      if (!result.success) {
        await ctx.reply(`❌ Failed to discover feeds from ${normalizedUrl}\n\n**Errors:**\n${result.errors.join('\n')}`);
        return;
      }

      if (result.feeds.length === 0) {
        await ctx.reply(`❌ No feeds found on ${normalizedUrl}\n\nTry checking if the website has RSS/Atom feeds available.`);
        return;
      }

      // Format the results - simplified
      const feedList = result.feeds.map((feed, index) => {
        const typeEmoji = feed.type === 'atom-1.0' ? '⚛️' : feed.type === 'rss-2.0' ? '📡' : '📄';
        
        return `${index + 1}. ${typeEmoji} **${feed.type.toUpperCase()}**\n` +
               `   🔗 ${feed.url}` +
               (feed.title ? `\n   📝 ${feed.title}` : '');
      }).join('\n\n');

      const message = `🎉 **Found ${result.feeds.length} feeds on ${normalizedUrl}:**\n\n${feedList}\n\n💡 **To add a feed, use:**\n\`/add feedname ${result.feeds[0]?.url || ''}\``;

      await ctx.reply(message, { parse_mode: 'Markdown' });

    } catch (error) {
      await ctx.reply('❌ An error occurred while discovering feeds. Please try again.');
    }
  }
}