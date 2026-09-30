import { guideMarkdown } from "../docs/content";
export const dynamic = "force-static";
export function GET() { return new Response(guideMarkdown, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" } }); }
