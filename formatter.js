import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

const CHECKED_DIR = './checked';

export async function formatAndSaveSubscriptions(database) {
    // Создаем директории
    await mkdir(path.join(CHECKED_DIR, 'providers'), { recursive: true });
    await mkdir(path.join(CHECKED_DIR, 'levels'), { recursive: true });
    
    // Фильтруем только работающие прокси
    const workingProxies = database.filter(p => p.status === 'working');
    
    // Группируем по провайдерам
    const byProvider = {};
    workingProxies.forEach(proxy => {
        const provider = proxy.provider || 'unknown';
        if (!byProvider[provider]) {
            byProvider[provider] = [];
        }
        byProvider[provider].push(proxy.full_link);
    });
    
    // Группируем по уровням
    const byLevel = {};
    workingProxies.forEach(proxy => {
        const level = proxy.level || 'unknown';
        if (!byLevel[level]) {
            byLevel[level] = [];
        }
        byLevel[level].push(proxy.full_link);
    });
    
    // Сохраняем файлы провайдеров
    for (const [provider, links] of Object.entries(byProvider)) {
        const content = links.join('\n');
        const base64Content = Buffer.from(content).toString('base64');
        
        await writeFile(
            path.join(CHECKED_DIR, 'providers', `${provider}.txt`),
            content
        );
        
        await writeFile(
            path.join(CHECKED_DIR, 'providers', `${provider}-base64.txt`),
            base64Content
        );
        
        console.log(`Saved ${links.length} links for provider: ${provider}`);
    }
    
    // Сохраняем файлы уровней
    for (const [level, links] of Object.entries(byLevel)) {
        const content = links.join('\n');
        const base64Content = Buffer.from(content).toString('base64');
        
        await writeFile(
            path.join(CHECKED_DIR, 'levels', `${level}.txt`),
            content
        );
        
        await writeFile(
            path.join(CHECKED_DIR, 'levels', `${level}-base64.txt`),
            base64Content
        );
        
        console.log(`Saved ${links.length} links for level: ${level}`);
    }
}
