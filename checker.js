import { readFile, writeFile } from 'fs/promises';
import { spawn } from 'child_process';
import { convertToOutbounds } from 'singbox-converter';
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';

const exec = promisify(execCallback);

const TEST_URL = 'https://ip.oxylabs.io/location';
const STARTUP_DELAY = 5000;
const REQUEST_TIMEOUT = 15;
const CONCURRENCY_LIMIT = 10;
const BASE_PORT = 20000;

// Все функции проверки из вашего текущего index.js
function extractGeoData(ipInfoResponse) {
    const providers = ipInfoResponse.providers || {};
    const providerPriority = ['maxmind', 'ipinfo', 'ip2location', 'dbip'];
    
    const countries = [];
    const cities = [];
    const asns = [];
    const orgNames = [];
    
    for (const provider of Object.keys(providers)) {
        const data = providers[provider];
        if (data.country) countries.push(data.country);
        if (data.city) cities.push(data.city);
        if (data.asn) asns.push(data.asn);
        if (data.org_name) orgNames.push(data.org_name);
    }
    
    let country = getMostCommonValue(countries);
    let city = getMostCommonValue(cities);
    let asn = getMostCommonValue(asns);
    let orgName = getMostCommonValue(orgNames);
    
    if (!country) {
        for (const provider of providerPriority) {
            if (providers[provider]?.country) {
                country = providers[provider].country;
                break;
            }
        }
    }
    
    if (!city) {
        for (const provider of providerPriority) {
            if (providers[provider]?.city) {
                city = providers[provider].city;
                break;
            }
        }
    }
    
    if (!asn) {
        for (const provider of providerPriority) {
            if (providers[provider]?.asn) {
                asn = providers[provider].asn;
                break;
            }
        }
    }
    
    if (!orgName) {
        for (const provider of providerPriority) {
            if (providers[provider]?.org_name) {
                orgName = providers[provider].org_name;
                break;
            }
        }
    }
    
    return { country: country || '', city: city || '', asn: asn || '', org_name: orgName || '' };
}

function getMostCommonValue(values) {
    if (!values || values.length === 0) return '';
    
    const counts = {};
    values.forEach(val => {
        if (val && val !== '') {
            counts[val] = (counts[val] || 0) + 1;
        }
    });
    
    let maxCount = 0;
    let mostCommon = '';
    
    for (const [value, count] of Object.entries(counts)) {
        if (count > maxCount) {
            maxCount = count;
            mostCommon = value;
        }
    }
    
    return mostCommon;
}

function shouldCheckProxy(proxy) {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const oneWeek = 7 * oneDay;
    const oneMonth = 30 * oneDay;
    const checkInterval = oneDay - (10 * 60 * 1000);
    
    if (!proxy.checks || proxy.checks.length === 0) {
        return true;
    }
    
    const lastCheck = proxy.checks[proxy.checks.length - 1];
    const lastCheckTime = new Date(lastCheck.timestamp).getTime();
    const timeSinceLastCheck = now - lastCheckTime;
    
    let consecutiveErrors = 0;
    for (let i = proxy.checks.length - 1; i >= 0; i--) {
        if (proxy.checks[i].error) {
            consecutiveErrors++;
        } else {
            break;
        }
    }
    
    if (consecutiveErrors === 0) {
        return timeSinceLastCheck >= checkInterval;
    } else if (consecutiveErrors < 7) {
        return timeSinceLastCheck >= checkInterval;
    } else if (consecutiveErrors < 30) {
        return timeSinceLastCheck >= oneWeek;
    } else {
        return timeSinceLastCheck >= oneMonth;
    }
}

function getLastRecordedIpInfo(proxy) {
    if (!proxy.checks || proxy.checks.length === 0) {
        return null;
    }
    
    for (let i = proxy.checks.length - 1; i >= 0; i--) {
        if (proxy.checks[i].ip_info_response) {
            return proxy.checks[i].ip_info_response;
        }
    }
    
    return null;
}

// Остальные функции проверки из вашего index.js
function createSingboxConfig(outbound, port, allowInsecure = false) {
    if (allowInsecure && outbound.tls && outbound.tls.enabled) {
        outbound.tls.insecure = true;
    }

    return {
        log: {
            level: "error",
            timestamp: true
        },
        inbounds: [{
            type: "socks",
            tag: "socks-in",
            listen: "127.0.0.1",
            listen_port: port,
            sniff: true,
            sniff_override_destination: false
        }],
        outbounds: [outbound],
        route: {
            rules: [{
                inbound: ["socks-in"],
                outbound: outbound.tag
            }]
        }
    };
}

