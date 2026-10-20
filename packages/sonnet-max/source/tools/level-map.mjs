// Draws a top-down SVG map of the course from the layout data. Usage: node tools/level-map.mjs [out.svg]
import fs from 'node:fs';
import { createLevelLayout } from '../src/world/LevelLayout.ts';

const out = process.argv[2] ?? 'docs/level-map.svg';
const layout = createLevelLayout();
const SECTION_COLORS = ['#c9d4e3', '#d5dde8', '#e3d4d4', '#d9e3d5', '#e8e0cc', '#d6d0e6'];

// World bounds of everything that matters.
let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
for (const b of layout.boxes) {
  if (!b.collide || b.max[1] - b.min[1] < 8) continue;
  minX = Math.min(minX, b.min[0]); maxX = Math.max(maxX, b.max[0]);
  minZ = Math.min(minZ, b.min[2]); maxZ = Math.max(maxZ, b.max[2]);
}
const pad = 12;
minX -= pad; maxX += pad; minZ -= pad; maxZ += pad;
const scale = 3.2;
const W = (maxX - minX) * scale;
const H = (maxZ - minZ) * scale;
const X = (x) => ((x - minX) * scale).toFixed(1);
const Z = (z) => ((z - minZ) * scale).toFixed(1);

const parts = [];
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" width="${W.toFixed(0)}" height="${H.toFixed(0)}" font-family="Futura, 'Century Gothic', Arial, sans-serif">`);
parts.push(`<rect width="100%" height="100%" fill="#f5f7f9"/>`);
// Tall wall buildings (towers) first, light gray.
for (const b of layout.boxes) {
  if (!b.collide || b.max[1] - b.min[1] < 20 || !/tower/i.test(b.label)) continue;
  parts.push(`<rect x="${X(b.min[0])}" y="${Z(b.min[2])}" width="${((b.max[0] - b.min[0]) * scale).toFixed(1)}" height="${((b.max[2] - b.min[2]) * scale).toFixed(1)}" fill="#e4e8ed" stroke="#c4ccd6" stroke-width="1"/>`);
}
// Walkable roofs / beams by section.
for (const b of layout.boxes) {
  if (!b.collide || /tower|curb|railing|pipe|crate|duct|bulkhead|panel|ac$|vent|tank|penthouse|skylight/i.test(b.label) || b.max[1] - b.min[1] < 8) continue;
  parts.push(`<rect x="${X(b.min[0])}" y="${Z(b.min[2])}" width="${((b.max[0] - b.min[0]) * scale).toFixed(1)}" height="${((b.max[2] - b.min[2]) * scale).toFixed(1)}" fill="${SECTION_COLORS[b.chunk % 6]}" stroke="#7b8794" stroke-width="1.2"/>`);
}
// Red features: bulkheads, panels, crates.
for (const b of layout.boxes) {
  if (!b.collide) continue;
  if (/bulkhead/.test(b.label)) parts.push(`<rect x="${X(b.min[0])}" y="${Z(b.min[2])}" width="${((b.max[0] - b.min[0]) * scale).toFixed(1)}" height="${((b.max[2] - b.min[2]) * scale).toFixed(1)}" fill="#e0150f" opacity="0.85"/>`);
  if (/wall-run/.test(b.label)) parts.push(`<rect x="${X(b.min[0])}" y="${Z(b.min[2])}" width="${((b.max[0] - b.min[0]) * scale).toFixed(1)}" height="${Math.max(3, (b.max[2] - b.min[2]) * scale).toFixed(1)}" fill="#e0150f"/>`);
  if (/vault crate/.test(b.label)) parts.push(`<rect x="${X(b.min[0])}" y="${Z(b.min[2])}" width="${((b.max[0] - b.min[0]) * scale).toFixed(1)}" height="${((b.max[2] - b.min[2]) * scale).toFixed(1)}" fill="#e0150f"/>`);
}
// Route polyline.
const pts = layout.route.map((n) => `${X(n.x)},${Z(n.z)}`).join(' ');
parts.push(`<polyline points="${pts}" fill="none" stroke="#10151c" stroke-width="2.2" stroke-dasharray="7 5" stroke-linejoin="round"/>`);
for (const n of layout.route) {
  const color = n.act === 'jump' || n.act === 'jumpWall' ? '#e0150f' : n.act === 'slide' ? '#10151c' : n.act === 'vault' ? '#e0150f' : null;
  if (color) parts.push(`<circle cx="${X(n.x)}" cy="${Z(n.z)}" r="3.6" fill="${color}" stroke="#fff" stroke-width="1"/>`);
}
// Checkpoints, start, finish.
for (const c of layout.checkpoints) {
  parts.push(`<g><circle cx="${X(c.x)}" cy="${Z(c.z)}" r="9" fill="#fff" stroke="#e0150f" stroke-width="3"/><text x="${X(c.x)}" y="${(Number(Z(c.z)) + 4).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="800" fill="#10151c">${c.id}</text></g>`);
}
parts.push(`<g><circle cx="${X(layout.start.x)}" cy="${Z(layout.start.z)}" r="10" fill="#10151c"/><text x="${X(layout.start.x)}" y="${(Number(Z(layout.start.z)) + 4).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="800" fill="#fff">S</text></g>`);
parts.push(`<g><rect x="${(Number(X(layout.finish.x)) - 14).toFixed(1)}" y="${(Number(Z(layout.finish.z)) - 7).toFixed(1)}" width="28" height="14" fill="#e0150f"/><text x="${X(layout.finish.x)}" y="${(Number(Z(layout.finish.z)) + 4).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="800" fill="#fff">FINISH</text></g>`);
for (const s of layout.sections) {
  const t = s.trigger;
  parts.push(`<text x="${X((t.min[0] + t.max[0]) / 2)}" y="${(Number(Z(t.min[2])) - 6).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="800" letter-spacing="2" fill="#38424e">${s.index} ${s.name}</text>`);
}
parts.push(`<text x="14" y="${(H - 14).toFixed(0)}" font-size="12" font-weight="800" letter-spacing="2" fill="#6b7683">ROOFTOP FLOW - COURSE MAP (NORTH UP) - RED = JUMP / VAULT / SLIDE / WALL-RUN</text>`);
parts.push('</svg>');
fs.mkdirSync(out.includes('/') ? out.slice(0, out.lastIndexOf('/')) : '.', { recursive: true });
fs.writeFileSync(out, parts.join('\n'));
console.log(`wrote ${out} (${W.toFixed(0)}x${H.toFixed(0)})`);
