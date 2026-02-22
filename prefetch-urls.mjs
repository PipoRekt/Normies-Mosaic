// prefetch-urls.mjs
// Run once with: node prefetch-urls.mjs
// Generates public/image-urls.json with all 10,000 image URLs
// Then commit that file to GitHub — the mosaic will use it directly

import fs from 'fs';

const CONTRACT  = '0x9eb6e2025b64f340691e424b7fe7022ffde12438';
const RPCS      = [
  'https://cloudflare-eth.com',
  'https://rpc.ankr.com/eth',
  'https://ethereum.publicnode.com',
];
const BATCH     = 50;   // parallel RPC calls
const OUT_FILE  = './public/image-urls.json';

function encodeTokenURI(tokenId) {
  return '0xc87b56dd' + tokenId.toString(16).padStart(64, '0');
}

async function callRPC(method, params) {
  for (const rpc of RPCS) {
    try {
      const res  = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
      });
      const data = await res.json();
      if (data.result) return data.result;
    } catch {}
  }
  throw new Error('All RPCs failed');
}

function decodeABIString(hex) {
  const data = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (data.length < 128) return null;
  const length = parseInt(data.slice(64, 128), 16);
  const strHex = data.slice(128, 128 + length * 2);
  const bytes  = Buffer.from(strHex, 'hex');
  return bytes.toString('utf8');
}

async function getImageUrl(tokenId) {
  try {
    const hex      = await callRPC('eth_call', [{ to: CONTRACT, data: encodeTokenURI(tokenId) }, 'latest']);
    const tokenURI = decodeABIString(hex);
    if (!tokenURI) return null;

    let metadata;
    if (tokenURI.startsWith('data:application/json;base64,')) {
      metadata = JSON.parse(Buffer.from(tokenURI.split(',')[1], 'base64').toString());
    } else if (tokenURI.startsWith('data:application/json,')) {
      metadata = JSON.parse(decodeURIComponent(tokenURI.split(',')[1]));
    } else if (tokenURI.startsWith('ipfs://')) {
      const res = await fetch(`https://cloudflare-ipfs.com/ipfs/${tokenURI.replace('ipfs://', '')}`);
      metadata  = await res.json();
    } else {
      const res = await fetch(tokenURI);
      metadata  = await res.json();
    }

    let img = metadata.image || metadata.image_url || '';
    if (img.startsWith('ipfs://')) img = 'https://cloudflare-ipfs.com/ipfs/' + img.replace('ipfs://', '');
    return img || null;
  } catch {
    return null;
  }
}

async function main() {
  fs.mkdirSync('./public', { recursive: true });

  // Resume if partially done
  let urls = {};
  if (fs.existsSync(OUT_FILE)) {
    urls = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
    console.log(`Resuming — ${Object.keys(urls).length} already done`);
  }

  const todo = [];
  for (let i = 0; i < 10000; i++) {
    if (!urls[i]) todo.push(i);
  }

  console.log(`Fetching ${todo.length} remaining tokens…`);
  let done = 0;

  for (let i = 0; i < todo.length; i += BATCH) {
    const batch   = todo.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(async id => ({ id, url: await getImageUrl(id) })));
    results.forEach(({ id, url }) => { if (url) urls[id] = url; });
    done += batch.length;
    fs.writeFileSync(OUT_FILE, JSON.stringify(urls));
    process.stdout.write(`\r${done} / ${todo.length} (${Math.round(done/todo.length*100)}%)`);
  }

  console.log(`\nDone! Saved to ${OUT_FILE}`);
}

main();
