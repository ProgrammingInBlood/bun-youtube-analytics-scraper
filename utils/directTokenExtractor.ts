import axios from 'axios';

// Cache to store tokens for each video URL
const tokenCache: Record<string, {
  apiKey: string;
  clientVersion: string;
  visitorData: string;
  continuationToken: string;
  rawHtml: string;
  timestamp: number;
}> = {};

// Cache expiration time (15 minutes)
const CACHE_EXPIRATION = 15 * 60 * 1000;

/**
 * Extract video ID from YouTube URL
 */
export function extractVideoId(url: string): string | null {
  const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[7].length === 11) ? match[7] : null;
}

/**
 * Check if a URL is a valid YouTube URL
 */
export function isValidYouTubeUrl(url: string): boolean {
  return !!url && (
    url.includes('youtube.com/watch') || 
    url.includes('youtu.be/') || 
    url.includes('youtube.com/live/')
  ) && !!extractVideoId(url);
}

/**
 * Extracts required tokens from a YouTube live video page without using Puppeteer
 */
export async function extractYouTubeTokens(videoUrl: string) {
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
    let ytcfgData: Record<string, string> = {};
    
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
          const liveChatRenderer = initialData?.contents?.twoColumnWatchNextResults?.conversationBar?.liveChatRenderer;
          liveChatToken = liveChatRenderer?.continuations?.[0]?.reloadContinuationData?.continuation || '';
        } catch (e) {
          console.error(`Error parsing alternative ytInitialData: ${e}`);
        }
      }
    } else if (initialDataMatch && initialDataMatch[1]) {
      try {
        const initialData = JSON.parse(initialDataMatch[1]);
        const liveChatRenderer = initialData?.contents?.twoColumnWatchNextResults?.conversationBar?.liveChatRenderer;
        liveChatToken = liveChatRenderer?.continuations?.[0]?.reloadContinuationData?.continuation || '';
      } catch (e) {
        console.error(`Error parsing ytInitialData: ${e}`);
      }
    }
    
    // If we couldn't extract the continuation token, try a different approach
    if (!liveChatToken) {
      // Look for the continuation token in the raw HTML
      const continuationMatch = rawHtml.match(/"continuation":"([^"]+)"/);
      if (continuationMatch && continuationMatch[1]) {
        liveChatToken = continuationMatch[1];
      }
    }

    // Store and return the result
    const result = {
      apiKey: ytcfgData['INNERTUBE_API_KEY'] || '',
      clientVersion: ytcfgData['INNERTUBE_CLIENT_VERSION'] || '',
      visitorData: ytcfgData['VISITOR_DATA'] || '',
      continuationToken: liveChatToken,
      rawHtml,
      timestamp: Date.now()
    };

    // Cache the result
    tokenCache[videoUrl] = result;
    
    return result;
  } catch (error) {
    console.error(`Error extracting YouTube tokens for ${videoUrl}:`, error);
    throw new Error(`Failed to extract tokens from YouTube: ${error}`);
  }
}

/**
 * Fetch live chat messages using the extracted tokens
 */
export async function fetchLiveChatMessages(videoUrl: string, tokens: any) {
  if (!tokens.apiKey || !tokens.clientVersion || !tokens.continuationToken) {
    throw new Error('Missing required tokens for live chat fetch');
  }

  try {
    const requestData = {
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: tokens.clientVersion,
          visitorData: tokens.visitorData
        }
      },
      continuation: tokens.continuationToken
    };

    const response = await axios.post(
      `https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${tokens.apiKey}`,
      requestData,
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        }
      }
    );

    // Extract continuation token for next request
    let continuation = null;
    if (response.data?.continuationContents?.liveChatContinuation?.continuations) {
      const continuations = response.data.continuationContents.liveChatContinuation.continuations;
      for (const cont of continuations) {
        if (cont.invalidationContinuationData?.continuation) {
          continuation = cont.invalidationContinuationData.continuation;
          break;
        }
        if (cont.timedContinuationData?.continuation) {
          continuation = cont.timedContinuationData.continuation;
          break;
        }
      }
    }

    return {
      data: response.data,
      continuation
    };
  } catch (error) {
    console.error(`Error fetching live chat messages: ${error}`);
    throw error;
  }
}

/**
 * Fetch video metadata using the extracted tokens
 */
export async function fetchVideoMetadata(videoUrl: string, tokens: any) {
  if (!tokens.apiKey || !tokens.clientVersion) {
    throw new Error('Missing required tokens for metadata fetch');
  }

  try {
    const videoId = extractVideoId(videoUrl);
    if (!videoId) {
      throw new Error('Invalid YouTube URL');
    }

    const requestData = {
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: tokens.clientVersion,
          visitorData: tokens.visitorData
        }
      },
      videoId
    };

    // Fetch primary data (via updated_metadata endpoint)
    const primaryResponse = await axios.post(
      `https://www.youtube.com/youtubei/v1/updated_metadata?key=${tokens.apiKey}`,
      requestData,
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        }
      }
    );

    // Fetch backup data (via next endpoint) if needed
    const backupResponse = await axios.post(
      `https://www.youtube.com/youtubei/v1/next?key=${tokens.apiKey}`,
      requestData,
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        }
      }
    );

    return {
      primary: primaryResponse.data,
      backup: backupResponse.data
    };
  } catch (error) {
    console.error(`Error fetching video metadata: ${error}`);
    throw error;
  }
}

