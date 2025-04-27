import { extractYouTubeTokens, fetchLiveChatMessages, isValidYouTubeUrl } from '../scraping/puppeteer';
import { formatChatMessages } from '../utils/formatters';

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

interface LiveChatOptions {
  urls: string[];
  pageSize?: number;
  after?: string; // ISO timestamp to only get messages after this time
  messageIds?: string[]; // IDs of messages client already has to avoid duplicates
}

// Cache to store recently fetched chat messages to improve performance
type MessageCache = {
  [videoId: string]: {
    messages: ChatMessage[];
    lastFetched: number;
    continuation?: string;
  }
};

const messageCache: MessageCache = {};

// Set message cache expiration (5 minutes)
const CACHE_EXPIRATION = 5 * 60 * 1000;

// Maximum number of messages to keep in the cache per video
const MAX_CACHED_MESSAGES = 2000;

/**
 * Extract video ID from YouTube URL
 */
function extractVideoId(url: string): string | null {
  const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[7].length === 11) ? match[7] : null;
}

/**
 * Fetches live chat from multiple YouTube video URLs with pagination and filtering
 * Uses caching to optimize performance with large message volumes
 */
export async function getLiveChat(options: LiveChatOptions): Promise<{ 
  messages: ChatMessage[], 
  errors: string[],
  hasMore: boolean,
  lastTimestamp: string | null 
}> {
  const { urls, pageSize = 50, after, messageIds = [] } = options;
  const validUrls = urls.filter(url => isValidYouTubeUrl(url));
  const errors: string[] = [];
  const existingIds = new Set(messageIds);
  
  if (validUrls.length === 0) {
    errors.push('No valid YouTube URLs provided');
    return { messages: [], errors, hasMore: false, lastTimestamp: null };
  }

  // Create sets for efficient lookups
  const afterTime = after ? new Date(after).getTime() : 0;
  let allMessages: ChatMessage[] = [];
  
  // Process each URL in parallel with optimized fetching
  const chatPromises = validUrls.map(async (url) => {
    try {
      const videoId = extractVideoId(url);
      if (!videoId) {
        errors.push(`Could not extract video ID from ${url}`);
        return [];
      }
      
      // Clean up expired cache entries
      const now = Date.now();
      for (const cachedVideoId in messageCache) {
        if (now - messageCache[cachedVideoId].lastFetched > CACHE_EXPIRATION) {
          delete messageCache[cachedVideoId];
        }
      }
      
      // Check if we have a recent cache for this video
      const cachedData = messageCache[videoId];
      const shouldFetchFresh = !cachedData || (now - cachedData.lastFetched > 10000); // Refresh if older than 10 seconds
      
      let chatResult;
      if (shouldFetchFresh) {
        // Extract required tokens for YouTube API
        const tokens = await extractYouTubeTokens(url);
        
        // Fetch live chat data using the cached continuation token if available
        chatResult = await fetchLiveChatMessages(url, tokens);
        
        // Format and update the cache with new messages
        const newMessages = formatChatMessages(chatResult.data, url);
        
        // Update cache
        if (!messageCache[videoId]) {
          messageCache[videoId] = {
            messages: newMessages,
            lastFetched: now,
            continuation: chatResult.continuation || undefined
          };
        } else {
          // Merge with existing cache
          const existingCacheIds = new Set(messageCache[videoId].messages.map(msg => msg.id));
          const uniqueNewMessages = newMessages.filter(msg => !existingCacheIds.has(msg.id));
          
          // Combine and sort
          messageCache[videoId].messages = [...messageCache[videoId].messages, ...uniqueNewMessages]
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
          
          // Keep only most recent messages if cache gets too large
          if (messageCache[videoId].messages.length > MAX_CACHED_MESSAGES) {
            messageCache[videoId].messages = messageCache[videoId].messages.slice(-MAX_CACHED_MESSAGES);
          }
          
          messageCache[videoId].lastFetched = now;
          messageCache[videoId].continuation = chatResult.continuation || undefined;
        }
        
        return messageCache[videoId].messages;
      } else {
        // Return cached messages
        return cachedData.messages;
      }
      
    } catch (error) {
      console.error(`Error processing ${url}:`, error);
      errors.push(`Failed to fetch chat from ${url}: ${error}`);
      return [];
    }
  });

  // Wait for all promises to resolve
  const chatResults = await Promise.all(chatPromises);
  
  // Combine all chat messages from different videos
  allMessages = chatResults.flat();
  
  // Filter out messages that the client already has
  if (messageIds.length > 0) {
    allMessages = allMessages.filter(msg => !existingIds.has(msg.id));
  }
  
  // Filter messages by timestamp if specified
  if (after) {
    allMessages = allMessages.filter(msg => {
      const msgTime = new Date(msg.timestamp).getTime();
      return msgTime > afterTime;
    });
  }
  
  // Sort messages by timestamp
  allMessages.sort((a, b) => {
    return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
  });
  
  // Get total count before pagination
  const totalCount = allMessages.length;
  
  // Apply pagination if needed
  const hasMore = totalCount > pageSize;
  const paginatedMessages = hasMore ? allMessages.slice(0, pageSize) : allMessages;
  
  // Get the timestamp of the last message for the next pagination request
  const lastTimestamp = paginatedMessages.length > 0 
    ? paginatedMessages[paginatedMessages.length - 1].timestamp 
    : null;

  return {
    messages: paginatedMessages,
    errors,
    hasMore,
    lastTimestamp
  };
} 