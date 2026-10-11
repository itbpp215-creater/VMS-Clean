/** Crop only the approved mascot/circuit/aperture region so the old circular perimeter does not compete with the new shield. */
const path = require('path');
const sharp = require('sharp');

const root = __dirname;

/** Preserve source pixels inside the crop and scale the derived layer only during final composition. */
async function main() {
  // An elliptical alpha matte removes the crop's square black corners while leaving all central mascot pixels untouched.
  const matte = Buffer.from('<svg width="954" height="1000"><ellipse cx="477" cy="500" rx="465" ry="495" fill="white"/></svg>');
  await sharp(path.join(root, 'artwork-base.png')).extract({ left: 150, top: 125, width: 954, height: 1000 }).ensureAlpha().composite([{ input: matte, blend: 'dest-in' }]).png({ compressionLevel: 9 }).toFile(path.join(root, 'mascot-crop.png'));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
