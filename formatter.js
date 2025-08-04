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
    if (!proxy.country && !proxy.flag && proxy.checks && proxy.checks.length > 0) {
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
    
    // Если флаг пустой, пробуем получить из последнего check
    if (!flag && proxy.checks && proxy.checks.length > 0) {
        for (let i = proxy.checks.length - 1; i >= 0; i--) {
            const check = proxy.checks[i];
            if (check.country) {
                flag = getFlagEmoji(check.country);
                if (!country) {
                    country = check.country;
                }
                break;
            }
        }
    }
    
    // Если все еще нет флага
    if (!flag) flag = '❓';
    
    // Если нет страны, используем код страны
    if (!country && countryCode) {
        country = countryCode;
    } else if (!country) {
        country = 'Unknown';
    }
    
    // Формируем название
    let name = `${flag}${country}#${serverNumber}`;
    
    if (purpose) {
        name += ` ${purpose}`;
    }
    
    name += ' ·';
    
    // Добавляем информацию о трафике для lagomvpn
    if (proxy.provider === 'lagomvpn' && proxy.trafficUsed && proxy.trafficLimit) {
        const used = proxy.trafficUsed.replace(/[^0-9.]/g, '');
        const limit = proxy.trafficLimit.replace(/[^0-9.]/g, '');
        name += ` ${used}/${limit}`;
    }
    
    // Добавляем префикс pro- если нужно
    if (isPro) {
        name += ` pro-${provider}`;
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
    
    // Для lagomvpn проверяем лимиты трафика
    const lagomProxies = workingProxies.filter(p => p.provider === 'lagomvpn');
    const nonLagomProxies = workingProxies.filter(p => p.provider !== 'lagomvpn');
    
    // Группируем lagom по аккаунтам и выбираем только с доступным трафиком
    const lagomByAccount = {};
    lagomProxies.forEach(proxy => {
        const username = proxy.username || 'unknown';
        if (!lagomByAccount[username]) {
            lagomByAccount[username] = [];
        }
        lagomByAccount[username].push(proxy);
    });
    
    let selectedLagomProxies = [];
    for (const [username, proxies] of Object.entries(lagomByAccount)) {
        if (proxies.length > 0) {
            const sample = proxies[0];
            if (sample.trafficUsed && sample.trafficLimit) {
                const usedGB = parseFloat(sample.trafficUsed.replace(/[^0-9.]/g, '')) || 0;
                const limitGB = parseFloat(sample.trafficLimit.replace(/[^0-9.]/g, '')) || 0;
                
                if (limitGB === 0 || usedGB < limitGB) {
                    selectedLagomProxies = selectedLagomProxies.concat(proxies);
                    break; // Используем только один аккаунт
                }
            }
        }
    }
    
    // Объединяем прокси
    const finalWorkingProxies = [...nonLagomProxies, ...selectedLagomProxies];
    
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
