/** Create delivery-ready JPG while preserving the transparent PNG master. */
const path = require('path');
const sharp = require('sharp');

const root = __dirname;

async function main() {
  await sharp(path.join(root, 'bpp-prerimwatch-pointed-shield.png'))
    .flatten({ background: '#06070f' })
    .jpeg({ quality: 96, chromaSubsampling: '4:4:4' })
    .toFile(path.join(root, 'bpp-prerimwatch-pointed-shield.jpg'));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
