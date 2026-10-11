# ADR 0023: Auto-parsing Dossier Attachments for i2 Graph Enrichment

## Context
When officers view a suspect's dossier, they need the ability to upload additional evidence (e.g., phone bills, handwritten notes, chat screenshots) directly into the dossier's Personal folder. We needed to decide how these newly uploaded files interact with the system's core intelligence mapping feature (the i2 network graph).

## Decision
Any applicable document or image uploaded via the Dossier Attachments tab (Tab 3) will be automatically processed by the AI OCR pipeline (extract_document_data). Extracted entities (like phone numbers, network aliases, or accomplices) will be used to automatically generate new bidirectional links in the i2 graph, linking the current dossier to existing or newly discovered networks.

## Consequences
- **Positive**: The i2 network graph grows organically as officers append evidence, saving manual data entry and revealing hidden connections automatically.
- **Negative**: Increases immediate compute cost and API latency during file upload, as the user must wait for the AI OCR pipeline to finish processing the image before the upload is considered 'complete'.
- **Negative**: Risk of hallucinated connections if the uploaded image contains irrelevant phone numbers (e.g., a pizza delivery number on a receipt). Officers must still verify links in the i2 interface.
