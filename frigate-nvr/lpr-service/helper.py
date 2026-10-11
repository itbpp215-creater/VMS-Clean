# helper.py — ตารางแปลงรหัส class ของโมเดล data_plate.pt เป็นข้อความไทย
# และตัวช่วยแยก "เลขทะเบียน" กับ "จังหวัด" ออกจากสตริงที่ประกอบจากตัวอักษรที่ตรวจจับได้
#
# ที่มา: คัดลอกและจัดระเบียบจาก LicensePlateRECOG/function/helper.py (โค้ดต้นแบบของทีม)
# โดยตัดเฉพาะส่วนที่ service นี้ใช้จริง — mapping ต้องตรงกับชื่อ class ที่โมเดลถูก train มา
# (A01-A44 = พยัญชนะไทย, รหัส 3 ตัวอักษร = จังหวัด) ห้ามแก้ค่าโดยไม่ retrain โมเดล

# ตาราง "รหัสจังหวัด" -> ชื่อจังหวัดไทย ตามที่โมเดล data_plate.pt ถูก train
# หมายเหตุ: บางรหัสในชุด train ซ้ำ/สะกดไม่ตรงมาตรฐานราชการ (เช่น CNT/CRI = เชียงราย)
# — คงไว้ตามต้นแบบเพื่อให้ผลตรงกับโมเดล ไม่ใช่ตารางอ้างอิงมาตรฐาน
DATA_PROVINCE = {
    "ACR": "อำนาจเจริญ", "ATG": "อ่างทอง", "AYA": "พระนครศรีอยุธยา",
    "BKK": "กรุงเทพมหานคร", "BKN": "บึงกาฬ", "BRM": "บุรีรัมย์", "BTG": "พัทลุง",
    "CBI": "ชลบุรี", "CCO": "ฉะเชิงเทรา", "CMI": "เชียงใหม่", "CNT": "ชัยนาท",
    "CPM": "ชัยภูมิ", "CPN": "ชุมพร", "CRI": "เชียงราย", "CTI": "จันทบุรี",
    "KBI": "กระบี่", "KKN": "ขอนแก่น", "KPT": "กำแพงเพชร", "KRI": "กาญจนบุรี",
    "KSN": "กาฬสินธุ์", "LEI": "เลย", "LPG": "ลำปาง", "LPN": "ลำพูน",
    "LRI": "ลพบุรี", "MDH": "มุกดาหาร", "MKM": "มหาสารคาม", "MSN": "แม่ฮ่องสอน",
    "NAN": "น่าน", "NBI": "นนทบุรี", "NBP": "นครปฐม", "NKI": "หนองคาย",
    "NMA": "นครราชสีมา", "NPM": "นครพนม", "NPT": "นครปฐม", "NSN": "นครสวรรค์",
    "NST": "นครศรีธรรมราช", "NYK": "นครนายก", "PBI": "เพชรบุรี", "PCT": "เพชรบูรณ์",
    "PKN": "ประจวบคีรีขันธ์", "PKT": "ภูเก็ต", "PLG": "พัทลุง", "PLK": "พิษณุโลก",
    "PNA": "พังงา", "PNB": "ปัตตานี", "PRE": "แพร่", "PRI": "ปราจีนบุรี",
    "PTE": "ปทุมธานี", "PTN": "ปัตตานี", "PYO": "พะเยา", "RBR": "ราชบุรี",
    "RET": "ร้อยเอ็ด", "RNG": "ระนอง", "RYG": "ระยอง", "SBR": "สระบุรี",
    "SKA": "สงขลา", "SKM": "สมุทรสงคราม", "SKN": "สมุทรสาคร", "SKW": "สระแก้ว",
    "SNI": "สุราษฎร์ธานี", "SNK": "สกลนคร", "SPB": "สุพรรณบุรี", "SPK": "สมุทรปราการ",
    "SRI": "สุราษฎร์ธานี", "SRN": "สุรินทร์", "SSK": "ศรีสะเกษ", "STI": "สตูล",
    "TAK": "ตาก", "TRG": "ตรัง", "TRT": "ตราด", "UBN": "อุบลราชธานี",
    "UDN": "อุดรธานี", "UTI": "อุทัยธานี", "UTT": "อุตรดิตถ์",
    "YLA": "ยะลา", "YST": "ยโสธร",
}

