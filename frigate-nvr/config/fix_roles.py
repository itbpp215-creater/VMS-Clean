
import urllib.request, json, sys

try:
    req = urllib.request.Request("http://127.0.0.1:5000/api/config")
    with urllib.request.urlopen(req) as response:
        config = json.loads(response.read().decode())

    for cam_name, cam_config in config.get("cameras", {}).items():
        detect_enabled = cam_config.get("detect", {}).get("enabled", True)
        
        # We also want to clear out detect role if "track" is empty, just in case!
        track = cam_config.get("objects", {}).get("track", [])
        if not track:
            detect_enabled = False
            
        for inp in cam_config.get("ffmpeg", {}).get("inputs", []):
            roles = set(inp.get("roles", []))
            orig_roles = set(roles)
            if not detect_enabled and "detect" in roles:
                roles.remove("detect")
            elif detect_enabled and "detect" not in roles:
                roles.add("detect")
                
            if roles != orig_roles:
                print(f"Updating roles for {cam_name} to {list(roles)}")
                update_data = {
                    "requires_restart": 1,
                    "config_data": {
                        "cameras": {
                            cam_name: {
                                "ffmpeg": {
                                    "inputs": [
                                        {
                                            "path": inp["path"],
                                            "roles": list(roles),
                                            "input_args": inp.get("input_args", "")
                                        }
                                    ]
                                },
                                "detect": {
                                    "enabled": detect_enabled
                                }
                            }
                        }
                    }
                }
                put_req = urllib.request.Request("http://127.0.0.1:5000/api/config/set", method="PUT")
                put_req.add_header("Content-Type", "application/json")
                try:
                    urllib.request.urlopen(put_req, json.dumps(update_data).encode())
                except Exception as e:
                    print(f"Error updating {cam_name}: {e}")
except Exception as e:
    print(f"Fatal error: {e}")