/**
 * Extracts the channel ID from a YouTube channel URL
 */
export function extractChannelId(url: string): string | null {
  // Match patterns for different YouTube channel URL formats
  const patterns = [
    /youtube\.com\/channel\/([\w-]+)/,      // /channel/UC...
    /youtube\.com\/@([\w.-]+)/,             // /@username
    /youtube\.com\/c\/([\w-]+)/,            // /c/channelname
    /youtube\.com\/user\/([\w-]+)/          // /user/username
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  
  return null;
}

/**
 * Checks if a YouTube URL is a valid channel URL
 */
export function isValidYouTubeChannelUrl(url: string): boolean {
  if (!url) return false;
  
  return !!extractChannelId(url);
}

interface ChannelLiveVideo {
  videoId: string;
  videoUrl: string;
  title: string;
  thumbnailUrl: string;
  viewCount: number;
  channelName: string;
}

// Cache for channel data to avoid repeated scraping
const channelCache: Record<string, { 
  videos: ChannelLiveVideo[], 
  timestamp: number 
}> = {};

// Cache expiration time (5 minutes)
const CHANNEL_CACHE_EXPIRATION = 5 * 60 * 1000;

/**
 * Fetches only LIVE videos from a YouTube channel without Puppeteer
 */
export async function getChannelLiveVideos(channelUrl: string): Promise<{ 
  videos: ChannelLiveVideo[], 
  error?: string 
}> {
  try {
    // Extract channel ID
    const channelId = extractChannelId(channelUrl);
    if (!channelId) {
      return { videos: [], error: 'Invalid YouTube channel URL' };
    }
    
    // Check cache first
    if (channelCache[channelId] && (Date.now() - channelCache[channelId].timestamp < CHANNEL_CACHE_EXPIRATION)) {
      console.log(`Using cached data for channel ${channelId}`);
      return { videos: channelCache[channelId].videos };
    }
    
    console.log(`Fetching live videos for channel ${channelId} from ${channelUrl}`);
    
    // Determine the URL to fetch based on the channel URL format
    let liveUrl = channelUrl;
    if (liveUrl.includes('/channel/')) {
      // For /channel/ID format
      liveUrl = liveUrl.replace(/\/?$/, '/streams');
    } else if (liveUrl.includes('/c/') || liveUrl.includes('/@')) {
      // For /c/name or /@handle format
      liveUrl = liveUrl.replace(/\/?$/, '/live');
    } else {
      // For any other format, try /live
      liveUrl = `${liveUrl.replace(/\/?$/, '')}/live`;
    }
    
    console.log(`Using URL: ${liveUrl}`);
    
    // Set up headers to mimic a browser request
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    };

    // Fetch the channel page
    const response = await axios.get(liveUrl, { headers });
    const html = response.data;
    
    // Extract channel name
    let channelName = '';
    const channelNameMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
    if (channelNameMatch && channelNameMatch[1]) {
      channelName = channelNameMatch[1].replace(' - YouTube', '').trim();
    }
    
    // Extract initial data from the page
    const initialDataMatch = html.match(/var ytInitialData = ({.*?});/);
    if (!initialDataMatch || !initialDataMatch[1]) {
      return { videos: [], error: 'Failed to extract data from channel page' };
    }
    
    let initialData;
    try {
      initialData = JSON.parse(initialDataMatch[1]);
    } catch (e) {
      return { videos: [], error: 'Failed to parse channel data' };
    }
    
    // Find tab content with videos
    const tabRenderer = findTabRendererWithVideos(initialData);
    if (!tabRenderer) {
      return { videos: [], error: 'No videos tab found on channel page' };
    }
    
    // Extract live videos
    const liveVideos = extractLiveVideosFromTab(tabRenderer, channelName);
    
    // Cache the results
    channelCache[channelId] = {
      videos: liveVideos,
      timestamp: Date.now()
    };
    
    return { videos: liveVideos };
  } catch (error) {
    console.error(`Error fetching channel live videos:`, error);
    return { videos: [], error: `Failed to fetch live videos: ${error}` };
  }
}

/**
 * Helper function to find the tab renderer containing videos
 */
