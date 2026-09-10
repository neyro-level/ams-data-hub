import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/politika/", "/soglasie/", "/cookies/", "/terms/"],
        disallow: ["/dashboard/", "/analyst/", "/c/", "/demo/", "/api/"],
      },
    ],
    sitemap: "https://impulse.ams24.ru/sitemap.xml",
    host: "https://impulse.ams24.ru",
  };
}
