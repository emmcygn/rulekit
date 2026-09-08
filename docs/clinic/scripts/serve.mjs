// Run the package's JavaScript entry point directly so PORT and process cleanup
// behave identically on Windows, macOS, and Linux, without a shell wrapper.
import { fileURLToPath } from 'node:url';

const entry = new URL('../node_modules/serve/build/main.js', import.meta.url);
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
process.argv = [process.execPath, fileURLToPath(entry), 'dist', '-l',
  process.env.PORT || '3000', '--no-clipboard', ...process.argv.slice(2)];
await import(entry.href);
