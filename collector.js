import fetch from 'node-fetch';
import https from 'https';
import { URL } from 'url';
import { spawn } from 'child_process';
import { writeFile } from 'fs/promises';
import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import { SocksProxyAgent } from 'socks-proxy-agent';

const exec = promisify(execCallback);

const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

// Прокси для обхода блокировки lagomvpn
const LAGOM_PROXY_LINK = 'vless://4f297b1c-4c2b-4b23-b724-7c4379f3018a@217.16.16.225:443?security=reality&type=tcp&fp=firefox&sni=www.vk.com&pbk=PL5TmzBOF8lJDXUp1oDM2lHMNk96fmjzmdoq0r9oFR8&sid=719b678d&spx=/';
const LAGOM_PROXY_PORT = 30000;

let lagomProxyProcess = null;
let lagomProxyAgent = null;

// Запуск прокси для lagomvpn через Singbox
async function startLagomProxy() {
    if (lagomProxyProcess) return;
    
    console.log('Starting proxy for lagomvpn subscriptions...');
    
    // Конфигурация Singbox с vless прокси
    const config = {
        log: {
            level: "error"
        },
        inbounds: [{
            type: "socks",
            tag: "socks-in",
            listen: "127.0.0.1",
            listen_port: LAGOM_PROXY_PORT,
            sniff: false
        }],
        outbounds: [{
            type: "vless",
            tag: "proxy",
            server: "217.16.16.225",
            server_port: 443,
            uuid: "4f297b1c-4c2b-4b23-b724-7c4379f3018a",
            flow: "xtls-rprx-vision",
            tls: {
                enabled: true,
                server_name: "www.vk.com",
                reality: {
                    enabled: true,
                    public_key: "PL5TmzBOF8lJDXUp1oDM2lHMNk96fmjzmdoq0r9oFR8",
                    short_id: "719b678d"
                },
                utls: {
                    enabled: true,
                    fingerprint: "firefox"
                }
            },
            transport: {
                type: "tcp"
            }
        }],
        route: {
            rules: [{
                inbound: ["socks-in"],
                outbound: "proxy"
            }]
        }
    };
    
    // Сохраняем конфигурацию
    const configPath = './lagom_proxy_temp.json';
    await writeFile(configPath, JSON.stringify(config, null, 2));
    
    return new Promise((resolve, reject) => {
        lagomProxyProcess = spawn('sing-box', ['run', '-c', configPath], {
            stdio: ['ignore', 'pipe', 'pipe']
        });
        
        let started = false;
        const checkStarted = (data) => {
            const output = data.toString();
            if (!started && (output.includes('started') || output.includes('listening'))) {
                started = true;
                lagomProxyAgent = new SocksProxyAgent(`socks5://127.0.0.1:${LAGOM_PROXY_PORT}`);
                setTimeout(() => resolve(), 2000);
            }
        };
        
        lagomProxyProcess.stdout.on('data', checkStarted);
        lagomProxyProcess.stderr.on('data', checkStarted);
        
        lagomProxyProcess.on('error', reject);
        
        // Даем время на запуск
        setTimeout(() => {
            if (!started) {
                lagomProxyAgent = new SocksProxyAgent(`socks5://127.0.0.1:${LAGOM_PROXY_PORT}`);
                resolve();
            }
        }, 5000);
    });
}

// Остановка прокси для lagomvpn
async function stopLagomProxy() {
    if (lagomProxyProcess) {
        lagomProxyProcess.kill('SIGTERM');
        await new Promise(resolve => setTimeout(resolve, 1000));
        try {
            process.kill(lagomProxyProcess.pid, 0);
            lagomProxyProcess.kill('SIGKILL');
        } catch (e) {
            // Process already dead
        }
        lagomProxyProcess = null;
        lagomProxyAgent = null;
        await exec('rm -f ./lagom_proxy_temp.json').catch(() => {});
    }
}

// Парсеры для разных провайдеров
const PARSERS = {
    abvpn: {
        detect: (url) => url.includes('abvpn.ru'),
        parse: parseAbvpnSubscription
    },
    lagomvpn: {
        detect: (url) => url.includes('williamsbakery.life'),
        parse: parseLagomSubscription,
        requiresProxy: true
    },
    tgvpnbot: {
        detect: (url) => url.includes('tgvpnbot.com'),
        parse: parseTgvpnbotSubscription
    }
};

