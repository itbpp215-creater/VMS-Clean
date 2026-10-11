import os
import json
import ruamel.yaml

def update_config():
    yaml = ruamel.yaml.YAML()
    yaml.preserve_quotes = True
    config_path = "/config/config.yml"
    
    with open(config_path, "r", encoding="utf-8") as f:
        data = yaml.load(f)

    # 1. Update top-level detect
    if "detect" in data:
        data["detect"]["enabled"] = False

    # 2. Update each camera
    cameras = data.get("cameras", {})
    for cam_name, cam_cfg in cameras.items():
        if not isinstance(cam_cfg, dict):
            continue
        # Set detect.enabled = False
        if "detect" not in cam_cfg:
            cam_cfg["detect"] = {"enabled": False}
        else:
            cam_cfg["detect"]["enabled"] = False
        
        # Remove detect from ffmpeg input roles
        ffmpeg = cam_cfg.get("ffmpeg", {})
        inputs = ffmpeg.get("inputs", [])
        for inp in inputs:
            roles = inp.get("roles", [])
            if "detect" in roles:
                inp["roles"] = [r for r in roles if r != "detect"]
                if not inp["roles"]:
                    inp["roles"] = ["record"]

    # Write atomically
    tmp_path = config_path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        yaml.dump(data, f)
    os.replace(tmp_path, config_path)
    print(f"Successfully disabled detect on {len(cameras)} cameras in {config_path}")

def update_templates():
    tmpl_path = "/config/camera_templates.json"
    if not os.path.exists(tmpl_path):
        return
    with open(tmpl_path, "r", encoding="utf-8") as f:
        templates = json.load(f)
    
    for cam_name, tmpl in templates.items():
        if not isinstance(tmpl, dict):
            continue
        if "detect" not in tmpl:
            tmpl["detect"] = {"enabled": False}
        else:
            tmpl["detect"]["enabled"] = False
        
        for inp in tmpl.get("ffmpeg", {}).get("inputs", []):
            roles = inp.get("roles", [])
            if "detect" in roles:
                inp["roles"] = [r for r in roles if r != "detect"]
                if not inp["roles"]:
                    inp["roles"] = ["record"]

    tmp_path = tmpl_path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(templates, f, indent=2, ensure_ascii=False)
    os.replace(tmp_path, tmpl_path)
    print(f"Successfully updated {len(templates)} templates in {tmpl_path}")

if __name__ == "__main__":
    update_config()
    update_templates()
