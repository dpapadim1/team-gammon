// Checks the text blocks of store/listing.md against App Store Connect's length limits.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'store', 'listing.md');
const LIMITS = { Subtitle: 30, 'Promotional text': 170, Description: 4000, Keywords: 100 };
const text = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
let failed = false;
for (const [field, max] of Object.entries(LIMITS)) {
  const block = text.match(new RegExp(`## ${field}[^\\n]*\\n+\`\`\`\\n([\\s\\S]*?)\\n\`\`\``))?.[1];
  if (block === undefined) { console.log(`missing: ${field}`); failed = true; continue; }
  // Keywords are limited in bytes, the other fields in characters.
  const used = field === 'Keywords' ? Buffer.byteLength(block) : [...block].length;
  const ok = used <= max;
  failed ||= !ok;
  console.log(`${ok ? 'ok  ' : 'LONG'} ${field}: ${used}/${max}`);
}
process.exitCode = failed ? 1 : 0;
