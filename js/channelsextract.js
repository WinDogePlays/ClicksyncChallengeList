const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// Function to extract YouTube channel ID from a YouTube URL
function extractChannelIdFromUrl(youtubeUrl) {
    try {
        const urlObj = new URL(youtubeUrl);
        const channelId = urlObj.searchParams.get('channel');
        return channelId ? channelId : null;
    } catch (error) {
        console.error(`Error parsing YouTube URL ${youtubeUrl}: ${error.message}`);
        return null;
    }
}

// Function to extract YouTube channel IDs from a JSON file
function extractChannelIdsFromFile(filePath) {
    try {
        const data = fs.readFileSync(filePath);
        const jsonData = JSON.parse(data);
        const channelIds = [];
        // Assuming the YouTube link is under the 'youtube_link' key in each JSON file
        if (jsonData && jsonData.youtube_link) {
            const channelId = extractChannelIdFromUrl(jsonData.youtube_link);
            if (channelId) {
                channelIds.push(channelId);
            }
        }
        return channelIds;
    } catch (error) {
        console.error(`Error reading file ${filePath}: ${error.message}`);
        return [];
    }
}

// Function to get all JSON files in a directory
function getAllJsonFiles(directoryPath) {
    try {
        const files = fs.readdirSync(directoryPath);
        const jsonFiles = files.filter(file => path.extname(file).toLowerCase() === '.json');
        return jsonFiles.map(file => path.join(directoryPath, file));
    } catch (error) {
        console.error(`Error reading directory ${directoryPath}: ${error.message}`);
        return [];
    }
}

// Main function to extract and deduplicate YouTube channel IDs
function extractAndDeduplicateChannelIds(directoryPath) {
    const allFiles = getAllJsonFiles(path.join(__dirname, '..', 'data'));
    let allChannelIds = [];
    allFiles.forEach(filePath => {
        const channelIds = extractChannelIdsFromFile(filePath);
        allChannelIds = allChannelIds.concat(channelIds);
    });
    // Remove duplicates using Set and convert back to array
    const uniqueChannelIds = [...new Set(allChannelIds)];
    return uniqueChannelIds;
}

// Export the channel IDs to channels.json file
function exportChannelIdsToFile(channelIds, outputFilePath) {
    const data = `const CHANNEL_IDS = ${JSON.stringify(channelIds, null, 4)};\n\nmodule.exports = { CHANNEL_IDS };`;
    fs.writeFileSync(outputFilePath, data);
}

// Example usage:
const dataFolderPath = path.join(__dirname, 'data');
const channelIds = extractAndDeduplicateChannelIds(dataFolderPath);
const outputFilePath = path.join(__dirname, 'channels.json');
exportChannelIdsToFile(channelIds, outputFilePath);
console.log('Channel IDs exported to channels.json file.');
