const axios = require('axios');
const fs = require('fs');
const path = require('path');
const simpleGit = require('simple-git');

// Set up GitHub token
const git = simpleGit({
    baseDir: process.cwd(),
    binary: 'git',
    maxConcurrentProcesses: 6,
    token: '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' // Replace 'YOUR_GITHUB_TOKEN' with your actual GitHub token
});

// Info
const API_KEY = 'AIzaSyBWuUEXnA8kX_VtJBUTLrVANa23MxHoE2M';
const CHANNEL_IDS = ['UCWkpILpuAvrQ-wsRdPuq_hw', 'UCb5HLQzxMnGDig_EdfZIB4A'/*, 'UCrmcOEVif1zsjp_uqnqa5ng'*/];
const VIDEO_TITLE_PREFIX = '[CSCL]';
const CACHE_FILE = 'video_cache.json';
const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1247937993113731082/nu5rAtfZJ4eN3ymCXDYTdFAxjxembNGe8yA_uIvIQ1qkEFEEgiywEBywHIM9w1hDBrcu';
const DISCORD_TEST = 'https://discord.com/api/webhooks/1247974598830456903/25qgEoTVUyOTqLg83LMJitSqfEBhnZNpXsJ1UK4eFWaoVkK9Dfum9pEhApTwfexIkquD';
// Function to fetch channel name
async function getChannelName(channelID) {
  const url = `https://www.googleapis.com/youtube/v3/channels?key=${API_KEY}&id=${channelID}&part=snippet`;
  try {
    const response = await axios.get(url);
    return response.data.items[0].snippet.title;
  } catch (error) {
    console.error('Error fetching channel name:', error);
    return 'Unknown';
  }
}

async function getVideoDetails(videoIds) {
  const url = `https://www.googleapis.com/youtube/v3/videos?key=${API_KEY}&id=${videoIds.join(',')}&part=snippet`;
  try {
    const response = await axios.get(url);
    return response.data.items;
  } catch (error) {
    console.error('Error fetching video details:', error);
    return [];
  }
}


