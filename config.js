export const TUN_INBOUND = {
    "type": "tun",
    "tag": "tun-in",
    "mtu": 9000,
    "inet4_address": "172.19.0.1/28",
    "auto_route": true,
    "strict_route": true,
    "endpoint_independent_nat": true,
    "stack": "mixed",
    "sniff": true,
    "sniff_override_destination": true
}

export const OUTBOUNDS = [
    {
        "type": "direct",
        "tag": "direct"
    },
    {
        "type": "direct",
        "tag": "bypass"
    },
    {
        "type": "block",
        "tag": "block"
    }
]

export const RULE_SET = [
    {
        "type": "remote",
        "tag": "geosite-ads",
        "format": "binary",
        "url": "https://raw.githubusercontent.com/hiddify/hiddify-geo/rule-set/block/geosite-category-ads-all.srs",
        "update_interval": "120h0m0s"
    },
    {
        "type": "remote",
        "tag": "geosite-malware",
        "format": "binary",
        "url": "https://raw.githubusercontent.com/hiddify/hiddify-geo/rule-set/block/geosite-malware.srs",
        "update_interval": "120h0m0s"
    },
    {
        "type": "remote",
        "tag": "geosite-phishing",
        "format": "binary",
        "url": "https://raw.githubusercontent.com/hiddify/hiddify-geo/rule-set/block/geosite-phishing.srs",
        "update_interval": "120h0m0s"
    },
    {
        "type": "remote",
        "tag": "geosite-cryptominers",
        "format": "binary",
        "url": "https://raw.githubusercontent.com/hiddify/hiddify-geo/rule-set/block/geosite-cryptominers.srs",
        "update_interval": "120h0m0s"
    },
    {
        "type": "remote",
        "tag": "geoip-phishing",
        "format": "binary",
        "url": "https://raw.githubusercontent.com/hiddify/hiddify-geo/rule-set/block/geoip-phishing.srs",
        "update_interval": "120h0m0s"
    },
    {
        "type": "remote",
        "tag": "geoip-malware",
        "format": "binary",
        "url": "https://raw.githubusercontent.com/hiddify/hiddify-geo/rule-set/block/geoip-malware.srs",
        "update_interval": "120h0m0s"
    }
]

export const ROUTE = [
    {
        "ip_is_private": true,
        "outbound": "bypass"
    },
    {
        "rule_set": [
            "geosite-ads",
            "geosite-malware",
            "geosite-phishing",
            "geosite-cryptominers",
            "geoip-malware",
            "geoip-phishing"
        ],
        "outbound": "block"
    },
    {
        "domain_suffix": ".ru",
        "outbound": "direct"
    }
]

export const OPEXVPN_LINK = 'https://raw.githubusercontent.com/OpexDevelop/opexvpn/refs/heads/main/checked/levels/high.txt'
