import { extractYouTubeTokens, fetchLiveChatMessages, isValidYouTubeUrl, extractVideoId } from '../utils/directTokenExtractor.js';
import { formatChatMessages } from '../utils/formatters.js';

// Cache to store recently fetched chat messages to improve performance
const messageCache = {};

// Set message cache expiration (5 minutes)
const CACHE_EXPIRATION = 5 * 60 * 1000;

// Maximum number of messages to keep in the cache per video
const MAX_CACHED_MESSAGES = 2000;

/**
 * Main function to get live chat from multiple YouTube URLs
 */
export async function getLiveChat(options) {
  const { urls, pageSize = 200, after, messageIds = [] } = options;
  
  console.log('\n=== Starting Live Chat Fetch ===');
  console.log(`URLs to process: ${urls.length}`);
  console.log(`Page size: ${pageSize}`);
  console.log(`After timestamp: ${after || 'none'}`);
  console.log(`Message IDs to exclude: ${messageIds.length}`);

  const allMessages = [];
  const errors = [];

  // Process each URL
  for (const url of urls) {
    if (!isValidYouTubeUrl(url)) {
      console.log(`❌ Invalid URL: ${url}`);
      errors.push(`Invalid YouTube URL: ${url}`);
      continue;
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      console.log(`❌ Could not extract video ID from: ${url}`);
      errors.push(`Could not extract video ID from URL: ${url}`);
      continue;
    }

    console.log(`\n🎥 Processing video: ${videoId}`);
    
    try {
      // Check cache first
      const cached = messageCache[videoId];
      const now = Date.now();
      
      if (cached && (now - cached.lastFetched) < CACHE_EXPIRATION) {
        console.log(`📦 Using cached data for ${videoId}`);
        
        // Filter cached messages based on criteria
        let filteredMessages = cached.messages;
        
        // Filter by timestamp if 'after' is provided
        if (after) {
          const afterTime = new Date(after).getTime();
          filteredMessages = filteredMessages.filter(msg => {
            const msgTime = new Date(msg.timestamp).getTime();
            return msgTime > afterTime;
          });
        }
        
        // Exclude messages the client already has
        if (messageIds.length > 0) {
          filteredMessages = filteredMessages.filter(msg => !messageIds.includes(msg.id));
        }
        
        // Limit to pageSize
        if (filteredMessages.length > pageSize) {
          filteredMessages = filteredMessages.slice(-pageSize);
        }
        
        console.log(`📦 Found ${filteredMessages.length} cached messages for ${videoId}`);
        allMessages.push(...filteredMessages);
        continue;
      }

      // Extract tokens for this video
      console.log(`🔍 Extracting tokens for ${videoId}...`);
      const tokens = await extractYouTubeTokens(url);
      
      if (!tokens || !tokens.continuation) {
        console.log(`❌ Could not extract valid tokens for ${videoId}`);
        errors.push(`Could not extract live chat tokens for video: ${videoId}`);
        continue;
      }

      console.log(`✅ Tokens extracted for ${videoId}`);
      
      // Fetch live chat messages
      console.log(`💬 Fetching chat messages for ${videoId}...`);
      const chatResponse = await fetchLiveChatMessages(tokens.continuation, tokens.apiKey, pageSize);
      
      if (!chatResponse || !chatResponse.messages) {
        console.log(`❌ No chat data received for ${videoId}`);
        errors.push(`No live chat data available for video: ${videoId}`);
        continue;
      }

      console.log(`✅ Fetched ${chatResponse.messages.length} raw messages for ${videoId}`);

      // Format the messages
      const formattedMessages = formatChatMessages(chatResponse.messages, {
        url,
        id: videoId,
        title: tokens.title
      });

      console.log(`✅ Formatted ${formattedMessages.length} messages for ${videoId}`);

      // Update cache
      messageCache[videoId] = {
        messages: formattedMessages.slice(-MAX_CACHED_MESSAGES), // Keep only the latest messages
        lastFetched: now,
        continuation: chatResponse.continuation
      };

      // Filter messages based on criteria
      let filteredMessages = formattedMessages;
      
      // Filter by timestamp if 'after' is provided
      if (after) {
        const afterTime = new Date(after).getTime();
        filteredMessages = filteredMessages.filter(msg => {
          const msgTime = new Date(msg.timestamp).getTime();
          return msgTime > afterTime;
        });
        console.log(`🕒 Filtered to ${filteredMessages.length} messages after ${after}`);
      }
      
      // Exclude messages the client already has
      if (messageIds.length > 0) {
        const beforeFilter = filteredMessages.length;
        filteredMessages = filteredMessages.filter(msg => !messageIds.includes(msg.id));
        console.log(`🔄 Filtered out ${beforeFilter - filteredMessages.length} duplicate messages`);
      }
      
      // Limit to pageSize
      if (filteredMessages.length > pageSize) {
        filteredMessages = filteredMessages.slice(-pageSize);
        console.log(`📏 Limited to ${pageSize} most recent messages`);
      }

      allMessages.push(...filteredMessages);
      console.log(`✅ Added ${filteredMessages.length} messages from ${videoId} to results`);

    } catch (error) {
      console.error(`❌ Error processing ${videoId}:`, error.message);
      errors.push(`Error fetching chat for video ${videoId}: ${error.message}`);
    }
  }

  // Sort all messages by timestamp
  allMessages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  console.log(`\n=== Live Chat Fetch Complete ===`);
  console.log(`Total messages collected: ${allMessages.length}`);
  console.log(`Errors encountered: ${errors.length}`);
  console.log(`===================================\n`);

  return {
    messages: allMessages,
    errors: errors,
    totalMessages: allMessages.length,
    timestamp: new Date().toISOString()
  };
} 