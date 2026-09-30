import { handleDemo } from "../../../../src/demo/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request) { return handleDemo(request, "action"); }
