import { handleIntake } from "../../../../src/production/http";
export const runtime="nodejs";
export const maxDuration=60;
export const GET=(request:Request)=>handleIntake(request,"download");
