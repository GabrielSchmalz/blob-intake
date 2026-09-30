import type { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots {
  const base = process.env.BLOB_INTAKE_PUBLIC_URL ?? "https://blob-intake.vercel.app";
  return { rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/local"] }, sitemap: `${base}/sitemap.xml` };
}
