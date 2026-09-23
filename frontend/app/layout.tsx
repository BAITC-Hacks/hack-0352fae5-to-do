import type { Metadata } from "next";
import "./globals.css";
import "./workbench.css";

export const metadata: Metadata = {
  title: "Money Graph | Analyst Workbench",
  description: "Explore evidence-backed roles in an anonymized transfer graph.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return <html lang="en"><body className="min-h-full antialiased">{children}</body></html>;
}
