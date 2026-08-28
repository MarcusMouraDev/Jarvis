import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Jarvis",
    short_name: "Jarvis",
    description: "Jarvis privado — conversa, arquivos e aprovações",
    start_url: "/",
    display: "standalone",
    background_color: "#05070a",
    theme_color: "#05070a",
    orientation: "any",
    icons: [{ src: "/jarvis.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
