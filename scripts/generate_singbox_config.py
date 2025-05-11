#!/usr/bin/env python3
import json
import sys

def clash_to_singbox_outbound(clash_node, node_id_tag_suffix):
    singbox_outbound = {"tag": clash_node.get("name", node_id_tag_suffix)} 

    node_type = clash_node.get("type")

    if node_type == "ss":
        singbox_outbound["type"] = "shadowsocks"
        singbox_outbound["server"] = clash_node.get("server")
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
        singbox_outbound["server"] = clash_node.get("server")
        singbox_outbound["server_port"] = clash_node.get("port")
        singbox_outbound["uuid"] = clash_node.get("uuid")
        if node_type == "vmess":
            singbox_outbound["alter_id"] = clash_node.get("alterId", 0)
            singbox_outbound["security"] = clash_node.get("cipher", "auto")
        
        singbox_outbound["flow"] = clash_node.get("flow", "")

        if clash_node.get("tls"):
            tls_settings = {
                "enabled": True,
                "server_name": clash_node.get("sni", clash_node.get("serverName", clash_node.get("host", singbox_outbound["server"]))),
                "insecure": clash_node.get("skip-cert-verify", False)
            }
            if clash_node.get("client-fingerprint"):
                tls_settings["utls"] = {"enabled": True, "fingerprint": clash_node.get("client-fingerprint")}
            
            if clash_node.get("reality-opts") and clash_node["reality-opts"].get("public-key"):
                 tls_settings["reality"] = {
                    "enabled": True,
                    "public_key": clash_node["reality-opts"]["public-key"],
                    "short_id": clash_node["reality-opts"].get("short-id", "")
                 }
            singbox_outbound["tls"] = tls_settings

        network = clash_node.get("network")
        transport_settings = {"type": network}
        if network == "ws":
            ws_opts = clash_node.get("ws-opts", {})
            transport_settings["path"] = ws_opts.get("path", "/")
            transport_settings["headers"] = ws_opts.get("headers", {})
            if "Host" not in transport_settings["headers"] and clash_node.get("host"):
                 transport_settings["headers"]["Host"] = clash_node.get("host")
            elif "Host" not in transport_settings["headers"] and singbox_outbound.get("tls", {}).get("server_name"):
                 transport_settings["headers"]["Host"] = singbox_outbound["tls"]["server_name"]


        elif network == "grpc":
            grpc_opts = clash_node.get("grpc-opts", {})
            transport_settings["service_name"] = grpc_opts.get("grpc-service-name", "")
        
        if network in ["ws", "grpc"]:
            singbox_outbound["transport"] = transport_settings
            
    elif node_type == "trojan":
        singbox_outbound["type"] = "trojan"
        singbox_outbound["server"] = clash_node.get("server")
        singbox_outbound["server_port"] = clash_node.get("port")
        singbox_outbound["password"] = clash_node.get("password")
        
        singbox_outbound["tls"] = {
            "enabled": True,
            "server_name": clash_node.get("sni", singbox_outbound["server"]),
            "insecure": clash_node.get("skip-cert-verify", False)
        }
        if clash_node.get("alpn"):
            singbox_outbound["tls"]["alpn"] = clash_node.get("alpn")

        network = clash_node.get("network")
        if network == "ws":
            ws_opts = clash_node.get("ws-opts", {})
            singbox_outbound["transport"] = {
                "type": "ws",
                "path": ws_opts.get("path", "/"),
                "headers": ws_opts.get("headers", {})
            }
            if "Host" not in singbox_outbound["transport"]["headers"] and singbox_outbound["tls"].get("server_name"):
                 singbox_outbound["transport"]["headers"]["Host"] = singbox_outbound["tls"]["server_name"]
    
    elif node_type == "hysteria2" or node_type == "hy2": # Clash uses 'hysteria2' or 'hy2'
        singbox_outbound["type"] = "hysteria2"
        singbox_outbound["server"] = clash_node.get("server")
        singbox_outbound["server_port"] = clash_node.get("port")
        singbox_outbound["password"] = clash_node.get("password") # For Hysteria2, this is the auth string
        singbox_outbound["tls"] = {
            "enabled": True, # Hysteria2 is always TLS-like (QUIC)
            "server_name": clash_node.get("sni", singbox_outbound["server"]),
            "insecure": clash_node.get("skip-cert-verify", False)
        }
        if clash_node.get("alpn"):
             singbox_outbound["tls"]["alpn"] = clash_node.get("alpn")
        # Hysteria2 specific options if Clash provides them and Sing-box supports them directly
        # For example, obfs and its password might be in 'obfs' and 'obfs-password' in Clash
        if clash_node.get("obfs") and clash_node.get("obfs-password"):
            singbox_outbound["obfs"] = {
                "type": clash_node.get("obfs"), # e.g. "salamander"
                "password": clash_node.get("obfs-password")
            }
        # Bandwidth settings (up_mbps, down_mbps in Clash)
        # Sing-box Hysteria2 has 'up_mbps' and 'down_mbps' directly in the outbound
        if clash_node.get("up_mbps"):
            singbox_outbound["up_mbps"] = clash_node.get("up_mbps")
        if clash_node.get("down_mbps"):
            singbox_outbound["down_mbps"] = clash_node.get("down_mbps")


    elif node_type == "tuic": # Clash uses 'tuic'
        singbox_outbound["type"] = "tuic"
        singbox_outbound["server"] = clash_node.get("server")
        singbox_outbound["server_port"] = clash_node.get("port")
        singbox_outbound["uuid"] = clash_node.get("uuid") # TUIC v5 uses UUID
        singbox_outbound["password"] = clash_node.get("password") # TUIC v5 uses password
        
        singbox_outbound["tls"] = { # TUIC is QUIC based, so TLS-like settings
            "enabled": True,
            "server_name": clash_node.get("sni", singbox_outbound["server"]),
            "insecure": clash_node.get("skip-cert-verify", False),
        }
        if clash_node.get("alpn"):
            singbox_outbound["tls"]["alpn"] = clash_node.get("alpn")
        
        # TUIC specific parameters from Clash to Sing-box
        # congestion_control, udp_relay_mode, reduce_rtt etc.
        if clash_node.get("congestion-control"):
            singbox_outbound["congestion_control"] = clash_node.get("congestion-control")
        if clash_node.get("udp-relay-mode"): # e.g. "native", "quic"
            singbox_outbound["udp_relay_mode"] = clash_node.get("udp-relay-mode")
        # Add other TUIC parameters as needed if they map directly

    else:
        print(f"Unsupported Clash node type: {node_type} for node {clash_node.get('name')}", file=sys.stderr)
        return None

    if not all(k in singbox_outbound for k in ["type", "server", "server_port"]):
        print(f"Generated Sing-box config missing essential fields for node {clash_node.get('name')}: {singbox_outbound}", file=sys.stderr)
        return None
        
    return singbox_outbound

def generate_full_singbox_config(singbox_outbound_node):
    if singbox_outbound_node is None:
        return None
        
    config = {
        "log": {"level": "warn", "timestamp": True},
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