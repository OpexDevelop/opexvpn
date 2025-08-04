import { readFile, writeFile } from 'fs/promises';
import { collectLinks } from './collector.js';
import { shouldCheckProxy, getLastRecordedIpInfo, extractGeoData, testProxy, CONCURRENCY_LIMIT, BASE_PORT } from './checker.js';
import { formatAndSaveSubscriptions } from './formatter.js';

const DB_FILE = './db.json';

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
    
    // Обновляем базу данных новыми серверами
    for (const server of collectedServers) {
        let proxyEntry = database.find(p => p.link === server.link);
        
        if (!proxyEntry) {
            proxyEntry = {
                status: 'pending',
                created_at: now,
                checks: [],
                ...server
            };
            database.push(proxyEntry);
        } else {
            // Обновляем информацию
            Object.assign(proxyEntry, {
                ...server,
                status: proxyEntry.status,
                created_at: proxyEntry.created_at,
                checks: proxyEntry.checks
            });
        }
    }
    
    // Фильтруем прокси для проверки
    const proxiesToCheck = database.filter(shouldCheckProxy);
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
    
    // Статистика
    const working = database.filter(p => p.status === 'working').length;
    const errors = database.filter(p => p.status === 'error').length;
    const pending = database.filter(p => p.status === 'pending').length;
    
    console.log('\nSummary:');
    console.log(`  Total: ${database.length}`);
    console.log(`  Working: ${working}`);
    console.log(`  Errors: ${errors}`);
    console.log(`  Pending: ${pending}`);
}
