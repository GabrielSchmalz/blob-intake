import type { MetadataRoute } from "next";
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.BLOB_INTAKE_PUBLIC_URL ?? "https://blob-intake.vercel.app";
  return ["", "/docs"].map(path => ({ url: `${base}${path}`, changeFrequency: "weekly" as const, priority: path === "" ? 1 : 0.8 }));
}
