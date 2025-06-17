const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

// Create a canvas with some text that can be used for OCR testing
const WIDTH = 800;
const HEIGHT = 600;
const canvas = createCanvas(WIDTH, HEIGHT);
const ctx = canvas.getContext('2d');

// White background
ctx.fillStyle = '#FFFFFF';
ctx.fillRect(0, 0, WIDTH, HEIGHT);

// Black text
ctx.fillStyle = '#000000';
ctx.font = 'bold 30px Arial';
ctx.fillText('This is a test image for OCR', 100, 100);
ctx.font = '24px Arial';
ctx.fillText('The quick brown fox jumps over the lazy dog', 100, 200);
ctx.fillText('1234567890', 100, 300);
ctx.fillText('OCR API Performance Test', 100, 400);
ctx.fillText('Node.js vs PHP Comparison', 100, 500);

// Save as JPG
const out = fs.createWriteStream(path.join(__dirname, 'test-image.jpg'));
const stream = canvas.createJPEGStream({ quality: 0.95 });
stream.pipe(out);
out.on('finish', () => console.log('Test image created successfully at test/test-image.jpg'));