# ตาราง "รหัสพยัญชนะ" -> ตัวอักษรไทย ตามที่โมเดล data_plate.pt ถูก train
# (รวมกับตารางจังหวัดในฟังก์ชันเดียว เพราะโมเดลคืน class ปนกันทั้งสองแบบ)
_THAI_CHAR = {
    # A05=ฅ เพิ่ม 2026-07-17: โมเดลจริงมี class A05 แต่ตารางต้นแบบไม่มี (startup check
    # เตือนทุกบูต) — อนุมานจาก pattern ที่รหัสตรงลำดับพยัญชนะไทยทุกตัว (A04=ค, A06=ฆ,
    # A27=ป ฯลฯ) ดังนั้น A05=ฅ; ถ้าผลอ่านจริงโชว์ ฅ ผิดที่บ่อย ให้สงสัยว่า label ตอน
    # train ต่างจากลำดับนี้ แล้วตาม reconcile กับทีมเจ้าของโมเดล
    "A01": "ก", "A02": "ข", "A04": "ค", "A05": "ฅ", "A06": "ฆ", "A07": "ง", "A08": "จ",
    "A09": "ฉ", "A10": "ช", "A12": "ฌ", "A13": "ญ", "A14": "ฎ", "A16": "ฐ",
    "A18": "ฒ", "A19": "ณ", "A20": "ด", "A21": "ต", "A22": "ถ", "A23": "ท",
    "A24": "ธ", "A25": "น", "A26": "บ", "A27": "ป", "A28": "ผ", "A30": "พ",
    "A31": "ฟ", "A32": "ภ", "A33": "ม", "A34": "ย", "A35": "ร", "A36": "ล",
    "A37": "ว", "A38": "ศ", "A39": "ษ", "A40": "ส", "A41": "ห", "A42": "ฬ",
    "A43": "อ", "A44": "ฮ",
}


def get_thai_character(code):
    """แปลงรหัส class จากโมเดลเป็นข้อความไทย

    Input:  code (str) — ชื่อ class จาก data_plate.pt เช่น "A01", "BKK", "5"
    Output: ตัวอักษร/ชื่อจังหวัดไทย — ตัวเลข 0-9 โมเดลตอบเป็นเลขตรง ๆ คืนค่าเดิมได้
    ข้อยกเว้น: รหัสรูปแบบ "A##" ที่ไม่มีในตาราง ให้ "ทิ้ง" (คืน "") — ดีกว่าปล่อยรหัสดิบ
    ไปปนในข้อความทะเบียนจนเทียบบัญชีต้องสงสัยไม่ตรง
    ⚠️ การทิ้งทำให้ทะเบียนขาดตัวอักษรได้ — app.py มี startup check (check_model_classes)
    log เตือนทุกรหัสที่โมเดลตอบได้แต่ตารางแปลไม่ได้ เพื่อให้เห็นปัญหาและตามทีม
    เจ้าของโมเดลมา reconcile ตารางกับ label จริงที่ใช้ train (ดู feature doc)
    """
    if code in _THAI_CHAR:
        return _THAI_CHAR[code]
    if code in DATA_PROVINCE:
        return DATA_PROVINCE[code]
    # รหัสพยัญชนะที่ไม่รู้จัก -> ทิ้ง (กันสตริงทะเบียนเสีย); อย่างอื่น (ตัวเลข) คืนค่าเดิม
    if len(code) == 3 and code[0] == "A" and code[1:].isdigit():
        return ""
    return code


def check_model_classes(model_class_names):
    """ตรวจความสอดคล้องระหว่างตาราง mapping กับ class จริงของโมเดล data_plate.pt

    Input:  model_class_names — iterable ของชื่อ class จากโมเดล (values ของ model.names)
    Output: (unmapped, dead)
      unmapped = รหัส A## ที่โมเดลตอบได้แต่ตารางแปลไม่ได้ (ตัวอักษรจะหายจากทะเบียน!)
      dead     = รหัส A## ในตารางที่โมเดลไม่มีทาง output (ตัวอักษรนั้นไม่มีวันปรากฏ)
    ใช้เรียกครั้งเดียวตอน start เพื่อ "fail loudly" — ประวัติ: เคยพบโมเดลมี A05
    (ตารางไม่มี — แก้แล้ว 2026-07-17 ดู comment ที่ _THAI_CHAR) และตารางมี A27=ป
    ที่โมเดลไม่มีทาง output (ยังค้าง — ตัวอักษร ป จะไม่มีวันปรากฏจนกว่าจะ retrain)
    """
    names = set(model_class_names)
    model_a_codes = {n for n in names if len(n) == 3 and n[0] == "A" and n[1:].isdigit()}
    unmapped = sorted(model_a_codes - set(_THAI_CHAR))
    dead = sorted(set(_THAI_CHAR) - model_a_codes)
    return unmapped, dead


import difflib
import re

