import { v4 as uuidv4 } from 'uuid';

/**
 * Format chat messages from YouTube API response
 */
export function formatChatMessages(rawMessages, sourceVideo) {
  if (!rawMessages || !Array.isArray(rawMessages)) {
    console.log('⚠️ No messages to format or invalid format');
    return [];
  }

  console.log(`📝 Formatting ${rawMessages.length} raw messages...`);
  
  const formattedMessages = [];

  for (const rawMessage of rawMessages) {
    try {
      const formatted = formatSingleMessage(rawMessage, sourceVideo);
      if (formatted) {
        formattedMessages.push(formatted);
      }
    } catch (error) {
      console.error('❌ Error formatting message:', error);
      // Continue with other messages even if one fails
    }
  }

  console.log(`✅ Successfully formatted ${formattedMessages.length} messages`);
  return formattedMessages;
}

/**
 * Format a single chat message
 */
function formatSingleMessage(rawMessage, sourceVideo) {
  try {
    // Handle different message container types
    let messageRenderer = null;
    
    if (rawMessage.liveChatTextMessageRenderer) {
      messageRenderer = rawMessage.liveChatTextMessageRenderer;
    } else if (rawMessage.liveChatPaidMessageRenderer) {
      messageRenderer = rawMessage.liveChatPaidMessageRenderer;
    } else if (rawMessage.liveChatPaidStickerRenderer) {
      messageRenderer = rawMessage.liveChatPaidStickerRenderer;
    } else if (rawMessage.liveChatMembershipItemRenderer) {
      messageRenderer = rawMessage.liveChatMembershipItemRenderer;
    } else {
      console.log('⚠️ Unknown message type:', Object.keys(rawMessage));
      return null;
    }

    if (!messageRenderer) {
      return null;
    }

    // Extract basic message data
    const messageId = messageRenderer.id || uuidv4();
    const timestamp = extractTimestamp(messageRenderer);
    const authorInfo = extractAuthorInfo(messageRenderer);
    const messageContent = extractMessageContent(messageRenderer);
    const emojis = extractEmojis(messageRenderer);

    const formattedMessage = {
      id: messageId,
      message: messageContent.text,
      authorName: authorInfo.name,
      authorChannelId: authorInfo.channelId,
      timestamp: timestamp,
      userType: authorInfo.userType,
      profileImage: authorInfo.profileImage,
      sourceVideo: {
        url: sourceVideo.url,
        id: sourceVideo.id,
        title: sourceVideo.title
      }
    };

    // Add emojis if present
    if (emojis && emojis.length > 0) {
      formattedMessage.emojis = emojis;
    }

    return formattedMessage;

  } catch (error) {
    console.error('❌ Error formatting single message:', error);
    return null;
  }
}

/**
 * Extract timestamp from message
 */
function extractTimestamp(messageRenderer) {
  try {
    if (messageRenderer.timestampUsec) {
      // Convert microseconds to milliseconds
      const timestamp = parseInt(messageRenderer.timestampUsec) / 1000;
      return new Date(timestamp).toISOString();
    }
    
    if (messageRenderer.timestampText && messageRenderer.timestampText.simpleText) {
      // This might be a relative time like "5 minutes ago"
      // For now, use current time as fallback
      console.log('⚠️ Using current time as timestamp fallback');
      return new Date().toISOString();
    }
    
    // Fallback to current time
    return new Date().toISOString();
  } catch (error) {
    console.error('❌ Error extracting timestamp:', error);
    return new Date().toISOString();
  }
}

/**
 * Extract author information
 */
