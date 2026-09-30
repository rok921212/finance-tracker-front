// Start downloading a full-size screenshot before it is opened (hover / touch / keyboard focus),
// so the preview shows it right away. Each URL is fetched once per visit.
const preloaded = new Set<string>();

export const preloadImage = (url?: string | null) => {
  if (!url || preloaded.has(url)) return;
  preloaded.add(url);
  const img = new Image();
  img.decoding = "async";
  img.src = url;
};