// Function to fetch all videos using pagination and caching
async function getAllVideos(channelID) {
  let videos = [];
  let nextPageToken = '';
  let fetchedFromCache = false;

  // Load cache if it exists
  if (fs.existsSync(CACHE_FILE)) {
    const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    if (cache[channelID]) {
      videos = cache[channelID];
      fetchedFromCache = true;
    }
  }

  if (!fetchedFromCache) {
    do {
      const url = `https://www.googleapis.com/youtube/v3/search?key=${API_KEY}&channelId=${channelID}&part=snippet&order=date&maxResults=50&pageToken=${nextPageToken}`;
      try {
        const response = await axios.get(url);
        const newVideoIds = response.data.items.map(item => item.id.videoId)
          .filter(videoId => !videos.find(video => video.id === videoId)); // Check if video is not already in videos
        const newVideos = await getVideoDetails(newVideoIds);
        videos = videos.concat(newVideos);
        nextPageToken = response.data.nextPageToken || '';
      } catch (error) {
        console.error('Error fetching videos:', error);
        break;
      }
    } while (nextPageToken);

    // Save to cache
    const cache = {};
    if (fs.existsSync(CACHE_FILE)) {
      Object.assign(cache, JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')));
    }
    cache[channelID] = videos;
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  }

  return videos;
}

// Function to filter videos by title prefix
function filterVideos(videos) {
  return videos.filter(video => video.snippet.title.startsWith(VIDEO_TITLE_PREFIX));
}

// Function to extract level name from title
function extractLevelName(title) {
  return title.replace(VIDEO_TITLE_PREFIX, '').trim();
}

// Function to parse additional information from video description
function parseDescription(description, videoChannelName, type) {
  const result = {
    id: 0,
    author: 'NOT FOUND',
    creators: [],
    verifier: 'Unknown',
    verification: '',
    percentToQualify: 100,
    rating: 0.1,
    placement: 'NOT FOUND',
    hz: 240,
    user: 'NOT FOUND',
    gameType: 'NOT FOUND'
  };

  const idMatch = description.match(/ID:\s*(\d+)/i);
  const creatorsMatch = description.match(/Creators?:\s*(.+)/i);
  const ratingMatch = description.match(/(?:Enjoyment|Rating|Rate):\s*(\d+(\.\d+)?)(?:\s*\/\s*10)?/i);
  const placementMatch = description.match(/Placement:\s*(.+)/i);
  const fpsMatch = description.match(/(?:FPS|HZ):\s*(\d+)/i);
  const listuserMatch = description.match(/(?:User|List User|List Username|Username):\s*(.+)/i)
  const gametypeMatch = description.match(/Game Type:\s*(.+)/i);

  //console.log(placementMatch);
  //console.log('Description:', description); // Log the description to verify content
  //console.log('List User Match:', listuserMatch); // Log the match result

  if (idMatch) result.id = parseInt(idMatch[1], 10);
  if (creatorsMatch) result.creators = creatorsMatch[1].split(',').map(creator => creator.trim());

  if (ratingMatch) {
    let rating = parseFloat(ratingMatch[1].replace(',', '.'));
    if (isNaN(rating) || rating <= 0) {
      rating = 0.1;
    }

    if (ratingMatch[1].includes('/')) {
      // Remove "/10" and any surrounding whitespace characters
      ratingMatch[1] = rating.replace(/\/\s*10/, '').trim();
    }

    result.rating = rating;
  }

  if (placementMatch) result.placement = placementMatch[1].trim();
  if (gametypeMatch) result.gameType = gametypeMatch[1].trim();
  if (fpsMatch) result.hz = parseInt(fpsMatch[1], 10);

  if (listuserMatch && listuserMatch[1] !== 'NOT FOUND') {
    result.user = listuserMatch[1].trim(); // Trim whitespace from the matched user
  } else {
    result.user = videoChannelName;
  }

  if (type === 'verifier') {
    const verifierMatch = description.match(/Verifier:\s*(.+)/i);
    if (verifierMatch) result.verifier = verifierMatch[1].trim();
  }

  return result;
}

// Function to send a message to a Discord webhook
async function sendDiscordNotification(record, lineNumber) {
  const payload = {
    content: '',
    embeds: [{
      title: `New Record for Level: ${record.levelName}`,
      fields: [
        { name: 'Level Name(s):', value: record.levelName || 'NOT FOUND' },
        { name: '(Optional) Do you think the level’s list placement is accurate? If no state where it should be:', value: record.placement || 'NOT FOUND' },
        { name: 'Your username for the List:', value: record.user || 'NOT FOUND' },
        { name: 'Game Type (No mods, Mega Hack, Geode):', value: record.gameType || 'NOT FOUND' },
        { name: 'FPS Used:', value: record.hz || 'NOT FOUND' },
        { name: 'Enjoyment: /10', value: record.rating || 'NOT FOUND' },
        { name: 'YouTube Video Link:', value: record.link || 'NOT FOUND' },
        { name: 'Reviewed Line Number:', value: lineNumber.toString() }
      ]
    }]
  };

  try {
    const response = await axios.post(DISCORD_WEBHOOK_URL, payload);
    const rateLimitRemaining = response.headers['x-ratelimit-remaining'];
    const rateLimitResetAfter = response.headers['x-ratelimit-reset-after'];

    console.log('Discord notification sent successfully.');
    
    if (rateLimitRemaining === '0') {
      const delay = (rateLimitResetAfter * 1000) + 1000; // Adding an extra second for safety
      console.log(`Rate limit reached. Waiting for ${delay / 1000} seconds.`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  } catch (error) {
    console.error('Error sending Discord notification:', error);
  }
}

// Function to find the line number of the "reviewed" key in the JSON file
function findReviewedLineNumber(filePath, recordLink) {
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const lines = fileContent.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(`"link": "${recordLink}"`)) {
      // Look for the "reviewed" key after finding the matching record link
      for (let j = i; j < lines.length; j++) {
        if (lines[j].includes('"reviewed"')) {
          return j + 1;  // Line numbers are 1-based
        }
      }
    }
  }
  return -1;  // Return -1 if not found
}

function normalizeYouTubeURL(url) {
  const urlObj = new URL(url);
  if (urlObj.hostname === 'youtu.be') {
    return `https://www.youtube.com/watch?v=${urlObj.pathname.slice(1)}`;
  }
  if (urlObj.hostname === 'www.youtube.com' && urlObj.pathname === '/watch') {
    return `https://www.youtube.com/watch?v=${urlObj.searchParams.get('v')}`;
  }
  return url; // return the original URL if it doesn't match expected patterns
}

// Function to save video information to a JSON file
async function saveToLevelFile(levelName, videos) {
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) {
    console.error('Data directory not found.');
    return;
  }

  const levelFileName = levelName.split(' ').join('_').toLowerCase();
  const filePath = path.join(dataDir, levelFileName + '.json');

  // Default structure for the level file
  const defaultStructure = {
    id: 0,
    name: levelName,
    author: 'Unknown',
    creators: [],
    verifier: 'Unknown',
    verification: '',
    percentToQualify: 100,
    records: []
  };

  // Check if file exists and read the current data
  let data = defaultStructure;
  if (fs.existsSync(filePath)) {
    data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  // Add the other videos to the records
  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    const channelName = await getChannelName(video.snippet.channelId);
    const videoDescription = parseDescription(video.snippet.description, channelName, 'record');
    const videoData = {
      user: videoDescription.user !== 'NOT FOUND' ? videoDescription.user : channelName,
      link: `https://www.youtube.com/watch?v=${video.id}`,
      percent: 100,
      hz: videoDescription.hz,
      rating: videoDescription.rating,
      reviewed: false
    };

    const exists = data.records.some(entry => entry.user === videoData.user && normalizeYouTubeURL(entry.link) === normalizeYouTubeURL(videoData.link));
    if (!exists) {
      data.records.push(videoData);
      console.log(`Added ${videoData.user} to records for video ${video.snippet.title}`);

      // Save the data to file
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      console.log(`Data saved to ${levelName}.json`);

      // Stage changes and commit
      await git.add(filePath);
      await git.commit(`Added ${videoData.user}'s ${levelName} record`);

      // Checkout the branch "automatic-record-finder" if it exists, otherwise create it
      await git.checkout('automatic-record-finder');

      // Pull changes from the remote repository with --allow-unrelated-histories flag
      await git.pull('ClicksyncChallengeList', 'automatic-record-finder', {'--allow-unrelated-histories': null});

      // Push changes to the remote repository on the "automatic-record-finder" branch
      await git.push('ClicksyncChallengeList', 'automatic-record-finder');
    } else {
      console.log(`${videoData.user} already exists in records for video ${video.snippet.title}`);
    }
  }
}


