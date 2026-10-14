/**
 * GitHub Pages has no SPA rewrite rule, and it only honours a 404.html at the
 * ROOT of the Pages site (/iapp/404.html), never one inside /iapp/app/. So a
 * deep link such as /iapp/app/display is a plain "404 File not found" unless a
 * real file exists at that path.
 *
 *  - 404.html is kept (harmless, and used if the site is ever served elsewhere).
 *  - display/index.html is a copy of the app shell. It makes
 *    /iapp/app/display/ answer 200, which the public waiting-room screen needs:
 *    it is opened by link on a TV / phone with no way to "go through" the app.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';

const from = 'dist/index.html';
if (!existsSync(from)) {
  console.error('pages-fallback: dist/index.html not found');
  process.exit(1);
}
copyFileSync(from, 'dist/404.html');
mkdirSync('dist/display', { recursive: true });
copyFileSync(from, 'dist/display/index.html');
console.log('pages-fallback: dist/404.html and dist/display/index.html written');
