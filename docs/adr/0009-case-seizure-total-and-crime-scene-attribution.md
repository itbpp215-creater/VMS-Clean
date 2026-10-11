# Case Seizure Total and Crime Scene Attribution in Arrest Ingestion

When processing official police arrest records (บันทึกจับกุม) containing multiple defendants (เช่น ผู้ต้องหาที่ ๑ และผู้ต้องหาที่ ๒) and joint contraband seizures (ของกลางยาเสพติด):

1. **Case Seizure Total**: The authentic quantity stated in the seizure items list or official summary line (`รวมของกลาง...ทั้งสิ้น`) serves as the immutable total for the case and geographic risk analytics. Contraband quantities are never multiplied by the number of co-defendants charged.
2. **Joint Seizure Attribution**: Co-defendants in a joint charge retain the shared seizure context on their profiles without inflating individual metrics or duplicating counts in case rollups.
3. **Crime-Scene-First Spatial Resolution**: The incident location and geographic coordinates plotted on risk heatmaps prioritize the actual crime scene / arrest location (`สถานที่เกิดเหตุ`) over suspects' registered home addresses.
4. **Strict Suspect Ingestion**: Suspect extraction strictly parses designated numbered suspects (`ผู้ต้องหาที่ ๑, ๒...`) or records with explicit 13-digit national IDs, rejecting narrative prose references and administrative command titles (`นายอำเภอ`, `ผบ.ร้อย`).
