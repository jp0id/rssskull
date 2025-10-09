import { database } from '../../database/database.service.js';
import { ChatRepository } from '../../database/repositories/chat.repository.js';
import { SettingsService } from '../../services/settings.service.js';
import { TemplateService } from '../../services/template.service.js';
import { logger } from '../../utils/logger/logger.service.js';
import {
  BaseCommandHandler,
  type CommandContext,
  type CommandHandler,
  CommandSchemas,
} from '../handlers/command.handler.js';

/**
 * Settings command handler
 */
export class SettingsCommand extends BaseCommandHandler {
  private settingsService: SettingsService;

  constructor() {
    super();
    const chatRepository = new ChatRepository(database.client);
    this.settingsService = new SettingsService(chatRepository);
  }

  static create(): CommandHandler {
    const instance = new SettingsCommand();
    return {
      name: 'settings',
      aliases: ['configuracoes'],
      description: 'View and manage chat settings',
      schema: CommandSchemas.optionalArgs,
      handler: instance.validateAndExecute.bind(instance),
    };
  }

  protected async execute(ctx: CommandContext, args: string[]): Promise<void> {
    try {
      const chatId = ctx.chat?.id?.toString();
      if (!chatId) {
        await ctx.reply(ctx.t('error.internal'));
        return;
      }

      // If no arguments, show current settings
      if (args.length === 0) {
        await this.showSettings(ctx, chatId);
        return;
      }

      const [action, ...params] = args;

      if (!action) {
        await ctx.reply(ctx.t('settings.help'));
        return;
      }

      switch (action.toLowerCase()) {
        case 'help':
        case 'ajuda':
          await this.showHelp(ctx);
          break;

        case 'language':
        case 'idioma':
          await this.updateLanguage(ctx, chatId, params);
          break;

        case 'interval':
        case 'intervalo':
          await this.updateInterval(ctx, chatId, params);
          break;

        case 'template':
          await this.updateTemplate(ctx, chatId, params);
          break;

        case 'timezone':
        case 'fuso':
          await this.updateTimezone(ctx, chatId, params);
          break;

        case 'notifications':
        case 'notificacoes':
          await this.updateNotifications(ctx, chatId, params);
          break;

        case 'maxfeeds':
        case 'maxfeeds':
          await this.updateMaxFeeds(ctx, chatId, params);
          break;

        case 'reset':
        case 'resetar':
          await this.resetSettings(ctx, chatId);
          break;

        case 'export':
        case 'exportar':
          await this.exportSettings(ctx, chatId);
          break;

        default:
          await this.showHelp(ctx);
          break;
      }
    } catch (error) {
      logger.error('Settings command error', { error, chatId: ctx.chat?.id });
      await ctx.reply(ctx.t('error.internal'));
    }
  }

  private async showSettings(ctx: CommandContext, chatId: string): Promise<void> {
    try {
      const settings = await this.settingsService.getSettings(chatId);

      // Get interval description
      const intervals = this.settingsService.getAvailableIntervals();
      const intervalInfo = intervals.find((i) => i.seconds === settings.checkInterval);
      const intervalDescription = intervalInfo?.description || `${settings.checkInterval}s`;

      // Format language display
      const languageDisplay = settings.language === 'pt' ? 'Português' : 'English';

      // Format filters status
      const filtersStatus = settings.enableFilters
        ? ctx.t('settings.enabled')
        : ctx.t('settings.disabled');

      // Format template display
      const templateDisplay = settings.messageTemplate ?? ctx.t('settings.no_template');

      const message = [
        ctx.t('settings.title'),
        '',
        ctx.t('settings.language', { language: languageDisplay }),
        ctx.t('settings.check_interval', {
          interval: settings.checkInterval.toString(),
          description: intervalDescription,
        }),
        ctx.t('settings.max_feeds', { count: settings.maxFeeds.toString() }),
        ctx.t('settings.filters_enabled', { status: filtersStatus }),
        ctx.t('settings.message_template', { template: templateDisplay }),
        ctx.t('settings.timezone', { timezone: settings.timezone }),
        '',
        ctx.t('settings.help'),
      ].join('\n');

      await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Failed to show settings', { error, chatId });
      await ctx.reply(ctx.t('error.internal'));
    }
  }

