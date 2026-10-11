import sys

with open(r'd:\project\BPP-VMS\frigate-nvr\config-api\api.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace add_camera logic
old_add = '''        # An explicit empty object list disables detection, while an omitted list
        # continues to use Frigate's global object policy.
        effective_ai_enabled = camera.ai_enabled and (
            camera.track is None or bool(camera.track)
        )
        lpr_cams = get_lpr_cameras()
        inputs = configure_camera_inputs(
            camera.name,
            camera.rtsp_url,
            camera.sub_url,
            effective_ai_enabled,
            camera.name in lpr_cams,
        )

        cam_block = {
            'ffmpeg': {'inputs': inputs},
            'detect': {'enabled': effective_ai_enabled},
            'record': {
                'enabled': True,
                'alerts': {'retain': {'days': 7, 'mode': 'motion'}},
                'detections': {'retain': {'days': 7, 'mode': 'motion'}}
            },
            'snapshots': {
                'enabled': True,
                'bounding_box': True
            }
        }
        # Legacy dashboard provisioning supplies a recommended object list; keep
        # it in this same validated commit instead of issuing a second file write.
        if camera.track is not None:
            cam_block['objects'] = {'track': list(camera.track)}'''

new_add = '''        is_lpr = camera.name in get_lpr_cameras()
        effective_ai_enabled = camera.ai_enabled or is_lpr
        
        inputs = configure_camera_inputs(
            camera.name,
            camera.rtsp_url,
            camera.sub_url,
            effective_ai_enabled,
            is_lpr,
        )

        cam_block = {
            'ffmpeg': {'inputs': inputs},
            'detect': {'enabled': effective_ai_enabled},
            'record': {
                'enabled': True,
                'continuous': {'days': 0},
                'motion': {'days': 0},
                'alerts': {'retain': {'days': 7, 'mode': 'active_objects'}},
                'detections': {'retain': {'days': 7, 'mode': 'active_objects'}}
            },
            'snapshots': {
                'enabled': True,
                'bounding_box': True
            }
        }
        
        if not camera.ai_enabled and is_lpr:
            cam_block['objects'] = {'track': ['car', 'motorcycle']}
        elif camera.track is not None:
            cam_block['objects'] = {'track': list(camera.track)}'''

content = content.replace(old_add, new_add)

# Replace update_camera logic
old_update = '''        # `track=None` is a preservation signal for edits from the camera
        # manager. An explicit empty list means detection must be disabled.
        effective_track = camera.track if camera.track is not None else existing_track
        effective_ai_enabled = camera.ai_enabled and (
            effective_track is None or bool(effective_track)
        )
        lpr_cams = get_lpr_cameras()
        inputs = configure_camera_inputs(
            camera.name,
            camera.rtsp_url,
            camera.sub_url,
            effective_ai_enabled,
            camera.name in lpr_cams,
        )
        cam_block['ffmpeg'] = {'inputs': inputs}
        cam_block.setdefault('detect', {})['enabled'] = effective_ai_enabled
        record_block = cam_block.setdefault('record', {})
        record_block['enabled'] = True
        record_block.pop('continuous', None)
        record_block.pop('motion', None)
        record_block.setdefault('alerts', {}).setdefault('retain', {})['mode'] = 'motion'
        record_block.setdefault('detections', {}).setdefault('retain', {})['mode'] = 'motion'
        cam_block.setdefault('snapshots', {}).setdefault('enabled', True)
        cam_block['snapshots'].setdefault('bounding_box', True)
        if camera.track is not None:
            cam_block['objects'] = {'track': list(camera.track)}'''

new_update = '''        is_lpr = camera.name in get_lpr_cameras()
        effective_ai_enabled = camera.ai_enabled or is_lpr
        
        inputs = configure_camera_inputs(
            camera.name,
            camera.rtsp_url,
            camera.sub_url,
            effective_ai_enabled,
            is_lpr,
        )
        cam_block['ffmpeg'] = {'inputs': inputs}
        cam_block.setdefault('detect', {})['enabled'] = effective_ai_enabled
        
        record_block = cam_block.setdefault('record', {})
        record_block['enabled'] = True
        record_block['continuous'] = {'days': 0}
        record_block['motion'] = {'days': 0}
        record_block.setdefault('alerts', {}).setdefault('retain', {})['mode'] = 'active_objects'
        record_block.setdefault('detections', {}).setdefault('retain', {})['mode'] = 'active_objects'
        
        cam_block.setdefault('snapshots', {}).setdefault('enabled', True)
        cam_block['snapshots'].setdefault('bounding_box', True)
        
        if not camera.ai_enabled and is_lpr:
            cam_block['objects'] = {'track': ['car', 'motorcycle']}
        elif camera.track is not None:
            cam_block['objects'] = {'track': list(camera.track)}'''

content = content.replace(old_update, new_update)

with open(r'd:\project\BPP-VMS\frigate-nvr\config-api\api.py', 'w', encoding='utf-8') as f:
    f.write(content)
