// Icon Generator Script
// Run this with Node.js to generate PNG icons from the SVG

const fs = require('fs');
const path = require('path');

const sizes = [16, 32, 48, 128];
const svgContent = fs.readFileSync(path.join(__dirname, 'icons', 'icon.svg'), 'utf8');

// Simple SVG to PNG conversion using data URL approach
// For a proper solution, install: npm install sharp
// Then use the commented code below

const sharp = require('sharp');

async function generateIcons() {
  console.log('Icon Generator');
  console.log('==============');
  
  for (const size of sizes) {
    const outputFile = path.join(__dirname, 'icons', `icon${size}.png`);
    
    await sharp(Buffer.from(svgContent))
      .resize(size, size)
      .png()
      .toFile(outputFile);
    
    console.log(`Generated: icon${size}.png (${size}x${size})`);
  }
  console.log('All icons generated successfully!');
}

generateIcons().catch(console.error);
