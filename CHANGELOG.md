# Changelog

All notable changes to RSS Skull Bot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.02.0] - 2025-01-11

### Added
- **Atom 1.0 Support**: Full RFC 4287 compliance for Reddit feeds
  - Support for `<updated>` and `<published>` date fields (ISO 8601)
  - Support for `<content>` and `<summary>` content fields
  - Support for `<author><name>` and `<author><email>` author fields
  - Support for `<subtitle>` feed description field
- **Enhanced Date Parsing**: Improved date validation and parsing
  - Specific handling for Atom 1.0 ISO 8601 format (`2025-10-11T03:30:00Z`)
  - Better error handling for invalid date formats
  - Debug logging for date parsing operations
- **Feed Type Detection**: Automatic detection of feed format
  - Atom 1.0 detection via `xmlns="http://www.w3.org/2005/Atom"`
  - RSS 2.0 detection via `<rss>` or `<channel>` elements
  - Debug logging for feed format identification
- **Conditional HTTP Caching**: Bandwidth optimization
  - Support for `If-None-Match` (ETag) headers
  - Support for `If-Modified-Since` headers
  - Detection of `304 Not Modified` responses
  - Cache entry storage with conditional headers

### Changed
- **Reddit URL Format**: Updated to use `old.reddit.com` for better compatibility
  - Subreddit URLs: `https://old.reddit.com/r/subreddit/.rss`
  - User URLs: `https://old.reddit.com/u/username/.rss`
- **User-Agent**: Specific Reddit user-agent for better compliance
  - `PortalIdeaFeedBot/1.0 (+https://portalidea.com.br)`
- **Accept Headers**: Prioritize Atom over RSS
  - `application/atom+xml, application/rss+xml, text/xml;q=0.9, */*;q=0.8`
- **Content Validation**: Enhanced validation for XML feeds
  - Reject HTML responses (error pages, redirects)
  - Validate Content-Type headers
  - Better error messages for invalid feeds

### Fixed
- **"Invalid time value" Error**: Resolved date parsing issues with Reddit feeds
  - Proper handling of Atom 1.0 date formats
  - Fallback chain: `isoDate` → `updated` → `published` → `pubDate`
  - Robust date validation with `Date.parse()`
- **Feed Processing**: Improved content extraction
  - Better handling of Atom `<content>` vs RSS `<description>`
  - Enhanced Reddit content extraction with images and videos
  - Proper author field extraction for both formats

## [0.01.0] - 2025-01-10

### Added
- **Security Settings System**: User-configurable security parameters via `/settings` command
  - Rate limiting controls (`/settings ratelimit`)
  - Cache management (`/settings cache`) 
  - Retry configuration (`/settings retry`)
  - Timeout settings (`/settings timeout`)
- **Secret Commands**: Hidden commands for advanced users
  - `/processar` - Process all feeds immediately
  - `/processarfeed <name>` - Process specific feed immediately
  - `/reset` - Reset entire database (all chats, feeds, filters, settings)
  - `/fixfeeds` - Remove problematic feeds (Reddit .com.br domains)
- **Enhanced Feed Processing**: 
  - `forceProcessAll` flag for manual feed processing
  - Automatic `.rss` append for Reddit URLs
  - Improved `lastItemId` persistence
- **Database Schema Updates**:
  - Added security settings fields to `ChatSettings` model
  - `rateLimitEnabled`, `maxRequestsPerMinute`, `minDelayMs`
  - `cacheEnabled`, `cacheTTLMinutes`
  - `retryEnabled`, `maxRetries`, `timeoutSeconds`
- **Security Features**:
  - Domain-specific rate limiting (Reddit: 15min, YouTube: 10min, GitHub: 30min)
  - User-Agent rotation with realistic browser headers
  - Intelligent caching with domain-specific TTL
  - Exponential backoff retry logic
  - Input validation and sanitization

### Changed
- **Language Standardization**: All bot responses now in English only
  - Removed Portuguese language support from i18n middleware
  - Updated all command responses to English
  - Standardized error messages in English
