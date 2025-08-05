import { readFile, writeFile } from 'fs/promises';
import { collectLinks } from './collector.js';
import { shouldCheckProxy, getLastRecordedIpInfo, extractGeoData, testProxy, CONCURRENCY_LIMIT, BASE_PORT } from './checker.js';
import { formatAndSaveSubscriptions } from './formatter.js';
import { publishToGists } from './gist-publisher.js';

const DB_FILE = './db.json';

// Функция для нормализации ссылки (убираем изменяющиеся параметры)
function normalizeLink(link) {
    try {
        const url = new URL(link.split('#')[0]);
        // Удаляем параметр spx для tgvpnbot, так как он меняется
        if (url.hostname.includes('tgvpnbot.com')) {
            url.searchParams.delete('spx');
        }
        return url.toString();
    } catch (e) {
        return link.split('#')[0];
    }
}

async function loadDatabase() {
    try {
        const data = await readFile(DB_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        return [];
    }
}

async function saveDatabase(data) {
    await writeFile(DB_FILE, JSON.stringify(data, null, 2));
}

export async function runProxyTests() {
    console.log('Starting proxy tests...');
    
    // Получаем URL источника из переменной окружения
    const linksHighUrl = process.env.LINKS_HIGH;
    if (!linksHighUrl) {
        console.error('LINKS_HIGH environment variable not set');
        return;
    }
    
    // Собираем ссылки
    const collectedServers = await collectLinks(linksHighUrl, 'high');
    if (collectedServers.length === 0) {
        console.error('No links collected');
        return;
    }
    
    console.log(`Collected ${collectedServers.length} servers`);
    
    // Загружаем базу данных
    const database = await loadDatabase();
    const now = new Date().toISOString();
    
    // Создаем мапу существующих серверов для быстрого поиска
    const existingServersMap = new Map();
    database.forEach(server => {
        existingServersMap.set(normalizeLink(server.link), server);
    });
    
    // Обновляем базу данных новыми серверами
    for (const server of collectedServers) {
        const normalizedLink = normalizeLink(server.link);
        let proxyEntry = existingServersMap.get(normalizedLink);
        
        if (!proxyEntry) {
            // Новый сервер
            proxyEntry = {
                status: 'pending',
                created_at: now,
                checks: [],
                ...server
            };
            database.push(proxyEntry);
            existingServersMap.set(normalizedLink, proxyEntry);
        } else {
            // Обновляем существующий сервер
            // ВАЖНО: обновляем trafficUsed и trafficLimit для lagomvpn
            if (server.provider === 'lagomvpn') {
                proxyEntry.trafficUsed = server.trafficUsed;
                proxyEntry.trafficLimit = server.trafficLimit;
                proxyEntry.trafficInfo = server.trafficInfo;
            }
            
            // Обновляем остальные поля, но сохраняем историю
            Object.assign(proxyEntry, {
                ...server,
                status: proxyEntry.status,
                created_at: proxyEntry.created_at,
                checks: proxyEntry.checks,
                link: server.link, // Обновляем link на случай изменения параметров
                // Сохраняем обновленную информацию о трафике
                trafficUsed: server.trafficUsed || proxyEntry.trafficUsed,
                trafficLimit: server.trafficLimit || proxyEntry.trafficLimit,
                trafficInfo: server.trafficInfo || proxyEntry.trafficInfo
            });
        }
    }
    
    // Удаляем серверы, которых больше нет в источниках
    const collectedLinks = new Set(collectedServers.map(s => normalizeLink(s.link)));
    const toRemove = [];
    for (let i = database.length - 1; i >= 0; i--) {
        if (!collectedLinks.has(normalizeLink(database[i].link))) {
            console.log(`Removing obsolete server: ${database[i].name}`);
            toRemove.push(i);
        }
    }
    for (const index of toRemove) {
        database.splice(index, 1);
    }
    
    // Фильтруем прокси для проверки
    const proxiesToCheck = database.filter(proxy => {
        // Для lagomvpn проверяем лимиты трафика
        if (proxy.provider === 'lagomvpn' && proxy.trafficUsed && proxy.trafficLimit) {
            const usedGB = parseFloat(proxy.trafficUsed.replace(/[^0-9.]/g, '')) || 0;
            const limitGB = parseFloat(proxy.trafficLimit.replace(/[^0-9.]/g, '')) || 0;
            
            if (limitGB > 0 && usedGB >= limitGB) {
                // Помечаем как traffic_exhausted вместо error
                proxy.status = 'traffic_exhausted';
                return false;
            }
        }
        
        return shouldCheckProxy(proxy);
    });
    
    console.log(`${proxiesToCheck.length} proxies need checking`);
    
    // Тестируем прокси
    for (let i = 0; i < proxiesToCheck.length; i += CONCURRENCY_LIMIT) {
        const chunk = proxiesToCheck.slice(i, i + CONCURRENCY_LIMIT);
        console.log(`\nProcessing chunk ${i / CONCURRENCY_LIMIT + 1} of ${Math.ceil(proxiesToCheck.length / CONCURRENCY_LIMIT)}...`);
        
        const promises = chunk.map(async (proxyEntry, chunkIndex) => {
            const globalIndex = i + chunkIndex;
            const port = BASE_PORT + globalIndex;
            const result = await testProxy(proxyEntry.full_link, globalIndex, port);
            
            const checkResult = {
                timestamp: new Date().toISOString()
            };
            
            if (result.success) {
                const ipData = result.result.data || {};
                const geoData = extractGeoData(ipData);
                
                checkResult.ip_address = ipData.ip || 'N/A';
                checkResult.ping_ms = result.result.latency?.toFixed(0) || 'N/A';
                checkResult.insecure = result.insecure;
                checkResult.country = geoData.country;
                checkResult.asn = geoData.asn;
                checkResult.org_name = geoData.org_name;
                checkResult.city = geoData.city;
                
                const lastRecordedIpInfo = getLastRecordedIpInfo(proxyEntry);
                if (!lastRecordedIpInfo || JSON.stringify(lastRecordedIpInfo) !== JSON.stringify(ipData)) {
                    checkResult.ip_info_response = ipData;
                }
                
                proxyEntry.status = 'working';
            } else {
                checkResult.error = result.error;
                proxyEntry.status = 'error';
            }
            
            proxyEntry.checks.push(checkResult);
            
            console.log(`- ${proxyEntry.name.substring(0, 30)}...: ${result.success ? 'WORKING' : 'ERROR'}`);
        });
        
        await Promise.allSettled(promises);
    }
    
    // Сохраняем базу данных
    await saveDatabase(database);
    console.log(`\nDatabase updated in ${DB_FILE}`);
    
    // Создаем файлы подписок
    await formatAndSaveSubscriptions(database);
    
    // Публикуем в GitHub Gists если есть токен
    const gistToken = process.env.GIST_TOKEN;
    if (gistToken) {
        try {
            await publishToGists(gistToken);
        } catch (error) {
            console.error('Failed to publish to Gists:', error.message);
            // Не прерываем выполнение, если публикация в Gists не удалась
        }
    } else {
        console.log('GIST_TOKEN not set, skipping Gist publication');
    }
    
    // Статистика
    const working = database.filter(p => p.status === 'working').length;
    const errors = database.filter(p => p.status === 'error').length;
    const pending = database.filter(p => p.status === 'pending').length;
    const trafficExhausted = database.filter(p => p.status === 'traffic_exhausted').length;
    
    console.log('\nSummary:');
    console.log(`  Total: ${database.length}`);
    console.log(`  Working: ${working}`);
    console.log(`  Errors: ${errors}`);
    console.log(`  Pending: ${pending}`);
    console.log(`  Traffic Exhausted: ${trafficExhausted}`);
    
    // Детальная статистика по lagomvpn
    const lagomStats = database.filter(p => p.provider === 'lagomvpn');
    const lagomPro = lagomStats.filter(p => p.isPro);
    const lagomFree = lagomStats.filter(p => !p.isPro);
    console.log('\nLagomVPN stats:');
    console.log(`  PRO: ${lagomPro.length} (Working: ${lagomPro.filter(p => p.status === 'working').length})`);
    console.log(`  FREE: ${lagomFree.length} (Working: ${lagomFree.filter(p => p.status === 'working').length})`);
}
