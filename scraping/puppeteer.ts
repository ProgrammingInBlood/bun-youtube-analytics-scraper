import puppeteer, { Browser, Page } from 'puppeteer-core';

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

// Singleton browser instance
let browserInstance: Browser | null = null;

// Lock to prevent race conditions when creating browser
let browserCreationInProgress = false;
let browserCreationPromise: Promise<Browser> | null = null;

// Track active pages by video URL
const activePages: Map<string, Page> = new Map();

// Function to check if running on Android
function isRunningOnAndroid(): boolean {
  return process.platform === 'android' || 
         /android/i.test(process.env.TERMUX_VERSION || '') || 
         /android/i.test(process.env.PREFIX || '');
}

// Get or create a shared browser instance
async function getBrowser(): Promise<Browser> {
  // If browser is already connected, return it
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }
  
  // If browser creation is already in progress, wait for it
  if (browserCreationInProgress && browserCreationPromise) {
    console.log('Browser creation already in progress, waiting...');
    return browserCreationPromise;
  }
  
  // Set lock to prevent parallel browser creation
  browserCreationInProgress = true;
  
  // Create a new promise for the browser creation
  browserCreationPromise = (async () => {
    try {
      // Close any existing browser instance
      if (browserInstance) {
        try {
          console.log('Closing existing disconnected browser...');
          await browserInstance.close();
        } catch (e) {
          console.log('Failed to close existing browser:', e);
        }
        browserInstance = null;
      }
      
      // We need to create a new browser
      console.log('Launching new browser instance...');
      
      // Determine browser launch options based on environment
      const isAndroid = isRunningOnAndroid();
      
      let browser: Browser;
      
      if (isAndroid) {
        console.log('Running on Android/Termux, connecting to installed Chromium...');
        
        // On Android/Termux, we connect to an existing Chromium installation
        browser = await puppeteer.connect({
          browserURL: 'http://localhost:9222',
          defaultViewport: {
            width: 1280,
            height: 720
          }
        });
        
        console.log('Successfully connected to Chromium browser on Termux');
      } else {
        // Standard environment - launch browser with appropriate arguments
        browser = await puppeteer.launch({
          headless: true,
          executablePath: process.env.CHROME_PATH, // Allow custom Chrome path via env variable
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1280,720'
          ]
        });
      }
      
      // Close the initial blank tab that Puppeteer creates
      const pages = await browser.pages();
      if (pages.length > 0) {
        await pages[0].close();
        console.log('Closed initial blank tab');
      }
      
      // When browser closes, clear our reference
      browser.on('disconnected', () => {
        console.log('Browser disconnected - clearing references');
        if (browserInstance === browser) {
          browserInstance = null;
        }
        activePages.clear();
      });
      
      // Store the browser instance
      browserInstance = browser;
      return browser;
    } finally {
      // Release the lock
      browserCreationInProgress = false;
      browserCreationPromise = null;
    }
  })();
  
  return browserCreationPromise;
}

// Extend Window interface to include YouTube-specific properties
declare global {
  interface Window {
    ytcfg?: {
      data_?: Record<string, string>;
    };
    ytInitialData?: any;
  }
}

/**
 * Extracts required tokens from a YouTube live video page
 */
