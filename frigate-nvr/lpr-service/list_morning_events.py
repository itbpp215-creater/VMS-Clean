import urllib.request
import json
import datetime

now = datetime.datetime.now()
today_8am = datetime.datetime(now.year, now.month, now.day, 8, 0, 0).timestamp() - (7 * 3600)
today_10am = datetime.datetime(now.year, now.month, now.day, 10, 30, 0).timestamp() - (7 * 3600)

url = f'http://frigate:5000/api/events?cameras=nongwang5,nongwang3&after={today_8am}&before={today_10am}&limit=50'
res = json.loads(urllib.request.urlopen(url).read())
print(f'Total events between 08:00 - 10:00: {len(res)}')
for ev in res:
    dt = datetime.datetime.fromtimestamp(ev['start_time'] + 7*3600).strftime('%H:%M:%S')
    print(f"ID: {ev['id']} | Cam: {ev['camera']} | Time: {dt} | Label: {ev['label']} | Plate: {ev.get('sub_label')}")
