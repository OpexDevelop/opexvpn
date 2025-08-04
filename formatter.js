import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

const CHECKED_DIR = './checked';

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

// Функция для определения, является ли сервер российским
function isRussianServer(proxy) {
    // Проверяем поле country
    if (proxy.country === 'Россия') return true;
    
    // Проверяем флаг
    if (proxy.flag === '🇷🇺') return true;
    
    // Если поля пустые, проверяем в checks
    if ((!proxy.country || proxy.country === 'Unknown') && proxy.checks && proxy.checks.length > 0) {
        // Ищем последний check с country
        for (let i = proxy.checks.length - 1; i >= 0; i--) {
            const check = proxy.checks[i];
            if (check.country) {
                return check.country === 'RU';
            }
        }
    }
    
    return false;
}

// Функция для создания кастомного названия
function createCustomName(proxy) {
    let flag = proxy.flag || '';
    let country = proxy.country || '';
    let countryCode = proxy.country_code || '';
    let serverNumber = proxy.serverNumber || 1;
    let purpose = proxy.purpose || '';
    let isPro = proxy.isPro || false;
    let provider = proxy.provider || 'unknown';
    
    // Если флаг пустой или страна Unknown, пробуем получить из последнего check
    if ((!flag || flag === '🌐' || !country || country === 'Unknown') && proxy.checks && proxy.checks.length > 0) {
        for (let i = proxy.checks.length - 1; i >= 0; i--) {
            const check = proxy.checks[i];
            if (check.country && check.country !== 'Unknown') {
                flag = getFlagEmoji(check.country);
                country = check.country; // Используем код страны как название
                break;
            }
        }
    }
    
    // Если все еще нет флага
    if (!flag || flag === '🌐') flag = '❓';
    
    // Если нет страны, используем код страны
    if (!country && countryCode) {
        country = countryCode;
    } else if (!country || country === 'Unknown') {
        country = 'Unknown';
    }
    
    // Формируем название
    let name = `${flag}${country}#${serverNumber}`;
    
    if (purpose) {
        name += ` ${purpose}`;
    }
    
    name += ' ·';
    
    // Добавляем информацию о трафике ТОЛЬКО для lagomvpn FREE (не PRO)
    if (proxy.provider === 'lagomvpn' && !isPro && proxy.trafficUsed && proxy.trafficLimit) {
        // Сохраняем полный формат с единицами измерения
        name += ` ${proxy.trafficUsed}/${proxy.trafficLimit}`;
    }
    
    // Добавляем провайдера с правильным форматом
    if (isPro) {
        name += ` ${provider}-pro`;
    } else {
        name += ` ${provider}`;
    }
    
    return name;
}

// Функция для создания ссылки с новым названием
function createFormattedLink(proxy) {
    const customName = createCustomName(proxy);
    const encodedName = encodeURIComponent(customName);
    return `${proxy.link}#${encodedName}`;
}

