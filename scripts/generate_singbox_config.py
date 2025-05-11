#!/usr/bin/env python3
import json
import sys
from urllib.parse import unquote # Добавляем unquote

def clash_to_singbox_outbound(clash_node, node_id_tag_suffix):
    singbox_outbound = {"tag": clash_node.get("name", node_id_tag_suffix)} 
    node_type = clash_node.get("type")

    # ... (код для ss, vless, vmess без изменений) ...
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

        if clash_node.get("tls"): # Это для VLESS/VMess, где tls это булево или объект
            tls_enabled_clash = clash_node.get("tls")
            if isinstance(tls_enabled_clash, bool) and not tls_enabled_clash: # если tls: false
                 pass # не добавляем секцию tls
            else: # tls: true или объект tls-opts
                tls_settings = {
                    "enabled": True,
                    "server_name": clash_node.get("sni", clash_node.get("serverName", singbox_outbound["server"])), # serverName из Clash tls-opts
                    "insecure": clash_node.get("skip-cert-verify", False)
                }
                if isinstance(tls_enabled_clash, dict): # если есть tls-opts
                    if tls_enabled_clash.get("serverName"): # Clash < v1.0.0
                        tls_settings["server_name"] = tls_enabled_clash.get("serverName")
                    if "skip-cert-verify" in tls_enabled_clash:
                        tls_settings["insecure"] = tls_enabled_clash.get("skip-cert-verify")
                
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
            headers = ws_opts.get("headers", {})
            # Убедимся, что Host есть, если он нужен
            host_to_use = clash_node.get("host", ws_opts.get("host", headers.get("Host")))
            if host_to_use:
                headers["Host"] = host_to_use
            elif singbox_outbound.get("tls", {}).get("server_name"):
                 headers["Host"] = singbox_outbound["tls"]["server_name"]
            
            if headers: # Добавляем заголовки, только если они есть
                transport_settings["headers"] = headers


        elif network == "grpc":
            grpc_opts = clash_node.get("grpc-opts", {})
            transport_settings["service_name"] = grpc_opts.get("grpc-service-name", "")
        
        if network in ["ws", "grpc"]:
            singbox_outbound["transport"] = transport_settings
            
    elif node_type == "trojan":
        singbox_outbound["type"] = "trojan"
        singbox_outbound["server"] = clash_node.get("server")
        singbox_outbound["server_port"] = clash_node.get("port")
        
        # ИСПРАВЛЕНИЕ: URL-декодируем пароль
        password = clash_node.get("password", "")
        singbox_outbound["password"] = unquote(password)
        
        # ИСПРАВЛЕНИЕ для SNI:
        # Если SNI из Clash это "t.me" или другой общий домен, который явно не сервер,
        # и skip-cert-verify не true, то лучше использовать server как SNI.
        # Это эвристика, но часто помогает.
        clash_sni = clash_node.get("sni")
        server_host = singbox_outbound["server"]
        skip_verify = clash_node.get("skip-cert-verify", False)
        
        final_sni = server_host # По умолчанию SNI равен серверу
        if clash_sni: # Если SNI предоставлен в Clash конфиге
            # Простая проверка, если SNI - это известный "маскировочный" домен и не равен серверу
            # и проверка сертификата включена, то есть риск ошибки.
            # В идеале, SNI должен совпадать с тем, на что выдан сертификат сервера.
            # Если skip-cert-verify=true, то SNI может быть любым для маскировки.
            if skip_verify:
                final_sni = clash_sni # Используем SNI из конфига, если проверка отключена
            else:
                # Если проверка включена, и SNI из конфига не похож на основной домен сервера,
                # безопаснее использовать основной домен сервера.
                # Это очень грубая эвристика. В идеале, конфиг должен быть правильным.
                if clash_sni != server_host and (clash_sni.count('.') < server_host.count('.') or clash_sni in ["t.me", "www.google.com"]): # Пример
                    print(f"Warning: For Trojan node {clash_node.get('name')}, SNI '{clash_sni}' from config differs from server '{server_host}' and skip-cert-verify is false. Using server as SNI.", file=sys.stderr)
                    final_sni = server_host
                else:
                    final_sni = clash_sni


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
            singbox_outbound["transport"] = {
                "type": "ws",
                "path": ws_opts.get("path", "/"),
                "headers": ws_opts.get("headers", {})
            }
            if "Host" not in singbox_outbound["transport"]["headers"] and singbox_outbound["tls"].get("server_name"):
                 singbox_outbound["transport"]["headers"]["Host"] = singbox_outbound["tls"]["server_name"]
    
    elif node_type == "hysteria2" or node_type == "hy2":
        # ... (код для hysteria2 без изменений) ...
        singbox_outbound["type"] = "hysteria2"
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
        if clash_node.get("obfs") and clash_node.get("obfs-password"):
            singbox_outbound["obfs"] = {
                "type": clash_node.get("obfs"), 
                "password": clash_node.get("obfs-password")
            }
        if clash_node.get("up_mbps"):
            singbox_outbound["up_mbps"] = clash_node.get("up_mbps")
        if clash_node.get("down_mbps"):
            singbox_outbound["down_mbps"] = clash_node.get("down_mbps")

    elif node_type == "tuic":
        # ... (код для tuic без изменений) ...
        singbox_outbound["type"] = "tuic"
        singbox_outbound["server"] = clash_node.get("server")
        singbox_outbound["server_port"] = clash_node.get("port")
        singbox_outbound["uuid"] = clash_node.get("uuid") 
        singbox_outbound["password"] = clash_node.get("password") 
        
        singbox_outbound["tls"] = { 
            "enabled": True,
            "server_name": clash_node.get("sni", singbox_outbound["server"]),
            "insecure": clash_node.get("skip-cert-verify", False),
        }
        if clash_node.get("alpn"):
            singbox_outbound["tls"]["alpn"] = clash_node.get("alpn")
        
        if clash_node.get("congestion-control"):
            singbox_outbound["congestion_control"] = clash_node.get("congestion-control")
        if clash_node.get("udp-relay-mode"): 
            singbox_outbound["udp_relay_mode"] = clash_node.get("udp-relay-mode")
    
    else:
        print(f"Unsupported Clash node type: {node_type} for node {clash_node.get('name')}", file=sys.stderr)
        return None

    if not all(k in singbox_outbound for k in ["type", "server", "server_port"]):
        print(f"Generated Sing-box config missing essential fields for node {clash_node.get('name')}: {singbox_outbound}", file=sys.stderr)
        return None
        
    return singbox_outbound

def generate_full_singbox_config(singbox_outbound_node):
    # ... (без изменений) ...
    if singbox_outbound_node is None:
        return None
        
    config = {
        "log": {"level": "warn", "timestamp": True}, # Можно временно поставить "debug" для sing-box
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
    # ... (без изменений) ...
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