/*async function saveToLevelFile(levelName, videos) {
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) {
    console.error('Data directory not found.');
    return;
  }

  const levelFileName = levelName.split(' ').join('_').toLowerCase();
  const filePath = path.join(dataDir, levelFileName + '.json');

  // Default structure for the level file
  const defaultStructure = {
    id: 0,
    name: levelName,
    author: 'Unknown',
    creators: [],
    verifier: 'Unknown',
    verification: '',
    percentToQualify: 100,
    records: []
  };

  // Check if file exists and read the current data
  let data = defaultStructure;
  if (fs.existsSync(filePath)) {
    data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }/* else {
    // Initialize the file with the default structure if it does not exist
    data.name = levelName;
  }

  // Set the verifier from the first video found if not already set
  if (data.verifier === defaultStructure.verifier) {
    const firstVideo = videos[0];
    const verifierChannelName = await getChannelName(firstVideo.snippet.channelId);
    data.verifier = verifierChannelName;
    data.verification = `https://www.youtube.com/watch?v=${firstVideo.id}`;

    // Parse additional information from the first video description
    //console.log(`Full Description: ${firstVideo.snippet.description}`); // Logging the full description
    const additionalInfo = parseDescription(firstVideo.snippet.description, verifierChannelName, 'verifier');
    data = { ...data, ...additionalInfo };

    // Log verifier info
    console.log(`Verifier set to ${verifierChannelName} for video ${firstVideo.snippet.title}`);
  }*/

  // Add the other videos to the records
  //for (let i = 0; i < videos.length; i++) {
  //  const video = videos[i];
  //  const channelName = await getChannelName(video.snippet.channelId);
    //console.log(`Full Description: ${video.snippet.description}`); // Logging the full description
  //  const videoDescription = parseDescription(video.snippet.description, channelName, 'record');
  //  const videoData = {
  //    user: videoDescription.user !== 'NOT FOUND' ? videoDescription.user : channelName,
  //    link: `https://www.youtube.com/watch?v=${video.id}`,
  //    percent: 100,
  //    hz: videoDescription.hz,
  //   rating: videoDescription.rating,
  //    reviewed: false
  //  };

    //const exists = data.records.some(entry => entry.link === videoData.link);
    /*const exists = data.records.some(entry => entry.user === videoData.user && normalizeYouTubeURL(entry.link) === normalizeYouTubeURL(videoData.link));
    if (!exists) {
      data.records.push(videoData);
      console.log(`Added ${videoData.user} to records for video ${video.snippet.title}`);

      // Save the data to file
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      console.log(`Data saved to ${levelName}.json`);

      // Add the remote repository
      //await git.addRemote('ClicksyncChallengeList', 'https://github.com/WinDogePlays/ClicksyncChallengeList.git');

      // Stage changes and commit
      await git.add(filePath);
      await git.commit(`Added ${videoData.user}'s ${levelName} record`);

      await git.checkout('automatic-record-finder');
      // Push changes to the remote repository
      await git.pull('ClicksyncChallengeList', 'automatic-record-finder', {'--allow-unrelated-histories': null});
      await git.push('ClicksyncChallengeList', 'automatic-record-finder');

      console.log(`Pushed to github`);

      // Find the line number of the "reviewed" key for the added record
      //const lineNumber = findReviewedLineNumber(filePath, videoData.link);
      //await sendDiscordNotification({ ...videoData, levelName, gameType: videoDescription.gameType, placement: videoDescription.placement }, lineNumber);
    } else {
      console.log(`${videoData.user} already exists in records for video ${video.snippet.title}`);
    }
  }

  // Update _list.json
  //const listFilePath = path.join(dataDir, '_list.json');
  //if (fs.existsSync(listFilePath)) {
  //  const listData = JSON.parse(fs.readFileSync(listFilePath, 'utf-8'));
  //  if (!listData.includes(levelFileName)) {
      /*listData.push(levelFileName);
      fs.writeFileSync(listFilePath, JSON.stringify(listData, null, 2));
      console.log(`Added ${levelFileName} to _list.json`);*/
  //    console.log(`${levelFileName}.json doesn't exist.`);
    //}
  //} else {
  //  fs.writeFileSync(listFilePath, JSON.stringify([levelFileName], null, 2));
  //  console.log(`Created and added ${levelFileName} to _list.json`);
  //}
//}*/


// Main execution
(async () => {
  let allMatchingVideos = [];
  for (const channelID of CHANNEL_IDS) {
    const channelName = await getChannelName(channelID);
    const videos = await getAllVideos(channelID);
    const matchingVideos = filterVideos(videos);

    console.log(`Found ${matchingVideos.length} matching videos for channel ${channelID} (${channelName})`);

    if (matchingVideos.length > 0) {
      for (const video of matchingVideos) {
        const levelName = extractLevelName(video.snippet.title);
        await saveToLevelFile(levelName, [video]); // Pass each video as an array to the save function
        console.log(`Saved video for level: ${levelName}`);
      }
      allMatchingVideos = allMatchingVideos.concat(matchingVideos);
    }
  }

  if (allMatchingVideos.length === 0) {
    console.log('No matching videos found across all channels.');
  }
})();