- **Bot Service Architecture**:
  - Switched from `SimpleBotService` to full `BotService`
  - Implemented grammY Runner for improved polling reliability
  - Enhanced command handler registration order
  - Added direct command processing for non-mentioned commands
- **Settings Command Enhancement**:
  - Added security settings display section
  - Updated help documentation with security commands
  - Added validation for security parameters
- **Feed Processing Logic**:
  - Improved new item detection for feeds without `lastItemId`
  - Enhanced deduplication using `BOT_STARTUP_TIME` filter
  - Better error handling for problematic feeds
- **Performance Improvements**:
  - Optimized feed checking intervals per domain
  - Enhanced caching strategy with domain-specific TTL
  - Improved rate limiting with minimum delays
  - Better memory management and garbage collection

### Fixed
- **Bot Responsiveness**: Fixed bot not responding to commands in channels/groups/private chats
  - Corrected middleware registration order
  - Fixed command context population
  - Removed conflicting message handlers
- **Feed Processing Issues**:
  - Fixed `/processar` command not detecting new items for new feeds
  - Corrected `lastItemId` not being saved after processing
  - Fixed duplicate notifications for same items
- **Build Errors**:
  - Fixed TypeScript errors related to grammY Runner options
  - Corrected `SettingsUpdateInput` interface
  - Fixed undefined parameter handling in settings commands
- **Docker Issues**:
  - Resolved container build failures
  - Fixed migration application in Docker environment
  - Improved container startup reliability

### Removed
- **Portuguese Language Support**: Removed bilingual functionality
- **Test Command**: Removed `/test` command as requested
- **Legacy Bot Service**: Removed `SimpleBotService` usage

### Security
- **Rate Limiting**: Domain-specific limits to prevent blocking
  - Reddit: 5 requests/minute, 5s minimum delay
  - YouTube: 20 requests/minute, 2s minimum delay
  - GitHub: 40 requests/minute, 1s minimum delay
  - Default: 50 requests/minute, 500ms minimum delay
- **User-Agent Rotation**: Realistic browser profiles to avoid detection
  - Chrome, Firefox, Safari, Edge profiles
  - Domain-specific headers (Referer, Accept-Language)
  - Consistent session management
- **Caching Strategy**: Intelligent cache management
  - Domain-specific TTL (Reddit: 10min, GitHub: 60min, Default: 20min)
  - Automatic cleanup of expired entries
  - Hit/miss statistics tracking
- **Input Validation**: Comprehensive input sanitization
  - URL format validation
  - Regex pattern testing
  - Control character removal
  - Field length limits

### Technical Details
- **Database Migration**: Added `20251010121712_add_security_settings` migration
- **TypeScript Updates**: Enhanced type safety with new interfaces
- **Error Handling**: Improved error messages and logging
- **Performance Monitoring**: Added cache statistics and performance tracking
- **Documentation**: Updated README.md with current features and security settings

### Breaking Changes
- **Language**: Bot now responds only in English (Portuguese support removed)
- **Database Schema**: New security fields added to `ChatSettings` table
- **Command Structure**: Some internal command handling changes

### Migration Notes
- Existing users will get default security settings automatically
- Portuguese language settings will be reset to English
- No data loss during migration
- All existing feeds and filters preserved

---

## Previous Versions

### [0.00.1] - Initial Release
- Basic RSS feed monitoring
- Telegram bot integration
- Simple feed management commands
- Basic filtering capabilities
- Docker deployment support

---

## Development Notes

### Testing
- All changes tested in Docker environment
- Verified bot responsiveness in channels, groups, and private chats
- Tested security settings functionality
- Confirmed feed processing improvements

### Performance Impact
- Improved feed processing speed with domain-specific intervals
- Reduced memory usage with better caching
- Enhanced reliability with grammY Runner
- Better error recovery with exponential backoff

### Security Considerations
- User-configurable security settings come with warnings
- Default settings are conservative to prevent blocking
- Rate limiting prevents abuse and blocking
- Input validation prevents injection attacks

---

**Full Changelog**: [View all changes](https://github.com/runawaydevil/rssskull/compare/v0.00.1...v0.01.0)
