import type { Metadata } from "next";
import Portal from "../portal";
export const metadata: Metadata = { title: "Local simulation | Blob Intake", robots: { index: false, follow: false } };
export default function LocalPage() { return <Portal />; }