export async function formatAndSaveSubscriptions(database) {
    // Создаем директории
    await mkdir(path.join(CHECKED_DIR, 'providers'), { recursive: true });
    await mkdir(path.join(CHECKED_DIR, 'levels'), { recursive: true });
    
    // Фильтруем только работающие прокси
    const workingProxies = database.filter(p => p.status === 'working');
    
    // Для lagomvpn: все pro + серверы из одного free аккаунта
    const lagomProProxies = workingProxies.filter(p => p.provider === 'lagomvpn' && p.isPro);
    const lagomFreeProxies = workingProxies.filter(p => p.provider === 'lagomvpn' && !p.isPro);
    const nonLagomProxies = workingProxies.filter(p => p.provider !== 'lagomvpn');
    
    console.log(`Working proxies breakdown:`);
    console.log(`- Lagom PRO: ${lagomProProxies.length}`);
    console.log(`- Lagom FREE: ${lagomFreeProxies.length}`);
    console.log(`- Non-Lagom: ${nonLagomProxies.length}`);
    
    // Группируем free lagom по аккаунтам
    const lagomFreeByAccount = {};
    lagomFreeProxies.forEach(proxy => {
        const username = proxy.username || 'unknown';
        if (!lagomFreeByAccount[username]) {
            lagomFreeByAccount[username] = [];
        }
        lagomFreeByAccount[username].push(proxy);
    });
    
    // Выбираем один free аккаунт с доступным трафиком
    let selectedLagomFreeProxies = [];
    for (const [username, proxies] of Object.entries(lagomFreeByAccount)) {
        if (proxies.length > 0) {
            const sample = proxies[0];
            console.log(`Checking Lagom FREE account ${username}: ${sample.trafficUsed}/${sample.trafficLimit}`);
            
            if (sample.trafficUsed && sample.trafficLimit) {
                const usedGB = parseFloat(sample.trafficUsed.replace(/[^0-9.]/g, '')) || 0;
                const limitGB = parseFloat(sample.trafficLimit.replace(/[^0-9.]/g, '')) || 0;
                
                if (limitGB === 0 || usedGB < limitGB) {
                    selectedLagomFreeProxies = proxies;
                    console.log(`Selected Lagom FREE account: ${username}`);
                    break;
                }
            }
        }
    }
    
    // Объединяем прокси: все non-lagom + все lagom pro + выбранные lagom free
    const finalWorkingProxies = [...nonLagomProxies, ...lagomProProxies, ...selectedLagomFreeProxies];
    
    console.log(`\nTotal working proxies for export: ${finalWorkingProxies.length}`);
    console.log(`- Non-Lagom: ${nonLagomProxies.length}`);
    console.log(`- Lagom PRO: ${lagomProProxies.length}`);
    console.log(`- Lagom FREE (selected): ${selectedLagomFreeProxies.length}`);
    
    // Разделяем на русские и нерусские
    const russianProxies = finalWorkingProxies.filter(isRussianServer);
    const nonRussianProxies = finalWorkingProxies.filter(p => !isRussianServer(p));
    
    // Группируем по провайдерам
    const byProvider = {};
    const byProviderRu = {};
    const byProviderFull = {};
    
    finalWorkingProxies.forEach(proxy => {
        const provider = proxy.provider || 'unknown';
        const formattedLink = createFormattedLink(proxy);
        
        if (!byProviderFull[provider]) {
            byProviderFull[provider] = [];
        }
        byProviderFull[provider].push(formattedLink);
        
        if (isRussianServer(proxy)) {
            if (!byProviderRu[provider]) {
                byProviderRu[provider] = [];
            }
            byProviderRu[provider].push(formattedLink);
        } else {
            if (!byProvider[provider]) {
                byProvider[provider] = [];
            }
            byProvider[provider].push(formattedLink);
        }
    });
    
    // Группируем по уровням
    const byLevel = {};
    const byLevelRu = {};
    const byLevelFull = {};
    
    finalWorkingProxies.forEach(proxy => {
        const level = proxy.level || 'unknown';
        const formattedLink = createFormattedLink(proxy);
        
        if (!byLevelFull[level]) {
            byLevelFull[level] = [];
        }
        byLevelFull[level].push(formattedLink);
        
        if (isRussianServer(proxy)) {
            if (!byLevelRu[level]) {
                byLevelRu[level] = [];
            }
            byLevelRu[level].push(formattedLink);
        } else {
            if (!byLevel[level]) {
                byLevel[level] = [];
            }
            byLevel[level].push(formattedLink);
        }
    });
    
    // Сохраняем файлы провайдеров (только нерусские)
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
        
        console.log(`Saved ${links.length} non-Russian links for provider: ${provider}`);
    }
    
    // Сохраняем файлы провайдеров (только русские)
    for (const [provider, links] of Object.entries(byProviderRu)) {
        const content = links.join('\n');
        
        await writeFile(
            path.join(CHECKED_DIR, 'providers', `${provider}-ru.txt`),
            content
        );
        
        console.log(`Saved ${links.length} Russian links for provider: ${provider}`);
    }
    
    // Сохраняем файлы провайдеров (все)
    for (const [provider, links] of Object.entries(byProviderFull)) {
        const content = links.join('\n');
        
        await writeFile(
            path.join(CHECKED_DIR, 'providers', `${provider}-full.txt`),
            content
        );
        
        console.log(`Saved ${links.length} total links for provider: ${provider}`);
    }
    
    // Сохраняем файлы уровней (только нерусские)
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
        
        console.log(`Saved ${links.length} non-Russian links for level: ${level}`);
    }
    
    // Сохраняем файлы уровней (только русские)
    for (const [level, links] of Object.entries(byLevelRu)) {
        const content = links.join('\n');
        
        await writeFile(
            path.join(CHECKED_DIR, 'levels', `${level}-ru.txt`),
            content
        );
        
        console.log(`Saved ${links.length} Russian links for level: ${level}`);
    }
    
    // Сохраняем файлы уровней (все)
    for (const [level, links] of Object.entries(byLevelFull)) {
        const content = links.join('\n');
        
        await writeFile(
            path.join(CHECKED_DIR, 'levels', `${level}-full.txt`),
            content
        );
        
        console.log(`Saved ${links.length} total links for level: ${level}`);
    }
}