ALL_THAI_PROVINCES = [
    "กรุงเทพมหานคร", "กระบี่", "กาญจนบุรี", "กาฬสินธุ์", "กำแพงเพชร", "ขอนแก่น", "จันทบุรี",
    "ฉะเชิงเทรา", "ชลบุรี", "ชัยนาท", "ชัยภูมิ", "ชุมพร", "เชียงราย", "เชียงใหม่", "ตรัง",
    "ตราด", "ตาก", "นครนายก", "นครปฐม", "นครพนม", "นครราชสีมา", "นครศรีธรรมราช", "นครสวรรค์",
    "นนทบุรี", "นราธิวาส", "น่าน", "บึงกาฬ", "บุรีรัมย์", "ปทุมธานี", "ประจวบคีรีขันธ์",
    "ปราจีนบุรี", "ปัตตานี", "พระนครศรีอยุธยา", "พะเยา", "พังงา", "พัทลุง", "พิจิตร",
    "พิษณุโลก", "เพชรบุรี", "เพชรบูรณ์", "แพร่", "ภูเก็ต", "มหาสารคาม", "มุกดาหาร",
    "แม่ฮ่องสอน", "ยโสธร", "ยะลา", "ร้อยเอ็ด", "ระนอง", "ระยอง", "ราชบุรี", "ลพบุรี",
    "ลำปาง", "ลำพูน", "เลย", "ศรีสะเกษ", "สกลนคร", "สงขลา", "สตูล", "สมุทรปราการ",
    "สมุทรสงคราม", "สมุทรสาคร", "สระแก้ว", "สระบุรี", "สิงห์บุรี", "สุโขทัย", "สุพรรณบุรี",
    "สุราษฎร์ธานี", "สุรินทร์", "หนองคาย", "หนองบัวลำภู", "อ่างทอง", "อำนาจเจริญ", "อุดรธานี",
    "อุตรดิตถ์", "อุทัยธานี", "อุบลราชธานี"
]


def denoise_thai_tokens(tokens):
    """ตัดตัวอักษรขยะที่เกิดจากหัวน็อต/รอยเปื้อน (ADR-0027 Heuristic Plate Denoise)
    
    tokens: list of (char_str, conf_float)
    """
    if not tokens:
        return []
    
    # 1. ตัดพยัญชนะไทยที่หลุดมาอยู่หลังตัวเลข (ป้ายไทยไม่มีพยัญชนะตามหลังตัวเลข)
    last_digit_idx = -1
    for i, (c, conf) in enumerate(tokens):
        if c.isdigit():
            last_digit_idx = i
            
    if last_digit_idx >= 0:
        tokens = [t for i, t in enumerate(tokens) if not (i > last_digit_idx and re.match(r'[\u0E01-\u0E2E]', t[0]))]

    # 2. ตรวจสอบหมวดอักษรด้านหน้าตัวเลข
    first_digit_idx = len(tokens)
    for i, (c, conf) in enumerate(tokens):
        if c.isdigit():
            first_digit_idx = i
            break

    prefix_tokens = tokens[:first_digit_idx]
    digits_tokens = tokens[first_digit_idx:]

    consonant_indices = [i for i, (c, conf) in enumerate(prefix_tokens) if re.match(r'[\u0E01-\u0E2E]', c)]
    # ในไทย หมวดอักษรหน้าตัวเลขมีได้มากสุด 2 ตัวอักษร (เช่น 1กข หรือ บท)
    # หากพบ >= 3 ตัวอักษร แสดงว่ามีหัวน็อต/รอยเปื้อนแทรก ให้ตัดตัวที่มี confidence ต่ำสุดออก
    while len(consonant_indices) > 2:
        min_idx = min(consonant_indices, key=lambda idx: prefix_tokens[idx][1])
        prefix_tokens.pop(min_idx)
        consonant_indices = [i for i, (c, conf) in enumerate(prefix_tokens) if re.match(r'[\u0E01-\u0E2E]', c)]

    return prefix_tokens + digits_tokens


def split_license_plate_and_province(text):
    """แยกสตริงที่ประกอบแล้ว (เช่น "กษ697เชียงใหม่") เป็น (เลขทะเบียน, จังหวัด)

    หลักการ: บนป้ายจริง ส่วน "เลขทะเบียน" จบด้วยตัวเลขเสมอ ส่วนที่ตามหลัง
    ตัวเลขตัวสุดท้ายคือชื่อจังหวัด — จึงหา index ของตัวเลขสุดท้ายแล้วตัดแบ่ง
    จากนั้นเทียบส่วนท้ายกับชื่อจังหวัดที่รู้จัก (เรียงชื่อยาวก่อน กันชื่อที่เป็น
    substring ของกัน เช่น "ชลบุรี" ใน "สิงห์บุรี" จับผิดตัว)

    Output: (license_plate, province) — ("", "") ถ้าไม่มีตัวเลขเลย
    """
    last_number_index = len(text) - 1
    while last_number_index >= 0 and not text[last_number_index].isdigit():
        last_number_index -= 1

    if last_number_index < 0:
        return "", ""

    province_text = text[last_number_index + 1:].strip()
    license_plate = text[:last_number_index + 1].strip()

    if province_text:
        # เรียงจากชื่อยาวไปสั้น เพื่อ match ชื่อเต็มก่อนชื่อที่เป็น substring
        provinces = sorted(set(DATA_PROVINCE.values()) | set(ALL_THAI_PROVINCES), key=len, reverse=True)
        for prov in provinces:
            if province_text.startswith(prov):
                return license_plate, prov
        for prov in provinces:
            if prov in province_text:
                return license_plate, prov

        # ADR-0027: Fuzzy Matching สำหรับกรณีสะกดเพี้ยน 1-2 ตัวอักษร
        if len(province_text) >= 3:
            close_matches = difflib.get_close_matches(province_text, ALL_THAI_PROVINCES, n=1, cutoff=0.60)
            if close_matches:
                return license_plate, close_matches[0]

    return license_plate, province_text
