import fetch from 'node-fetch';
import https from 'https';
import { URL } from 'url';

const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

// Парсеры для разных провайдеров
const PARSERS = {
    abvpn: {
        detect: (url) => url.includes('abvpn.ru'),
        parse: parseAbvpnSubscription
    }
};

// Парсер для AbVPN
function parseAbvpnServerName(name) {
    const separator = '❯';
    const parts = name.split(separator).map(p => p.trim());
    const isPro = name.includes('PRO');
    const flag = name.match(/^\p{Regional_Indicator}\p{Regional_Indicator}/u)?.[0] || '';
    
    let country = '', serverNumber = null, purpose = null;

    try {
        if (isPro) {
            const geoPart = parts[1] || '';
            const purposePart = parts[2] || '';
            const geoMatch = geoPart.match(/^(.*?)#(\d+)$/);
            if (geoMatch) {
                country = geoMatch[1].trim();
                serverNumber = parseInt(geoMatch[2], 10);
            }
            if (purposePart && purposePart !== 'XRay abvpn') purpose = purposePart;
        } else {
            const geoPart = parts[0] || '';
            const purposePart = parts[1] || '';
            const geoText = geoPart.replace(flag, '').trim();
            const geoMatch = geoText.match(/^(.*?)(?:#(\d+))?$/);
            if (geoMatch) {
                country = geoMatch[1].trim();
                serverNumber = geoMatch[2] ? parseInt(geoMatch[2], 10) : null;
            }
            if (purposePart && purposePart !== 'XRay abvpn') purpose = purposePart;
        }
    } catch (e) {
        console.error(`Error parsing name: "${name}"`, e);
    }

    return { flag, country, serverNumber, purpose, isPro };
}

async function parseAbvpnSubscription(url, content) {
    const lines = content.split('\n');
    const servers = [];
    
    // Извлекаем userId из URL
    const pathParts = new URL(url).pathname.split('/');
    const userId = pathParts[pathParts.length - 2];
    
    for (const line of lines) {
        if (line.includes('://') && !line.startsWith('#')) {
            try {
                const linkUrl = new URL(line);
                const fullLink = line;
                const link = line.split('#')[0];
                const name = decodeURIComponent(linkUrl.hash.substring(1));
                const parsedName = parseAbvpnServerName(name);
                
                servers.push({
                    provider: 'abvpn',
                    level: 'high',
                    userId,
                    address: linkUrl.hostname,
                    name,
                    link,
                    full_link: fullLink,
                    ...parsedName
                });
            } catch (e) {
                console.error(`Could not parse link: ${line}`, e);
            }
        }
    }
    
    return servers;
}

async function fetchSubscription(url) {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(url, {
            agent: url.startsWith('https') ? httpsAgent : undefined,
            signal: controller.signal
        });
        
        clearTimeout(timeout);
        const content = await response.text();
        
        // Пробуем декодировать как base64
        try {
            const decoded = Buffer.from(content, 'base64').toString('utf-8');
            if (decoded.includes('://')) {
                return decoded;
            }
        } catch (e) {
            // Not base64
        }
        
        return content;
    } catch (error) {
        throw error;
    }
}

export async function collectLinks(sourceUrl, level = 'high') {
    console.log(`Collecting links from: ${sourceUrl}`);
    
    try {
        // Загружаем список источников
        const response = await fetch(sourceUrl);
        const sources = (await response.text())
            .trim()
            .split('\n')
            .filter(line => line.trim());
        
        const allServers = [];
        
        for (const source of sources) {
            try {
                if (source.startsWith('http://') || source.startsWith('https://')) {
                    // Это подписка
                    const content = await fetchSubscription(source);
                    
                    // Определяем парсер
                    let parser = null;
                    for (const [name, config] of Object.entries(PARSERS)) {
                        if (config.detect(source)) {
                            parser = config;
                            break;
                        }
                    }
                    
                    if (parser) {
                        const servers = await parser.parse(source, content);
                        servers.forEach(s => s.level = level);
                        allServers.push(...servers);
                    } else {
                        // Если парсер не найден, добавляем как обычные ссылки
                        const lines = content.trim().split('\n').filter(line => line.includes('://'));
                        for (const line of lines) {
                            const link = line.split('#')[0];
                            const name = line.includes('#') ? 
                                decodeURIComponent(line.split('#')[1]) : 'Unknown';
                            
                            allServers.push({
                                provider: 'unknown',
                                level,
                                name,
                                link,
                                full_link: line
                            });
                        }
                    }
                } else if (source.includes('://')) {
                    // Обычная прокси ссылка
                    const link = source.split('#')[0];
                    const name = source.includes('#') ? 
                        decodeURIComponent(source.split('#')[1]) : 'Unknown';
                    
                    allServers.push({
                        provider: 'unknown',
                        level,
                        name,
                        link,
                        full_link: source
                    });
                }
            } catch (error) {
                console.error(`Error processing source ${source}:`, error.message);
            }
        }
        
        // Merge дубликатов по адресу
        const mergedServers = new Map();
        for (const server of allServers) {
            const key = server.link;
            const existing = mergedServers.get(key);
            
            // Приоритет отдаем записям с большим количеством информации
            if (!existing || (server.userId && !existing.userId)) {
                mergedServers.set(key, server);
            }
        }
        
        return Array.from(mergedServers.values());
    } catch (error) {
        console.error('Error collecting links:', error);
        return [];
    }
}
