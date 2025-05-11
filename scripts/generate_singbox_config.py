#!/usr/bin/env python3
import json
import sys
from urllib.parse import unquote

def clash_to_singbox_outbound(clash_node, node_id_tag_suffix):
    # Use a sanitized version of the node name for the tag, or fallback to suffix
    raw_name = clash_node.get("name", "")
    sanitized_name = ''.join(char for char in raw_name if char.isalnum() or char in [' ', '_', '-', '.'])
    sanitized_name = sanitized_name.strip()
    tag_name = sanitized_name if sanitized_name else node_id_tag_suffix
    
    singbox_outbound = {"tag": tag_name}
    node_type = clash_node.get("type")

    if not clash_node.get("server") or clash_node.get("port") is None:
        print(f"Error: Node '{clash_node.get('name')}' is missing server or port.", file=sys.stderr)
        return None

    try:
        server_port_int = int(clash_node.get("port"))
    except ValueError:
        print(f"Error: Node '{clash_node.get('name')}' has invalid port: {clash_node.get('port')}.", file=sys.stderr)
        return None
    
    singbox_outbound["server"] = clash_node.get("server")
    singbox_outbound["server_port"] = server_port_int

    if node_type == "ss":
        singbox_outbound["type"] = "shadowsocks"
        singbox_outbound["method"] = clash_node.get("cipher")
        singbox_outbound["password"] = clash_node.get("password")
        if not all([singbox_outbound.get("method"), singbox_outbound.get("password")]):
            print(f"Error: SS Node '{clash_node.get('name')}' is missing method or password.", file=sys.stderr)
            return None
        
        plugin = clash_node.get("plugin")
        plugin_opts = clash_node.get("plugin-opts")

        if plugin and plugin_opts:
            if plugin == "v2ray-plugin" and isinstance(plugin_opts, dict) and plugin_opts.get("mode") == "websocket":
                transport_settings = {"type": "ws"}
                ws_opts_path = plugin_opts.get("path", "/")
                ws_opts_host = plugin_opts.get("host", "") 
                
                transport_settings["path"] = ws_opts_path
                if ws_opts_host:
                    transport_settings["headers"] = {"Host": ws_opts_host}
                
                singbox_outbound["transport"] = transport_settings

                if plugin_opts.get("tls", False):
                    tls_settings = {
                        "enabled": True,
                        "server_name": plugin_opts.get("host", singbox_outbound["server"]), 
                        "insecure": plugin_opts.get("skip-cert-verify", False)
                    }
                    singbox_outbound["tls"] = tls_settings
            elif plugin == "obfs" and isinstance(plugin_opts, dict):
                 print(f"Warning: SS Node '{clash_node.get('name')}' uses obfs plugin '{plugin_opts.get('obfs')}'. Direct translation to sing-box SS outbound might be limited.", file=sys.stderr)


    elif node_type == "vless" or node_type == "vmess":
        singbox_outbound["type"] = node_type
        singbox_outbound["uuid"] = clash_node.get("uuid")
        if not singbox_outbound.get("uuid"):
            print(f"Error: {node_type.upper()} Node '{clash_node.get('name')}' is missing uuid.", file=sys.stderr)
            return None

        if node_type == "vmess":
            singbox_outbound["alter_id"] = clash_node.get("alterId", 0) 
            singbox_outbound["security"] = clash_node.get("cipher", "auto")
        elif node_type == "vless":
            flow_value = clash_node.get("flow", "")
            if flow_value: 
                 singbox_outbound["flow"] = flow_value
        
        tls_enabled_clash = clash_node.get("tls", False)
        
        if tls_enabled_clash: 
            sni_candidate = clash_node.get("sni", clash_node.get("serverName")) 
            if not sni_candidate and isinstance(clash_node.get("ws-opts"), dict): 
                sni_candidate = clash_node.get("ws-opts", {}).get("headers", {}).get("Host")
            
            final_sni = sni_candidate if sni_candidate else singbox_outbound["server"]
            skip_verify = clash_node.get("skip-cert-verify", False)
            if isinstance(tls_enabled_clash, dict) and "skip-cert-verify" in tls_enabled_clash:
                skip_verify = tls_enabled_clash.get("skip-cert-verify")

            tls_settings = {
                "enabled": True,
                "server_name": final_sni,
                "insecure": skip_verify
            }
            
            client_fp = clash_node.get("client-fingerprint") 
            if client_fp: 
                tls_settings["utls"] = {"enabled": True, "fingerprint": client_fp}
            
            reality_opts = clash_node.get("reality-opts") 
            if reality_opts and isinstance(reality_opts, dict) and reality_opts.get("public-key"):
                 tls_settings["reality"] = {
                    "enabled": True,
                    "public_key": reality_opts["public-key"],
                 }
                 if "short-id" in reality_opts: 
                     tls_settings["reality"]["short_id"] = reality_opts.get("short-id", "")

            singbox_outbound["tls"] = tls_settings
        
        network = clash_node.get("network")
        if network: 
            transport_settings = {"type": network}
            if network == "ws":
                ws_opts = clash_node.get("ws-opts", {})
                transport_settings["path"] = ws_opts.get("path", "/")
                
                headers = ws_opts.get("headers", {}) 
                host_header_val = headers.get("Host", headers.get("host")) 
                if not host_header_val: 
                    host_header_val = ws_opts.get("host")

                if host_header_val:
                    headers["Host"] = host_header_val 
                elif singbox_outbound.get("tls", {}).get("enabled") and singbox_outbound.get("tls", {}).get("server_name"):
                     headers["Host"] = singbox_outbound["tls"]["server_name"] 
                elif singbox_outbound.get("server"): 
                     headers["Host"] = singbox_outbound["server"]
                
                if headers: 
                    transport_settings["headers"] = headers

            elif network == "grpc":
                grpc_opts = clash_node.get("grpc-opts", {})
                transport_settings["service_name"] = grpc_opts.get("grpc-service-name", "")
            
            singbox_outbound["transport"] = transport_settings
            
    elif node_type == "trojan":
        singbox_outbound["type"] = "trojan"
        
        password_raw = clash_node.get("password", "")
        if not password_raw:
            print(f"Error: Trojan Node '{clash_node.get('name')}' is missing password.", file=sys.stderr)
            return None
        
        password_unquoted = unquote(password_raw)
        singbox_outbound["password"] = password_unquoted
        
        final_sni = clash_node.get("sni", singbox_outbound["server"])
        # skip_verify = clash_node.get("skip-cert-verify", False) # Старая логика

        tls_settings = {
            "enabled": True, 
            "server_name": final_sni,
            "insecure": True  # <--- ИЗМЕНЕНИЕ: Всегда true для Trojan
        }
        if clash_node.get("alpn"): 
            tls_settings["alpn"] = clash_node.get("alpn")
        
        singbox_outbound["tls"] = tls_settings 

        network = clash_node.get("network") 
        if network:
            transport_settings = {"type": network}
            if network == "ws":
                ws_opts = clash_node.get("ws-opts", {})
                transport_settings["path"] = ws_opts.get("path", "/")
                headers = ws_opts.get("headers", {})
                host_header_val = headers.get("Host", headers.get("host", ws_opts.get("host")))
                
                if host_header_val:
                    headers["Host"] = host_header_val
                elif final_sni: 
                     headers["Host"] = final_sni
                
                if headers:
                    transport_settings["headers"] = headers
            
            if transport_settings: # Проверка, что transport_settings не пустой
                singbox_outbound["transport"] = transport_settings
    
    elif node_type == "hysteria2" or node_type == "hy2":
        singbox_outbound["type"] = "hysteria2"
        auth_str = clash_node.get("password") 
        if not auth_str:
            print(f"Error: Hysteria2 Node '{clash_node.get('name')}' is missing password/auth_str.", file=sys.stderr)
            return None
        singbox_outbound["auth_str"] = auth_str 

        tls_settings = {
            "enabled": True,
            "server_name": clash_node.get("sni", singbox_outbound["server"]),
            "insecure": clash_node.get("skip-cert-verify", False) # Для Hysteria2 оставляем зависимость от skip-cert-verify
        }
        if clash_node.get("alpn"):
             tls_settings["alpn"] = clash_node.get("alpn")
        client_fp = clash_node.get("client-fingerprint")
        if client_fp:
            tls_settings["utls"] = {"enabled": True, "fingerprint": client_fp}

        singbox_outbound["tls"] = tls_settings
        
        if clash_node.get("obfs") and clash_node.get("obfs-password"):
            singbox_outbound["obfs"] = {
                "type": clash_node.get("obfs"), 
                "password": clash_node.get("obfs-password")
            }
        
        if clash_node.get("up_mbps") is not None:
            try:
                singbox_outbound["up_mbps"] = int(clash_node.get("up_mbps"))
            except ValueError:
                 print(f"Warning: Hysteria2 Node '{clash_node.get('name')}' has invalid up_mbps.", file=sys.stderr)
        if clash_node.get("down_mbps") is not None:
            try:
                singbox_outbound["down_mbps"] = int(clash_node.get("down_mbps"))
            except ValueError:
                print(f"Warning: Hysteria2 Node '{clash_node.get('name')}' has invalid down_mbps.", file=sys.stderr)


    elif node_type == "tuic": 
        singbox_outbound["type"] = "tuic"
        singbox_outbound["uuid"] = clash_node.get("uuid")
        singbox_outbound["password"] = clash_node.get("password")
        if not all([singbox_outbound.get("uuid"), singbox_outbound.get("password")]):
             print(f"Error: TUIC Node '{clash_node.get('name')}' is missing uuid or password.", file=sys.stderr)
             return None
        
        tls_settings = {
            "enabled": True,
            "server_name": clash_node.get("sni", singbox_outbound["server"]),
            "insecure": clash_node.get("skip-cert-verify", False), # Для TUIC оставляем зависимость от skip-cert-verify
        }
        if clash_node.get("alpn"): 
            tls_settings["alpn"] = clash_node.get("alpn")
        client_fp = clash_node.get("client-fingerprint")
        if client_fp:
            tls_settings["utls"] = {"enabled": True, "fingerprint": client_fp}
        
        singbox_outbound["tls"] = tls_settings
        
        if clash_node.get("congestion-control"):
            singbox_outbound["congestion_control"] = clash_node.get("congestion-control")
        if clash_node.get("udp-relay-mode"): 
            singbox_outbound["udp_relay_mode"] = clash_node.get("udp-relay-mode")
        
        if "heartbeat-interval" in clash_node: 
            try:
                singbox_outbound["heartbeat_interval"] = f"{int(clash_node.get('heartbeat-interval'))}s"
            except ValueError:
                print(f"Warning: TUIC Node '{clash_node.get('name')}' has invalid heartbeat-interval.", file=sys.stderr)

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
                "listen_port": 10808, 
                "sniff": True, 
                "sniff_override_destination": False
            }
        ],
        "outbounds": [singbox_outbound_node],
        "route": {
            "rules": [
                {
                    "inbound": ["socks-in"], 
                    "outbound": singbox_outbound_node["tag"]
                }
            ],
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
            print(f"Error: Failed to generate full sing-box config for node '{clash_node_data.get('name')}'.", file=sys.stderr)
            sys.exit(1) 
    else:
        sys.exit(1)