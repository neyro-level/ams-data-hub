import type { MetadataRoute } from "next";

const baseUrl = "https://ams-start.example";
const lastModified = new Date("2026-09-11T00:00:00.000Z");

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