  private async updateLanguage(
    ctx: CommandContext,
    chatId: string,
    params: string[]
  ): Promise<void> {
    if (params.length === 0) {
      await ctx.reply(ctx.t('settings.available_languages'));
      return;
    }

    const language = params[0]?.toLowerCase();
    if (!language || (language !== 'en' && language !== 'pt')) {
      await ctx.reply(ctx.t('settings.available_languages'));
      return;
    }

    try {
      await this.settingsService.updateLanguage(chatId, language);
      const languageDisplay = language === 'pt' ? 'Português' : 'English';
      await ctx.reply(ctx.t('settings.language_updated', { language: languageDisplay }));
    } catch (error) {
      logger.error('Failed to update language', { error, chatId, language });
      if (error instanceof Error && error.message.includes('Validation failed')) {
        await ctx.reply(error.message);
      } else {
        await ctx.reply(ctx.t('error.internal'));
      }
    }
  }

  private async updateInterval(
    ctx: CommandContext,
    chatId: string,
    params: string[]
  ): Promise<void> {
    if (params.length === 0) {
      const message = [
        '⏱️ **Check Interval Settings:**',
        '',
        '**Usage:** `/settings interval <minutes>`',
        '**Range:** 2-60 minutes',
        '**Default:** 5 minutes',
        '',
        '**Recommended Intervals:**',
        '• `2` - Very active feeds (news)',
        '• `5` - Normal feeds (default)',
        '• `10` - Moderate feeds (blogs)',
        '• `15` - Slow feeds (releases)',
        '• `30` - Very slow feeds',
        '• `60` - Hourly checks',
        '',
        '**Examples:**',
        '• `/settings interval 5` - Check every 5 minutes',
        '• `/settings interval 15` - Check every 15 minutes',
        '',
        '💡 **Tips:**',
        '• Lower intervals = more frequent checks',
        '• Higher intervals = less battery/data usage',
        '• Reddit feeds automatically use longer intervals',
      ].join('\n');

      await ctx.reply(message, { parse_mode: 'Markdown' });
      return;
    }

    const intervalStr = params[0];
    if (!intervalStr) {
      await ctx.reply('❌ Please provide interval in minutes (2-60)');
      return;
    }

    const intervalMinutes = parseInt(intervalStr, 10);
    if (isNaN(intervalMinutes) || intervalMinutes < 2 || intervalMinutes > 60) {
      await ctx.reply('❌ Interval must be between 2-60 minutes');
      return;
    }

    // Convert minutes to seconds for storage
    const intervalSeconds = intervalMinutes * 60;

    try {
      await this.settingsService.updateCheckInterval(chatId, intervalSeconds);
      
      const description = this.getIntervalDescription(intervalMinutes);
      await ctx.reply(
        `✅ Check interval updated to: **${intervalMinutes} minutes** (${description})`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      logger.error('Failed to update interval', { error, chatId, interval: intervalMinutes });
      if (error instanceof Error && error.message.includes('Validation failed')) {
        await ctx.reply(`❌ ${error.message}`);
      } else {
        await ctx.reply(ctx.t('error.internal'));
      }
    }
  }

  private getIntervalDescription(minutes: number): string {
    if (minutes <= 2) return 'very frequent';
    if (minutes <= 5) return 'frequent';
    if (minutes <= 10) return 'normal';
    if (minutes <= 15) return 'moderate';
    if (minutes <= 30) return 'slow';
    return 'very slow';
  }

  private async updateTemplate(
    ctx: CommandContext,
    chatId: string,
    params: string[]
  ): Promise<void> {
    if (params.length === 0) {
      const message = [
        '🎨 **Message Template Settings:**',
        '',
        '**Usage:**',
        '• `/settings template default` - Use default template',
        '• `/settings template compact` - Use compact template',
        '• `/settings template full` - Use full template',
        '• `/settings template <custom>` - Use custom template',
        '• `/settings template clear` - Clear template',
        '',
        '**Available Variables:**',
        '• `{{title}}` - Article title',
        '• `{{link}}` - Article URL',
        '• `{{description}}` - Article summary',
        '• `{{author}}` - Article author',
        '• `{{pubDate}}` - Publication date',
        '• `{{feedName}}` - Feed name',
        '• `{{domain}}` - Source domain',
        '',
        '**Pre-made Templates:**',
        '• **default:** `🔗 {{title}}\\n{{description}}\\n[Read more]({{link}})`',
        '• **compact:** `📰 {{title}} - {{domain}}`',
        '• **full:** `📰 **{{title}}**\\n👤 {{author}}\\n📅 {{pubDate}}\\n{{description}}\\n🔗 [Read more]({{link}})`',
        '',
        '💡 Use `\\n` for line breaks and Markdown formatting.',
      ].join('\n');

      await ctx.reply(message, { parse_mode: 'Markdown' });
      return;
    }

    const templateType = params[0]?.toLowerCase();
    let template: string | null = null;

    // Handle pre-made templates
    switch (templateType) {
      case 'clear':
      case 'limpar':
        template = null;
        break;
      case 'default':
      case 'padrao':
        template = '🔗 {{title}}\n{{description}}\n[Read more]({{link}})';
        break;
      case 'compact':
      case 'compacto':
        template = '📰 {{title}} - {{domain}}';
        break;
      case 'full':
      case 'completo':
        template = '📰 **{{title}}**\n👤 {{author}}\n📅 {{pubDate}}\n{{description}}\n🔗 [Read more]({{link}})';
        break;
      default:
        // Custom template
        template = params.join(' ');
        break;
    }

    try {
      if (template === null) {
        // Clear template
        await this.settingsService.updateMessageTemplate(chatId, null);
        await ctx.reply('✅ Template cleared. Using default format.');
        return;
      }

      // Validate template before updating
      const validationErrors = TemplateService.validateTemplate(template);
      if (validationErrors.length > 0) {
        const errorMessage = [
          '❌ **Template Validation Errors:**',
          '',
          ...validationErrors.map((err) => `• ${err.message}`),
          '',
          '💡 Use `/settings template` to see examples.',
        ].join('\n');
        await ctx.reply(errorMessage, { parse_mode: 'Markdown' });
        return;
      }

      await this.settingsService.updateMessageTemplate(chatId, template);

      // Show preview of the template
      const preview = TemplateService.previewTemplate(template);
      const message = [
        '✅ **Template Updated Successfully!**',
        '',
        '**Preview:**',
        '```',
        preview,
        '```',
        '',
        '💡 This is how your feed notifications will look.',
      ].join('\n');

      await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Failed to update template', { error, chatId, template });
      if (error instanceof Error && error.message.includes('Validation failed')) {
        await ctx.reply(`❌ ${error.message}`);
      } else {
        await ctx.reply(ctx.t('error.internal'));
      }
    }
  }

  private async resetSettings(ctx: CommandContext, chatId: string): Promise<void> {
    try {
      await this.settingsService.resetSettings(chatId);
      await ctx.reply(ctx.t('settings.reset'));
    } catch (error) {
      logger.error('Failed to reset settings', { error, chatId });
      await ctx.reply(ctx.t('error.internal'));
    }
  }

  private async showHelp(ctx: CommandContext): Promise<void> {
    const helpMessage = [
      '⚙️ **Settings Commands Help**',
      '',
      '📋 **View Settings:**',
      '• `/settings` - Show current settings',
      '',
      '🔧 **Update Settings:**',
      '• `/settings language pt|en` - Change language',
      '• `/settings interval 2-60` - Check interval (minutes)',
      '• `/settings timezone UTC-3` - Set timezone',
      '• `/settings notifications on|off` - Enable/disable',
      '• `/settings maxfeeds 1-100` - Max feeds limit',
      '• `/settings template <text>` - Custom template',
      '',
      '🎨 **Template Variables:**',
      '• `{{title}}` - Article title',
      '• `{{link}}` - Article URL',
      '• `{{description}}` - Article summary',
      '• `{{author}}` - Article author',
      '• `{{pubDate}}` - Publication date',
      '• `{{feedName}}` - Feed name',
      '• `{{domain}}` - Source domain',
      '',
      '📝 **Template Examples:**',
      '• **Default:** `🔗 {{title}}\\n{{description}}\\n[Read more]({{link}})`',
      '• **Compact:** `📰 {{title}} - {{domain}}`',
      '• **Full:** `📰 **{{title}}**\\n👤 {{author}}\\n📅 {{pubDate}}\\n{{description}}\\n🔗 [Read more]({{link}})`',
      '',
      '🔄 **Other Commands:**',
      '• `/settings reset` - Reset to defaults',
      '• `/settings export` - Export settings',
      '• `/settings help` - Show this help',
      '',
      '💡 **Tips:**',
      '• Interval affects battery/data usage',
      '• Lower intervals = more frequent checks',
      '• Templates support Markdown formatting',
      '• Use `\\n` for line breaks in templates',
    ].join('\n');

    await ctx.reply(helpMessage, { parse_mode: 'Markdown' });
  }

  private async updateTimezone(ctx: CommandContext, chatId: string, params: string[]): Promise<void> {
    if (params.length === 0) {
      const commonTimezones = [
        'UTC',
        'America/New_York',
        'America/Sao_Paulo',
        'Europe/London',
        'Europe/Berlin',
        'Asia/Tokyo',
        'Australia/Sydney',
      ];

      const message = [
        '🌍 **Available Timezones:**',
        '',
        '**Common Timezones:**',
        ...commonTimezones.map(tz => `• \`${tz}\``),
        '',
        '**Usage:** `/settings timezone UTC-3`',
        '**Current:** Check with `/settings`',
        '',
        '💡 Use standard timezone identifiers like:',
        '• `UTC`, `UTC-3`, `UTC+2`',
        '• `America/Sao_Paulo`',
        '• `Europe/London`',
      ].join('\n');

      await ctx.reply(message, { parse_mode: 'Markdown' });
      return;
    }

    const timezone = params[0];
    if (!timezone) {
      await ctx.reply('❌ Please provide a timezone identifier');
      return;
    }

    try {
      await this.settingsService.updateSettings(chatId, { timezone });
      await ctx.reply(`✅ Timezone updated to: **${timezone}**`, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Failed to update timezone', { error, chatId, timezone });
      if (error instanceof Error && error.message.includes('Invalid timezone')) {
        await ctx.reply('❌ Invalid timezone identifier. Use `/settings timezone` to see examples.');
      } else {
        await ctx.reply(ctx.t('error.internal'));
      }
    }
  }

  private async updateNotifications(ctx: CommandContext, chatId: string, params: string[]): Promise<void> {
    if (params.length === 0) {
      const message = [
        '🔔 **Notification Settings:**',
        '',
        '**Usage:**',
        '• `/settings notifications on` - Enable notifications',
        '• `/settings notifications off` - Disable notifications',
        '',
        '**Current Status:** Check with `/settings`',
        '',
        '💡 When disabled, feeds are still checked but no messages are sent.',
      ].join('\n');

      await ctx.reply(message, { parse_mode: 'Markdown' });
      return;
    }

    const status = params[0]?.toLowerCase();
    if (!status || !['on', 'off', 'true', 'false', '1', '0'].includes(status)) {
      await ctx.reply('❌ Use: `/settings notifications on` or `/settings notifications off`');
      return;
    }

    const enableFilters = ['on', 'true', '1'].includes(status);

    try {
      await this.settingsService.updateSettings(chatId, { enableFilters });
      const statusText = enableFilters ? '**enabled**' : '**disabled**';
      await ctx.reply(`✅ Notifications ${statusText}`, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Failed to update notifications', { error, chatId, enableFilters });
      await ctx.reply(ctx.t('error.internal'));
    }
  }

  private async updateMaxFeeds(ctx: CommandContext, chatId: string, params: string[]): Promise<void> {
    if (params.length === 0) {
      const message = [
        '📊 **Max Feeds Setting:**',
        '',
        '**Usage:** `/settings maxfeeds <number>`',
        '**Range:** 1-100 feeds',
        '**Default:** 50 feeds',
        '',
        '**Examples:**',
        '• `/settings maxfeeds 25` - Limit to 25 feeds',
        '• `/settings maxfeeds 100` - Maximum limit',
        '',
        '💡 Higher limits may affect performance.',
      ].join('\n');

      await ctx.reply(message, { parse_mode: 'Markdown' });
      return;
    }

    const maxFeedsStr = params[0];
    if (!maxFeedsStr) {
      await ctx.reply('❌ Please provide a number between 1-100');
      return;
    }

    const maxFeeds = parseInt(maxFeedsStr, 10);
    if (isNaN(maxFeeds) || maxFeeds < 1 || maxFeeds > 100) {
      await ctx.reply('❌ Max feeds must be a number between 1-100');
      return;
    }

    try {
      await this.settingsService.updateSettings(chatId, { maxFeeds });
      await ctx.reply(`✅ Max feeds updated to: **${maxFeeds}**`, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Failed to update max feeds', { error, chatId, maxFeeds });
      await ctx.reply(ctx.t('error.internal'));
    }
  }

  private async exportSettings(ctx: CommandContext, chatId: string): Promise<void> {
    try {
      const settings = await this.settingsService.getSettings(chatId);
      
      const exportData = {
        language: settings.language,
        checkInterval: settings.checkInterval,
        maxFeeds: settings.maxFeeds,
        enableFilters: settings.enableFilters,
        messageTemplate: settings.messageTemplate,
        timezone: settings.timezone,
        exportedAt: new Date().toISOString(),
        version: '1.0',
      };

      const exportJson = JSON.stringify(exportData, null, 2);
      
      const message = [
        '📤 **Settings Export:**',
        '',
        '```json',
        exportJson,
        '```',
        '',
        '💡 Save this configuration for backup or sharing.',
      ].join('\n');

      await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Failed to export settings', { error, chatId });
      await ctx.reply(ctx.t('error.internal'));
    }
  }
}

// FiltersCommand is now implemented in filter.commands.ts
// Re-export it here for backward compatibility
export { FiltersCommand } from './filter.commands.js';
