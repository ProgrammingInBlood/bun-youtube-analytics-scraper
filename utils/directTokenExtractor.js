import axios from 'axios';

// Cache to store tokens for each video URL
const tokenCache = {};

// Cache expiration time (15 minutes)
const CACHE_EXPIRATION = 15 * 60 * 1000;

/**
 * Extract video ID from YouTube URL
 */
export function extractVideoId(url) {
  const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[7].length === 11) ? match[7] : null;
}

/**
 * Check if a URL is a valid YouTube URL
 */
export function isValidYouTubeUrl(url) {
  return !!url && (
    url.includes('youtube.com/watch') || 
    url.includes('youtu.be/') || 
    url.includes('youtube.com/live/')
  ) && !!extractVideoId(url);
}

/**
 * Extracts required tokens from a YouTube live video page without using Puppeteer
 */
export async function extractYouTubeTokens(videoUrl) {
  console.log(`Processing video URL: ${videoUrl}`);
  
  // Check cache first
  const cachedData = tokenCache[videoUrl];
  if (cachedData && Date.now() - cachedData.timestamp < CACHE_EXPIRATION) {
    console.log(`Using cached tokens for ${videoUrl}`);
    return cachedData;
  }

  try {
    // Set up headers to mimic a browser request
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    };

    // Make a direct request to the YouTube page
    console.log(`Fetching HTML for ${videoUrl}`);
    const response = await axios.get(videoUrl, { headers });
    const rawHtml = response.data;

    // Extract ytcfg data using regex
    const ytcfgMatch = rawHtml.match(/ytcfg\.set\s*\(\s*({.+?})\s*\)\s*;/);
    let ytcfgData = {};
    
    if (ytcfgMatch && ytcfgMatch[1]) {
      try {
        const ytcfgJson = JSON.parse(ytcfgMatch[1]);
        ytcfgData = ytcfgJson.INNERTUBE_CONTEXT?.client || {};
        
        // Extract specific keys we need
        const apiKeyMatch = rawHtml.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
        if (apiKeyMatch && apiKeyMatch[1]) {
          ytcfgData['INNERTUBE_API_KEY'] = apiKeyMatch[1];
        }
        
        const clientVersionMatch = rawHtml.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/);
        if (clientVersionMatch && clientVersionMatch[1]) {
          ytcfgData['INNERTUBE_CLIENT_VERSION'] = clientVersionMatch[1];
        }
        
        const visitorDataMatch = rawHtml.match(/"VISITOR_DATA":"([^"]+)"/);
        if (visitorDataMatch && visitorDataMatch[1]) {
          ytcfgData['VISITOR_DATA'] = visitorDataMatch[1];
        }
      } catch (e) {
        console.error(`Error parsing ytcfg data: ${e}`);
      }
    }

    // Extract liveChatToken
    let liveChatToken = '';
    const initialDataMatch = rawHtml.match(/window\["ytInitialData"\]\s*=\s*({.+?});/);
    
    if (!initialDataMatch) {
      // Try alternative pattern
      const altInitialDataMatch = rawHtml.match(/var\s+ytInitialData\s*=\s*({.+?});/);
      if (altInitialDataMatch && altInitialDataMatch[1]) {
        try {
          const initialData = JSON.parse(altInitialDataMatch[1]);
          liveChatToken = extractLiveChatTokenFromData(initialData);
        } catch (e) {
          console.error(`Error parsing alternative ytInitialData: ${e}`);
        }
      }
    } else {
      try {
        const initialData = JSON.parse(initialDataMatch[1]);
        liveChatToken = extractLiveChatTokenFromData(initialData);
      } catch (e) {
        console.error(`Error parsing ytInitialData: ${e}`);
      }
    }

    // Extract video title
    let videoTitle = '';
    const titleMatch = rawHtml.match(/<title>([^<]+)<\/title>/);
    if (titleMatch && titleMatch[1]) {
      videoTitle = titleMatch[1].replace(' - YouTube', '');
    }

    // Extract channel name
    let channelName = '';
    const channelMatch = rawHtml.match(/"ownerChannelName":"([^"]+)"/);
    if (channelMatch && channelMatch[1]) {
      channelName = channelMatch[1];
    }

    if (!liveChatToken) {
      console.error(`Could not extract live chat token from ${videoUrl}`);
      return null;
    }

    const result = {
      apiKey: ytcfgData['INNERTUBE_API_KEY'] || '',
      clientVersion: ytcfgData['INNERTUBE_CLIENT_VERSION'] || '2.0',
      visitorData: ytcfgData['VISITOR_DATA'] || '',
      continuation: liveChatToken,
      rawHtml: rawHtml,
      timestamp: Date.now(),
      title: videoTitle,
      channelName: channelName
    };

    // Cache the result
    tokenCache[videoUrl] = result;
    
    console.log(`Successfully extracted tokens for ${videoUrl}`);
    return result;

  } catch (error) {
    console.error(`Error extracting tokens from ${videoUrl}:`, error.message);
    return null;
  }
}

