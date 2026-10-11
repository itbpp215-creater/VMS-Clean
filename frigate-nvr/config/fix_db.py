import sqlite3

def fix_db():
    conn = sqlite3.connect('/db/frigate.db')
    cursor = conn.cursor()
    cursor.execute("UPDATE event SET retain_indefinitely = 1 WHERE sub_label IS NOT NULL AND sub_label != ''")
    conn.commit()
    print(f"Updated {cursor.rowcount} license plate events to be retained permanently.")

if __name__ == "__main__":
    fix_db()