function extractAuthorInfo(messageRenderer) {
  const authorInfo = {
    name: 'Unknown User',
    channelId: 'unknown',
    userType: 'regular',
    profileImage: null
  };

  try {
    // Extract author name
    if (messageRenderer.authorName) {
      if (typeof messageRenderer.authorName === 'string') {
        authorInfo.name = messageRenderer.authorName;
      } else if (messageRenderer.authorName.simpleText) {
        authorInfo.name = messageRenderer.authorName.simpleText;
      } else if (messageRenderer.authorName.runs && messageRenderer.authorName.runs[0]) {
        authorInfo.name = messageRenderer.authorName.runs[0].text;
      }
    }

    // Extract channel ID
    if (messageRenderer.authorExternalChannelId) {
      authorInfo.channelId = messageRenderer.authorExternalChannelId;
    }

    // Extract profile image
    if (messageRenderer.authorPhoto && messageRenderer.authorPhoto.thumbnails) {
      const thumbnails = messageRenderer.authorPhoto.thumbnails;
      if (thumbnails.length > 0) {
        // Use the highest quality thumbnail available
        const thumbnail = thumbnails[thumbnails.length - 1];
        authorInfo.profileImage = thumbnail.url;
      }
    }

    // Determine user type based on badges
    if (messageRenderer.authorBadges && Array.isArray(messageRenderer.authorBadges)) {
      for (const badge of messageRenderer.authorBadges) {
        const badgeRenderer = badge.liveChatAuthorBadgeRenderer;
        if (badgeRenderer && badgeRenderer.icon && badgeRenderer.icon.iconType) {
          const iconType = badgeRenderer.icon.iconType;
          
          if (iconType === 'MODERATOR') {
            authorInfo.userType = 'moderator';
          } else if (iconType === 'OWNER') {
            authorInfo.userType = 'owner';
          } else if (iconType === 'MEMBER') {
            authorInfo.userType = 'member';
          }
        }
      }
    }

  } catch (error) {
    console.error('❌ Error extracting author info:', error);
  }

  return authorInfo;
}

/**
 * Extract message content
 */
function extractMessageContent(messageRenderer) {
  const content = {
    text: '',
    originalRuns: null
  };

  try {
    if (messageRenderer.message) {
      if (typeof messageRenderer.message === 'string') {
        content.text = messageRenderer.message;
      } else if (messageRenderer.message.runs && Array.isArray(messageRenderer.message.runs)) {
        // Process runs to extract text and preserve emoji references
        content.originalRuns = messageRenderer.message.runs;
        content.text = messageRenderer.message.runs
          .map(run => run.text || run.emoji?.emojiId || '')
          .join('');
      } else if (messageRenderer.message.simpleText) {
        content.text = messageRenderer.message.simpleText;
      }
    }

    // Handle paid messages or stickers
    if (messageRenderer.purchaseAmountText && messageRenderer.purchaseAmountText.simpleText) {
      content.text = `💰 ${messageRenderer.purchaseAmountText.simpleText}: ${content.text}`;
    }

    // Handle membership messages
    if (messageRenderer.headerSubtext) {
      let headerText = '';
      if (messageRenderer.headerSubtext.runs) {
        headerText = messageRenderer.headerSubtext.runs.map(run => run.text).join('');
      } else if (messageRenderer.headerSubtext.simpleText) {
        headerText = messageRenderer.headerSubtext.simpleText;
      }
      content.text = `🎖️ ${headerText}${content.text ? `: ${content.text}` : ''}`;
    }

  } catch (error) {
    console.error('❌ Error extracting message content:', error);
  }

  return content;
}

/**
 * Extract emojis from message
 */
function extractEmojis(messageRenderer) {
  const emojis = [];

  try {
    if (messageRenderer.message && messageRenderer.message.runs) {
      for (const run of messageRenderer.message.runs) {
        if (run.emoji) {
          const emoji = {
            emojiId: run.emoji.emojiId || '',
            label: run.emoji.shortcuts ? run.emoji.shortcuts[0] : '',
            url: ''
          };

          // Extract emoji image URL
          if (run.emoji.image && run.emoji.image.thumbnails) {
            const thumbnails = run.emoji.image.thumbnails;
            if (thumbnails.length > 0) {
              // Use the highest quality thumbnail
              emoji.url = thumbnails[thumbnails.length - 1].url;
            }
          }

          if (emoji.emojiId && emoji.url) {
            emojis.push(emoji);
          }
        }
      }
    }
  } catch (error) {
    console.error('❌ Error extracting emojis:', error);
  }

  return emojis;
} 