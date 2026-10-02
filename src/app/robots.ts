import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/politika/", "/soglasie/", "/cookies/", "/terms/"],
        disallow: ["/dashboard/", "/admin/", "/notifications/", "/api/"],
      },
    ],
    sitemap: "https://data-hab.ams24.ru/sitemap.xml",
    host: "https://data-hab.ams24.ru",
  };
}