function startSingbox(configPath) {
    return new Promise((resolve, reject) => {
        const singbox = spawn('sing-box', ['run', '-c', configPath], {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let startupTimeout = setTimeout(() => {
            singbox.kill('SIGKILL');
            reject(new Error('Sing-box startup timeout'));
        }, 20000);

        let started = false;
        const checkStarted = (data) => {
            if (started) return;

            const output = data.toString();
            if (output.includes('started') ||
                output.includes('server started') ||
                output.includes('tcp server started') ||
                output.includes('listening') ||
                output.includes('inbound/socks')) {
                started = true;
                clearTimeout(startupTimeout);
                setTimeout(() => resolve(singbox), STARTUP_DELAY);
            }
        };

        singbox.stdout.on('data', checkStarted);
        singbox.stderr.on('data', (data) => {
            const error = data.toString();
            checkStarted(data);

            if (error.includes('FATAL') || error.includes('panic')) {
                clearTimeout(startupTimeout);
                singbox.kill('SIGKILL');
                reject(new Error(`Sing-box error: ${error}`));
            }
        });

        singbox.on('error', (err) => {
            clearTimeout(startupTimeout);
            reject(err);
        });

        singbox.on('exit', (code, signal) => {
            clearTimeout(startupTimeout);
            if (code !== 0 && code !== null && !started) {
                reject(new Error(`Sing-box exited with code ${code}`));
            }
        });

        setTimeout(() => {
            if (!started && startupTimeout) {
                try {
                    process.kill(singbox.pid, 0);
                    started = true;
                    clearTimeout(startupTimeout);
                    setTimeout(() => resolve(singbox), STARTUP_DELAY);
                } catch (e) {
                    // Process not running
                }
            }
        }, 3000);
    });
}

async function makeProxyRequest(port) {
    try {
        const proxyAddress = `socks5h://127.0.0.1:${port}`;
        const curlCommand = `curl -s --proxy "${proxyAddress}" --max-time ${REQUEST_TIMEOUT} -w "\\n---STATS---\\nHTTP_CODE:%{http_code}\\nLATENCY_S:%{time_starttransfer}" "${TEST_URL}"`;

        const { stdout, stderr } = await exec(curlCommand);

        if (stderr) {
            throw new Error(stderr);
        }

        const parts = stdout.split('---STATS---');
        const responseBody = parts[0].trim();
        const stats = parts[1] || '';

        const httpCode = stats.match(/HTTP_CODE:(\d+)/)?.[1] || '0';
        const latencyS = stats.match(/LATENCY_S:([\d.]+)/)?.[1] || '0';

        if (httpCode !== '200') {
            throw new Error(`HTTP ${httpCode}`);
        }

        let data;
        try {
            data = JSON.parse(responseBody);
        } catch (e) {
            throw new Error('Invalid JSON response');
        }

        return {
            success: true,
            data: data,
            latency: parseFloat(latencyS) * 1000
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

async function testProxyWithSettings(link, index, outbound, port, allowInsecure) {
    const configFile = `temp_config_${index}_${port}.json`;
    const config = createSingboxConfig(outbound, port, allowInsecure);

    try {
        await writeFile(configFile, JSON.stringify(config, null, 2));
    } catch (error) {
        return {
            success: false,
            error: 'Failed to write config: ' + error.message
        };
    }

    let singboxProcess;
    try {
        singboxProcess = await startSingbox(configFile);
    } catch (error) {
        await exec(`rm -f ${configFile}`).catch(() => {});
        return {
            success: false,
            error: 'Sing-box startup failed: ' + error.message
        };
    }

    try {
        await makeProxyRequest(port);

        const request1 = await makeProxyRequest(port);
        const request2 = await makeProxyRequest(port);

        let finalResult;
        let successCount = [request1, request2].filter(r => r.success).length;

        if (successCount === 1) {
            const request3 = await makeProxyRequest(port);
            successCount = [request1, request2, request3].filter(r => r.success).length;
            finalResult = [request1, request2, request3].find(r => r.success) || request3;
        } else {
            finalResult = request2.success ? request2 : request1;
        }

        const isWorking = successCount >= 2;

        return {
            success: isWorking,
            result: finalResult,
            insecure: allowInsecure,
        };
    } finally {
        if (singboxProcess) {
            try {
                singboxProcess.kill('SIGTERM');
                await new Promise(resolve => setTimeout(resolve, 1000));
                try {
                    process.kill(singboxProcess.pid, 0);
                    singboxProcess.kill('SIGKILL');
                } catch (e) {
                    // Process already dead
                }
            } catch (e) {}
        }
        await exec(`rm -f ${configFile}`).catch(() => {});
    }
}

async function testProxy(link, index, port) {
    let outbound;
    let name = 'Unknown';

    try {
        const outbounds = await convertToOutbounds(link);
        if (!outbounds || outbounds.length === 0) {
            throw new Error('Failed to convert link to outbound');
        }
        outbound = outbounds[0];
        name = outbound.tag || link.split('#')[1] || `Proxy ${index + 1}`;
    } catch (error) {
        return {
            success: false,
            error: 'Conversion failed: ' + error.message,
            name: name
        };
    }

    let testResult = await testProxyWithSettings(link, index, outbound, port, false);

    if (!testResult.success && outbound.tls && outbound.tls.enabled) {
        testResult = await testProxyWithSettings(link, index, outbound, port, true);
    }

    return {
        ...testResult,
        name: name
    };
}

export { shouldCheckProxy, getLastRecordedIpInfo, extractGeoData, testProxy, CONCURRENCY_LIMIT, BASE_PORT };
