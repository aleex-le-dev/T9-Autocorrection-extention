const fs = require('fs');
const path = require('path');

// Lire le header PNG pour trouver la taille
const buf = fs.readFileSync('C:/Users/Alex/.gemini/antigravity-ide/brain/bc8fed4f-b174-4d07-8e29-989ba8f30f97/google_account_page_1792019301420.png');
const width = buf.readUInt32BE(16);
const height = buf.readUInt32BE(20);
console.log(`Image dimensions: ${width}x${height}`);
