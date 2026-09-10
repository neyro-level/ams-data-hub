import type { MetadataRoute } from "next";

const baseUrl = "https://impulse.ams24.ru";
const lastModified = new Date("2026-09-01T00:00:00.000Z");

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${baseUrl}/`,
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    ...["politika", "soglasie", "cookies", "terms"].map((path) => ({
      url: `${baseUrl}/${path}/`,
      lastModified,
      changeFrequency: "yearly" as const,
      priority: 0.2,
    })),
  ];
}
