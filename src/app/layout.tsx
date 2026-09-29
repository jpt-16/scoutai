import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import "@fontsource/barlow/700.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/barlow-condensed/800.css";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { isClerkConfigured } from "@/lib/clerkConfig";

export const metadata: Metadata = {
  title: "ScoutCard AI",
  description:
    "Turn your weekly Hudl breakdown CSV into vector scout team cards for the iPad or print.",
  manifest: "/manifest.json",
  applicationName: "ScoutCard AI",
  appleWebApp: {
    capable: true,
    title: "ScoutCard",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0d1210",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const body = (
    <body className="antialiased">
      {children}
      <ServiceWorkerRegister />
    </body>
  );

  return (
    // suppressHydrationWarning: the inline script below adds the `js` class
    // before React hydrates, which reveal-on-scroll styles depend on.
    <html lang="en" className="scroll-smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      </head>
      {/* Only the paid video feature uses Clerk — the free CSV path never
          needs a signed-in user, so ClerkProvider (which throws without a
          publishable key) is skipped entirely until one is configured. */}
      {isClerkConfigured() ? <ClerkProvider>{body}</ClerkProvider> : body}
    </html>
  );
}
