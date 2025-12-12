import { readFile } from 'fs/promises';
import fetch from 'node-fetch';

const GIST_IDS = {
    family: 'd20c6624c9c2370931c000cc8caa3023',
    high: 'a676272468c9b6ac804092250ce9bc67'
};

async function updateGist(gistId, fileName, content, token) {
    const url = `https://api.github.com/gists/${gistId}`;
    
    const response = await fetch(url, {
        method: 'PATCH',
        headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            files: {
                [fileName]: {
                    content: content
                }
            }
        })
    });
    
    if (!response.ok) {
        throw new Error(`Failed to update gist ${gistId}: ${response.statusText}`);
    }
    
    return response.json();
}

export async function publishToGists(token) {
    try {
        // Читаем содержимое файла
        const content = await readFile('./checked/levels/high.txt', 'utf-8');
        
        if (!content || content.trim().length === 0) {
            console.log('No content to publish to Gists');
            return;
        }
        
        console.log('Publishing to GitHub Gists...');
        
        // Обновляем opexvpn-family.txt
        await updateGist(GIST_IDS.family, 'opexvpn-family.txt', content, token);
        console.log('✓ Updated opexvpn-family.txt');
        
        // Обновляем opexvpn-high.txt
        await updateGist(GIST_IDS.high, 'opexvpn-high.txt', content, token);
        console.log('✓ Updated opexvpn-high.txt');
        
        console.log('Successfully published to all Gists');
    } catch (error) {
        console.error('Error publishing to Gists:', error.message);
        throw error;
    }
}
