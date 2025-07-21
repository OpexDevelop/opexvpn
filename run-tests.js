import { convertLinksToOutbounds } from 'singbox-converter';
import { promises as fs } from 'fs';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// --- Constants ---
const LINKS_FILE_PATH = './links.txt';
const OUTPUT_JSON_PATH = './tested.json';
const TEMP_CONFIG_PATH = './temp-config.json';
const LOCATION_URL = 'https://ip.oxylabs.io/location';
const SINGBOX_PROXY_ADDRESS = '127.0.0.1:1080';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function createSingboxConfig(outbound) {
    return {
        "log": { "level": "error" },
        "inbounds": [
            { "type": "socks", "tag": "socks-in", "listen": "127.0.0.1", "listen_port": 1080 }
        ],
        "outbounds": [outbound]
    };
}

async function runCheck() {
    const command = `curl --proxy socks5h://${SINGBOX_PROXY_ADDRESS} -s -w "%{time_starttransfer}" -o - ${LOCATION_URL}`;
    try {
        const { stdout, stderr } = await execAsync(command, { timeout: 15000 });
        if (stderr) {
            return { success: false, data: null, ping: null, error: stderr.trim() };
        }
        const timeStartTransferMatch = stdout.match(/(\d\.\d+)$/);
        const ping = timeStartTransferMatch ? parseFloat(timeStartTransferMatch[1]) * 1000 : null;
        const jsonDataString = timeStartTransferMatch ? stdout.slice(0, timeStartTransferMatch.index) : stdout;
        const data = JSON.parse(jsonDataString);
        return { success: true, data, ping, error: null };
    } catch (e) {
        return { success: false, data: null, ping: null, error: e.message };
    }
}

async function runSpeedTest() {
    const command = `curl --proxy socks5h://${SINGBOX_PROXY_ADDRESS} -s -w "%{speed_download}" -o /dev/null http://cachefly.cachefly.net/10mb.test`;
    try {
        const { stdout } = await execAsync(command, { timeout: 60000 });
        const speed_bytes_per_sec = parseFloat(stdout);
        const speed_mbps = (speed_bytes_per_sec * 8) / (1024 * 1024);
        return { speed_mbps: parseFloat(speed_mbps.toFixed(2)), error: null };
    } catch (e) {
        return { speed_mbps: null, error: e.message };
    }
}

async function main() {
    const linksContent = await fs.readFile(LINKS_FILE_PATH, 'utf-8');
    const links = linksContent.split('\n').filter(link => link.trim() !== '');
    const results = [];

    for (const link of links) {
        console.log(`\n--- Testing: ${link} ---`);
        const result = {
            status: "offline",
            name: "N/A",
            source_link: link,
            ping_ms: null,
            speedtest_results: null,
            location_data: null,
            error_reason: "Failed to convert link.",
            check_timestamp: new Date().toISOString()
        };

        let singboxProcess;
        try {
            result.name = new URL(link).hash.substring(1) || 'N/A';
            const [outbound] = await convertLinksToOutbounds(link); [span_0](start_span)//[span_0](end_span)
            if (!outbound) {
                results.push(result);
                continue;
            }

            const config = createSingboxConfig(outbound);
            await fs.writeFile(TEMP_CONFIG_PATH, JSON.stringify(config, null, 2));

            singboxProcess = spawn('./sing-box', ['run', '-c', TEMP_CONFIG_PATH]);
            await sleep(2000);

            const checks = [await runCheck(), await runCheck()];
            const successes = checks.filter(c => c.success).length;

            if (successes === 1) {
                console.log("Inconclusive result, running a third check...");
                checks.push(await runCheck());
            }

            const finalSuccesses = checks.filter(c => c.success).length;
            const lastSuccessfulCheck = checks.reverse().find(c => c.success);

            if (finalSuccesses >= 2) {
                console.log("Server is online.");
                result.status = "online";
                result.location_data = lastSuccessfulCheck.data;
                result.ping_ms = lastSuccessfulCheck.ping;
                result.error_reason = null;

                console.log("Measuring speed...");
                result.speedtest_results = await runSpeedTest();
            } else {
                console.log("Server is offline.");
                result.status = "offline";
                result.error_reason = checks.find(c => c.error)?.error || "Unknown error after checks.";
            }
        } catch (error) {
            console.error(`Error processing ${link}:`, error);
            result.error_reason = error.message;
        } finally {
            if (singboxProcess) {
                singboxProcess.kill('SIGKILL');
            }
            results.push(result);
            try { await fs.unlink(TEMP_CONFIG_PATH); } catch (e) {}
        }
    }

    await fs.writeFile(OUTPUT_JSON_PATH, JSON.stringify(results, null, 2), 'utf-8');
    console.log(`\n✅ Testing complete. Results saved to ${OUTPUT_JSON_PATH}`);
}

main().catch(console.error);
