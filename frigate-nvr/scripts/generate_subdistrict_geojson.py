\"\"\"
Generate Buriram Sub-district GeoJSON from GADM 4.1 Level 3 and DOPA official naming.
\"\"\"
import urllib.request
import zipfile
import io
import json
import re
import os

def generate():
    url_gadm = 'https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_THA_3.json.zip'
    print(f'Downloading GADM 4.1 from {url_gadm}...')
    req = urllib.request.Request(url_gadm, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=120) as resp:
        zip_bytes = resp.read()

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        name = z.namelist()[0]
        with z.open(name) as f:
            data = json.load(f)

    br_features = [f for f in data.get('features', []) if f.get('properties', {}).get('NAME_1') == 'BuriRam']
    print(f'Extracted {len(br_features)} Buri Ram features.')

    url_dopa = 'https://raw.githubusercontent.com/thailand-geography-data/thailand-geography-json/master/src/subdistricts.json'
    req_dopa = urllib.request.Request(url_dopa, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req_dopa, timeout=30) as resp:
        all_subs = json.load(resp)
    buriram_dopa = [x for x in all_subs if x.get('provinceCode') == 31]

    manual_map = {
        ('Chalermphrakiet', 'YaiYamWattana'): ('ยายแย้มวัฒนา', 312104, 31110),
        ('Krasang', 'Kanthrarom'): ('กันทรารมย์', 310304, 31160),
        ('LamPlaiMat', 'NongKrathing'): ('หนองกระทิง', 310609, 31130),
        ('Phlapphlachai', 'PaSan'): ('ป่าชัน', 311904, 31170),
        ('Phlapphlachai', 'Sanrong'): ('สำโรง', 311903, 31170),
        ('PrakhonChai', 'CholakheMak'): ('จระเข้มาก', 310502, 31140),
        ('Satuk', 'Satuk'): ('สตึก', 311101, 31150)
    }

    def norm(s):
        if not s: return ''
        return re.sub(r'[^a-zA-Z0-9]', '', s).lower()

    dopa_by_en = {norm(d['subdistrictNameEn']): d for d in buriram_dopa}

    for f in br_features:
        p = f['properties']
        d_en = p.get('NAME_2', '')
        s_en = p.get('NAME_3', '')
        if (d_en, s_en) in manual_map:
            th, code, post = manual_map[(d_en, s_en)]
            p['NL_NAME_3'] = 'ตำบล' + th
            p['subdistrictNameTh'] = th
            p['subdistrictCode'] = code
            p['postalCode'] = post
            continue

        k = norm(s_en)
        if k in dopa_by_en:
            d = dopa_by_en[k]
            p['NL_NAME_3'] = 'ตำบล' + d['subdistrictNameTh']
            p['subdistrictNameTh'] = d['subdistrictNameTh']
            p['subdistrictCode'] = d['subdistrictCode']
            p['postalCode'] = d['postalCode']
        else:
            for dk, d in dopa_by_en.items():
                if k in dk or dk in k:
                    p['NL_NAME_3'] = 'ตำบล' + d['subdistrictNameTh']
                    p['subdistrictNameTh'] = d['subdistrictNameTh']
                    p['subdistrictCode'] = d['subdistrictCode']
                    p['postalCode'] = d['postalCode']
                    break

        if p.get('NL_NAME_2') == 'เฉลิมพระเกียรต':
            p['NL_NAME_2'] = 'เฉลิมพระเกียรติ'

    out_geojson = {
        'type': 'FeatureCollection',
        'name': 'buriram_subdistrict',
        'features': br_features
    }

    out_dir = os.path.join(os.path.dirname(__file__), '..', 'web', 'assets', 'geo')
    out_file = os.path.join(out_dir, 'buriram_subdistrict.geojson')
    with open(out_file, 'w', encoding='utf-8') as f:
        json.dump(out_geojson, f, ensure_ascii=False)
    print(f'Successfully wrote {out_file}')

if __name__ == '__main__':
    generate()
