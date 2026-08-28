import type { Metadata } from "next";
import { PwaRuntime } from "@/ui/PwaRuntime";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jarvis",
  description: "Presença viva — interface de assistente com estados cromáticos",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Jarvis", statusBarStyle: "black-translucent" },
  icons: { icon: "/jarvis.svg", apple: "/jarvis.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="font-sans antialiased">
        <PwaRuntime />
        {children}
      </body>
    </html>
  );
}
