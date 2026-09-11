import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "АМС Старт",
    short_name: "АМС Старт",
    description: "Стартовая база для CRM, аналитических кабинетов и внутренних веб-приложений.",
    start_url: "/dashboard/",
    scope: "/",
    display: "standalone",
    background_color: "#0c1117",
    theme_color: "#0c1117",
    icons: [
      {
        src: "/ams-start-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