/**
 * Helper function to extract live chat token from ytInitialData
 */
function extractLiveChatTokenFromData(data) {
  try {
    // Navigate through the nested structure to find the live chat continuation token
    const contents = data?.contents?.twoColumnWatchNextResults?.conversationBar?.liveChatRenderer;
    
    if (contents && contents.continuations && contents.continuations[0]) {
      return contents.continuations[0].reloadContinuationData?.continuation || 
             contents.continuations[0].invalidationContinuationData?.continuation;
    }

    // Alternative path
    const secondaryContents = data?.contents?.twoColumnWatchNextResults?.secondaryResults?.secondaryResults?.results;
    if (secondaryContents) {
      for (const result of secondaryContents) {
        if (result.compactVideoRenderer && result.compactVideoRenderer.badges) {
          // This might contain live chat info
        }
      }
    }

    return '';
  } catch (error) {
    console.error('Error extracting live chat token:', error);
    return '';
  }
}

/**
 * Fetch live chat messages using the continuation token
 */
export async function fetchLiveChatMessages(continuationToken, apiKey, pageSize = 200) {
  try {
    console.log(`Fetching live chat messages with continuation: ${continuationToken.substring(0, 50)}...`);
    
    const payload = {
      context: {
        client: {
          clientName: "WEB",
          clientVersion: "2.0"
        }
      },
      continuation: continuationToken
    };

    const response = await axios.post(
      `https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${apiKey}`,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        }
      }
    );

    const data = response.data;
    
    if (!data || !data.continuationContents) {
      console.log('No continuation contents found in response');
      return {
        messages: [],
        continuation: null
      };
    }

    const liveChatContinuation = data.continuationContents.liveChatContinuation;
    if (!liveChatContinuation) {
      console.log('No live chat continuation found');
      return {
        messages: [],
        continuation: null
      };
    }

    // Extract messages
    const actions = liveChatContinuation.actions || [];
    const messages = [];

    for (const action of actions) {
      if (action.addChatItemAction && action.addChatItemAction.item) {
        messages.push(action.addChatItemAction.item);
      }
    }

    // Extract next continuation token
    let nextContinuation = null;
    if (liveChatContinuation.continuations && liveChatContinuation.continuations[0]) {
      const continuationData = liveChatContinuation.continuations[0];
      nextContinuation = continuationData.invalidationContinuationData?.continuation ||
                        continuationData.timedContinuationData?.continuation ||
                        continuationData.liveChatReplayContinuationData?.continuation;
    }

    console.log(`Fetched ${messages.length} live chat messages`);
    
    return {
      messages: messages.slice(0, pageSize),
      continuation: nextContinuation
    };

  } catch (error) {
    console.error('Error fetching live chat messages:', error.message);
    return {
      messages: [],
      continuation: null
    };
  }
}

/**
 * Fetch video metadata using YouTube's internal API
 */
export async function fetchVideoMetadata(videoId) {
  try {
    console.log(`Fetching metadata for video: ${videoId}`);
    
    const payload = {
      context: {
        client: {
          clientName: "WEB",
          clientVersion: "2.0"
        }
      },
      videoId: videoId
    };

    const response = await axios.post(
      'https://www.youtube.com/youtubei/v1/player',
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        }
      }
    );

    if (response.data && response.data.videoDetails) {
      console.log(`Successfully fetched metadata for ${videoId}`);
      return response.data;
    } else {
      console.log(`No video details found for ${videoId}`);
      return null;
    }

  } catch (error) {
    console.error(`Error fetching metadata for ${videoId}:`, error.message);
    return null;
  }
} 