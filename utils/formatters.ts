import { extractVideoId } from '../utils/directTokenExtractor';
import { v4 as uuidv4 } from 'uuid';

interface EmojiObject {
  url: string;
  label: string;
  emojiId: string;
}

interface ChatMessage {
  id: string;
  message: string;
  authorName: string;
  authorChannelId: string;
  timestamp: string;
  userType?: 'moderator' | 'member' | 'owner' | 'regular';
  profileImage?: string;
  emojis?: EmojiObject[];
  sourceVideo: {
    url: string;
    id: string;
    title?: string;
  };
}

/**
 * Formats raw YouTube chat data into a standardized format
 */
export function formatChatMessages(data: any, videoUrl: string): ChatMessage[] {
  if (!data || !data.continuationContents?.liveChatContinuation?.actions) {
    return [];
  }

  const videoId = extractVideoId(videoUrl) || 'unknown';
  const actions = data.continuationContents.liveChatContinuation.actions;
  const messages: ChatMessage[] = [];

  for (const action of actions) {
    // Skip if not a chat message
    if (!action.addChatItemAction?.item?.liveChatTextMessageRenderer) {
      continue;
    }

    const renderer = action.addChatItemAction.item.liveChatTextMessageRenderer;
    
    // Extract author information
    const authorName = renderer.authorName?.simpleText || 'Anonymous';
    const authorChannelId = renderer.authorExternalChannelId || '';
    
    // Extract message text and emojis
    let messageText = '';
    const emojis: EmojiObject[] = [];
    
    if (renderer.message?.runs) {
      // Process each run - could be text or emoji
      renderer.message.runs.forEach((run: any, index: number) => {
        if (run.text) {
          // For text runs, add to the message text
          messageText += run.text;
        } else if (run.emoji) {
          // For emoji runs, add a placeholder in the text and store emoji info
          const emoji = run.emoji;
          const emojiId = emoji.emojiId || `emoji-${index}`;
          const emojiPlaceholder = emojiId; // Use the emoji character as placeholder
          
          // Add the emoji placeholder to text
          messageText += emojiPlaceholder;
          
          // Store emoji details for rendering later
          if (emoji.image?.thumbnails?.length > 0) {
            emojis.push({
              url: emoji.image.thumbnails[0].url,
              label: emoji.image?.accessibility?.accessibilityData?.label || emojiId,
              emojiId: emojiId
            });
          }
        }
      });
    }
    
    // Skip empty messages
    if (!messageText.trim() && emojis.length === 0) {
      continue;
    }
    
    // Create timestamp (use current time if not available)
    const timestampUsec = renderer.timestampUsec;
    const timestamp = timestampUsec 
      ? new Date(parseInt(timestampUsec) / 1000).toISOString() 
      : new Date().toISOString();
    
    // Extract profile image URL (use larger size if available)
    const profileImage = renderer.authorPhoto?.thumbnails?.[1]?.url || 
                         renderer.authorPhoto?.thumbnails?.[0]?.url;
    
    // Determine user type based on badges
    let userType: 'moderator' | 'member' | 'owner' | 'regular' = 'regular';
    
    if (renderer.authorBadges && renderer.authorBadges.length > 0) {
      for (const badge of renderer.authorBadges) {
        const badgeRenderer = badge.liveChatAuthorBadgeRenderer;
        if (!badgeRenderer) continue;
        
        // Check tooltip or accessibility label
        const badgeText = badgeRenderer.tooltip || 
                         badgeRenderer.accessibility?.accessibilityData?.label || '';
        
        if (badgeText.toLowerCase().includes('owner')) {
          userType = 'owner';
          break; // Owner is highest priority
        } else if (badgeText.toLowerCase().includes('moderator')) {
          userType = 'moderator';
          // Don't break, continue checking for owner status
        } else if (badgeText.toLowerCase().includes('member')) {
          userType = 'member';
          // Don't break, continue checking for moderator/owner status
        }
      }
    }
    
    // Add formatted message to the list
    messages.push({
      id: renderer.id || uuidv4(),
      message: messageText,
      authorName,
      authorChannelId,
      timestamp,
      userType,
      profileImage,
      emojis: emojis.length > 0 ? emojis : undefined,
      sourceVideo: {
        url: videoUrl,
        id: videoId
      }
    });
  }
  
  return messages;
}

/**
 * Extracts the continuation token for future chat requests
 */
export function extractContinuationToken(data: any): string | null {
  if (!data || !data.continuationContents?.liveChatContinuation?.continuations) {
    return null;
  }
  
  const continuations = data.continuationContents.liveChatContinuation.continuations;
  
  // Look for continuation in different possible locations
  for (const continuation of continuations) {
    if (continuation.invalidationContinuationData?.continuation) {
      return continuation.invalidationContinuationData.continuation;
    }
    if (continuation.timedContinuationData?.continuation) {
      return continuation.timedContinuationData.continuation;
    }
    if (continuation.liveChatReplayContinuationData?.continuation) {
      return continuation.liveChatReplayContinuationData.continuation;
    }
  }
  
  return null;
} 