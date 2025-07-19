import { extractYouTubeTokens, fetchVideoMetadata, isValidYouTubeUrl, extractVideoId } from '../utils/directTokenExtractor.js';

// Cache for channel names to avoid repeated scraping
const channelNameCache = {};
// Cache expiration time (24 hours)
const CHANNEL_CACHE_EXPIRATION = 24 * 60 * 60 * 1000;

// Helper function to extract channel name from HTML anchor or other formats
function extractChannelNameFromHTML(html) {
  // Pattern for <a> tag with channel info
  const anchorPattern = /<a[^>]*href="\/(@[^"]+)"[^>]*>([^<]+)<\/a>/;
  const match = html.match(anchorPattern);
  
  if (match && match[2]) {
    return match[2].trim();
  }
  
  return null;
}

/**
 * Extracts metadata from the YouTube API response
 */
function parseMetadata(data, videoUrl, videoId, source = 'primary', extractedChannelName = null) {
  try {
    // Default values if parsing fails
    const metadata = {
      videoId,
      videoUrl,
      viewCount: 0,
      likeCount: 0,
      isLive: false
    };

    // Check if we have a cached channel name for this video ID
    if (channelNameCache[videoId] && Date.now() - channelNameCache[videoId].timestamp < CHANNEL_CACHE_EXPIRATION) {
      metadata.channelName = channelNameCache[videoId].name;
      console.log(`Using cached channel name for ${videoId}: ${metadata.channelName}`);
    } else if (extractedChannelName) {
      // Use the extracted channel name and cache it
      metadata.channelName = extractedChannelName;
      channelNameCache[videoId] = {
        name: extractedChannelName,
        timestamp: Date.now()
      };
      console.log(`Cached new channel name for ${videoId}: ${metadata.channelName}`);
    }

    // Log what data structure we're working with
    console.log(`\n🔍 Parsing metadata from ${source} source for ${videoId}`);
    console.log(`Data type: ${typeof data}, keys:`, Object.keys(data || {}));

    if (!data) {
      console.log(`❌ No data provided for ${videoId}`);
      return metadata;
    }

    // Try different approaches to extract metadata
    let videoDetails = null;
    let microformat = null;

    // Method 1: Look for videoDetails in the data
    if (data.videoDetails) {
      videoDetails = data.videoDetails;
      console.log(`✅ Found videoDetails for ${videoId}`);
    }

    // Method 2: Look for microformat data
    if (data.microformat && data.microformat.playerMicroformatRenderer) {
      microformat = data.microformat.playerMicroformatRenderer;
      console.log(`✅ Found microformat for ${videoId}`);
    }

    // Method 3: Check if data itself is the videoDetails
    if (data.title && data.viewCount !== undefined) {
      videoDetails = data;
      console.log(`✅ Data itself appears to be videoDetails for ${videoId}`);
    }

    // Extract title
    if (videoDetails) {
      if (videoDetails.title) {
        if (typeof videoDetails.title === 'string') {
          metadata.title = videoDetails.title;
        } else if (videoDetails.title.runs && Array.isArray(videoDetails.title.runs)) {
          metadata.title = videoDetails.title.runs.map(run => run.text).join('');
        } else if (videoDetails.title.simpleText) {
          metadata.title = videoDetails.title.simpleText;
        } else {
          console.log(`⚠️ Unknown title format for ${videoId}:`, typeof videoDetails.title);
        }
      }

      // Extract view count
      if (videoDetails.viewCount !== undefined) {
        if (typeof videoDetails.viewCount === 'number') {
          metadata.viewCount = videoDetails.viewCount;
        } else if (typeof videoDetails.viewCount === 'string') {
          metadata.viewCount = parseInt(videoDetails.viewCount) || 0;
        }
      }

      // Extract live status
      if (videoDetails.isLive !== undefined) {
        metadata.isLive = Boolean(videoDetails.isLive);
      } else if (videoDetails.isLiveContent !== undefined) {
        metadata.isLive = Boolean(videoDetails.isLiveContent);
      }

      // Channel name from videoDetails
      if (videoDetails.author && !metadata.channelName) {
        metadata.channelName = videoDetails.author;
        // Cache the channel name
        channelNameCache[videoId] = {
          name: videoDetails.author,
          timestamp: Date.now()
        };
        console.log(`Extracted and cached channel name from videoDetails: ${metadata.channelName}`);
      }

      console.log(`📊 Extracted from videoDetails - Title: ${metadata.title}, Views: ${metadata.viewCount}, Live: ${metadata.isLive}`);
    }

    // Try microformat if we don't have complete data
    if (microformat && (!metadata.title || !metadata.viewCount)) {
      if (microformat.title && !metadata.title) {
        if (typeof microformat.title === 'string') {
          metadata.title = microformat.title;
        } else if (microformat.title.simpleText) {
          metadata.title = microformat.title.simpleText;
        }
      }

      if (microformat.viewCount && !metadata.viewCount) {
        metadata.viewCount = parseInt(microformat.viewCount) || 0;
      }

      if (microformat.liveBroadcastDetails && microformat.liveBroadcastDetails.isLiveNow !== undefined) {
        metadata.isLive = Boolean(microformat.liveBroadcastDetails.isLiveNow);
      }

      console.log(`📊 Enhanced with microformat - Title: ${metadata.title}, Views: ${metadata.viewCount}, Live: ${metadata.isLive}`);
    }

    // Try to extract like count from engagement data or other sources
    if (data.contents && data.contents.videoDetails && data.contents.videoDetails.engagementPanels) {
      // Look through engagement panels for like information
      const panels = data.contents.videoDetails.engagementPanels;
      for (const panel of panels) {
        // This is a simplified approach - the actual structure may vary
        if (panel.engagementPanelSectionListRenderer && panel.engagementPanelSectionListRenderer.content) {
          // Try to find like count in the engagement data
          // This would need more specific parsing based on YouTube's data structure
        }
      }
    }

    // Ensure we have at least a basic title
    if (!metadata.title) {
      metadata.title = `Video ${videoId}`;
      console.log(`⚠️ No title found, using fallback for ${videoId}`);
    }

    console.log(`✅ Final metadata for ${videoId}:`, {
      title: metadata.title,
      viewCount: metadata.viewCount,
      likeCount: metadata.likeCount,
      isLive: metadata.isLive,
      channelName: metadata.channelName
    });

    return metadata;

  } catch (error) {
    console.error(`❌ Error parsing metadata for ${videoId}:`, error);
    return {
      videoId,
      videoUrl,
      title: `Video ${videoId}`,
      viewCount: 0,
      likeCount: 0,
      isLive: false,
      error: error.message
    };
  }
}

