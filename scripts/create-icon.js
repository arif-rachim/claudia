const sharp = require('sharp');
const toIco = require('to-ico');
const fs = require('fs');
const path = require('path');

async function createIcon() {
  const inputPath = path.join(__dirname, '..', 'Claudio_logo_1.jpg');
  const buildDir = path.join(__dirname, '..', 'build');
  const outputIco = path.join(buildDir, 'icon.ico');
  const outputPng = path.join(buildDir, 'icon.png');

  // Ensure build directory exists
  if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir, { recursive: true });
  }

  // Get image metadata
  const metadata = await sharp(inputPath).metadata();
  console.log('Original image:', metadata.width, 'x', metadata.height);

  // The logo (rounded square with C) is in the upper portion
  // We need to crop out the "Claudia" text at the bottom
  // Estimate: logo takes about 65% of the height from top
  const cropHeight = Math.floor(metadata.height * 0.68);
  const cropWidth = metadata.width;

  // First, crop to get just the logo part
  const croppedBuffer = await sharp(inputPath)
    .extract({
      left: 0,
      top: 0,
      width: cropWidth,
      height: cropHeight
    })
    .toBuffer();

  // Now make it square by centering the content
  const croppedMeta = await sharp(croppedBuffer).metadata();
  const squareSize = Math.max(croppedMeta.width, croppedMeta.height);

  // Create a 256x256 PNG for the icon (standard icon size)
  const sizes = [256, 128, 64, 48, 32, 16];
  const pngBuffers = [];

  for (const size of sizes) {
    const resized = await sharp(croppedBuffer)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 1 }
      })
      .png()
      .toBuffer();

    pngBuffers.push(resized);

    // Save the 256x256 as icon.png too
    if (size === 256) {
      fs.writeFileSync(outputPng, resized);
      console.log('Created:', outputPng);
    }
  }

  // Create ICO file with multiple sizes
  const icoBuffer = await toIco(pngBuffers);
  fs.writeFileSync(outputIco, icoBuffer);
  console.log('Created:', outputIco);

  console.log('Icon generation complete!');
}

createIcon().catch(console.error);
