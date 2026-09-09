import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const pageUrl = 'https://medirulekit.emmanuelcuyugan.com/walkthrough/';
const imagePath = 'social/rulekit-walkthrough-v1.png';
const imageUrl = new URL(imagePath, pageUrl).href;

function readHtml(path) {
  const url = new URL(path, import.meta.url);
  if (!existsSync(url)) throw new Error('Run npm run build before testing the packaged social preview.');
  return readFileSync(url, 'utf8');
}

function readHead(html) {
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1];
  expect(head, 'Preview metadata must be present in the server-rendered HTML head').toBeTruthy();
  const tags = [...head.matchAll(/<(meta|link)\b([^>]+)>/gi)].map(([, tag, body]) => ({
    tag: tag.toLowerCase(),
    ...Object.fromEntries([...body.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)].map(([, name, value]) => [name, value])),
  }));
  const meta = (key) => {
    const matches = tags.filter((tag) => tag.tag === 'meta' && (tag.property === key || tag.name === key));
    expect(matches, `Expected one ${key} meta tag`).toHaveLength(1);
    return matches[0].content;
  };
  return { head, tags, meta };
}

describe.each([
  ['source', '../index.html'],
  ['production build', '../dist/index.html'],
])('social preview in %s HTML', (_name, path) => {
  it('gives crawlers one public destination and consistent preview copy without JavaScript', () => {
    const { head, tags, meta } = readHead(readHtml(path));
    const canonical = tags.filter((tag) => tag.tag === 'link' && tag.rel === 'canonical');
    expect(canonical).toHaveLength(1);
    expect(canonical[0].href).toBe(pageUrl);
    expect(meta('og:url')).toBe(pageUrl);
    expect(meta('og:type')).toBe('website');
    expect(meta('og:site_name')).toBe('RuleKit');

    const title = head.match(/<title>([^<]+)<\/title>/i)?.[1];
    expect(title?.length).toBeGreaterThan(10);
    expect(meta('og:title')).toBe(title);
    expect(meta('twitter:title')).toBe(title);
    expect(meta('og:description')).toBe(meta('description'));
    expect(meta('twitter:description')).toBe(meta('description'));
    expect(meta('description').length).toBeGreaterThan(40);
  });

  it('advertises an absolute, accessible large image at the deployed walkthrough path', () => {
    const { meta } = readHead(readHtml(path));
    expect(meta('og:image')).toBe(imageUrl);
    expect(meta('twitter:image')).toBe(imageUrl);
    expect(meta('twitter:card')).toBe('summary_large_image');
    expect(meta('og:image:type')).toBe('image/png');
    expect(meta('og:image:width')).toBe('1200');
    expect(meta('og:image:height')).toBe('627');
    expect(meta('og:image:alt').length).toBeGreaterThan(30);
    expect(meta('twitter:image:alt')).toBe(meta('og:image:alt'));
  });
});

it('ships the declared PNG unchanged in the production build, within a 1 MiB budget', () => {
  const source = readFileSync(new URL(`../public/${imagePath}`, import.meta.url));
  const built = readFileSync(new URL(`../dist/${imagePath}`, import.meta.url));
  expect(built.equals(source)).toBe(true);
  expect(source.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(source.subarray(12, 16).toString('ascii')).toBe('IHDR');
  expect(source.readUInt32BE(16)).toBe(1200);
  expect(source.readUInt32BE(20)).toBe(627);
  expect(source.subarray(-8, -4).toString('ascii')).toBe('IEND');
  expect(source.length).toBeLessThanOrEqual(1024 * 1024);
});
