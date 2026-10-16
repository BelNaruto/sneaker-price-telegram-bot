// Small client for the KicksCrew Sneakers Data API
// https://rapidapi.com/belchiorarkad-FqvHs2EDOtP/api/kickscrew-sneakers-data · Support: Telegram @pintoflow
const HOST = 'kickscrew-sneakers-data.p.rapidapi.com';
const cache = new Map();

async function get(path, params, ttlMs = 5 * 60 * 1000) {
  const url = `https://${HOST}${path}?${new URLSearchParams(params)}`;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const res = await fetch(url, { headers: { 'x-rapidapi-key': process.env.RAPIDAPI_KEY, 'x-rapidapi-host': HOST } });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const v = await res.json();
  cache.set(url, { t: Date.now(), v });
  return v;
}

const usSize = (label = '') => (label.match(/US\s*([\d.]+[YCK]?)/) || [, label])[1];
const sku = (title) => (title.match(/[A-Z0-9]{5,7}-[0-9]{3}$/) || [''])[0];

async function search(query, limit = 5) {
  const r = await get('/search/v2', { query, hitsPerPage: limit, page: 1, region: 'US', currency: 'USD' });
  return r.data.products.map((p) => ({ id: p.id, title: p.title, vendor: p.vendor, handle: p.handle, url: p.url, image: p.image_url }));
}

async function details(handle) {
  const r = await get('/product/description/byslugs', { handle, country: 'US' });
  const d = r.data;
  const sizes = d.variants.edges
    .map(({ node }) => ({
      size: usSize(node.selectedOptions.find((o) => o.name === 'Size')?.value || node.title),
      gender: node.selectedOptions.find((o) => o.name === 'Gender')?.value || '',
      price: Number(node.price.amount),
      inStock: node.availableForSale,
    }))
    .filter((s) => s.price > 0);
  const inStock = sizes.filter((s) => s.inStock);
  const cheapest = [...inStock].sort((a, b) => a.price - b.price)[0] || null;
  return { title: d.title, vendor: d.vendor, handle, url: `https://www.kickscrew.com/products/${handle}`, image: d.featuredImage?.url, sizes, inStock, cheapest };
}

module.exports = { search, details, sku };
