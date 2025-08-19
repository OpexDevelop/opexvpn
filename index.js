//import { runProxyTests } from './main.js';
//runProxyTests().catch(console.error);
import { convertToOutbounds } from 'singbox-converter';
import {TUN_INBOUND, ROUTE, RULE_SET, OPEXVPN_LINK, OUTBOUNDS} from './config.js'
import { writeFile } from 'fs/promises';

const base_config = {
    "log": {"level": "error","timestamp": true},
    "inbounds": [TUN_INBOUND],
    "outbounds": OUTBOUNDS,
    "route": {
        "rules": ROUTE,
        "rule_set": RULE_SET,
        "final": "select",
        "auto_detect_interface": true
    },
    "experimental": {
        "clash_api": {
            "external_controller": "0.0.0.0:16756"
        }
    }
}

const fetch_opexvpn_links = async () => {
    let response = {}
    const r = await fetch(OPEXVPN_LINK).catch((e) => {
        response = {error: `${e}`}
    })
    if (response?.error) return response
    if (!r.ok) return {error: `status = ${r.statusText}`}
    const text = await r.text()
    return {links: text}
}

const main = async () => {
    let links = await fetch_opexvpn_links()
    if (links.error) {
        console.error(`[!] OpexVPN fetch failed. ${links.error}`)
        return
    }
    links = await convertToOutbounds(links.links);
    const tags = links.map(i => i.tag)
    const selector = {
        "type": "selector",
        "tag": "select",
        "outbounds": [...tags, 'auto'],
        "default": "auto"
    }
    const auto = {
        "type": "urltest",
        "tag": "auto",
        "outbounds": tags,
        "url": "http://connectivitycheck.gstatic.com/generate_204",
        "interval": "10m0s",
        "tolerance": 1,
        "idle_timeout": "30m0s"
    }
    base_config.outbounds.push(...[
        ...links,
        auto,
        selector
    ])
    await writeFile('singbox-config.json', JSON.stringify(base_config, null, 4), 'utf8');


};main()


