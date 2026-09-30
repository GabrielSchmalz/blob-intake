import { handleManagedScan } from "../../../src/production/managed-http";
export const runtime="nodejs";
export const maxDuration=60;
export const GET=(request:Request)=>handleManagedScan(request);
export const POST=(request:Request)=>handleManagedScan(request);
