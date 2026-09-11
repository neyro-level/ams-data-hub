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
    sitemap: "https://ams-start.example/sitemap.xml",
    host: "https://ams-start.example",
  };
}
