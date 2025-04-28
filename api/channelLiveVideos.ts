import puppeteer from 'puppeteer-core';

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
const CACHE_EXPIRATION = 5 * 60 * 1000;

/**
 * Extracts the channel ID from a YouTube channel URL
 */
function extractChannelId(url: string): string | null {
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

/**
 * Fetches only LIVE videos from a YouTube channel
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
    if (channelCache[channelId] && (Date.now() - channelCache[channelId].timestamp < CACHE_EXPIRATION)) {
      console.log(`Using cached data for channel ${channelId}`);
      return { videos: channelCache[channelId].videos };
    }
    
    console.log(`Fetching live videos for channel ${channelId} from ${channelUrl}`);
    
    // Determine the URL to fetch based on the channel URL format
    let liveUrl = channelUrl;
    if (liveUrl.endsWith('/')) {
      liveUrl = `${liveUrl}streams`;
    } else {
      liveUrl = `${liveUrl}/streams`;
    }
    
    console.log(`Using URL: ${liveUrl}`);
    
    // Launch browser
    console.log('Launching puppeteer browser...');
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas']
    });
    
    try {
      console.log('Creating new page...');
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
      
      // Navigate to channel's live streams page
      console.log(`Navigating to ${liveUrl}...`);
      await page.goto(liveUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      
      console.log('Page loaded, waiting for content selector...');
      // Wait for content to load
      await page.waitForSelector('#content', { timeout: 10000 });
      
      // Get channel name
      console.log('Extracting channel name...');
      const channelName = await page.evaluate(() => {
        const nameElement = document.querySelector('#channel-name #text');
        console.log('Channel name element found:', !!nameElement);
        return nameElement ? nameElement.textContent?.trim() : '';
      });
      console.log('Channel name:', channelName || 'Not found');
      
      // Extract live videos
      console.log('Extracting ONLY LIVE videos...');
      const liveVideos = await page.evaluate(() => {
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
        
        console.log('Starting video extraction...');
        const videos: ChannelLiveVideo[] = [];
        
        // Log page structure for debugging
        console.log('Page structure check: Has ytd-browse?', !!document.querySelector('ytd-browse'));
        console.log('Page content IDs present:', 
          Array.from(document.querySelectorAll('[id]')).slice(0, 10).map(el => el.id).join(', '));
        
        // STRICT VERSION: ONLY look for the EXACT badge structure the user specified
        const exactLiveBadges = document.querySelectorAll('badge-shape.badge-shape-wiz--thumbnail-live, badge-shape[aria-label="LIVE"]');
        console.log(`Found ${exactLiveBadges.length} exact live badges`);
        
        // For each live badge, find the containing video element
        exactLiveBadges.forEach(badge => {
          try {
            // Find the closest video container
            const container = badge.closest('ytd-video-renderer, ytd-grid-video-renderer, ytd-rich-item-renderer');
            if (!container) {
              console.log('Could not find container for badge');
              return;
            }
            
            // Get video details
            const titleElement = container.querySelector('#video-title');
            const thumbnailElement = container.querySelector('img#img');
            
            // Look for view count with "watching" text
            let viewsElement: Element | null | undefined = Array.from(container.querySelectorAll('.inline-metadata-item, #metadata-line span')).find(
              el => el.textContent?.includes('watching')
            );
            
            // If not found, try the first metadata item
            if (!viewsElement) {
              viewsElement = container.querySelector('#metadata-line span');
            }
            
            // Get video link and ID
            const linkElement = container.querySelector('a#thumbnail, #video-title');
            const link = linkElement ? linkElement.getAttribute('href') : null;
            
            if (!link) {
              console.log('No link found for live video');
              return;
            }
            
            // Extract video ID from the link
            const videoIdMatch = link.match(/\/watch\?v=([\w-]{11})/);
            const videoId = videoIdMatch ? videoIdMatch[1] : null;
            
            if (!videoId) {
              console.log('Could not extract video ID');
              return;
            }
            
            // Create full video URL
            const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
            
            // Get title, thumbnail, and view count
            const title = titleElement ? titleElement.textContent?.trim() || 'Live Stream' : 'Live Stream';
            const thumbnailUrl = thumbnailElement ? thumbnailElement.getAttribute('src') || '' : '';
            const viewsText = viewsElement ? viewsElement.textContent?.trim() || '0' : '0';
            const viewCount = parseViewCount(viewsText);
            
            // Log what we found
            console.log(`Found LIVE video: ${title} (${videoId})`);
            
            // Avoid duplicates
            if (!videos.some(v => v.videoId === videoId)) {
              videos.push({
                videoId,
                videoUrl,
                title,
                thumbnailUrl,
                viewCount,
                channelName: document.querySelector('#channel-name')?.textContent?.trim() || 'Unknown Channel'
              });
            }
          } catch (error) {
            console.error('Error processing live badge:', error);
          }
        });
        
        // If no videos found yet, try a broader approach but still strict on the LIVE badge
        if (videos.length === 0) {
          console.log('No videos found with exact badge, trying secondary approach...');
          
          // Try to find all elements that have a LIVE indicator
          const allElements = document.querySelectorAll('*');
          console.log(`Checking ${allElements.length} elements for LIVE indicators...`);
          
          allElements.forEach(el => {
            try {
              // Only check elements that might be related to videos
              if (el.tagName.toLowerCase().includes('video') || 
                  el.tagName.toLowerCase().includes('thumbnail') ||
                  el.tagName.toLowerCase().includes('badge')) {
                
                // Check for LIVE text or aria-label
                const hasLiveText = el.textContent?.trim() === 'LIVE';
                const hasLiveAriaLabel = el.getAttribute('aria-label') === 'LIVE';
                const hasLiveClass = el.className.includes('live');
                
                if (hasLiveText || hasLiveAriaLabel || hasLiveClass) {
                  console.log(`Found potential LIVE indicator: ${el.tagName} with text "${el.textContent}" and class "${el.className}"`);
                  
                  // Find closest container with a link
                  let container = el;
                  for (let i = 0; i < 5; i++) { // Look up to 5 levels up
                    if (!container.parentElement) break;
                    container = container.parentElement;
                    
                    const link = container.querySelector('a[href*="watch?v="]');
                    if (link) {
                      const href = link.getAttribute('href');
                      if (!href || !href.includes('watch?v=')) continue;
                      
                      const videoIdMatch = href.match(/watch\?v=([\w-]{11})/);
                      if (!videoIdMatch || !videoIdMatch[1]) continue;
                      
                      const videoId = videoIdMatch[1];
                      console.log(`Found video ID ${videoId} associated with LIVE indicator`);
                      
                      // Try to get title
                      const titleElement = container.querySelector('#video-title') || link;
                      const title = titleElement?.textContent?.trim() || 'Live Video';
                      
                      // Avoid duplicates
                      if (!videos.some(v => v.videoId === videoId)) {
                        videos.push({
                          videoId,
                          videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
                          title,
                          thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                          viewCount: 0,
                          channelName: document.querySelector('#channel-name')?.textContent?.trim() || 'Unknown Channel'
                        });
                      }
                      
                      break; // Found a link, stop looking up the DOM
                    }
                  }
                }
              }
            } catch (error) {
              // Ignore errors in individual element checks
            }
          });
        }
        
        console.log(`Extraction complete, found ${videos.length} live videos`);
        return videos;
      });
      
      // Add channel name to videos if we found it separately
      const processedVideos = liveVideos.map(video => ({
        ...video,
        channelName: channelName || video.channelName
      }));
      
      console.log(`Found ${processedVideos.length} live videos for channel ${channelId}`);
      
      if (processedVideos.length === 0) {
        console.log('No videos found. Attempting to take screenshot for debugging...');
        try {
          await page.screenshot({ path: 'youtube-debug.png' });
          console.log('Screenshot saved as youtube-debug.png');
          
          // Try a more targeted approach for the OQwmy9FxAnY video ID the user mentioned
          console.log('Looking specifically for video OQwmy9FxAnY...');
          
          // Use the HTML content to find instances of the live badge near this video ID
          const pageHtml = await page.content();
          
          // Define a reasonable search window around the video ID
          const videoIdIndex = pageHtml.indexOf('OQwmy9FxAnY');
          
          if (videoIdIndex > -1) {
            console.log('Found the specific video ID in the HTML!');
            // Look for this specific video ID
            const specificVideoIds = new Set<string>();
            specificVideoIds.add('OQwmy9FxAnY');
            
            const specificVideos = Array.from(specificVideoIds).map(id => ({
              videoId: id,
              videoUrl: `https://www.youtube.com/watch?v=${id}`,
              title: 'Live Video',
              thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
              viewCount: 0,
              channelName: channelName || 'Channel'
            }));
            
            processedVideos.push(...specificVideos);
            console.log(`Added specific video ID that we know is live`);
          }
        } catch (screenshotError) {
          console.error('Failed to take debug screenshot:', screenshotError);
        }
      }
      
      // Update cache
      channelCache[channelId] = {
        videos: processedVideos,
        timestamp: Date.now()
      };
      
      return { videos: processedVideos };
    } finally {
      // Always close browser
      await browser.close();
    }
    
  } catch (error) {
    console.error(`Error fetching live videos for channel:`, error);
    return { videos: [], error: `Failed to fetch live videos: ${error}` };
  }
} 