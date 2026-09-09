// Regenerate the committed preview from the editable layout and repository screenshot.
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const output = new URL('../public/social/medirulekit-workflow-v2.png', import.meta.url);
await mkdir(fileURLToPath(new URL('.', output)), { recursive: true });
const browser = await puppeteer.launch({
  headless: true,
  ...(process.env.PUPPETEER_EXECUTABLE_PATH
    ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }
    : { channel: 'chrome' }),
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 627, deviceScaleFactor: 1 });
  await page.goto(new URL('../social/preview.html', import.meta.url).href, { waitUntil: 'networkidle0' });
  await page.evaluate(async () => {
    await document.fonts.ready;
    if (!document.fonts.check('700 56px "Public Sans"')) throw new Error('Preview font did not load');
    await Promise.all([...document.images].map(image => image.decode()));
  });
  await page.screenshot({ path: fileURLToPath(output) });
  console.log(`Saved 1200 x 627 preview to ${fileURLToPath(output)}`);
} finally {
  await browser.close();
}
