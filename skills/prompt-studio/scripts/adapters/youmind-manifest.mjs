import fs from "node:fs";
import path from "node:path";
export const USE_MAP = {
  cover: ["youtube-thumbnail", "poster-flyer"],
  illustration: ["poster-flyer", "others", "social-media-post"],
  infographic: ["infographic-edu-visual"],
  avatar: ["profile-avatar"],
  thumbnail: ["youtube-thumbnail"],
  poster: ["poster-flyer"],
  comic: ["comic-storyboard"],
  product: ["product-marketing", "ecommerce-main-image"],
  game: ["game-asset"],
  app: ["app-web-design"],
};
export const LARGE_SLUGS = ["social-media-post", "product-marketing"];
function read(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
function local(dir, file) {
  if (
    typeof file !== "string" ||
    path.isAbsolute(file) ||
    file.split(/[\\/]/).includes("..")
  )
    return null;
  return path.join(dir, file);
}
export async function sync(src, ctx) {
  const base =
    src.rawBase ||
    `https://raw.githubusercontent.com/${src.repo}/${src.branch || "main"}/references`;
  const file = path.join(ctx.dir, "manifest.json");
  const results = [await ctx.fetchCached(`${base}/manifest.json`, file)];
  const manifest = read(file);
  const known = Array.isArray(manifest?.categories)
    ? manifest.categories.filter(
        (c) => c && typeof c.slug === "string" && typeof c.file === "string",
      )
    : [];
  const wanted = ctx.all
    ? known.map((c) => c.slug)
    : ctx.categories?.length
      ? ctx.categories
      : known
          .filter((c) => {
            const file = local(ctx.dir, c.file);
            return file && fs.existsSync(file);
          })
          .map((c) => c.slug);
  const notes =
    !ctx.all && !ctx.categories?.length
      ? [`${src.id}: pass --use to search its categories`]
      : [];
  for (const slug of wanted) {
    const cat = known.find((c) => c.slug === slug);
    if (!cat) {
      results.push({ status: "unknown-category", slug });
      continue;
    }
    if (LARGE_SLUGS.includes(slug) && !ctx.allowLarge) {
      results.push({
        status: "skipped-large",
        slug,
        hint: "Pass --allow-large to download this category",
      });
      continue;
    }
    const target = local(ctx.dir, cat.file);
    if (target)
      results.push(await ctx.fetchCached(`${base}/${cat.file}`, target));
  }
  return {
    results,
    notes,
    updatedAt: manifest?.updatedAt || null,
    categories: known.map((c) => ({
      ...c,
      cached: Boolean(
        local(ctx.dir, c.file) && fs.existsSync(local(ctx.dir, c.file)),
      ),
    })),
  };
}
export function load(src, ctx) {
  const manifest = read(path.join(ctx.dir, "manifest.json"));
  const categories = Array.isArray(manifest?.categories)
    ? manifest.categories.filter(
        (c) => c && typeof c.slug === "string" && typeof c.file === "string",
      )
    : [];
  return categories.flatMap((cat) => {
    const file = local(ctx.dir, cat.file);
    const items = file && read(file);
    if (!Array.isArray(items)) return [];
    return items
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        ...item,
        nativeId: item.id,
        category: cat.slug,
        model: item.model || src.modelDefault || null,
      }));
  });
}