// Функция для преобразования кода страны в флаг
function getFlagEmoji(countryCode) {
    if (!countryCode || countryCode.length !== 2) {
        return '❓';
    }
    const codePoints = countryCode
        .toUpperCase()
        .split('')
        .map(char => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
}

// Словари для парсинга lagomvpn
const countryAliasMap = { 'USA': 'US', 'UK': 'GB', 'GER': 'DE' };
const countryCodeToNameMap = {
    'DE': 'Германия', 'FR': 'Франция', 'GB': 'Великобритания', 'NL': 'Нидерланды',
    'SE': 'Швеция', 'CH': 'Швейцария', 'IT': 'Италия', 'ES': 'Испания',
    'PL': 'Польша', 'NO': 'Норвегия', 'FI': 'Финляндия', 'IE': 'Ирландия',
    'BE': 'Бельгия', 'AT': 'Австрия', 'DK': 'Дания', 'CZ': 'Чехия',
    'HU': 'Венгрия', 'RO': 'Румыния', 'BG': 'Болгария', 'GR': 'Греция',
    'PT': 'Португалия', 'LV': 'Латвия', 'LT': 'Литва', 'EE': 'Эстония',
    'UA': 'Украина', 'MD': 'Молдова', 'JP': 'Япония', 'SG': 'Сингапур',
    'KR': 'Южная Корея', 'HK': 'Гонконг', 'IN': 'Индия', 'TR': 'Турция',
    'AE': 'ОАЭ', 'IL': 'Израиль', 'TW': 'Тайвань', 'MY': 'Малайзия',
    'VN': 'Вьетнам', 'TH': 'Таиланд', 'ID': 'Индонезия', 'KZ': 'Казахстан',
    'US': 'США', 'CA': 'Канада', 'BR': 'Бразилия', 'MX': 'Мексика',
    'AR': 'Аргентина', 'CL': 'Чили', 'AU': 'Австралия', 'NZ': 'Новая Зеландия',
    'ZA': 'Южная Африка', 'RU': 'Россия'
};
const countryNameToCodeMap = Object.fromEntries(
    Object.entries(countryCodeToNameMap).map(([code, name]) => [name, code])
);

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

// Парсер для Lagom VPN
async function parseLagomSubscription(url, content) {
    try {
        // Сначала пробуем парсить HTML страницу
        const match = content.match(/data-panel="([^"]+)"/);
        
        if (match && match[1]) {
            // Это HTML страница с base64 данными
            const base64Data = match[1];
            const decodedJsonString = Buffer.from(base64Data, 'base64').toString('utf8');
            const data = JSON.parse(decodedJsonString);
            
            const response = data.response;
            if (!response || !response.links) {
                throw new Error('Invalid lagom response format');
            }
            
            const servers = [];
            const trafficInfo = {
                used: response.user?.trafficUsed || '0',
                limit: response.user?.trafficLimit || '0',
                username: response.user?.username || 'unknown'
            };
            
            for (const link of response.links) {
                const linkUrl = new URL(link);
                const fullLink = link;
                const baseLink = link.split('#')[0];
                const name = decodeURIComponent(linkUrl.hash.substring(1));
                
                const parsedInfo = parseLagomServerName(name, linkUrl.hostname);
                
                servers.push({
                    provider: 'lagomvpn',
                    level: 'high',
                    userId: response.user?.shortUuid || url.split('/').pop(),
                    username: response.user?.username,
                    trafficUsed: response.user?.trafficUsed,
                    trafficLimit: response.user?.trafficLimit,
                    address: linkUrl.hostname,
                    name,
                    link: baseLink,
                    full_link: fullLink,
                    ...parsedInfo,
                    trafficInfo
                });
            }
            
            return servers;
        } else {
            // Пробуем как обычный список ссылок
            const lines = content.split('\n').filter(line => line.includes('://'));
            const servers = [];
            
            for (const line of lines) {
                const linkUrl = new URL(line);
                const fullLink = line;
                const baseLink = line.split('#')[0];
                const name = decodeURIComponent(linkUrl.hash.substring(1));
                
                const parsedInfo = parseLagomServerName(name, linkUrl.hostname);
                
                servers.push({
                    provider: 'lagomvpn',
                    level: 'high',
                    address: linkUrl.hostname,
                    name,
                    link: baseLink,
                    full_link: fullLink,
                    ...parsedInfo
                });
            }
            
            return servers;
        }
    } catch (e) {
        console.error('Error parsing lagom subscription:', e);
        return [];
    }
}

function parseLagomServerName(name, host) {
    const is_pro = host.startsWith('pro-');
    const flagMatch = name.match(/(\p{Regional_Indicator}{2}|\p{Emoji})/u);
    
    let flag = flagMatch ? flagMatch[0] : '❓';
    let nameRemainder = flagMatch ? name.replace(flagMatch[0], '').trim() : name.trim();

    let purpose = null;
    if (nameRemainder.toLowerCase().includes('youtube') || host.includes('-yt')) {
        purpose = 'YouTube';
        nameRemainder = nameRemainder.replace(/youtube/i, '').replace(/KATEX_INLINE_OPENглобальныйKATEX_INLINE_CLOSE/i, '').trim();
    } else if (nameRemainder.includes('Резерв')) {
        purpose = 'Резерв';
        nameRemainder = nameRemainder.replace('Резерв', '').trim();
    } else if (nameRemainder.includes('⚡')) {
        purpose = 'WARP';
        nameRemainder = nameRemainder.replace('⚡', '').trim();
    }

    let country = nameRemainder || 'Unknown';
    let country_code = countryNameToCodeMap[country] || null;

    if (purpose === 'YouTube') {
        const hostMatch = host.match(/^(pro|free)-([a-z]{2,})/);
        if (hostMatch && hostMatch[2]) {
            let codeFromHost = hostMatch[2].toUpperCase();
            const standardCode = countryAliasMap[codeFromHost] || codeFromHost;
            if (countryCodeToNameMap[standardCode]) {
                country_code = standardCode;
                country = countryCodeToNameMap[standardCode];
                flag = getFlagEmoji(country_code);
            }
        }
    }

    return { flag, country, country_code, purpose, isPro: is_pro };
}

