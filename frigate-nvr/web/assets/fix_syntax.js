const fs = require('fs');
const path = 'd:/BPP-VMS/frigate-nvr/web/assets/app.js';
let content = fs.readFileSync(path, 'utf8');

const searchRegex = /html \+= \O[^]*?modal\.appendChild\(card\);/;
if (!searchRegex.test(content)) {
  console.log('Could not find garbled text');
  process.exit(1);
}

const replacement = \html += \\\</div></details>\\\;
    });

    html += \\\</div>\\\;
    card.innerHTML = html;
    modal.appendChild(card);\;

content = content.replace(searchRegex, replacement);

fs.writeFileSync(path, content, 'utf8');
console.log('Fixed syntax error');