/**
 * Main function to get video metadata from multiple YouTube URLs
 */
export async function getVideoMetadata(urls) {
  console.log('\n=== Starting Video Metadata Fetch ===');
  console.log(`URLs to process: ${urls.length}`);

  const metadataList = [];
  const errors = [];

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
      // Extract tokens and metadata
      console.log(`🔍 Extracting metadata for ${videoId}...`);
      const tokens = await extractYouTubeTokens(url);
      
      if (!tokens) {
        console.log(`❌ Could not extract tokens for ${videoId}, trying direct metadata fetch...`);
        
        // Try direct metadata fetch as fallback
        try {
          const directMetadata = await fetchVideoMetadata(videoId);
          if (directMetadata) {
            const metadata = parseMetadata(directMetadata, url, videoId, 'direct');
            metadataList.push(metadata);
            continue;
          }
        } catch (directError) {
          console.error(`❌ Direct metadata fetch also failed for ${videoId}:`, directError.message);
        }
        
        errors.push(`Could not extract metadata for video: ${videoId}`);
        continue;
      }

      // Extract channel name from the tokens if available
      let extractedChannelName = null;
      if (tokens.channelName) {
        extractedChannelName = tokens.channelName;
      } else if (tokens.pageData) {
        // Try to extract channel name from page data
        const channelNameMatch = tokens.pageData.match(/"ownerChannelName":"([^"]+)"/);
        if (channelNameMatch) {
          extractedChannelName = channelNameMatch[1];
        }
      }

      console.log(`✅ Tokens extracted for ${videoId}${extractedChannelName ? `, channel: ${extractedChannelName}` : ''}`);
      
      // Try to get detailed metadata
      let detailedMetadata = null;
      try {
        detailedMetadata = await fetchVideoMetadata(videoId);
        console.log(`✅ Detailed metadata fetched for ${videoId}`);
      } catch (metadataError) {
        console.log(`⚠️ Could not fetch detailed metadata for ${videoId}:`, metadataError.message);
      }

      // Parse metadata from available sources
      const primarySource = detailedMetadata || tokens.metadata || {};
      const metadata = parseMetadata(primarySource, url, videoId, 'combined', extractedChannelName);
      
      // If we have tokens.title and no title was found, use it
      if (!metadata.title && tokens.title) {
        metadata.title = tokens.title;
        console.log(`📝 Using title from tokens: ${metadata.title}`);
      }

      metadataList.push(metadata);
      console.log(`✅ Added metadata for ${videoId} to results`);

    } catch (error) {
      console.error(`❌ Error processing ${videoId}:`, error.message);
      errors.push(`Error fetching metadata for video ${videoId}: ${error.message}`);
      
      // Add a basic metadata entry even if there was an error
      metadataList.push({
        videoId,
        videoUrl: url,
        title: `Video ${videoId}`,
        viewCount: 0,
        likeCount: 0,
        isLive: false,
        error: error.message
      });
    }
  }

  console.log(`\n=== Video Metadata Fetch Complete ===`);
  console.log(`Total metadata entries: ${metadataList.length}`);
  console.log(`Errors encountered: ${errors.length}`);
  console.log(`========================================\n`);

  return {
    metadata: metadataList,
    errors: errors,
    totalVideos: metadataList.length,
    timestamp: new Date().toISOString()
  };
} 