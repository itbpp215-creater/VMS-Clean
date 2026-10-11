const fs = require('fs');

// 1. Update web/index.html
const htmlPath = 'd:/BPP-VMS/frigate-nvr/web/index.html';
let html = fs.readFileSync(htmlPath, 'utf8');
if (html.includes('id="inpCamDetect" checked')) {
  html = html.replace('id="inpCamDetect" checked', 'id="inpCamDetect"');
  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log('web/index.html: uncheck inpCamDetect - SUCCESS');
} else {
  console.log('web/index.html: already unchecked or not found');
}

// 2. Update config/dashboard-settings/channels.json
const chPath = 'd:/BPP-VMS/frigate-nvr/config/dashboard-settings/channels.json';
let channels = JSON.parse(fs.readFileSync(chPath, 'utf8'));
channels = channels.map(ch => {
  return { ...ch, detect: false };
});
fs.writeFileSync(chPath, JSON.stringify(channels, null, 2), 'utf8');
console.log('channels.json: updated all channels to detect: false - SUCCESS');
