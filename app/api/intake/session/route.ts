import { handleIntake } from "../../../../src/production/http";
export const runtime="nodejs";
export const maxDuration=60;
export const POST=(request:Request)=>handleIntake(request,"session");
export const DELETE=(request:Request)=>handleIntake(request,"session");
