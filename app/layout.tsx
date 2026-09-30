import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Blob Intake • Local experiment", description: "Compare file acceptance workflows using a local simulation." };
export default function Layout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
