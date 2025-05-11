#!/usr/bin/env python3
import json
import sys
from urllib.parse import unquote 

def clash_to_singbox_outbound(clash_node, node_id_tag_suffix):
    singbox_outbound = {"tag": clash_node.get("name", node_id_tag_suffix)} 
    node_type = clash_node.get("type")

    if not clash_node.get("server") or not clash_node.get("port"):
        print(f"Error: Node '{clash_node.get('name')}' is missing server or port.", file=sys.stderr)
        return None

    server_host = clash_node.get("server") 

    if node_type == "ss":
        singbox_outbound["type"] = "shadowsocks"
        singbox_outbound["server"] = server_host
        singbox_outbound["server_port"] = clash_node.get("port")
        singbox_outbound["method"] = clash_node.get("cipher")
        singbox_outbound["password"] = clash_node.get("password")
        if clash_node.get("plugin"):
            singbox_outbound["plugin"] = clash_node.get("plugin")
            if clash_node.get("plugin-opts"):
                opts = clash_node.get("plugin-opts")
                if isinstance(opts, dict):
                    if opts.get("mode") == "websocket" and singbox_outbound["plugin"] == "v2ray-plugin":
                         plugin_opts_str = f"tls={str(opts.get('tls', False)).lower()};"
                         plugin_opts_str += f"host={opts.get('host', '')};"
                         plugin_opts_str += f"path={opts.get('path', '/')};"
                         plugin_opts_str += f"mux={str(opts.get('mux', False)).lower()};"
                         plugin_opts_str += f"mode=websocket;"
                         if opts.get('skip-cert-verify'):
                             plugin_opts_str += "skip-cert-verify=true;"
                         singbox_outbound["plugin_opts"] = plugin_opts_str.strip(';')
                    elif singbox_outbound["plugin"] == "obfs":
                        plugin_opts_str = f"obfs={opts.get('obfs')};obfs-host={opts.get('obfs-host', 'www.bing.com')}"
                        singbox_outbound["plugin_opts"] = plugin_opts_str
                    else:
                        singbox_outbound["plugin_opts"] = str(opts) if not isinstance(opts, str) else opts
                else:
                    singbox_outbound["plugin_opts"] = opts

    elif node_type == "vless" or node_type == "vmess":
        singbox_outbound["type"] = node_type
        singbox_outbound["server"] = server_host
        singbox_outbound["server_port"] = clash_node.get("port")
        singbox_outbound["uuid"] = clash_node.get("uuid")
        if node_type == "vmess":
            singbox_outbound["alter_id"] = clash_node.get("alterId", 0) 
            singbox_outbound["security"] = clash_node.get("cipher", "auto") 
        
        singbox_outbound["flow"] = clash_node.get("flow", "") 

        tls_enabled_clash = clash_node.get("tls") 
        
        sni_val = clash_node.get("sni") 
        if not sni_val and isinstance(tls_enabled_clash, dict) and tls_enabled_clash.get("serverName"):
            sni_val = tls_enabled_clash.get("serverName")
        
        ws_opts_host = None
        if clash_node.get("network") == "ws":
            ws_opts = clash_node.get("ws-opts", {})
            headers_dict = ws_opts.get("headers", {})
            ws_opts_host = headers_dict.get("Host", ws_opts.get("host")) # ws-opts.host for CFW

        if not sni_val:
            sni_val = clash_node.get("host", ws_opts_host if ws_opts_host else server_host)

        skip_verify = clash_node.get("skip-cert-verify", False)
        if isinstance(tls_enabled_clash, dict) and "skip-cert-verify" in tls_enabled_clash:
            skip_verify = tls_enabled_clash.get("skip-cert-verify")

        if tls_enabled_clash: 
            tls_settings = {
                "enabled": True,
                "server_name": sni_val,
                "insecure": skip_verify
            }
            if clash_node.get("client-fingerprint"): # uTLS fingerprint
                tls_settings["utls"] = {"enabled": True, "fingerprint": clash_node.get("client-fingerprint")}
            
            if clash_node.get("reality-opts") and clash_node["reality-opts"].get("public-key"):
                 tls_settings["reality"] = {
                    "enabled": True,
                    "public_key": clash_node["reality-opts"]["public-key"],
                    "short_id": clash_node["reality-opts"].get("short-id", "")
                 }
            singbox_outbound["tls"] = tls_settings
        
        network = clash_node.get("network")
        if network: 
            transport_settings = {"type": network}
            if network == "ws":
                ws_opts = clash_node.get("ws-opts", {})
                transport_settings["path"] = ws_opts.get("path", "/")
                headers = ws_opts.get("headers", {})
                
                host_header_val = headers.get("Host", ws_opts.get("host"))
                if not host_header_val:
                    host_header_val = sni_val 
                
                if host_header_val: 
                    headers["Host"] = host_header_val
                
                if headers: 
                    transport_settings["headers"] = headers

            elif network == "grpc":
                grpc_opts = clash_node.get("grpc-opts", {})
                transport_settings["service_name"] = grpc_opts.get("grpc-service-name", "")
            
            singbox_outbound["transport"] = transport_settings
            
    elif node_type == "trojan":
        singbox_outbound["type"] = "trojan"
        singbox_outbound["server"] = server_host
        singbox_outbound["server_port"] = clash_node.get("port")
        
        password = clash_node.get("password", "")
        singbox_outbound["password"] = unquote(password) 
        
        final_sni = clash_node.get("sni", server_host)
        skip_verify = clash_node.get("skip-cert-verify", False)

        singbox_outbound["tls"] = { 
            "enabled": True, 
            "server_name": final_sni,
            "insecure": skip_verify
        }
        if clash_node.get("alpn"): 
            singbox_outbound["tls"]["alpn"] = clash_node.get("alpn")

        network = clash_node.get("network") 
        if network == "ws": 
            ws_opts = clash_node.get("ws-opts", {})
            transport_settings = {
                "type": "ws",
                "path": ws_opts.get("path", "/"),
            }
            headers = ws_opts.get("headers", {})
            host_header_val = headers.get("Host", ws_opts.get("host"))
            if not host_header_val:
                host_header_val = final_sni
            if host_header_val:
                headers["Host"] = host_header_val
            if headers:
                transport_settings["headers"] = headers
            singbox_outbound["transport"] = transport_settings
    
    elif node_type == "hysteria2" or node_type == "hy2":
        singbox_outbound["type"] = "hysteria2"
        singbox_outbound["server"] = server_host
        singbox_outbound["server_port"] = clash_node.get("port")
        # For Hysteria2, 'password' in Clash is usually the 'auth' string for Sing-box
        # Sing-box Hysteria2 uses 'auth_str' or 'auth' for this. Let's assume 'auth_str'.
        # If subconverter outputs it as 'password', we use it.
        # If it's an obfs password, that's separate.
        auth_or_pass = clash_node.get("password") 
        if auth_or_pass:
            singbox_outbound["auth_str"] = auth_or_pass # Or just "auth" depending on Sing-box version/expectation

        singbox_outbound["tls"] = {
            "enabled": True, 
            "server_name": clash_node.get("sni", server_host),
            "insecure": clash_node.get("skip-cert-verify", False)
        }
        if clash_node.get("alpn"):
             singbox_outbound["tls"]["alpn"] = clash_node.get("alpn")
        
        # Hysteria2 specific obfs (salamander)
        if clash_node.get("obfs") and clash_node.get("obfs-password"):
            singbox_outbound["obfs"] = {
                "type": clash_node.get("obfs"), 
                "password": clash_node.get("obfs-password")
            }
        # Bandwidth settings
        if clash_node.get("up_mbps") is not None: # Check for None as 0 is valid
            singbox_outbound["up_mbps"] = clash_node.get("up_mbps")
        if clash_node.get("down_mbps") is not None:
            singbox_outbound["down_mbps"] = clash_node.get("down_mbps")

    elif node_type == "tuic":
        singbox_outbound["type"] = "tuic"
        singbox_outbound["server"] = server_host
        singbox_outbound["server_port"] = clash_node.get("port")
        singbox_outbound["uuid"] = clash_node.get("uuid") 
        singbox_outbound["password"] = unquote(clash_node.get("password", ""))
        
        singbox_outbound["tls"] = { 
            "enabled": True,
            "server_name": clash_node.get("sni", server_host),
            "insecure": clash_node.get("skip-cert-verify", False),
        }
        if clash_node.get("alpn"):
            singbox_outbound["tls"]["alpn"] = clash_node.get("alpn")
        
        if clash_node.get("congestion-control"):
            singbox_outbound["congestion_control"] = clash_node.get("congestion-control")
        if clash_node.get("udp-relay-mode"): 
            singbox_outbound["udp_relay_mode"] = clash_node.get("udp-relay-mode")
        if "reduce-rtt" in clash_node: 
            singbox_outbound["reduce_rtt"] = clash_node.get("reduce-rtt")
    
    else:
        print(f"Unsupported Clash node type: {node_type} for node {clash_node.get('name')}", file=sys.stderr)
        return None
        
    return singbox_outbound

def generate_full_singbox_config(singbox_outbound_node):
    if singbox_outbound_node is None:
        return None
        
    config = {
        "log": {
            "level": "debug", 
            "timestamp": True
        },
        "inbounds": [
            {
                "type": "socks",
                "tag": "socks-in",
                "listen": "127.0.0.1",
                "listen_port": 10808
            }
        ],
        "outbounds": [singbox_outbound_node],
        "route": {
            "rules": [{"inbound": ["socks-in"], "outbound": singbox_outbound_node["tag"]}]
        }
    }
    return json.dumps(config, indent=2)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: cat clash_node.json | python generate_singbox_config.py <NODE_ID_SUFFIX_FOR_TAG>", file=sys.stderr)
        sys.exit(1)

    node_id_suffix_for_tag = sys.argv[1]
    
    try:
        clash_node_data = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(f"Error decoding JSON from stdin: {e}", file=sys.stderr)
        sys.exit(1)

    singbox_outbound = clash_to_singbox_outbound(clash_node_data, node_id_suffix_for_tag)
    
    if singbox_outbound:
        full_config_json = generate_full_singbox_config(singbox_outbound)
        if full_config_json:
            print(full_config_json)
        else:
            sys.exit(1) 
    else:
        sys.exit(1)