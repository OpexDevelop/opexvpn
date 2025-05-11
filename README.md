# Proxy Tester with Subconverter and Sing-box

This repository uses GitHub Actions to periodically test a list of proxy servers from a subscription link.
It uses `subconverter` to parse the subscription and convert it to a standardized Clash configuration format, and then `sing-box` to connect to each proxy for testing.

Tests performed:
- IP Address and Geolocation (via ip.oxylabs.io)
- Ping and Speedtest (via speedtest-cli)

Test results are saved to `proxy_results.json`.

## Subscription Link

The proxy list is fetched from: `https://gist.githubusercontent.com/OpexDevelop/a676272468c9b6ac804092250ce9bc67/raw/opexvpn-high.txt`

## How it Works

1.  The GitHub Actions workflow runs on a schedule (or can be triggered manually).
2.  It downloads and installs `subconverter`, `sing-box`, `speedtest-cli`, `curl`, `jq`, and `yq`.
3.  `subconverter` is run in the background.
4.  The subscription URL is fetched and passed to the local `subconverter` instance to convert the proxy list into a Clash YAML format (`sub_clash_config.yaml`).
5.  For each proxy node defined in the `proxies` section of `sub_clash_config.yaml`:
    a.  The node's data (in JSON format) is passed to `scripts/generate_singbox_config.py`.
    b.  This Python script converts the Clash node parameters into a `sing-box` outbound configuration and generates a full temporary `sing-box` JSON config.
    c.  `sing-box` is started with this temporary configuration.
    d.  Tests are performed through the local SOCKS5 proxy (127.0.0.1:10808) provided by `sing-box`.
    e.  `sing-box` is stopped.
6.  All results are aggregated into `proxy_results.json`.
7.  If `proxy_results.json` has changed, it's committed back to the repository.

## Results (`proxy_results.json`)

The `proxy_results.json` file contains an array of objects, where each object represents a tested proxy and includes:
- `name`: The original proxy name from the Clash config.
- `ip_address`: The public IP address of the proxy.
- `country_code`: The country code (e.g., "US", "LV").
- `city`: The city.
- `asn_organization`: The organization name of the ASN.
- `asn_number`: The ASN number.
- `ping_ms`: Ping in milliseconds.
- `download_mbps`: Download speed in Mbps.
- `upload_mbps`: Upload speed in Mbps.
- `status`: "tested" or "error".
- `error` (if status is "error"): A brief error message.
- `timestamp`: The UTC timestamp of when the test was performed.

## Important Notes for `generate_singbox_config.py`

The Python script `scripts/generate_singbox_config.py` is responsible for mapping parameters from a Clash proxy node to a Sing-box outbound configuration.
**Currently, it has explicit support for: SS, VLESS, VMess, Trojan, Hysteria2, TUIC.**
Support for other protocols needs to be added to the `clash_to_singbox_outbound` function in this script if they are present in your subscription and converted by `subconverter` into the Clash YAML.
The script attempts to handle common transport options (WS, gRPC) and TLS/Reality settings. You may need to adjust the mapping based on the specifics of how `subconverter` outputs these parameters for different node types and how `sing-box` expects them.