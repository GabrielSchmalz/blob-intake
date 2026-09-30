import { handleDemo } from "../../../../src/demo/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return handleDemo(request, "state"); }
