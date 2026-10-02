// Genera dist/torre-control.html: un único archivo con el JS, el CSS y el ícono
// embebidos. Se abre con doble clic, se envía por correo o se publica en cualquier
// hosting estático, y funciona sin servidor (modo local).
import { readFileSync, writeFileSync } from 'node:fs';

const dist = new URL('../dist/', import.meta.url);
const read = (file) => readFileSync(new URL(file, dist), 'utf8');

let html = read('index.html');
let inlined = 0;

html = html.replace(
  /<script type="module" crossorigin src="\.\/(assets\/[^"]+\.js)"><\/script>/,
  (_, file) => {
    inlined++;
    // Evita que una cadena "</script" dentro del bundle cierre la etiqueta antes de tiempo.
    const js = read(file).replaceAll('</script', '<\\/script');
    return `<script type="module">${js}</script>`;
  },
);
html = html.replace(
  /<link rel="stylesheet" crossorigin href="\.\/(assets\/[^"]+\.css)">/,
  (_, file) => {
    inlined++;
    return `<style>${read(file)}</style>`;
  },
);
html = html.replace(/href="\.\/favicon\.svg"/, () => {
  const svg = Buffer.from(read('favicon.svg')).toString('base64');
  return `href="data:image/svg+xml;base64,${svg}"`;
});

if (inlined !== 2) {
  throw new Error(`Se esperaba embeber 1 script y 1 hoja de estilos; se embebieron ${inlined}.`);
}
writeFileSync(new URL('torre-control.html', dist), html);
console.log(`dist/torre-control.html (${Math.round(html.length / 1024)} KB)`);