// Парсер для TgVpnBot
async function parseTgvpnbotSubscription(url, content) {
    try {
        // Если контент уже декодирован
        let decodedContent = content;
        
        // Пробуем декодировать из base64
        try {
            const decoded = Buffer.from(content, 'base64').toString('utf-8');
            if (decoded.includes('://')) {
                decodedContent = decoded;
            }
        } catch (e) {
            // Not base64
        }
        
        const lines = decodedContent.split('\n').filter(line => line.includes('://'));
        const servers = [];
        
        for (const line of lines) {
            const linkUrl = new URL(line);
            const fullLink = line;
            const baseLink = line.split('#')[0];
            const name = linkUrl.hash ? decodeURIComponent(linkUrl.hash.substring(1)) : 'TgVpnBot Server';
            
            servers.push({
                provider: 'tgvpnbot',
                level: 'high',
                address: linkUrl.hostname,
                name,
                link: baseLink,
                full_link: fullLink,
                // TgVpnBot не предоставляет структурированную информацию о серверах
                flag: '🌐',
                country: 'Unknown',
                isPro: true // Предполагаем, что все серверы TgVpnBot - Pro
            });
        }
        
        return servers;
    } catch (e) {
        console.error('Error parsing tgvpnbot subscription:', e);
        return [];
    }
}

async function fetchSubscription(url, useProxy = false) {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        
        const fetchOptions = {
            signal: controller.signal
        };
        
        // Используем прокси агент если требуется
        if (useProxy && lagomProxyAgent) {
            fetchOptions.agent = lagomProxyAgent;
        } else if (!useProxy) {
            fetchOptions.agent = url.startsWith('https') ? httpsAgent : undefined;
        }
        
        const response = await fetch(url, fetchOptions);
        
        clearTimeout(timeout);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
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
        
        // Проверяем, нужен ли прокси для каких-либо источников
        const needsProxy = sources.some(source => {
            for (const [name, config] of Object.entries(PARSERS)) {
                if (config.detect(source) && config.requiresProxy) {
                    return true;
                }
            }
            return false;
        });
        
        // Запускаем прокси если нужно
        if (needsProxy) {
            await startLagomProxy();
        }
        
        const allServers = [];
        
        for (const source of sources) {
            try {
                if (source.startsWith('http://') || source.startsWith('https://')) {
                    // Определяем парсер
                    let parser = null;
                    let requiresProxy = false;
                    
                    for (const [name, config] of Object.entries(PARSERS)) {
                        if (config.detect(source)) {
                            parser = config;
                            requiresProxy = config.requiresProxy || false;
                            break;
                        }
                    }
                    
                    // Это подписка
                    const content = await fetchSubscription(source, requiresProxy);
                    
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
        
        // Останавливаем прокси
        if (needsProxy) {
            await stopLagomProxy();
        }
        
        // Для lagomvpn проверяем лимиты трафика и выбираем только один аккаунт
        const lagomServers = allServers.filter(s => s.provider === 'lagomvpn' && s.trafficInfo);
        if (lagomServers.length > 0) {
            // Группируем по аккаунтам
            const lagomAccounts = {};
            lagomServers.forEach(server => {
                const username = server.username || 'unknown';
                if (!lagomAccounts[username]) {
                    lagomAccounts[username] = {
                        servers: [],
                        trafficInfo: server.trafficInfo
                    };
                }
                lagomAccounts[username].servers.push(server);
            });
            
            // Выбираем аккаунт с доступным трафиком
            let selectedAccount = null;
            for (const [username, account] of Object.entries(lagomAccounts)) {
                const usedGB = parseFloat(account.trafficInfo.used.replace(/[^0-9.]/g, '')) || 0;
                const limitGB = parseFloat(account.trafficInfo.limit.replace(/[^0-9.]/g, '')) || 0;
                
                if (limitGB === 0 || usedGB < limitGB) {
                    selectedAccount = account;
                    break;
                }
            }
            
            // Удаляем все lagom серверы и добавляем только выбранные
            const nonLagomServers = allServers.filter(s => s.provider !== 'lagomvpn' || !s.trafficInfo);
            if (selectedAccount) {
                return [...nonLagomServers, ...selectedAccount.servers];
            } else {
                console.log('All lagom accounts have exhausted traffic');
                return nonLagomServers;
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
    } finally {
        // Гарантируем остановку прокси в любом случае
        await stopLagomProxy();
    }
}