function findTabRendererWithVideos(initialData: any): any {
  // Look for the tab with videos
  const tabs = initialData?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
  
  console.log('Available tabs:', tabs.map((tab: any) => ({
    title: tab.tabRenderer?.title,
    selected: tab.tabRenderer?.selected,
    params: tab.tabRenderer?.endpoint?.browseEndpoint?.params
  })));

  // First priority: Look for Live tab
  for (const tab of tabs) {
    if (tab.tabRenderer?.selected && tab.tabRenderer?.content) {
      console.log('Found selected tab:', tab.tabRenderer.title);
      return tab.tabRenderer.content;
    }
  }

  // Second priority: Look for specific tabs
  for (const tab of tabs) {
    const title = tab.tabRenderer?.title;
    const params = tab.tabRenderer?.endpoint?.browseEndpoint?.params;
    
    if (
      // Live tab
      (title === 'Live' || title === 'LIVE') ||
      // Live tab params
      params?.includes('EgJAAQ%3D%3D') ||
      // Videos tab with live filter
      (title === 'Videos' && params?.includes('live'))
    ) {
      console.log('Found live videos tab:', title);
      return tab.tabRenderer.content;
    }
  }
  
  // Fallback: Look for Videos tab
  for (const tab of tabs) {
    if (tab.tabRenderer?.title === 'Videos') {
      console.log('Falling back to Videos tab');
      return tab.tabRenderer.content;
    }
  }
  
  // Last resort: Return first tab with content
  for (const tab of tabs) {
    if (tab.tabRenderer?.content) {
      console.log('Last resort: using first tab with content:', tab.tabRenderer.title);
      return tab.tabRenderer.content;
    }
  }
  
  console.log('No suitable tab found');
  return null;
}

/**
 * Helper function to extract live videos from tab content
 */
function extractLiveVideosFromTab(tabContent: any, channelName: string): ChannelLiveVideo[] {
  const videos: ChannelLiveVideo[] = [];
  
  // Function to extract number from view count text
  const parseViewCount = (text: string): number => {
    if (!text) return 0;
    
    // Handle "watching now" format
    const match = text.match(/([0-9,]+)/);
    if (match) {
      return parseInt(match[1].replace(/,/g, ''), 10);
    }
    return 0;
  };
  
  // Handle different content structure possibilities
  const itemSections = tabContent?.sectionListRenderer?.contents || [];
  
  // Process each section
  for (const section of itemSections) {
    // Look for item sections with video renderers
    const items = section?.itemSectionRenderer?.contents || [];
    
    for (const item of items) {
      // Check for a grid or list of videos
      const gridItems = item?.gridRenderer?.items || [];
      const shelfItems = item?.shelfRenderer?.content?.gridRenderer?.items || [];
      const allItems = [...gridItems, ...shelfItems];
      
      // Process grid items
      for (const gridItem of allItems) {
        const renderer = gridItem.gridVideoRenderer || gridItem.videoRenderer;
        if (!renderer) continue;
        
        // Check if the video is live
        const badges = renderer.badges || [];
        const thumbnailOverlays = renderer.thumbnailOverlays || [];
        
        // Multiple ways to detect if a video is live:
        // 1. Through badges
        const badgesLive = badges.some((badge: any) => 
          badge.metadataBadgeRenderer?.style?.toLowerCase().includes('live') || 
          badge.metadataBadgeRenderer?.label?.toLowerCase().includes('live')
        );
        
        // 2. Through thumbnail overlays
        const overlayLive = thumbnailOverlays.some((overlay: any) =>
          overlay.thumbnailOverlayTimeStatusRenderer?.style?.toLowerCase() === 'live' ||
          overlay.thumbnailOverlayTimeStatusRenderer?.text?.simpleText?.toLowerCase() === 'live'
        );
        
        // 3. Through view count text
        const viewCountLive = renderer.viewCountText?.runs?.some((run: any) => 
          run.text?.toLowerCase().includes('watching')
        ) || renderer.viewCountText?.simpleText?.toLowerCase().includes('watching');

        // 4. Through accessibility data
        const accessibilityLive = renderer.title?.accessibility?.accessibilityData?.label?.toLowerCase().includes('live');

        const isLive = badgesLive || overlayLive || viewCountLive || accessibilityLive;

        console.log(`Video ${renderer.videoId} live detection:`, {
          badgesLive,
          overlayLive,
          viewCountLive,
          accessibilityLive,
          isLive
        });
        
        if (!isLive) continue;
        
        // Extract video details
        const videoId = renderer.videoId;
        if (!videoId) continue;
        
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        
        // Get title
        let title = 'Live Stream';
        if (renderer.title?.simpleText) {
          title = renderer.title.simpleText;
        } else if (renderer.title?.runs?.[0]?.text) {
          title = renderer.title.runs[0].text;
        }
        
        // Get thumbnail
        let thumbnailUrl = '';
        if (renderer.thumbnail?.thumbnails?.length > 0) {
          thumbnailUrl = renderer.thumbnail.thumbnails[renderer.thumbnail.thumbnails.length - 1].url;
        }
        
        // Get view count
        let viewCount = 0;
        const viewCountTexts = renderer.viewCountText?.runs || [];
        for (const run of viewCountTexts) {
          if (run.text?.includes('watching')) {
            viewCount = parseViewCount(run.text);
            break;
          }
        }
        
        // If no view count found in runs, try simple text
        if (viewCount === 0 && renderer.viewCountText?.simpleText) {
          viewCount = parseViewCount(renderer.viewCountText.simpleText);
        }
        
        // Add to list if not already present
        if (!videos.some(v => v.videoId === videoId)) {
          videos.push({
            videoId,
            videoUrl,
            title,
            thumbnailUrl,
            viewCount,
            channelName
          });
        }
      }
    }
  }
  
  return videos;
} 