export async function extractYouTubeTokens(videoUrl: string) {
  console.log(`Processing video URL: ${videoUrl}`);
  
  // Check cache first
  const cachedData = tokenCache[videoUrl];
  if (cachedData && Date.now() - cachedData.timestamp < CACHE_EXPIRATION) {
    console.log(`Using cached tokens for ${videoUrl}`);
    return cachedData;
  }

  // If we already have an active page for this URL, reuse it
  let page = activePages.get(videoUrl);
  
  // If no existing page but we're already processing this URL, wait
  if (!page && activePages.size > 0) {
    console.log(`Active pages detected (${activePages.size}). Waiting to see if tokens become available...`);
    // Wait a bit and check cache again
    await new Promise(resolve => setTimeout(resolve, 2000));
    const refreshedCache = tokenCache[videoUrl];
    if (refreshedCache) {
      console.log(`Tokens became available while waiting for ${videoUrl}`);
      return refreshedCache;
    }
  }
  
  try {
    // Get browser instance
    const browser = await getBrowser();
    
    // Create a new page if we don't have one
    if (!page) {
      console.log(`Creating new tab for ${videoUrl}`);
      page = await browser.newPage();
      activePages.set(videoUrl, page);
    }
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    // Navigate to the video URL
    console.log(`Navigating to ${videoUrl}`);
    await page.goto(videoUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Wait for the live chat iframe to be available
    console.log(`Waiting for chat frame on ${videoUrl}`);
    await page.waitForSelector('iframe#chatframe', { timeout: 10000 });
    
    // Extract ytcfg data which contains API key and client version
    console.log(`Extracting tokens from ${videoUrl}`);
    const ytcfgData = await page.evaluate(() => {
      return window.ytcfg?.data_ || {};
    }) as Record<string, string>;

    // Extract the chat continuation token
    const liveChatToken = await page.evaluate(() => {
      const initialData = window.ytInitialData || {};
      const liveChatRenderer = initialData?.contents?.twoColumnWatchNextResults?.conversationBar?.liveChatRenderer;
      return liveChatRenderer?.continuations?.[0]?.reloadContinuationData?.continuation || '';
    });

    // Get page HTML for additional parsing if needed
    const rawHtml = await page.content();

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
    
    // Close the page
    console.log(`Closing tab for ${videoUrl}`);
    if (page) {
      await page.close();
      activePages.delete(videoUrl);
    }
    
    return result;
  } catch (error) {
    console.error(`Error extracting YouTube tokens for ${videoUrl}:`, error);
    throw new Error(`Failed to extract tokens from YouTube: ${error}`);
  } finally {
    // Remove URL from active processing list
    if (activePages.has(videoUrl)) {
      try {
        const page = activePages.get(videoUrl);
        if (page && !page.isClosed()) {
          await page.close();
        }
      } catch (e) {
        console.error(`Error closing page for ${videoUrl}:`, e);
      }
      activePages.delete(videoUrl);
    }
  }
}

/**
 * Logs info about all pages currently open in the browser
 */
async function logOpenPages() {
  if (!browserInstance) return;
  
  try {
    const pages = await browserInstance.pages();
    console.log(`--- Current browser status ---`);
    console.log(`Total open tabs: ${pages.length}`);
    console.log(`Active URLs tracked: ${[...activePages.keys()].join(', ') || 'none'}`);
    
    for (let i = 0; i < pages.length; i++) {
      const url = pages[i].url();
      console.log(`Tab ${i+1}: ${url || 'blank'}`);
    }
    console.log(`---------------------------`);
  } catch (e) {
    console.error('Error logging page info:', e);
  }
}

/**
 * Closes the shared browser instance if it exists
 */
export async function closeBrowser() {
  console.log('Attempting to close all Puppeteer resources...');
  
  // Log the current state of pages
  await logOpenPages();
  
  try {
    // Close all active pages first
    if (browserInstance) {
      const pages = await browserInstance.pages();
      console.log(`Closing ${pages.length} open pages/tabs...`);
      
      await Promise.all(pages.map(async (page) => {
        try {
          if (!page.isClosed()) {
            await page.close();
          }
        } catch (e) {
          console.error('Error closing page:', e);
        }
      }));
    }
    
    // Then close the browser itself
    if (browserInstance) {
      console.log('Closing browser instance...');
      await browserInstance.close();
      browserInstance = null;
    }
    
    // Clear any other state
    activePages.clear();
    console.log('All Puppeteer resources have been closed.');
    
    return true;
  } catch (error) {
    console.error('Error during Puppeteer cleanup:', error);
    // Force browser process termination as a last resort
    try {
      if (browserInstance) {
        // @ts-ignore - Accessing internal property for emergency cleanup
        const pid = browserInstance.process()?.pid;
        if (pid) {
          console.log(`Forcefully terminating browser process (PID: ${pid})...`);
          process.kill(pid);
        }
      }
    } catch (e) {
      console.error('Failed to forcefully terminate browser process:', e);
    }
    
    // Reset state even if cleanup failed
    browserInstance = null;
    activePages.clear();
    
    throw error;
  }
}

/**
 * Fetches live chat messages using YouTube's internal API
 */
export async function fetchLiveChatMessages(videoUrl: string, tokens: any) {
  const { apiKey, clientVersion, visitorData, continuationToken } = tokens;
  
  if (!apiKey || !clientVersion || !continuationToken) {
    throw new Error('Missing required tokens for fetching live chat');
  }

  const response = await fetch(
    `https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?prettyPrint=false&key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
      body: JSON.stringify({
        context: {
          client: {
            visitorData,
            clientVersion,
            clientName: 'WEB',
            clientFormFactor: 'UNKNOWN_FORM_FACTOR',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          }
        },
        continuation: continuationToken
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch live chat: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return { data, videoUrl };
}

/**
 * Fetches video metadata (likes, views) using YouTube's internal API
 */
export async function fetchVideoMetadata(videoUrl: string, tokens: any) {
  const { apiKey, clientVersion, visitorData } = tokens;
  
  if (!apiKey || !clientVersion) {
    throw new Error('Missing required tokens for fetching video metadata');
  }

  const videoId = extractVideoId(videoUrl);
  if (!videoId) {
    throw new Error('Invalid YouTube URL');
  }

  let rawHtml = tokens.rawHtml || '';
  let channelName = null;
  
  // If we have raw HTML, try to extract the channel name
  if (rawHtml) {
    // Look for channel name in typical YouTube format
    const channelPattern = /<link itemprop="name" content="([^"]+)">/;
    const match = rawHtml.match(channelPattern);
    if (match && match[1]) {
      channelName = match[1];
    }
  }

  // First try with the primary endpoint
  try {
    console.log(`Fetching metadata for ${videoId} using updated_metadata endpoint`);
    const response = await fetch(
      `https://www.youtube.com/youtubei/v1/updated_metadata?prettyPrint=false&key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        },
        body: JSON.stringify({
          context: {
            client: {
              visitorData,
              clientVersion,
              clientName: 'WEB',
              clientFormFactor: 'UNKNOWN_FORM_FACTOR',
              userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            }
          },
          videoId
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch primary metadata: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    // If we don't have useful data, try the backup method
    if (!data.actions || data.actions.length === 0) {
      throw new Error('No action data in primary response');
    }
    
    return { data, videoUrl, videoId, source: 'primary', channelName };
  } catch (primaryError) {
    console.log(`Primary metadata fetch failed, trying backup method: ${primaryError instanceof Error ? primaryError.message : String(primaryError)}`);
    
    // If the primary method fails, try the backup endpoint
    try {
      console.log(`Fetching metadata for ${videoId} using next endpoint`);
      const response = await fetch(
        `https://www.youtube.com/youtubei/v1/next?prettyPrint=false&key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          },
          body: JSON.stringify({
            context: {
              client: {
                visitorData,
                clientVersion,
                clientName: 'WEB',
                clientFormFactor: 'UNKNOWN_FORM_FACTOR',
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
              }
            },
            videoId
          })
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch backup metadata: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return { data, videoUrl, videoId, source: 'backup', channelName };
    } catch (backupError) {
      console.error(`Both metadata methods failed for ${videoId}`, backupError);
      throw new Error(`Failed to fetch video metadata: ${primaryError instanceof Error ? primaryError.message : String(primaryError)}, backup: ${backupError instanceof Error ? backupError.message : String(backupError)}`);
    }
  }
}

/**
 * Extracts video ID from a YouTube URL
 */
export function extractVideoId(url: string): string | null {
  const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

/**
 * Validates if a URL is a YouTube video URL
 */
export function isValidYouTubeUrl(url: string): boolean {
  const patterns = [
    /^https?:\/\/(?:www\.)?youtube\.com\/watch\?v=[\w-]{11}/,
    /^https?:\/\/(?:www\.)?youtu.be\/[\w-]{11}/
  ];
  
  return patterns.some(pattern => pattern.test(url));
}

/**
 * Returns debug information about the current browser state
 */
export async function debugBrowserState() {
  interface TabInfo {
    index: number;
    url?: string;
    title?: string;
    isClosed: boolean;
    error?: string;
  }
  
  interface DebugInfo {
    browserActive: boolean;
    browserCreationInProgress: boolean;
    totalTabs: number;
    activeURLs: string[];
    activePagesCount: number;
    tabDetails: TabInfo[];
    tokenCacheSize: number;
    tokenCacheKeys: string[];
    processInfo: Record<string, any>;
    message?: string;
    error?: string;
  }
  
  const debugInfo: DebugInfo = {
    browserActive: !!browserInstance && browserInstance.isConnected(),
    browserCreationInProgress,
    totalTabs: 0,
    activeURLs: [...activePages.keys()],
    activePagesCount: activePages.size,
    tabDetails: [],
    tokenCacheSize: Object.keys(tokenCache).length,
    tokenCacheKeys: Object.keys(tokenCache),
    processInfo: {}
  };
  
  if (!browserInstance) {
    return {
      ...debugInfo,
      message: 'No browser instance currently active'
    };
  }
  
  try {
    // Get information about the browser process
    try {
      // @ts-ignore - Accessing internal property for debugging
      const process = browserInstance.process();
      if (process) {
        debugInfo.processInfo = {
          pid: process.pid,
          connected: browserInstance.isConnected()
        };
      }
    } catch (e) {
      debugInfo.processInfo = { error: String(e) };
    }
    
    // Get information about open pages
    const pages = await browserInstance.pages();
    debugInfo.totalTabs = pages.length;
    
    debugInfo.tabDetails = await Promise.all(pages.map(async (page, index) => {
      try {
        const url = page.url();
        const title = await page.title().catch(() => 'Unknown');
        
        return {
          index: index + 1,
          url: url || 'blank',
          title,
          isClosed: page.isClosed()
        };
      } catch (e) {
        return {
          index: index + 1,
          error: String(e),
          isClosed: true
        };
      }
    }));
    
    return debugInfo;
  } catch (e) {
    console.error('Error getting browser debug info:', e);
    return {
      ...debugInfo,
      error: String(e)
    };
  }
}

/**
 * Force resets all browser state, closing any existing browsers
 * and clearing all caches. Use this as a last resort.
 */
export async function forceResetBrowserState() {
  // Attempt to close the browser gracefully
  if (browserInstance) {
    try {
      console.log('Force closing browser instance...');
      await browserInstance.close();
    } catch (e) {
      console.error('Error closing browser:', e);
      
      // Try to forcefully terminate the process
      try {
        // @ts-ignore - Accessing internal property for emergency cleanup
        const process = browserInstance.process();
        if (process && process.pid) {
          console.log(`Forcefully terminating browser process (PID: ${process.pid})...`);
          process.kill('SIGKILL');
        }
      } catch (innerError) {
        console.error('Failed to forcefully terminate browser process:', innerError);
      }
    }
  }
  
  // Reset all state
  browserInstance = null;
  browserCreationInProgress = false;
  browserCreationPromise = null;
  activePages.clear();
  
  // Optionally, you could clear token cache as well
  // Object.keys(tokenCache).forEach(key => delete tokenCache[key]);
  
  return {
    success: true,
    message: 'Browser state has been forcefully reset'
  };
} 