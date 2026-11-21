const esbuild = require('esbuild');
const { URL } = require('node:url');
const raw = process.env.PLU_APP_API_BASE || 'https://plus.xanderxx.xyz';
const url = new URL(raw);
if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Use an HTTPS API origin without credentials/path');
esbuild.buildSync({ entryPoints: ['client/main.js'], bundle: true, minify: true, outfile: 'public/js/bundle.js', target: ['es2020'], define: { __PLU_API_BASE__: JSON.stringify(url.origin) }, legalComments: 'eof' });
console.log('Built shared website/Android assets. No credential environment variables are used.');
