import { handleIntake } from "../../../../src/production/http";
export const runtime="nodejs";
export const maxDuration=60;
export const POST=(request:Request)=>handleIntake(request,"reconcile");
export const GET=(request:Request)=>handleIntake(request,"reconcile");
